const GuestAttempt = require('../models/GuestAttempt');
const QuizAttempt = require('../models/QuizAttempt');
const socketHelpers = require('./socket-helpers');

/**
 * Links a device's completed public-quiz guest attempts to a freshly
 * authenticated user: each guest attempt becomes a real QuizAttempt (unless
 * the user already has an attempt for that quiz), and the guest row is marked
 * linked either way. Extracted from the login route so the contract is
 * testable in isolation.
 *
 * Live leaderboard: every MATERIALIZED QuizAttempt nudges its quiz's
 * leaderboard room (same contract as finalizeQuizAttempt — emitted after the
 * row is persisted, nudge not payload). Without it, a row that appears here
 * changes the ranked board an admin/mentor is watching, but their board only
 * moves on the next manual refresh.
 *
 * @returns {Promise<number>} how many guest attempts became QuizAttempts
 *   (rows skipped because the user already had an attempt don't count —
 *   same number the login response reports as linkedAttempts).
 */
async function linkGuestAttemptsToUser({ guestId, userId }) {
  if (!guestId || !userId) return 0;

  const guestAttempts = await GuestAttempt.find({
    guestId,
    status: 'completed',
    linkedUser: null,
  });

  let linked = 0;
  for (const guestAttempt of guestAttempts) {
    const existingAttempt = await QuizAttempt.findOne({
      quiz: guestAttempt.quiz,
      student: userId,
    });

    if (!existingAttempt) {
      const newAttempt = new QuizAttempt({
        quiz: guestAttempt.quiz,
        student: userId,
        answers: guestAttempt.answers,
        startTime: guestAttempt.startTime,
        endTime: guestAttempt.endTime,
        status: guestAttempt.status,
        score: guestAttempt.score,
        totalQuestions: guestAttempt.totalQuestions,
        marksObtained: guestAttempt.marksObtained,
        totalMarks: guestAttempt.totalMarks,
        tabSwitchCount: guestAttempt.tabSwitchCount,
        tabSwitchLog: guestAttempt.tabSwitchLog,
      });

      await newAttempt.save();
      linked += 1;

      socketHelpers.emitQuizLeaderboardUpdated(newAttempt.quiz, {
        attemptId: newAttempt._id.toString(),
        studentId: userId.toString(),
        cohort: 'internal',
        submittedAt: (newAttempt.endTime || new Date()).toISOString(),
      });
    }

    // Mark guest attempt as linked
    guestAttempt.linkedUser = userId;
    await guestAttempt.save();
  }

  return linked;
}

module.exports = { linkGuestAttemptsToUser };
