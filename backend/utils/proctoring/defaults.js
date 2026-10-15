// Provisional proctoring policy defaults and risk weights (plan §19.2, §21.2).
//
// EVERY numeric value here is ILLUSTRATIVE AND PROVISIONAL — a starting point
// for empirical calibration (plan §19.5), never a production-approved value.
// Enforcement modes beyond "record" are consumed by later phases; Phase 1 only
// stores, snapshots and validates them.

// Bumped whenever the schema/semantics of the effective policy change so that
// frozen snapshots can be told apart across releases (plan §21.4).
const POLICY_SCHEMA_VERSION = 1;

// V1 lock (plan D6): attention/head-pose observations are RECORD-ONLY. No
// V1-representable policy may escalate them — parseProctoringConfig rejects
// any other value, and the Quiz schema enum contains only this value.
const ATTENTION_MODE_RECORD_ONLY = 'record';

const DEFAULT_PROCTORING_CONFIG = {
  // OPT-IN, default OFF (plan D15). An absent `proctoring` subdoc can never
  // enable proctoring — always read via isQuizProctoringEnabled().
  enabled: false,
  camera: 'required', // 'required' | 'optional'
  focusEvents: {
    // D3 ladder: warn each of the first `toleratedViolations` qualifying
    // episodes, then a final warning, then auto-submit.
    mode: 'warn-then-submit', // 'record' | 'warn-only' | 'warn-then-submit'
    toleratedViolations: 3,
    minDurationMs: 2000, // blips under this floor never count
    prolongedAbsenceMs: 60000,
  },
  multipleFaces: {
    mode: 'warn', // 'record' | 'warn' (submit only via the restricted strict-CV gate, D8 — never a per-quiz value)
    minDurationMs: 3000,
  },
  facePresence: {
    mode: 'warn', // 'record' | 'warn'
    minAbsentMs: 8000,
  },
  attention: {
    enabled: true,
    mode: ATTENTION_MODE_RECORD_ONLY, // LOCKED in V1 (D6)
    // Phase 5 derivation thresholds (plan §13.2 illustrative values —
    // PROVISIONAL until the §19.5 calibration round, like every number in
    // this file). Shaping-only: they govern WHEN a record-only observation
    // episode opens, never any consequence (D6 — mode above stays locked).
    thresholds: {
      // |yaw|/|pitch| beyond this counts as an orient-away segment (feeds
      // HEAD_POSE_REPEATED counting). Half the extreme band, mirroring the
      // spike's 'turned' band.
      turnedDeg: 25,
      // Sustained extreme absolute orientation → HEAD_POSE_EXTREME.
      extreme: { yawDeg: 50, pitchDeg: 50, sustainMs: 5000 },
      // ≥ minEpisodes orient-away segments ≥ minEpisodeMs within windowMs
      // → HEAD_POSE_REPEATED (one event per window-ful).
      repeatedHeadPose: { minEpisodes: 3, minEpisodeMs: 2000, windowMs: 300000 },
      // Deviation from the student's own precheck baseline beyond deg for
      // ≥ sustainMs → ATTENTION_DEVIATION_SUSTAINED.
      deviation: { deg: 35, sustainMs: 4000 },
      // ≥ minEpisodes deviation segments ≥ minEpisodeMs within windowMs
      // → ATTENTION_DEVIATION_REPEATED (one event per window-ful).
      repeatedDeviation: { minEpisodes: 4, minEpisodeMs: 1500, windowMs: 300000 },
      // D11 fallback pad: when NO baseline was captured, deviation is measured
      // from neutral (0°) with deg + fallbackPadDeg — a WIDER tolerance that
      // can only suppress episodes, never add sensitivity. Absolute bands
      // (turned/extreme) never reference the baseline and are never padded.
      fallbackPadDeg: 10,
    },
  },
  cameraHealth: {
    lossWarnAfterMs: 10000,
    lossSubmitAfterMs: 60000,
    rejoinAttempts: 3,
  },
  sessionHealth: {
    heartbeatIntervalMs: 30000,
    timeoutMs: 90000,
    onProlongedOutage: 'record', // 'record' | 'warn' | 'submit'
  },
  screenCapturePrevention: {
    enabled: true, // where technically supported (D13)
  },
  maxViolations: 3,
  violationAction: 'warn', // 'warn' | 'submit' (cross-type counter)
};

// Provisional, transparent, additive risk weights (plan §19.2) — deliberately
// simple, bounded and explainable; NOT scientifically validated. Attention /
// head-pose events contribute exactly 0 in V1 (D6): they are timeline
// observations for calibration, not risk inputs.
const DEFAULT_RISK_WEIGHTS = {
  multipleFaces: { points: 50, maxScored: 2 },
  focusLossViolation: { points: 30, maxScored: 3 },
  prolongedFocusAbsence: { points: 15, maxTotal: 45 },
  faceMissing: { points: 25, perStartedMs: 30000, maxTotal: 75 },
  cameraDisabled: { points: 50, maxScored: 1 },
  cameraSustainedLoss: { points: 40, maxTotal: 80 },
  heartbeatGap: { points: 10, maxTotal: 20 },
  attentionEvent: { points: 0 }, // record-only in V1 (D6) — always 0
  promptRecovery: { points: -5, maxTotal: -20 },
};

// Advisory review-triage bands only (plan §19.4) — they never alter scores
// and never imply a verdict.
const RISK_CATEGORY_BANDS = [
  { category: 'normal', max: 20 },
  { category: 'low', max: 40 },
  { category: 'moderate', max: 60 },
  { category: 'high', max: 80 },
  { category: 'critical', max: Infinity },
];

// ===== Phase 2 — precheck & consent (plan §8, §9) =====

// Short-lived precheck attestation token TTL (plan §8.8). Long enough to read
// the consent screen; short enough that a report cannot be replayed tomorrow.
const PRECHECK_TOKEN_TTL_MS = 30 * 60 * 1000; // illustrative 30 min

// The check ids a precheck report may carry. The registry is the server's
// vocabulary — unknown ids in a report are rejected (§24.1: clients submit
// observations against a server-owned schema, never free-form claims).
const PRECHECK_CHECK_IDS = [
  'device_capability',
  'camera_permission',
  'camera_availability',
  'face_readiness',
  'network',
];

// Statuses a reported check may carry. The SERVER decides the overall verdict
// from these observations — a client never asserts "precheck passed".
const PRECHECK_CHECK_STATUSES = ['PASS', 'RETRYABLE', 'FAIL', 'UNSUPPORTED'];

// PROVISIONAL device floor (plan §8.2, decision D10). This is the Phase 0
// report's working hypothesis (Android 8+ / API 26+), NOT a measured floor —
// it MUST be replaced with the measured values from the Phase 0 on-device
// runbook (docs/phase-0-cv-spike-report.md §24) before Stage 4+ rollout.
// ramMb is enforced only when the client reports it (no reliable RAM source
// ships in the app today; missing values are marked, never guessed).
const PROVISIONAL_DEVICE_FLOOR = {
  platform: 'android',
  minOsApiLevel: 26,
  minRamMb: 3072,
};

// Face-readiness majority rule (§8.3/§8.4): N frames must be captured and a
// strict majority must classify as exactly one reasonably-visible face.
const FACE_READINESS_MIN_FRAMES = 3;

// ===== Phase 3 — event transport + heartbeat (plan §16, §27.2) =====

// Batch ingest bounds (illustrative, plan §27.2): at most 50 episodes per
// batch; a session whose stored event count crosses the flood cap keeps being
// ACCEPTED but is flagged for review — floods are never silently dropped
// (plan §18.6/§24.5).
const EVENT_BATCH_MAX_EVENTS = 50;
const EVENT_FLOOD_SESSION_CAP = 500;

// Events ingest rate limit: 60 batches / minute / student (illustrative,
// plan §27.2). Generous vs the 30 s heartbeat cadence; tight vs floods.
const EVENTS_RATE_LIMIT = { windowMs: 60 * 1000, maxPerWindow: 60 };

// Server-assigned provisional severities per event type (plan §17.3 —
// "server-assigned per policy", never a client claim). Phase 6's rules engine
// consumes policy; this map only labels stored events for review triage.
// Attention/head-pose rows are deliberately 'info' — record-only in V1 (D6).
const PROVISIONAL_EVENT_SEVERITIES = {
  SESSION_STARTED: 'info',
  SESSION_RESUMED: 'info',
  SESSION_CLOSED: 'info',
  SESSION_DEGRADED: 'minor',
  MODEL_UNAVAILABLE: 'minor',
  HEARTBEAT_GAP: 'minor',
  CAMERA_UNAVAILABLE: 'minor',
  CAMERA_PERMISSION_REVOKED: 'moderate',
  CAMERA_TRACK_ENDED: 'minor',
  CAMERA_FEED_DARK: 'minor',
  CAMERA_FEED_FROZEN: 'minor',
  FACE_NOT_DETECTED: 'moderate',
  FACE_PARTIALLY_VISIBLE: 'minor',
  FACE_OUT_OF_FRAME: 'minor',
  MULTIPLE_FACES_DETECTED: 'moderate',
  HEAD_POSE_EXTREME: 'info',
  HEAD_POSE_REPEATED: 'info',
  ATTENTION_DEVIATION_SUSTAINED: 'info',
  ATTENTION_DEVIATION_REPEATED: 'info',
  TAB_HIDDEN: 'minor',
  WINDOW_BLUR: 'minor',
  APP_BACKGROUND: 'moderate',
  APP_INACTIVE: 'info',
  EXIT_ATTEMPTED: 'info',
  WARNING_DELIVERED: 'info',
  AUTO_SUBMITTED: 'info',
  POLICY_ACTION_SKIPPED: 'info',
};

module.exports = {
  POLICY_SCHEMA_VERSION,
  ATTENTION_MODE_RECORD_ONLY,
  DEFAULT_PROCTORING_CONFIG,
  DEFAULT_RISK_WEIGHTS,
  RISK_CATEGORY_BANDS,
  PRECHECK_TOKEN_TTL_MS,
  PRECHECK_CHECK_IDS,
  PRECHECK_CHECK_STATUSES,
  PROVISIONAL_DEVICE_FLOOR,
  FACE_READINESS_MIN_FRAMES,
  EVENT_BATCH_MAX_EVENTS,
  EVENT_FLOOD_SESSION_CAP,
  EVENTS_RATE_LIMIT,
  PROVISIONAL_EVENT_SEVERITIES,
};
