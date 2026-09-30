/**
 * Phase 0 CV/ML feasibility spike — shared types (AI Proctoring plan §5).
 * SPIKE ONLY. These types describe the data flowing through the spike engine;
 * nothing here is production proctoring schema.
 *
 * The `SpikeNative*` types describe the native bridge contract of
 * `modules/proctoring-spike` and live here (not in the module) so the pure
 * engine stays unit-testable under the root ts-jest config, which only
 * includes services/utils/types.
 */

/** Landmark names forwarded by the native module (position only, no pixels). */
export type SpikeLandmarkName =
  | 'leftEye'
  | 'rightEye'
  | 'noseBase'
  | 'mouthLeft'
  | 'mouthRight'
  | 'mouthBottom'
  | 'leftEar'
  | 'rightEar'
  | 'leftCheek'
  | 'rightCheek';

export interface SpikeNativeFace {
  box: { left: number; top: number; right: number; bottom: number };
  /** Head pose Euler angles in degrees (ML Kit). Null if the detector omitted them. */
  eulerX: number | null;
  eulerY: number | null;
  eulerZ: number | null;
  trackingId: number | null;
  /** Eye-open probabilities (classification mode). Null when unavailable. */
  leftEyeOpenProbability: number | null;
  rightEyeOpenProbability: number | null;
  smilingProbability: number | null;
  landmarks: Partial<Record<SpikeLandmarkName, { x: number; y: number } | null>>;
}

export interface SpikeNativeDetectResult {
  tier: string;
  imageWidth: number;
  imageHeight: number;
  faceCount: number;
  faces: SpikeNativeFace[];
  decodeMs: number;
  inferenceMs: number;
  totalNativeMs: number;
  /**
   * Mean luma (0..255) of the downscaled analysis bitmap, computed natively
   * after decode — the camera-health darkness signal (proctoring plan §10.2).
   * Null when the native side could not compute it (older builds / failure).
   */
  meanLuma?: number | null;
}

/** Overall engine status surfaced by the spike screen. */
export type SpikeEngineStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'degraded'
  | 'stopped'
  | 'native-unavailable'
  | 'camera-error';

/** Face-count classification for one frame. */
export type FaceCountClass = 'none' | 'one' | 'multiple';

/** Face visibility/quality classification for one frame. */
export type FaceVisibilityClass = 'none' | 'ok' | 'partial' | 'small' | 'multiple';

/** Head-pose band derived from Euler angles (illustrative bands, plan §13.1). */
export type HeadPoseBand = 'unknown' | 'centered' | 'turned' | 'extreme';

/** A single analyzed frame after sanitization + classification. */
export interface SpikeFrameResult {
  /** Monotonic index assigned by the loop. */
  frameIndex: number;
  /** Loop timestamp (ms, Date.now()) when the frame result was produced. */
  tsMs: number;
  /** Sanitized detected-face count (post-repair; 0 on malformed payloads). */
  faceCount: number;
  faceCountClass: FaceCountClass;
  visibility: FaceVisibilityClass;
  headPose: {
    band: HeadPoseBand;
    yaw: number | null;
    pitch: number | null;
    roll: number | null;
  };
  /** Median absolute landmark count across detected faces (0..10). */
  landmarkCount: number;
  /** Mean detector-side confidence proxy: ML Kit gives no per-face score, so we
   * synthesize one from landmark completeness + eye-probability presence. 0..1. */
  qualityProxy: number;
  /** Long-edge ratio of the largest face box vs the image (0..1). */
  largestFaceRatio: number | null;
  latencies: {
    /** expo-camera takePictureAsync duration (ms). */
    captureMs: number;
    /** Native bitmap decode + downscale (ms). */
    decodeMs: number;
    /** ML Kit detector.process duration (ms). */
    inferenceMs: number;
  };
  /** Sanitized mean frame luma (0..255), null when unavailable/out of range. */
  meanLuma: number | null;
  /** Set when the frame carried malformed detector output that had to be sanitized. */
  sanitized: boolean;
}

/** Raw frame envelope the loop hands to the classifier. */
export interface SpikeRawFrame {
  captureMs: number;
  native: SpikeNativeDetectResult;
}

/** Predefined controlled scenario (Phase 0 test matrix, plan §5.3). */
export interface SpikeScenario {
  id: string;
  label: string;
  /** The face-count class a correctly working detector should stabilize on. */
  expectedFaceCountClass: FaceCountClass;
}

export const SPIKE_SCENARIOS: readonly SpikeScenario[] = [
  { id: 'A_NORMAL_ONE_FACE', label: 'A · Normal — one centered face, indoor light', expectedFaceCountClass: 'one' },
  { id: 'B_NO_FACE', label: 'B · Nobody in frame', expectedFaceCountClass: 'none' },
  { id: 'C_MULTI_FACE_2', label: 'C · Two people in frame', expectedFaceCountClass: 'multiple' },
  { id: 'D_MULTI_FACE_3', label: 'D · Three people in frame', expectedFaceCountClass: 'multiple' },
  { id: 'E_PARTIAL_FACE', label: 'E · Partial face (hand / edge cut)', expectedFaceCountClass: 'one' },
  { id: 'F_EDGE_OF_FRAME', label: 'F · Face near screen edge', expectedFaceCountClass: 'one' },
  { id: 'G_POOR_LIGHTING', label: 'G · Poor lighting / dim room', expectedFaceCountClass: 'one' },
  { id: 'H_BACKLIGHT', label: 'H · Strong backlight', expectedFaceCountClass: 'one' },
  { id: 'I_FACE_FAR', label: 'I · Face far from camera', expectedFaceCountClass: 'one' },
] as const;

/** Per-scenario tally produced by the metrics tracker. */
export interface ScenarioRunSummary {
  scenarioId: string;
  expected: FaceCountClass;
  frames: number;
  matchedFrames: number;
  /** Frames classified with faces when the scenario expects none. */
  falsePositives: number;
  /** Frames classified without (or with too many) faces when one is expected. */
  falseNegatives: number;
  /** frames classified as 'multiple' while expecting 'none' (subset of FPs). */
  multiFaceFalsePositives: number;
  /** Correct-classification ratio across counted frames. */
  accuracy: number | null;
  /**
   * EPISODE-level tally (added 2026-09-16): whether the production debounce
   * logic would have raised the episode this scenario's integrity concern maps
   * to. Frame-level accuracy and episode-level detection are DIFFERENT
   * metrics — production stores/judges episodes only (plan §1/§17.1); the
   * frame-level rate measures raw detector quality.
   */
  episodes: ScenarioEpisodeTally;
  /** Where the frames came from — live camera, or synthetic replay. */
  source: 'live' | 'replay';
  /** Present only on replay runs (synthetic validation metadata). */
  replay?: {
    cadenceMs: number;
    frames: number;
    note: string;
  };
}

/** Production episode types the face scenarios map to (registry §17.6). */
export type SpikeFaceEpisodeType =
  | 'FACE_NOT_DETECTED'
  | 'FACE_PARTIALLY_VISIBLE'
  | 'FACE_OUT_OF_FRAME'
  | 'MULTIPLE_FACES_DETECTED';

/** Episode-level scenario measurement (production-equivalent debounce). */
export interface ScenarioEpisodeTally {
  /** The production DEFAULT thresholds this measurement ran with. */
  thresholds: {
    facePresenceMinAbsentMs: number;
    multipleFacesMinDurationMs: number;
    visibilitySustainMs: number;
  };
  /** Debounced condition openings per production episode type. */
  episodeOpens: Partial<Record<SpikeFaceEpisodeType, number>>;
  /**
   * The episode type this scenario's integrity concern maps to:
   * 'none'→FACE_NOT_DETECTED, 'multiple'→MULTIPLE_FACES_DETECTED, 'one'→null.
   */
  expectedEpisodeType: SpikeFaceEpisodeType | null;
  /** Did ≥1 expected-type episode open? (null when the scenario has none). */
  episodeDetected: boolean | null;
  /** First expected-type open, ms after the scenario's first frame. */
  firstOpenLatencyMs: number | null;
  /**
   * Openings of episode types that would be FALSE signals for this scenario
   * (e.g. a MULTIPLE_FACES episode during a one-face scenario).
   */
  unexpectedEpisodeOpens: number;
}

/** Rolling + session metrics surfaced by the spike screen / report. */
export interface SpikeMetricsSummary {
  frames: number;
  errors: number;
  /** Effective analysis rate over completed frames. */
  effectiveFps: number | null;
  interFrameMs: { mean: number | null; p95: number | null };
  latency: {
    captureMs: { mean: number | null; p95: number | null };
    decodeMs: { mean: number | null; p95: number | null };
    inferenceMs: { mean: number | null; p95: number | null };
  };
  byFaceCountClass: Record<FaceCountClass, number>;
  sanitizedFrames: number;
  uptimeMs: number;
}
