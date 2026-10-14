import { AxiosError, isAxiosError } from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type ApiErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'SERVER_UNAVAILABLE'
  | 'DATABASE_UNAVAILABLE'
  | 'SERVICE_MAINTENANCE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'IMPORT_VALIDATION_ERROR'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'CONFIGURATION_ERROR'
  | 'INTERNAL_ERROR'
  // Proctoring start gates (AI proctoring plan §7.1/§9.3): designed, handled
  // outcomes — the app routes the student through consent/readiness, they are
  // never surfaced as failures.
  | 'PROCTORING_CONSENT_REQUIRED'
  | 'PROCTORING_PRECHECK_REQUIRED'
  | 'PRECHECK_TOKEN_INVALID'
  // Proctoring post-close batch rejection (plan §7.5): the engine's final
  // teardown flush routinely lands after the server closed the session on
  // submit — the engine maps it to its session_closed outcome (drop the
  // buffer, stop) and the server only counts it as telemetry.
  | 'SESSION_NOT_ACTIVE'
  | 'UNKNOWN';

export interface NormalizedApiError {
  code: ApiErrorCode;
  userMessage: string;
  status?: number;
  retryable: boolean;
  requestId?: string;
  originalError?: unknown;
}

const USER_MESSAGES: Record<ApiErrorCode, string> = {
  NETWORK_ERROR:
    'Unable to connect. Please check your internet connection and try again.',
  TIMEOUT: 'The request timed out. Please try again.',
  SERVER_UNAVAILABLE:
    'Our servers are temporarily unavailable. Please try again in a few moments.',
  DATABASE_UNAVAILABLE:
    'Our servers are temporarily unavailable. Please try again in a few moments.',
  SERVICE_MAINTENANCE:
    'We are performing maintenance. Please try again shortly.',
  UNAUTHORIZED: 'Your session has expired. Please sign in again.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  IMPORT_VALIDATION_ERROR:
    'Some rows in the import file are invalid. Please review the errors and try again.',
  CONFLICT: 'This action conflicts with existing data. Please refresh and try again.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  CONFIGURATION_ERROR:
    'The app is not configured correctly. Please contact support if this continues.',
  INTERNAL_ERROR:
    "We're unable to process your request right now. Please try again shortly.",
  // Fallbacks only — the server always sends its own student-facing message
  // for these, which normalizeApiError prefers when present.
  PROCTORING_CONSENT_REQUIRED:
    'Please review the monitoring notice and accept it before starting this test.',
  PROCTORING_PRECHECK_REQUIRED:
    'Please complete the readiness checks before starting this test.',
  PRECHECK_TOKEN_INVALID:
    'Your readiness check needs to be run again.',
  SESSION_NOT_ACTIVE:
    'This test has ended; monitoring events are no longer accepted.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

const RETRYABLE_ERROR_CODES = new Set<ApiErrorCode>([
  'NETWORK_ERROR',
  'TIMEOUT',
  'SERVER_UNAVAILABLE',
  'DATABASE_UNAVAILABLE',
  'SERVICE_MAINTENANCE',
  'INTERNAL_ERROR',
  'RATE_LIMITED',
]);

const isNetworkFailure = (error: AxiosError): boolean => {
  return (
    !error.response &&
    (error.code === 'ERR_NETWORK' ||
      error.code === 'ECONNABORTED' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ENOTFOUND' ||
      error.message === 'Network Error')
  );
};

const mapServerCode = (serverCode?: string): ApiErrorCode | null => {
  if (!serverCode) return null;

  switch (serverCode) {
    case 'DATABASE_UNAVAILABLE':
      return 'DATABASE_UNAVAILABLE';
    case 'SERVICE_UNAVAILABLE':
      return 'SERVER_UNAVAILABLE';
    case 'EMAIL_DELIVERY_FAILED':
    case 'EMAIL_NOT_CONFIGURED':
      return 'SERVER_UNAVAILABLE';
    case 'VALIDATION_ERROR':
    case 'IMPORT_VALIDATION_ERROR':
      return 'VALIDATION_ERROR';
    case 'UNAUTHORIZED':
      return 'UNAUTHORIZED';
    case 'FORBIDDEN':
      return 'FORBIDDEN';
    case 'PROCTORING_CONSENT_REQUIRED':
    case 'PROCTORING_PRECHECK_REQUIRED':
    case 'PRECHECK_TOKEN_INVALID':
    case 'SESSION_NOT_ACTIVE':
      return serverCode as ApiErrorCode;
    default:
      return null;
  }
};

const mapStatusToCode = (status: number): ApiErrorCode => {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 408) return 'TIMEOUT';
  if (status === 409) return 'CONFLICT';
  if (status === 422 || status === 400) return 'VALIDATION_ERROR';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503 || status === 502) return 'SERVER_UNAVAILABLE';
  if (status === 504) return 'TIMEOUT';
  if (status >= 500) return 'INTERNAL_ERROR';
  return 'UNKNOWN';
};

/**
 * Converts any API failure into a safe, user-facing error object.
 * Never exposes raw Axios messages, HTTP status text, or stack traces.
 */
export const normalizeApiError = (error: unknown): NormalizedApiError => {
  if (!isAxiosError(error)) {
    return {
      code: 'UNKNOWN',
      userMessage: USER_MESSAGES.UNKNOWN,
      retryable: false,
      originalError: error,
    };
  }

  const axiosError = error as AxiosError<{
    message?: string;
    code?: string;
    errorCode?: string;
    requestId?: string;
  }>;

  if (isNetworkFailure(axiosError)) {
    const isTimeout = axiosError.code === 'ECONNABORTED';
    return {
      code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      userMessage: USER_MESSAGES[isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR'],
      retryable: true,
      originalError: error,
    };
  }

  const status = axiosError.response?.status;
  const serverMessage = axiosError.response?.data?.message;
  // The backend's error envelope carries `code` on most routes and the
  // proctoring start gates send `errorCode` — read both so gate refusals
  // normalize to their specific codes instead of a generic FORBIDDEN.
  const serverCode = axiosError.response?.data?.code ?? axiosError.response?.data?.errorCode;
  const requestId = axiosError.response?.data?.requestId;
  const codeFromServer = mapServerCode(serverCode);
  const code = codeFromServer ?? (status ? mapStatusToCode(status) : 'UNKNOWN');

  const userMessage =
    serverMessage && !serverMessage.toLowerCase().includes('axios')
      ? serverMessage
      : USER_MESSAGES[code];

  return {
    code,
    userMessage,
    status,
    retryable: RETRYABLE_ERROR_CODES.has(code) || (status ? RETRYABLE_STATUS_CODES.has(status) : false),
    requestId,
    originalError: error,
  };
};

export const getUserMessage = (error: unknown): string => {
  return normalizeApiError(error).userMessage;
};

export const isRetryableError = (error: unknown): boolean => {
  return normalizeApiError(error).retryable;
};

export const isExpectedApiFailure = (errorCode: ApiErrorCode): boolean => {
  return (
    RETRYABLE_ERROR_CODES.has(errorCode) ||
    errorCode === 'UNAUTHORIZED' ||
    errorCode === 'VALIDATION_ERROR' ||
    // The proctoring start gates steer the student through consent/readiness
    // (instructions probes /start, the precheck screen re-runs its checks) —
    // expected control flow, so the API logger records them as warnings,
    // never console errors.
    errorCode === 'PROCTORING_CONSENT_REQUIRED' ||
    errorCode === 'PROCTORING_PRECHECK_REQUIRED' ||
    errorCode === 'PRECHECK_TOKEN_INVALID' ||
    // The engine's final teardown flush routinely arrives after the server
    // closed the session on submit — mapped to session_closed and dropped.
    errorCode === 'SESSION_NOT_ACTIVE'
  );
};

export const getDeviceContext = () => ({
  platform: Platform.OS,
  appVersion: Constants.expoConfig?.version ?? 'unknown',
  osVersion: String(Platform.Version),
});
