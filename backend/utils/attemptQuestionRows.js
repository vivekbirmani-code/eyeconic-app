// Shared per-attempt question-row assembly for question-level reports.
// Extracted verbatim from utils/attemptQuestionReport.js so the
// single-attempt report (JSON/CSV/Excel) and the test-wide "User Responses"
// export of the test report workbook build rows through ONE code path — the
// pairing, classification and formatting below can never drift between them.
//
// Contract (unchanged from the original collector):
//   - Correctness is NEVER recomputed: the stored answer.isCorrect graded
//     server-side at submission time is the verdict; isAnswerRecorded is the
//     type-aware "did they answer" check (numerical 0 counts as answered,
//     empty multi-select does not).
//   - Rows pair by STABLE identity (answer.questionId) against the FRESH
//     quiz's raw question-id list — mongoose populate OMITS deleted refs,
//     so positional pairing would shift and mispair. Legacy answers without
//     questionId fall back to questionIndex.
//   - One row per slot of the attempt's stored totalQuestions (appended-after
//     questions never appear); answers past the current list are appended so
//     no submitted response is silently dropped; deleted questions become
//     honest questionUnavailable rows.
const {
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
} = require('../constants/question');
const { computeAttemptStats, resolveQuestionType } = require('./analytics');
const { formatAnswerForDisplay } = require('./attemptResults');
const { isAnswerRecorded } = require('./questionHistory');

const roundTo2 = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

// Human labels for report Result/Status columns — wording follows the app's
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

const resultForAnswer = (answer) => {
  const answered = answer ? isAnswerRecorded(answer.selectedAnswer) : false;
  if (!answered) return 'skipped';
  return answer.isCorrect === true ? 'correct' : 'incorrect';
};

/**
 * Builds the question-level rows for one finalized attempt.
 *
 * @param {object} params
 * @param {object} params.attempt            attempt doc (or lean object) with
 *   `answers` (and their metadataSnapshot) plus `totalQuestions`
 * @param {object} params.freshQuiz          FRESH (unpopulated) Quiz doc —
 *   source of truth for the current question-id list/order and sections
 * @param {object[]} params.populatedQuestions QuestionBank docs populated for
 *   the quiz's question refs (subjects populated to `name`); deleted refs are
 *   simply absent, which the identity-based pairing tolerates
 * @param {number} params.positiveMarks  quiz-level positive marks per question
 * @param {number} params.negativeMarks  quiz-level negative marks per question
 * @returns {{ questions: object[], missingQuestionCount: number }}
 */
function buildAttemptQuestionRows({
  attempt,
  freshQuiz,
  populatedQuestions,
  positiveMarks,
  negativeMarks,
}) {
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
    (populatedQuestions || [])
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
    const result = resultForAnswer(answer);

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
    const result = resultForAnswer(answer);
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
  const summaryTotal = computeAttemptStats(attempt, populatedQuestions || []).totalQuestions || 0;
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

  return { questions, missingQuestionCount };
}

module.exports = {
  buildAttemptQuestionRows,
  marksForResult,
  RESULT_LABELS,
};
