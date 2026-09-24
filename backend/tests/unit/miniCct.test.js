const {
  conceptTagsOf,
  normalizeLabel,
  buildMiniCctAnalysis,
  applyAnalysisAccess,
  resolveTier,
  tagStatus,
  MIN_COMPARISON_COHORT,
} = require('../../utils/miniCct');
const { roundTo2 } = require('../../utils/analytics');

// ── conceptTagsOf ─────────────────────────────────────────────────────────────

describe('conceptTagsOf', () => {
  it('keeps human concept tags in order', () => {
    expect(conceptTagsOf(['Mood Disorders', 'Psychosis'])).toEqual(['Mood Disorders', 'Psychosis']);
  });

  it('drops provenance markers (excel-import, quiz:<title>, import)', () => {
    expect(conceptTagsOf(['Mood Disorders', 'excel-import', 'quiz:FMGE Quiz 18 Sep2026'])).toEqual([
      'Mood Disorders',
    ]);
    expect(conceptTagsOf(['Import', 'Neurosis'])).toEqual(['Neurosis']);
  });

  it('collapses embedded newlines and whitespace (Excel import artifacts)', () => {
    expect(conceptTagsOf(['Specific\nPsychiatric\nConditions'])).toEqual(['Specific Psychiatric Conditions']);
  });

  it('dedupes case-insensitively and caps at 3 concept tags', () => {
    expect(conceptTagsOf(['Schizophrenia', 'schizophrenia', 'Psychosis', 'Neurosis', 'Extra'])).toEqual([
      'Schizophrenia',
      'Psychosis',
      'Neurosis',
    ]);
  });

  it('tolerates missing/empty input', () => {
    expect(conceptTagsOf(undefined)).toEqual([]);
    expect(conceptTagsOf([])).toEqual([]);
    expect(conceptTagsOf(['', '   ', 'excel-import'])).toEqual([]);
  });
});

describe('normalizeLabel', () => {
  it('collapses whitespace runs to single spaces', () => {
    expect(normalizeLabel('Trauma and\nStress-Related\nDisorders')).toBe('Trauma and Stress-Related Disorders');
    expect(normalizeLabel('  x   y ')).toBe('x y');
    expect(normalizeLabel(null)).toBe('');
  });
});

// ── tier + tag status rules ──────────────────────────────────────────────────

describe('resolveTier', () => {
  it('bands accuracy into documented tiers', () => {
    expect(resolveTier(90).key).toBe('excellent');
    expect(resolveTier(75).key).toBe('excellent');
    expect(resolveTier(74.99).key).toBe('strong');
    expect(resolveTier(60).key).toBe('strong');
    expect(resolveTier(45).key).toBe('developing');
    expect(resolveTier(39).key).toBe('needs_focus');
    expect(resolveTier(null)).toBeNull();
  });
});

describe('tagStatus', () => {
  it('marks tags below the own overall accuracy as weak', () => {
    expect(tagStatus(33.33, 60, 3)).toBe('weak');
  });

  it('marks solidly high tags at/above the own baseline as strong', () => {
    expect(tagStatus(100, 60, 2)).toBe('strong');
    expect(tagStatus(67, 60, 3)).toBe('strong');
  });

  it('neutral for unattempted tags, no baseline, or between weak and strong', () => {
    expect(tagStatus(null, 60, 0)).toBe('neutral');
    expect(tagStatus(50, null, 2)).toBe('neutral'); // nothing attempted overall → no baseline
    expect(tagStatus(65, 60, 2)).toBe('neutral'); // ≥ baseline but < 67 absolute floor
  });
});

// ── buildMiniCctAnalysis ──────────────────────────────────────────────────────

const POSITIVE = 4;
const NEGATIVE = 1;

function question(index, subjectName, overrides = {}) {
  return {
    _id: `q${index}`,
    questionType: 'mcq_single',
    subject: { _id: `s-${subjectName}`, name: subjectName },
    topicName: `Topic ${subjectName} ${Math.floor(index / 10)}`,
    tags: [`Tag${index % 3}`, 'excel-import'],
    ...overrides,
  };
}

function miniQuestions() {
  const subjects = ['Psychiatry', 'Dermatology', 'Orthopaedics'];
  return Array.from({ length: 30 }, (_unused, i) => question(i, subjects[Math.floor(i / 10)]));
}

/** answer row shaped like the engine writes at submit time. */
function answerRow(index, outcome, subjectName, tags) {
  const q = question(index, subjectName);
  return {
    questionIndex: index,
    questionId: q._id,
    selectedAnswer: outcome === 'correct' ? 1 : 2,
    isCorrect: outcome === 'correct',
    metadataSnapshot: {
      subjectName,
      topicName: q.topicName,
      questionType: 'mcq_single',
      tags: tags || q.tags,
    },
  };
}

function buildAttempt(quizId, studentId, outcomes, questions) {
  const answers = [];
  let correct = 0;
  let incorrect = 0;
  outcomes.forEach((outcome, index) => {
    if (outcome === null) return; // never visited → skipped, no answer row
    const cls = questions[index];
    if (outcome) correct += 1;
    else incorrect += 1;
    answers.push(answerRow(index, outcome ? 'correct' : 'incorrect', cls.subject.name, cls.tags));
  });
  const marks = correct * POSITIVE - incorrect * NEGATIVE;
  return {
    _id: `attempt-${studentId}`,
    quiz: quizId,
    student: studentId,
    status: 'completed',
    startTime: new Date('2026-09-25T10:00:00Z'),
    endTime: new Date('2026-09-25T10:20:00Z'),
    score: correct,
    totalQuestions: outcomes.length,
    marksObtained: marks,
    totalMarks: outcomes.length * POSITIVE,
    answers,
  };
}

function analysisFixture({ outcomes, cohortOutcomes = [], cohortSize = 0 }) {
  const quiz = {
    _id: 'quiz1',
    title: 'Mini CCT #1',
    testType: 'mini',
    totalMarks: 120,
    positiveMarks: POSITIVE,
    negativeMarks: NEGATIVE,
  };
  const questions = miniQuestions();
  const attempt = buildAttempt('quiz1', 'me', outcomes, questions);

  // Cohort of other students (one deduped attempt each) with identical
  // outcomes — averages are then exactly reproducible.
  const cohort = [{ ...attempt, _id: 'attempt-me' }];
  for (let i = 0; i < cohortSize; i += 1) {
    cohort.push(buildAttempt('quiz1', `student${i}`, cohortOutcomes.length ? cohortOutcomes : outcomes, questions));
  }

  return buildMiniCctAnalysis({ attempt, quiz, questions, cohort });
}

describe('buildMiniCctAnalysis', () => {
  it('computes summary, subjects, heatmap and topics from one attempt', () => {
    // 30 questions: Q0-9 Psychiatry, 10-19 Dermatology, 20-29 Orthopaedics.
    // Psychiatry 6✓ 2✗ 2 skipped; Dermatology 5✓ 4✗ 1 skip; Ortho 4✓ 5✗ 1✗...
    const outcomes = Array.from({ length: 30 }, (_u, i) => {
      if (i === 8 || i === 9 || i === 19 || i === 29) return null;
      if (i < 10) return i < 6 ? 1 : 0;
      if (i < 20) return i < 15 ? 1 : 0;
      return i < 24 ? 1 : 0;
    });
    const analysis = analysisFixture({ outcomes });

    expect(analysis.summary.totalQuestions).toBe(30);
    expect(analysis.summary.correct).toBe(15);
    expect(analysis.summary.incorrect).toBe(11);
    expect(analysis.summary.skipped).toBe(4);
    expect(analysis.summary.attempted).toBe(26);
    expect(analysis.summary.marksObtained).toBe(15 * 4 - 11); // 49
    expect(analysis.summary.timeTakenSeconds).toBe(20 * 60);

    expect(analysis.heatmap).toHaveLength(30);
    expect(analysis.heatmap[8].status).toBe('skipped');
    expect(analysis.heatmap[0].status).toBe('correct');
    expect(analysis.heatmap[9].topicName).toBe('Topic Psychiatry 0');

    const byName = new Map(analysis.subjects.map((s) => [s.subjectName, s]));
    expect(byName.get('Psychiatry')).toMatchObject({ correct: 6, incorrect: 2, skipped: 2, questionCount: 10 });
    expect(byName.get('Dermatology')).toMatchObject({ correct: 5, incorrect: 4, skipped: 1, questionCount: 10 });
    expect(byName.get('Orthopaedics')).toMatchObject({ correct: 4, incorrect: 5, skipped: 1, questionCount: 10 });

    // accuracy = correct / attempted, skips excluded
    expect(byName.get('Psychiatry').accuracy).toBe(75);
    expect(byName.get('Orthopaedics').accuracy).toBeCloseTo(44.44, 1);

    // Insight: strongest Psychiatry (75), weakest Orthopaedics (44.44), both
    // over the 3-attempted floor.
    expect(analysis.insight.strongestSubject).toMatchObject({ subjectName: 'Psychiatry', accuracy: 75 });
    expect(analysis.insight.weakestSubject).toMatchObject({ subjectName: 'Orthopaedics', accuracy: 44.44 });
    expect(analysis.insight.tier.key).toBe('developing'); // 15/26 = 57.7%
  });

  it('withholds cohort averages below the privacy floor', () => {
    const analysis = analysisFixture({ outcomes: Array(30).fill(1), cohortSize: MIN_COMPARISON_COHORT - 2 });
    expect(analysis.cohort.sufficient).toBe(false);
    expect(analysis.cohort.percentile).toBeNull();
    expect(analysis.cohort.averageMarks).toBeNull();
    expect(analysis.overall.cohortAvgScorePercentage).toBeNull();
    analysis.subjects.forEach((row) => {
      expect(row.cohortAvgMarks).toBeNull();
      expect(row.cohortAvgAccuracy).toBeNull();
    });
  });

  it('publishes cohort averages and percentile above the floor', () => {
    // Me: all correct. 5 others: all wrong → my percentile = 100.
    const analysis = analysisFixture({
      outcomes: Array(30).fill(1),
      cohortOutcomes: Array(30).fill(0),
      cohortSize: MIN_COMPARISON_COHORT,
    });
    expect(analysis.cohort.totalStudents).toBe(MIN_COMPARISON_COHORT + 1); // includes me
    expect(analysis.cohort.sufficient).toBe(true);
    expect(analysis.cohort.percentile).toBe(100);
    expect(analysis.cohort.topPercent).toBe(0);
    // Database average INCLUDES the caller: (me +40, 5 others -10 each) / 6.
    const psychiatry = analysis.subjects.find((s) => s.subjectName === 'Psychiatry');
    expect(psychiatry.cohortAvgMarks).toBe(roundTo2((1 * 40 + 5 * -10) / 6));
    expect(psychiatry.cohortAvgAccuracy).toBe(roundTo2((1 * 100 + 5 * 0) / 6));
  });

  it('aggregates topics per subject with skipped counters', () => {
    const outcomes = Array.from({ length: 30 }, (_u, i) => (i % 10 === 9 ? null : 1));
    const analysis = analysisFixture({ outcomes });
    // topics are `${subject} ${floor(index/10)}` → 3 topics per subject.
    expect(analysis.topics.length).toBeGreaterThan(0);
    const topic = analysis.topics.find((t) => t.label === 'Topic Psychiatry 0');
    expect(topic).toMatchObject({ subjectName: 'Psychiatry', questionCount: 10, correct: 9, skipped: 1, attempted: 9 });
    expect(topic.accuracy).toBe(100);
  });

  it('aggregates concept tags across subjects and flags weak/strong', () => {
    // Tag0 on indexes %3==0 (10 questions) all correct → strong.
    // Tag1 on %3==1: Psychiatry correct, others wrong → mixed.
    const outcomes = Array.from({ length: 30 }, (_u, i) => {
      if (i % 3 === 0) return 1; // Tag0 → all correct
      if (i % 3 === 1) return i < 10 ? 1 : 0; // Tag1 → Psy correct, rest wrong
      return null; // Tag2 skipped everywhere
    });
    const analysis = analysisFixture({ outcomes });

    const byLabel = new Map(analysis.tags.map((t) => [t.label, t]));
    const tag0 = byLabel.get('Tag0');
    expect(tag0).toMatchObject({ correct: 10, incorrect: 0, skipped: 0, attempted: 10 });
    expect(tag0.status).toBe('strong'); // 100% ≥ max(67, overall=100... overall is 100) → strong

    const tag1 = byLabel.get('Tag1');
    // Tag1 questions: 1,4,7 (Psychiatry, correct) + 10..28 wrong = 3✓ / 7✗.
    expect(tag1).toMatchObject({ correct: 3, incorrect: 7, attempted: 10 });
    // Overall accuracy 13/20 = 65% → 30% is strictly below the own baseline.
    expect(tag1.status).toBe('weak');

    const tag2 = byLabel.get('Tag2');
    expect(tag2.attempted).toBe(0);
    expect(tag2.status).toBe('neutral');

    // Provenance tag never appears.
    expect(byLabel.has('excel-import')).toBe(false);
  });

  it('handles a fully skipped attempt (zero denominators everywhere)', () => {
    const analysis = analysisFixture({ outcomes: Array(30).fill(null), cohortSize: 3 });
    expect(analysis.summary.correct).toBe(0);
    expect(analysis.summary.attempted).toBe(0);
    expect(analysis.summary.accuracy).toBeNull();
    expect(analysis.summary.scorePercentage).toBe(0); // 0 marks / 120
    expect(analysis.insight.tier).toBeNull();
    expect(analysis.insight.strongestSubject).toBeNull();
    analysis.subjects.forEach((row) => {
      expect(row.accuracy).toBeNull();
      expect(row.marks).toBe(0);
    });
    analysis.topics.forEach((topic) => expect(topic.accuracy).toBeNull());
    analysis.tags.forEach((tag) => expect(tag.status).toBe('neutral'));
  });
});

// ── applyAnalysisAccess ───────────────────────────────────────────────────────

describe('applyAnalysisAccess', () => {
  const full = analysisFixture({ outcomes: Array(30).fill(1), cohortSize: MIN_COMPARISON_COHORT });

  it('keeps everything for paid students', () => {
    const result = applyAnalysisAccess(full, { isFreeUser: false });
    expect(result.access.level).toBe('full');
    expect(result.heatmap).toHaveLength(30);
    expect(result.topics.length).toBeGreaterThan(0);
    expect(result.cohort.percentile).not.toBeNull();
  });

  it('strips gated sections server-side for free users', () => {
    const result = applyAnalysisAccess(full, { isFreeUser: true });
    expect(result.access.level).toBe('limited');
    expect(result.access.gatedSections).toContain('topic-analysis');
    expect(result.heatmap).toBeUndefined();
    expect(result.topics).toBeUndefined();
    expect(result.tags).toBeUndefined();
    expect(result.cohort.percentile).toBeNull();
    expect(result.cohort.averageMarks).toBeNull();
    expect(result.overall.cohortAvgScorePercentage).toBeNull();
    result.subjects.forEach((row) => {
      expect(row.cohortAvgMarks).toBeNull();
      expect(row.cohortAvgAccuracy).toBeNull();
    });
    // The free tier keeps the score summary + own subject rows + tier.
    expect(result.summary.correct).toBe(30);
    expect(result.subjects).toHaveLength(3);
    expect(result.insight.tier.key).toBe('excellent');
  });
});
