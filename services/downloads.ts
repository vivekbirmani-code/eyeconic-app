import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBaseURL } from './config';
import { openExternalUrl } from '../utils/openExternalUrl';

const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;

export type ReportDownloadErrorCode =
  | 'MISSING_AUTH_TOKEN'
  | 'INVALID_DOWNLOAD_URL';

export class ReportDownloadError extends Error {
  readonly code: ReportDownloadErrorCode;

  constructor(code: ReportDownloadErrorCode, message: string) {
    super(message);
    this.name = 'ReportDownloadError';
    this.code = code;
  }
}

const DOWNLOAD_ERROR_MESSAGES: Record<ReportDownloadErrorCode, string> = {
  MISSING_AUTH_TOKEN: 'Your session has expired. Please log in again and try.',
  INVALID_DOWNLOAD_URL:
    'The report address could not be resolved. Please check your connection and try again.',
};

/** Maps any failure thrown by {@link downloadApiReport} to a user-facing message. */
export const getReportDownloadErrorMessage = (error: unknown): string => {
  if (error instanceof ReportDownloadError) {
    return DOWNLOAD_ERROR_MESSAGES[error.code];
  }
  return 'The report could not be downloaded. Please try again.';
};

// window.open can be blocked once the initiating user gesture has expired
// (the awaits below break activation on some browsers). A programmatic
// anchor click is never popup-blocked, and because the API answers with
// Content-Disposition: attachment the browser downloads without leaving
// the current page.
const openInCurrentTab = (url: string) => {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

/**
 * Downloads an authenticated report from the API (e.g. CSV exports) by
 * opening its endpoint URL. The URL is always built from `getApiBaseURL()`
 * — the same source of truth the axios instance uses — so it can never end
 * up relative (a scheme-less URL throws inside the in-app browser and shows
 * "Failed to download CSV").
 *
 * The token is passed as a query parameter because external browsers cannot
 * send an Authorization header; the backend auth middleware accepts both.
 *
 * @param path API path starting with "/" (e.g. `/quizzes/analytics/test-report/<id>/csv`)
 * @throws {ReportDownloadError} when the auth token is missing or the
 *         resolved URL is not absolute
 */
export async function downloadApiReport(path: string): Promise<void> {
  const token = await AsyncStorage.getItem('authToken');
  if (!token) {
    throw new ReportDownloadError(
      'MISSING_AUTH_TOKEN',
      'No auth token stored; the user must log in again before downloading.'
    );
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const querySeparator = normalizedPath.includes('?') ? '&' : '?';
  const url = `${getApiBaseURL()}${normalizedPath}${querySeparator}token=${encodeURIComponent(token)}`;

  if (!ABSOLUTE_URL_PATTERN.test(url)) {
    throw new ReportDownloadError(
      'INVALID_DOWNLOAD_URL',
      `Resolved download URL is not absolute: ${url}`
    );
  }

  if (Platform.OS === 'web') {
    openInCurrentTab(url);
    return;
  }

  await openExternalUrl(url);
}
