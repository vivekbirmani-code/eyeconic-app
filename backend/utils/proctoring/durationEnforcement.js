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
// QUIZ AVAILABILITY WINDOW (product requirement, Oct 2026): the effective
// participation deadline for EVERY attempt shape is
//
//   effectiveDeadline = min(attempt.durationDeadline, participationWindowEnd)
//
// where the window end is quiz.expiryDate for registered-student attempts and
// quiz.publicExpiryDate for guest attempts (public links are governed by the
// link's own expiry — see utils/publicQuizAccess.js). The stored
// durationDeadline stays PURE (startTime + duration, never pre-capped): the
// min() is recomputed at enforcement time from the LIVE quiz document, so an
// admin shortening or extending the window mid-attempt takes effect
// immediately and needs no attempt migration. For section-locked attempts
// (no durationDeadline) the window end alone caps the sectionStates cascade.
//
// Enforcement is LAZY (the syncExpiredSections doctrine): every
// attempt-touching request checks the deadline for in_progress attempts and
// finalizes overdue ones as auto_submitted BEFORE processing. A periodic
// DB-backed sweep (utils/attemptSweep.js) runs the SAME engines so attempts
// of students who never return still materialize for analytics/leaderboards;
// the lazy checks remain the hard gate, so an overdue attempt is never
// answerable while waiting for the sweep.
//
// Client clock manipulation is structurally irrelevant: every comparison uses
// server time against a deadline computed from server-stored startTime.

const { isSectionLockEnforced } = require('../sectionLocking');

// Small network grace so a submit fired by an honest client timer at the
// deadline but delayed in transit still lands as on-time (illustrative 30 s,
// plan §7.5). The STORED deadline stays pure (startTime + duration); the
// grace is an enforcement/comparison tolerance only. The SAME grace applies
// to the quiz-window cutoff — one tolerance, one policy, whichever cap fires.
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
 * The quiz's participation window end for a given attempt mode.
 *  - registered students: quiz.expiryDate (the admin-configured window)
 *  - public guests:       quiz.publicExpiryDate (the link's own expiry —
 *    deliberate product rule, see utils/publicQuizAccess.js)
 * A missing/invalid window end is null (no window cap) — the individual
 * duration deadline then governs alone, exactly as before this field existed.
 */
const getParticipationWindowEnd = (quiz, { publicMode = false } = {}) => {
  if (!quiz) return null;
  const raw = publicMode ? quiz.publicExpiryDate : quiz.expiryDate;
  if (!raw) return null;
  const end = new Date(raw);
  return Number.isNaN(end.getTime()) ? null : end;
};

/**
 * True when the attempt carries a server-side flat duration deadline.
 * Only flat attempts ever get one (section-locked attempts keep the cascade),
 * so its presence is the enforcement contract.
 */
const hasDurationDeadline = (attempt) =>
  getDurationDeadline(attempt) !== null && !isSectionLockEnforced(attempt);

/**
 * The EARLIER of the attempt's individual duration deadline and the quiz's
 * participation window end — the single effective deadline every route and
 * the sweep enforce (registered attempts pass the quiz; guest attempts pass
 * {publicMode: true}). Returns null when neither cap exists (legacy attempts
 * on window-less quizzes keep their historical behavior).
 */
const getEffectiveDeadline = (attempt, quiz, { publicMode = false } = {}) => {
  const duration = getDurationDeadline(attempt);
  const windowEnd = getParticipationWindowEnd(quiz, { publicMode });
  if (duration && windowEnd) return duration.getTime() <= windowEnd.getTime() ? duration : windowEnd;
  return duration || windowEnd || null;
};

/**
 * End of the tolerated submission window: effective deadline + grace. When a
 * quiz is supplied the window end caps the deadline (min semantics); without
 * one this is the pure §7.5 duration window (backward compatible).
 */
const getSubmissionWindowEnd = (attempt, quiz = null, { publicMode = false } = {}) => {
  const effective = getEffectiveDeadline(attempt, quiz, { publicMode });
  if (!effective) return null;
  return new Date(effective.getTime() + DURATION_GRACE_MS);
};

/**
 * True when NOW (server time) is past the effective deadline + grace. A cheap
 * guard — routes call this before doing any extra work on in_progress
 * attempts. Backward compatible: without a quiz this checks the pure
 * duration deadline only (the §7.5 contract existing tests rely on).
 */
const isPastSubmissionWindow = (attempt, now = new Date(), quiz = null, { publicMode = false } = {}) => {
  const windowEnd = getSubmissionWindowEnd(attempt, quiz, { publicMode });
  if (!windowEnd) return false;
  return now.getTime() > windowEnd.getTime();
};

/**
 * True when the QUIZ's participation window itself has closed (window end +
 * grace passed), regardless of any attempt state. This is the whole-quiz
 * cutoff that applies to section-locked attempts too (they carry no flat
 * durationDeadline, so their only cap beyond the section cascade is the
 * window end).
 */
const isPastQuizWindow = (quiz, now = new Date(), { publicMode = false } = {}) => {
  const windowEnd = getParticipationWindowEnd(quiz, { publicMode });
  if (!windowEnd) return false;
  return now.getTime() > new Date(windowEnd.getTime() + DURATION_GRACE_MS).getTime();
};

/**
 * Machine-readable autoSubmitReason for the cap that actually fired. The
 * effective (earlier) deadline decides the kind, so an attempt that would
 * expire on both caps at the same instant reports exactly one reason.
 */
const buildAutoSubmitReason = (attempt, quiz, now = new Date(), { publicMode = false } = {}) => {
  const duration = getDurationDeadline(attempt);
  const windowEnd = getParticipationWindowEnd(quiz, { publicMode });
  if (windowEnd && (!duration || windowEnd.getTime() < duration.getTime())) {
    return { kind: 'quiz_window', deadline: windowEnd, detectedAt: new Date(now) };
  }
  return { kind: 'duration', deadline: duration, detectedAt: new Date(now) };
};

/**
 * Server-side status decision for a whole-quiz submit (§7.5: the client
 * isAutoSubmit flag is a hint about who INITIATED the request, never the
 * determinant of status).
 *
 *  - within the window: client flag decides (manual → completed,
 *    client-timer auto → auto_submitted) — existing semantics preserved.
 *  - past the effective deadline (individual duration OR quiz window,
 *    whichever is earlier): auto_submitted with a machine-readable reason,
 *    regardless of what the client claims.
 *  - attempts without any deadline (legacy / missing duration on a
 *    window-less quiz): existing behavior, untouched.
 *
 * @returns {{status: 'completed'|'auto_submitted',
 *            autoSubmitReason: null|{kind: 'duration'|'quiz_window', deadline: Date,
 *                                     detectedAt: Date}}}
 */
const resolveSubmissionStatus = (attempt, { isAutoSubmit = false, now = new Date(), quiz = null } = {}) => {
  if (isPastSubmissionWindow(attempt, now, quiz)) {
    return {
      status: 'auto_submitted',
      autoSubmitReason: buildAutoSubmitReason(attempt, quiz, now),
    };
  }
  return { status: isAutoSubmit === true ? 'auto_submitted' : 'completed', autoSubmitReason: null };
};

/**
 * Lazy, authoritative flat-duration engine — the mirror of
 * syncExpiredSections for non-section attempts. `filter` selects the attempt
 * (embeds ownership, e.g. {_id, student}); `finalize` is a route-supplied
 * async (attempt, {isAutoSubmit, autoSubmitReason}) => attempt callback that
 * grades and finalizes. finalizeQuizAttempt's internal CAS guarantees exactly
 * one winner when a duration finalize races a manual submit.
 *
 * When `quiz` is supplied, the effective deadline (min of the stored deadline
 * and the quiz's live participation window end) governs — a student who
 * started near the quiz's close cannot outlive the window.
 *
 * @returns {{attempt: object|null, finalized: boolean}}
 */
const syncExpiredDuration = async (AttemptModel, filter, options = {}) => {
  const { finalize, quiz = null } = options;

  const attempt = await AttemptModel.findOne(filter);
  if (!attempt) return { attempt: null, finalized: false };
  // Flat attempts only: section-locked attempts are governed by the
  // sectionStates cascade, and their quiz-window cutoff is a whole-attempt
  // finalize the routes/sweep perform explicitly (the sections must close
  // atomically with the finalize). Without a quiz this keeps the pure §7.5
  // contract; with one, min(deadline, window end) governs.
  if (attempt.status !== 'in_progress' || !hasDurationDeadline(attempt)) {
    return { attempt, finalized: false };
  }
  if (!isPastSubmissionWindow(attempt, new Date(), quiz)) {
    return { attempt, finalized: false };
  }

  if (typeof finalize === 'function') {
    // resolveSubmissionStatus inside finalizeQuizAttempt decides the status
    // and builds the {kind:'duration'|'quiz_window'} autoSubmitReason from
    // server time.
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
  getParticipationWindowEnd,
  getEffectiveDeadline,
  getSubmissionWindowEnd,
  isPastSubmissionWindow,
  isPastQuizWindow,
  buildAutoSubmitReason,
  resolveSubmissionStatus,
  syncExpiredDuration,
};
