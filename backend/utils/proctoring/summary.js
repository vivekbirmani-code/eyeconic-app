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
    integrityStatus: 'pending',
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
    integrityStatus: 'pending',
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

module.exports = {
  buildSessionSummary,
  computeSessionSummary,
  freezeSessionSummary,
};
