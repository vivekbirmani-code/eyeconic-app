import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2, AlertCircle } from 'lucide-react-native';
import { colors } from '@/utils/theme';

export type ToastType = 'success' | 'error';

interface ToastPayload {
  message: string;
  type: ToastType;
}

type Listener = (toast: ToastPayload) => void;
const listeners = new Set<Listener>();

/**
 * Lightweight module-level toast. Successes in the Groups module replace
 * blocking OK-popups with a self-dismissing toast (approved in the redesign
 * plan); errors still use Alert because they deserve full attention.
 *
 *   Toast.show('Group created');
 *   Toast.show('Failed to save', 'error');
 *
 * ToastHost (mounted once in the root layout) renders it.
 */
export const Toast = {
  show(message: string, type: ToastType = 'success') {
    listeners.forEach((l) => l({ message, type }));
  },
};

const AUTO_DISMISS_MS: Record<ToastType, number> = {
  success: 2200,
  error: 3200,
};

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const translateY = useRef(new Animated.Value(-24)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -24, duration: 180, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [opacity, translateY]);

  useEffect(() => {
    const listener: Listener = (payload) => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      setToast(payload);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    // New toast (or replacement): drop in from just above, then auto-dismiss.
    translateY.setValue(-24);
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        friction: 7,
        tension: 140,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
    dismissTimer.current = setTimeout(dismiss, AUTO_DISMISS_MS[toast.type]);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [toast, dismiss, opacity, translateY]);

  if (!toast) return null;

  const isError = toast.type === 'error';

  return (
    <View pointerEvents="none" style={[styles.overlay, { paddingTop: insets.top + 10 }]}>
      <Animated.View
        style={[
          styles.toast,
          {
            opacity,
            transform: [{ translateY }],
          },
        ]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={toast.message}
      >
        {isError ? (
          <AlertCircle color={colors.danger} size={18} />
        ) : (
          <CheckCircle2 color={colors.primary} size={18} />
        )}
        <Text style={styles.text} numberOfLines={2}>
          {toast.message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    // Above screens, below nothing critical — sits at the top of the window.
    zIndex: 9999,
    elevation: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    maxWidth: '86%',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
  },
  text: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    // Keep the pill's shape stable across platforms (web ignores some RN
    // text styles; this one matters for wrapping).
    ...Platform.select({ web: { whiteSpace: 'normal' } as any, default: {} as any }),
  },
});
