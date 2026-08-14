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
});

describe('isExpectedApiFailure', () => {
  it('treats transient infra errors as expected', () => {
    expect(isExpectedApiFailure('DATABASE_UNAVAILABLE')).toBe(true);
    expect(isExpectedApiFailure('NETWORK_ERROR')).toBe(true);
  });

  it('does not treat unknown errors as expected', () => {
    expect(isExpectedApiFailure('UNKNOWN')).toBe(false);
  });
});
