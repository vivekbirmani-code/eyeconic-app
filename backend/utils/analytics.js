const { QUESTION_TYPES } = require('../constants/question');
const { isAnswered } = require('./grading');

/** Score distribution buckets (inclusive boundaries). */
const SCORE_DISTRIBUTION_BUCKETS = Object.freeze([
  { label: '0–20%', min: 0, max: 20 },
  { label: '21–40%', min: 21, max: 40 },
  { label: '41–60%', min: 41, max: 60 },
  { label: '61–80%', min: 61, max: 80 },
  { label: '81–100%', min: 81, max: 100 },
]);

const STRENGTH_MIN_ATTEMPTED = 3;

function roundTo2(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Marks-based score percentage: marksObtained / totalMarks * 100.
 * Returns null when totalMarks is zero or invalid.
 */
function computeScorePercentage(marksObtained, totalMarks) {
  const obtained = Number(marksObtained);
  const total = Number(totalMarks);
  if (!Number.isFinite(obtained) || !Number.isFinite(total) || total <= 0) return null;
  return roundTo2((obtained / total) * 100);
}

/**
 * Question accuracy: correct / attempted * 100.
 * Skipped questions are excluded from the denominator.
 * Returns null when attempted is zero.
 */
function computeAccuracy(correct, attempted) {
  const c = Number(correct);
  const a = Number(attempted);
  if (!Number.isFinite(c) || !Number.isFinite(a) || a <= 0) return null;
  return roundTo2((c / a) * 100);
}

function resolveQuestionType(answer, question) {
  return (
    answer?.metadataSnapshot?.questionType ||
    question?.questionType ||
    QUESTION_TYPES.MCQ_SINGLE
  );
}

/**
 * Classify a single answer using stored isCorrect and type-aware isAnswered.
 * Never re-grades against live Question Bank data.
 */
function classifyAnswer(answer, questionType) {
  if (!answer) {
    return { answered: false, correct: false, incorrect: false, skipped: true };
  }

  const answered = isAnswered(questionType, answer.selectedAnswer);
  if (!answered) {
    return { answered: false, correct: false, incorrect: false, skipped: true };
  }

  const correct = answer.isCorrect === true;
  return {
    answered: true,
    correct,
    incorrect: !correct,
    skipped: false,
  };
}

/**
 * Compute C/W/S and canonical metrics for one attempt.
 * @param {object} attempt - QuizAttempt document
 * @param {object[]} [questions] - populated quiz.questions (for questionType fallback)
 */
function computeAttemptStats(attempt, questions = []) {
  const totalQuestions = Number(
    attempt.totalQuestions || questions.length || 0
  );

  let correct = 0;
  let incorrect = 0;
  let skipped = 0;

  if (totalQuestions > 0) {
    for (let index = 0; index < totalQuestions; index += 1) {
      const answer = Array.isArray(attempt.answers)
        ? attempt.answers.find((a) => a.questionIndex === index)
        : null;
      const question = questions[index];
      const questionType = resolveQuestionType(answer, question);
      const result = classifyAnswer(answer, questionType);

      if (result.skipped) skipped += 1;
      else if (result.correct) correct += 1;
      else incorrect += 1;
    }
  } else if (Array.isArray(attempt.sectionPerformance) && attempt.sectionPerformance.length > 0) {
    attempt.sectionPerformance.forEach((section) => {
      correct += Number(section.correct || 0);
      incorrect += Number(section.incorrect || 0);
      skipped += Number(section.skipped || 0);
    });
  } else {
    correct = Number(attempt.score || 0);
    const answeredFromAnswers = Array.isArray(attempt.answers)
      ? attempt.answers.filter((ans) => {
          const qType = resolveQuestionType(ans, null);
          return isAnswered(qType, ans.selectedAnswer);
        }).length
      : correct;
    incorrect = Math.max(0, answeredFromAnswers - correct);
    skipped = Math.max(0, totalQuestions - answeredFromAnswers);
  }

  const attempted = correct + incorrect;
  const marksObtained = Number(attempt.marksObtained || 0);
  const totalMarks = Number(attempt.totalMarks || 0);

  return {
    correct,
    incorrect,
    skipped,
    attempted,
    totalQuestions,
    marksObtained,
    totalMarks,
    scorePercentage: computeScorePercentage(marksObtained, totalMarks),
    accuracy: computeAccuracy(correct, attempted),
    /** Legacy alias: marks-based percentage (same as scorePercentage, 0 when null). */
    percentage: computeScorePercentage(marksObtained, totalMarks) ?? 0,
  };
}

function getAttemptDurationMinutes(attempt) {
  if (!attempt?.startTime || !attempt?.endTime) return null;
  const ms = new Date(attempt.endTime) - new Date(attempt.startTime);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return roundTo2(ms / 1000 / 60);
}

/**
 * Raw (unrounded) duration in minutes; missing/invalid durations are 0.
 * Aggregate metrics must sum THIS and round only the final average — summing
 * pre-rounded per-attempt values drifts the average (1s + 3s attempts:
 * 0.0333 -> 0.03 raw, but 0.02 + 0.05 -> 0.04 pre-rounded).
 */
function getRawAttemptDurationMinutes(attempt) {
  if (!attempt?.startTime || !attempt?.endTime) return 0;
  const ms = new Date(attempt.endTime) - new Date(attempt.startTime);
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return ms / 1000 / 60;
}

/**
 * Per-question analytics across completed attempts.
 * Percentages use completed attempts as denominator.
 */
function computeQuestionAnalytics(attempts, questions) {
  const sampleSize = attempts.length;

  return questions.map((question, index) => {
    let correctCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;

    attempts.forEach((attempt) => {
      const answer = Array.isArray(attempt.answers)
        ? attempt.answers.find((a) => a.questionIndex === index)
        : null;
      const questionType = resolveQuestionType(answer, question);
      const result = classifyAnswer(answer, questionType);

      if (result.skipped) skippedCount += 1;
      else if (result.correct) correctCount += 1;
      else wrongCount += 1;
    });

    const denominator = sampleSize || 1;
    return {
      questionNumber: index + 1,
      questionText: (question.question || '').substring(0, 100),
      topicName: question.topicName || '',
      subjectName: question.subject?.name || '',
      correctCount,
      wrongCount,
      skippedCount,
      sampleSize,
      percentCorrect: sampleSize > 0 ? roundTo2((correctCount / denominator) * 100) : 0,
      percentWrong: sampleSize > 0 ? roundTo2((wrongCount / denominator) * 100) : 0,
      percentSkipped: sampleSize > 0 ? roundTo2((skippedCount / denominator) * 100) : 0,
      correctRate: sampleSize > 0 ? roundTo2((correctCount / denominator) * 100) : 0,
    };
  });
}

function findEasiestHardestQuestions(questionAnalytics) {
  const withSample = questionAnalytics.filter((q) => q.sampleSize > 0);
  if (withSample.length === 0) {
    return { easiest: null, hardest: null };
  }

  const sorted = [...withSample].sort((a, b) => {
    if (b.correctRate !== a.correctRate) return b.correctRate - a.correctRate;
    if (a.wrongCount !== b.wrongCount) return a.wrongCount - b.wrongCount;
    return a.questionNumber - b.questionNumber;
  });

  const easiest = sorted[0];
  const hardest = [...withSample].sort((a, b) => {
    if (a.correctRate !== b.correctRate) return a.correctRate - b.correctRate;
    if (b.wrongCount !== a.wrongCount) return b.wrongCount - a.wrongCount;
    return a.questionNumber - b.questionNumber;
  })[0];

  return {
    easiest: {
      questionNumber: easiest.questionNumber,
      topicName: easiest.topicName,
      correctRate: easiest.correctRate,
      sampleSize: easiest.sampleSize,
      correctCount: easiest.correctCount,
    },
    hardest: {
      questionNumber: hardest.questionNumber,
      topicName: hardest.topicName,
      correctRate: hardest.correctRate,
      sampleSize: hardest.sampleSize,
      correctCount: hardest.correctCount,
    },
  };
}

function assignScoreBucket(scorePercentage) {
  if (scorePercentage === null || scorePercentage === undefined) {
    return null;
  }
  const pct = Number(scorePercentage);
  if (!Number.isFinite(pct)) return null;

  if (pct <= 20) return SCORE_DISTRIBUTION_BUCKETS[0];
  if (pct <= 40) return SCORE_DISTRIBUTION_BUCKETS[1];
  if (pct <= 60) return SCORE_DISTRIBUTION_BUCKETS[2];
  if (pct <= 80) return SCORE_DISTRIBUTION_BUCKETS[3];
  return SCORE_DISTRIBUTION_BUCKETS[4];
}

function computeScoreDistribution(attempts) {
  const distribution = SCORE_DISTRIBUTION_BUCKETS.map((bucket) => ({
    label: bucket.label,
    min: bucket.min,
    max: bucket.max,
    count: 0,
  }));

  attempts.forEach((attempt) => {
    const stats = computeAttemptStats(attempt);
    const bucket = assignScoreBucket(stats.scorePercentage);
    if (!bucket) return;
    const idx = SCORE_DISTRIBUTION_BUCKETS.findIndex((b) => b.label === bucket.label);
    if (idx >= 0) distribution[idx].count += 1;
  });

  return distribution;
}

/**
 * Test-level overview KPIs across the full analytics cohort.
 *
 * completionRate measures the ASSIGNED cohort: of the registered students the
 * test was assigned to, how many completed it. Public guests were never
 * assigned, so they neither dilute nor inflate it — pass registeredCount when
 * the cohort includes guests. Tests with no assignments (public links) have no
 * completion rate at all: null, rendered as "—" (not a misleading 0%).
 */
function computeTestOverview(
  attempts,
  totalAssigned,
  { registeredCount = null } = {}
) {
  const totalAttempted = attempts.length;
  const assignedCompleted = registeredCount === null ? totalAttempted : registeredCount;
  const completionRate =
    totalAssigned > 0 ? roundTo2((assignedCompleted / totalAssigned) * 100) : null;

  const marksList = attempts.map((a) => Number(a.marksObtained || 0));
  const avgMarks =
    marksList.length > 0
      ? roundTo2(marksList.reduce((sum, v) => sum + v, 0) / marksList.length)
      : 0;
  const highestMarks = marksList.length > 0 ? roundTo2(Math.max(...marksList)) : 0;
  const lowestMarks = marksList.length > 0 ? roundTo2(Math.min(...marksList)) : 0;

  const scorePercentages = attempts
    .map((a) => computeScorePercentage(a.marksObtained, a.totalMarks))
    .filter((v) => v !== null);
  const accuracies = attempts
    .map((a) => computeAttemptStats(a).accuracy)
    .filter((v) => v !== null);

  const avgScorePercentage =
    scorePercentages.length > 0
      ? roundTo2(scorePercentages.reduce((s, v) => s + v, 0) / scorePercentages.length)
      : null;
  const avgAccuracy =
    accuracies.length > 0
      ? roundTo2(accuracies.reduce((s, v) => s + v, 0) / accuracies.length)
      : null;

  const totalMarksValues = attempts.map((a) => Number(a.totalMarks || 0));
  const avgTotalMarks =
    totalMarksValues.length > 0
      ? roundTo2(totalMarksValues.reduce((s, v) => s + v, 0) / totalMarksValues.length)
      : 0;

  return {
    totalAssigned,
    totalAttempted,
    completionRate,
    avgScore: avgMarks,
    highestScore: highestMarks,
    lowestScore: lowestMarks,
    avgScorePercentage,
    avgAccuracy,
    averageMarks: avgMarks,
    totalMarks: avgTotalMarks,
  };
}

function computePerformanceMetricsAverages(attempts, questions, totalQuestions) {
  if (attempts.length === 0) {
    return {
      totalQuestions,
      avgCorrect: 0,
      avgWrong: 0,
      avgSkipped: 0,
      avgTime: 0,
      attemptCount: 0,
    };
  }

  let sumCorrect = 0;
  let sumWrong = 0;
  let sumSkipped = 0;
  let sumTime = 0;

  attempts.forEach((attempt) => {
    const stats = computeAttemptStats(attempt, questions);
    sumCorrect += stats.correct;
    sumWrong += stats.incorrect;
    sumSkipped += stats.skipped;
    // Raw durations, missing ones count as 0 — the historical export
    // contract (see getRawAttemptDurationMinutes).
    sumTime += getRawAttemptDurationMinutes(attempt);
  });

  const count = attempts.length;
  return {
    totalQuestions,
    avgCorrect: roundTo2(sumCorrect / count),
    avgWrong: roundTo2(sumWrong / count),
    avgSkipped: roundTo2(sumSkipped / count),
    avgTime: roundTo2(sumTime / count),
    attemptCount: count,
    totalCorrect: sumCorrect,
    totalWrong: sumWrong,
    totalSkipped: sumSkipped,
  };
}

/**
 * Single source of truth for test-level analytics. Every aggregate the app's
 * Test Analytics screen renders AND the CSV/Excel reports export is computed
 * here from ONE attempts array, so the surfaces can never drift apart.
 *
 * `attempts` is the full analytics cohort: registered QuizAttempts plus, for
 * admin callers, public GuestAttempts (guests are first-class attempts for
 * aggregation — GuestAttempt stores the same graded answers/marks/timing
 * shape). Guest EXCLUSION from rankings/leaderboards is a caller concern, not
 * an aggregation concern.
 *
 * `registeredCount` scopes the completion rate to the assigned cohort
 * (see computeTestOverview); pass it whenever guests may be in `attempts`.
 */
function computeTestAnalytics(
  attempts,
  questions,
  { totalAssigned = 0, registeredCount = null } = {}
) {
  const questionAnalytics = computeQuestionAnalytics(attempts, questions);
  const { easiest, hardest } = findEasiestHardestQuestions(questionAnalytics);

  return {
    overview: computeTestOverview(attempts, totalAssigned, { registeredCount }),
    performanceMetrics: computePerformanceMetricsAverages(
      attempts,
      questions,
      questions.length
    ),
    questionAnalytics,
    easiestQuestion: easiest,
    hardestQuestion: hardest,
    scoreDistribution: computeScoreDistribution(attempts),
  };
}

function computePercentile(sortedByMarks, attempt, { excludeSelf = false } = {}) {
  const marks = Number(attempt.marksObtained || 0);
  const total = sortedByMarks.length;
  if (total === 0) return 0;
  const belowCount = sortedByMarks.filter((a) => {
    if (excludeSelf && String(a._id) === String(attempt._id)) return false;
    return Number(a.marksObtained || 0) < marks;
  }).length;
  const denominator = excludeSelf ? Math.max(1, total - 1) : total;
  return roundTo2((belowCount / denominator) * 100);
}

/**
 * Leaderboard ordering shared by EVERY ranked surface:
 * scorePercentage desc → accuracy desc → marksObtained desc → endTime asc → identity id asc.
 * `entry.attempt.student._id` is the populated student id for registered
 * attempts and the lead id for guest attempts (via the synthetic identity
 * rankLeaderboardParticipants attaches), so ordering stays deterministic in
 * mixed cohorts.
 */
function compareLeaderboardEntries(a, b) {
  const spA = a.stats.scorePercentage ?? -1;
  const spB = b.stats.scorePercentage ?? -1;
  if (spB !== spA) return spB - spA;

  const accA = a.stats.accuracy ?? -1;
  const accB = b.stats.accuracy ?? -1;
  if (accB !== accA) return accB - accA;

  const marksA = a.stats.marksObtained;
  const marksB = b.stats.marksObtained;
  if (marksB !== marksA) return marksB - marksA;

  const timeA = a.attempt.endTime ? new Date(a.attempt.endTime).getTime() : Infinity;
  const timeB = b.attempt.endTime ? new Date(b.attempt.endTime).getTime() : Infinity;
  if (timeA !== timeB) return timeA - timeB;

  const idA = String(a.attempt.student?._id || a.attempt.student || '');
  const idB = String(b.attempt.student?._id || b.attempt.student || '');
  return idA.localeCompare(idB);
}

/** One leaderboard row — the exact shape rankStudentAttempts has always returned. */
function buildRankedAttemptRow({ attempt, stats }, index, includeRank) {
  return {
    _id: attempt._id,
    student: attempt.student
      ? {
          _id: attempt.student._id,
          name: attempt.student.name,
          email: attempt.student.email,
        }
      : null,
    studentId: attempt.student?._id,
    studentName: attempt.student?.name || 'Unknown',
    studentEmail: attempt.student?.email || '',
    score: attempt.score || stats.correct,
    totalQuestions: stats.totalQuestions,
    marksObtained: stats.marksObtained,
    totalMarks: stats.totalMarks,
    scorePercentage: stats.scorePercentage,
    accuracy: stats.accuracy,
    correct: stats.correct,
    incorrect: stats.incorrect,
    skipped: stats.skipped,
    attempted: stats.attempted,
    percentage: stats.percentage,
    timeSpent: getAttemptDurationMinutes(attempt) ?? 0,
    completedAt: attempt.endTime,
    endTime: attempt.endTime,
    tabSwitchCount: attempt.tabSwitchCount || 0,
    rank: includeRank ? index + 1 : null,
  };
}

/**
 * Deterministic ranking with tie-breakers:
 * scorePercentage desc → accuracy desc → marksObtained desc → endTime asc → studentId asc
 */
function rankStudentAttempts(attempts, questions = []) {
  const enriched = attempts.map((attempt) => {
    const stats = computeAttemptStats(attempt, questions);
    return { attempt, stats };
  });

  enriched.sort(compareLeaderboardEntries);

  const includeRank = enriched.length > 1;

  return enriched.map((entry, index) => buildRankedAttemptRow(entry, index, includeRank));
}

/**
 * Unified LIVE-leaderboard ranking: registered QuizAttempts and public-quiz
 * guest attempts ranked together by the SAME rules (one comparator —
 * compareLeaderboardEntries — so the merged board can never disagree with the
 * registered-only board about ordering). Every row additionally carries
 * `participantType: 'internal' | 'external'`; external rows carry `guestId`
 * (the verified lead's id) and a null `student`/`studentId` — the lead
 * identity surfaces through studentName/studentEmail only, so a guest row can
 * never be mistaken for a student-account row. rankStudentAttempts itself
 * stays registered-only — the static analytics/export surfaces are unchanged.
 *
 * `guestEntries` are `{ attempt, identity: {_id, name, email} }` rows built by
 * fetchGuestLeaderboardAttempts (lead snapshots first, live lead fallback).
 */
function rankLeaderboardParticipants(registeredAttempts, guestEntries = [], questions = []) {
  const enriched = registeredAttempts.map((attempt) => ({
    attempt,
    stats: computeAttemptStats(attempt, questions),
    participantType: 'internal',
  }));

  guestEntries.forEach(({ attempt, identity }) => {
    enriched.push({
      // Synthetic student, never a mutation of the lean guest doc: it gives
      // the shared comparator a deterministic tie-break id (the lead id) and
      // buildRankedAttemptRow the name/email the row renders.
      attempt: { ...attempt, student: identity },
      stats: computeAttemptStats(attempt, questions),
      participantType: 'external',
      identity,
    });
  });

  enriched.sort(compareLeaderboardEntries);

  const includeRank = enriched.length > 1;

  return enriched.map((entry, index) => {
    const row = buildRankedAttemptRow(entry, index, includeRank);
    row.participantType = entry.participantType;
    if (entry.participantType === 'external') {
      // Guests have no student account: the synthetic identity was only for
      // sorting/row assembly, so strip it here — the lead id rides `guestId`
      // alone and a `studentId` can never be mistaken for a User id.
      row.student = null;
      row.studentId = null;
      row.guestId = entry.identity._id;
    }
    return row;
  });
}

function parseDateRange(range) {
  if (!range) return null;
  const normalized = String(range).toLowerCase().trim();
  const daysMap = { '7d': 7, '30d': 30, '90d': 90 };
  const days = daysMap[normalized];
  if (!days) return null;

  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return { start, end, days };
}

function filterAttemptsByDateRange(attempts, range) {
  const parsed = parseDateRange(range);
  if (!parsed) return attempts;
  return attempts.filter((attempt) => {
    if (!attempt.endTime) return false;
    const end = new Date(attempt.endTime);
    if (Number.isNaN(end.getTime())) return false;
    return end >= parsed.start && end <= parsed.end;
  });
}

function aggregateStudentSummary(attempts) {
  const totalTests = attempts.length;
  if (totalTests === 0) {
    return {
      totalTests: 0,
      totalMarks: 0,
      obtainedMarks: 0,
      avgPercentage: 0,
      avgScorePercentage: null,
      avgAccuracy: null,
      totalCorrect: 0,
      totalIncorrect: 0,
      totalSkipped: 0,
      totalAttempted: 0,
      totalQuestions: 0,
    };
  }

  let totalMarks = 0;
  let obtainedMarks = 0;
  let totalCorrect = 0;
  let totalIncorrect = 0;
  let totalSkipped = 0;
  let totalAttempted = 0;
  let totalQuestions = 0;
  const scorePercentages = [];
  const accuracies = [];

  attempts.forEach((attempt) => {
    const stats = computeAttemptStats(attempt);
    totalMarks += stats.totalMarks;
    obtainedMarks += stats.marksObtained;
    totalCorrect += stats.correct;
    totalIncorrect += stats.incorrect;
    totalSkipped += stats.skipped;
    totalAttempted += stats.attempted;
    totalQuestions += stats.totalQuestions;
    if (stats.scorePercentage !== null) scorePercentages.push(stats.scorePercentage);
    if (stats.accuracy !== null) accuracies.push(stats.accuracy);
  });

  const avgScorePercentage =
    scorePercentages.length > 0
      ? roundTo2(scorePercentages.reduce((s, v) => s + v, 0) / scorePercentages.length)
      : null;
  const avgAccuracy =
    accuracies.length > 0
      ? roundTo2(accuracies.reduce((s, v) => s + v, 0) / accuracies.length)
      : null;
  const avgPercentage = totalMarks > 0 ? roundTo2((obtainedMarks / totalMarks) * 100) : 0;

  return {
    totalTests,
    totalMarks: roundTo2(totalMarks),
    obtainedMarks: roundTo2(obtainedMarks),
    avgPercentage,
    avgScorePercentage,
    avgAccuracy,
    totalCorrect,
    totalIncorrect,
    totalSkipped,
    totalAttempted,
    totalQuestions,
  };
}

function aggregateSubjectStats(attempts) {
  const subjectMap = {};

  attempts.forEach((attempt) => {
    const subId = attempt.quiz?.subject?._id?.toString() || attempt.quiz?.subject?.toString() || 'unknown';
    const subName = attempt.quiz?.subject?.name || 'General';
    const stats = computeAttemptStats(attempt);

    if (!subjectMap[subId]) {
      subjectMap[subId] = {
        subjectId: subId,
        subjectName: subName,
        tests: 0,
        totalMarks: 0,
        obtainedMarks: 0,
        totalCorrect: 0,
        totalIncorrect: 0,
        totalSkipped: 0,
        totalAttempted: 0,
        totalQuestions: 0,
        attempts: [],
      };
    }

    const entry = subjectMap[subId];
    entry.tests += 1;
    entry.totalMarks += stats.totalMarks;
    entry.obtainedMarks += stats.marksObtained;
    entry.totalCorrect += stats.correct;
    entry.totalIncorrect += stats.incorrect;
    entry.totalSkipped += stats.skipped;
    entry.totalAttempted += stats.attempted;
    entry.totalQuestions += stats.totalQuestions;
    entry.attempts.push({
      _id: attempt._id,
      quizTitle: attempt.quiz?.title || 'Untitled',
      quizId: attempt.quiz?._id,
      testType: attempt.quiz?.testType || 'daily',
      score: attempt.score,
      totalQuestions: stats.totalQuestions,
      marksObtained: stats.marksObtained,
      totalMarks: stats.totalMarks,
      scorePercentage: stats.scorePercentage,
      accuracy: stats.accuracy,
      correct: stats.correct,
      incorrect: stats.incorrect,
      skipped: stats.skipped,
      attempted: stats.attempted,
      percentage: stats.percentage,
      endTime: attempt.endTime,
    });
  });

  return Object.values(subjectMap).map((s) => ({
    ...s,
    totalMarks: roundTo2(s.totalMarks),
    obtainedMarks: roundTo2(s.obtainedMarks),
    marksObtained: roundTo2(s.obtainedMarks),
    scorePercentage: computeScorePercentage(s.obtainedMarks, s.totalMarks),
    accuracy: computeAccuracy(s.totalCorrect, s.totalAttempted),
    /** Legacy: question-count accuracy (correct / totalQuestions). */
    percentage:
      s.totalQuestions > 0 ? roundTo2((s.totalCorrect / s.totalQuestions) * 100) : 0,
  }));
}

function computePerformanceBuckets(rows) {
  const buckets = {
    bySubject: new Map(),
    byTopic: new Map(),
    bySubtopic: new Map(),
    bySystem: new Map(),
    byQuestionType: new Map(),
    byTag: new Map(),
    byDifficulty: new Map(),
  };

  const bump = (map, key, isCorrect, skipped) => {
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, { attempted: 0, correct: 0, incorrect: 0, skipped: 0 });
    }
    const entry = map.get(key);
    if (skipped) {
      entry.skipped += 1;
      return;
    }
    entry.attempted += 1;
    if (isCorrect) entry.correct += 1;
    else entry.incorrect += 1;
  };

  let totalAttempted = 0;
  let totalCorrect = 0;
  let totalIncorrect = 0;
  let totalSkipped = 0;

  rows.forEach((row) => {
    const snap = row.snapshot || {};
    const skipped = !isAnswered(snap.questionType, row.selectedAnswer);
    if (skipped) {
      totalSkipped += 1;
    } else {
      totalAttempted += 1;
      if (row.isCorrect) totalCorrect += 1;
      else totalIncorrect += 1;
    }

    bump(buckets.bySubject, snap.subjectName, row.isCorrect, skipped);
    bump(buckets.byTopic, snap.topicName, row.isCorrect, skipped);
    bump(buckets.bySubtopic, snap.subtopicName, row.isCorrect, skipped);
    bump(buckets.bySystem, snap.system, row.isCorrect, skipped);
    bump(buckets.byQuestionType, snap.questionType, row.isCorrect, skipped);
    bump(buckets.byDifficulty, snap.difficulty, row.isCorrect, skipped);
    (snap.tags || []).forEach((tag) => bump(buckets.byTag, tag, row.isCorrect, skipped));
  });

  const toArray = (map) =>
    [...map.entries()]
      .map(([key, v]) => ({
        key,
        attempted: v.attempted,
        correct: v.correct,
        incorrect: v.incorrect,
        skipped: v.skipped,
        accuracy: computeAccuracy(v.correct, v.attempted),
      }))
      .sort((a, b) => b.attempted - a.attempted);

  return {
    overall: {
      attempted: totalAttempted,
      correct: totalCorrect,
      incorrect: totalIncorrect,
      skipped: totalSkipped,
      accuracy: computeAccuracy(totalCorrect, totalAttempted),
    },
    bySubject: toArray(buckets.bySubject),
    byTopic: toArray(buckets.byTopic),
    bySubtopic: toArray(buckets.bySubtopic),
    bySystem: toArray(buckets.bySystem),
    byQuestionType: toArray(buckets.byQuestionType),
    byTag: toArray(buckets.byTag),
    byDifficulty: toArray(buckets.byDifficulty),
  };
}

function computeStrengthsWeaknesses(buckets, minAttempted = STRENGTH_MIN_ATTEMPTED) {
  const eligible = buckets.filter(
    (b) => b.attempted >= minAttempted && b.accuracy !== null
  );

  const sorted = [...eligible].sort((a, b) => {
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    return b.attempted - a.attempted;
  });

  const strengths = sorted
    .filter((b) => b.accuracy >= 60)
    .slice(0, 3)
    .map((b) => ({
      key: b.key,
      accuracy: b.accuracy,
      attempted: b.attempted,
      correct: b.correct,
      label: 'Strong performance',
    }));

  const weaknesses = [...eligible]
    .sort((a, b) => {
      if (a.accuracy !== b.accuracy) return a.accuracy - b.accuracy;
      return b.attempted - a.attempted;
    })
    .filter((b) => b.accuracy < 60)
    .slice(0, 3)
    .map((b) => ({
      key: b.key,
      accuracy: b.accuracy,
      attempted: b.attempted,
      correct: b.correct,
      label: 'Needs attention',
    }));

  return { strengths, weaknesses, minAttempted };
}

function computeTrend(attempts) {
  const sorted = [...attempts]
    .filter((a) => a.endTime)
    .sort((a, b) => new Date(a.endTime) - new Date(b.endTime));

  return sorted.map((attempt) => {
    const stats = computeAttemptStats(attempt);
    return {
      attemptId: attempt._id,
      quizTitle: attempt.quiz?.title || 'Untitled',
      date: attempt.endTime,
      scorePercentage: stats.scorePercentage,
      accuracy: stats.accuracy,
      marksObtained: stats.marksObtained,
      totalMarks: stats.totalMarks,
    };
  });
}

function computeInsights({ attempts, summary, subjectStats = [] }) {
  const insights = [];
  const trend = computeTrend(attempts);

  if (trend.length >= 2) {
    const recent = trend.slice(-3);
    const scoreValues = recent
      .map((t) => t.scorePercentage)
      .filter((v) => v !== null);
    if (scoreValues.length >= 2) {
      const improving = scoreValues.every(
        (v, i) => i === 0 || v >= scoreValues[i - 1]
      );
      const declining = scoreValues.every(
        (v, i) => i === 0 || v <= scoreValues[i - 1]
      );
      if (improving && scoreValues[scoreValues.length - 1] > scoreValues[0]) {
        insights.push({
          type: 'trend_improving',
          message: 'Score percentage has improved over recent tests.',
        });
      } else if (declining && scoreValues[scoreValues.length - 1] < scoreValues[0]) {
        insights.push({
          type: 'trend_declining',
          message: 'Score percentage has declined over recent tests.',
        });
      }
    }
  }

  if (summary.avgScorePercentage !== null && summary.avgAccuracy !== null) {
    if (summary.avgAccuracy >= 60 && summary.avgScorePercentage < 50) {
      insights.push({
        type: 'negative_marking_impact',
        message:
          'Accuracy is relatively strong but score percentage is lower, which may reflect negative marking on incorrect answers.',
      });
    }
  }

  if (summary.totalAttempted > 0 && summary.totalQuestions > 0) {
    const skipRate = roundTo2((summary.totalSkipped / summary.totalQuestions) * 100);
    if (skipRate >= 20) {
      insights.push({
        type: 'high_skip_rate',
        message: `Skipped-question rate is ${skipRate}% across completed tests.`,
      });
    }
  }

  subjectStats.forEach((subject) => {
    const attempted = subject.totalAttempted ?? subject.attempted ?? 0;
    if (
      subject.accuracy !== null &&
      attempted >= STRENGTH_MIN_ATTEMPTED &&
      subject.accuracy < 50
    ) {
      insights.push({
        type: 'low_subject_accuracy',
        message: `${subject.subjectName} accuracy is ${subject.accuracy}% (${subject.totalCorrect}/${attempted} attempted).`,
      });
    }
  });

  return insights;
}

function computeMarksAwarded(isCorrect, isSkipped, positiveMarks, negativeMarks) {
  if (isSkipped) return 0;
  return isCorrect ? Number(positiveMarks || 0) : -Number(negativeMarks || 0);
}

module.exports = {
  SCORE_DISTRIBUTION_BUCKETS,
  STRENGTH_MIN_ATTEMPTED,
  roundTo2,
  computeScorePercentage,
  computeAccuracy,
  resolveQuestionType,
  classifyAnswer,
  computeAttemptStats,
  getAttemptDurationMinutes,
  computeQuestionAnalytics,
  findEasiestHardestQuestions,
  computeScoreDistribution,
  computeTestOverview,
  computePerformanceMetricsAverages,
  computeTestAnalytics,
  getRawAttemptDurationMinutes,
  computePercentile,
  rankStudentAttempts,
  rankLeaderboardParticipants,
  parseDateRange,
  filterAttemptsByDateRange,
  aggregateStudentSummary,
  aggregateSubjectStats,
  computePerformanceBuckets,
  computeStrengthsWeaknesses,
  computeTrend,
  computeInsights,
  computeMarksAwarded,
  isAnswered,
};
