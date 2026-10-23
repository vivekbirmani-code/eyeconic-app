// Proctoring timeline assembly (plan §25.3) — the chronological review
// surface shared by EVERY reader of a session's story: the admin/owner
// timeline route (routes/proctoringEvents.js) and the public guest-owner
// timeline route (routes/publicProctoring.js). ServerAt-ordered episode rows
// (one per episode, never per frame), the derived violations, warnings/
// auto-submit system actions, and the session summary (frozen copy for
// closed sessions, live rollup otherwise). Structured observations only —
// no images exist anywhere (§4.4).
//
// Access control stays with the CALLING route (owner/admin/mentor rules
// differ per surface); this module only assembles what a resolved attempt +
// session are allowed to reveal to someone who passed those checks.

const ProctoringEvent = require('../../models/ProctoringEvent');
const ProctoringViolation = require('../../models/ProctoringViolation');
const { computeSessionSummary } = require('./summary');

/**
 * Assembles the timeline payload for an attempt + its (resolved, non-null)
 * session. `attempt.proctoringSnapshot` must exist (callers gate on it).
 *
 * @returns {Promise<object>} the `timeline` object — { session, attemptStatus,
 *          autoSubmitReason, summary, events, violations }
 */
const assembleProctoringTimeline = async (attempt, session) => {
  const [events, violations] = await Promise.all([
    ProctoringEvent.find({ session: session._id })
      .sort({ serverAt: 1, _id: 1 })
      .select('type category severity source confidence openedAt closedAt durationMs serverAt metadata actionTaken')
      .lean(),
    ProctoringViolation.find({ session: session._id })
      .sort({ countedAt: 1 })
      .select('ruleId reliability countedAt actionTaken eventRefs review')
      .lean(),
  ]);

  // Closed sessions serve their FROZEN summary; live sessions roll up on
  // demand (the freeze happens on the finalize winner branch).
  const summary = (session.status === 'CLOSED' || session.status === 'CLOSED_FAILED') && session.summary
    ? session.summary
    : (await computeSessionSummary(session, {
      policy: attempt.proctoringSnapshot?.policy || {},
    })).summary;

  return {
    session: {
      id: session._id,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt || null,
      integrityStatus: session.integrityStatus ?? 'pending',
      ...(session.review?.status ? { review: session.review } : {}),
      ...(session.reviewAdjustedScore?.score !== undefined
        ? { reviewAdjustedScore: session.reviewAdjustedScore }
        : {}),
      lastSeenAt: session.sessionHealth?.lastSeenAt || null,
      deterrence: session.deterrence?.screenCapturePrevention || null,
      integrity: session.integrity || {},
    },
    attemptStatus: attempt.status,
    autoSubmitReason: attempt.autoSubmitReason || null,
    summary,
    events,
    violations,
  };
};

module.exports = { assembleProctoringTimeline };
