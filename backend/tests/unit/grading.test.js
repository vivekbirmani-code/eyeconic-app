const { isAnswered, gradeQuestion } = require('../../utils/grading');

describe('isAnswered', () => {
  it('treats -1, null, and undefined as not answered for single-index types', () => {
    expect(isAnswered('mcq_single', -1)).toBe(false);
    expect(isAnswered('mcq_single', null)).toBe(false);
    expect(isAnswered('mcq_single', undefined)).toBe(false);
  });

  it('treats a valid index as answered', () => {
    expect(isAnswered('mcq_single', 0)).toBe(true);
  });

  it('treats an empty array as not answered for multiple_correct', () => {
    expect(isAnswered('multiple_correct', [])).toBe(false);
    expect(isAnswered('multiple_correct', [1])).toBe(true);
  });

  it('treats an empty mapping as not answered for match_the_following', () => {
    expect(isAnswered('match_the_following', {})).toBe(false);
    expect(isAnswered('match_the_following', { '0': '1' })).toBe(true);
  });

  it('treats 0 as answered for numerical (not a skip)', () => {
    expect(isAnswered('numerical', 0)).toBe(true);
    expect(isAnswered('numerical', null)).toBe(false);
  });

  it('falls back to mcq_single behavior for an unknown/legacy type', () => {
    expect(isAnswered(undefined, 2)).toBe(true);
    expect(isAnswered(undefined, -1)).toBe(false);
  });
});

describe('gradeQuestion', () => {
  it('grades mcq_single by exact index equality', () => {
    const question = { questionType: 'mcq_single', correctAnswer: 2 };
    expect(gradeQuestion(question, 2)).toEqual({ answered: true, isCorrect: true });
    expect(gradeQuestion(question, 1)).toEqual({ answered: true, isCorrect: false });
    expect(gradeQuestion(question, -1)).toEqual({ answered: false, isCorrect: false });
  });

  it('grades assertion_reason and image_based the same as mcq_single', () => {
    expect(gradeQuestion({ questionType: 'assertion_reason', correctAnswer: 0 }, 0).isCorrect).toBe(true);
    expect(gradeQuestion({ questionType: 'image_based', correctAnswer: 3 }, 3).isCorrect).toBe(true);
  });

  it('grades multiple_correct via order-independent set equality, no partial credit', () => {
    const question = { questionType: 'multiple_correct', correctAnswer: [0, 2] };
    expect(gradeQuestion(question, [2, 0]).isCorrect).toBe(true);
    expect(gradeQuestion(question, [0]).isCorrect).toBe(false);
    expect(gradeQuestion(question, [0, 1]).isCorrect).toBe(false);
  });

  it('grades match_the_following by exact mapping equality', () => {
    const question = { questionType: 'match_the_following', correctAnswer: { '0': '1', '1': '0' } };
    expect(gradeQuestion(question, { '0': '1', '1': '0' }).isCorrect).toBe(true);
    expect(gradeQuestion(question, { '0': '0', '1': '1' }).isCorrect).toBe(false);
    expect(gradeQuestion(question, { '0': '1' }).isCorrect).toBe(false); // incomplete
  });

  it('grades numerical with exact equality and no tolerance', () => {
    const question = { questionType: 'numerical', correctAnswer: 12.5 };
    expect(gradeQuestion(question, 12.5).isCorrect).toBe(true);
    expect(gradeQuestion(question, 12.500001).isCorrect).toBe(false);
    expect(gradeQuestion(question, 0).answered).toBe(true);
  });

  it('marks unanswered questions as not-correct without evaluating equality', () => {
    const question = { questionType: 'numerical', correctAnswer: 5 };
    expect(gradeQuestion(question, null)).toEqual({ answered: false, isCorrect: false });
  });

  it('defaults legacy questions without questionType to mcq_single grading', () => {
    const question = { correctAnswer: 1 };
    expect(gradeQuestion(question, 1)).toEqual({ answered: true, isCorrect: true });
  });
});
