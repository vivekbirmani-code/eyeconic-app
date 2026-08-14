const { buildImportValidationPayload, IMPORT_VALIDATION_ERROR } = require('../../utils/importErrors');

describe('importErrors', () => {
  it('builds a structured validation payload', () => {
    const payload = buildImportValidationPayload(['Row 4: Reason is required.'], { totalErrors: 1 });
    expect(payload).toEqual({
      success: false,
      code: IMPORT_VALIDATION_ERROR,
      message: 'Excel validation failed',
      errors: ['Row 4: Reason is required.'],
      totalErrors: 1,
    });
  });
});
