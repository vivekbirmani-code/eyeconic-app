const mongoose = require('mongoose');
const Subject = require('../models/Subject');
const QuestionBank = require('../models/QuestionBank');
const Quiz = require('../models/Quiz');
const User = require('../models/User');
const {
  STRENGTH_MIN_ATTEMPTED,
  computeAccuracy,
  computeAttemptStats,
  computePercentile,
  computeScorePercentage,
  roundTo2,
  resolveQuestionType,
  classifyAnswer,
} = require('./analytics');
const { computeTimeTakenSeconds } = require('./questionHistory');

/**
 * Mini CCT (Mini Grand Test) — a fixed 30-question test, 10 each from
 * Psychiatry, Dermatology and Orthopaedics, generated from the Question Bank
 * and taken through the normal quiz engine (Quiz + QuizAttempt). This module
 * owns everything Mini-CCT-specific and nothing the engine already does:
 *
 *  - generation: resolve the three subjects, sample single-best-answer
 *    questions, assemble the shared Quiz (assignToAllFreeUsers);
 *  - analysis: the student-facing score dashboard (subject comparison vs the
 *    database average, percentile, tier, topic & concept-tag breakdowns)
 *    computed purely from finalized attempts.
 *
 * A Mini CCT is identified by `quiz.testType === MINI_CCT_TEST_TYPE`.
 */

const MINI_CCT_TEST_TYPE = 'mini';
const MINI_CCT_TEST_TYPE_LABEL = 'Mini CCT';
const MINI_CCT_SUBJECT_NAMES = Object.freeze(['Psychiatry', 'Dermatology', 'Orthopaedics']);
const QUESTIONS_PER_SUBJECT = 10;
const MINI_CCT_TOTAL_QUESTIONS = QUESTIONS_PER_SUBJECT * MINI_CCT_SUBJECT_NAMES.length;
const DEFAULT_DURATION_MINUTES = 30;
const DEFAULT_POSITIVE_MARKS = 4;
const DEFAULT_NEGATIVE_MARKS = 1;

// Question types the web/app single-best-answer player renders cleanly.
const MINI_CCT_QUESTION_TYPES = Object.freeze(['mcq_single', 'image_based', 'assertion_reason']);

// Concept tags: the 1–3 human-meaningful tags a question carries. QuestionBank
// tags also hold provenance markers appended by the Excel import path
// ('excel-import', 'quiz:<title>') which are NOT concepts and must never
// appear in tag analytics.
const MAX_CONCEPT_TAGS = 3;
const PROVENANCE_TAG_EXACT = new Set(['excel-import', 'import']);
const PROVENANCE_TAG_PREFIXES = ['quiz:'];

// Same privacy floor as the cohort comparison: comparative statistics against
// the "database average" are withheld below this many distinct students.
const MIN_COMPARISON_COHORT = 5;

// Tier bands on the attempt's own accuracy (correct / attempted). Accuracy,
// not score percentage, so tiers are not distorted by negative marking on
// brave attempts.
const TIERS = Object.freeze([
  { key: 'excellent', label: 'Excellent', minAccuracy: 75 },
  { key: 'strong', label: 'Strong', minAccuracy: 60 },
  { key: 'developing', label: 'Developing', minAccuracy: 40 },
  { key: 'needs_focus', label: 'Needs Focus', minAccuracy: 0 },
]);

// Analysis sections withheld from free users (their dashboard shows the score
// summary, subject table and tier only — roughly one third of the analysis).
const GATED_SECTIONS = Object.freeze([
  'cohort-comparison',
  'question-heatmap',
  'topic-analysis',
  'tag-analysis',
]);

const FINALIZED_STATUSES = Object.freeze(['completed', 'auto_submitted']);

// ── label normalization ─────────────────────────────────────────────────────

/** Collapse embedded newlines/runs of whitespace (import artifacts) to single spaces. */
function normalizeLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * The 1–3 concept tags of a question: provenance markers removed, whitespace
 * collapsed, case-insensitively deduped, capped at MAX_CONCEPT_TAGS.
 * Always an array (possibly empty — such questions still count towards
 * subject/topic analytics, just never towards tag analytics).
 */
function conceptTagsOf(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    const tag = normalizeLabel(raw);
    if (!tag) continue;
    if (PROVENANCE_TAG_EXACT.has(tag.toLowerCase())) continue;
    if (PROVENANCE_TAG_PREFIXES.some((prefix) => tag.toLowerCase().startsWith(prefix))) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_CONCEPT_TAGS) break;
  }
  return out;
}

// ── classification helpers ──────────────────────────────────────────────────

/**
 * Frozen classification for one answer slot: the answer's metadataSnapshot
 * (written at submit time, immune to later question edits) wins; the live
 * QuestionBank doc fills never-visited slots (no answer row exists for them).
 */
function classificationFor(questions, index, answer) {
  const question = questions[index] || null;
  const snapshot = answer && answer.metadataSnapshot ? answer.metadataSnapshot : {};
  return {
    subjectName: normalizeLabel(snapshot.subjectName)
      || normalizeLabel(question && question.subject && question.subject.name)
      || 'General',
    topicName: normalizeLabel(snapshot.topicName)
      || normalizeLabel(question && question.topicName)
      || null,
    tags: Array.isArray(snapshot.tags) && snapshot.tags.length > 0
      ? snapshot.tags
      : (question && Array.isArray(question.tags) ? question.tags : []),
  };
}

function emptyBucket() {
  return { questionCount: 0, attempted: 0, correct: 0, incorrect: 0, skipped: 0 };
}

/**
 * Per-subject correct/incorrect/skipped for one attempt (frozen snapshots).
 * Mirrors cohortComparison.subjectCountsForAttempt but keyed off an explicit
 * question list so never-visited questions (no answer row, no snapshot) are
 * still attributed to their real subject.
 */
function subjectCountsForAttempt(questions, attempt) {
  const counts = new Map();
  const total = questions.length;
  for (let index = 0; index < total; index += 1) {
    const answer = Array.isArray(attempt.answers)
      ? attempt.answers.find((a) => a.questionIndex === index)
      : null;
    const cls = classificationFor(questions, index, answer);
    let entry = counts.get(cls.subjectName);
    if (!entry) {
      entry = emptyBucket();
      counts.set(cls.subjectName, entry);
    }
    entry.questionCount += 1;
    const questionType = resolveQuestionType(answer, questions[index]);
    const result = classifyAnswer(answer, questionType);
    if (result.skipped) entry.skipped += 1;
    else {
      entry.attempted += 1;
      if (result.correct) entry.correct += 1;
      else entry.incorrect += 1;
    }
  }
  return counts;
}

function marksFor(entry, positiveMarks, negativeMarks) {
  return roundTo2(entry.correct * positiveMarks - entry.incorrect * negativeMarks);
}

// ── the analysis builder (pure) ─────────────────────────────────────────────

/**
 * Build the full Mini CCT analysis payload for one finalized attempt.
 *
 * @param {object} params
 * @param {object} params.attempt   finalized QuizAttempt (own answers/snapshots)
 * @param {object} params.quiz      the Mini CCT Quiz doc (title, marking)
 * @param {object[]} params.questions populated quiz.questions (subject → name)
 * @param {object[]} params.cohort  DEDUPED (latest per student) finalized
 *   attempts on the same quiz, INCLUDING the caller's own attempt — the
 *   "database average" convention. Percentile excludes self.
 * @returns the analysis payload (ungated — applyAnalysisAccess strips later)
 */
function buildMiniCctAnalysis({ attempt, quiz, questions, cohort }) {
  const positiveMarks = Number.isFinite(Number(quiz.positiveMarks))
    ? Number(quiz.positiveMarks) : DEFAULT_POSITIVE_MARKS;
  const negativeMarks = Math.abs(
    Number.isFinite(Number(quiz.negativeMarks)) ? Number(quiz.negativeMarks) : DEFAULT_NEGATIVE_MARKS
  );

  const stats = computeAttemptStats(attempt, questions);
  const timeTakenSeconds = computeTimeTakenSeconds(attempt);

  // ---- heatmap + topic/tag aggregation (one pass over the question list) --
  const heatmap = [];
  const topicBuckets = new Map(); // `${subject}::${topic}` → bucket
  const tagBuckets = new Map(); // tag label → bucket

  for (let index = 0; index < questions.length; index += 1) {
    const answer = Array.isArray(attempt.answers)
      ? attempt.answers.find((a) => a.questionIndex === index)
      : null;
    const cls = classificationFor(questions, index, answer);
    const questionType = resolveQuestionType(answer, questions[index]);
    const result = classifyAnswer(answer, questionType);
    const status = result.skipped ? 'skipped' : (result.correct ? 'correct' : 'incorrect');

    heatmap.push({
      questionIndex: index,
      questionId: (answer && answer.questionId ? answer.questionId
        : (questions[index] && questions[index]._id ? questions[index]._id : null)),
      subjectName: cls.subjectName,
      topicName: cls.topicName,
      status,
    });

    if (cls.topicName) {
      const key = `${cls.subjectName}::${cls.topicName}`;
      let topic = topicBuckets.get(key);
      if (!topic) {
        topic = { label: cls.topicName, subjectName: cls.subjectName, ...emptyBucket() };
        topicBuckets.set(key, topic);
      }
      topic.questionCount += 1;
      if (status === 'skipped') topic.skipped += 1;
      else if (status === 'correct') topic.correct += 1;
      else topic.incorrect += 1;
      if (status !== 'skipped') topic.attempted += 1;
    }

    for (const tag of conceptTagsOf(cls.tags)) {
      let entry = tagBuckets.get(tag);
      if (!entry) {
        entry = { label: tag, subjects: new Set(), ...emptyBucket() };
        tagBuckets.set(tag, entry);
      }
      entry.subjects.add(cls.subjectName);
      entry.questionCount += 1;
      if (status === 'skipped') entry.skipped += 1;
      else if (status === 'correct') entry.correct += 1;
      else entry.incorrect += 1;
      if (status !== 'skipped') entry.attempted += 1;
    }
  }

  // ---- cohort ("database") averages, same-quiz and deduped upstream --------
  const sufficient = cohort.length >= MIN_COMPARISON_COHORT;
  const cohortAggregate = new Map(); // subjectName → { marksSum, accuracySum, accuracyCount, attempts }
  cohort.forEach((cohortAttempt) => {
    subjectCountsForAttempt(questions, cohortAttempt).forEach((entry, subjectName) => {
      let agg = cohortAggregate.get(subjectName);
      if (!agg) {
        agg = { marksSum: 0, accuracySum: 0, accuracyCount: 0, attempts: 0 };
        cohortAggregate.set(subjectName, agg);
      }
      agg.attempts += 1;
      agg.marksSum += marksFor(entry, positiveMarks, negativeMarks);
      const accuracy = computeAccuracy(entry.correct, entry.correct + entry.incorrect);
      if (accuracy !== null) {
        agg.accuracySum += accuracy;
        agg.accuracyCount += 1;
      }
    });
  });

  const myCounts = subjectCountsForAttempt(questions, attempt);

  // Subject rows in quiz question order (generation orders the three subjects
  // deliberately); any stray subject still lands at the end, never dropped.
  const subjectOrder = [];
  const seenSubjects = new Set();
  questions.forEach((q) => {
    const name = normalizeLabel(q && q.subject && q.subject.name) || 'General';
    if (!seenSubjects.has(name)) {
      seenSubjects.add(name);
      subjectOrder.push(name);
    }
  });
  new Set([...myCounts.keys(), ...cohortAggregate.keys()]).forEach((name) => {
    if (!seenSubjects.has(name)) {
      seenSubjects.add(name);
      subjectOrder.push(name);
    }
  });

  const subjects = subjectOrder.map((subjectName) => {
    const mine = myCounts.get(subjectName) || { ...emptyBucket() };
    const agg = cohortAggregate.get(subjectName);
    return {
      subjectName,
      questionCount: mine.questionCount,
      correct: mine.correct,
      incorrect: mine.incorrect,
      skipped: mine.skipped,
      attempted: mine.attempted,
      accuracy: computeAccuracy(mine.correct, mine.attempted),
      marks: marksFor(mine, positiveMarks, negativeMarks),
      // Database averages — null until the cohort clears the privacy floor.
      cohortAvgMarks: sufficient && agg ? roundTo2(agg.marksSum / agg.attempts) : null,
      cohortAvgAccuracy: sufficient && agg && agg.accuracyCount > 0
        ? roundTo2(agg.accuracySum / agg.accuracyCount) : null,
      cohortAttempts: agg ? agg.attempts : 0,
    };
  });

  // ---- overall comparison + percentile --------------------------------------
  const marksList = cohort.map((a) => Number(a.marksObtained || 0));
  const percentageList = cohort
    .map((a) => computeScorePercentage(a.marksObtained, a.totalMarks))
    .filter((v) => v !== null);
  const cohortAccuracyList = cohort
    .map((a) => computeAttemptStats(a, questions).accuracy)
    .filter((v) => v !== null);

  const percentile = sufficient
    ? computePercentile(cohort, attempt, { excludeSelf: true })
    : null;

  const overall = {
    scorePercentage: stats.scorePercentage,
    accuracy: stats.accuracy,
    cohortAvgScorePercentage: sufficient && percentageList.length > 0
      ? roundTo2(percentageList.reduce((s, v) => s + v, 0) / percentageList.length) : null,
    cohortAvgAccuracy: sufficient && cohortAccuracyList.length > 0
      ? roundTo2(cohortAccuracyList.reduce((s, v) => s + v, 0) / cohortAccuracyList.length) : null,
  };

  // ---- tier + subject insight ------------------------------------------------
  const tier = resolveTier(stats.accuracy);

  const eligibleSubjects = subjects.filter((s) => s.attempted >= STRENGTH_MIN_ATTEMPTED);
  const strongest = eligibleSubjects.length > 0
    ? eligibleSubjects.reduce((best, s) => (
        (s.accuracy ?? -1) > (best.accuracy ?? -1)
          ? s
          : best
      )) : null;
  const needsImprovement = eligibleSubjects.length > 0
    ? eligibleSubjects.reduce((worst, s) => (
        (s.accuracy ?? 101) < (worst.accuracy ?? 101)
          ? s
          : worst
      )) : null;

  const insight = {
    tier,
    strongestSubject: strongest
      ? { subjectName: strongest.subjectName, accuracy: strongest.accuracy } : null,
    weakestSubject: needsImprovement
      ? { subjectName: needsImprovement.subjectName, accuracy: needsImprovement.accuracy } : null,
    message: buildInsightMessage({ tier, strongest, needsImprovement, attempted: stats.attempted }),
  };

  // ---- topics + tags ----------------------------------------------------------
  const topics = [...topicBuckets.values()]
    .map((topic) => ({ ...topic, accuracy: computeAccuracy(topic.correct, topic.attempted) }))
    .sort((a, b) => (b.questionCount - a.questionCount) || a.label.localeCompare(b.label));

  const overallAccuracy = stats.accuracy;
  const tags = [...tagBuckets.values()]
    .map((entry) => {
      const accuracy = computeAccuracy(entry.correct, entry.attempted);
      return {
        label: entry.label,
        subjects: [...entry.subjects],
        questionCount: entry.questionCount,
        attempted: entry.attempted,
        correct: entry.correct,
        incorrect: entry.incorrect,
        skipped: entry.skipped,
        accuracy,
        status: tagStatus(accuracy, overallAccuracy, entry.attempted),
      };
    })
    .sort((a, b) => (b.questionCount - a.questionCount) || a.label.localeCompare(b.label));

  return {
    quiz: {
      _id: quiz._id,
      title: quiz.title,
      testType: quiz.testType,
      totalMarks: quiz.totalMarks,
      positiveMarks,
      negativeMarks,
    },
    attempt: {
      _id: attempt._id,
      status: attempt.status,
      startTime: attempt.startTime,
      endTime: attempt.endTime,
      timeTakenSeconds,
    },
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
      timeTakenSeconds,
    },
    heatmap,
    subjects,
    overall,
    cohort: {
      totalStudents: cohort.length,
      minCohortSize: MIN_COMPARISON_COHORT,
      sufficient,
      percentile,
      topPercent: percentile !== null ? roundTo2(100 - percentile) : null,
      averageMarks: sufficient && marksList.length > 0
        ? roundTo2(marksList.reduce((s, v) => s + v, 0) / marksList.length) : null,
      averageScorePercentage: overall.cohortAvgScorePercentage,
      highestMarks: sufficient && marksList.length > 0 ? roundTo2(Math.max(...marksList)) : null,
    },
    insight,
    topics,
    tags,
    generatedAt: new Date().toISOString(),
  };
}

function resolveTier(accuracy) {
  if (accuracy === null || accuracy === undefined) return null;
  const found = TIERS.find((tier) => accuracy >= tier.minAccuracy);
  return found ? { key: found.key, label: found.label } : null;
}

/**
 * Tag strength rule (documented contract for "Revise These"):
 *  - weak   — accuracy strictly below the student's own overall accuracy
 *             (underperforming their own baseline on that concept);
 *  - strong — accuracy at or above max(67%, own overall accuracy) — solidly
 *             high in absolute terms AND not below their own level;
 *  - neutral otherwise.
 * With nothing attempted there is no baseline: every tag stays neutral.
 */
function tagStatus(accuracy, overallAccuracy, attempted) {
  if (attempted < 1 || accuracy === null) return 'neutral';
  if (overallAccuracy !== null && accuracy < overallAccuracy) return 'weak';
  if (accuracy >= Math.max(67, overallAccuracy ?? 0)) return 'strong';
  return 'neutral';
}

function buildInsightMessage({ tier, strongest, needsImprovement, attempted }) {
  if (attempted < 1) {
    return 'No questions were attempted — take the next Mini CCT to see your strengths.';
  }
  const parts = [];
  if (tier) parts.push(`Overall performance: ${tier.label}.`);
  if (strongest && strongest.accuracy !== null) {
    parts.push(`${strongest.subjectName} is your strongest subject (${strongest.accuracy}% accuracy).`);
  }
  if (needsImprovement && needsImprovement.accuracy !== null && (!strongest || strongest.subjectName !== needsImprovement.subjectName)) {
    parts.push(`Focus your revision on ${needsImprovement.subjectName} (${needsImprovement.accuracy}% accuracy).`);
  }
  return parts.join(' ');
}

// ── access gating (free users) ──────────────────────────────────────────────

/**
 * Strip the gated sections for a free user. Server-side on purpose: the
 * client only renders the lock UI, it never receives the gated data.
 * The score summary, own-subject rows and tier stay visible (~1/3).
 */
function applyAnalysisAccess(analysis, { isFreeUser }) {
  if (!isFreeUser) {
    return { ...analysis, access: { level: 'full', gatedSections: [] } };
  }
  return {
    ...analysis,
    heatmap: undefined,
    topics: undefined,
    tags: undefined,
    subjects: analysis.subjects.map((row) => ({
      ...row,
      cohortAvgMarks: null,
      cohortAvgAccuracy: null,
      cohortAttempts: 0,
    })),
    overall: {
      ...analysis.overall,
      cohortAvgScorePercentage: null,
      cohortAvgAccuracy: null,
    },
    cohort: {
      totalStudents: analysis.cohort.totalStudents,
      minCohortSize: analysis.cohort.minCohortSize,
      sufficient: analysis.cohort.sufficient,
      percentile: null,
      topPercent: null,
      averageMarks: null,
      averageScorePercentage: null,
      highestMarks: null,
    },
    access: {
      level: 'limited',
      gatedSections: GATED_SECTIONS,
      message: 'Full Mini CCT analysis — comparison with the database average, question heatmap and topic/tag deep-dive — is part of the Eyeconic Mentorship program.',
    },
  };
}

// ── generation (DB helpers shared by the admin route and the seed script) ──

const MINI_CCT_INSTRUCTIONS = Object.freeze([
  `This Mini CCT has ${MINI_CCT_TOTAL_QUESTIONS} questions: 10 each from ${MINI_CCT_SUBJECT_NAMES.join(', ')}.`,
  `Each correct answer earns +${DEFAULT_POSITIVE_MARKS} marks; each incorrect answer loses ${DEFAULT_NEGATIVE_MARKS} mark. Unattempted questions score zero.`,
  `The test runs for ${DEFAULT_DURATION_MINUTES} minutes and submits automatically when the timer ends.`,
  'Your answers save as you go — you can resume exactly where you left off.',
]);

/**
 * Resolve the three canonical subjects (case-insensitive; the seeded bank
 * uses uppercase names). Returns { subjects, missing } where `subjects` is in
 * canonical order with nulls for anything not found.
 */
async function resolveMiniCctSubjects() {
  const all = await Subject.find({ isActive: true }).lean();
  const subjects = MINI_CCT_SUBJECT_NAMES.map((name) =>
    all.find((s) => normalizeLabel(s.name).toLowerCase() === name.toLowerCase()) || null
  );
  return {
    subjects,
    missing: MINI_CCT_SUBJECT_NAMES.filter((_name, i) => !subjects[i]),
  };
}

/**
 * Sample `count` single-best-answer questions for one subject, preferring
 * questions that carry at least one concept tag. Never samples a question
 * twice; returns plain docs in sampled order.
 */
async function sampleMiniCctQuestions(subjectId, count) {
  const baseMatch = {
    subject: new mongoose.Types.ObjectId(subjectId),
    isActive: true,
    questionType: { $in: MINI_CCT_QUESTION_TYPES },
  };

  const tagged = await QuestionBank.aggregate([
    { $match: { ...baseMatch, tags: { $exists: true, $ne: [] } } },
    { $sample: { size: count } },
  ]);

  const pickedIds = new Set(tagged.map((q) => String(q._id)));
  const remaining = count - tagged.length;
  let untagged = [];
  if (remaining > 0) {
    untagged = await QuestionBank.aggregate([
      { $match: { ...baseMatch, _id: { $nin: [...pickedIds].map((id) => new mongoose.Types.ObjectId(id)) } } },
      { $sample: { size: remaining } },
    ]);
  }

  return {
    questions: [...tagged, ...untagged],
    availability: tagged.length + untagged.length,
  };
}

/**
 * Create one Mini CCT Quiz from the bank. Returns
 * { quiz, perSubject, questionCount } or { error: { status, message, code } }.
 *
 * @param {object} [options]
 * @param {string} [options.title]  defaults to "Mini CCT #<n>"
 * @param {number} [options.duration] minutes (default 30)
 * @param {Date} [options.scheduledDate], [options.expiryDate]
 * @param {Function} [options.onCreated] async callback ({ quiz, studentIds })
 *   fired after creation — the admin route uses it for notifications.
 */
async function createMiniCctQuiz(options = {}) {
  const {
    title,
    duration = DEFAULT_DURATION_MINUTES,
    scheduledDate,
    expiryDate,
    onCreated,
  } = options;

  const parsedDuration = Number.parseInt(duration, 10);
  if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
    return { error: { status: 400, message: 'Duration must be a positive number of minutes', code: 'VALIDATION_ERROR' } };
  }
  if (scheduledDate && expiryDate && new Date(expiryDate) <= new Date(scheduledDate)) {
    return { error: { status: 400, message: 'End date must be after start date', code: 'VALIDATION_ERROR' } };
  }

  const { subjects, missing } = await resolveMiniCctSubjects();
  if (missing.length > 0) {
    return {
      error: {
        status: 400,
        message: `Mini CCT subjects missing from the subject list: ${missing.join(', ')}`,
        code: 'SUBJECTS_MISSING',
      },
    };
  }

  // Sample per subject, keeping canonical subject order (Psychiatry,
  // Dermatology, Orthopaedics) so the test reads in subject blocks.
  const sampled = [];
  const perSubject = [];
  for (const subject of subjects) {
    const { questions, availability } = await sampleMiniCctQuestions(subject._id, QUESTIONS_PER_SUBJECT);
    perSubject.push({ subjectName: subject.name, picked: questions.length, availability });
    sampled.push(...questions);
  }

  const shortfall = perSubject.filter((row) => row.picked < QUESTIONS_PER_SUBJECT);
  if (shortfall.length > 0 || sampled.length < MINI_CCT_TOTAL_QUESTIONS) {
    return {
      error: {
        status: 400,
        message: `Not enough active single-best-answer questions in the bank. ${perSubject
          .map((row) => `${row.subjectName}: ${row.picked}/${QUESTIONS_PER_SUBJECT} (bank has ${row.availability})`)
          .join('; ')}`,
        code: 'INSUFFICIENT_QUESTIONS',
        perSubject,
      },
    };
  }

  let finalTitle = title && String(title).trim();
  if (!finalTitle) {
    const existing = await Quiz.countDocuments({ testType: MINI_CCT_TEST_TYPE });
    finalTitle = `${MINI_CCT_TEST_TYPE_LABEL} #${existing + 1}`;
  }
  const titleTaken = await Quiz.exists({
    title: finalTitle,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  });
  if (titleTaken) {
    return { error: { status: 400, message: `A quiz with the title "${finalTitle}" already exists.`, code: 'DUPLICATE_TITLE' } };
  }

  // assignToAllFreeUsers is the product rule: every free user sees the Mini
  // CCT in their list (and may start it) even if they signed up after this
  // moment. Current free users are also written into assignedStudents for
  // parity with the admin create-from-bank flow (notifications, analytics).
  const freeUsers = await User.find({ role: 'student', isFreeUser: true }).select('_id');
  const assignedStudents = freeUsers.map((u) => u._id);

  const quiz = await Quiz.create({
    title: finalTitle,
    subject: subjects[0]._id, // single-ref schema; real per-question subjects drive all analytics
    testType: MINI_CCT_TEST_TYPE,
    duration: parsedDuration,
    instructions: MINI_CCT_INSTRUCTIONS,
    questions: sampled.map((q) => q._id),
    totalMarks: sampled.length * DEFAULT_POSITIVE_MARKS,
    positiveMarks: DEFAULT_POSITIVE_MARKS,
    negativeMarks: DEFAULT_NEGATIVE_MARKS,
    assignedStudents,
    createdBy: options.adminId,
    shareSolution: true,
    lockSectionsAfterSubmission: true, // irrelevant on a sectionless quiz; kept at the schema default
    assignToAllFreeUsers: true,
    scheduledDate: scheduledDate || undefined,
    expiryDate: expiryDate || undefined,
  });

  if (assignedStudents.length > 0) {
    await User.updateMany(
      { _id: { $in: assignedStudents } },
      { $addToSet: { unseenQuizzes: quiz._id } }
    );
  }

  if (typeof onCreated === 'function') {
    try {
      await onCreated({ quiz, studentIds: assignedStudents });
    } catch (error) {
      console.error('[mini-cct] onCreated callback failed:', error && error.message);
    }
  }

  return { quiz, perSubject, questionCount: sampled.length };
}

module.exports = {
  // constants
  MINI_CCT_TEST_TYPE,
  MINI_CCT_TEST_TYPE_LABEL,
  MINI_CCT_SUBJECT_NAMES,
  QUESTIONS_PER_SUBJECT,
  MINI_CCT_TOTAL_QUESTIONS,
  DEFAULT_DURATION_MINUTES,
  MINI_CCT_QUESTION_TYPES,
  MAX_CONCEPT_TAGS,
  MIN_COMPARISON_COHORT,
  GATED_SECTIONS,
  FINALIZED_STATUSES,
  MINI_CCT_INSTRUCTIONS,
  // pure helpers
  normalizeLabel,
  conceptTagsOf,
  classificationFor,
  subjectCountsForAttempt,
  buildMiniCctAnalysis,
  applyAnalysisAccess,
  resolveTier,
  tagStatus,
  buildInsightMessage,
  // generation
  resolveMiniCctSubjects,
  sampleMiniCctQuestions,
  createMiniCctQuiz,
};
