/**
 * Phase 0 CV/ML feasibility spike — frame sanitization + classification (pure).
 * SPIKE ONLY. This module never imports expo/native code so it is fully
 * unit-testable in the root ts-jest (node) environment.
 *
 * Design notes:
 * - Every field coming off the native bridge is treated as untrusted: the
 *   sanitizer clamps/defaults instead of throwing, and flags `sanitized` so the
 *   spike report can count malformed frames (plan Step 10: "malformed detector
 *   output" must not crash or silently corrupt results).
 * - Thresholds below are ILLUSTRATIVE spike parameters (plan rule of thumb) —
 *   they shape Phase 0 observations only and are not production thresholds.
 */

import type {
  FaceCountClass,
  FaceVisibilityClass,
  HeadPoseBand,
  SpikeFrameResult,
  SpikeNativeFace,
  SpikeRawFrame,
} from './types';

export interface ClassifyThresholds {
  /** Face long-edge/image long-edge below which a face is 'small'. */
  minFaceRatio: number;
  /** Fraction of the box allowed outside the frame before visibility is 'partial'. */
  edgeClipFraction: number;
  /** |yaw| beyond which head pose is 'extreme'; half of it is 'turned'. */
  extremeYawDeg: number;
  extremePitchDeg: number;
}

export const DEFAULT_CLASSIFY_THRESHOLDS: ClassifyThresholds = {
  minFaceRatio: 0.12,
  edgeClipFraction: 0.1,
  extremeYawDeg: 50,
  extremePitchDeg: 40,
};

function toFiniteNumber(value: unknown, fallback: number | null = null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number | null): number | null {
  if (value === null) return null;
  return Math.min(1, Math.max(0, value));
}

/** Sanitize one native face record into a trusted shape (never throws). */
function sanitizeFace(raw: unknown): { face: SpikeNativeFace; repaired: boolean } {
  let repaired = false;
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const rawBox = (source.box && typeof source.box === 'object' ? source.box : {}) as Record<string, unknown>;
  let left = toFiniteNumber(rawBox.left);
  let top = toFiniteNumber(rawBox.top);
  let right = toFiniteNumber(rawBox.right);
  let bottom = toFiniteNumber(rawBox.bottom);
  if (left === null || top === null || right === null || bottom === null) {
    repaired = true;
    left = left ?? 0;
    top = top ?? 0;
    right = right ?? 0;
    bottom = bottom ?? 0;
  }
  // Normalize inverted boxes without failing.
  const box = {
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    right: Math.max(left, right),
    bottom: Math.max(top, bottom),
  };

  const landmarks: SpikeNativeFace['landmarks'] = {};
  const rawLandmarks =
    source.landmarks && typeof source.landmarks === 'object'
      ? (source.landmarks as Record<string, unknown>)
      : {};
  let landmarksBroken = false;
  for (const [name, value] of Object.entries(rawLandmarks)) {
    if (value === null || value === undefined) {
      landmarks[name as keyof SpikeNativeFace['landmarks']] = null;
      continue;
    }
    const pos = value as Record<string, unknown>;
    const x = toFiniteNumber(pos?.x);
    const y = toFiniteNumber(pos?.y);
    if (x === null || y === null) {
      landmarksBroken = true;
      landmarks[name as keyof SpikeNativeFace['landmarks']] = null;
    } else {
      landmarks[name as keyof SpikeNativeFace['landmarks']] = { x, y };
    }
  }
  if (landmarksBroken) repaired = true;

  const face: SpikeNativeFace = {
    box,
    eulerX: toFiniteNumber(source.eulerX),
    eulerY: toFiniteNumber(source.eulerY),
    eulerZ: toFiniteNumber(source.eulerZ),
    trackingId: toFiniteNumber(source.trackingId),
    leftEyeOpenProbability: clamp01(toFiniteNumber(source.leftEyeOpenProbability)),
    rightEyeOpenProbability: clamp01(toFiniteNumber(source.rightEyeOpenProbability)),
    smilingProbability: clamp01(toFiniteNumber(source.smilingProbability)),
    landmarks,
  };
  return { face, repaired };
}

/** Fraction of the face box lying outside the image bounds (0..1). */
export function boxClipFraction(face: SpikeNativeFace, width: number, height: number): number {
  const boxW = Math.max(0, face.box.right - face.box.left);
  const boxH = Math.max(0, face.box.bottom - face.box.top);
  if (width <= 0 || height <= 0 || boxW <= 0 || boxH <= 0) return 1;
  const insideW =
    Math.min(face.box.right, width) - Math.max(face.box.left, 0);
  const insideH =
    Math.min(face.box.bottom, height) - Math.max(face.box.top, 0);
  const insideArea = Math.max(0, insideW) * Math.max(0, insideH);
  const boxArea = boxW * boxH;
  return boxArea <= 0 ? 1 : 1 - insideArea / boxArea;
}

function headPoseBand(
  face: SpikeNativeFace | null,
  thresholds: ClassifyThresholds
): { band: HeadPoseBand; yaw: number | null; pitch: number | null; roll: number | null } {
  if (!face) {
    return { band: 'unknown', yaw: null, pitch: null, roll: null };
  }
  const yaw = face.eulerY;
  const pitch = face.eulerX;
  const roll = face.eulerZ;
  if (yaw === null && pitch === null) {
    return { band: 'unknown', yaw, pitch, roll };
  }
  const extreme =
    (yaw !== null && Math.abs(yaw) >= thresholds.extremeYawDeg) ||
    (pitch !== null && Math.abs(pitch) >= thresholds.extremePitchDeg);
  if (extreme) return { band: 'extreme', yaw, pitch, roll };
  const turned =
    (yaw !== null && Math.abs(yaw) >= thresholds.extremeYawDeg / 2) ||
    (pitch !== null && Math.abs(pitch) >= thresholds.extremePitchDeg / 2);
  return { band: turned ? 'turned' : 'centered', yaw, pitch, roll };
}

/**
 * Synthesize a per-frame quality proxy (0..1). ML Kit exposes no per-face
 * confidence, so we approximate from signal completeness: landmark presence,
 * eye-probability availability. This is explicitly a proxy, not a model score.
 */
function qualityProxy(faces: SpikeNativeFace[]): number {
  if (faces.length === 0) return 0;
  const perFace = faces.map((face) => {
    const present = Object.values(face.landmarks).filter((p) => p !== null).length;
    const landmarkScore = present / 10;
    const eyeScore =
      ((face.leftEyeOpenProbability ?? 0.5) >= 0 || (face.rightEyeOpenProbability ?? 0.5) >= 0) ? 1 : 0.5;
    return 0.8 * landmarkScore + 0.2 * eyeScore;
  });
  return perFace.reduce((a, b) => a + b, 0) / perFace.length;
}

/**
 * Sanitize + classify one raw frame from the camera loop.
 * ALWAYS returns a SpikeFrameResult — malformed native output degrades to a
 * 'none' classification with `sanitized: true`, never an exception.
 */
export function classifyFrame(
  raw: SpikeRawFrame,
  frameIndex: number,
  tsMs: number,
  thresholds: ClassifyThresholds = DEFAULT_CLASSIFY_THRESHOLDS
): SpikeFrameResult {
  const native = raw.native ?? ({} as SpikeRawFrame['native']);
  let width = toFiniteNumber(native.imageWidth, 0) ?? 0;
  let height = toFiniteNumber(native.imageHeight, 0) ?? 0;
  let sanitized = false;
  if (width <= 0 || height <= 0) {
    sanitized = true;
    width = Math.max(width, 1);
    height = Math.max(height, 1);
  }

  let faces: SpikeNativeFace[] = [];
  if (Array.isArray(native.faces)) {
    const repaired = native.faces.map((f) => sanitizeFace(f));
    faces = repaired.map((r) => r.face);
    if (repaired.some((r) => r.repaired)) sanitized = true;
  } else {
    sanitized = true;
  }

  const faceCountClass: FaceCountClass =
    faces.length === 0 ? 'none' : faces.length === 1 ? 'one' : 'multiple';

  let visibility: FaceVisibilityClass;
  if (faces.length === 0) {
    visibility = 'none';
  } else if (faces.length > 1) {
    visibility = 'multiple';
  } else {
    const face = faces[0];
    const longEdge = Math.max(width, height);
    const boxLong = Math.max(face.box.right - face.box.left, face.box.bottom - face.box.top);
    const ratio = longEdge > 0 ? boxLong / longEdge : 0;
    const clipped = boxClipFraction(face, width, height);
    if (ratio < thresholds.minFaceRatio) {
      visibility = 'small';
    } else if (clipped > thresholds.edgeClipFraction) {
      visibility = 'partial';
    } else {
      visibility = 'ok';
    }
  }

  const largestFaceRatio =
    faces.length === 0
      ? null
      : Math.max(
          ...faces.map((f) => {
            const longEdge = Math.max(width, height);
            const boxLong = Math.max(f.box.right - f.box.left, f.box.bottom - f.box.top);
            return longEdge > 0 ? boxLong / longEdge : 0;
          })
        );

  // Camera-health darkness signal (§10.2): sanitize the native mean luma into
  // a trustworthy 0..255 number, or null when absent/out of range (older
  // builds, native failure sentinel). Never throws on malformed input.
  const rawLuma = toFiniteNumber(native.meanLuma, null);
  const meanLuma = rawLuma !== null && rawLuma >= 0 && rawLuma <= 255
    ? Math.round(rawLuma * 10) / 10
    : null;

  // Primary face for pose = the largest box (most likely the subject).
  const primary =
    faces.length === 0
      ? null
      : faces.reduce((best, f) => {
          const area = (f: SpikeNativeFace) =>
            (f.box.right - f.box.left) * (f.box.bottom - f.box.top);
          return area(f) > area(best) ? f : best;
        });

  return {
    frameIndex,
    tsMs,
    faceCount: faces.length,
    faceCountClass,
    visibility,
    headPose: headPoseBand(primary, thresholds),
    landmarkCount:
      faces.length === 0
        ? 0
        : Math.round(
            faces.reduce(
              (acc, f) =>
                acc + Object.values(f.landmarks).filter((p) => p !== null).length,
              0
            ) / faces.length
          ),
    qualityProxy: qualityProxy(faces),
    largestFaceRatio,
    latencies: {
      captureMs: toFiniteNumber(raw.captureMs, 0) ?? 0,
      decodeMs: toFiniteNumber(native.decodeMs, 0) ?? 0,
      inferenceMs: toFiniteNumber(native.inferenceMs, 0) ?? 0,
    },
    meanLuma,
    sanitized,
  };
}
