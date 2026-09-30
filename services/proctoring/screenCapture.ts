/**
 * Screen-capture deterrence resolution (plan §15.2, D13 — Phase 4).
 *
 * Pure platform→deterrence mapping for attempt-scoped screen-capture
 * prevention. This is DETERRENCE, never evidence: nothing is captured or
 * stored, and prevention is not a guarantee (rooted devices and second-device
 * recording remain accepted limitations — plan §14.4/§24.3).
 *
 * Honesty rules: Android flagSecure genuinely blocks screenshots and recents
 * previews → 'android-flagsecure'. iOS: the module documents best-effort
 * prevention on iOS 13+, but it is unvalidated in this project and the V1
 * surface is Android — no screenshot detection is wired, so the honest label
 * is 'unsupported' (revisit with device validation). Web has no equivalent.
 * Policy disabled → 'disabled'.
 */

/** Mirrors the ProctoringSession deterrence enum (backend model). */
export type ScreenCaptureDeterrence =
  | 'android-flagsecure'
  | 'ios-detect-only'
  | 'unsupported'
  | 'disabled';

export const resolveScreenCaptureDeterrence = (
  platform: string,
  preventionEnabled: boolean
): ScreenCaptureDeterrence => {
  if (!preventionEnabled) return 'disabled';
  if (platform === 'android') return 'android-flagsecure';
  return 'unsupported';
};
