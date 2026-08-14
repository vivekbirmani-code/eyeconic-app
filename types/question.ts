// Canonical Question Bank types shared across the app (Question Bank UI,
// quiz taking, guest taking, review, and analytics). This is the single
// source of truth for question-related contracts on the frontend — keep it
// in sync with backend/constants/question.js.

export type QuestionType =
  | 'mcq_single'
  | 'assertion_reason'
  | 'match_the_following'
  | 'image_based'
  | 'multiple_correct'
  | 'numerical';

export const QUESTION_TYPES: QuestionType[] = [
  'mcq_single',
  'assertion_reason',
  'match_the_following',
  'image_based',
  'multiple_correct',
  'numerical',
];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq_single: 'MCQ — Single Correct',
  assertion_reason: 'Assertion / Reason',
  match_the_following: 'Match the Following',
  image_based: 'Image-Based',
  multiple_correct: 'Multiple Correct',
  numerical: 'Numerical',
};

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTY_LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export const DEFAULT_ASSERTION_REASON_OPTIONS = [
  'Both Assertion and Reason are true, and Reason is the correct explanation of Assertion',
  'Both Assertion and Reason are true, but Reason is NOT the correct explanation of Assertion',
  'Assertion is true, but Reason is false',
  'Assertion is false, but Reason is true',
];

/** Answer shape stored per-question, dependent on questionType. */
export type SingleIndexAnswer = number; // mcq_single, image_based, assertion_reason
export type MultiIndexAnswer = number[]; // multiple_correct
export type MappingAnswer = Record<string, string>; // match_the_following: columnA idx -> columnB idx
export type NumericalAnswer = number; // numerical

export type StudentResponse =
  | SingleIndexAnswer
  | MultiIndexAnswer
  | MappingAnswer
  | NumericalAnswer
  | null
  | undefined
  | -1; // legacy "unanswered" sentinel

export interface QuestionSubjectRef {
  _id: string;
  name: string;
}

/** Full Question Bank document shape (admin/mentor view — includes answer key). */
export interface Question {
  _id: string;
  qid?: string;
  subject: QuestionSubjectRef;
  topicName: string;
  subtopicName: string;
  system: string;
  questionType: QuestionType;
  tags: string[];
  difficulty: Difficulty;

  question: string;
  questionImage?: string;

  options?: string[];
  optionImages?: string[];

  assertion?: string;
  reason?: string;

  columnA?: string[];
  columnB?: string[];

  correctAnswer?: SingleIndexAnswer | MultiIndexAnswer | MappingAnswer | NumericalAnswer;

  explanation?: string;
  explanationImage?: string;

  marks?: number;
  positiveMarks?: number | string;
  negativeMarks?: number | string;

  isActive?: boolean;
  createdAt?: string;
}

/** Question shape as delivered to a student during quiz taking (answer key stripped). */
export interface StudentFacingQuestion {
  _id: string;
  question: string;
  questionImage?: string;
  questionType: QuestionType;
  options?: string[];
  optionImages?: string[];
  assertion?: string;
  reason?: string;
  columnA?: string[];
  columnB?: string[];
  marks: number;
  subject?: QuestionSubjectRef;
  topicName?: string;
  tags?: string[];
}

/** Form state used by the Question Bank create/edit UI. */
export interface QuestionFormState {
  subject: string;
  topicName: string;
  subtopicName: string;
  system: string;
  questionType: QuestionType;
  tags: string[];
  difficulty: Difficulty;

  question: string;
  questionImage: string;

  options: string[];
  optionImages: string[];

  assertion: string;
  reason: string;

  columnA: string[];
  columnB: string[];

  // UI-friendly mapping representation: columnA index -> columnB index (as string keys)
  correctMapping: Record<string, string>;
  correctAnswer: number; // single-index types
  correctAnswers: number[]; // multiple_correct
  correctNumerical: string; // numerical (kept as string while editing)

  explanation: string;
  explanationImage: string;

  marks: number;
  positiveMarks: number | string;
  negativeMarks: number | string;
}

export const emptyQuestionFormState = (): QuestionFormState => ({
  subject: '',
  topicName: '',
  subtopicName: '',
  system: '',
  questionType: 'mcq_single',
  tags: [],
  difficulty: 'medium',
  question: '',
  questionImage: '',
  options: ['', '', '', ''],
  optionImages: ['', '', '', ''],
  assertion: '',
  reason: '',
  columnA: ['', ''],
  columnB: ['', ''],
  correctMapping: {},
  correctAnswer: 0,
  correctAnswers: [],
  correctNumerical: '',
  explanation: '',
  explanationImage: '',
  marks: 4,
  positiveMarks: 4,
  negativeMarks: -1,
});

/** Determine whether a response counts as "answered" for a given question type. */
export function isResponseAnswered(questionType: QuestionType, response: StudentResponse): boolean {
  if (response === undefined || response === null) return false;
  switch (questionType) {
    case 'mcq_single':
    case 'image_based':
    case 'assertion_reason':
      return typeof response === 'number' && response >= 0;
    case 'multiple_correct':
      return Array.isArray(response) && response.length > 0;
    case 'match_the_following':
      return typeof response === 'object' && !Array.isArray(response) && Object.keys(response).length > 0;
    case 'numerical':
      return typeof response === 'number' && Number.isFinite(response);
    default:
      return typeof response === 'number' && response >= 0;
  }
}
