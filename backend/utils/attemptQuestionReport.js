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
const { QUESTION_TYPE_LABELS, QUESTION_TYPES } = require('../constants/question');
const { assertStudentPerformanceAccess } = require('./studentPerformanceAuth');
const { buildAttemptResults, formatAnswerForDisplay } = require('./attemptResults');
const { resolveQuestionType } = require('./analytics');
const { isAnswerRecorded } = require('./questionHistory');

const roundTo2 = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

// Human labels for the report's Result column — wording follows the app's
// Correct/Incorrect/Skipped convention (ScoreLegend + metric cards).
const RESULT_LABELS = {
  correct: 'Correct',
  incorrect: 'Incorrect',
  skipped: 'Skipped',
};

// Per-question marks follow finalizeQuizAttempt's exact scheme: correct ->
// +positiveMarks, incorrect -> -negativeMarks, skipped -> 0. Computed from the
// CURRENT quiz marking scheme (the scheme is quiz-level, not snapshotted);
// the attempt summary always shows the marksObtained stored at submission.
const marksForResult = (result, positiveMarks, negativeMarks) => {
  if (result === 'correct') return roundTo2(positiveMarks);
  if (result === 'incorrect') return -roundTo2(negativeMarks);
  return 0;
};

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

  // ---------------------------------------------------------------------------
  // Question-row assembly. Rows are paired by STABLE identity, not by
  // position in the populated array: mongoose populate OMITS refs whose
  // QuestionBank doc was deleted after the attempt, which would silently
  // shift positions and mispair every later answer. The fresh (unpopulated)
  // quiz keeps the original id list/order, and answers carry questionId
  // (backfilled at submit) — pair on that first, fall back to questionIndex
  // only for legacy answers created before questionId existed.
  // ---------------------------------------------------------------------------
  const answerByQuestionId = new Map(
    (Array.isArray(attempt.answers) ? attempt.answers : [])
      .filter((a) => a.questionId)
      .map((a) => [String(a.questionId), a])
  );
  const answerByIndex = new Map(
    (Array.isArray(attempt.answers) ? attempt.answers : [])
      .map((a) => [Number(a.questionIndex), a])
  );
  const docById = new Map(
    (attempt.quiz.questions || [])
      .filter(Boolean)
      .map((q) => [String(q._id), q])
  );
  // Sectioned quizzes name the section the question sat in; flat quizzes
  // follow the results screen's subject-group convention.
  const hasSections = Array.isArray(freshQuiz.sections) && freshQuiz.sections.length > 0;
  const sectionNameFor = (doc) => {
    if (hasSections) {
      const section = freshQuiz.sections.find((s) =>
        (s.questions || []).some((id) => String(id) === String(doc._id))
      );
      if (section) return section.name || '';
    }
    return doc.subject?.name || 'General';
  };

  const rowForQuestion = (doc, index, answer) => {
    // Same classification rule as computeAttemptStats: stored isCorrect with
    // type-aware isAnswered — never re-graded against the live bank.
    const questionType = resolveQuestionType(answer, doc);
    const answered = answer ? isAnswerRecorded(answer.selectedAnswer) : false;
    const result = !answered ? 'skipped' : (answer.isCorrect === true ? 'correct' : 'incorrect');

    const response = formatAnswerForDisplay(
      questionType,
      answer?.selectedAnswer,
      doc.options,
      doc.columnA,
      doc.columnB
    );
    // Distinguish "no key on record" from a key that legitimately formats to
    // an empty string — numerical 0 is a valid key, so test != null.
    const hasAnswerKey = doc.correctAnswer !== undefined && doc.correctAnswer !== null;
    const correct = hasAnswerKey
      ? formatAnswerForDisplay(
        questionType,
        doc.correctAnswer,
        doc.options,
        doc.columnA,
        doc.columnB
      )
      : { label: '', text: 'Answer key unavailable' };

    return {
      questionNumber: index + 1,
      section: sectionNameFor(doc),
      subjectName: doc.subject?.name || answer?.metadataSnapshot?.subjectName || 'General',
      topicName: doc.topicName || '',
      questionType,
      questionTypeLabel: QUESTION_TYPE_LABELS[questionType] || questionType,
      question: doc.question || '',
      questionUnavailable: false,
      hasQuestionImage: Boolean(doc.questionImage),
      questionImage: doc.questionImage || null,
      studentResponseLabel: response.label,
      studentResponseText: response.text,
      correctAnswerLabel: correct.label,
      correctAnswerText: correct.text,
      result,
      resultLabel: RESULT_LABELS[result],
      marks: marksForResult(result, positiveMarks, negativeMarks),
      timeSpent: answer?.timeSpent || 0,
    };
  };

  // Row for a slot whose QuestionBank doc is gone (deleted after the
  // attempt): the report still represents the question, honestly marked
  // unavailable, with the verdict from the stored answer.
  const unavailableRowFor = (index, answer) => {
    const questionType = answer?.metadataSnapshot?.questionType || QUESTION_TYPES.MCQ_SINGLE;
    const answered = answer ? isAnswerRecorded(answer.selectedAnswer) : false;
    const result = !answered ? 'skipped' : (answer.isCorrect === true ? 'correct' : 'incorrect');
    // Without the question doc there are no options to resolve against — the
    // formatter still yields the raw label/numeric value where it can.
    const response = formatAnswerForDisplay(questionType, answer?.selectedAnswer, [], [], []);

    return {
      questionNumber: index + 1,
      section: '',
      subjectName: answer?.metadataSnapshot?.subjectName || 'General',
      topicName: answer?.metadataSnapshot?.topicName || '',
      questionType,
      questionTypeLabel: QUESTION_TYPE_LABELS[questionType] || questionType,
      question: null,
      questionUnavailable: true,
      hasQuestionImage: false,
      questionImage: null,
      studentResponseLabel: response.label,
      studentResponseText: response.text,
      correctAnswerLabel: '',
      correctAnswerText: '',
      result,
      resultLabel: RESULT_LABELS[result],
      marks: marksForResult(result, positiveMarks, negativeMarks),
      timeSpent: answer?.timeSpent || 0,
    };
  };

  // One row per slot of the attempt (stored totalQuestions — appended-after
  // questions never appear). Order follows the quiz's current question list,
  // the same order every existing results surface uses.
  const quizQuestionIds = Array.isArray(freshQuiz.questions) ? freshQuiz.questions : [];
  const summaryTotal = results.summary.totalQuestions || 0;
  const questions = [];
  const usedAnswers = new Set();
  for (let index = 0; index < summaryTotal; index += 1) {
    const id = quizQuestionIds[index] ? String(quizQuestionIds[index]) : null;
    const doc = id ? docById.get(id) : undefined;
    const answer = (id ? answerByQuestionId.get(id) : undefined) ?? answerByIndex.get(index);
    if (answer) usedAnswers.add(answer);
    questions.push(doc
      ? rowForQuestion(doc, index, answer)
      : unavailableRowFor(index, answer));
  }
  // Legacy edge: answers whose slot fell outside the current list (quiz
  // shortened after the attempt) still belong to THIS attempt — append them
  // so no submitted response is silently dropped.
  const extraAnswers = (Array.isArray(attempt.answers) ? attempt.answers : [])
    .filter((a) => !usedAnswers.has(a));
  extraAnswers.forEach((answer) => {
    questions.push(unavailableRowFor(Number(answer.questionIndex), answer));
  });
  const missingQuestionCount = questions.filter((q) => q.questionUnavailable).length;

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
  RESULT_LABELS,
};
