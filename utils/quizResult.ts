import { QuizResultData } from '@/types/quiz-result';

/** Maps the backend results API payload to the frontend QuizResultData shape. */
export function mapQuizResultsResponse(data: Record<string, any>): QuizResultData {
  const summary = data.summary || {
    correct: data.attempt?.score || 0,
    incorrect: 0,
    skipped: 0,
    attempted: data.attempt?.score || 0,
    totalQuestions: data.attempt?.totalQuestions || 0,
    marksObtained: data.attempt?.marksObtained || 0,
    totalMarks: data.attempt?.totalMarks || 0,
    scorePercentage: data.attempt?.totalMarks > 0
      ? Math.round((data.attempt.marksObtained / data.attempt.totalMarks) * 100)
      : null,
    accuracy: null,
    markedForReviewCount: 0,
    timeTakenSeconds: 0,
  };

  return {
    attemptId: data.attempt._id,
    quiz: {
      title: data.quiz.title,
      subject: typeof data.quiz.subject === 'object' ? data.quiz.subject.name : data.quiz.subject,
      totalQuestions: data.attempt.totalQuestions,
      totalMarks: data.attempt.totalMarks,
      shareSolution: data.quiz.shareSolution !== undefined ? data.quiz.shareSolution : true,
    },
    summary,
    sectionPerformance: data.attempt.sectionPerformance || [],
    hasSectionData: data.hasSectionData ?? (data.attempt.sectionPerformance?.length > 0),
    wrongQuestions: data.wrongQuestions || [],
    frequentlyMissedQuestions: data.frequentlyMissedQuestions || [],
    questionPerformance: data.questionPerformance || [],
    startTime: data.attempt.startTime,
    endTime: data.attempt.endTime,
    status: data.attempt.status,
    canRequestRetest: data.attempt.canRequestRetest ?? (!data.attempt.retestRequested && !data.attempt.retestApproved),
    retestRequested: data.attempt.retestRequested || false,
    retestApproved: data.attempt.retestApproved || false,
  };
}

/** Builds chart slice data from a quiz result summary. */
export function buildPerformanceChartData(summary: QuizResultData['summary']) {
  return [
    { key: 'correct', label: 'Correct', count: summary.correct, color: '#10B981' },
    { key: 'incorrect', label: 'Wrong', count: summary.incorrect, color: '#EF4444' },
    { key: 'skipped', label: 'Unattempted', count: summary.skipped, color: '#F59E0B' },
  ];
}
