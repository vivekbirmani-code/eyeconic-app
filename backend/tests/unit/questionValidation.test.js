const {
  QuestionValidationError,
  normalizeQuestionInput,
  normalizeTags,
  validateQuestionPayload,
} = require('../../utils/questionValidation');

const validMetadata = () => ({
  subject: '507f1f77bcf86cd799439011',
  topicName: 'Genetics',
  subtopicName: 'Mendelian Inheritance',
  system: 'Genetic Disorders',
  difficulty: 'medium',
  question: 'What is the powerhouse of the cell?',
});

describe('normalizeTags', () => {
  it('returns an empty array for undefined/null', () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
  });

  it('trims, dedupes, and drops empty tags from a comma-separated string', () => {
    expect(normalizeTags('important, 2024, important,  ')).toEqual(['important', '2024']);
  });

  it('accepts an array of tags', () => {
    expect(normalizeTags(['a', ' b ', ''])).toEqual(['a', 'b']);
  });
});

describe('normalizeQuestionInput', () => {
  it('maps alias question type labels to canonical ids', () => {
    const result = normalizeQuestionInput({ questionType: 'MCQ Single Correct' });
    expect(result.questionType).toBe('mcq_single');
  });

  it('preserves an invalid questionType so validation can report it', () => {
    const result = normalizeQuestionInput({ questionType: 'not-a-real-type' });
    expect(result.questionType).toBe('not-a-real-type');
  });

  it('maps difficulty aliases to canonical lowercase values', () => {
    expect(normalizeQuestionInput({ difficulty: 'Easy' }).difficulty).toBe('easy');
    expect(normalizeQuestionInput({ difficulty: 'Moderate' }).difficulty).toBe('medium');
  });
});

describe('validateQuestionPayload — metadata matrix', () => {
  it('rejects a payload missing any of the six required fields', () => {
    const requiredFields = ['subject', 'topicName', 'subtopicName', 'system', 'questionType', 'difficulty'];
    requiredFields.forEach((field) => {
      const data = { ...validMetadata(), questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 0 };
      delete data[field];
      expect(() => validateQuestionPayload({ ...data })).toThrow(QuestionValidationError);
    });
  });

  it('allows an empty tags array (tags are optional)', () => {
    const data = { ...validMetadata(), questionType: 'mcq_single', tags: [], options: ['A', 'B'], correctAnswer: 0 };
    expect(() => validateQuestionPayload(data)).not.toThrow();
  });

  it('rejects an invalid questionType', () => {
    const data = { ...validMetadata(), questionType: 'essay' };
    expect(() => validateQuestionPayload(data)).toThrow(QuestionValidationError);
  });

  it('rejects an invalid difficulty', () => {
    const data = { ...validMetadata(), questionType: 'mcq_single', difficulty: 'super-hard', options: ['A', 'B'], correctAnswer: 0 };
    expect(() => validateQuestionPayload(data)).toThrow(QuestionValidationError);
  });
});

describe('validateQuestionPayload — mcq_single', () => {
  it('requires at least 2 options', () => {
    const data = { ...validMetadata(), questionType: 'mcq_single', options: ['Only one'], correctAnswer: 0 };
    expect(() => validateQuestionPayload(data)).toThrow(QuestionValidationError);
  });

  it('rejects an out-of-range correctAnswer index', () => {
    const data = { ...validMetadata(), questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 5 };
    expect(() => validateQuestionPayload(data)).toThrow(QuestionValidationError);
  });

  it('accepts a valid mcq_single question', () => {
    const data = { ...validMetadata(), questionType: 'mcq_single', options: ['A', 'B', 'C'], correctAnswer: 1 };
    expect(() => validateQuestionPayload(data)).not.toThrow();
  });
});

describe('validateQuestionPayload — image_based', () => {
  it('requires a question image', () => {
    const data = { ...validMetadata(), questionType: 'image_based', options: ['A', 'B'], correctAnswer: 0 };
    expect(() => validateQuestionPayload(data)).toThrow(QuestionValidationError);
  });

  it('accepts a valid image_based question', () => {
    const data = {
      ...validMetadata(),
      questionType: 'image_based',
      questionImage: 'https://example.com/img.png',
      options: ['A', 'B'],
      correctAnswer: 0,
    };
    expect(() => validateQuestionPayload(data)).not.toThrow();
  });
});

describe('validateQuestionPayload — assertion_reason', () => {
  it('requires assertion and reason text', () => {
    const data = { ...validMetadata(), questionType: 'assertion_reason', correctAnswer: 0 };
    expect(() => validateQuestionPayload(data)).toThrow(QuestionValidationError);
  });

  it('defaults to the four standard relationship options when none are given', () => {
    const data = {
      ...validMetadata(),
      questionType: 'assertion_reason',
      assertion: 'Mitochondria produce ATP.',
      reason: 'Mitochondria have a double membrane.',
      correctAnswer: 0,
    };
    expect(() => validateQuestionPayload(data)).not.toThrow();
    expect(data.options.length).toBe(4);
  });
});

describe('validateQuestionPayload — multiple_correct', () => {
  it('requires at least one correct option', () => {
    const data = { ...validMetadata(), questionType: 'multiple_correct', options: ['A', 'B', 'C'], correctAnswer: [] };
    expect(() => validateQuestionPayload(data)).toThrow(QuestionValidationError);
  });

  it('rejects duplicate correct indices', () => {
    const data = { ...validMetadata(), questionType: 'multiple_correct', options: ['A', 'B', 'C'], correctAnswer: [0, 0] };
    expect(() => validateQuestionPayload(data)).toThrow(QuestionValidationError);
  });

  it('accepts a valid multi-select answer', () => {
    const data = { ...validMetadata(), questionType: 'multiple_correct', options: ['A', 'B', 'C'], correctAnswer: [0, 2] };
    expect(() => validateQuestionPayload(data)).not.toThrow();
  });
});

describe('validateQuestionPayload — match_the_following', () => {
  const columnA = ['Item 1', 'Item 2'];
  const columnB = ['Match A', 'Match B'];

  it('requires at least 2 entries per column', () => {
    const data = { ...validMetadata(), questionType: 'match_the_following', columnA: ['Only one'], columnB, correctAnswer: {} };
    expect(() => validateQuestionPayload(data)).toThrow(QuestionValidationError);
  });

  it('requires a complete mapping covering every Column A entry', () => {
    const data = { ...validMetadata(), questionType: 'match_the_following', columnA, columnB, correctAnswer: { '0': '1' } };
    expect(() => validateQuestionPayload(data)).toThrow(QuestionValidationError);
  });

  it('rejects mapping values outside Column B range', () => {
    const data = { ...validMetadata(), questionType: 'match_the_following', columnA, columnB, correctAnswer: { '0': '5', '1': '0' } };
    expect(() => validateQuestionPayload(data)).toThrow(QuestionValidationError);
  });

  it('accepts a complete, valid mapping', () => {
    const data = { ...validMetadata(), questionType: 'match_the_following', columnA, columnB, correctAnswer: { '0': '1', '1': '0' } };
    expect(() => validateQuestionPayload(data)).not.toThrow();
  });
});

describe('validateQuestionPayload — numerical', () => {
  it('rejects a non-numeric correctAnswer', () => {
    const data = { ...validMetadata(), questionType: 'numerical', correctAnswer: 'not-a-number' };
    expect(() => validateQuestionPayload(data)).toThrow(QuestionValidationError);
  });

  it('accepts 0 as a valid numerical answer', () => {
    const data = { ...validMetadata(), questionType: 'numerical', correctAnswer: 0 };
    expect(() => validateQuestionPayload(data)).not.toThrow();
  });

  it('coerces a numeric string into a Number', () => {
    const data = { ...validMetadata(), questionType: 'numerical', correctAnswer: '12.5' };
    validateQuestionPayload(data);
    expect(data.correctAnswer).toBe(12.5);
  });
});
