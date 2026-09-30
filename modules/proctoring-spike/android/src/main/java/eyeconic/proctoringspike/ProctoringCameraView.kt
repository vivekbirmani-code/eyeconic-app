// ProctoringCameraView — the streaming camera-analysis view (AI Proctoring
// Track 2; plan §5.2/§29.1 of the Phase 0 report: the snapshot transport was
// the FPS bottleneck — capture ~750 ms ≫ decode ~16 ms + inference ~200 ms).
//
// CameraX Preview + ImageAnalysis bound in ONE use-case group (the same
// one-camera doctrine as the previous PiP): the preview is student-visible
// while every analyzed frame runs ML Kit fully ON-DEVICE and only the
// sanitized observation (positions/angles/probabilities + timing + luma —
// no pixels) crosses the bridge to JS as `onFrameObservation`, the identical
// payload shape `detectFacesJpegBase64` returns.
//
// Lifecycle: bind on attach, unbind + detector.close() on detach (no camera
// leak; the camera LED goes out). The view owns its OWN FaceDetector — the
// module-scoped one is closed in OnDestroy and is not shared with views.
// Throttling: STRATEGY_KEEP_ONLY_LATEST drops frames while inference is in
// flight; an explicit minIntervalMs prop bounds the analysis rate further.
//
// BIND SAFETY (Fabric re-attach race, fixed 2026-09-30, hardened 2026-10-01):
// the camera bind is ASYNCHRONOUS (ProcessCameraProvider future + main-thread
// listener), but Fabric can attach → detach → re-attach this view within one
// mount commit. The original code bound whatever view won the race — including
// DETACHED instances — and a stale listener completing after a detach left the
// camera owned by an invisible view (black preview, zero frames, zero errors)
// or tore down another instance's session mid-bind, which surfaces inside
// bindToLifecycle as IllegalStateException "No camera attached to use case".
// Guards: (a) a bind only completes for a still-attached view, (b) every bind
// carries a generation token that unbind invalidates, (c) re-attach restarts
// the bind cleanly. HARDENING: a TRANSIENT detach (Fabric dance) must not
// kill the view either — teardown is DEFERRED briefly on detach (cancelled on
// re-attach), and each bind builds a FRESH detector + analysis executor, so a
// runtime torn down by an earlier detach can never silently swallow frames
// (the "camera open, 0 frames" failure the first fix could still produce).
// Observable health (`onCameraStatus` phases + CameraState observation + a
// first-frame watchdog) replaces the old silence: a dead stream reports WHY.
package eyeconic.proctoringspike

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import android.util.Size
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.common.util.concurrent.ListenableFuture
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@SuppressLint("ViewConstructor")
class ProctoringCameraView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {

  /** Sanitized per-frame observation — same shape as detectFacesJpegBase64. */
  private val onFrameObservation by EventDispatcher<Map<String, Any?>>()
  /** Camera/detector trouble (permission lost, bind failure, ML Kit error). */
  private val onCameraError by EventDispatcher<Map<String, Any?>>()
  /** Camera health phases: binding → bound → open (or an error event). */
  private val onCameraStatus by EventDispatcher<Map<String, Any?>>()

  // The SAME options as the module's still-image detector (Tier A, Phase 0).
  // Recreated per bind (see class header): a detector closed by an earlier
  // teardown must never serve a later bind, or every frame fails.
  private var detector: FaceDetector = newDetector()

  private val mainHandler = Handler(Looper.getMainLooper())
  private val mainExecutor = Executor { command -> mainHandler.post(command) }

  /** Runs ImageAnalysis callbacks; recreated alongside the detector per bind. */
  private var analysisExecutor: ExecutorService = newAnalysisExecutor()

  private val previewView: PreviewView = PreviewView(context).apply {
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    // The PiP is non-interactive; performance mode keeps it cheap.
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
  }

  // ===== Attach/bind state. All mutated on the main thread only. =====
  /** True between onAttachedToWindow/onDetachedFromWindow. */
  private var attached: Boolean = false

  /**
   * Invalidated by every detach/unbind; a bind listener whose generation no
   * longer matches aborts instead of completing a stale bind.
   */
  private var bindGeneration: Int = 0

  private var cameraProviderFuture: ListenableFuture<ProcessCameraProvider>? = null
  private var boundPreview: Preview? = null
  private var boundAnalysis: ImageAnalysis? = null
  private var boundCamera: Camera? = null
  private var cameraStateObserver: Observer<CameraState>? = null

  /** Frames delivered to the analyzer — watchdog input (0 = camera dead). */
  @Volatile
  private var framesSeen: Long = 0L

  /** Last CameraState phase string, for watchdog diagnostics. */
  @Volatile
  private var lastCameraPhase: String = "unknown"

  /** Pending first-frame watchdog callback (null when disarmed). */
  private var firstFrameWatchdog: Runnable? = null

  /** Deferred teardown scheduled by onDetachedFromWindow (cancelled on re-attach). */
  private var teardownRunnable: Runnable? = null

  /** True while a bind's provider-future listener is queued/running. */
  private var bindInFlight: Boolean = false

  /** Prop: pause analysis without unbinding the preview (AppState background). */
  var analysisPaused: Boolean = false

  /** Prop: minimum spacing between analyzed frames (bounds CPU/battery). */
  var minIntervalMs: Long = 250L

  @Volatile
  private var lastAnalysisAt: Long = 0L

  /** One in-flight inference guard — KEEP_ONLY_LATEST already implies this. */
  @Volatile
  private var inferenceInFlight: Boolean = false

  init {
    addView(previewView, 0)
    // BIND ON LAYOUT, NOT ATTACH (fixed 2026-10-01): "attached" ≠ "laid out".
    // CameraX resolves the capture session shortly after bind; the PreviewView
    // can only provide its surface once it has been laid out with a non-zero
    // size. Binding before the first layout pass left the session waiting on a
    // surface that never arrived — dumpsys showed the camera OPEN with ZERO
    // streams/requests and no retry, i.e. camera-open-but-dead-frames. The
    // layout listener re-attempts so whichever signal comes first (attach of
    // an already-laid-out view, or the first layout after attach) binds once.
    addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
      bindWhenLaidOut()
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached = true
    // A transient Fabric detach scheduled a deferred teardown — cancel it and
    // keep (or re-establish) the live camera instead of churning it.
    teardownRunnable?.let { mainHandler.removeCallbacks(it) }
    teardownRunnable = null
    bindWhenLaidOut()
  }

  /**
   * Single bind entry point: proceeds only when attached AND laid out with a
   * real size. Idempotent — attach + layout-change spam results in one bind.
   */
  private fun bindWhenLaidOut() {
    if (!attached) return
    if (width <= 0 || height <= 0) return // not laid out yet — listener retries
    if (bindInFlight) return
    bindCamera()
  }

  override fun onDetachedFromWindow() {
    attached = false
    // Fabric can detach → re-attach within one commit. Tearing down eagerly
    // would unbind the camera mid-dance AND leave the detector/executor dead
    // for the re-attached view. Defer; re-attach cancels; real unmount runs it.
    val runnable = Runnable { if (!attached) unbindCameraAndReleaseRuntime() }
    teardownRunnable = runnable
    mainHandler.postDelayed(runnable, DETACH_TEARDOWN_DELAY_MS)
    super.onDetachedFromWindow()
  }

  /**
   * Full teardown: unbind the camera AND dispose the per-bind runtime. Only
   * ever reached after the view stays detached past the grace window (real
   * unmount), so nothing live can be holding these resources afterwards.
   */
  private fun unbindCameraAndReleaseRuntime() {
    unbindCamera()
    try {
      detector.close()
    } catch (_: Exception) {
      // Already closed / in-flight tasks simply fail their listeners.
    }
    try {
      analysisExecutor.shutdown()
    } catch (_: Exception) {
      // Already shut down.
    }
    runtimeReleased = true
  }

  private fun bindCamera() {
    if (!attached) return
    if (boundAnalysis != null) return // already bound (Fabric re-attach)
    // Single-owner doctrine during the Track 2b migration (§42.5): while the
    // headless service holds the camera, the legacy view must not bind.
    if (ProctoringCameraService.isActive) {
      emitError("module_owns_camera", "Headless streaming service owns the camera; the view cannot bind.")
      return
    }
    val lifecycleOwner = try {
      appContext.throwingActivity as? LifecycleOwner
    } catch (_: Exception) {
      null
    }
    if (lifecycleOwner == null) {
      emitError("no_activity", "No activity to bind the camera lifecycle to.")
      return
    }
    val generation = ++bindGeneration
    bindInFlight = true
    emitStatus("binding")
    val future = ProcessCameraProvider.getInstance(context)
    cameraProviderFuture = future
    future.addListener({
      try {
        // Abort-stale-bind guards (see class header): a detach, unbind, or
        // newer bind since this listener was queued invalidates it.
        if (generation != bindGeneration) return@addListener
        if (!attached) return@addListener
        if (boundAnalysis != null) return@addListener

        // FRESH runtime per bind: if an earlier teardown closed the detector
        // or shut the executor down, reusing them would silently swallow
        // every frame (camera opens, analyzer never runs).
        ensureRuntime()

        val provider = future.get()

        val preview = Preview.Builder().build().also {
          it.setSurfaceProvider(previewView.surfaceProvider)
        }
        val resolutionSelector = ResolutionSelector.Builder()
          .setResolutionStrategy(
            ResolutionStrategy(
              Size(640, 480),
              ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
            )
          )
          .build()
        val analysis = ImageAnalysis.Builder()
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .setResolutionSelector(resolutionSelector)
          .build()
        analysis.setAnalyzer(analysisExecutor, ::analyzeFrame)

        provider.unbindAll() // this view is the sole camera owner while mounted
        val camera = provider.bindToLifecycle(
          lifecycleOwner,
          CameraSelector.DEFAULT_FRONT_CAMERA,
          preview,
          analysis
        )
        boundPreview = preview
        boundAnalysis = analysis
        boundCamera = camera
        observeCameraState(lifecycleOwner, camera)
        emitStatus("bound")
        armFirstFrameWatchdog(generation)
      } catch (e: Exception) {
        Log.e(TAG, "Camera bind failed", e)
        boundPreview = null
        boundAnalysis = null
        boundCamera = null
        emitError("bind_failed", "${e.javaClass.simpleName}: ${e.message ?: "no message"}")
      } finally {
        // Only the CURRENT bind's listener may clear the in-flight flag; an
        // aborted stale listener must not clear a newer bind's marker.
        if (generation == bindGeneration) bindInFlight = false
      }
    }, mainExecutor)
  }

  /** Set by the full teardown; the next bind rebuilds the runtime. */
  @Volatile
  private var runtimeReleased: Boolean = false

  /** Rebuilds the per-bind runtime if a prior teardown disposed it. */
  private fun ensureRuntime() {
    if (runtimeReleased || analysisExecutor.isShutdown) {
      try {
        detector.close()
      } catch (_: Exception) {
        // Already closed.
      }
      detector = newDetector()
      analysisExecutor = newAnalysisExecutor()
      runtimeReleased = false
    }
  }

  private fun newDetector(): FaceDetector = FaceDetection.getClient(
    FaceDetectorOptions.Builder()
      .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
      .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
      .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
      .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
      .setMinFaceSize(0.08f)
      .enableTracking()
      .build()
  )

  private fun newAnalysisExecutor(): ExecutorService =
    Executors.newSingleThreadExecutor { r -> Thread(r, "proctoring-analysis") }

  private fun unbindCamera() {
    bindGeneration += 1 // abort any bind listener still queued
    cameraProviderFuture?.cancel(false)
    cameraProviderFuture = null
    disarmFirstFrameWatchdog()
    removeCameraStateObserver()
    val preview = boundPreview
    val analysis = boundAnalysis
    boundPreview = null
    boundAnalysis = null
    boundCamera = null
    if (preview == null && analysis == null) return // nothing bound to release
    try {
      val provider = ProcessCameraProvider.getInstance(context).get()
      analysis?.let { provider.unbind(it) }
      preview?.let { provider.unbind(it) }
    } catch (_: Exception) {
      // Provider unavailable during teardown — nothing bound to release.
    }
  }

  /**
   * Surface ASYNC camera failures (device busy, policy disabled, fatal HAL
   * errors). bindToLifecycle succeeding only means the use cases attached;
   * the camera OPEN happens later, and its failure was previously invisible
   * (black preview, no events at all).
   */
  private fun observeCameraState(lifecycleOwner: LifecycleOwner, camera: Camera) {
    val observer = Observer<CameraState> { state ->
      val error = state.error
      when {
        state.type == CameraState.Type.OPEN -> {
          lastCameraPhase = "open"
          emitStatus("open")
        }
        error != null -> {
          lastCameraPhase = "error"
          emitError(
            "camera_state_error",
            "Camera failed to open (code ${error.code}: ${describeCameraStateError(error.code)})"
          )
        }
        else -> {
          lastCameraPhase = state.type.name.lowercase()
        }
      }
    }
    cameraStateObserver = observer
    camera.cameraInfo.cameraState.observe(lifecycleOwner, observer)
  }

  private fun removeCameraStateObserver() {
    val observer = cameraStateObserver ?: return
    val camera = boundCamera ?: return
    try {
      camera.cameraInfo.cameraState.removeObserver(observer)
    } catch (_: Exception) {
      // Camera already released — observer dies with the lifecycle anyway.
    }
    cameraStateObserver = null
  }

  private fun describeCameraStateError(code: Int): String = when (code) {
    CameraState.ERROR_CAMERA_IN_USE -> "camera in use by another client"
    CameraState.ERROR_MAX_CAMERAS_IN_USE -> "device camera limit reached"
    CameraState.ERROR_CAMERA_DISABLED -> "camera disabled by system policy"
    CameraState.ERROR_CAMERA_FATAL_ERROR -> "fatal camera device error"
    CameraState.ERROR_CAMERA_REMOVED -> "camera removed"
    CameraState.ERROR_DO_NOT_DISTURB_MODE_ENABLED -> "do-not-disturb mode blocked the camera"
    CameraState.ERROR_STREAM_CONFIG -> "stream configuration failed"
    else -> "recoverable/other"
  }

  /**
   * If the camera bound but delivers no frames (stuck OPENING, dead HAL
   * stream), say so instead of showing nothing. First frame cancels it.
   */
  private fun armFirstFrameWatchdog(generation: Int) {
    framesSeen = 0
    val runnable = Runnable {
      if (generation == bindGeneration && boundAnalysis != null && framesSeen == 0L) {
        emitError(
          "no_frames",
          "Camera bound but no frames arrived within ${FIRST_FRAME_TIMEOUT_MS / 1000}s " +
            "(last camera phase: $lastCameraPhase, view ${width}x$height)"
        )
      }
    }
    firstFrameWatchdog = runnable
    mainHandler.postDelayed(runnable, FIRST_FRAME_TIMEOUT_MS)
  }

  private fun disarmFirstFrameWatchdog() {
    firstFrameWatchdog?.let { mainHandler.removeCallbacks(it) }
    firstFrameWatchdog = null
  }

  private fun analyzeFrame(proxy: ImageProxy) {
    framesSeen += 1
    if (analysisPaused || inferenceInFlight) {
      proxy.close()
      return
    }
    val now = System.currentTimeMillis()
    if (now - lastAnalysisAt < minIntervalMs) {
      proxy.close()
      return
    }
    val mediaImage = proxy.image
    if (mediaImage == null) {
      proxy.close()
      emitError("frame_unavailable", "Camera frame could not be read")
      return
    }
    lastAnalysisAt = now
    inferenceInFlight = true
    val startedAt = System.currentTimeMillis()
    val rotation = proxy.imageInfo.rotationDegrees
    val width = proxy.width
    val height = proxy.height
    val frameTimestamp = System.currentTimeMillis()
    val meanLuma = computeYuvMeanLuma(proxy)

    detector.process(InputImage.fromMediaImage(mediaImage, rotation))
      .addOnSuccessListener { faces ->
        val inferenceMs = System.currentTimeMillis() - startedAt
        val payload = buildObservationPayload(
          faces = faces,
          imageWidth = width,
          imageHeight = height,
          decodeMs = 0L,
          inferenceMs = inferenceMs,
          startedAt = startedAt,
          meanLuma = meanLuma,
          frameTimestampMs = frameTimestamp
        )
        proxy.close()
        onFrameObservation(payload)
      }
      .addOnFailureListener { e ->
        proxy.close()
        emitError("detect_failed", e.message ?: "ML Kit face detection failed")
      }
      .addOnCompleteListener {
        inferenceInFlight = false
      }
  }

  /**
   * Mean luma over the Y plane (0..255) — the CAMERA_FEED_DARK signal
   * (plan §10.2). Stride-aware sampling: reads a bounded number of rows and
   * columns so the cost stays negligible at any preview resolution.
   */
  private fun computeYuvMeanLuma(proxy: ImageProxy): Double {
    return try {
      val plane = proxy.planes[0]
      val buffer = plane.buffer
      val rowStride = plane.rowStride
      val pixelStride = plane.pixelStride.coerceAtLeast(1)
      val width = proxy.width
      val height = proxy.height
      // Sample ~32x32 points across the frame.
      val stepX = (width / 32).coerceAtLeast(1)
      val stepY = (height / 32).coerceAtLeast(1)
      var total = 0.0
      var count = 0
      for (y in 0 until height step stepY) {
        for (x in 0 until width step stepX) {
          val index = y * rowStride + x * pixelStride
          if (index < buffer.capacity()) {
            total += (buffer.get(index).toInt() and 0xFF)
            count += 1
          }
        }
      }
      if (count > 0) total / count else -1.0
    } catch (_: Exception) {
      -1.0 // sentinel for "unavailable" — sanitized to null on the JS side
    }
  }

  private fun emitError(code: String, message: String) {
    onCameraError(mapOf("code" to code, "message" to message))
  }

  private fun emitStatus(phase: String) {
    onCameraStatus(mapOf("phase" to phase, "viewSize" to "${width}x$height"))
  }

  companion object {
    private const val TAG = "ProctoringSpike"

    /** Generous: covers camera open (~1-2s) + the 3s pacing option. */
    private const val FIRST_FRAME_TIMEOUT_MS = 6_000L

    /**
     * Grace window before a detach is treated as a real unmount. Fabric's
     * attach→detach→re-attach dance completes well inside this; a genuine
     * unmount pays one extra second before the camera LED goes out.
     */
    private const val DETACH_TEARDOWN_DELAY_MS = 1_000L
  }
}
