/**
 * Unit tests for the pure Daily PYQ helpers: date keys, deterministic
 * selection with rotation, and streak math.
 */
const {
    DAILY_QUESTION_COUNT,
    istDateKey,
    isValidDateKey,
    addDaysKey,
    pickDailyQuestionIds,
    computeStreaks
} = require('../../utils/dailyPyq');

describe('dailyPyq unit helpers', () => {
    describe('date keys', () => {
        it('formats IST calendar dates (UTC evening = next IST day)', () => {
            // 2026-09-24 20:30 UTC == 2026-09-25 02:00 IST.
            expect(istDateKey(new Date('2026-09-24T20:30:00.000Z'))).toBe('2026-09-25');
            // 2026-09-24 10:30 UTC == 2026-09-24 16:00 IST.
            expect(istDateKey(new Date('2026-09-24T10:30:00.000Z'))).toBe('2026-09-24');
            // IST offset is +05:30 with no DST.
            expect(istDateKey(new Date('2026-01-01T18:29:59.000Z'))).toBe('2026-01-01');
            expect(istDateKey(new Date('2026-01-01T18:30:00.000Z'))).toBe('2026-01-02');
        });

        it('validates and shifts date keys', () => {
            expect(isValidDateKey('2026-09-24')).toBe(true);
            expect(isValidDateKey('2026-9-24')).toBe(false);
            expect(isValidDateKey('2026-02-30')).toBe(false); // not a real date
            expect(isValidDateKey('nonsense')).toBe(false);

            expect(addDaysKey('2026-09-24', 1)).toBe('2026-09-25');
            expect(addDaysKey('2026-09-24', -1)).toBe('2026-09-23');
            expect(addDaysKey('2026-02-28', 1)).toBe('2026-03-01');
            expect(addDaysKey('2028-02-28', 1)).toBe('2028-02-29'); // leap year
        });
    });

    describe('deterministic selection', () => {
        const pool = Array.from({ length: 40 }, (_, i) => `q${i}`);

        it('picks exactly DAILY_QUESTION_COUNT, deterministically', () => {
            const a = pickDailyQuestionIds('2026-09-24', pool, new Set());
            const b = pickDailyQuestionIds('2026-09-24', pool, new Set());
            expect(a).toHaveLength(DAILY_QUESTION_COUNT);
            expect(a).toEqual(b);
            expect(new Set(a).size).toBe(DAILY_QUESTION_COUNT); // no repeats
        });

        it('differs across dates (rotation across the bank)', () => {
            const a = pickDailyQuestionIds('2026-09-24', pool, new Set());
            const b = pickDailyQuestionIds('2026-09-25', pool, new Set());
            expect(a).not.toEqual(b);
        });

        it('excludes recent ids while the pool allows it', () => {
            const recent = new Set(pool.slice(0, 10));
            const picked = pickDailyQuestionIds('2026-09-24', pool, recent);
            expect(picked).toHaveLength(DAILY_QUESTION_COUNT);
            for (const id of picked) expect(recent.has(id)).toBe(false);
        });

        it('falls back to the full pool when the bank is too small to rotate', () => {
            const smallPool = pool.slice(0, 12);
            const recent = new Set(smallPool.slice(0, 10));
            const picked = pickDailyQuestionIds('2026-09-24', smallPool, recent);
            expect(picked).toHaveLength(DAILY_QUESTION_COUNT);
        });

        it('returns fewer than 10 when the bank itself is smaller', () => {
            expect(pickDailyQuestionIds('2026-09-24', pool.slice(0, 5), new Set())).toHaveLength(5);
        });
    });

    describe('streaks', () => {
        it('counts a streak ending today', () => {
            const s = computeStreaks(['2026-09-22', '2026-09-23', '2026-09-24'], '2026-09-24');
            expect(s).toEqual({ current: 3, best: 3 });
        });

        it('keeps yesterday-ending streak alive until today is done', () => {
            const s = computeStreaks(['2026-09-22', '2026-09-23'], '2026-09-24');
            expect(s.current).toBe(2);
        });

        it('resets to zero after a missed day (with today undone)', () => {
            // 20 ✓, 21 ✓, 22 ✗, 23 ✓ — today (24) not yet done.
            const s = computeStreaks(['2026-09-20', '2026-09-21', '2026-09-23'], '2026-09-24');
            expect(s.current).toBe(1);
        });

        it('current is 1 when only today is done', () => {
            const s = computeStreaks(['2026-09-24'], '2026-09-24');
            expect(s.current).toBe(1);
        });

        it('tracks the best run across gaps', () => {
            // Runs: 20-22 (3), 24 (1), 26-28 (3) — best 3, current (today=28) 3.
            const s = computeStreaks(
                ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-24', '2026-09-26', '2026-09-27', '2026-09-28'],
                '2026-09-28'
            );
            expect(s).toEqual({ current: 3, best: 3 });

            const gapped = computeStreaks(
                ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-26'],
                '2026-09-26'
            );
            expect(gapped).toEqual({ current: 1, best: 3 });
        });

        it('handles a student with no attempts', () => {
            expect(computeStreaks([], '2026-09-24')).toEqual({ current: 0, best: 0 });
        });
    });
});
