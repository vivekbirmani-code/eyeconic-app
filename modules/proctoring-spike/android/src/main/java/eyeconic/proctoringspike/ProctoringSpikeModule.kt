// Phase 0 CV/ML feasibility spike (AI Proctoring plan §5) — SPIKE ONLY.
//
// Wraps Google ML Kit Face Detection behind a single JS-callable function that
// accepts a base64 JPEG (as produced by expo-camera's takePictureAsync) and
// returns sanitized face results plus per-stage timings so the spike screen can
// measure decode vs inference latency separately. No frames, bitmaps, or files
// are persisted anywhere; everything stays in memory for the duration of one
// call. This module is not production proctoring code.
package eyeconic.proctoringspike

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

// Tier identifier mirrors the implementation plan §5.4 ladder (Tier A).
const val SPIKE_TIER = "mlkit-face-detection"
const val SPIKE_MLKIT_VERSION = "16.1.7"

class ProctoringSpikeModule : Module() {
  // ACCURATE mode + landmarks + eye-open classification, contours off.
  // These are the options the plan's Tier A assumes; the spike exists to
  // validate them on real devices.
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

  private val decodeExecutor: ExecutorService =
    Executors.newSingleThreadExecutor { r -> Thread(r, "proctoring-spike-decode") }

  // Landmark types reported back to JS live in FacePayload.kt (shared with
  // ProctoringCameraView so the two detector entry points can never drift).

  override fun definition() = ModuleDefinition {
    Name("ProctoringSpike")

    OnDestroy {
      detector.close()
      decodeExecutor.shutdown()
    }

    Constants(
      "tier" to SPIKE_TIER,
      "mlkitVersion" to SPIKE_MLKIT_VERSION,
      "performanceMode" to "ACCURATE",
      "landmarkMode" to "ALL",
      "classificationMode" to "ALL",
      "contourMode" to "NONE",
      "minFaceSize" to 0.08f
    )

    Function("getInfo") {
      mapOf(
        "tier" to SPIKE_TIER,
        "mlkitVersion" to SPIKE_MLKIT_VERSION,
        "available" to true
      )
    }

    // Detect faces in a base64 JPEG. Options map (all optional):
    //   maxDim: Int  — downscale the decoded bitmap so its long edge is <= maxDim
    //                  (default 640; mirrors the plan's ~640px analysis budget).
    // Resolves with { imageWidth, imageHeight, decodeMs, inferenceMs, faces: [...] }
    // Rejects with code ERR_DECODE (bad input) or ERR_DETECT (ML Kit failure).
    AsyncFunction("detectFacesJpegBase64") { base64: String, rawOptions: Map<String, Any?>, promise: Promise ->
      val startedAt = System.currentTimeMillis()
      val maxDim = (rawOptions?.get("maxDim") as? Number)?.toInt() ?: 640
      decodeExecutor.execute {
        try {
          val t0 = System.currentTimeMillis()
          val jpegBytes = decodeBase64Jpeg(base64)
          val bitmap = decodeScaledBitmap(jpegBytes, maxDim)
            ?: throw SpikeException("ERR_DECODE", "Could not decode the JPEG payload")
          val decodeMs = System.currentTimeMillis() - t0

          val inputImage = InputImage.fromBitmap(bitmap, 0)
          val t1 = System.currentTimeMillis()
          detector.process(inputImage)
            .addOnSuccessListener { faces ->
              val inferenceMs = System.currentTimeMillis() - t1
              try {
                val payload = buildObservationPayload(
                  faces = faces,
                  imageWidth = bitmap.width,
                  imageHeight = bitmap.height,
                  decodeMs = decodeMs,
                  inferenceMs = inferenceMs,
                  startedAt = startedAt,
                  meanLuma = computeMeanLuma(bitmap),
                  frameTimestampMs = startedAt
                )
                bitmap.recycle()
                promise.resolve(payload)
              } catch (e: Exception) {
                bitmap.recycle()
                promise.reject("ERR_PAYLOAD", "Failed to serialize detector output: ${e.message}", e)
              }
            }
            .addOnFailureListener { e ->
              bitmap.recycle()
              promise.reject("ERR_DETECT", "ML Kit face detection failed: ${e.message}", e)
            }
        } catch (e: SpikeException) {
          promise.reject(e.code, e.message, e)
        } catch (e: Exception) {
          promise.reject("ERR_DECODE", "Unexpected decode error: ${e.message}", e)
        }
      }
    }

    // ===== Track 2 — the streaming camera-analysis view (production taking
    // screen; plan §5.2/§29.1). One camera owner: Preview + ImageAnalysis in
    // a single bind. Only sanitized observations cross the bridge. =====
    View(ProctoringCameraView::class) {
      Events("onFrameObservation", "onCameraError", "onCameraStatus")

      Prop("paused") { view: ProctoringCameraView, paused: Boolean? ->
        view.analysisPaused = paused ?: false
      }

      Prop("minIntervalMs") { view: ProctoringCameraView, minIntervalMs: Double? ->
        view.minIntervalMs = (minIntervalMs ?: 250.0).toLong().coerceIn(100L, 5000L)
      }
    }
  }

  private fun decodeBase64Jpeg(base64: String): ByteArray {
    val trimmed = base64.trim()
    val payload = if (trimmed.startsWith("data:")) {
      trimmed.substringAfter(",", "")
    } else {
      trimmed
    }
    if (payload.isEmpty()) {
      throw SpikeException("ERR_DECODE", "Empty base64 payload")
    }
    return Base64.decode(payload, Base64.DEFAULT)
  }

  // Two-pass decode: read bounds first, compute inSampleSize so the long edge
  // lands at ~maxDim, then decode once. Keeps the analysis resolution (and ML
  // Kit inference cost) independent of the camera's full capture size.
  private fun decodeScaledBitmap(bytes: ByteArray, maxDim: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    var sample = 1
    while (bounds.outWidth / (sample * 2) >= maxDim || bounds.outHeight / (sample * 2) >= maxDim) {
      sample *= 2
    }
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
  }

  // Mean luma over the (already ≤maxDim) bitmap. Batch-reads pixels once via
  // getPixels — per-pixel getPixel calls are a JNI round-trip each and would
  // dominate the cost at this size.
  private fun computeMeanLuma(bitmap: Bitmap): Double {
    return try {
      val w = bitmap.width
      val h = bitmap.height
      val pixels = IntArray(w * h)
      bitmap.getPixels(pixels, 0, w, 0, 0, w, h)
      var total = 0.0
      for (p in pixels) {
        val r = (p shr 16) and 0xFF
        val g = (p shr 8) and 0xFF
        val b = p and 0xFF
        total += 0.299 * r + 0.587 * g + 0.114 * b
      }
      total / (w * h)
    } catch (_: Exception) {
      -1.0 // sentinel for "unavailable" — sanitized to null on the JS side
    }
  }
}

private class SpikeException(val code: String, message: String) : Exception(message)
