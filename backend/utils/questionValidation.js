const {
    QUESTION_TYPES,
    normalizeQuestionType,
    normalizeDifficulty,
    DEFAULT_ASSERTION_REASON_OPTIONS,
} = require('../constants/question');

/**
 * A validation failure that carries an HTTP status and a list of field-level
 * messages, so routes can return clear 400s instead of generic 500s.
 */
class QuestionValidationError extends Error {
    constructor(errors) {
        super(Array.isArray(errors) ? errors.join('; ') : String(errors));
        this.name = 'QuestionValidationError';
        this.statusCode = 400;
        this.errors = Array.isArray(errors) ? errors : [errors];
    }
}

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const normalizeTags = (tags) => {
    if (tags === undefined || tags === null) return [];
    const arr = Array.isArray(tags) ? tags : String(tags).split(',');
    return [...new Set(
        arr
            .map((t) => (typeof t === 'string' ? t.trim() : String(t ?? '').trim()))
            .filter((t) => t.length > 0)
    )];
};

/**
 * Whitelist + normalize the fields a client (create or update) is allowed to
 * set on a QuestionBank document. This is the single place that maps
 * loosely-typed input (including alias labels) to canonical stored values.
 * Does not apply defaults for required fields — validateQuestionPayload does
 * that check separately so create/update/import share identical rules.
 */
function normalizeQuestionInput(body = {}) {
    const normalized = {};

    if (body.subject !== undefined) normalized.subject = body.subject;
    if (body.chapter !== undefined) normalized.chapter = body.chapter;
    if (body.topic !== undefined) normalized.topic = body.topic;

    if (body.topicName !== undefined) normalized.topicName = String(body.topicName).trim();
    if (body.subtopicName !== undefined) normalized.subtopicName = String(body.subtopicName).trim();
    if (body.system !== undefined) normalized.system = String(body.system).trim();

    if (body.questionType !== undefined) {
        const qt = normalizeQuestionType(body.questionType);
        // Preserve the raw (invalid) value so validateQuestionPayload can report it clearly.
        normalized.questionType = qt || String(body.questionType).trim();
    }

    if (body.difficulty !== undefined) {
        const diff = normalizeDifficulty(body.difficulty);
        normalized.difficulty = diff || String(body.difficulty).trim().toLowerCase();
    }

    if (body.tags !== undefined) normalized.tags = normalizeTags(body.tags);

    if (body.question !== undefined) normalized.question = String(body.question).trim();
    if (body.questionImage !== undefined) normalized.questionImage = body.questionImage;

    if (body.options !== undefined) {
        normalized.options = Array.isArray(body.options) ? body.options.map((o) => String(o ?? '')) : body.options;
    }
    if (body.optionImages !== undefined) {
        normalized.optionImages = Array.isArray(body.optionImages) ? body.optionImages : body.optionImages;
    }

    if (body.assertion !== undefined) normalized.assertion = String(body.assertion).trim();
    if (body.reason !== undefined) normalized.reason = String(body.reason).trim();

    if (body.columnA !== undefined) {
        normalized.columnA = Array.isArray(body.columnA) ? body.columnA.map((v) => String(v ?? '')) : body.columnA;
    }
    if (body.columnB !== undefined) {
        normalized.columnB = Array.isArray(body.columnB) ? body.columnB.map((v) => String(v ?? '')) : body.columnB;
    }

    if (body.correctAnswer !== undefined) normalized.correctAnswer = body.correctAnswer;

    if (body.explanation !== undefined) normalized.explanation = String(body.explanation ?? '').trim();
    if (body.explanationImage !== undefined) normalized.explanationImage = body.explanationImage;

    if (body.marrowCode !== undefined) normalized.marrowCode = body.marrowCode;
    if (body.source !== undefined) normalized.source = body.source;
    if (body.qid !== undefined) normalized.qid = body.qid;

    return normalized;
}

/**
 * Validate the seven-parameter metadata matrix, shared by create, update,
 * and import. Tags are intentionally never required here.
 */
function validateQuestionMetadata(data, { rowLabel } = {}) {
    const errors = [];
    const prefix = rowLabel ? `${rowLabel}: ` : '';

    if (!data.subject) errors.push(`${prefix}Subject is required.`);
    if (!isNonEmptyString(data.topicName)) errors.push(`${prefix}Topic is required.`);
    if (!isNonEmptyString(data.subtopicName)) errors.push(`${prefix}Subtopic is required.`);
    if (!isNonEmptyString(data.system)) errors.push(`${prefix}System is required.`);

    if (!data.questionType) {
        errors.push(`${prefix}Question Type is required.`);
    } else if (!Object.values(QUESTION_TYPES).includes(data.questionType)) {
        errors.push(`${prefix}Invalid Question Type "${data.questionType}".`);
    }

    if (!data.difficulty) {
        errors.push(`${prefix}Difficulty is required.`);
    } else if (!['easy', 'medium', 'hard'].includes(data.difficulty)) {
        errors.push(`${prefix}Difficulty must be one of easy, medium, hard.`);
    }

    if (!isNonEmptyString(data.question)) errors.push(`${prefix}Question text is required.`);

    return errors;
}

/**
 * Validate the type-specific structure (options/correctAnswer/etc.) for a
 * given canonical questionType. Assumes questionType itself is already valid.
 */
function validateQuestionStructure(data, { rowLabel } = {}) {
    const errors = [];
    const prefix = rowLabel ? `${rowLabel}: ` : '';
    const type = data.questionType;

    const requireOptions = (min = 2, max = 6) => {
        if (!Array.isArray(data.options) || data.options.filter((o) => isNonEmptyString(o)).length < min) {
            errors.push(`${prefix}At least ${min} options with text are required.`);
            return false;
        }
        if (data.options.length > max) {
            errors.push(`${prefix}A question may have at most ${max} options.`);
            return false;
        }
        return true;
    };

    const requireSingleIndexAnswer = () => {
        const idx = data.correctAnswer;
        if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= (data.options?.length || 0)) {
            errors.push(`${prefix}Correct answer must be a valid option index.`);
        }
    };

    switch (type) {
        case QUESTION_TYPES.MCQ_SINGLE: {
            if (requireOptions(2, 6)) requireSingleIndexAnswer();
            break;
        }

        case QUESTION_TYPES.IMAGE_BASED: {
            if (!isNonEmptyString(data.questionImage)) {
                errors.push(`${prefix}Image-Based questions require a question image.`);
            }
            if (requireOptions(2, 6)) requireSingleIndexAnswer();
            break;
        }

        case QUESTION_TYPES.ASSERTION_REASON: {
            if (!isNonEmptyString(data.assertion)) errors.push(`${prefix}Assertion text is required.`);
            if (!isNonEmptyString(data.reason)) errors.push(`${prefix}Reason text is required.`);
            // Default to the standard NEET-style relationship options if the
            // admin did not provide custom ones.
            if (!Array.isArray(data.options) || data.options.filter((o) => isNonEmptyString(o)).length < 2) {
                data.options = [...DEFAULT_ASSERTION_REASON_OPTIONS];
            }
            requireSingleIndexAnswer();
            break;
        }

        case QUESTION_TYPES.MULTIPLE_CORRECT: {
            if (requireOptions(2, 6)) {
                const arr = data.correctAnswer;
                if (!Array.isArray(arr) || arr.length === 0) {
                    errors.push(`${prefix}At least one correct option must be selected.`);
                } else {
                    const unique = new Set(arr);
                    const valid = arr.every((idx) => typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx < data.options.length);
                    if (!valid) {
                        errors.push(`${prefix}Correct answers must be valid option indices.`);
                    } else if (unique.size !== arr.length) {
                        errors.push(`${prefix}Correct answer indices must not repeat.`);
                    }
                }
            }
            break;
        }

        case QUESTION_TYPES.MATCH_THE_FOLLOWING: {
            const aLen = Array.isArray(data.columnA) ? data.columnA.filter(isNonEmptyString).length : 0;
            const bLen = Array.isArray(data.columnB) ? data.columnB.filter(isNonEmptyString).length : 0;
            if (aLen < 2) errors.push(`${prefix}Column A needs at least 2 entries.`);
            if (bLen < 2) errors.push(`${prefix}Column B needs at least 2 entries.`);
            if (aLen >= 2 && bLen >= 2) {
                const mapping = data.correctAnswer;
                if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
                    errors.push(`${prefix}A complete Column A to Column B mapping is required.`);
                } else {
                    const aKeys = Object.keys(mapping);
                    const expectedKeys = data.columnA.map((_, i) => String(i));
                    const allKeysPresent = expectedKeys.every((k) => aKeys.includes(k));
                    const allValuesValid = aKeys.every((k) => {
                        const v = mapping[k];
                        const n = Number(v);
                        return Number.isInteger(n) && n >= 0 && n < data.columnB.length;
                    });
                    if (!allKeysPresent || aKeys.length !== expectedKeys.length) {
                        errors.push(`${prefix}Mapping must include exactly one match for every Column A entry.`);
                    } else if (!allValuesValid) {
                        errors.push(`${prefix}Mapping values must be valid Column B indices.`);
                    }
                }
            }
            break;
        }

        case QUESTION_TYPES.NUMERICAL: {
            const val = data.correctAnswer;
            const num = typeof val === 'string' ? Number(val) : val;
            if (typeof num !== 'number' || Number.isNaN(num) || !Number.isFinite(num)) {
                errors.push(`${prefix}Correct answer must be a valid number.`);
            } else {
                data.correctAnswer = num;
            }
            break;
        }

        default:
            errors.push(`${prefix}Invalid Question Type "${type}".`);
    }

    return errors;
}

/**
 * Full validation pipeline used by create, update, and import. The caller is
 * responsible for passing the *final* resulting document shape (e.g. for
 * updates: existing document fields merged with the incoming changes) so
 * that update requests are held to exactly the same required-field rules as
 * creation, without forcing every PATCH to resend unrelated fields.
 *
 * Mutates `data` in-place only to fill in type-derived defaults (e.g.
 * default assertion/reason options, numeric coercion) — never to invent
 * required metadata.
 *
 * Throws QuestionValidationError on failure.
 */
function validateQuestionPayload(data, { rowLabel } = {}) {
    const errors = validateQuestionMetadata(data, { rowLabel });

    if (errors.length === 0 && data.questionType) {
        errors.push(...validateQuestionStructure(data, { rowLabel }));
    }

    if (errors.length > 0) {
        throw new QuestionValidationError(errors);
    }

    return data;
}

module.exports = {
    QuestionValidationError,
    normalizeQuestionInput,
    normalizeTags,
    validateQuestionMetadata,
    validateQuestionStructure,
    validateQuestionPayload,
};
