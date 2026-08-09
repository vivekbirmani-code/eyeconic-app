import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { isRetryableError, normalizeApiError } from './errors';
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
    return false;
  }

  const retryCount = config._retryCount ?? 0;
  if (retryCount >= MAX_RETRIES) return false;

  return isRetryableError(error);
};

const resolveBaseUrl = (): string => {
  const url = import.meta.env.VITE_API_URL;
  if (!url) {
    apiLogger.warn('VITE_API_URL is not configured — API calls may fail');
    return '/api';
  }
  return url;
};

export const api = axios.create({
  baseURL: resolveBaseUrl(),
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    const retryConfig = config as RetryableAxiosRequestConfig;
    retryConfig._requestId = retryConfig._requestId || createRequestId();
    retryConfig._startTime = Date.now();

    const token = localStorage.getItem('userToken');
    if (token) {
      retryConfig.headers.Authorization = `Bearer ${token}`;
    }

    retryConfig.headers['X-Request-Id'] = retryConfig._requestId;
    return retryConfig;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => {
    const config = response.config as RetryableAxiosRequestConfig;
    const durationMs = config._startTime ? Date.now() - config._startTime : 0;

    apiLogger.info('API request completed', {
      endpoint: config.url,
      method: config.method,
      requestId: config._requestId,
      statusCode: response.status,
      durationMs,
    });

    return response;
  },
  async (error: AxiosError) => {
    const config = error.config as RetryableAxiosRequestConfig | undefined;
    const normalized = normalizeApiError(error);

    apiLogger.error('API request failed', {
      endpoint: config?.url,
      method: config?.method,
      requestId: config?._requestId,
      errorCode: normalized.code,
      statusCode: normalized.status,
    });

    if (error.response?.status === 401) {
      localStorage.removeItem('userToken');
      delete api.defaults.headers.common['Authorization'];
      window.dispatchEvent(new Event('unauthorizedUser'));
    }

    if (shouldRetryRequest(error, config)) {
      const retryConfig = config as RetryableAxiosRequestConfig;
      retryConfig._retryCount = (retryConfig._retryCount ?? 0) + 1;
      const delay = getRetryDelay(retryConfig._retryCount);

      apiLogger.warn('Retrying API request', {
        endpoint: retryConfig.url,
        attempt: retryConfig._retryCount,
        delayMs: Math.round(delay),
      });

      await sleep(delay);
      return api(retryConfig);
    }

    const enrichedError = error as AxiosError & {
      normalized?: ReturnType<typeof normalizeApiError>;
    };
    enrichedError.normalized = normalized;

    return Promise.reject(enrichedError);
  }
);

export { normalizeApiError, getUserMessage } from './errors';
