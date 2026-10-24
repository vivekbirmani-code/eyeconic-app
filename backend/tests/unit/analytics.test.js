const {
  computeScorePercentage,
  computeAccuracy,
  classifyAnswer,
  computeAttemptStats,
  computeQuestionAnalytics,
  findEasiestHardestQuestions,
  computeScoreDistribution,
  computeTestAnalytics,
  computePerformanceMetricsAverages,
  rankStudentAttempts,
  rankLeaderboardParticipants,
  filterAttemptsByDateRange,
  aggregateStudentSummary,
  aggregateSubjectStats,
  computeStrengthsWeaknesses,
  computeTrend,
  computeInsights,
  computeMarksAwarded,
} = require('../../utils/analytics');
const { QUESTION_TYPES } = require('../../constants/question');

describe('analytics — score percentage', () => {
  it('computes normal score percentage', () => {
    expect(computeScorePercentage(13, 48)).toBe(27.08);
  });

  it('returns null for zero total marks', () => {
    expect(computeScorePercentage(10, 0)).toBeNull();
  });

  it('handles negative marking scores', () => {
    expect(computeScorePercentage(-2, 48)).toBe(-4.17);
  });

  it('handles maximum score', () => {
    expect(computeScorePercentage(48, 48)).toBe(100);
  });
});

describe('analytics — accuracy', () => {
  it('computes accuracy excluding skipped', () => {
    expect(computeAccuracy(5, 8)).toBe(62.5);
  });

  it('returns null when no attempted questions', () => {
    expect(computeAccuracy(0, 0)).toBeNull();
  });

  it('does not treat all skipped as 0%', () => {
    expect(computeAccuracy(0, 0)).toBeNull();
  });

  it('computes all correct', () => {
    expect(computeAccuracy(12, 12)).toBe(100);
  });
});

describe('analytics — classifyAnswer by question type', () => {
  it('MCQ answered correct uses stored isCorrect', () => {
    const result = classifyAnswer(
      { selectedAnswer: 1, isCorrect: true },
      QUESTION_TYPES.MCQ_SINGLE
    );
    expect(result).toEqual({ answered: true, correct: true, incorrect: false, skipped: false });
  });

  it('MCQ skipped', () => {
    const result = classifyAnswer({ selectedAnswer: -1 }, QUESTION_TYPES.MCQ_SINGLE);
    expect(result.skipped).toBe(true);
  });

  it('numerical skipped (null)', () => {
    const result = classifyAnswer({ selectedAnswer: null }, QUESTION_TYPES.NUMERICAL);
    expect(result.skipped).toBe(true);
  });

  it('numerical answered incorrect', () => {
    const result = classifyAnswer(
      { selectedAnswer: 42, isCorrect: false },
      QUESTION_TYPES.NUMERICAL
    );
    expect(result).toEqual({ answered: true, correct: false, incorrect: true, skipped: false });
  });

  it('multiple_correct answered uses isCorrect not reference equality', () => {
    const result = classifyAnswer(
      { selectedAnswer: [0, 2], isCorrect: true },
      QUESTION_TYPES.MULTIPLE_CORRECT
    );
    expect(result.correct).toBe(true);
  });

  it('multiple_correct skipped (empty array)', () => {
    const result = classifyAnswer({ selectedAnswer: [] }, QUESTION_TYPES.MULTIPLE_CORRECT);
    expect(result.skipped).toBe(true);
  });

  it('match answered uses stored isCorrect', () => {
    const result = classifyAnswer(
      { selectedAnswer: { '0': '1', '1': '0' }, isCorrect: true },
      QUESTION_TYPES.MATCH_THE_FOLLOWING
    );
    expect(result.correct).toBe(true);
  });

  it('match skipped (empty object)', () => {
    const result = classifyAnswer({ selectedAnswer: {} }, QUESTION_TYPES.MATCH_THE_FOLLOWING);
    expect(result.skipped).toBe(true);
  });
});

describe('analytics — attempt stats', () => {
  const questions = [
    { questionType: QUESTION_TYPES.MCQ_SINGLE },
    { questionType: QUESTION_TYPES.MCQ_SINGLE },
    { questionType: QUESTION_TYPES.MCQ_SINGLE },
    { questionType: QUESTION_TYPES.MCQ_SINGLE },
    { questionType: QUESTION_TYPES.MCQ_SINGLE },
    { questionType: QUESTION_TYPES.MCQ_SINGLE },
    { questionType: QUESTION_TYPES.MCQ_SINGLE },
    { questionType: QUESTION_TYPES.MCQ_SINGLE },
    { questionType: QUESTION_TYPES.MCQ_SINGLE },
    { questionType: QUESTION_TYPES.MCQ_SINGLE },
    { questionType: QUESTION_TYPES.MCQ_SINGLE },
    { questionType: QUESTION_TYPES.MCQ_SINGLE },
  ];

  it('matches audit example: 5 correct, 7 incorrect, 0 skipped', () => {
    const answers = [];
    for (let i = 0; i < 5; i++) {
      answers.push({ questionIndex: i, selectedAnswer: 0, isCorrect: true });
    }
    for (let i = 5; i < 12; i++) {
      answers.push({ questionIndex: i, selectedAnswer: 1, isCorrect: false });
    }

    const attempt = {
      totalQuestions: 12,
      marksObtained: 13,
      totalMarks: 48,
      score: 5,
      answers,
    };

    const stats = computeAttemptStats(attempt, questions);
    expect(stats.correct).toBe(5);
    expect(stats.incorrect).toBe(7);
    expect(stats.skipped).toBe(0);
    expect(stats.attempted).toBe(12);
    expect(stats.scorePercentage).toBe(27.08);
    expect(stats.accuracy).toBe(41.67);
  });

  it('matches audit example: 5 correct, 3 incorrect, 4 skipped', () => {
    const answers = [];
    for (let i = 0; i < 5; i++) {
      answers.push({ questionIndex: i, selectedAnswer: 0, isCorrect: true });
    }
    for (let i = 5; i < 8; i++) {
      answers.push({ questionIndex: i, selectedAnswer: 1, isCorrect: false });
    }

    const attempt = {
      totalQuestions: 12,
      marksObtained: 17,
      totalMarks: 48,
      score: 5,
      answers,
    };

    const stats = computeAttemptStats(attempt, questions);
    expect(stats.correct).toBe(5);
    expect(stats.incorrect).toBe(3);
    expect(stats.skipped).toBe(4);
    expect(stats.accuracy).toBe(62.5);
  });
});

describe('analytics — question analytics', () => {
  it('uses stored isCorrect, not live question bank', () => {
    const questions = [{ questionType: QUESTION_TYPES.MULTIPLE_CORRECT, correctAnswer: [0, 1] }];
    const attempts = [{
      answers: [{
        questionIndex: 0,
        selectedAnswer: [0, 2],
        isCorrect: true,
        metadataSnapshot: { questionType: QUESTION_TYPES.MULTIPLE_CORRECT },
      }],
      totalQuestions: 1,
    }];

    const analytics = computeQuestionAnalytics(attempts, questions);
    expect(analytics[0].correctCount).toBe(1);
    expect(analytics[0].wrongCount).toBe(0);
  });
});

describe('analytics — distribution and ranking', () => {
  it('assigns every attempt to exactly one bucket', () => {
    const attempts = [
      { marksObtained: 5, totalMarks: 20, totalQuestions: 5, answers: [] },
      { marksObtained: 15, totalMarks: 20, totalQuestions: 5, answers: [] },
      { marksObtained: 18, totalMarks: 20, totalQuestions: 5, answers: [] },
    ];
    const distribution = computeScoreDistribution(attempts);
    const total = distribution.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(3);
  });

  it('ranks deterministically with ties', () => {
    const attempts = [
      {
        _id: 'a1',
        marksObtained: 10,
        totalMarks: 20,
        totalQuestions: 5,
        score: 3,
        endTime: new Date('2026-01-02'),
        student: { _id: 's2', name: 'B' },
        answers: [],
      },
      {
        _id: 'a2',
        marksObtained: 10,
        totalMarks: 20,
        totalQuestions: 5,
        score: 3,
        endTime: new Date('2026-01-01'),
        student: { _id: 's1', name: 'A' },
        answers: [],
      },
    ];

    const ranked = rankStudentAttempts(attempts);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
    expect(ranked[0].student._id).toBe('s1');
  });
});

describe('analytics — rankLeaderboardParticipants (merged live board)', () => {
  const internalAttempt = (id, studentId, name, { marks, total = 16, correct = 0, incorrect = 0, endTime } = {}) => ({
    _id: id,
    student: { _id: studentId, name, email: `${studentId}@test.test` },
    marksObtained: marks,
    totalMarks: total,
    totalQuestions: 4,
    score: correct,
    startTime: new Date('2026-01-01T10:00:00Z'),
    endTime: endTime || new Date('2026-01-01T10:20:00Z'),
    answers: [
      ...Array.from({ length: correct }, (_, i) => ({ questionIndex: i, selectedAnswer: 1, isCorrect: true })),
      ...Array.from({ length: incorrect }, (_, i) => ({ questionIndex: i + correct, selectedAnswer: 2, isCorrect: false })),
    ],
  });

  const guestEntry = (id, leadId, name, { marks, total = 16, correct = 0, incorrect = 0, endTime } = {}) => ({
    attempt: {
      _id: id,
      guest: leadId,
      guestName: name,
      guestEmail: `${leadId}@guest.test`,
      marksObtained: marks,
      totalMarks: total,
      totalQuestions: 4,
      score: correct,
      startTime: new Date('2026-01-01T10:00:00Z'),
      endTime: endTime || new Date('2026-01-01T10:20:00Z'),
      answers: [
        ...Array.from({ length: correct }, (_, i) => ({ questionIndex: i, selectedAnswer: 1, isCorrect: true })),
        ...Array.from({ length: incorrect }, (_, i) => ({ questionIndex: i + correct, selectedAnswer: 2, isCorrect: false })),
      ],
    },
    identity: { _id: leadId, name, email: `${leadId}@guest.test` },
  });

  it('ranks internal and external participants together by the shared rules', () => {
    const ranked = rankLeaderboardParticipants(
      [
        internalAttempt('ia1', 's1', 'Ann Internal', { marks: 8, correct: 2, incorrect: 0 }),
        internalAttempt('ia2', 's2', 'Bob Internal', { marks: 16, correct: 4 }),
      ],
      [guestEntry('ga1', 'lead1', 'Vera External', { marks: 12, correct: 3, incorrect: 1 })]
    );

    expect(ranked.map((r) => r.studentName)).toEqual(['Bob Internal', 'Vera External', 'Ann Internal']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('tags every row with its cohort and gives external rows the lead identity', () => {
    const ranked = rankLeaderboardParticipants(
      [internalAttempt('ia1', 's1', 'Ann Internal', { marks: 16, correct: 4 })],
      [guestEntry('ga1', 'lead1', 'Vera External', { marks: 8, correct: 2, incorrect: 2 })]
    );

    const internal = ranked.find((r) => r._id === 'ia1');
    expect(internal.participantType).toBe('internal');
    expect(internal.guestId).toBeUndefined();
    expect(internal.studentId).toBe('s1');

    const external = ranked.find((r) => r._id === 'ga1');
    expect(external.participantType).toBe('external');
    expect(external.guestId).toBe('lead1');
    expect(external.studentName).toBe('Vera External');
    expect(external.studentEmail).toBe('lead1@guest.test');
    // No student account — identity rides guestId + studentName/Email only,
    // so a null student/studentId can never be mistaken for a User id.
    expect(external.student).toBeNull();
    expect(external.studentId).toBeNull();
    expect(external.correct).toBe(2);
    expect(external.incorrect).toBe(2);
    expect(external.scorePercentage).toBe(50);
  });

  it('breaks cross-cohort score ties by accuracy, then finish time', () => {
    // Both 8/16 = 50%; the guest answered 4 (2/4 = 50% acc), the internal
    // student answered 3 (2/3 ≈ 66.67%) — internal ranks first.
    let ranked = rankLeaderboardParticipants(
      [internalAttempt('ia1', 's1', 'Ann', { marks: 8, correct: 2, incorrect: 1 })],
      [guestEntry('ga1', 'lead1', 'Vera', { marks: 8, correct: 2, incorrect: 2 })]
    );
    expect(ranked.map((r) => r.studentName)).toEqual(['Ann', 'Vera']);

    // Identical score AND accuracy → earlier endTime wins, regardless of cohort.
    ranked = rankLeaderboardParticipants(
      [internalAttempt('ia1', 's1', 'Ann', { marks: 8, correct: 2, incorrect: 2, endTime: new Date('2026-01-01T11:00:00Z') })],
      [guestEntry('ga1', 'lead1', 'Vera', { marks: 8, correct: 2, incorrect: 2, endTime: new Date('2026-01-01T10:30:00Z') })]
    );
    expect(ranked.map((r) => r.studentName)).toEqual(['Vera', 'Ann']);
  });

  it('does not mutate the guest attempt documents it ranks', () => {
    const entry = guestEntry('ga1', 'lead1', 'Vera External', { marks: 12, correct: 3, incorrect: 1 });
    rankLeaderboardParticipants([], [entry]);
    expect(entry.attempt).not.toHaveProperty('student');
  });

  it('returns an empty board and null rank for a single merged row', () => {
    expect(rankLeaderboardParticipants([], [])).toEqual([]);

    const single = rankLeaderboardParticipants(
      [],
      [guestEntry('ga1', 'lead1', 'Vera External', { marks: 12, correct: 3, incorrect: 1 })]
    );
    expect(single).toHaveLength(1);
    expect(single[0].rank).toBeNull();
  });

  it('keeps the registered-only ranker untouched (no participantType leakage)', () => {
    const ranked = rankStudentAttempts([
      internalAttempt('ia1', 's1', 'Ann Internal', { marks: 16, correct: 4 }),
    ]);
    expect(ranked[0].participantType).toBeUndefined();
    expect(ranked[0].guestId).toBeUndefined();
  });
});

describe('analytics — date ranges', () => {
  it('filters attempts by 7d range', () => {
    const now = new Date();
    const recent = { endTime: now };
    const old = { endTime: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
    const filtered = filterAttemptsByDateRange([recent, old], '7d');
    expect(filtered).toHaveLength(1);
  });

  it('returns all when range invalid', () => {
    const attempts = [{ endTime: new Date() }, { endTime: new Date() }];
    expect(filterAttemptsByDateRange(attempts, 'invalid')).toHaveLength(2);
  });
});

describe('analytics — subject aggregation', () => {
  it('exposes scorePercentage and accuracy separately', () => {
    const attempts = [{
      totalQuestions: 10,
      marksObtained: 20,
      totalMarks: 40,
      score: 6,
      quiz: { subject: { _id: 'sub1', name: 'Pathology' }, title: 'Test 1' },
      answers: Array.from({ length: 6 }, (_, i) => ({
        questionIndex: i,
        selectedAnswer: 0,
        isCorrect: true,
      })).concat(
        Array.from({ length: 2 }, (_, i) => ({
          questionIndex: i + 6,
          selectedAnswer: 1,
          isCorrect: false,
        }))
      ),
    }];

    const subjects = aggregateSubjectStats(attempts);
    expect(subjects[0].scorePercentage).toBe(50);
    expect(subjects[0].accuracy).toBe(75);
    expect(subjects[0].percentage).toBe(60);
  });
});

describe('analytics — strengths and insights', () => {
  it('only classifies dimensions with sufficient sample', () => {
    const buckets = [
      { key: 'Pathology', attempted: 3, correct: 3, accuracy: 100 },
      { key: 'Anatomy', attempted: 1, correct: 1, accuracy: 100 },
    ];
    const { strengths } = computeStrengthsWeaknesses(buckets);
    expect(strengths).toHaveLength(1);
    expect(strengths[0].key).toBe('Pathology');
  });

  it('generates deterministic insights from metrics', () => {
    const attempts = [
      {
        endTime: new Date('2026-01-01'),
        totalQuestions: 10,
        marksObtained: 10,
        totalMarks: 40,
        quiz: { title: 'T1' },
        answers: Array.from({ length: 8 }, (_, i) => ({
          questionIndex: i,
          selectedAnswer: 0,
          isCorrect: true,
        })),
      },
      {
        endTime: new Date('2026-01-10'),
        totalQuestions: 10,
        marksObtained: 30,
        totalMarks: 40,
        quiz: { title: 'T2' },
        answers: Array.from({ length: 8 }, (_, i) => ({
          questionIndex: i,
          selectedAnswer: 0,
          isCorrect: true,
        })),
      },
    ];

    const summary = aggregateStudentSummary(attempts);
    const insights = computeInsights({ attempts, summary, subjectStats: [] });
    expect(insights.some((i) => i.type === 'trend_improving')).toBe(true);
  });
});

describe('analytics — marks awarded', () => {
  it('uses positive/negative marks without re-grading', () => {
    expect(computeMarksAwarded(true, false, 4, 1)).toBe(4);
    expect(computeMarksAwarded(false, false, 4, 1)).toBe(-1);
    expect(computeMarksAwarded(false, true, 4, 1)).toBe(0);
  });
});

describe('analytics — computeTestAnalytics (single source for app + exports)', () => {
  const questions = [
    { questionType: QUESTION_TYPES.MCQ_SINGLE, question: 'Q1?', topicName: 'T1', subject: { name: 'S' } },
    { questionType: QUESTION_TYPES.MCQ_SINGLE, question: 'Q2?', topicName: 'T2', subject: { name: 'S' } },
  ];

  const registeredAttempt = {
    _id: 'reg1',
    student: { _id: 's1', name: 'Student One' },
    totalQuestions: 2,
    marksObtained: 3,
    totalMarks: 8,
    score: 1,
    startTime: new Date('2026-09-11T09:00:00Z'),
    endTime: new Date('2026-09-11T09:30:00Z'),
    answers: [
      { questionIndex: 0, selectedAnswer: 1, isCorrect: true, metadataSnapshot: { questionType: 'mcq_single' } },
      { questionIndex: 1, selectedAnswer: 0, isCorrect: false, metadataSnapshot: { questionType: 'mcq_single' } },
    ],
  };

  // Same shape a graded GuestAttempt document carries.
  const guestAttempt = {
    _id: 'guest1',
    totalQuestions: 2,
    marksObtained: 8,
    totalMarks: 8,
    score: 2,
    startTime: new Date('2026-09-11T10:00:00Z'),
    endTime: new Date('2026-09-11T10:20:00Z'),
    answers: [
      { questionIndex: 0, selectedAnswer: 1, isCorrect: true, metadataSnapshot: { questionType: 'mcq_single' } },
      { questionIndex: 1, selectedAnswer: 1, isCorrect: true, metadataSnapshot: { questionType: 'mcq_single' } },
    ],
  };

  it('aggregates registered + guest attempts as one cohort', () => {
    const result = computeTestAnalytics([registeredAttempt, guestAttempt], questions, {
      totalAssigned: 1,
      registeredCount: 1,
    });

    expect(result.overview.totalAttempted).toBe(2);
    expect(result.overview.avgScore).toBe(5.5);
    expect(result.overview.avgScorePercentage).toBe(68.75);
    // Completion is scoped to the assigned cohort: 1 assigned / 1 registered
    // completed — the guest neither dilutes nor inflates it.
    expect(result.overview.completionRate).toBe(100);

    expect(result.performanceMetrics.avgCorrect).toBe(1.5);
    expect(result.performanceMetrics.avgWrong).toBe(0.5);

    expect(result.questionAnalytics[0]).toMatchObject({ sampleSize: 2, correctCount: 2 });
    expect(result.questionAnalytics[1]).toMatchObject({ sampleSize: 2, correctCount: 1 });

    const distributed = result.scoreDistribution.reduce((sum, b) => sum + b.count, 0);
    expect(distributed).toBe(2);
    expect(result.easiestQuestion.questionNumber).toBe(1);
    expect(result.hardestQuestion.questionNumber).toBe(2);
  });

  it('reports null completion when nothing was assigned (public test)', () => {
    const result = computeTestAnalytics([guestAttempt], questions, {
      totalAssigned: 0,
      registeredCount: 0,
    });
    expect(result.overview.totalAttempted).toBe(1);
    expect(result.overview.completionRate).toBeNull();
    expect(result.overview.avgScorePercentage).toBe(100);
  });

  it('keeps an assigned zero-attempt test at 0% completion', () => {
    const result = computeTestAnalytics([], questions, {
      totalAssigned: 3,
      registeredCount: 0,
    });
    expect(result.overview.totalAttempted).toBe(0);
    expect(result.overview.completionRate).toBe(0);
    expect(result.overview.avgScorePercentage).toBeNull();
    expect(result.questionAnalytics[0].sampleSize).toBe(0);
  });

  it('sums RAW durations and rounds only the final average', () => {
    // 1s + 3s attempts: raw average 0.0333 -> 0.03; summing pre-rounded
    // values would drift it to 0.04.
    const base = new Date('2026-09-10T09:00:00Z');
    const short = { ...registeredAttempt, startTime: base, endTime: new Date(base.getTime() + 1000) };
    const long = { ...guestAttempt, startTime: base, endTime: new Date(base.getTime() + 3000) };

    const { performanceMetrics } = computeTestAnalytics([short, long], questions, {});
    expect(performanceMetrics.avgTime).toBe(0.03);
  });

  it('treats a missing duration as zero minutes, not an excluded attempt', () => {
    const noEnd = { ...registeredAttempt, startTime: new Date('2026-09-11T09:00:00Z'), endTime: undefined };
    const thirtyMin = { ...guestAttempt };
    const performanceMetrics = computePerformanceMetricsAverages([noEnd, thirtyMin], questions, 2);
    // (0 + 20) / 2 — the attempt count stays the denominator.
    expect(performanceMetrics.avgTime).toBe(10);
  });
});
