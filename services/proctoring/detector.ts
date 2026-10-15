/**
 * Face-readiness detector boundary (AI Proctoring plan §5.4, §8.4).
 *
 * CLEAN SWAPPABLE ABSTRACTION: precheck (and later phases) program against
 * `FaceReadinessDetector` only. The current implementation reuses the Phase 0
 * spike's Tier A integration — ML Kit face detection via the local
 * `modules/proctoring-spike` native module + the spike's pure frame
 * classifier — WITHOUT modifying any spike code. Phase 0 real-device
 * validation is still pending, so Tier A is NOT production-approved; when
 * Phase 3 selects the production detector tier, only the factory below
 * changes — every consumer keeps calling the same interface.
 *
 * This boundary is intentionally tiny: readiness classification only
 * (zero/one/multiple faces + basic visibility). No gaze, no tracking, no
 * enforcement, no storage — those do not exist in this phase.
 */

import {
  isProctoringSpikeNativeAvailable,
  nativeDetectFaces,
} from '../../modules/proctoring-spike/src';
import { classifyFrame } from '../proctoringSpike/classifyFrame';
import type { FaceCountClass, FaceVisibilityClass } from '../proctoringSpike/types';

export type { FaceCountClass, FaceVisibilityClass };

/** Result of classifying one captured frame for readiness. */
export interface FaceReadinessFrame {
  faceCountClass: FaceCountClass;
  visibility: FaceVisibilityClass;
  /**
   * Phase 5 (D11): the primary face's head pose (deg) — present exactly when
   * the classifier had a single face to measure; null otherwise. Feeds the
   * precheck attention-baseline derivation; never any decision.
   */
  headPose: { yaw: number | null; pitch: number | null; roll: number | null } | null;
}

export interface FaceReadinessDetector {
  /** Tier label for diagnostics (which Phase 0 tier is wired in). */
  readonly tier: string;
  /** True when the underlying native detector is actually available. */
  readonly available: boolean;
  /**
   * Classifies one base64 JPEG frame. Throws only on unrecoverable
   * per-frame failures (callers treat a throw as a transient frame error,
   * never as a student failure).
   */
  detectFrame(base64Jpeg: string): Promise<FaceReadinessFrame>;
}

/**
 * Tier A implementation — the Phase 0 spike's ML Kit wrapper. `detectFrame`
 * mirrors the spike's per-stage contract: one snapshot frame in, one
 * sanitized classification out.
 */
export function createMlKitFaceReadinessDetector(): FaceReadinessDetector {
  return {
    tier: 'mlkit-face-detection',
    available: isProctoringSpikeNativeAvailable(),
    async detectFrame(base64Jpeg: string): Promise<FaceReadinessFrame> {
      const native = await nativeDetectFaces(base64Jpeg, { maxDim: 640 });
      const classified = classifyFrame({ native, captureMs: 0 }, 0, Date.now());
      return {
        faceCountClass: classified.faceCountClass,
        visibility: classified.visibility,
        headPose: classified.faceCountClass === 'one'
          ? {
            yaw: classified.headPose.yaw,
            pitch: classified.headPose.pitch,
            roll: classified.headPose.roll,
          }
          : null,
      };
    },
  };
}

/**
 * Default detector for the precheck flow. When the native module is missing
 * (Expo Go, web, iOS) the detector reports unavailable — the precheck then
 * classifies camera detection as UNSUPPORTED, honestly, rather than faking
 * results (never fake CV output).
 */
export function createDefaultFaceReadinessDetector(): FaceReadinessDetector | null {
  const detector = createMlKitFaceReadinessDetector();
  return detector.available ? detector : null;
}

// ===== Phase 3 — production frame detector (plan §6.3 detectors/) ==========
//
// The runtime engine (services/proctoring/engine.ts) drives the SAME Tier A
// binding through its raw contract: base64 JPEG in, native result out. The
// reused CameraLoop performs sanitization/classification (classifyFrame), so
// this boundary stays a one-line transport — Phase 0 validation status is
// unchanged: Tier A is wired in, NOT yet production-validated (device
// runbook pending). Swapping tiers later changes only this factory.

/** Raw frame detector used by the runtime engine loop. */
export interface ProctoringFrameDetector {
  readonly tier: string;
  readonly available: boolean;
  detectRaw(base64Jpeg: string): Promise<import('../proctoringSpike/types').SpikeNativeDetectResult>;
}

export function createProctoringFrameDetector(): ProctoringFrameDetector {
  return {
    tier: 'mlkit-face-detection',
    available: isProctoringSpikeNativeAvailable(),
    async detectRaw(base64Jpeg: string) {
      return nativeDetectFaces(base64Jpeg, { maxDim: 640 });
    },
  };
}

// Pure failure classification lives in failureClassifier.ts (no expo imports)
// so the engine and its tests stay node-environment clean.
export { isDetectorFailureError } from './failureClassifier';
