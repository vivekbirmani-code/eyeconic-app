// Risk scoring — provisional, transparent, additive (plan §19 — Phase 6).
//
// Scores are computed SERVER-SIDE ONLY, as a replayable derivation of the
// immutable event log + the persisted violation set — never from client
// claims (risk fields are stripped at validation, §24.1). Every contribution
// is listed in riskBreakdown so an admin can answer "why this score?" from
// the UI alone (§19.3 — a score that cannot be explained event-by-event is a
// defect). Attention/head-pose events contribute EXACTLY 0 in V1 (D6): they
// are timeline observations for calibration, not risk inputs.
//
// All weights are provisional starting points (defaults.js) — calibration per
// §19.5 happens later, from real dismissal data.

const {
  DEFAULT_RISK_WEIGHTS,
  RISK_CATEGORY_BANDS,
} = require('./defaults');

const FOCUS_EVENT_TYPES = ['APP_BACKGROUND', 'TAB_HIDDEN', 'WINDOW_BLUR'];
const CAMERA_SUSTAINED_LOSS_TYPES = [
  'CAMERA_FEED_DARK',
  'CAMERA_FEED_FROZEN',
  'CAMERA_TRACK_ENDED',
  'CAMERA_UNAVAILABLE',
];
const ATTENTION_EVENT_TYPES = [
  'HEAD_POSE_EXTREME',
  'HEAD_POSE_REPEATED',
  'ATTENTION_DEVIATION_SUSTAINED',
  'ATTENTION_DEVIATION_REPEATED',
];
const RECOVERY_CREDIT_TYPES = [
  'FACE_NOT_DETECTED',
  'MULTIPLE_FACES_DETECTED',
  ...CAMERA_SUSTAINED_LOSS_TYPES,
];

// Provisional thresholds used only by the scoring arithmetic (the policy
// snapshot owns the enforcement ones): "sustained" camera loss and what
// counts as a prompt recovery. Illustrative, calibrated per §19.5.
const CAMERA_SUSTAINED_LOSS_MS = 60000;
const PROMPT_RECOVERY_MAX_MS = 15000;

const RULE_FOCUS_LOSS = 'focus.loss';

const numberOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/**
 * Mongo aggregate pipeline grouping a session's events by type with their
 * durations — threshold-free so the same pipeline serves ingest-time and
 * close-time scoring regardless of the frozen policy.
 */
const buildEventTypeAggregatePipeline = (sessionId) => [
  { $match: { session: sessionId } },
  {
    $group: {
      _id: '$type',
      count: { $sum: 1 },
      durationsMs: { $push: '$durationMs' },
    },
  },
];

const sum = (values) => values.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);

// Clamp toward the cap regardless of its sign: positive maxTotal is a ceiling
// (Math.min), negative maxTotal is a floor (Math.max) — e.g. recovery credit
// capped at -20 must never push a -15 raw credit further down.
const cap = (value, maxTotal) => {
  if (maxTotal === undefined || maxTotal === null) return value;
  return maxTotal >= 0 ? Math.min(value, maxTotal) : Math.max(value, maxTotal);
};

/**
 * Bands are advisory review-triage labels only (§19.4) — they never alter the
 * score and never imply a verdict.
 */
const categorizeRisk = (score) => {
  const normalized = Math.max(0, Math.round(score));
  for (const band of RISK_CATEGORY_BANDS) {
    if (normalized <= band.max) return band.category;
  }
  return 'critical';
};

/**
 * Pure risk computation.
 *
 * @param {object} input
 * @param {object} [input.policy] frozen policy (prolongedAbsenceMs threshold)
 * @param {Array<{_id: string, count: number, durationsMs: number[]}>} input.typeAggregates
 *   the session's events grouped by type (buildEventTypeAggregatePipeline)
 * @param {Array<{ruleId: string}>} input.violations persisted + new violations
 * @param {object} [input.weights] override for tests; defaults to DEFAULT_RISK_WEIGHTS
 * @returns {{riskScore: number, riskCategory: string,
 *            riskBreakdown: Array<{input: string, events?: number, points: number,
 *                                   contribution: number, note?: string}>}}
 *          riskBreakdown contributions sum EXACTLY to riskScore (test-enforced).
 */
const computeRiskScore = ({
  policy = {},
  typeAggregates = [],
  violations = [],
  weights = DEFAULT_RISK_WEIGHTS,
} = {}) => {
  const byType = {};
  for (const row of typeAggregates) {
    byType[row._id] = {
      count: numberOr(row.count, 0),
      durations: Array.isArray(row.durationsMs) ? row.durationsMs : [],
    };
  }
  const countOf = (type) => byType[type]?.count || 0;
  const totalDurationOf = (type) => sum(byType[type]?.durations || []);
  const countWhere = (types, predicate) => types.reduce(
    (acc, type) => acc + (byType[type]?.durations || []).filter(predicate).length,
    0
  );

  const prolongedMs = numberOr(policy.focusEvents?.prolongedAbsenceMs, 60000);
  const breakdown = [];

  // Multiple faces — probabilistic observation, capped (§19.2).
  breakdown.push({
    input: 'multipleFaces',
    events: countOf('MULTIPLE_FACES_DETECTED'),
    points: weights.multipleFaces.points,
    contribution: Math.min(countOf('MULTIPLE_FACES_DETECTED'), weights.multipleFaces.maxScored)
      * weights.multipleFaces.points,
  });

  // Focus-loss violations — deterministic, per counted violation, capped.
  const focusViolations = violations.filter((v) => v.ruleId === RULE_FOCUS_LOSS).length;
  breakdown.push({
    input: 'focusLossViolation',
    events: focusViolations,
    points: weights.focusLossViolation.points,
    contribution: Math.min(focusViolations, weights.focusLossViolation.maxScored)
      * weights.focusLossViolation.points,
  });

  // Prolonged focus absence (≥ prolongedAbsenceMs in one episode) — the same
  // violation, weighted heavier for review context (§14.2).
  const prolongedEpisodes = countWhere(FOCUS_EVENT_TYPES, (d) => d >= prolongedMs);
  breakdown.push({
    input: 'prolongedFocusAbsence',
    events: prolongedEpisodes,
    points: weights.prolongedFocusAbsence.points,
    contribution: cap(
      prolongedEpisodes * weights.prolongedFocusAbsence.points,
      weights.prolongedFocusAbsence.maxTotal
    ),
  });

  // Face missing — per started 30 s of accumulated absence, capped.
  const absenceBlocks = Math.floor(totalDurationOf('FACE_NOT_DETECTED')
    / weights.faceMissing.perStartedMs);
  breakdown.push({
    input: 'faceMissing',
    events: countOf('FACE_NOT_DETECTED'),
    points: weights.faceMissing.points,
    contribution: cap(
      absenceBlocks * weights.faceMissing.points,
      weights.faceMissing.maxTotal
    ),
    note: `per ${weights.faceMissing.perStartedMs / 1000}s of accumulated absence`,
  });

  // Camera permission revoked — deterministic, once.
  breakdown.push({
    input: 'cameraDisabled',
    events: countOf('CAMERA_PERMISSION_REVOKED'),
    points: weights.cameraDisabled.points,
    contribution: (countOf('CAMERA_PERMISSION_REVOKED') > 0 ? 1 : 0)
      * weights.cameraDisabled.points,
  });

  // Camera dark/frozen/track loss sustained ≥ 60 s — per episode, capped.
  const sustainedCameraEpisodes = countWhere(
    CAMERA_SUSTAINED_LOSS_TYPES,
    (d) => d >= CAMERA_SUSTAINED_LOSS_MS
  );
  breakdown.push({
    input: 'cameraSustainedLoss',
    events: sustainedCameraEpisodes,
    points: weights.cameraSustainedLoss.points,
    contribution: cap(
      sustainedCameraEpisodes * weights.cameraSustainedLoss.points,
      weights.cameraSustainedLoss.maxTotal
    ),
    note: `episodes ≥ ${CAMERA_SUSTAINED_LOSS_MS / 1000}s`,
  });

  // Heartbeat gaps — technical health context, capped.
  breakdown.push({
    input: 'heartbeatGap',
    events: countOf('HEARTBEAT_GAP'),
    points: weights.heartbeatGap.points,
    contribution: cap(
      countOf('HEARTBEAT_GAP') * weights.heartbeatGap.points,
      weights.heartbeatGap.maxTotal
    ),
  });

  // Attention/head-pose — STRUCTURALLY ZERO in V1 (D6). Emitted only when
  // such events exist, to make the exclusion visible in the breakdown.
  const attentionEvents = ATTENTION_EVENT_TYPES.reduce((acc, t) => acc + countOf(t), 0);
  if (attentionEvents > 0) {
    breakdown.push({
      input: 'attentionEvent',
      events: attentionEvents,
      points: 0,
      contribution: 0,
      note: 'record-only in V1 (D6) — excluded from scoring by design',
    });
  }

  // Prompt recovery credit — conditions cleared fast (provisional proxy).
  const recoveries = countWhere(
    RECOVERY_CREDIT_TYPES,
    (d) => d > 0 && d <= PROMPT_RECOVERY_MAX_MS
  );
  breakdown.push({
    input: 'promptRecovery',
    events: recoveries,
    points: weights.promptRecovery.points,
    contribution: cap(
      recoveries * weights.promptRecovery.points,
      weights.promptRecovery.maxTotal
    ),
    note: 'conditions cleared quickly',
  });

  const rawTotal = breakdown.reduce((acc, row) => acc + row.contribution, 0);
  const riskScore = Math.max(0, Math.round(rawTotal));

  return {
    riskScore,
    riskCategory: categorizeRisk(riskScore),
    riskBreakdown: breakdown,
  };
};

module.exports = {
  CAMERA_SUSTAINED_LOSS_MS,
  PROMPT_RECOVERY_MAX_MS,
  buildEventTypeAggregatePipeline,
  categorizeRisk,
  computeRiskScore,
};
