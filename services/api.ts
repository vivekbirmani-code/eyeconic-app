import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBaseURL } from './config';
import { isExpectedApiFailure, isRetryableError, normalizeApiError } from './errors';
import { apiLogger } from './logger';

const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

interface RetryableAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retryCount?: number;
  _requestId?: string;
  _startTime?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createRequestId = (): string =>
  `req-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

const getRetryDelay = (attempt: number): number => {
  const exponential = RETRY_BASE_DELAY_MS * 2 ** attempt;
  const jitter = Math.random() * 500;
  return exponential + jitter;
};

const shouldRetryRequest = (error: AxiosError, config?: RetryableAxiosRequestConfig): boolean => {
  if (!config) return false;

  const method = (config.method || 'get').toLowerCase();
  if (method !== 'get' && method !== 'head' && config.url !== '/auth/login') {
    // Only retry safe/idempotent requests and login (transient infra failures)
    if (config.url !== '/auth/login') return false;
  }

  const retryCount = config._retryCount ?? 0;
  if (retryCount >= MAX_RETRIES) return false;

  return isRetryableError(error);
};

export const api = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor — attach auth token and request metadata
api.interceptors.request.use(
  async (config) => {
    const retryConfig = config as RetryableAxiosRequestConfig;
    retryConfig.baseURL = getApiBaseURL();
    retryConfig._requestId = retryConfig._requestId || createRequestId();
    retryConfig._startTime = Date.now();

    const token = await AsyncStorage.getItem('authToken');
    if (token) {
      retryConfig.headers.Authorization = `Bearer ${token}`;
    }

    retryConfig.headers['X-Request-Id'] = retryConfig._requestId;

    apiLogger.requestStart(
      retryConfig.url || 'unknown',
      (retryConfig.method || 'get').toUpperCase(),
      retryConfig._requestId
    );

    return retryConfig;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — normalize errors, handle 401, retry transient failures
api.interceptors.response.use(
  (response) => {
    const config = response.config as RetryableAxiosRequestConfig;
    const durationMs = config._startTime ? Date.now() - config._startTime : 0;

    apiLogger.requestComplete(
      config.url || 'unknown',
      (config.method || 'get').toUpperCase(),
      config._requestId || 'unknown',
      response.status,
      durationMs
    );

    return response;
  },
  async (error: AxiosError) => {
    const config = error.config as RetryableAxiosRequestConfig | undefined;
    const durationMs = config?._startTime ? Date.now() - config._startTime : 0;
    const normalized = normalizeApiError(error);

    if (config) {
      apiLogger.requestFailed(
        config.url || 'unknown',
        (config.method || 'get').toUpperCase(),
        config._requestId || 'unknown',
        normalized.code,
        durationMs,
        isExpectedApiFailure(normalized.code)
      );
    }

    // Handle unauthorized — clear stored session
    if (error.response?.status === 401) {
      await AsyncStorage.removeItem('authToken');
      delete api.defaults.headers.Authorization;
    }

    // Retry transient failures with exponential backoff
    if (shouldRetryRequest(error, config)) {
      const retryConfig = config as RetryableAxiosRequestConfig;
      retryConfig._retryCount = (retryConfig._retryCount ?? 0) + 1;
      const delay = getRetryDelay(retryConfig._retryCount);

      apiLogger.warn('Retrying API request', {
        endpoint: retryConfig.url,
        attempt: retryConfig._retryCount,
        delayMs: Math.round(delay),
        requestId: retryConfig._requestId,
      });

      await sleep(delay);
      return api(retryConfig);
    }

    // Attach normalized error for consumers
    const enrichedError = error as AxiosError & { normalized?: ReturnType<typeof normalizeApiError> };
    enrichedError.normalized = normalized;

    return Promise.reject(enrichedError);
  }
);

export { normalizeApiError, getUserMessage } from './errors';
