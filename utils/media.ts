import { Image } from 'react-native';
import { getSocketURL } from '@/services/config';

const ABSOLUTE_URL = /^(https?:\/\/|file:\/\/|data:)/i;

/**
 * Resolve a question-media path to a loadable URI. Cloudinary/absolute URLs
 * pass through untouched; backend-relative paths get the API base prepended
 * (single resolver for the question image, option images and explanation
 * images — previously duplicated per screen).
 */
export const resolveMediaUri = (path?: string | null): string | undefined => {
  if (!path) return undefined;
  if (ABSOLUTE_URL.test(path)) return path;
  // getSocketURL returns the root URL e.g. http://192.168.x.x:3000
  const baseUrl = getSocketURL();
  // Avoid double slashes when the path already starts with /
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
};

// Every URL is prefetched at most once per app session — navigating back and
// forth between questions must not re-issue network requests for media the
// native/web image cache already holds.
const prefetchedUris = new Set<string>();

/**
 * Warm the image cache for media that is about to be shown (the next
 * question's images). Fire-and-forget: failures are harmless — the visible
 * <Image> performs its own request (and error handling) when the question
 * actually renders. Image.prefetch is supported on native and via
 * react-native-web on web.
 */
export const prefetchMedia = (paths: (string | null | undefined)[]) => {
  paths.forEach((path) => {
    const uri = resolveMediaUri(path);
    if (!uri || prefetchedUris.has(uri)) return;
    prefetchedUris.add(uri);
    try {
      Image.prefetch(uri)?.catch?.(() => {});
    } catch {
      // Prefetch is an optimization only — never let it throw.
    }
  });
};
