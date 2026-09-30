import { api } from './api';
import { openExternalUrl } from '@/utils/openExternalUrl';

/**
 * App → Website session handoff.
 *
 * Asks the backend (POST /auth/web-handoff, authenticated with the user's
 * JWT) for a one-time, 2-minute code, then opens the returned URL
 * (https://<website>/app-link?code=…&dest=…) in the system browser. The
 * website's server exchanges the code for its own encrypted HttpOnly
 * session — the user's long-lived JWT never leaves the app, and the URL is
 * never a credential.
 */

export type WebDestination = '/dashboard' | '/tests' | `/tests/${string}`;

interface WebHandoffResponse {
  success: boolean;
  code: string;
  url: string;
  expiresAt: string;
}

const ABSOLUTE_HTTPS = /^https:\/\//i;

/** Mint a handoff code and return the full website URL to open. */
export async function createWebHandoffUrl(dest: WebDestination = '/dashboard'): Promise<string> {
  let response;
  try {
    response = await api.post<WebHandoffResponse>('/auth/web-handoff', { dest });
  } catch (error: any) {
    const message =
      error?.response?.data?.message ||
      'Could not open the website right now. Please try again.';
    throw new Error(message);
  }

  const url = response.data?.url;
  // Defense in depth: never open anything but the https website URL, even if
  // the backend response were tampered with.
  if (!response.data?.success || typeof url !== 'string' || !ABSOLUTE_HTTPS.test(url)) {
    throw new Error('The website link could not be created. Please try again.');
  }
  return url;
}

/** Open the Eyeconic website with the signed-in user's session. */
export async function openWebDashboard(dest: WebDestination = '/dashboard'): Promise<void> {
  const url = await createWebHandoffUrl(dest);
  await openExternalUrl(url);
}
