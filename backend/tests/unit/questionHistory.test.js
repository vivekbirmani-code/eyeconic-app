const {
  computeTimeTakenSeconds,
  classifyQuestionResult,
  isAnswerRecorded,
} = require('../../utils/questionHistory');

describe('questionHistory utilities', () => {
  describe('isAnswerRecorded', () => {
    it('treats null, undefined, and -1 as unanswered', () => {
      expect(isAnswerRecorded(null)).toBe(false);
      expect(isAnswerRecorded(undefined)).toBe(false);
      expect(isAnswerRecorded(-1)).toBe(false);
    });

    it('treats valid MCQ and numerical answers as answered', () => {
      expect(isAnswerRecorded(0)).toBe(true);
      expect(isAnswerRecorded(2)).toBe(true);
      expect(isAnswerRecorded(0)).toBe(true);
    });

    it('treats empty arrays and objects as unanswered', () => {
      expect(isAnswerRecorded([])).toBe(false);
      expect(isAnswerRecorded({})).toBe(false);
    });

    it('treats non-empty arrays and objects as answered', () => {
      expect(isAnswerRecorded([0, 2])).toBe(true);
      expect(isAnswerRecorded({ '0': '1' })).toBe(true);
    });
  });

  describe('classifyQuestionResult', () => {
    it('classifies unanswered responses', () => {
      expect(classifyQuestionResult(null)).toBe('unattempted');
      expect(classifyQuestionResult({ selectedAnswer: -1 })).toBe('unattempted');
    });

    it('classifies correct and incorrect responses', () => {
      expect(classifyQuestionResult({ selectedAnswer: 1, isCorrect: true })).toBe('correct');
      expect(classifyQuestionResult({ selectedAnswer: 0, isCorrect: false })).toBe('incorrect');
    });
  });

  describe('computeTimeTakenSeconds', () => {
    it('uses start and end time when available', () => {
      const attempt = {
        startTime: new Date('2026-01-01T10:00:00Z'),
        endTime: new Date('2026-01-01T10:02:15Z'),
      };
      expect(computeTimeTakenSeconds(attempt)).toBe(135);
    });

    it('falls back to answer timeSpent totals', () => {
      const attempt = {
        answers: [{ timeSpent: 12 }, { timeSpent: 8 }],
      };
      expect(computeTimeTakenSeconds(attempt)).toBe(20);
    });
  });
});
