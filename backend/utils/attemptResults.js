// Pure results computation shared by:
//   - GET /api/quizzes/:id/attempt/:attemptId/results (registered users)
//   - GET /api/public/quiz/:shareToken/attempt/:attemptId/result (guests)
//     and the admin guest-attempt fallback on the same registered route.
//
// Extracted verbatim from routes/quizzes.js so every consumer gets the same
// grouped-performance contract (groupBy section|subject|topic|tag, section
// falls back to subject on sectionless quizzes, classifyAnswer keeps group
// rows == summary). `roundTo2`/`formatAnswerForDisplay` are intentionally
// duplicated here as small pure helpers to keep the quizzes.js route diff
// minimal — keep both copies in sync if either changes.

const QuestionBank = require('../models/QuestionBank');
const {
  computeAttemptStats,
  resolveQuestionType,
  classifyAnswer,
} = require('./analytics');
const {
  aggregateQuestionHistoryForStudent,
  getFrequentlyMissedQuestions,
  computeTimeTakenSeconds,
  isAnswerRecorded,
} = require('./questionHistory');

const ALLOWED_GROUP_BY = ['section', 'subject', 'topic', 'tag'];

const roundTo2 = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

const optionLabelFromIndex = (index) => {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) return '';
  return String.fromCharCode(65 + idx); // 0 -> A, 1 -> B, ...
};

const optionTextFromIndex = (options, index) => {
  const idx = Number(index);
  if (!Array.isArray(options) || !Number.isInteger(idx) || idx < 0 || idx >= options.length) {
    return '';
  }
  return options[idx] || '';
};

const formatAnswerForDisplay = (questionType, selectedAnswer, options = [], columnA = [], columnB = []) => {
  if (!isAnswerRecorded(selectedAnswer)) {
    return { label: 'Not answered', text: 'Not answered' };
  }

  switch (questionType) {
    case 'multiple_correct': {
      const indices = Array.isArray(selectedAnswer) ? selectedAnswer : [];
      const labels = indices.map((idx) => optionLabelFromIndex(idx));
      const texts = indices.map((idx) => optionTextFromIndex(options, idx));
      return {
        label: labels.join(', ') || 'Not answered',
        text: texts.filter(Boolean).join('; ') || labels.join(', '),
      };
    }
    case 'match_the_following': {
      if (!selectedAnswer || typeof selectedAnswer !== 'object') {
        return { label: 'Not answered', text: 'Not answered' };
      }
      const pairs = Object.entries(selectedAnswer).map(([aIdx, bIdx]) => {
        const left = columnA[Number(aIdx)] || `Item ${Number(aIdx) + 1}`;
        const right = columnB[Number(bIdx)] || optionLabelFromIndex(Number(bIdx));
        return `${left} → ${right}`;
      });
      return { label: pairs.join(', '), text: pairs.join('; ') };
    }
    case 'numerical':
      return { label: String(selectedAnswer), text: String(selectedAnswer) };
    default: {
      const idx = Number(selectedAnswer);
      const label = optionLabelFromIndex(idx);
      const text = optionTextFromIndex(options, idx);
      return { label: label || String(selectedAnswer), text: text || label };
    }
  }
};

/**
 * Builds the full results payload for a finalized attempt.
 *
 * @param {object} params
 * @param {object} params.attempt  attempt doc whose `quiz.questions` are
 *   populated QuestionBank docs (subject populated to `name` — this helper
 *   will populate subjects itself if not already done).
 * @param {object} params.quiz     FRESH Quiz doc (source of truth for the
 *   live shareSolution setting and current section definitions).
 * @param {string} [params.groupBy] section|subject|topic|tag (default section)
 * @param {boolean} [params.includeStudentHistory] false for guest attempts —
 *   skips the per-student history/frequently-missed aggregations (guests have
 *   no cross-attempt student identity to aggregate).
 * @param {boolean} [params.includeSolutions] STAFF-ONLY override used by the
 *   admin question-report collector: always emits correctAnswer/explanation
 *   regardless of the quiz's shareSolution setting (admins/mentors inspecting
 *   an attempt must see the key; student-facing routes never pass this).
 * @param {object|null} [params.student] overrides the emitted `student` field
 *   (guest flows pass a { _id, name } like object).
 * @returns the response body (identical shape to the historical registered
 *   route response when includeStudentHistory is true).
 */
const buildAttemptResults = async ({
  attempt,
  quiz,
  groupBy: requestedGroupBy,
  includeStudentHistory = true,
  includeSolutions = false,
  student = undefined,
}) => {
  const requested = String(requestedGroupBy || '').toLowerCase().trim();
  const groupBy = ALLOWED_GROUP_BY.includes(requested) ? requested : 'section';

  // Subjects must be populated on each question for group naming.
  if (attempt.quiz && attempt.quiz.questions
    && attempt.quiz.questions.length > 0
    && !attempt.quiz.questions[0]?.subject?.name) {
    await QuestionBank.populate(attempt.quiz.questions, { path: 'subject', select: 'name' });
  }

  // SECURITY CRITICAL: shareSolution comes from the fresh quiz document so
  // no cached response can bypass solution hiding. includeSolutions is the
  // explicit staff-only override (see JSDoc) — student routes never set it.
  const shareSolution = quiz.shareSolution !== undefined ? quiz.shareSolution : true;
  const showSolution = shareSolution || includeSolutions === true;

  // Calculate grouped performance data.
  // The groupBy dimension is honoured for every quiz shape: on sectioned
  // quizzes "subject" merges questions of the same subject across sections;
  // "section" on a quiz without sections falls back to subject grouping so
  // flat quizzes keep a meaningful breakdown (historical behaviour).
  const hasQuizSections = quiz.sections && quiz.sections.length > 0;
  const effectiveGroupBy = groupBy === 'section' && !hasQuizSections ? 'subject' : groupBy;

  // Group name for a question under the requested dimension. Null-subject
  // questions follow the app's existing 'General' convention.
  const groupNameForQuestion = (q) => {
    if (effectiveGroupBy === 'subject') {
      return q?.subject?.name || 'General';
    }
    if (effectiveGroupBy === 'tag') {
      return (q?.tags && q.tags.length > 0) ? q.tags[0] : 'Untagged';
    }
    if (effectiveGroupBy === 'topic') {
      return q?.topicName || 'General';
    }
    return 'General';
  };

  // Insertion-ordered so groups appear in first-seen question order while
  // same-group questions (e.g. one subject spread over sections) accumulate
  // into a single row — never double-counted, never duplicated.
  const groupPerformance = new Map();

  // Ordered traversal: section quizzes follow section order (matching how
  // students saw them), flat quizzes follow the global question order.
  const questionEntries = [];
  if (hasQuizSections) {
    // Pre-seed a row per section so empty sections still surface (historical
    // behaviour); duplicate section names merge into a single row.
    if (effectiveGroupBy === 'section') {
      quiz.sections.forEach(section => {
        if (!groupPerformance.has(section.name)) {
          groupPerformance.set(section.name, {
            sectionName: section.name,
            correct: 0,
            incorrect: 0,
            skipped: 0,
            timeSpent: 0
          });
        }
      });
    }
    quiz.sections.forEach(section => {
      section.questions.forEach((qId, sIdx) => {
        const globalIndex = attempt.quiz.questions.findIndex(qd => qd._id.toString() === qId.toString());
        if (globalIndex !== -1) {
          questionEntries.push({
            question: attempt.quiz.questions[globalIndex],
            globalIndex,
            sectionQuestionIndex: sIdx,
            groupName: effectiveGroupBy === 'section' ? section.name : null
          });
        }
      });
    });
  } else {
    attempt.quiz.questions.forEach((q, index) => {
      questionEntries.push({
        question: q,
        globalIndex: index,
        sectionQuestionIndex: index,
        groupName: null
      });
    });
  }

  const questionsWithAnswers = [];

  questionEntries.forEach(({ question: q, globalIndex, sectionQuestionIndex, groupName }) => {
    const name = groupName !== null && groupName !== undefined
      ? groupName
      : groupNameForQuestion(q);
    const answer = attempt.answers.find(a => a.questionIndex === globalIndex);

    // Classify with the same type-aware rules as the overall summary so the
    // group rows always add up to summary.correct/incorrect/skipped.
    const questionType = resolveQuestionType(answer, q);
    const result = classifyAnswer(answer, questionType);

    let group = groupPerformance.get(name);
    if (!group) {
      group = { sectionName: name, correct: 0, incorrect: 0, skipped: 0, timeSpent: 0 };
      groupPerformance.set(name, group);
    }

    if (result.skipped) group.skipped += 1;
    else if (result.correct) group.correct += 1;
    else group.incorrect += 1;
    if (answer) {
      group.timeSpent += answer.timeSpent || 0;
    }

    // Build question data. A null `q` is a question deleted from the bank
    // after the attempt (populate of a dead ref): keep the row so the report
    // still represents every answered slot, marked as unavailable.
    const baseData = q ? {
      _id: q._id,
      question: q.question,
      questionImage: q.questionImage,
      options: q.options,
      optionImages: q.optionImages,
      questionType: q.questionType,
      assertion: q.assertion,
      reason: q.reason,
      columnA: q.columnA,
      columnB: q.columnB,
      marks: q.marks,
      subject: q.subject,
      topicName: q.topicName,
      subtopicName: q.subtopicName,
      system: q.system,
      difficulty: q.difficulty,
      tags: q.tags,
      userAnswer: answer?.selectedAnswer,
      isCorrect: answer?.isCorrect,
      timeSpent: answer?.timeSpent,
      markedForReview: answer?.markedForReview,
      section: name,
      sectionQuestionIndex,
      globalIndex
    } : {
      _id: null,
      question: null,
      questionUnavailable: true,
      questionType: resolveQuestionType(answer, null),
      userAnswer: answer?.selectedAnswer,
      isCorrect: answer?.isCorrect,
      timeSpent: answer?.timeSpent,
      markedForReview: answer?.markedForReview,
      section: name,
      sectionQuestionIndex,
      globalIndex
    };

    if (showSolution && q) {
      baseData.correctAnswer = q.correctAnswer;
      baseData.explanation = q.explanation;
      baseData.explanationImage = q.explanationImage;
    }

    questionsWithAnswers.push(baseData);
  });

  // Calculate accuracy for each group (correct / attempted, skips excluded)
  const sectionPerformanceArray = [...groupPerformance.values()].map(section => {
    const attemptedInSection = section.correct + section.incorrect;
    const accuracy = attemptedInSection > 0
      ? Math.round((section.correct / attemptedInSection) * 100)
      : 0;

    return {
      ...section,
      accuracy,
      total: section.correct + section.incorrect + section.skipped
    };
  });

  const stats = computeAttemptStats(attempt, attempt.quiz.questions || []);
  const markedForReviewCount = Array.isArray(attempt.answers)
    ? attempt.answers.filter((answer) => answer.markedForReview).length
    : 0;
  const timeTakenSeconds = computeTimeTakenSeconds(attempt, attempt.quiz.questions || []);

  const questionIds = questionsWithAnswers
    .map((question) => question._id)
    .filter(Boolean);

  const historyMap = includeStudentHistory
    ? await aggregateQuestionHistoryForStudent(
      attempt.student?._id,
      questionIds,
      { excludeAttemptId: attempt._id }
    )
    : new Map();

  const emptyHistory = {
    questionId: null,
    totalAttempts: 0,
    correctAttempts: 0,
    incorrectAttempts: 0,
    skippedAttempts: 0,
    previousIncorrectAttempts: 0,
  };

  const questionPerformance = questionsWithAnswers.map((question) => {
    const history = historyMap.get(String(question._id)) || {
      ...emptyHistory,
      questionId: String(question._id),
    };

    const answered = isAnswerRecorded(question.userAnswer);
    let status = 'unattempted';
    if (answered) {
      status = question.isCorrect ? 'correct' : 'incorrect';
    }

    return {
      questionId: String(question._id),
      questionIndex: question.globalIndex,
      section: question.section,
      status,
      isCorrect: question.isCorrect === true,
      markedForReview: question.markedForReview === true,
      timeSpent: question.timeSpent || 0,
      history,
    };
  });

  const wrongQuestions = questionsWithAnswers
    .filter((question) => {
      const answered = isAnswerRecorded(question.userAnswer);
      return answered && question.isCorrect === false;
    })
    .map((question) => {
      const history = historyMap.get(String(question._id)) || {
        ...emptyHistory,
        questionId: String(question._id),
      };

      const selected = formatAnswerForDisplay(
        question.questionType,
        question.userAnswer,
        question.options,
        question.columnA,
        question.columnB
      );

      const correct = showSolution
        ? formatAnswerForDisplay(
          question.questionType,
          question.correctAnswer,
          question.options,
          question.columnA,
          question.columnB
        )
        : null;

      return {
        questionId: String(question._id),
        questionIndex: question.globalIndex,
        displayNumber: (question.globalIndex ?? 0) + 1,
        question: question.question,
        questionImage: question.questionImage,
        questionType: question.questionType,
        section: question.section,
        topicName: question.topicName,
        subjectName: question.subject?.name || question.metadataSnapshot?.subjectName || null,
        selectedAnswer: question.userAnswer,
        selectedAnswerLabel: selected.label,
        selectedAnswerText: selected.text,
        correctAnswer: showSolution ? question.correctAnswer : undefined,
        correctAnswerLabel: correct?.label,
        correctAnswerText: correct?.text,
        explanation: showSolution ? question.explanation : undefined,
        explanationImage: showSolution ? question.explanationImage : undefined,
        timeSpent: question.timeSpent || 0,
        history: {
          ...history,
          previousIncorrectAttempts: history.previousIncorrectAttempts || history.incorrectAttempts || 0,
        },
      };
    });

  const frequentlyMissedQuestions = includeStudentHistory
    ? await getFrequentlyMissedQuestions(
      attempt.student?._id,
      {
        minIncorrectAttempts: 2,
        limit: 15,
        excludeAttemptId: attempt._id,
      }
    )
    : [];

  const hasSectionData = sectionPerformanceArray.length > 0
    && !(sectionPerformanceArray.length === 1 && sectionPerformanceArray[0].sectionName === 'General');

  return {
    summary: {
      correct: stats.correct,
      incorrect: stats.incorrect,
      skipped: stats.skipped,
      attempted: stats.attempted,
      totalQuestions: stats.totalQuestions,
      marksObtained: roundTo2(stats.marksObtained),
      totalMarks: stats.totalMarks,
      scorePercentage: stats.scorePercentage,
      accuracy: stats.accuracy,
      markedForReviewCount,
      timeTakenSeconds,
    },
    attempt: {
      _id: attempt._id,
      status: attempt.status,
      startTime: attempt.startTime,
      endTime: attempt.endTime,
      score: attempt.score,
      totalQuestions: attempt.totalQuestions,
      marksObtained: roundTo2(attempt.marksObtained),
      totalMarks: attempt.totalMarks,
      sectionPerformance: sectionPerformanceArray,
      tabSwitchCount: attempt.tabSwitchCount,
      retestRequested: attempt.retestRequested || false,
      retestApproved: attempt.retestApproved || false,
      canRequestRetest: !attempt.retestRequested && !attempt.retestApproved,
    },
    quiz: {
      _id: attempt.quiz._id,
      title: attempt.quiz.title,
      subject: attempt.quiz.subject,
      subjectNames: (() => {
        const names = [...new Set(
          (attempt.quiz.questions || [])
            .map(qu => qu.subject?.name)
            .filter(Boolean)
        )];
        return names.length > 0 ? names : (attempt.quiz.subject?.name ? [attempt.quiz.subject.name] : []);
      })(),
      testType: attempt.quiz.testType,
      shareSolution
    },
    student: student !== undefined ? student : attempt.student,
    questions: questionsWithAnswers,
    questionPerformance,
    wrongQuestions,
    frequentlyMissedQuestions,
    hasSectionData,
    groupBy
  };
};

module.exports = {
  buildAttemptResults,
  formatAnswerForDisplay,
  ALLOWED_GROUP_BY,
};
