import { useState } from 'react';
import { ImageOff, RotateCcw } from 'lucide-react';

/**
 * Quiz image with public-flow-safe rendering:
 *
 * - Renders nothing at all for absent/empty sources — a question without an
 *   image must not show an empty frame or a browser broken-image icon.
 * - Shows a quiet loading placeholder (reserved space + spinner + label)
 *   while the image downloads, so slow media never looks like a stuck or
 *   incomplete question; it disappears the moment the image is ready.
 * - Preserves the natural aspect ratio (object-contain, no fixed height)
 *   while capping width to the card and height to a screen fraction, so any
 *   image dimensions stay responsive on mobile and desktop without
 *   distorting or overflowing the question card.
 * - On load failure (dead/renamed URL, offline CDN) the broken <img> is
 *   replaced by a quiet placeholder note with a Retry action instead of the
 *   browser's broken image glyph. GIFs load as ordinary images here.
 */
export default function QuizImage({
  src,
  alt,
  className = '',
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  // Track WHICH source failed/loaded rather than booleans, so a src change
  // (e.g. moving to the next question) resets the state without an effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const failed = !!src && failedSrc === src;
  const loaded = !!src && loadedSrc === src;

  if (!src) return null;

  if (failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-xs text-gray-400 ${className}`}
        role="img"
        aria-label={`${alt} unavailable`}
      >
        <ImageOff className="w-4 h-4 shrink-0" />
        <span>This image could not be loaded.</span>
        <button
          type="button"
          onClick={() => {
            setFailedSrc(null);
            setRetryCount((count) => count + 1);
          }}
          className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-gray-400 px-3 py-1 text-white transition-colors hover:bg-gray-500"
          aria-label={`Retry loading ${alt}`}
        >
          <RotateCcw className="w-3 h-3" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <span className="relative block w-full min-h-24">
      <img
        // Remount per (src, retry) so Retry genuinely re-requests the image.
        key={`${src}-${retryCount}`}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoadedSrc(src)}
        onError={() => setFailedSrc(src)}
        className={`mx-auto max-w-full max-h-[60vh] object-contain rounded-xl border border-gray-100 transition-opacity duration-150 ${loaded ? 'opacity-100' : 'opacity-0'} ${className}`}
      />
      {!loaded && (
        <span
          className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-gray-50 text-xs text-gray-400"
          role="status"
          aria-label={`Loading ${alt}`}
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500" />
          Loading image…
        </span>
      )}
    </span>
  );
}
