import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPredictorApiBaseURL } from './config';
import { normalizeApiError, isExpectedApiFailure } from './errors';
import { apiLogger } from './logger';

/**
 * Axios instance for the Rank & Branch Predictor API on the Eyeconic
 * WEBSITE server (eyeconic-main, eyeconic-server.vercel.app) — a second
 * origin next to the app backend, NOT a second auth system: requests carry
 * the SAME student JWT the app backend issues, as
 *   Authorization: Bearer <token>
 * which the website server verifies against this app backend's /auth/me
 * (Phase 1 of the predictor integration; see services/appBearerSession.js
 * in the eyeconic-main repo).
 *
 * Conventions mirror services/api.ts (per-request baseURL — never
 * axios.defaults — X-Request-Id, apiLogger, the same normalizeApiError/
 * isExpectedApiFailure taxonomy so connectivity failures log as warnings,
 * not console errors) with three deliberate differences:
 *  - timeout 60s: the predictor's /gts auto-fill call chains through the
 *    app backend on Render, whose free-tier cold start the website client
 *    already tolerates at this timeout;
 *  - NO automatic retries: POST /predict and /desired-branch persist
 *    server-side before responding (retrying could double-persist or burn
 *    the per-user rate budget), and a retried /gts would stack a second
 *    upstream chain. Screens offer explicit Retry buttons instead.
 *  - a predictor 401 does NOT clear the stored session: this server is not
 *    the token's issuer, so its 401 only PROVES its own view of the token
 *    (which can be a website-server integration gap — e.g. a deployment
 *    without Bearer support rejects tokens the app backend accepts). The
 *    app backend's own 401 handling in services/api.ts stays the single
 *    session authority; a genuinely expired JWT 401s there on the next
 *    call and ends the session through that path.
 */

const PREDICTOR_TIMEOUT_MS = 60000;

interface PredictorRequestConfig extends InternalAxiosRequestConfig {
  _requestId?: string;
  _startTime?: number;
}

const createRequestId = (): string =>
  `pred-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

export const predictorApi = axios.create({
  timeout: PREDICTOR_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor — resolve the website-server base URL per request
// (never on axios.defaults), attach the student JWT and request metadata.
predictorApi.interceptors.request.use(
  async (config) => {
    const requestConfig = config as PredictorRequestConfig;
    requestConfig.baseURL = `${getPredictorApiBaseURL()}/predictor`;
    requestConfig._requestId = requestConfig._requestId || createRequestId();
    requestConfig._startTime = Date.now();

    const token = await AsyncStorage.getItem('authToken');
    if (token) {
      requestConfig.headers.Authorization = `Bearer ${token}`;
    }

    requestConfig.headers['X-Request-Id'] = requestConfig._requestId;

    apiLogger.requestStart(
      requestConfig.url || 'unknown',
      (requestConfig.method || 'get').toUpperCase(),
      requestConfig._requestId
    );

    return requestConfig;
  },
  (error) => Promise.reject(error)
);

predictorApi.interceptors.response.use(
  (response) => {
    const config = response.config as PredictorRequestConfig;
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
    const config = error.config as PredictorRequestConfig | undefined;
    const durationMs = config?._startTime ? Date.now() - config?._startTime : 0;

    // Same taxonomy as services/api.ts: network/timeout/5xx/429 and the
    // expected 4xxs are environmental (warn — dev LogBox shows a dismissible
    // warning, not a full-screen console error); anything else stays
    // error-level. The screens already render retry UI for these.
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

    return Promise.reject(error);
  }
);
