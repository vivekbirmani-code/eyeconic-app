import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ImageOff, RotateCcw } from 'lucide-react-native';
import { resolveMediaUri } from '@/utils/media';

// Cached (or data:) images resolve in well under this, so the spinner never
// flashes for media the device already has — but a genuinely slow network
// load still shows it promptly.
const SPINNER_DELAY_MS = 150;

interface QuestionMediaImageProps {
  /** Raw stored path/URL — resolved internally (absolute URLs pass through). */
  source?: string | null;
  /**
   * Sizing for every state (loading/loaded/error). Must carry a height —
   * that is what reserves the layout and prevents shifts when media lands.
   */
  style?: any;
  accessibilityLabel: string;
  resizeMode?: 'contain' | 'cover' | 'stretch' | 'center';
}

/**
 * Quiz question media (question images, option images, explanation images;
 * GIFs included — they load as images on every platform) with proper
 * lifecycle states:
 *
 * - loading: reserved-space placeholder + centered spinner (delayed so cached
 *   media never flashes one); question text and options stay interactive.
 * - loaded: indicator disappears immediately, image becomes visible.
 * - error: quiet placeholder with a Retry action — never a permanent
 *   spinner, never a broken-image glyph.
 *
 * State is derived from WHICH uri loaded/failed (not booleans), so a source
 * change — e.g. navigating to the next question mid-load — resets cleanly
 * with no effect races, and several media elements on one question load
 * independently.
 */
export function QuestionMediaImage({
  source,
  style,
  accessibilityLabel,
  resizeMode = 'contain',
}: QuestionMediaImageProps) {
  const uri = resolveMediaUri(source);
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [showSpinner, setShowSpinner] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const status: 'none' | 'loading' | 'loaded' | 'error' =
    !uri ? 'none'
    : loadedUri === uri ? 'loaded'
    : failedUri === uri ? 'error'
    : 'loading';

  // One spinner-delay timer per loading episode (a new uri or a retry both
  // start a fresh episode); cancel early when the image lands.
  useEffect(() => {
    if (status !== 'loading') return;
    setShowSpinner(false);
    const timer = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status, uri, retryCount]);

  // Narrow for the JSX below (status 'none' ⇔ no uri).
  if (!uri) return null;

  const retry = () => {
    setFailedUri(null);
    setRetryCount(count => count + 1);
  };

  return (
    <View style={[styles.container, style]}>
      {status !== 'error' && (
        <Image
          // Remount per (uri, retry) so a retry genuinely re-requests the
          // media instead of reusing the failed render.
          key={`${uri}-${retryCount}`}
          source={{ uri }}
          style={[StyleSheet.absoluteFill, styles.image, status === 'loaded' ? styles.imageLoaded : null]}
          resizeMode={resizeMode}
          accessible
          accessibilityLabel={accessibilityLabel}
          onLoad={() => setLoadedUri(uri)}
          onError={() => setFailedUri(uri)}
        />
      )}

      {status === 'loading' && (
        <View style={styles.overlay} pointerEvents="none">
          {showSpinner && (
            <View style={styles.spinnerBox}>
              <ActivityIndicator size="small" color="#6B7280" />
              <Text style={styles.loadingText}>Loading image…</Text>
            </View>
          )}
        </View>
      )}

      {status === 'error' && (
        <View style={styles.overlay}>
          <ImageOff color="#9CA3AF" size={22} />
          <Text style={styles.errorText}>This image could not be loaded.</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={retry}
            accessibilityRole="button"
            accessibilityLabel={`Retry loading ${accessibilityLabel}`}
          >
            <RotateCcw color="#FFFFFF" size={13} />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
  },
  image: {
    opacity: 0,
  },
  imageLoaded: {
    opacity: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  spinnerBox: {
    alignItems: 'center',
    gap: 6,
  },
  loadingText: {
    fontSize: 12,
    color: '#6B7280',
  },
  errorText: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 6,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#6B7280',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 10,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default QuestionMediaImage;
