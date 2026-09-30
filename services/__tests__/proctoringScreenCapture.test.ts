/**
 * Screen-capture deterrence resolver tests (Phase 4, plan §15.2, D13, §32
 * AC 4): the honest platform→deterrence mapping that the server stamps
 * set-once on the session for reviewer context.
 */

import { resolveScreenCaptureDeterrence } from '../proctoring/screenCapture';

describe('resolveScreenCaptureDeterrence (§15.2)', () => {
  it('Android + enabled → android-flagsecure (prevention genuinely applies)', () => {
    expect(resolveScreenCaptureDeterrence('android', true)).toBe('android-flagsecure');
  });

  it('policy disabled → disabled on every platform (opt-out respected)', () => {
    expect(resolveScreenCaptureDeterrence('android', false)).toBe('disabled');
    expect(resolveScreenCaptureDeterrence('ios', false)).toBe('disabled');
    expect(resolveScreenCaptureDeterrence('web', false)).toBe('disabled');
  });

  it('iOS → unsupported (no validated prevention, no detection wired — never overclaims)', () => {
    expect(resolveScreenCaptureDeterrence('ios', true)).toBe('unsupported');
  });

  it('web → unsupported (no equivalent exists)', () => {
    expect(resolveScreenCaptureDeterrence('web', true)).toBe('unsupported');
  });
});
