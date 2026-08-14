const {
  computeScorePercentage,
  computeAccuracy,
  classifyAnswer,
  computeAttemptStats,
  computeQuestionAnalytics,
  findEasiestHardestQuestions,
  computeScoreDistribution,
  rankStudentAttempts,
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
