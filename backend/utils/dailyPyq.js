const QuestionBank = require('../models/QuestionBank');
const DailyPyqSet = require('../models/DailyPyqSet');
const { QUESTION_TYPES } = require('../constants/question');

/**
 * Daily PYQ helpers: IST date keys, deterministic per-date question
 * selection, and streak math. Pure functions are exported for unit tests;
 * only getOrCreateDailySet touches the database.
 */

const DAILY_QUESTION_COUNT = 10;

// The daily player renders one-best-answer questions. Multi-correct, match
// and numerical types need interaction modes the daily flow does not carry,
// so the pool is restricted to single-choice types. All three render through
// the same option-list UI the daily player implements.
const DAILY_POOL_QUESTION_TYPES = [
    QUESTION_TYPES.MCQ_SINGLE,
    QUESTION_TYPES.IMAGE_BASED,
    QUESTION_TYPES.ASSERTION_REASON
];

// A question used in any of the last N daily sets is excluded from today's
// pool (when the bank is large enough) so the feature rotates instead of
// repeating the same small group forever.
const ROTATION_LOOKBACK_DAYS = 7;

/** IST calendar date key ('YYYY-MM-DD') for a moment in time. */
function istDateKey(date = new Date()) {
    // en-CA formats as YYYY-MM-DD; the timeZone option does the IST shift.
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

function isValidDateKey(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const d = new Date(`${key}T00:00:00.000Z`);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === key;
}

/** Pure string-date arithmetic on UTC midnights of 'YYYY-MM-DD' keys. */
function addDaysKey(key, days) {
    const d = new Date(`${key}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// ── Deterministic selection ────────────────────────────────────────────────
// xmur3 string hash → mulberry32 PRNG: same seed string (the date key) always
// produces the same shuffle sequence on every server and every process.

function hashString(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
}

function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function seededShuffle(items, seedStr) {
    const rand = mulberry32(hashString(seedStr));
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Pick today's question ids deterministically.
 *
 * @param {string} dateKey - IST 'YYYY-MM-DD' (the shuffle seed)
 * @param {string[]} poolIds - candidate question ids (active, single-choice)
 * @param {Set<string>} recentIds - ids used in recent daily sets (rotation)
 * @returns {string[]} at most DAILY_QUESTION_COUNT ids, in seeded order
 */
function pickDailyQuestionIds(dateKey, poolIds, recentIds) {
    let candidates = poolIds.filter((id) => !recentIds.has(id));
    // Bank too small to honour rotation — fall back to the full pool rather
    // than failing the day.
    if (candidates.length < DAILY_QUESTION_COUNT) {
        candidates = poolIds;
    }
    return seededShuffle(candidates, dateKey).slice(0, DAILY_QUESTION_COUNT);
}

/**
 * Get (or atomically create) the frozen question set for a date. The set is
 * shared by all students. $setOnInsert upsert: if two requests race to create
 * the same date, both resolve to the SAME persisted document.
 */
async function getOrCreateDailySet(dateKey) {
    const existing = await DailyPyqSet.findOne({ date: dateKey }).lean();
    if (existing) return existing;

    const pool = await QuestionBank.find({
        isActive: true,
        questionType: { $in: DAILY_POOL_QUESTION_TYPES }
    }).select('_id').lean();
    const poolIds = pool.map((q) => q._id.toString());

    const recentSets = await DailyPyqSet.find({
        date: { $gt: addDaysKey(dateKey, -ROTATION_LOOKBACK_DAYS), $lt: dateKey }
    }).select('questionIds').lean();
    const recentIds = new Set(recentSets.flatMap((s) => s.questionIds.map(String)));

    const ids = pickDailyQuestionIds(dateKey, poolIds, recentIds);

    return DailyPyqSet.findOneAndUpdate(
        { date: dateKey },
        {
            $setOnInsert: {
                date: dateKey,
                questionIds: ids,
                questionCount: ids.length
            }
        },
        { upsert: true, new: true }
    ).lean();
}

// ── Streaks ────────────────────────────────────────────────────────────────

/**
 * Current and best streak over a student's completed daily dates.
 *
 * A day counts only when its Daily PYQ was submitted. The current streak
 * ends at today if today is done, otherwise at yesterday (an untouched today
 * does not break a streak until the day is actually over).
 *
 * @param {string[]} dateKeys - completed dates ('YYYY-MM-DD')
 * @param {string} todayKey - today's IST date key
 */
function computeStreaks(dateKeys, todayKey) {
    const done = new Set(dateKeys);

    let anchor = done.has(todayKey) ? todayKey : addDaysKey(todayKey, -1);
    let current = 0;
    while (done.has(anchor)) {
        current++;
        anchor = addDaysKey(anchor, -1);
    }

    let best = 0;
    let run = 0;
    let prev = null;
    for (const key of [...done].sort()) {
        run = prev && addDaysKey(prev, 1) === key ? run + 1 : 1;
        if (run > best) best = run;
        prev = key;
    }
    return { current, best: Math.max(best, current) };
}

module.exports = {
    DAILY_QUESTION_COUNT,
    DAILY_POOL_QUESTION_TYPES,
    ROTATION_LOOKBACK_DAYS,
    istDateKey,
    isValidDateKey,
    addDaysKey,
    pickDailyQuestionIds,
    getOrCreateDailySet,
    computeStreaks
};
