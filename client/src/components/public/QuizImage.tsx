import { useState } from 'react';
import { ImageOff } from 'lucide-react';

/**
 * Quiz image with public-flow-safe rendering:
 *
 * - Renders nothing at all for absent/empty sources — a question without an
 *   image must not show an empty frame or a browser broken-image icon.
 * - Preserves the natural aspect ratio (object-contain, no fixed height)
 *   while capping width to the card and height to a screen fraction, so any
 *   image dimensions stay responsive on mobile and desktop without
 *   distorting or overflowing the question card.
 * - On load failure (dead/renamed URL, offline CDN) the broken <img> is
 *   replaced by a quiet placeholder note instead of the browser's broken
 *   image glyph. Mirrors the failedImages handling in the React Native
 *   quiz screens.
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
  // Track WHICH source failed rather than a boolean, so a src change (e.g.
  // moving to the next question) clears the failure without an effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = !!src && failedSrc === src;

  if (!src || failed) {
    if (!src) return null;
    return (
      <div
        className={`flex items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-xs text-gray-400 ${className}`}
        role="img"
        aria-label={`${alt} unavailable`}
      >
        <ImageOff className="w-4 h-4 shrink-0" />
        <span>This image could not be loaded.</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(src)}
      className={`mx-auto max-w-full max-h-[60vh] object-contain rounded-xl border border-gray-100 ${className}`}
    />
  );
}
