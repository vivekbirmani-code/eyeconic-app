jest.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: '17.0' },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { version: '1.0.1' },
  },
}));

jest.mock('axios', () => ({
  isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
}));

import { AxiosError } from 'axios';
import { normalizeApiError, isExpectedApiFailure } from '../errors';

const createAxiosError = (overrides: Partial<AxiosError> & { isAxiosError?: boolean } = {}) =>
  ({
    isAxiosError: true,
    message: 'Request failed with status code 503',
    name: 'AxiosError',
    ...overrides,
  }) as AxiosError;

describe('normalizeApiError', () => {
  it('classifies network failures without a response', () => {
    const error = createAxiosError({
      code: 'ERR_NETWORK',
      message: 'Network Error',
    });

    const normalized = normalizeApiError(error);
    expect(normalized.code).toBe('NETWORK_ERROR');
    expect(normalized.retryable).toBe(true);
  });

  it('maps backend DATABASE_UNAVAILABLE code', () => {
    const error = createAxiosError({
      response: {
        status: 503,
        statusText: 'Service Unavailable',
        headers: {},
        config: { headers: {} } as NonNullable<AxiosError['config']>,
        data: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Our servers are temporarily unavailable. Please try again in a few moments.',
        },
      },
    });

    const normalized = normalizeApiError(error);
    expect(normalized.code).toBe('DATABASE_UNAVAILABLE');
    expect(normalized.retryable).toBe(true);
  });

  it('maps authentication failures separately from server outages', () => {
    const error = createAxiosError({
      response: {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config: { headers: {} } as NonNullable<AxiosError['config']>,
        data: { message: 'Unauthorized' },
      },
    });

    const normalized = normalizeApiError(error);
    expect(normalized.code).toBe('UNAUTHORIZED');
    expect(normalized.retryable).toBe(false);
  });

  it('maps validation failures from 400 responses', () => {
    const error = createAxiosError({
      response: {
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: { headers: {} } as NonNullable<AxiosError['config']>,
        data: { message: 'Invalid credentials' },
      },
    });

    const normalized = normalizeApiError(error);
    expect(normalized.code).toBe('VALIDATION_ERROR');
    expect(normalized.userMessage).toBe('Invalid credentials');
  });

  it('maps the proctoring consent gate from the errorCode envelope field', () => {
    const error = createAxiosError({
      response: {
        status: 403,
        statusText: 'Forbidden',
        headers: {},
        config: { headers: {} } as NonNullable<AxiosError['config']>,
        data: {
          errorCode: 'PROCTORING_CONSENT_REQUIRED',
          message: 'This test uses camera-based monitoring. Please complete the readiness checks and accept the monitoring notice before starting.',
        },
      },
    });

    const normalized = normalizeApiError(error);
    // The specific gate code, NOT the generic 403→FORBIDDEN mapping.
    expect(normalized.code).toBe('PROCTORING_CONSENT_REQUIRED');
    expect(normalized.userMessage).toContain('monitoring');
    expect(normalized.retryable).toBe(false);
  });

  it('maps the precheck gate and token codes the same way', () => {
    for (const errorCode of ['PROCTORING_PRECHECK_REQUIRED', 'PRECHECK_TOKEN_INVALID'] as const) {
      const error = createAxiosError({
        response: {
          status: 403,
          statusText: 'Forbidden',
          headers: {},
          config: { headers: {} } as NonNullable<AxiosError['config']>,
          data: { errorCode, message: 'gate' },
        },
      });
      expect(normalizeApiError(error).code).toBe(errorCode);
    }
  });

  it('still maps other 403s to generic FORBIDDEN', () => {
    const error = createAxiosError({
      response: {
        status: 403,
        statusText: 'Forbidden',
        headers: {},
        config: { headers: {} } as NonNullable<AxiosError['config']>,
        data: { message: 'Not allowed' },
      },
    });

    expect(normalizeApiError(error).code).toBe('FORBIDDEN');
  });

  it('maps the post-close proctoring batch rejection (final teardown flush)', () => {
    const error = createAxiosError({
      response: {
        status: 409,
        statusText: 'Conflict',
        headers: {},
        config: { headers: {} } as NonNullable<AxiosError['config']>,
        data: {
          code: 'SESSION_NOT_ACTIVE',
          message: 'This test has ended; monitoring events are no longer accepted.',
          attemptFinalized: true,
        },
      },
    });

    const normalized = normalizeApiError(error);
    // The specific code, NOT the generic 409→CONFLICT mapping.
    expect(normalized.code).toBe('SESSION_NOT_ACTIVE');
    expect(normalized.retryable).toBe(false);
  });
});

describe('isExpectedApiFailure', () => {
  it('treats transient infra errors as expected', () => {
    expect(isExpectedApiFailure('DATABASE_UNAVAILABLE')).toBe(true);
    expect(isExpectedApiFailure('NETWORK_ERROR')).toBe(true);
  });

  it('does not treat unknown errors as expected', () => {
    expect(isExpectedApiFailure('UNKNOWN')).toBe(false);
  });

  it('treats the proctoring start gates as expected (steering, not failures)', () => {
    expect(isExpectedApiFailure('PROCTORING_CONSENT_REQUIRED')).toBe(true);
    expect(isExpectedApiFailure('PROCTORING_PRECHECK_REQUIRED')).toBe(true);
    expect(isExpectedApiFailure('PRECHECK_TOKEN_INVALID')).toBe(true);
  });

  it('treats the post-close batch rejection as expected (teardown flush after submit)', () => {
    expect(isExpectedApiFailure('SESSION_NOT_ACTIVE')).toBe(true);
    // Generic conflicts stay unexpected — they are genuine errors elsewhere.
    expect(isExpectedApiFailure('CONFLICT')).toBe(false);
  });
});
