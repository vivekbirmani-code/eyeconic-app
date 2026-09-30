// Shared ML Kit face-result serialization (AI Proctoring plan §17, §24).
//
// ONE payload shape serves both detector entry points — the base64 still
// path (detectFacesJpegBase64, precheck) and the streaming ImageAnalysis
// path (ProctoringCameraView, the taking screen). Position/angle/probability
// data only: no pixels, bitmaps, or frames ever cross the bridge (§4.4 —
// nothing is recorded or stored).
package eyeconic.proctoringspike

import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceLandmark

// Landmark types reported back to JS (position only, no pixels). The full
// LANDMARK_MODE_ALL set is enabled on the detector; we forward a stable subset
// to keep the bridge payload small. Null entries mean "landmark not detected".
val REPORTED_LANDMARKS: Map<String, Int> = mapOf(
  "leftEye" to FaceLandmark.LEFT_EYE,
  "rightEye" to FaceLandmark.RIGHT_EYE,
  "noseBase" to FaceLandmark.NOSE_BASE,
  "mouthLeft" to FaceLandmark.MOUTH_LEFT,
  "mouthRight" to FaceLandmark.MOUTH_RIGHT,
  "mouthBottom" to FaceLandmark.MOUTH_BOTTOM,
  "leftEar" to FaceLandmark.LEFT_EAR,
  "rightEar" to FaceLandmark.RIGHT_EAR,
  "leftCheek" to FaceLandmark.LEFT_CHEEK,
  "rightCheek" to FaceLandmark.RIGHT_CHEEK,
)

/** Serializes one ML Kit face to the stable bridge shape. */
fun buildFacePayload(face: Face): Map<String, Any?> {
  return mapOf(
    "box" to mapOf(
      "left" to face.boundingBox.left,
      "top" to face.boundingBox.top,
      "right" to face.boundingBox.right,
      "bottom" to face.boundingBox.bottom
    ),
    "eulerX" to face.headEulerAngleX,
    "eulerY" to face.headEulerAngleY,
    "eulerZ" to face.headEulerAngleZ,
    "trackingId" to face.trackingId,
    "leftEyeOpenProbability" to face.leftEyeOpenProbability,
    "rightEyeOpenProbability" to face.rightEyeOpenProbability,
    "smilingProbability" to face.smilingProbability,
    "landmarks" to REPORTED_LANDMARKS.mapValues { (_, type) ->
      face.getLandmark(type)?.position?.let { pos ->
        mapOf("x" to pos.x, "y" to pos.y)
      }
    }
  )
}

/** Serializes a full observation (faces + timing + luma) for the bridge. */
fun buildObservationPayload(
  faces: List<Face>,
  imageWidth: Int,
  imageHeight: Int,
  decodeMs: Long,
  inferenceMs: Long,
  startedAt: Long,
  meanLuma: Double,
  frameTimestampMs: Long
): Map<String, Any?> {
  return mapOf(
    "tier" to SPIKE_TIER,
    "imageWidth" to imageWidth,
    "imageHeight" to imageHeight,
    "faceCount" to faces.size,
    "faces" to faces.map { buildFacePayload(it) },
    "decodeMs" to decodeMs,
    "inferenceMs" to inferenceMs,
    "totalNativeMs" to (System.currentTimeMillis() - startedAt),
    "meanLuma" to meanLuma,
    "frameTimestampMs" to frameTimestampMs
  )
}
