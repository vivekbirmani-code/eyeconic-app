/**
 * useAttemptScreenCapturePrevention — attempt-scoped screen-capture
 * prevention (plan §15.2, D13 — Phase 4).
 *
 * Prevention is armed ONLY for active proctored attempts and released on
 * every exit path: unmount (mid-attempt navigation), finalize (the quiz
 * context clears the attempt → `active` flips false → the effect cleanup
 * releases), or a policy disable. The global prevention block commented out
 * in _layout.tsx is deliberately NOT revived — this one is scoped, keyed,
 * and always released; it never runs on non-proctored screens.
 *
 * Deterrence only, never evidence: nothing is captured or stored, and this
 * is not a guarantee (rooted devices and second-device recording are
 * accepted limitations — plan §14.4/§24.3). No screenshot listener is wired.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import {
  preventScreenCaptureAsync,
  allowScreenCaptureAsync,
} from 'expo-screen-capture';
import type { ProctoringPolicy } from '@/services/proctoring/types';

interface UseAttemptScreenCapturePreventionParams {
  /** True only while a proctored attempt session is armed. */
  active: boolean;
  /** The frozen policy snapshot (screenCapturePrevention.enabled, default true). */
  policy?: Record<string, unknown> | null;
  attemptId?: string;
}

export function useAttemptScreenCapturePrevention({
  active,
  policy,
  attemptId,
}: UseAttemptScreenCapturePreventionParams): void {
  const proctoringPolicy = policy as ProctoringPolicy | null | undefined;
  const enabled = active && proctoringPolicy?.screenCapturePrevention?.enabled !== false;
  // Keyed prevention (expo-screen-capture ~8.0.9): the key scopes this
  // prevention instance so it can be released exactly, without interfering
  // with any other use of the module.
  const key = attemptId ? `proctoring-attempt-${attemptId}` : 'proctoring-attempt';

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    // Best-effort by design (§15.2): a failed enable/release must never
    // disturb the quiz.
    preventScreenCaptureAsync(key).catch(() => {});
    return () => {
      allowScreenCaptureAsync(key).catch(() => {});
    };
  }, [enabled, key]);
}
