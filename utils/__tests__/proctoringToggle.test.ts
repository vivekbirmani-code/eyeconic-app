import {
  PROCTORING_DISABLED_PAYLOAD,
  PROCTORING_ON_PAYLOAD,
  proctoringBlockerCopy,
  proctoringUnavailableHint,
} from '../proctoringToggle';

/**
 * The admin toggle payload contract (Phase 9 §D): the Create/Edit screens
 * send these EXACT objects. The ON payload must stay complete — a bare
 * { enabled: true } would inherit the schema's focusEvents default
 * 'warn-then-submit' (a quiz that can warn and auto-submit).
 */
describe('proctoring toggle payloads', () => {
  it('ON payload enables with every policy in silent record mode and an optional camera', () => {
    expect(PROCTORING_ON_PAYLOAD).toEqual({
      enabled: true,
      camera: 'optional',
      focusEvents: { mode: 'record' },
      multipleFaces: { mode: 'record' },
      facePresence: { mode: 'record' },
    });
  });

  it('never carries warn or submit semantics in any policy', () => {
    const modes = JSON.stringify(PROCTORING_ON_PAYLOAD);
    expect(modes).not.toContain('warn');
    expect(modes).not.toContain('submit');
    expect(modes).not.toContain('required');
  });

  it('OFF payload is exactly { enabled: false }', () => {
    expect(PROCTORING_DISABLED_PAYLOAD).toEqual({ enabled: false });
  });

  it('renders the temporarily-unavailable hint from server blocker codes', () => {
    expect(
      proctoringUnavailableHint({ enabled: false, blockers: ['global_kill_switch_off', 'feature_flag_off'] })
    ).toContain('emergency switch is off');
    expect(
      proctoringUnavailableHint({ enabled: false, blockers: ['feature_flag_off'] })
    ).toContain('feature flag is off');
    // Unknown codes fall back to the raw code instead of vanishing.
    expect(proctoringUnavailableHint({ enabled: false, blockers: ['mystery'] })).toContain('mystery');
    expect(Object.keys(proctoringBlockerCopy)).toEqual(
      expect.arrayContaining(['global_kill_switch_off', 'feature_flag_off', 'quiz_config_disabled'])
    );
  });

  it('pre-save state (quiz_config_disabled) never claims kill-switch state', () => {
    // While the stored opt-in is off, the resolver cannot see the real kill
    // switch (deliberate short-circuit) — the hint must not mention it.
    const preSave = proctoringUnavailableHint({
      enabled: false,
      blockers: ['quiz_config_disabled', 'global_kill_switch_off'],
    });
    expect(preSave).toContain('when you save it');
    expect(preSave).not.toContain('emergency switch');

    // The feature-flag blocker IS real data even pre-save — mention it.
    const preSaveFlagOff = proctoringUnavailableHint({
      enabled: false,
      blockers: ['quiz_config_disabled', 'global_kill_switch_off', 'feature_flag_off'],
    });
    expect(preSaveFlagOff).toContain('when you save it');
    expect(preSaveFlagOff).toContain('feature flag is currently off');
  });
});
