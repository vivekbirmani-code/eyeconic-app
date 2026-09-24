const QuizAttempt = require('../models/QuizAttempt');
const Quiz = require('../models/Quiz');
const {
  computeAttemptStats,
  computePercentile,
  computeScoreDistribution,
  computeScorePercentage,
  classifyAnswer,
  resolveQuestionType,
  roundTo2,
} = require('./analytics');

/**
 * Anonymous cohort comparison for one student's finalized attempt against
 * every other student's eligible attempt on the SAME quiz (the "Individual
 * Rank vs. Average Score of All" feature).
 *
 * Privacy contract (student-facing, unlike the admin/mentor analytics):
 *  - The response carries ONLY the caller's own attempt plus aggregate
 *    statistics over the cohort — never another student's identity, score,
 *    user id or personal data.
 *  - Comparative statistics are withheld below MIN_COMPARISON_COHORT
 *    distinct students: with a tiny cohort, an average plus your own score
 *    can reconstruct another individual's result, so "insufficient data" is
 *    a privacy floor, not just a statistical nicety.
 *  - Cohort = registered QuizAttempts only (public-link GuestAttempts are
 *    not Eyeconic students and stay excluded, matching the leaderboard).
 */

// Smallest cohort for which aggregates are published. Tunable: raise for
// stricter k-anonymity, lower for earlier feedback on small batches.
const MIN_COMPARISON_COHORT = 5;

const FINALIZED_STATUSES = ['completed', 'auto_submitted'];

// Latest-attempt probe window: quizzes can be hard-deleted, so the "most
// recent eligible submission" skips attempts whose quiz no longer resolves.
const LATEST_ATTEMPT_SCAN_LIMIT = 10;

const ATTEMPT_PROJECTION =
  'student status endTime marksObtained totalMarks score totalQuestions ' +
  'answers.questionIndex answers.questionId answers.selectedAnswer answers.isCorrect ' +
  'answers.metadataSnapshot';

/**
 * Reduce a list of finalized attempts to one attempt per student — the
 * latest by endTime (deterministic _id tiebreak). Approved retests can leave
 * a student with two finalized attempts on the same quiz; counting both
 * would double-weight that student in every average and percentile.
 */
function dedupeLatestAttemptPerStudent(attempts) {
  const sorted = [...attempts].sort((a, b) => {
    const timeA = a.endTime ? new Date(a.endTime).getTime() : 0;
    const timeB = b.endTime ? new Date(b.endTime).getTime() : 0;
    if (timeB !== timeA) return timeB - timeA;
    return String(b._id).localeCompare(String(a._id));
  });

  const seen = new Set();
  const deduped = [];
  for (const attempt of sorted) {
    const key = String(attempt.student?._id || attempt.student);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(attempt);
  }
  return deduped;
}

/**
 * Per-subject correct/incorrect/skipped for one attempt, keyed by the
 * answer's frozen metadataSnapshot.subjectName (immune to later question
 * edits — same decoupling the model documents). Answers without a subject
 * snapshot (pre-snapshot legacy rows) are counted under 'General' so the
 * rows still add up to the attempt summary, mirroring the subject fallback
 * used at grading time.
 */
function subjectCountsForAttempt(attempt) {
  const counts = new Map();
  if (!Array.isArray(attempt.answers)) return counts;

  attempt.answers.forEach((answer) => {
    const questionType = resolveQuestionType(answer, null);
    const result = classifyAnswer(answer, questionType);
    const name =
      (answer.metadataSnapshot && answer.metadataSnapshot.subjectName) || 'General';

    let entry = counts.get(name);
    if (!entry) {
      entry = { correct: 0, incorrect: 0, skipped: 0 };
      counts.set(name, entry);
    }
    if (result.skipped) entry.skipped += 1;
    else if (result.correct) entry.correct += 1;
    else entry.incorrect += 1;
  });

  return counts;
}

/**
 * Subject-wise comparison rows for the caller vs the cohort. Every cohort
 * attempt is on the SAME quiz, so each subject has the same question count
 * in every attempt and per-subject marks (uniform quiz positive/negative
 * marking, exactly how finalizeQuizAttempt awards them) average cleanly.
 * Sort: most questions first, then name, so the biggest subjects lead.
 */
function buildSubjectComparison({ myAttempt, cohort, positiveMarks, negativeMarks }) {
  const positive = Number.isFinite(Number(positiveMarks)) ? Number(positiveMarks) : 4;
  const negative = Math.abs(Number.isFinite(Number(negativeMarks)) ? Number(negativeMarks) : 1);

  const subjectMarks = (entry) =>
    roundTo2(entry.correct * positive - entry.incorrect * negative);

  const aggregate = new Map(); // subjectName -> { questionCount, marksSum, attempts }
  const accumulate = (counts) => {
    counts.forEach((entry, name) => {
      let agg = aggregate.get(name);
      if (!agg) {
        agg = { questionCount: 0, marksSum: 0, attempts: 0 };
        aggregate.set(name, agg);
      }
      agg.attempts += 1;
      agg.marksSum += subjectMarks(entry);
      agg.questionCount = Math.max(agg.questionCount, entry.correct + entry.incorrect + entry.skipped);
    });
  };

  cohort.forEach((attempt) => accumulate(subjectCountsForAttempt(attempt)));

  const mine = myAttempt ? subjectCountsForAttempt(myAttempt) : new Map();

  return [...aggregate.entries()]
    .map(([subjectName, agg]) => {
      const my = mine.get(subjectName) || null;
      return {
        subjectName,
        questionCount: agg.questionCount,
        myMarks: my ? subjectMarks(my) : null,
        myCorrect: my ? my.correct : null,
        myIncorrect: my ? my.incorrect : null,
        mySkipped: my ? my.skipped : null,
        avgMarks: roundTo2(agg.marksSum / agg.attempts),
        cohortAttempts: agg.attempts,
      };
    })
    .sort((a, b) => {
      if (b.questionCount !== a.questionCount) return b.questionCount - a.questionCount;
      return a.subjectName.localeCompare(b.subjectName);
    });
}

function mapOwnAttemptSummary(attempt, stats) {
  return {
    _id: attempt._id,
    status: attempt.status,
    endTime: attempt.endTime,
    marksObtained: roundTo2(stats.marksObtained),
    totalMarks: stats.totalMarks,
    scorePercentage: stats.scorePercentage,
    accuracy: stats.accuracy,
    correct: stats.correct,
    incorrect: stats.incorrect,
    skipped: stats.skipped,
    attempted: stats.attempted,
    totalQuestions: stats.totalQuestions,
  };
}

/**
 * Build the full comparison payload for a student's most recent finalized
 * attempt. Returns a 200-shaped payload in every non-error case — the
 * "no eligible attempt yet" and "cohort too small" states are legitimate
 * results the dashboard renders, not failures.
 */
async function buildCohortComparison(studentId) {
  // Latest finalized attempts with just enough quiz meta to name the test;
  // skip any whose quiz record no longer resolves (hard-deleted tests).
  const recentAttempts = await QuizAttempt.find({
    student: studentId,
    status: { $in: FINALIZED_STATUSES },
  })
    .select('quiz endTime')
    .sort({ endTime: -1, _id: -1 })
    .limit(LATEST_ATTEMPT_SCAN_LIMIT);

  const quizIds = [...new Set(recentAttempts.map((a) => String(a.quiz)))];
  const quizzesById = new Map();
  if (quizIds.length > 0) {
    const quizzes = await Quiz.find({ _id: { $in: quizIds } })
      .select('title testType totalMarks positiveMarks negativeMarks isActive isDeleted')
      .lean();
    quizzes.forEach((quiz) => quizzesById.set(String(quiz._id), quiz));
  }

  const latestWithQuiz = recentAttempts.find((a) => quizzesById.has(String(a.quiz)));

  if (!latestWithQuiz) {
    return { hasEligibleAttempt: false };
  }

  const quiz = quizzesById.get(String(latestWithQuiz.quiz));

  // ONE query for the whole cohort (prefix of the {quiz, student} index);
  // everything else is computed in-memory from the shared analytics utils.
  const cohortAttempts = await QuizAttempt.find({
    quiz: quiz._id,
    status: { $in: FINALIZED_STATUSES },
  }).select(ATTEMPT_PROJECTION);

  const cohort = dedupeLatestAttemptPerStudent(cohortAttempts);

  const myAttempt = cohort.find(
    (a) => String(a.student?._id || a.student) === String(studentId)
  );
  if (!myAttempt) {
    // Defensive: the caller's attempt was in recentAttempts, so this should
    // be unreachable — but never emit a payload without an own attempt.
    return { hasEligibleAttempt: false };
  }

  const myStats = computeAttemptStats(myAttempt);

  const marksList = cohort.map((a) => Number(a.marksObtained || 0));
  const averageMarks =
    marksList.length > 0
      ? roundTo2(marksList.reduce((sum, v) => sum + v, 0) / marksList.length)
      : null;
  const percentageList = cohort
    .map((a) => computeScorePercentage(a.marksObtained, a.totalMarks))
    .filter((v) => v !== null);
  const averageScorePercentage =
    percentageList.length > 0
      ? roundTo2(percentageList.reduce((s, v) => s + v, 0) / percentageList.length)
      : null;

  const sufficient = cohort.length >= MIN_COMPARISON_COHORT;

  // Percentile convention matches the admin test-report CSV
  // (utils/analytics.js computePercentile with excludeSelf): the share of
  // OTHER students strictly below the caller's marks. topPercent is its
  // complement — "You are in the Top X%".
  const percentile = sufficient
    ? computePercentile(cohort, myAttempt, { excludeSelf: true })
    : null;

  return {
    hasEligibleAttempt: true,
    quiz: {
      _id: quiz._id,
      title: quiz.title,
      testType: quiz.testType,
      totalMarks: quiz.totalMarks,
    },
    attempt: mapOwnAttemptSummary(myAttempt, myStats),
    cohort: {
      totalStudents: cohort.length,
      minCohortSize: MIN_COMPARISON_COHORT,
      sufficient,
      averageMarks: sufficient ? averageMarks : null,
      averageScorePercentage: sufficient ? averageScorePercentage : null,
      highestMarks: sufficient ? roundTo2(Math.max(...marksList)) : null,
      percentile,
      topPercent: percentile !== null ? roundTo2(100 - percentile) : null,
      scoreDistribution: sufficient ? computeScoreDistribution(cohort) : null,
      subjectWise: sufficient
        ? buildSubjectComparison({
            myAttempt,
            cohort,
            positiveMarks: quiz.positiveMarks,
            negativeMarks: quiz.negativeMarks,
          })
        : null,
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  MIN_COMPARISON_COHORT,
  buildCohortComparison,
  dedupeLatestAttemptPerStudent,
  buildSubjectComparison,
};
