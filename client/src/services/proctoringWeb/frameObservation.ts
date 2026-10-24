/**
 * Web proctoring engine — frame → observation mapping.
 *
 * Converts a MediaPipe FaceLandmarker frame (via the spike wrapper) into the
 * shared `ProctoringFrameObservation` the repo-root EpisodeTracker consumes
 * (the SAME shape the mobile engine feeds it from ML Kit). Classification
 * thresholds mirror services/proctoringSpike/classifyFrame.ts where the
 * observation is decided client-side; episodes/anti-jitter stay in the
 * shared tracker, and every consequence stays server-side.
 */

import type { ProctoringFrameObservation } from '@app-services/proctoring/types';
import type { SpikeFrameResult } from '../proctoringSpike/faceLandmarker';

// Mirrors classifyFrame DEFAULT_CLASSIFY_THRESHOLDS (minFaceRatio).
const MIN_FACE_RATIO = 0.12;

export function toFrameObservation(
  frame: SpikeFrameResult,
  meanLuma: number | null,
  nowMs?: number
): ProctoringFrameObservation {
  const faceCount = Math.max(0, frame.faceCount | 0);
  const faceCountClass = faceCount === 0 ? 'none' : faceCount === 1 ? 'one' : 'multiple';
  const largestRatio = frame.faceRatios[0] ?? null;

  // Visibility classification (mirrors the mobile classifier): multiple
  // faces → 'multiple'; a single face smaller than the floor → 'small';
  // otherwise 'ok' (the web detector exposes no partial-clip geometry —
  // 'partial' is only reachable when no usable face exists).
  let visibility: ProctoringFrameObservation['visibility'];
  if (faceCountClass === 'none') visibility = 'none';
  else if (faceCountClass === 'multiple') visibility = 'multiple';
  else visibility = largestRatio !== null && largestRatio < MIN_FACE_RATIO ? 'small' : 'ok';

  return {
    tsMs: nowMs ?? Date.now(),
    faceCount,
    faceCountClass,
    visibility,
    // Landmark completeness proxy: landmarks present for the primary face
    // ⇒ 1 (the bundled model always returns the full set when a face is
    // detected); 0 when absent.
    qualityProxy: faceCount > 0 ? 1 : 0,
    largestFaceRatio: largestRatio,
    meanLuma,
    sanitized: false,
    headPose: frame.headPose
      ? { yaw: frame.headPose.yaw, pitch: frame.headPose.pitch, roll: frame.headPose.roll }
      : null,
  };
}

/** Frozen-feed signature passthrough (null when no face). */
export const frameSignature = (frame: SpikeFrameResult): string | null => frame.signature;

/**
 * Mean luma 0..255 from a tiny canvas sample of the video frame — the web
 * counterpart of the native module's luma. Coarse on purpose (dark-feed
 * hysteresis enters <15, clears ≥25 — a 32×18 sample is plenty).
 */
export function sampleMeanLuma(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): number | null {
  const w = 32;
  const h = Math.max(1, Math.round((video.videoHeight / Math.max(1, video.videoWidth)) * w)) || 18;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !video.videoWidth) return null;
  canvas.width = w;
  canvas.height = h;
  try {
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let sum = 0;
    const pixels = w * h;
    for (let i = 0; i < data.length; i += 4) {
      // Rec.601 luma — matches the native module's approximation.
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return Math.round((sum / pixels) * 10) / 10;
  } catch {
    return null;
  }
}
