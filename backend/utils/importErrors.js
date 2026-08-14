/**
 * Structured import validation responses shared by quiz and question-bank import routes.
 */
const IMPORT_VALIDATION_ERROR = 'IMPORT_VALIDATION_ERROR';

/**
 * @param {string[]} errors - Row-level validation messages (e.g. "Row 4: Reason is required.")
 * @param {object} [meta]
 * @param {number} [meta.totalErrors]
 */
function buildImportValidationPayload(errors, meta = {}) {
    const list = Array.isArray(errors) ? errors : [String(errors)];
    return {
        success: false,
        code: IMPORT_VALIDATION_ERROR,
        message: 'Excel validation failed',
        errors: list,
        ...meta,
    };
}

module.exports = {
    IMPORT_VALIDATION_ERROR,
    buildImportValidationPayload,
};
