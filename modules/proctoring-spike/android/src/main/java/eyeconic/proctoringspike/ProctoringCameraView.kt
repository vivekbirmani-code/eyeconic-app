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
package eyeconic.proctoringspike

import android.annotation.SuppressLint
import android.content.Context
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
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

  // The SAME options as the module's still-image detector (Tier A, Phase 0).
  private val detector: FaceDetector = FaceDetection.getClient(
    FaceDetectorOptions.Builder()
      .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
      .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
      .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
      .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
      .setMinFaceSize(0.08f)
      .enableTracking()
      .build()
  )

  private val mainHandler = Handler(Looper.getMainLooper())
  private val analysisExecutor: ExecutorService =
    Executors.newSingleThreadExecutor { r -> Thread(r, "proctoring-analysis") }

  private val previewView: PreviewView = PreviewView(context).apply {
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    // The PiP is non-interactive; performance mode keeps it cheap.
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
  }

  private var cameraProviderFuture: ListenableFuture<ProcessCameraProvider>? = null
  private var boundPreview: Preview? = null
  private var boundAnalysis: ImageAnalysis? = null

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
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    bindCamera()
  }

  override fun onDetachedFromWindow() {
    unbindCamera()
    super.onDetachedFromWindow()
  }

  private fun bindCamera() {
    if (boundAnalysis != null) return
    val activity = try {
      appContext.throwingActivity
    } catch (_: Exception) {
      null
    }
    val lifecycleOwner = activity as? LifecycleOwner
    if (lifecycleOwner == null) {
      emitError("no_activity", "No activity to bind the camera lifecycle to.")
      return
    }
    val future = ProcessCameraProvider.getInstance(context)
    cameraProviderFuture = future
    future.addListener({
      try {
        val provider = future.get()
        if (boundAnalysis != null) return@addListener // re-attached meanwhile

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
        provider.bindToLifecycle(
          lifecycleOwner,
          CameraSelector.DEFAULT_FRONT_CAMERA,
          preview,
          analysis
        )
        boundPreview = preview
        boundAnalysis = analysis
      } catch (e: Exception) {
        emitError("bind_failed", e.message ?: "Camera bind failed")
      }
    }, Executor { command -> mainHandler.post(command) })
  }

  private fun unbindCamera() {
    cameraProviderFuture?.cancel(false)
    cameraProviderFuture = null
    try {
      val provider = ProcessCameraProvider.getInstance(context).get()
      boundPreview?.let { provider.unbind(it) }
      boundAnalysis?.let { provider.unbind(it) }
    } catch (_: Exception) {
      // Provider unavailable during teardown — nothing bound to release.
    }
    boundPreview = null
    boundAnalysis = null
  }

  private fun analyzeFrame(proxy: ImageProxy) {
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
}
