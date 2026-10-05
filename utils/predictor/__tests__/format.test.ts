import {
  fmtPct,
  fmtRank,
  isSessionTag,
  latestAttempt,
  sessionLabel,
  yearFilterLabel,
} from '../format';

describe('predictor format helpers (ported from the website client)', () => {
  describe('fmtRank', () => {
    it('formats a rank with en-IN grouping', () => {
      expect(fmtRank(130114)).toBe('1,30,114');
      expect(fmtRank(9511)).toBe('9,511');
    });

    it('renders a null end as an em dash, or "beyond N" when data records the boundary', () => {
      expect(fmtRank(null)).toBe('—');
      expect(fmtRank(null, 230114)).toBe('beyond 2,30,114');
      expect(fmtRank(undefined, 230114)).toBe('beyond 2,30,114');
    });
  });

  describe('fmtPct', () => {
    it('formats one decimal place with a percent sign', () => {
      expect(fmtPct(97.25)).toBe('97.3%');
      expect(fmtPct(42)).toBe('42.0%');
    });
  });

  describe('INI-CET session tags', () => {
    it('labels YYYYMM counselling tags Jan/Jul', () => {
      expect(sessionLabel(202501)).toBe('Jan 2025');
      expect(sessionLabel(202507)).toBe('Jul 2025');
    });

    it('detects session tags (>200000) versus plain NEET years', () => {
      expect(isSessionTag(202507)).toBe(true);
      expect(isSessionTag(2025)).toBe(false);
    });

    it('labels year-filter options per exam', () => {
      expect(yearFilterLabel(2024)).toBe('2024');
      expect(yearFilterLabel(202301)).toBe('Jan 2023');
    });
  });

  describe('latestAttempt', () => {
    it('picks the attempt with the newest end time (the engine dedup rule)', () => {
      const attempts = [
        { endedAt: 1700000000000, corrects: 100 },
        { endedAt: 1710000000000, corrects: 120 },
        { endedAt: 1690000000000, corrects: 90 },
      ];
      expect(latestAttempt(attempts).corrects).toBe(120);
    });

    it('parses ISO strings and treats a missing end time as oldest', () => {
      const attempts = [
        { endedAt: undefined, corrects: 100 },
        { endedAt: '2026-08-20T10:00:00.000Z', corrects: 128 },
        { endedAt: '2026-08-01T10:00:00.000Z', corrects: 112 },
      ];
      expect(latestAttempt(attempts).corrects).toBe(128);
    });
  });
});
