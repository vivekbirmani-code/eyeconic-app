// Server-authoritative attempt duration for FLAT (non-section-locked)
// quizzes — plan §7.5 (decision D12).
//
// Before this module, only section-locked attempts were enforced server-side
// (sectionStates[].endsAt cascade in utils/sectionLocking.js); a flat quiz's
// deadline lived entirely in the client countdown, so a modified/delayed
// client could submit arbitrarily late and still receive status 'completed'.
//
// One source of truth now:
//   - flat attempts:   durationDeadline = startTime + duration (+grace at
//                      enforcement time), computed at /start on the server.
//   - section-locked:  the sectionStates[].endsAt cascade remains the sole
//                      authority (unchanged — regression-tested).
//
// Enforcement is LAZY (the syncExpiredSections doctrine): every
// attempt-touching request checks the deadline for in_progress flat attempts
// and finalizes overdue ones as auto_submitted BEFORE processing. There is no
// cron; a disconnected student's attempt still ends at the first touch after
// the deadline (or stays in_progress harmlessly until then).
//
// Client clock manipulation is structurally irrelevant: every comparison uses
// server time against a deadline computed from server-stored startTime.

const { isSectionLockEnforced } = require('../sectionLocking');

// Small network grace so a submit fired by an honest client timer at the
// deadline but delayed in transit still lands as on-time (illustrative 30 s,
// plan §7.5). The STORED deadline stays pure (startTime + duration); the
// grace is an enforcement/comparison tolerance only.
const DURATION_GRACE_MS = 30 * 1000;

const toMillis = (minutes) => Number(minutes) * 60 * 1000;

/**
 * Deadline for a flat attempt, computed server-side at /start.
 *
 * @returns {Date|null} null for section-locked attempts (the endsAt cascade
 *          is their authority) or quizzes without a positive duration.
 */
const computeFlatDurationDeadline = (
  { durationMinutes, sectionLockEnabled },
  startTime = new Date()
) => {
  if (sectionLockEnabled === true) return null;
  const minutes = Number(durationMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + toMillis(minutes));
};

const getDurationDeadline = (attempt) => {
  if (!attempt || !attempt.durationDeadline) return null;
  const deadline = new Date(attempt.durationDeadline);
  return Number.isNaN(deadline.getTime()) ? null : deadline;
};

/**
 * True when the attempt carries a server-side flat duration deadline.
 * Only flat attempts ever get one (section-locked attempts keep the cascade),
 * so its presence is the enforcement contract.
 */
const hasDurationDeadline = (attempt) =>
  getDurationDeadline(attempt) !== null && !isSectionLockEnforced(attempt);

/**
 * End of the tolerated submission window: deadline + grace.
 */
const getSubmissionWindowEnd = (attempt) => {
  const deadline = getDurationDeadline(attempt);
  if (!deadline) return null;
  return new Date(deadline.getTime() + DURATION_GRACE_MS);
};

/**
 * True when NOW (server time) is past the deadline + grace. A cheap guard —
 * routes call this before doing any extra work on in_progress attempts.
 */
const isPastSubmissionWindow = (attempt, now = new Date()) => {
  const windowEnd = getSubmissionWindowEnd(attempt);
  if (!windowEnd) return false;
  return now.getTime() > windowEnd.getTime();
};

/**
 * Server-side status decision for a whole-quiz submit (§7.5: the client
 * isAutoSubmit flag is a hint about who INITIATED the request, never the
 * determinant of status).
 *
 *  - within the window: client flag decides (manual → completed,
 *    client-timer auto → auto_submitted) — existing semantics preserved.
 *  - past the window: auto_submitted with a machine-readable duration reason,
 *    regardless of what the client claims.
 *  - attempts without a flat deadline (section-locked / legacy / missing
 *    duration): existing behavior, untouched.
 *
 * @returns {{status: 'completed'|'auto_submitted',
 *            autoSubmitReason: null|{kind: 'duration', deadline: Date,
 *                                     detectedAt: Date}}}
 */
const resolveSubmissionStatus = (attempt, { isAutoSubmit = false, now = new Date() } = {}) => {
  if (hasDurationDeadline(attempt) && isPastSubmissionWindow(attempt, now)) {
    return {
      status: 'auto_submitted',
      autoSubmitReason: {
        kind: 'duration',
        deadline: getDurationDeadline(attempt),
        detectedAt: new Date(now),
      },
    };
  }
  return { status: isAutoSubmit === true ? 'auto_submitted' : 'completed', autoSubmitReason: null };
};

/**
 * Lazy, authoritative flat-duration engine — the mirror of
 * syncExpiredSections for non-section attempts. `filter` selects the attempt
 * (embeds ownership, e.g. {_id, student}); `finalize` is a route-supplied
 * async (attempt, {isAutoSubmit}) => attempt callback that grades and
 * finalizes. finalizeQuizAttempt's internal CAS guarantees exactly one winner
 * when a duration finalize races a manual submit.
 *
 * @returns {{attempt: object|null, finalized: boolean}}
 */
const syncExpiredDuration = async (AttemptModel, filter, options = {}) => {
  const { finalize } = options;

  const attempt = await AttemptModel.findOne(filter);
  if (!attempt) return { attempt: null, finalized: false };
  if (attempt.status !== 'in_progress' || !hasDurationDeadline(attempt)) {
    return { attempt, finalized: false };
  }
  if (!isPastSubmissionWindow(attempt)) {
    return { attempt, finalized: false };
  }

  if (typeof finalize === 'function') {
    // resolveSubmissionStatus inside finalizeQuizAttempt decides the status
    // and builds the {kind:'duration'} autoSubmitReason from server time.
    const finalizedAttempt = await finalize(attempt, { isAutoSubmit: true });
    if (finalizedAttempt) {
      return {
        attempt: finalizedAttempt,
        finalized: finalizedAttempt.status !== 'in_progress',
      };
    }
  }

  const reread = await AttemptModel.findOne(filter);
  return { attempt: reread || attempt, finalized: reread ? reread.status !== 'in_progress' : false };
};

module.exports = {
  DURATION_GRACE_MS,
  computeFlatDurationDeadline,
  hasDurationDeadline,
  getDurationDeadline,
  getSubmissionWindowEnd,
  isPastSubmissionWindow,
  resolveSubmissionStatus,
  syncExpiredDuration,
};
