import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;

/**
 * Opens `url` outside the app (in-app browser on native, new tab on web).
 * Rejects relative/scheme-less URLs up front: those throw opaque errors in
 * the in-app browser on native and hit the bundler origin (404) on web.
 * Build API URLs with `getApiBaseURL()` (or `downloadApiReport`).
 */
export async function openExternalUrl(url: string) {
  if (typeof url !== 'string' || !ABSOLUTE_URL_PATTERN.test(url.trim())) {
    throw new Error(
      `openExternalUrl expects an absolute http(s) URL but received: ${JSON.stringify(url)}`
    );
  }

  if (Platform.OS === 'web') {
    return Linking.openURL(url);
  }

  try {
    return await WebBrowser.openBrowserAsync(url);
  } catch (error) {
    console.error('Failed to open URL in app browser:', error);
    return Linking.openURL(url);
  }
}
