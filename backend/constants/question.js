// Canonical Question Bank metadata enums.
// These are the single source of truth for question types and difficulty.
// Never store display labels ("MCQ Single", "Easy Question", etc.) in the database —
// always store one of the canonical values below.

const QUESTION_TYPES = Object.freeze({
    MCQ_SINGLE: 'mcq_single',
    ASSERTION_REASON: 'assertion_reason',
    MATCH_THE_FOLLOWING: 'match_the_following',
    IMAGE_BASED: 'image_based',
    MULTIPLE_CORRECT: 'multiple_correct',
    NUMERICAL: 'numerical',
});

const QUESTION_TYPE_VALUES = Object.values(QUESTION_TYPES);

const QUESTION_TYPE_LABELS = Object.freeze({
    [QUESTION_TYPES.MCQ_SINGLE]: 'MCQ — Single Correct',
    [QUESTION_TYPES.ASSERTION_REASON]: 'Assertion / Reason',
    [QUESTION_TYPES.MATCH_THE_FOLLOWING]: 'Match the Following',
    [QUESTION_TYPES.IMAGE_BASED]: 'Image-Based',
    [QUESTION_TYPES.MULTIPLE_CORRECT]: 'Multiple Correct',
    [QUESTION_TYPES.NUMERICAL]: 'Numerical',
});

// Accepts canonical ids, their human-readable labels, and common import-time
// variants, and normalizes them all to one canonical value. Used by both the
// API (create/update) and the Excel importer so the same rules apply everywhere.
const QUESTION_TYPE_ALIASES = Object.freeze({
    'mcq_single': QUESTION_TYPES.MCQ_SINGLE,
    'mcq single': QUESTION_TYPES.MCQ_SINGLE,
    'mcq': QUESTION_TYPES.MCQ_SINGLE,
    'mcq - single correct': QUESTION_TYPES.MCQ_SINGLE,
    'mcq single correct': QUESTION_TYPES.MCQ_SINGLE,
    'single correct': QUESTION_TYPES.MCQ_SINGLE,

    'assertion_reason': QUESTION_TYPES.ASSERTION_REASON,
    'assertion reason': QUESTION_TYPES.ASSERTION_REASON,
    'assertion / reason': QUESTION_TYPES.ASSERTION_REASON,
    'assertion-reason': QUESTION_TYPES.ASSERTION_REASON,

    'match_the_following': QUESTION_TYPES.MATCH_THE_FOLLOWING,
    'match the following': QUESTION_TYPES.MATCH_THE_FOLLOWING,
    'matching': QUESTION_TYPES.MATCH_THE_FOLLOWING,

    'image_based': QUESTION_TYPES.IMAGE_BASED,
    'image based': QUESTION_TYPES.IMAGE_BASED,
    'image-based': QUESTION_TYPES.IMAGE_BASED,

    'multiple_correct': QUESTION_TYPES.MULTIPLE_CORRECT,
    'multiple correct': QUESTION_TYPES.MULTIPLE_CORRECT,
    'multi correct': QUESTION_TYPES.MULTIPLE_CORRECT,
    'multi_correct': QUESTION_TYPES.MULTIPLE_CORRECT,

    'numerical': QUESTION_TYPES.NUMERICAL,
    'numeric': QUESTION_TYPES.NUMERICAL,
});

/**
 * Normalize any user/import-provided question type string into a canonical value.
 * Returns null if the value cannot be mapped to a known question type.
 */
function normalizeQuestionType(value) {
    if (value === undefined || value === null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    if (QUESTION_TYPE_VALUES.includes(raw)) return raw;
    // Normalize em/en dashes to a plain hyphen so labels like "MCQ — Single
    // Correct" (as displayed in QUESTION_TYPE_LABELS) round-trip correctly.
    const key = raw.toLowerCase().replace(/[\u2012-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
    return QUESTION_TYPE_ALIASES[key] || null;
}

const DIFFICULTY_LEVELS = Object.freeze({
    EASY: 'easy',
    MEDIUM: 'medium',
    HARD: 'hard',
});

const DIFFICULTY_VALUES = Object.values(DIFFICULTY_LEVELS);

const DIFFICULTY_LABELS = Object.freeze({
    [DIFFICULTY_LEVELS.EASY]: 'Easy',
    [DIFFICULTY_LEVELS.MEDIUM]: 'Medium',
    [DIFFICULTY_LEVELS.HARD]: 'Hard',
});

/**
 * Normalize any user/import-provided difficulty string into a canonical value.
 * Returns null if the value cannot be mapped to a known difficulty.
 */
function normalizeDifficulty(value) {
    if (value === undefined || value === null) return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    if (DIFFICULTY_VALUES.includes(raw)) return raw;
    if (raw === 'moderate') return DIFFICULTY_LEVELS.MEDIUM;
    return null;
}

// Standard relationship options for Assertion/Reason questions (NEET-style).
// Stored on the question document itself (not hardcoded at grading time) so
// admins can adjust wording per-question if needed, but this is the default set.
const DEFAULT_ASSERTION_REASON_OPTIONS = Object.freeze([
    'Both Assertion and Reason are true, and Reason is the correct explanation of Assertion',
    'Both Assertion and Reason are true, but Reason is NOT the correct explanation of Assertion',
    'Assertion is true, but Reason is false',
    'Assertion is false, but Reason is true',
]);

module.exports = {
    QUESTION_TYPES,
    QUESTION_TYPE_VALUES,
    QUESTION_TYPE_LABELS,
    normalizeQuestionType,
    DIFFICULTY_LEVELS,
    DIFFICULTY_VALUES,
    DIFFICULTY_LABELS,
    normalizeDifficulty,
    DEFAULT_ASSERTION_REASON_OPTIONS,
};
