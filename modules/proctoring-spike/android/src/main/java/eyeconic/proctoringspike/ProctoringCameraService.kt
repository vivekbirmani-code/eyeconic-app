// ProctoringCameraService — the HEADLESS camera-analysis runtime (AI
// Proctoring Track 2b, plan §42.5; migration off the Fabric-view transport).
//
// WHY THIS EXISTS (the recurring `stream:no_frames` failure): the previous
// transport bound CameraX Preview + ImageAnalysis as ONE use-case group
// inside ProctoringCameraView, so the capture session needed the PreviewView
// surface — which arrives from the React Native view tree and, under Fabric
// mount timing on some devices/process generations, never arrived at all.
// CameraX waited on it forever (camera OPEN, zero streams/requests): black
// preview, zero analyzer frames, no error. Three guard rounds could not make
// view timing reliable by construction.
//
// THE FIX IS ARCHITECTURAL: this service binds ImageAnalysis ALONE. No
// Preview use case, no PreviewView, no Fabric layout, no view attachment —
// nothing from the React tree sits on the frame-delivery critical path.
// (Preview becomes a separate, OPTIONAL attachment in a later migration
// step; it must never gate analysis again.)
//
// Ownership: the camera is a SERVICE, not a view. The module's
// startStreaming/stopStreaming functions control its lifetime explicitly; a
// process-wide singleton is honest here because CameraX's own
// ProcessCameraProvider is process-global. The activity's lifecycle is still
// the LifecycleOwner CameraX binds to (auto-pause when the activity stops —
// the same backgrounding semantics the view transport had), but view mount
// churn can no longer start, stop, or stall the stream.
//
// Everything else is the pipeline that already measured ~10 FPS live on the
// Nord (plan §42.4): identical ML Kit options, KEEP_ONLY_LATEST at ~640px,
// stride-sampled Y-plane luma, the same sanitized observation payload via
// FacePayload (no pixels ever cross the bridge), the same status/error codes
// the JS taxonomy already knows (binding/bound/open, no_frames,
// camera_state_error, bind_failed, detect_failed, frame_unavailable).
package eyeconic.proctoringspike

import android.content.Context
import android.util.Log
import android.util.Size
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.common.util.concurrent.ListenableFuture
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

object ProctoringCameraService {

  /**
   * Build/transport generation marker surfaced through getInfo() — lets any
   * screen shot prove WHICH native transport a device is running (the
   * stale-build ambiguity that clouded the 2026-10-01 debugging cannot
   * recur). Bump per transport change.
   */
  const val TRANSPORT_REVISION = "2b-1"

  /** Sanitized observation — identical payload shape to detectFacesJpegBase64. */
  interface Listener {
    fun onObservation(payload: Map<String, Any?>)
    fun onError(code: String, message: String)
    fun onStatus(phase: String)
  }

  @Volatile
  var listener: Listener? = null

  private const val TAG = "ProctoringSpike"

  /** Generous: covers camera open (~1-2s) + the slowest pacing option. */
  private const val FIRST_FRAME_TIMEOUT_MS = 6_000L

  private val mainHandler = Handler(Looper.getMainLooper())
  private val mainExecutor = Executor { command -> mainHandler.post(command) }

  // ===== Bind state. All mutated on the main thread only. =====
  private var detector: FaceDetector = newDetector()
  private var analysisExecutor: ExecutorService = newAnalysisExecutor()

  /** Application context kept from start() — never an activity (no leak). */
  private var appContext: Context? = null
  private var providerFuture: ListenableFuture<ProcessCameraProvider>? = null
  private var boundAnalysis: ImageAnalysis? = null
  private var boundCamera: Camera? = null
  private var cameraStateObserver: Observer<CameraState>? = null
  private var stateOwner: LifecycleOwner? = null

  /** Invalidated by every stop; a bind listener whose generation no longer matches aborts. */
  private var generation = 0
  private var bindInFlight = false

  /** Frames delivered to the analyzer — watchdog input (0 = stream dead). */
  @Volatile
  private var framesSeen = 0L

  /** Last CameraState phase string, for watchdog diagnostics. */
  @Volatile
  private var lastCameraPhase: String = "unknown"

  private var firstFrameWatchdog: Runnable? = null

  /** True while the service holds (or is binding) the camera. Main-thread read. */
  val isActive: Boolean
    get() = boundAnalysis != null || bindInFlight

  // ===== Analysis knobs (set from any Expo module thread). =====
  @Volatile
  var analysisPaused: Boolean = false

  @Volatile
  var minIntervalMs: Long = 250L

  @Volatile
  private var lastAnalysisAt = 0L

  /** One in-flight inference guard — KEEP_ONLY_LATEST already implies this. */
  @Volatile
  private var inferenceInFlight: Boolean = false

  /**
   * Start the analysis-only stream. Idempotent: a second start while running
   * (or binding) keeps the existing stream and just updates the pacing.
   * [onStarted] is invoked exactly once on the main thread — (null, null) on
   * success, (code, message) on failure. Failures also flow through
   * [Listener.onError] so event-only consumers see them.
   */
  fun start(
    context: Context,
    lifecycleOwner: LifecycleOwner,
    minIntervalMs: Long,
    listener: Listener,
    onStarted: ((code: String?, message: String?) -> Unit)?
  ) {
    val appCtx = context.applicationContext
    mainHandler.post {
      this.listener = listener
      this.minIntervalMs = minIntervalMs
      this.analysisPaused = false
      if (boundAnalysis != null || bindInFlight) {
        onStarted?.invoke(null, null) // already streaming — idempotent restart
        return@post
      }
      val gen = ++generation
      bindInFlight = true
      emitStatus("binding")
      val future = ProcessCameraProvider.getInstance(appCtx)
      appContext = appCtx
      providerFuture = future
      future.addListener({
        try {
          if (gen != generation) return@addListener // stop() won the race
          // Fresh runtime per run: a detector/executor disposed by an earlier
          // stop must never silently swallow frames.
          ensureRuntime()
          val provider = future.get()

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
          analysis.setAnalyzer(analysisExecutor) { proxy -> analyzeFrame(proxy) }

          // Sole camera owner while the service runs — evicts any stale
          // use-case bind (e.g. the legacy view path) deterministically.
          provider.unbindAll()
          val camera = provider.bindToLifecycle(
            lifecycleOwner,
            CameraSelector.DEFAULT_FRONT_CAMERA,
            analysis
          )
          boundAnalysis = analysis
          boundCamera = camera
          observeCameraState(lifecycleOwner, camera)
          emitStatus("bound")
          armFirstFrameWatchdog(gen)
          onStarted?.invoke(null, null)
        } catch (e: Exception) {
          Log.e(TAG, "Analysis-only camera bind failed", e)
          boundAnalysis = null
          boundCamera = null
          val message = "${e.javaClass.simpleName}: ${e.message ?: "no message"}"
          emitError("bind_failed", message)
          onStarted?.invoke("bind_failed", message)
        } finally {
          if (gen == generation) bindInFlight = false
        }
      }, mainExecutor)
    }
  }

  /**
   * Stop the stream and release the whole runtime (camera unbind + detector
   * close + executor shutdown — one native handle per run, no leak). The
   * listener is detached FIRST so no callback fires after stop. Idempotent;
   * [onStopped] always runs exactly once on the main thread.
   */
  fun stop(onStopped: (() -> Unit)? = null) {
    mainHandler.post {
      generation += 1 // abort any bind listener still queued
      listener = null // contract: no callbacks after stop
      providerFuture?.cancel(false)
      providerFuture = null
      disarmFirstFrameWatchdog()
      removeCameraStateObserver()
      val analysis = boundAnalysis
      boundAnalysis = null
      boundCamera = null
      val context = appContext
      appContext = null
      if (analysis != null && context != null) {
        try {
          val provider = ProcessCameraProvider.getInstance(context).get()
          provider.unbind(analysis)
        } catch (_: Exception) {
          // Provider unavailable during teardown — nothing left to release.
        }
      }
      releaseRuntime()
      onStopped?.invoke()
    }
  }

  /** Disposes the per-run runtime; the next start() rebuilds it. */
  private fun releaseRuntime() {
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

  private var runtimeReleased: Boolean = false

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

  /**
   * Surface ASYNC camera failures (device busy, policy disabled, fatal HAL
   * errors). bindToLifecycle succeeding only means the use case attached; the
   * camera OPEN happens later and its failure must not be silent.
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
    stateOwner = lifecycleOwner
    camera.cameraInfo.cameraState.observe(lifecycleOwner, observer)
  }

  private fun removeCameraStateObserver() {
    val observer = cameraStateObserver ?: return
    val camera = boundCamera ?: return
    val owner = stateOwner
    cameraStateObserver = null
    stateOwner = null
    if (owner == null) return
    try {
      camera.cameraInfo.cameraState.removeObserver(observer)
    } catch (_: Exception) {
      // Camera already released — observer dies with the lifecycle anyway.
    }
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
   * If the camera bound but delivers no frames, say so instead of showing
   * nothing. The first delivered frame cancels it. This is diagnostics only —
   * it never retries and never hides the failure.
   */
  private fun armFirstFrameWatchdog(gen: Int) {
    framesSeen = 0
    val runnable = Runnable {
      if (gen == generation && boundAnalysis != null && framesSeen == 0L) {
        emitError(
          "no_frames",
          "Camera bound but no frames arrived within ${FIRST_FRAME_TIMEOUT_MS / 1000}s " +
            "(last camera phase: $lastCameraPhase, analysis-only bind — no preview use case)"
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
        emitObservation(payload)
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
   * columns so the cost stays negligible at any analysis resolution.
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

  private fun emitObservation(payload: Map<String, Any?>) {
    listener?.onObservation(payload)
  }

  private fun emitError(code: String, message: String) {
    listener?.onError(code, message)
  }

  private fun emitStatus(phase: String) {
    listener?.onStatus(phase)
  }
}
