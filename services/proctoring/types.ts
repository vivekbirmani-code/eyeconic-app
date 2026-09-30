/**
 * Shared client-side types for the production proctoring engine (Phase 3,
 * plan §6.3, §10, §11, §17). Everything here is data — no expo/native imports
 * so the engine stays unit-testable in the root ts-jest (node) environment.
 *
 * The policy type mirrors the FROZEN snapshot the server attaches to the
 * attempt at /start (backend utils/proctoring/policySnapshot.js). The client
 * uses it ONLY to shape observations (debounce windows, pacing); every
 * decision (severity, violations, risk, actions) stays server-side (§24).
 */

/** Frozen proctoring policy snapshot (subset the engine actually reads). */
export interface ProctoringPolicy {
  camera?: 'required' | 'optional';
  focusEvents?: {
    mode?: 'record' | 'warn-only' | 'warn-then-submit';
    toleratedViolations?: number;
    minDurationMs?: number;
    prolongedAbsenceMs?: number;
  };
  multipleFaces?: { mode?: 'record' | 'warn'; minDurationMs?: number };
  facePresence?: { mode?: 'record' | 'warn'; minAbsentMs?: number };
  attention?: { enabled?: boolean; mode?: 'record' };
  cameraHealth?: {
    lossWarnAfterMs?: number;
    lossSubmitAfterMs?: number;
    rejoinAttempts?: number;
  };
  sessionHealth?: {
    heartbeatIntervalMs?: number;
    timeoutMs?: number;
    onProlongedOutage?: 'record' | 'warn' | 'submit';
  };
  screenCapturePrevention?: { enabled?: boolean };
  maxViolations?: number;
  violationAction?: 'warn' | 'submit';
}

/**
 * Event types the engine may emit (registry: plan §17.6). Phase 4 adds the
 * integrity signals the engine transports (APP_BACKGROUND, EXIT_ATTEMPTED);
 * TAB_HIDDEN/WINDOW_BLUR arrive server-side via the legacy tab-switch
 * dual-write (plan §27.5) and are never client-emitted here.
 */
export type ProctoringEventType =
  | 'SESSION_STARTED'
  | 'SESSION_RESUMED'
  | 'SESSION_DEGRADED'
  | 'MODEL_UNAVAILABLE'
  | 'CAMERA_UNAVAILABLE'
  | 'CAMERA_PERMISSION_REVOKED'
  | 'CAMERA_TRACK_ENDED'
  | 'CAMERA_FEED_DARK'
  | 'CAMERA_FEED_FROZEN'
  | 'FACE_NOT_DETECTED'
  | 'FACE_PARTIALLY_VISIBLE'
  | 'FACE_OUT_OF_FRAME'
  | 'MULTIPLE_FACES_DETECTED'
  | 'APP_BACKGROUND'
  | 'EXIT_ATTEMPTED';

/** One finished episode ready for transport (episodes, never frames — §17.1). */
export interface ProctoringEpisodeEvent {
  type: ProctoringEventType;
  /** Epoch ms, client claim — the server stamps authoritative time. */
  openedAt: number;
  /** Epoch ms; undefined for still-open episodes closed at session end. */
  closedAt?: number;
  /** 0..1, required for probabilistic (cv_observation) events only. */
  confidence?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Engine status for UI + diagnostics (plan §10.1 pipeline lifecycle).
 * `degraded` = analysis impaired (camera/detector trouble) — the quiz ALWAYS
 * continues; degradation is a technical state, never a student verdict.
 */
export type ProctoringEngineStatus =
  | 'idle'
  | 'starting'
  | 'monitoring'
  | 'degraded'
  | 'paused'
  | 'stopped';

/** Subset of the spike frame result the engine consumes per analysis frame. */
export interface ProctoringFrameObservation {
  tsMs: number;
  /** Sanitized detected-face count (0 on malformed payloads). */
  faceCount: number;
  faceCountClass: 'none' | 'one' | 'multiple';
  visibility: 'none' | 'ok' | 'partial' | 'small' | 'multiple';
  /** Median landmark-completeness proxy 0..1 (0 when no faces). */
  qualityProxy: number;
  /** Long-edge ratio of the largest face box (null when no faces). */
  largestFaceRatio: number | null;
  /** Sanitized mean frame luma 0..255 (null when unavailable). */
  meanLuma: number | null;
  /** Frame carried malformed native output that had to be sanitized. */
  sanitized: boolean;
}

/** Result of one transport send (mapped from the HTTP outcome by the caller). */
export type ProctoringSendOutcome =
  | { kind: 'accepted'; duplicates: number; floodFlagged?: boolean }
  /** Permanent rejection (400 validation): the batch is dropped, never retried. */
  | { kind: 'permanent_reject'; reason?: string }
  /** The attempt/session is finalized — stop everything, drop the buffer. */
  | { kind: 'session_closed' }
  /** Transient (network / 429 / 5xx): keep the batch, retry later. */
  | { kind: 'retryable'; reason?: string };
