import { formatDuration, formatPercentage, pluralize } from '../quizFormat';

describe('quizFormat utilities', () => {
  describe('formatDuration', () => {
    it('formats seconds only', () => {
      expect(formatDuration(45)).toBe('45s');
      expect(formatDuration(3)).toBe('3s');
    });

    it('formats minutes and seconds', () => {
      expect(formatDuration(135)).toBe('2m 15s');
      expect(formatDuration(120)).toBe('2m');
    });

    it('formats hours', () => {
      expect(formatDuration(3665)).toBe('1h 01m');
    });

    it('handles zero', () => {
      expect(formatDuration(0)).toBe('0s');
    });
  });

  describe('formatPercentage', () => {
    it('rounds valid percentages', () => {
      expect(formatPercentage(38.4)).toBe('38%');
      expect(formatPercentage(100)).toBe('100%');
    });

    it('returns fallback for nullish values', () => {
      expect(formatPercentage(null)).toBe('—');
      expect(formatPercentage(undefined, 'N/A')).toBe('N/A');
    });
  });

  describe('pluralize', () => {
    it('uses singular for count of 1', () => {
      expect(pluralize(1, 'Question')).toBe('1 Question');
    });

    it('uses plural for other counts', () => {
      expect(pluralize(3, 'Question')).toBe('3 Questions');
      expect(pluralize(0, 'Question')).toBe('0 Questions');
    });
  });
});
