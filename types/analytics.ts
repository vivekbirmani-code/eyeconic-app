export type DateRange = '7d' | '30d' | '90d' | null;

export interface AttemptStats {
  correct: number;
  incorrect: number;
  skipped: number;
  attempted: number;
  totalQuestions: number;
  marksObtained: number;
  totalMarks: number;
  scorePercentage: number | null;
  accuracy: number | null;
  /** Legacy marks-based percentage (0 when scorePercentage is null). */
  percentage: number;
}

export interface StudentAnalyticsSummary {
  totalTests: number;
  totalMarks: number;
  obtainedMarks: number;
  avgPercentage: number;
  avgScorePercentage: number | null;
  avgAccuracy: number | null;
  totalCorrect: number;
  totalIncorrect: number;
  totalSkipped: number;
  totalAttempted: number;
  totalQuestions: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  showingFrom?: number;
  showingTo?: number;
}

export interface StudentPerformanceAttempt {
  _id: string;
  quiz: {
    _id: string;
    title: string;
    testType?: string;
    totalMarks?: number;
  };
  score: number;
  totalQuestions: number;
  marksObtained: number;
  totalMarks: number;
  scorePercentage: number | null;
  accuracy: number | null;
  correct?: number;
  incorrect?: number;
  skipped?: number;
  attempted?: number;
  percentage: number;
  endTime: string;
  tabSwitchCount?: number;
}

export interface StudentPerformanceResponse {
  student: {
    id: string;
    name: string;
    email?: string;
    profilePicture?: string | null;
  };
  summary: StudentAnalyticsSummary;
  trend?: TrendPoint[];
  attempts: StudentPerformanceAttempt[];
  pagination: PaginationMeta;
  frequentlyMissedQuestions: Array<{
    questionId: string;
    question: string;
    totalAttempts: number;
    correctAttempts: number;
    incorrectAttempts: number;
    incorrectPercentage: number;
    latestResult: 'correct' | 'incorrect' | 'unattempted';
    latestAttemptAt?: string;
    topicName?: string | null;
    subjectName?: string | null;
    section?: string | null;
  }>;
  frequentlyMissedPagination?: PaginationMeta;
  insights?: AnalyticsInsight[];
  subjectWise?: Record<string, { tests: number; totalMarks: number; obtainedMarks: number }>;
}

export interface TrendPoint {
  attemptId: string;
  quizTitle: string;
  date: string;
  scorePercentage: number | null;
  accuracy: number | null;
  marksObtained: number;
  totalMarks: number;
}

export interface AnalyticsInsight {
  type: string;
  message: string;
}

export interface PerformanceBucket {
  key: string;
  attempted: number;
  correct: number;
  incorrect?: number;
  skipped?: number;
  accuracy: number | null;
}

export interface StudentPerformanceBreakdown {
  overall: PerformanceBucket & { incorrect?: number; skipped?: number };
  bySubject: PerformanceBucket[];
  byTopic: PerformanceBucket[];
  bySubtopic: PerformanceBucket[];
  bySystem: PerformanceBucket[];
  byQuestionType: PerformanceBucket[];
  byTag: PerformanceBucket[];
  byDifficulty: PerformanceBucket[];
  strengths?: Array<PerformanceBucket & { label: string }>;
  weaknesses?: Array<PerformanceBucket & { label: string }>;
}

export interface ScoreDistributionBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface TestOverviewData {
  totalAssigned: number;
  totalAttempted: number;
  /** null when nothing was assigned (public test) — render as "—". */
  completionRate: number | null;
  avgScore: number;
  highestScore: number;
  lowestScore: number;
  avgScorePercentage: number | null;
  avgAccuracy: number | null;
}

/**
 * One ranked row of a test's live leaderboard — the exact shape
 * rankStudentAttempts returns from GET /quizzes/analytics/test/:id/leaderboard
 * (identical rows to studentPerformance in the full test analytics response).
 * rank is null when the cohort has a single attempt; leaderboard position is
 * index + 1 regardless.
 */
export interface LeaderboardEntry {
  _id: string;
  student: {
    _id: string;
    name: string;
    email: string;
  } | null;
  studentId: string;
  studentName: string;
  studentEmail: string;
  score: number;
  totalQuestions: number;
  marksObtained: number;
  totalMarks: number;
  scorePercentage: number | null;
  accuracy: number | null;
  correct: number;
  incorrect: number;
  skipped: number;
  attempted: number;
  percentage: number;
  timeSpent: number;
  completedAt: string;
  endTime: string;
  tabSwitchCount: number;
  rank: number | null;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  generatedAt: string;
}

export function formatPercent(value: number | null | undefined, fallback = 'N/A'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return `${Number(value.toFixed(2))}%`;
}

export function formatMetricValue(value: number | null | undefined, fallback = 'N/A'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return String(Number(value.toFixed(2)));
}
