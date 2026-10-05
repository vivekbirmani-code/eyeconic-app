
import { Platform } from 'react-native';
import Constants from 'expo-constants';

export type AppEnvironment = 'development' | 'staging' | 'production';

const PRODUCTION_API_HOST = 'https://eyeconic-app-prod-1r8o.onrender.com';
const DEFAULT_DEV_PORT = 3000;

// The Rank & Branch Predictor lives on the Eyeconic website server
// (eyeconic-main repo), NOT on the app backend — see services/predictorApi.ts.
const PRODUCTION_PREDICTOR_API_HOST = 'https://eyeconic-server.vercel.app';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const normalizeApiBaseUrl = (host: string): string => {
  const trimmed = trimTrailingSlash(host.trim());
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
};

/**
 * Resolves the active application environment.
 * Production builds always use production; development can be overridden via EXPO_PUBLIC_APP_ENV.
 */
export const getAppEnvironment = (): AppEnvironment => {
  if (!__DEV__) {
    return 'production';
  }

  const configured = process.env.EXPO_PUBLIC_APP_ENV?.trim().toLowerCase();
  if (configured === 'staging') return 'staging';
  if (configured === 'production') return 'production';
  return 'development';
};

const getExpoDebuggerHost = (): string | null => {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    // Expo Go / older manifests
    (Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost ??
    (Constants as { manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } } }).manifest2
      ?.extra?.expoGo?.debuggerHost;

  if (!hostUri) {
    return null;
  }

  return hostUri.split(':')[0] || null;
};

/**
 * Resolves the dev app-backend host (without /api suffix).
 * Priority:
 * 1. Explicit override URL (EXPO_PUBLIC_API_URL)
 * 2. Platform defaults (web localhost, Android emulator 10.0.2.2)
 * 3. Expo Metro debugger host IP (physical device / LAN)
 * 4. iOS Simulator localhost fallback
 */
const resolveDevHost = (explicitUrl: string | undefined): string | null => {
  if (explicitUrl) {
    return normalizeApiBaseUrl(explicitUrl).replace(/\/api$/, '');
  }

  if (Platform.OS === 'web') {
    return `http://localhost:${DEFAULT_DEV_PORT}`;
  }

  const debuggerHost = getExpoDebuggerHost();
  if (debuggerHost) {
    if (debuggerHost === 'localhost' || debuggerHost === '127.0.0.1') {
      if (Platform.OS === 'android') {
        return `http://10.0.2.2:${DEFAULT_DEV_PORT}`;
      }
      return `http://localhost:${DEFAULT_DEV_PORT}`;
    }

    return `http://${debuggerHost}:${DEFAULT_DEV_PORT}`;
  }

  if (Platform.OS === 'android') {
    return `http://10.0.2.2:${DEFAULT_DEV_PORT}`;
  }

  if (Platform.OS === 'ios') {
    return `http://localhost:${DEFAULT_DEV_PORT}`;
  }

  return null;
};

/**
 * Resolves the dev API host (without /api suffix).
 * Priority:
 * 1. EXPO_PUBLIC_API_URL (explicit override)
 * 2. Platform defaults (web localhost, Android emulator 10.0.2.2)
 * 3. Expo Metro debugger host IP (physical device / LAN)
 * 4. iOS Simulator localhost fallback
 */
export const resolveDevApiHost = (): string | null =>
  resolveDevHost(process.env.EXPO_PUBLIC_API_URL?.trim());

export const getApiHost = (): string => {
  const environment = getAppEnvironment();

  if (environment === 'production' || environment === 'staging') {
    return PRODUCTION_API_HOST;
  }

  const devHost = resolveDevApiHost();
  if (!devHost) {
    if (__DEV__) {
      console.warn(
        '[api-config] Dev API host could not be resolved. Set EXPO_PUBLIC_API_URL in .env (see .env.example).'
      );
    }
    return PRODUCTION_API_HOST;
  }

  return devHost;
};

/** Returns the API base URL including the /api prefix. */
export const getApiBaseURL = (): string => normalizeApiBaseUrl(getApiHost());

/**
 * Host of the Rank & Branch Predictor API — the Eyeconic website server
 * (eyeconic-main), a separate deployment from the app backend. The predictor
 * axios instance (services/predictorApi.ts) authenticates with the SAME
 * student JWT the app backend issues (Bearer), verified by the website
 * server against this app backend's /auth/me.
 *
 * Unlike the app backend, development does NOT assume a locally-running
 * website server. The website server is a second stack (separate repo, own
 * database) that is usually NOT running during app work, and the Metro
 * debugger host says nothing about where it would run — deriving a :5000
 * address from it left the predictor dialing a dead port in every dev
 * session that hadn't booted eyeconic-main (fixed 2026-10-06). Dev shares
 * the production website server, which verifies the app JWT against the app
 * backend — the same database dev sessions live in. Local predictor work
 * opts in explicitly via EXPO_PUBLIC_PREDICTOR_API_URL (see .env.example).
 */
export const getPredictorApiHost = (): string => {
  const explicit = process.env.EXPO_PUBLIC_PREDICTOR_API_URL?.trim();
  if (explicit) {
    return normalizeApiBaseUrl(explicit).replace(/\/api$/, '');
  }
  return PRODUCTION_PREDICTOR_API_HOST;
};

/** Returns the predictor API base URL (website server) including the /api prefix. */
export const getPredictorApiBaseURL = (): string => normalizeApiBaseUrl(getPredictorApiHost());

/** Returns the socket server URL (no /api suffix). */
export const getSocketURL = (): string => getApiHost();

export const getApiConfigDiagnostics = () => ({
  environment: getAppEnvironment(),
  platform: Platform.OS,
  apiHost: getApiHost(),
  apiBaseUrl: getApiBaseURL(),
  predictorApiBaseUrl: getPredictorApiBaseURL(),
  socketUrl: getSocketURL(),
  expoDebuggerHost: getExpoDebuggerHost(),
  explicitApiUrl: process.env.EXPO_PUBLIC_API_URL ?? null,
  explicitPredictorApiUrl: process.env.EXPO_PUBLIC_PREDICTOR_API_URL ?? null,
  isDev: __DEV__,
});
