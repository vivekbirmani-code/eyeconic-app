// Periodic DB-backed sweep that materializes finalizations for overdue
// attempts whose owner never touches the API again.
//
// WHY: lazy enforcement (the routes above) is the hard gate — an overdue
// attempt can never be ANSWERED past its effective deadline. But an attempt
// whose student closed the app and never returned would stay in_progress in
// the database forever, silently missing from analytics, leaderboards and
// reports. This sweep finds those rows and runs the EXACT same finalize path
// the routes use, so a sweep-finalized attempt is indistinguishable from a
// student-touch finalization.
//
// RELIABILITY CONTRACT:
//  - Pure request-time work: stateless queries against Mongo, no in-memory
//    attempt state. A restart, crash or overlapping tick loses nothing — the
//    next run (or any student touch) converges to the same result.
//  - Idempotent: finalization is a CAS on status:'in_progress' inside
//    finalizeQuizAttempt / gradeAndFinalizeGuestAttempt, so a sweep racing a
//    returning student (or itself) produces exactly one winner.
//  - Error-isolated: one bad attempt logs and skips; the rest of the batch
//    proceeds.
//  - Lazy checks remain authoritative: the sweep only ADVANCES state that is
//    already expired per the stored deadlines — it never decides deadlines
//    on its own.
//
// DEPLOYMENT: wired in server.js as a setInterval on the long-running Node
// process (same pattern as the media cleanup job). Interval and disable
// switch are env-configurable; see server.js.

const QuizAttempt = require('../models/QuizAttempt');
const GuestAttempt = require('../models/GuestAttempt');
const Quiz = require('../models/Quiz');
const { DURATION_GRACE_MS } = require('./proctoring/durationEnforcement');

// Upper bound per cycle: keeps each tick short even after a long outage; the
// backlog drains over successive ticks (oldest first).
const SWEEP_BATCH_LIMIT = 200;

// Lazy requires: the routes own the finalize implementations (and their
// module graph is heavy); deferring the require also avoids any load-order
// coupling for tests that only load the sweep.
const getRegisteredEnforcer = () => require('../routes/quizzes').enforceAttemptDeadlines;
const getGuestEnforcer = () => require('../routes/public-quiz').enforceGuestAttemptDeadlines;

const buildCandidateQuery = ({ closedQuizIds, cutoff, now }) => ({
  status: 'in_progress',
  $or: [
    // Flat attempts whose stored duration deadline passed (+grace already
    // baked into `cutoff`). Range queries never match missing fields, so
    // section-locked attempts (no durationDeadline) are excluded here.
    { durationDeadline: { $lt: cutoff } },
    // Any attempt shape on a quiz whose availability window has closed.
    ...(closedQuizIds.length > 0 ? [{ quiz: { $in: closedQuizIds } }] : []),
    // Section-locked attempts with at least one section deadline passed —
    // the cascade may need to advance/finalize them.
    { sectionLockEnabled: true, 'sectionStates.endsAt': { $lt: now } },
  ],
});

const sweepRegisteredAttempts = async ({ now = new Date(), enforce = getRegisteredEnforcer() } = {}) => {
  const cutoff = new Date(now.getTime() - DURATION_GRACE_MS);
  // Window candidates: quizzes whose expiry closed past the grace margin (the
  // precise gate lives inside the orchestrator).
  const closedQuizIds = (await Quiz.find({ expiryDate: { $lt: cutoff } }).distinct('_id'))
    .map((id) => id.toString());

  // Full documents on purpose: the finalizers grade attempt.answers from the
  // doc they are handed — a projected doc would silently grade as all-skipped.
  const candidates = await QuizAttempt.find(buildCandidateQuery({ closedQuizIds, cutoff, now }))
    .sort({ startTime: 1 })
    .limit(SWEEP_BATCH_LIMIT);

  let finalized = 0;
  const errors = [];
  for (const candidate of candidates) {
    try {
      const quiz = await Quiz.findById(candidate.quiz).select('expiryDate');
      if (!quiz) continue; // deleted quiz — nothing to enforce against
      const result = await enforce(candidate, quiz, { req: null });
      if (result.finalized) finalized += 1;
    } catch (error) {
      errors.push({ attemptId: candidate._id, error: error?.message || String(error) });
      console.error(`[Attempt Sweep] Failed to finalize attempt ${candidate._id}:`, error?.message || error);
    }
  }

  return { checked: candidates.length, finalized, errors };
};

const sweepGuestAttempts = async ({ now = new Date(), enforce = getGuestEnforcer() } = {}) => {
  const cutoff = new Date(now.getTime() - DURATION_GRACE_MS);
  // Public links are governed by publicExpiryDate (utils/publicQuizAccess.js).
  const closedQuizIds = (await Quiz.find({ publicExpiryDate: { $lt: cutoff } }).distinct('_id'))
    .map((id) => id.toString());

  // Full documents — same reason as the registered sweep (graders read the
  // handed doc's answers).
  const candidates = await GuestAttempt.find(buildCandidateQuery({ closedQuizIds, cutoff, now }))
    .sort({ startTime: 1 })
    .limit(SWEEP_BATCH_LIMIT);

  let finalized = 0;
  const errors = [];
  for (const candidate of candidates) {
    try {
      const quiz = await Quiz.findById(candidate.quiz).select('publicExpiryDate');
      if (!quiz) continue;
      const result = await enforce(candidate, quiz, { now });
      if (result.finalized) finalized += 1;
    } catch (error) {
      errors.push({ attemptId: candidate._id, error: error?.message || String(error) });
      console.error(`[Attempt Sweep] Failed to finalize guest attempt ${candidate._id}:`, error?.message || error);
    }
  }

  return { checked: candidates.length, finalized, errors };
};

let sweeping = false;

// One full cycle. Re-entrancy guard: an overlapping tick (slow DB, long
// backlog) is skipped — the next interval converges. Never throws: sweep
// failures are logged, not propagated to the timer.
const runAttemptSweep = async ({ now = new Date() } = {}) => {
  if (sweeping) return { skipped: true };
  sweeping = true;
  try {
    const registered = await sweepRegisteredAttempts({ now });
    const guest = await sweepGuestAttempts({ now });
    const totals = {
      checked: registered.checked + guest.checked,
      finalized: registered.finalized + guest.finalized,
      errors: [...registered.errors, ...guest.errors],
    };
    if (totals.finalized > 0 || totals.errors.length > 0) {
      console.log(`[Attempt Sweep] finalized ${totals.finalized} overdue attempt(s) (${totals.errors.length} error(s))`);
    }
    return totals;
  } catch (error) {
    console.error('[Attempt Sweep] cycle failed:', error?.message || error);
    return { checked: 0, finalized: 0, errors: [{ error: error?.message || String(error) }] };
  } finally {
    sweeping = false;
  }
};

module.exports = {
  SWEEP_BATCH_LIMIT,
  sweepRegisteredAttempts,
  sweepGuestAttempts,
  runAttemptSweep,
};
