/**
 * Types for the public quiz result payload.
 *
 * Mirrors the mobile app's `types/quiz-result.ts` contract — the guest result
 * endpoint returns the SAME `buildAttemptResults` payload the authenticated
 * app consumes (backend/utils/attemptResults.js), minus student-history
 * aggregations (guests have no cross-attempt identity) and plus a `guest`
 * block for the verified lead.
 */

export interface QuizResultSummary {
  correct: number;
  incorrect: number;
  skipped: number;
  attempted: number;
  totalQuestions: number;
  marksObtained: number;
  totalMarks: number;
  /** Marks-based percentage — null when totalMarks is 0/invalid. */
  scorePercentage: number | null;
  /** correct / attempted — null when nothing was attempted. */
  accuracy: number | null;
  markedForReviewCount: number;
  timeTakenSeconds: number;
}

export interface SectionPerformance {
  sectionName: string;
  correct: number;
  incorrect: number;
  skipped: number;
  timeSpent: number;
  accuracy: number;
  total?: number;
}

/** A question row from the result payload's `questions` array. */
export interface ResultQuestion {
  _id: string;
  question: string;
  questionImage?: string | null;
  options: string[];
  optionImages?: (string | null)[] | null;
  questionType?: string;
  assertion?: string | null;
  reason?: string | null;
  columnA?: string[] | null;
  columnB?: string[] | null;
  marks?: number;
  subject?: { _id: string; name: string } | string | null;
  topicName?: string | null;
  userAnswer: unknown;
  isCorrect: boolean;
  timeSpent?: number;
  markedForReview?: boolean;
  section: string;
  sectionQuestionIndex?: number;
  globalIndex?: number;
  /** Present only when the quiz shares solutions. */
  correctAnswer?: unknown;
  explanation?: string;
  explanationImage?: string | null;
}

export interface PublicResultPayload {
  success: boolean;
  summary: QuizResultSummary;
  attempt: {
    _id: string;
    status: string;
    startTime: string;
    endTime: string;
    score: number;
    totalQuestions: number;
    marksObtained: number;
    totalMarks: number;
    sectionPerformance: SectionPerformance[];
    tabSwitchCount?: number;
  };
  quiz: {
    _id: string;
    title: string;
    subject: { _id: string; name: string } | string | null;
    subjectNames?: string[];
    testType?: string;
    shareSolution: boolean;
  };
  guest: {
    _id: string;
    name: string;
    email: string | null;
    phoneMasked: string;
  };
  questions: ResultQuestion[];
  hasSectionData?: boolean;
  groupBy?: string;
}

export type GroupByOption = 'section' | 'subject' | 'topic' | 'tag';
