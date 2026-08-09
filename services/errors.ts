import { AxiosError, isAxiosError } from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type ApiErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'SERVER_UNAVAILABLE'
  | 'SERVICE_MAINTENANCE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'RATE_LIMITED'
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
  SERVICE_MAINTENANCE:
    'We are performing maintenance. Please try again shortly.',
  UNAUTHORIZED: 'Your session has expired. Please sign in again.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  CONFLICT: 'This action conflicts with existing data. Please refresh and try again.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  INTERNAL_ERROR:
    "We're unable to process your request right now. Please try again shortly.",
  UNKNOWN: "Something went wrong. Please try again.",
};

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

const isNetworkFailure = (error: AxiosError): boolean => {
  return (
    !error.response &&
    (error.code === 'ERR_NETWORK' ||
      error.code === 'ECONNABORTED' ||
      error.message === 'Network Error')
  );
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

  const axiosError = error as AxiosError<{ message?: string; code?: string; requestId?: string }>;

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
  const requestId = axiosError.response?.data?.requestId;
  const code = status ? mapStatusToCode(status) : 'UNKNOWN';

  // Use server-provided safe message when available; never use axios error.message
  const userMessage =
    serverMessage && !serverMessage.toLowerCase().includes('axios')
      ? serverMessage
      : USER_MESSAGES[code];

  return {
    code,
    userMessage,
    status,
    retryable: status ? RETRYABLE_STATUS_CODES.has(status) : false,
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

export const getDeviceContext = () => ({
  platform: Platform.OS,
  appVersion: Constants.expoConfig?.version ?? 'unknown',
  osVersion: String(Platform.Version),
});
