import { buildPerformanceChartData, mapQuizResultsResponse } from '../quizResult';

describe('mapQuizResultsResponse', () => {
  const basePayload = {
    summary: {
      correct: 3,
      incorrect: 2,
      skipped: 1,
      attempted: 5,
      totalQuestions: 6,
      marksObtained: 10,
      totalMarks: 24,
      scorePercentage: 42,
      accuracy: 60,
      markedForReviewCount: 1,
      timeTakenSeconds: 192,
    },
    attempt: {
      _id: 'attempt-1',
      status: 'completed',
      startTime: '2026-08-29T10:00:00Z',
      endTime: '2026-08-29T10:03:12Z',
      totalQuestions: 6,
      totalMarks: 24,
      sectionPerformance: [{ sectionName: 'Pathology', correct: 1, incorrect: 1, skipped: 0, accuracy: 50, timeSpent: 60 }],
      retestRequested: false,
      retestApproved: false,
      canRequestRetest: true,
    },
    quiz: {
      title: 'Daily Pathology Quiz',
      subject: { name: 'Pathology' },
      shareSolution: true,
    },
    hasSectionData: true,
    wrongQuestions: [{ questionId: 'q1', displayNumber: 2 }],
    frequentlyMissedQuestions: [],
    questionPerformance: [{ questionId: 'q1', questionIndex: 0, status: 'correct' }],
  };

  it('maps a full API payload to QuizResultData', () => {
    const result = mapQuizResultsResponse(basePayload);

    expect(result.attemptId).toBe('attempt-1');
    expect(result.quiz.title).toBe('Daily Pathology Quiz');
    expect(result.quiz.subject).toBe('Pathology');
    expect(result.summary.correct).toBe(3);
    expect(result.summary.accuracy).toBe(60);
    expect(result.summary.timeTakenSeconds).toBe(192);
    expect(result.hasSectionData).toBe(true);
    expect(result.wrongQuestions).toHaveLength(1);
    expect(result.canRequestRetest).toBe(true);
  });

  it('falls back when summary is missing', () => {
    const { summary, ...rest } = basePayload;
    const result = mapQuizResultsResponse({
      ...rest,
      attempt: { ...rest.attempt, score: 2, marksObtained: 8, totalMarks: 24 },
    });

    expect(result.summary.correct).toBe(2);
    expect(result.summary.scorePercentage).toBe(33);
  });

  it('defaults shareSolution to true when not provided', () => {
    const payload = {
      ...basePayload,
      quiz: { title: 'Test', subject: 'Bio' },
    };
    expect(mapQuizResultsResponse(payload).quiz.shareSolution).toBe(true);
  });
});

describe('buildPerformanceChartData', () => {
  it('builds labeled chart slices with counts', () => {
    const data = buildPerformanceChartData({
      correct: 3,
      incorrect: 2,
      skipped: 0,
      attempted: 5,
      totalQuestions: 5,
      marksObtained: 10,
      totalMarks: 20,
      scorePercentage: 50,
      accuracy: 60,
      markedForReviewCount: 0,
      timeTakenSeconds: 90,
    });

    expect(data).toHaveLength(3);
    expect(data[0]).toMatchObject({ label: 'Correct', count: 3 });
    expect(data[1]).toMatchObject({ label: 'Wrong', count: 2 });
    expect(data[2]).toMatchObject({ label: 'Unattempted', count: 0 });
  });

  it('handles all-zero counts', () => {
    const data = buildPerformanceChartData({
      correct: 0,
      incorrect: 0,
      skipped: 0,
      attempted: 0,
      totalQuestions: 0,
      marksObtained: 0,
      totalMarks: 0,
      scorePercentage: null,
      accuracy: null,
      markedForReviewCount: 0,
      timeTakenSeconds: 0,
    });

    expect(data.every((slice) => slice.count === 0)).toBe(true);
  });
});
