/**
 * Phase 0 browser CV spike — MediaPipe FaceLandmarker detector wrapper.
 *
 * Dev-only diagnostic harness for the public-quiz AI proctoring plan
 * (docs/web-cv-spike-report.md). Tier A-web candidate per the fallback
 * ladder: face count + head pose (facialTransformationMatrixes) as the
 * browser counterpart of the mobile app's ML Kit module.
 *
 * NOT production code: this module exists to answer the spike questions
 * (sustained FPS, load time, latency, pose directionality) with numbers.
 * The production web detector (Phase 3) will reuse what the spike proves
 * and feed the shared pure-TS episode tracker — no pixels ever leave the
 * browser in either case.
 */

import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';

// Keep in sync with the installed @mediapipe/tasks-vision version
// (client/package.json) — the WASM assets on the CDN must match the JS.
const TASKS_VISION_VERSION = '1.1.1';

const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export type DetectorDelegate = 'GPU' | 'CPU';

export interface HeadPose {
  /** degrees, positive = turning right (anchored during device runs) */
  yaw: number;
  /** degrees, positive = looking up */
  pitch: number;
  /** degrees, positive = tilting right */
  roll: number;
}

export interface SpikeFrameResult {
  /** number of detected faces this frame */
  faceCount: number;
  /** head pose of the FIRST face (degrees); null when no face */
  headPose: HeadPose | null;
  /** detectForVideo() wall time in ms */
  latencyMs: number;
  /** performance.now() of the detection */
  atMs: number;
  /**
   * Normalized face-box sizes (long-edge ratio to the frame dimension),
   * largest first — consumed by the monitoring engine for visibility
   * classification (face too small → FACE_OUT_OF_FRAME shaping).
   */
  faceRatios: number[];
  /**
   * Cheap digest of the primary face's landmark geometry (rounded) — the
   * frozen-feed signature the episode tracker compares across frames.
   * Null when no face.
   */
  signature: string | null;
}

export interface SpikeDetectorInit {
  /** ms from start of init to detector ready (wasm + model download) */
  loadMs: number;
  delegate: DetectorDelegate;
}

/**
 * Decompose MediaPipe's facial transformation matrix (4x4, 16 floats) into
 * Euler angles in degrees. MediaPipe hands back column-major data; the
 * rotation sub-matrix is extracted accordingly. Sign conventions are
 * deliberately labeled by aim-reference during the device runs (the same
 * anchored-protocol discipline the mobile spike used) — the spike measures
 * DIRECTIONAL correctness, not absolute calibration.
 */
export function headPoseFromMatrix(m: number[]): HeadPose | null {
  if (!Array.isArray(m) || m.length < 16) return null;
  // Column-major → row-major rotation sub-matrix.
  const r = (row: number, col: number) => m[col * 4 + row];
  const rad = Math.PI / 180;
  const yaw = Math.atan2(r(0, 2), r(2, 2)) / rad;
  const pitch = Math.atan2(-r(1, 2), Math.hypot(r(1, 0), r(1, 1))) / rad;
  const roll = Math.atan2(r(1, 0), r(1, 1)) / rad;
  return {
    yaw: Math.round(yaw * 10) / 10,
    pitch: Math.round(pitch * 10) / 10,
    roll: Math.round(roll * 10) / 10,
  };
}

let landmarker: FaceLandmarker | null = null;
let initializedDelegate: DetectorDelegate | null = null;

/**
 * Initializes the detector (downloads wasm + model). Safe to re-run with a
 * different delegate — the previous instance is closed first.
 */
export async function initSpikeDetector(delegate: DetectorDelegate): Promise<SpikeDetectorInit> {
  const startedAt = performance.now();
  if (landmarker) {
    landmarker.close();
    landmarker = null;
    initializedDelegate = null;
  }
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    // >1 so multi-person scenarios can be measured (parity with ML Kit).
    numFaces: 4,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
  });
  initializedDelegate = delegate;
  return { loadMs: Math.round(performance.now() - startedAt), delegate };
}

export function closeSpikeDetector(): void {
  if (landmarker) {
    landmarker.close();
    landmarker = null;
    initializedDelegate = null;
  }
}

/**
 * Runs one detection on the current video frame. Timestamps must be
 * monotonically increasing for VIDEO mode — callers pass a strictly
 * increasing value (here: max(performance.now(), last + 1)).
 */
export function detectFrame(video: HTMLVideoElement): SpikeFrameResult {
  if (!landmarker || !initializedDelegate) {
    throw new Error('Spike detector not initialized');
  }
  const atMs = Math.max(performance.now(), (detectFrame.lastAtMs || 0) + 1);
  detectFrame.lastAtMs = atMs;
  const t0 = performance.now();
  const result: FaceLandmarkerResult = landmarker.detectForVideo(video, atMs);
  const latencyMs = Math.round((performance.now() - t0) * 10) / 10;
  const faces = result.faceLandmarks ?? [];
  const faceCount = faces.length;

  // Face-box ratios (normalized landmark bounds, long edge), largest first.
  const faceRatios = faces
    .map((landmarks) => {
      let minX = 1; let maxX = 0; let minY = 1; let maxY = 0;
      for (const p of landmarks) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      return Math.max(maxX - minX, maxY - minY);
    })
    .sort((a, b) => b - a)
    .map((r) => Math.round(r * 1000) / 1000);

  // Frozen-feed signature: rounded digest of the primary face's geometry.
  // A statically held pose yields a stable signature across frames; real
  // video noise perturbs it (the tracker's N-identical-signature rule
  // decides what "frozen" means).
  let signature: string | null = null;
  if (faces[0]) {
    const pts = faces[0];
    const step = Math.max(1, Math.floor(pts.length / 24)); // ~24 sample points
    const parts: string[] = [];
    for (let i = 0; i < pts.length; i += step) {
      parts.push(`${Math.round(pts[i].x * 100)},${Math.round(pts[i].y * 100)}`);
    }
    signature = parts.join('|');
  }

  const matrix = result.facialTransformationMatrixes?.[0]?.data;
  return {
    faceCount,
    headPose: matrix ? headPoseFromMatrix(matrix as unknown as number[]) : null,
    latencyMs,
    atMs,
    faceRatios,
    signature,
  };
}
// Module-level monotonic timestamp memory for VIDEO mode.
detectFrame.lastAtMs = 0;
