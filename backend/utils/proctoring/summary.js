// Proctoring session summary (plan §25.2, §26.1 — Phase 6/7-lite).
//
// The summary is a REPLAYABLE DERIVATION of the immutable event log + the
// persisted violation set — built pure so tests can assert "rows == summary"
// (the analytics discipline), and frozen onto the session at close so a
// finished attempt's review surface never drifts. Live (unclosed) sessions
// may be summarized on demand; the close-time freeze is the authoritative
// copy. rollup helpers never re-detect anything and never compute policy.

const ProctoringEvent = require('../../models/ProctoringEvent');
const ProctoringViolation = require('../../models/ProctoringViolation');
const ProctoringSession = require('../../models/ProctoringSession');
const { getEventDefinition } = require('./eventRegistry');
const { buildEventTypeAggregatePipeline, computeRiskScore } = require('./riskScore');

/**
 * Pure summary build.
 *
 * @param {object} input
 * @param {object} input.session session doc (startedAt/endedAt/status used)
 * @param {Array<{type: string, category: string}>} input.events session events
 * @param {Array<{ruleId: string}>} input.violations session violations
 * @param {{riskScore: number, riskCategory: string}} input.risk computed risk
 */
const buildSessionSummary = ({ session, events = [], violations = [], risk }) => {
  const eventCounts = {};
  const byCategory = {};
  for (const event of events) {
    eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
    byCategory[event.category] = (byCategory[event.category] || 0) + 1;
  }
  const violationsByRule = {};
  for (const violation of violations) {
    violationsByRule[violation.ruleId] = (violationsByRule[violation.ruleId] || 0) + 1;
  }

  const startedAt = session?.startedAt ? new Date(session.startedAt) : null;
  const endedAt = session?.endedAt ? new Date(session.endedAt) : null;

  return {
    totalEvents: events.length,
    eventCounts,
    byCategory,
    violationCount: violations.length,
    violationsByRule,
    riskScore: risk?.riskScore ?? 0,
    riskCategory: risk?.riskCategory ?? 'normal',
    startedAt: startedAt ? startedAt.toISOString() : null,
    endedAt: endedAt ? endedAt.toISOString() : null,
    monitoredMs: startedAt ? ((endedAt ? endedAt.getTime() : Date.now()) - startedAt.getTime()) : 0,
    // Review outcome (§25.4) — display only; the platform never alters marks.
    integrityStatus: session?.integrityStatus ?? 'pending',
  };
};

/**
 * Computes the session's current risk + summary from the database (aggregate
 * over events + violations) WITHOUT persisting — used by the timeline
 * endpoint for live sessions, by the close-time freeze, and by tests.
 */
const computeSessionSummary = async (session, { policy = {} } = {}) => {
  const [typeAggregates, violations] = await Promise.all([
    ProctoringEvent.aggregate(buildEventTypeAggregatePipeline(session._id)),
    ProctoringViolation.find({ session: session._id }).select('ruleId').lean(),
  ]);
  const risk = computeRiskScore({ policy, typeAggregates, violations });

  // Type-level counts straight from the aggregate; categories resolved
  // through the registry (the single vocabulary import site).
  const eventCounts = {};
  const byCategory = {};
  let totalEvents = 0;
  for (const row of typeAggregates) {
    const count = row.count || 0;
    eventCounts[row._id] = count;
    totalEvents += count;
    const category = getEventDefinition(row._id)?.category || 'technical';
    byCategory[category] = (byCategory[category] || 0) + count;
  }
  const violationsByRule = {};
  for (const violation of violations) {
    violationsByRule[violation.ruleId] = (violationsByRule[violation.ruleId] || 0) + 1;
  }

  const startedAt = session?.startedAt ? new Date(session.startedAt) : null;
  const endedAt = session?.endedAt ? new Date(session.endedAt) : null;

  const summary = {
    totalEvents,
    eventCounts,
    byCategory,
    violationCount: violations.length,
    violationsByRule,
    riskScore: risk.riskScore,
    riskCategory: risk.riskCategory,
    startedAt: startedAt ? startedAt.toISOString() : null,
    endedAt: endedAt ? endedAt.toISOString() : null,
    monitoredMs: startedAt ? ((endedAt ? endedAt.getTime() : Date.now()) - startedAt.getTime()) : 0,
    // Review outcome (§25.4) — display only; the platform never alters marks.
    // Reflects the LIVE session field so a post-close review decision shows.
    integrityStatus: session?.integrityStatus ?? 'pending',
  };
  return { risk, summary };
};

/**
 * Freezes the summary onto the session at close (the finalize winner branch).
 * Best-effort by design: a summary failure is logged, never propagated — the
 * attempt is already finalized and must not roll back over a rollup.
 */
const freezeSessionSummary = async (session, { policy = {} } = {}) => {
  if (!session?._id) return null;
  try {
    const { risk, summary } = await computeSessionSummary(session, { policy });
    await ProctoringSession.updateOne(
      { _id: session._id },
      {
        $set: {
          riskScore: risk.riskScore,
          riskCategory: risk.riskCategory,
          riskBreakdown: risk.riskBreakdown,
          violationsCount: summary.violationCount,
          summary,
        },
      }
    ).exec();
    return { risk, summary };
  } catch (error) {
    console.error('[ProctoringSummary] freeze failed:', error?.message || error);
    return null;
  }
};

/**
 * Per-test proctoring rollup (plan §25.2, Phase 7): one row per proctored
 * attempt in the caller's cohort + test-level aggregates. Reads ONLY the
 * denormalized session fields (§26.1 "cheap summaries") — no per-event
 * aggregation — and derives the export columns listed in §25.2 so the
 * analytics block, CSV and Excel are identical by construction:
 *
 *   riskCategory · totalViolations · focusLossExits (APP_BACKGROUND)
 *   multipleFaceEvents (MULTIPLE_FACES_DETECTED) · faceAbsentTotal
 *   (FACE_NOT_DETECTED) · cameraIncidents (CAMERA_* + MODEL_UNAVAILABLE)
 *   heartbeatGaps (HEARTBEAT_GAP)
 *
 * @param {Array<string|objectid>} attemptIds the cohort's attempt ids
 * (already mentor-scoped by the caller — this layer never re-scopes)
 */
const buildProctoringSummary = async (attemptIds) => {
  const ids = (attemptIds || []).map((id) => id).filter(Boolean);
  if (ids.length === 0) {
    return { attempts: [], rollup: emptyProctoringRollup() };
  }
  const sessions = await ProctoringSession.find({ attempt: { $in: ids } })
    .select('attempt status riskScore riskCategory violationsCount eventCounts integrityStatus startedAt endedAt')
    .lean();

  const attempts = sessions.map((session) => ({
    attemptId: String(session.attempt),
    sessionId: String(session._id),
    sessionStatus: session.status,
    riskScore: session.riskScore ?? 0,
    riskCategory: session.riskCategory ?? 'normal',
    totalViolations: session.violationsCount ?? 0,
    integrityStatus: session.integrityStatus ?? 'pending',
    startedAt: session.startedAt,
    endedAt: session.endedAt || null,
    ...proctoringColumns(session.eventCounts || {}),
  }));

  return { attempts, rollup: rollupProctoringRows(attempts) };
};

/** The §25.2 export columns, derived from one session's denormalized counts. */
const proctoringColumns = (eventCounts) => ({
  focusLossExits: eventCounts.APP_BACKGROUND || 0,
  multipleFaceEvents: eventCounts.MULTIPLE_FACES_DETECTED || 0,
  faceAbsentTotal: eventCounts.FACE_NOT_DETECTED || 0,
  cameraIncidents: (eventCounts.CAMERA_UNAVAILABLE || 0)
    + (eventCounts.CAMERA_PERMISSION_REVOKED || 0)
    + (eventCounts.CAMERA_TRACK_ENDED || 0)
    + (eventCounts.CAMERA_FEED_DARK || 0)
    + (eventCounts.CAMERA_FEED_FROZEN || 0)
    + (eventCounts.MODEL_UNAVAILABLE || 0),
  heartbeatGaps: eventCounts.HEARTBEAT_GAP || 0,
});

const emptyProctoringRollup = () => ({
  proctoredAttempts: 0,
  riskDistribution: { normal: 0, low: 0, moderate: 0, high: 0, critical: 0 },
  totalViolations: 0,
  focusLossExits: 0,
  multipleFaceEvents: 0,
  faceAbsentTotal: 0,
  cameraIncidents: 0,
  heartbeatGaps: 0,
  flaggedAttempts: 0,
  integrityCounts: { pending: 0, clean: 0, reviewed_ok: 0, reviewed_concern: 0 },
});

const rollupProctoringRows = (rows) => {
  const rollup = emptyProctoringRollup();
  for (const row of rows) {
    rollup.proctoredAttempts += 1;
    rollup.riskDistribution[row.riskCategory] = (rollup.riskDistribution[row.riskCategory] || 0) + 1;
    rollup.totalViolations += row.totalViolations;
    rollup.focusLossExits += row.focusLossExits;
    rollup.multipleFaceEvents += row.multipleFaceEvents;
    rollup.faceAbsentTotal += row.faceAbsentTotal;
    rollup.cameraIncidents += row.cameraIncidents;
    rollup.heartbeatGaps += row.heartbeatGaps;
    // "Flagged" = the review queue's definition (§26.1 {quiz, riskCategory}
    // index): any violation or a moderate+ risk band.
    if (row.totalViolations > 0 || ['moderate', 'high', 'critical'].includes(row.riskCategory)) {
      rollup.flaggedAttempts += 1;
    }
    rollup.integrityCounts[row.integrityStatus] = (rollup.integrityCounts[row.integrityStatus] || 0) + 1;
  }
  return rollup;
};

module.exports = {
  buildSessionSummary,
  computeSessionSummary,
  freezeSessionSummary,
  buildProctoringSummary,
};
