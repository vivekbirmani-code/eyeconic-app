export interface QuestionHistory {
  questionId: string;
  totalAttempts: number;
  correctAttempts: number;
  incorrectAttempts: number;
  skippedAttempts: number;
  previousIncorrectAttempts: number;
  lastAttemptAt?: string | null;
  lastIncorrectAt?: string | null;
}

export interface QuizResultSummary {
  correct: number;
  incorrect: number;
  skipped: number;
  attempted: number;
  totalQuestions: number;
  marksObtained: number;
  totalMarks: number;
  scorePercentage: number | null;
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

export interface WrongQuestion {
  questionId: string;
  questionIndex: number;
  displayNumber: number;
  question: string;
  questionImage?: string;
  questionType?: string;
  section?: string;
  topicName?: string;
  subjectName?: string;
  selectedAnswer: unknown;
  selectedAnswerLabel: string;
  selectedAnswerText: string;
  correctAnswer?: unknown;
  correctAnswerLabel?: string;
  correctAnswerText?: string;
  explanation?: string;
  explanationImage?: string;
  timeSpent: number;
  history: QuestionHistory;
}

export interface FrequentlyMissedQuestion {
  questionId: string;
  question: string;
  totalAttempts: number;
  correctAttempts: number;
  incorrectAttempts: number;
  incorrectPercentage: number;
  latestResult: 'correct' | 'incorrect';
  latestAttemptAt?: string;
  topicName?: string | null;
  subjectName?: string | null;
  section?: string | null;
}

export interface QuestionPerformanceItem {
  questionId: string;
  questionIndex: number;
  section?: string;
  status: 'correct' | 'incorrect' | 'unattempted';
  isCorrect: boolean;
  markedForReview: boolean;
  timeSpent: number;
  history: QuestionHistory;
}

export interface QuizResultData {
  attemptId: string;
  quiz: {
    title: string;
    subject: string;
    totalQuestions: number;
    totalMarks: number;
    shareSolution: boolean;
  };
  summary: QuizResultSummary;
  sectionPerformance: SectionPerformance[];
  hasSectionData: boolean;
  wrongQuestions: WrongQuestion[];
  frequentlyMissedQuestions: FrequentlyMissedQuestion[];
  questionPerformance: QuestionPerformanceItem[];
  startTime: string;
  endTime: string;
  status: string;
  canRequestRetest: boolean;
  retestRequested: boolean;
  retestApproved: boolean;
}
