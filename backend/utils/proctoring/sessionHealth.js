// Pure session-health helpers for heartbeat-gap detection (plan §16, §7.4 —
// Phase 4).
//
// Heartbeat is a health signal, never an honesty proof (§16.1): a gap says the
// client stopped communicating, not why. Gaps are computed LAZILY at the next
// accepted contact (the syncExpiredSections doctrine — no always-on cron): the
// caller passes the PRE-UPDATE sessionHealth.lastSeenAt plus the frozen
// timeout, and this layer decides whether a HEARTBEAT_GAP episode and a
// DEGRADED→ACTIVE transition pair must be recorded before lastSeenAt moves
// forward.
//
// Frozen policy values (defaults.js, locked onto the attempt at /start):
// heartbeatIntervalMs 30000, timeoutMs 90000, onProlongedOutage 'record'.
// Phase 4 RECORDS gaps only — no warning, no auto-submit (acting would need
// the Phase 6 rules engine AND a non-'record' onProlongedOutage policy, which
// no V1-representable quiz carries).

const { buildEventRecord } = require('./eventIngest');

/** Fallback mirroring the frozen sessionHealth default (defaults.js). */
const DEFAULT_TIMEOUT_MS = 90000;

/**
 * Computes the heartbeat gap, if any, implied by a new contact.
 *
 * Returns null when:
 *  - lastSeenAt is missing — the startup grace (§16.3): before the first
 *    SESSION_STARTED batch there is nothing to measure a gap FROM, so a crash
 *    right after /start can never produce a spurious gap;
 *  - now - lastSeenAt <= timeoutMs — a temporary transport gap is NOT session
 *    degradation; the frozen timeout (2 × interval + network grace) is exactly
 *    that line (§16.2).
 *
 * Otherwise returns the gap descriptor: openedAt (last contact), degradedAt
 * (when the timeout elapsed — the honest DEGRADED entry time), closedAt (this
 * contact = recovery), and a deterministic idempotency key so concurrent
 * batches measuring the same gap converge to exactly ONE episode (unique
 * {session, idempotencyKey} index) and only one of them records the
 * transitions.
 *
 * @param {{lastSeenAt?: Date|null, timeoutMs?: number, now: Date, sessionId: string}} input
 * @returns {null|{openedAt: Date, degradedAt: Date, closedAt: Date, durationMs: number,
 *            timeoutMs: number, idempotencyKey: string}}
 */
const computeHeartbeatGap = ({ lastSeenAt, timeoutMs, now, sessionId }) => {
  if (!lastSeenAt) return null;
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const last = new Date(lastSeenAt).getTime();
  const at = now.getTime();
  if (!Number.isFinite(last) || at - last <= timeout) return null;

  return {
    openedAt: new Date(last),
    degradedAt: new Date(last + timeout),
    closedAt: now,
    durationMs: at - last,
    timeoutMs: timeout,
    idempotencyKey: `hbgap:${sessionId}:${last}`,
  };
};

/**
 * Shapes the server-generated HEARTBEAT_GAP event record (registry: technical,
 * source 'system'). No client claim is involved — this reuses the single
 * record-shaping path (buildEventRecord) so server-owned fields stay computed
 * in exactly one place.
 *
 * @param {{gap: object, session: object, attempt: object, quizId: *}} input
 * @returns {object} the ProctoringEvent document to insert
 */
const buildGapEventRecord = ({ gap, session, attempt, quizId }) => buildEventRecord(
  {
    source: 'system',
    openedAt: gap.openedAt,
    closedAt: gap.closedAt,
    // Threshold used at emission time (§19.5: events store the policy values
    // they were judged against — review context).
    metadata: { timeoutMs: gap.timeoutMs },
    idempotencyKey: gap.idempotencyKey,
  },
  { type: 'HEARTBEAT_GAP', session, attempt, quizId, now: gap.closedAt }
);

/**
 * The §7.4 transition pair for a recorded gap: the server-side DEGRADED flag
 * (entered when the timeout elapsed) and the recovery back to ACTIVE (this
 * contact). Net observable status stays ACTIVE — under the lazy doctrine
 * degradation is an audited interval, never a resting state.
 *
 * @param {object} gap from computeHeartbeatGap
 * @returns {Array<{from: string, to: string, reason: string, at: Date}>}
 */
const buildGapTransitions = (gap) => [
  { from: 'ACTIVE', to: 'DEGRADED', reason: 'heartbeat_timeout', at: gap.degradedAt },
  { from: 'DEGRADED', to: 'ACTIVE', reason: 'heartbeat_recovered', at: gap.closedAt },
];

module.exports = {
  DEFAULT_TIMEOUT_MS,
  computeHeartbeatGap,
  buildGapEventRecord,
  buildGapTransitions,
};
