import {
  branchSuggestions,
  errorField,
  errorRowIndices,
  predictorErrorMessage,
} from '../predictor';

// The endpoint wrappers pull in the axios instance → config → react-native
// chain; these tests only exercise the pure error-envelope helpers.
jest.mock('../predictorApi', () => ({
  __esModule: true,
  predictorApi: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

/**
 * The predictor API's error envelope is { msg, code, field? } — unlike the
 * app backend's { message, code }. These tests pin the helpers that read it.
 * (Constructed AxiosError-shaped objects: axios.isAxiosError only checks the
 * isAxiosError flag.)
 */

const axiosLikeError = (response?: { status: number; data: unknown }): unknown => ({
  isAxiosError: true,
  response,
});

describe('predictorErrorMessage', () => {
  it('prefers the server msg field, then message', () => {
    expect(
      predictorErrorMessage(axiosLikeError({ status: 400, data: { msg: 'GT 1: cannot exceed 180 questions' } }))
    ).toBe('GT 1: cannot exceed 180 questions');
    expect(
      predictorErrorMessage(axiosLikeError({ status: 400, data: { message: 'Fallback message key' } }))
    ).toBe('Fallback message key');
  });

  it('explains connectivity when there is no response at all', () => {
    expect(predictorErrorMessage(axiosLikeError())).toBe(
      'Cannot reach the predictor right now. Please check your connection and try again.'
    );
  });

  it('falls back to the provided default for anything else', () => {
    expect(predictorErrorMessage(new Error('boom'))).toBe(
      'Something went wrong. Please try again.'
    );
    expect(predictorErrorMessage(new Error('boom'), 'Custom fallback')).toBe('Custom fallback');
  });
});

describe('errorRowIndices', () => {
  it('maps a gts[N] field path to the row index for inline highlighting', () => {
    expect(
      errorRowIndices(
        axiosLikeError({ status: 400, data: { field: 'gts[2].attempts[0].corrects' } })
      )
    ).toEqual(new Set([2]));
  });

  it('returns an empty set when the error is not row-scoped', () => {
    expect(errorRowIndices(axiosLikeError({ status: 400, data: { field: 'category' } }))).toEqual(
      new Set()
    );
    expect(errorRowIndices(new Error('boom'))).toEqual(new Set());
  });
});

describe('errorField', () => {
  it('extracts the server field name when present', () => {
    expect(
      errorField(axiosLikeError({ status: 400, data: { field: 'counselling.status' } }))
    ).toBe('counselling.status');
  });

  it('returns null for non-field errors and non-axios errors', () => {
    expect(errorField(axiosLikeError({ status: 429, data: { msg: 'Too many' } }))).toBeNull();
    expect(errorField(new Error('boom'))).toBeNull();
  });
});

describe('branchSuggestions', () => {
  it('extracts near-miss suggestions only from UNKNOWN_BRANCH responses', () => {
    expect(
      branchSuggestions(
        axiosLikeError({
          status: 400,
          data: { code: 'UNKNOWN_BRANCH', suggestions: ['md-general-medicine', 'ms-general-surgery'] },
        })
      )
    ).toEqual(['md-general-medicine', 'ms-general-surgery']);
  });

  it('returns an empty array for every other shape', () => {
    expect(
      branchSuggestions(axiosLikeError({ status: 400, data: { code: 'INVALID_INPUT' } }))
    ).toEqual([]);
    expect(branchSuggestions(new Error('boom'))).toEqual([]);
  });
});

describe('predictorEndpoints paths', () => {
  // Pin the exact website contract paths — these must match the eyeconic-main
  // server's routes (and its predictorApi.test.js) byte for byte.
  const { predictorApi } = require('../predictorApi') as {
    predictorApi: {
      get: jest.Mock;
      post: jest.Mock;
      put: jest.Mock;
      delete: jest.Mock;
    };
  };
  const { predictorEndpoints } = require('../predictor');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls each endpoint at its contract path', async () => {
    predictorApi.get.mockResolvedValue({ data: { exams: [] } });
    await predictorEndpoints.exams();
    expect(predictorApi.get).toHaveBeenCalledWith('/exams');

    predictorApi.get.mockResolvedValue({ data: {} });
    await predictorEndpoints.gts();
    expect(predictorApi.get).toHaveBeenCalledWith('/gts');

    predictorApi.post.mockResolvedValue({ data: {} });
    await predictorEndpoints.predict({ exam: 'NEET_PG', gts: [] });
    expect(predictorApi.post).toHaveBeenCalledWith('/predict', { exam: 'NEET_PG', gts: [] });

    predictorApi.get.mockResolvedValue({ data: { rows: [] } });
    await predictorEndpoints.branches('abc', { band: 'COMFORTABLE', year: 2025, page: 1, limit: 25 });
    expect(predictorApi.get).toHaveBeenCalledWith('/predictions/abc/branches', {
      params: { band: 'COMFORTABLE', year: 2025, page: 1, limit: 25 },
    });

    predictorApi.get.mockResolvedValue({ data: { predictions: [] } });
    await predictorEndpoints.history(2, 5);
    expect(predictorApi.get).toHaveBeenCalledWith('/predictions', {
      params: { page: 2, limit: 5 },
    });

    predictorApi.get.mockResolvedValue({ data: {} });
    await predictorEndpoints.historyItem('abc');
    expect(predictorApi.get).toHaveBeenCalledWith('/predictions/abc');

    predictorApi.get.mockResolvedValue({ data: { recorded: false } });
    await predictorEndpoints.outcome('abc');
    expect(predictorApi.get).toHaveBeenCalledWith('/predictions/abc/outcome');

    predictorApi.put.mockResolvedValue({ data: {} });
    await predictorEndpoints.saveOutcome('abc', { consent: true });
    expect(predictorApi.put).toHaveBeenCalledWith('/predictions/abc/outcome', { consent: true });

    predictorApi.delete.mockResolvedValue({ data: {} });
    await predictorEndpoints.withdrawOutcome('abc');
    expect(predictorApi.delete).toHaveBeenCalledWith('/predictions/abc/outcome');

    predictorApi.get.mockResolvedValue({ data: { branches: [] } });
    await predictorEndpoints.branchCatalog('INI_CET');
    expect(predictorApi.get).toHaveBeenCalledWith('/branches', { params: { exam: 'INI_CET' } });

    predictorApi.post.mockResolvedValue({ data: {} });
    await predictorEndpoints.desiredBranch({ exam: 'NEET_PG', branchKey: 'x', category: 'UR' });
    expect(predictorApi.post).toHaveBeenCalledWith('/desired-branch', {
      exam: 'NEET_PG',
      branchKey: 'x',
      category: 'UR',
    });
  });
});
