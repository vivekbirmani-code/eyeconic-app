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
  const serverCode = axiosError.response?.data?.code;
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
  return RETRYABLE_ERROR_CODES.has(errorCode) || errorCode === 'UNAUTHORIZED' || errorCode === 'VALIDATION_ERROR';
};

export const getDeviceContext = () => ({
  platform: Platform.OS,
  appVersion: Constants.expoConfig?.version ?? 'unknown',
  osVersion: String(Platform.Version),
});
