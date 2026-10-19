// Shared data collection for the single-attempt question-level report
// (JSON + CSV + Excel). All three surfaces MUST stay data-identical, so every
// query, access rule and derived value lives here — the routes only render.
//
// The per-attempt payload comes from buildAttemptResults (the SAME contract
// the student results route and the admin attempt-detail modal use), called
// with the staff-only includeSolutions override so admins/mentors inspecting
// an attempt always see the answer key. Correctness itself is never
// recomputed: buildAttemptResults/classifyAnswer read the isCorrect value
// graded server-side at submission time, so a later edit of the quiz or its
// marking scheme can never rewrite a historical verdict.
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const GuestAttempt = require('../models/GuestAttempt');
const QuestionBank = require('../models/QuestionBank');
const { assertStudentPerformanceAccess } = require('./studentPerformanceAuth');
const { buildAttemptResults } = require('./attemptResults');
const {
  buildAttemptQuestionRows,
  RESULT_LABELS,
} = require('./attemptQuestionRows');

/**
 * Resolve one attempt (registered first, then admin-only guest fallback) and
 * verify the requesting user may see it.
 *
 * @returns {Promise<{ok: true, attempt: object, participantType: string,
 *   studentOverride?: object}|{ok: false, statusCode: number, message: string,
 *   errorCode?: string}>}
 */
async function resolveAttemptForViewer({ attemptId, user }) {
  const attempt = await QuizAttempt.findById(attemptId)
    .populate({
      path: 'quiz',
      populate: { path: 'questions', model: 'QuestionBank' },
    })
    .populate('student', 'name email profilePicture');

  if (attempt) {
    if (!attempt.quiz) {
      return { ok: false, statusCode: 404, message: 'Quiz not found for this attempt', errorCode: 'QUIZ_NOT_FOUND' };
    }
    // assertStudentPerformanceAccess reads req.user — wrap the resolved user.
    const access = await assertStudentPerformanceAccess(
      { user },
      attempt.student?._id ?? attempt.student
    );
    if (!access.authorized) {
      return { ok: false, statusCode: access.statusCode, message: access.message };
    }
    return { ok: true, attempt, participantType: 'registered' };
  }

  // Guest-attempt fallback (public-quiz participants): ADMIN ONLY — guest
  // leads are admin-privileged data (mentors/students get a bare 404).
  if (user.role === 'admin') {
    const guestAttempt = await GuestAttempt.findById(attemptId)
      .populate({
        path: 'quiz',
        populate: { path: 'questions', model: 'QuestionBank' },
      })
      .populate('guest', 'name email emailVerifiedAt phone phoneVerifiedAt marketingConsent');

    if (guestAttempt) {
      if (!guestAttempt.quiz) {
        return { ok: false, statusCode: 404, message: 'Quiz not found for this attempt', errorCode: 'QUIZ_NOT_FOUND' };
      }
      const lead = guestAttempt.guest;
      return {
        ok: true,
        attempt: guestAttempt,
        participantType: 'guest',
        studentOverride: {
          _id: lead?._id || guestAttempt.guest,
          name: guestAttempt.guestName || lead?.name || 'Guest',
          email: guestAttempt.guestEmail || lead?.email || null,
          phone: guestAttempt.guestPhone || lead?.phone || null,
          emailVerified: Boolean(lead?.emailVerifiedAt),
          phoneVerified: Boolean(lead?.phoneVerifiedAt),
          marketingConsent: lead?.marketingConsent?.granted === true,
        },
      };
    }
  }

  return { ok: false, statusCode: 404, message: 'Attempt not found' };
}

/**
 * Collects the complete question-level report for one finalized attempt.
 *
 * @param {object} params
 * @param {string} params.attemptId attempt id from the route
 * @param {object} params.user      authenticated req.user (role drives scoping)
 * @returns {Promise<object|null>} report payload, or a
 *   `{ ok: false, statusCode, message }` failure the route maps verbatim
 */
async function collectAttemptQuestionReport({ attemptId, user }) {
  const resolved = await resolveAttemptForViewer({ attemptId, user });
  if (!resolved.ok) return resolved;

  const { attempt, participantType, studentOverride } = resolved;

  if (attempt.status !== 'completed' && attempt.status !== 'auto_submitted') {
    return {
      ok: false,
      statusCode: 400,
      message: 'Results are only available after the quiz has been submitted.',
      errorCode: 'ATTEMPT_NOT_COMPLETED',
    };
  }

  const freshQuiz = await Quiz.findById(attempt.quiz._id);
  if (!freshQuiz) {
    return { ok: false, statusCode: 404, message: 'Quiz not found for this attempt', errorCode: 'QUIZ_NOT_FOUND' };
  }

  // Subjects must be populated for group naming/subject columns.
  if (attempt.quiz.questions && attempt.quiz.questions.length > 0) {
    await QuestionBank.populate(attempt.quiz.questions, { path: 'subject', select: 'name' });
  }

  // includeStudentHistory: false — the report needs no cross-attempt
  // aggregation, which keeps the payload lean and skips two extra queries.
  const results = await buildAttemptResults({
    attempt,
    quiz: freshQuiz,
    includeStudentHistory: false,
    includeSolutions: true,
    student: studentOverride,
  });

  const positiveMarks = Number.isFinite(Number(freshQuiz.positiveMarks)) ? Number(freshQuiz.positiveMarks) : 4;
  const negativeMarks = Number.isFinite(Number(freshQuiz.negativeMarks)) ? Math.abs(Number(freshQuiz.negativeMarks)) : 1;

  // Question-row assembly lives in the shared attemptQuestionRows module —
  // the SAME builder the test report's User Responses export uses — so the
  // two question-level surfaces cannot drift (pairing by questionId against
  // the fresh quiz's raw id list, stored-isCorrect verdicts, deleted-question
  // honesty rows, legacy index fallback; see that module's header).
  const { questions, missingQuestionCount } = buildAttemptQuestionRows({
    attempt,
    freshQuiz,
    populatedQuestions: attempt.quiz.questions || [],
    positiveMarks,
    negativeMarks,
  });

  const student = studentOverride !== undefined ? studentOverride : {
    _id: results.student?._id,
    name: results.student?.name || 'Student',
    email: results.student?.email ?? null,
  };

  return {
    ok: true,
    participantType,
    student,
    quiz: {
      _id: String(attempt.quiz._id),
      title: attempt.quiz.title || '',
      testType: attempt.quiz.testType || '',
      subjectNames: results.quiz.subjectNames || [],
    },
    attempt: {
      _id: String(attempt._id),
      status: attempt.status,
      startTime: attempt.startTime,
      endTime: attempt.endTime,
      score: results.summary.correct,
      totalQuestions: results.summary.totalQuestions,
      marksObtained: results.attempt.marksObtained,
      totalMarks: results.attempt.totalMarks,
      scorePercentage: results.summary.scorePercentage,
      accuracy: results.summary.accuracy,
      correct: results.summary.correct,
      incorrect: results.summary.incorrect,
      skipped: results.summary.skipped,
      attempted: results.summary.attempted,
      timeTakenSeconds: results.summary.timeTakenSeconds,
      tabSwitchCount: attempt.tabSwitchCount || 0,
    },
    marking: { positiveMarks, negativeMarks },
    questions,
    missingQuestionCount,
    generatedAt: new Date(),
  };
}

module.exports = {
  collectAttemptQuestionReport,
  // Re-exported for existing importers; the definition lives in
  // utils/attemptQuestionRows.js (shared with the User Responses export).
  RESULT_LABELS,
};
