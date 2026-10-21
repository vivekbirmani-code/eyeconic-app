// Unit tests for utils/proctoring/policySnapshot.js (plan §21, D15, D6, D8).

const {
  isQuizProctoringEnabled,
  resolveProctoringEligibility,
  buildEffectiveProctoringPolicy,
  freezeProctoringPolicySnapshot,
  parseProctoringConfig,
  hashPolicy,
  canonicalize,
} = require('../../../utils/proctoring/policySnapshot');
const {
  POLICY_SCHEMA_VERSION,
  DEFAULT_PROCTORING_CONFIG,
} = require('../../../utils/proctoring/defaults');

describe('proctoring policy snapshot — quiz-level enablement (D15)', () => {
  it('is OFF when the quiz has no proctoring config at all', () => {
    expect(isQuizProctoringEnabled({})).toBe(false);
    expect(isQuizProctoringEnabled({ proctoring: undefined })).toBe(false);
    expect(isQuizProctoringEnabled({ proctoring: null })).toBe(false);
  });

  it('is OFF when the subdoc exists but enabled is absent or false', () => {
    expect(isQuizProctoringEnabled({ proctoring: {} })).toBe(false);
    expect(isQuizProctoringEnabled({ proctoring: { camera: 'required' } })).toBe(false);
    expect(isQuizProctoringEnabled({ proctoring: { enabled: false } })).toBe(false);
  });

  it('is ON only for an explicit boolean true', () => {
    expect(isQuizProctoringEnabled({ proctoring: { enabled: true } })).toBe(true);
    // Strings are NOT accepted at this layer — parseProctoringConfig is the
    // only entry point that normalizes string forms, before anything is stored.
    expect(isQuizProctoringEnabled({ proctoring: { enabled: 'true' } })).toBe(false);
    expect(isQuizProctoringEnabled(null)).toBe(false);
  });

  it('never builds a policy for a non-opted-in quiz (absent config can never proctor)', () => {
    // The D15 acceptance test: every conceivable "not explicitly enabled"
    // quiz shape yields no policy and no snapshot.
    const notEnabledShapes = [
      {},
      { proctoring: undefined },
      { proctoring: {} },
      { proctoring: { enabled: false } },
      { proctoring: { enabled: false, focusEvents: { mode: 'warn-then-submit' } } },
    ];
    for (const quiz of notEnabledShapes) {
      expect(buildEffectiveProctoringPolicy(quiz)).toBeNull();
      expect(freezeProctoringPolicySnapshot(quiz)).toBeNull();
    }
  });
});

describe('proctoring rollout eligibility (kill switch > flag > quiz config)', () => {
  it('is enabled only when all three gates are on', () => {
    expect(resolveProctoringEligibility({
      quizConfigEnabled: true, globalEnabled: true, featureFlagEnabled: true,
    })).toEqual({ enabled: true, blockers: [] });
  });

  it.each([
    ['quiz config off', { quizConfigEnabled: false, globalEnabled: true, featureFlagEnabled: true }, 'quiz_config_disabled'],
    ['kill switch off', { quizConfigEnabled: true, globalEnabled: false, featureFlagEnabled: true }, 'global_kill_switch_off'],
    ['feature flag off', { quizConfigEnabled: true, globalEnabled: true, featureFlagEnabled: false }, 'feature_flag_off'],
    ['everything off', { quizConfigEnabled: false, globalEnabled: false, featureFlagEnabled: false }, null],
  ])('blocks when %s', (_name, input, expectedBlocker) => {
    const result = resolveProctoringEligibility(input);
    expect(result.enabled).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    if (expectedBlocker) expect(result.blockers).toContain(expectedBlocker);
  });

  it('defaults every gate to closed (fail-closed)', () => {
    expect(resolveProctoringEligibility()).toEqual({
      enabled: false,
      blockers: ['quiz_config_disabled', 'global_kill_switch_off', 'feature_flag_off'],
    });
  });
});

describe('effective policy resolution', () => {
  const proctoredQuiz = (overrides = {}) => ({
    proctoring: { enabled: true, ...overrides },
  });

  it('merges validated quiz overrides onto the platform defaults', () => {
    const effective = buildEffectiveProctoringPolicy(
      proctoredQuiz({ focusEvents: { toleratedViolations: 4 } })
    );
    expect(effective.policy.focusEvents.toleratedViolations).toBe(4);
    expect(effective.policy.focusEvents.mode).toBe(DEFAULT_PROCTORING_CONFIG.focusEvents.mode);
    expect(effective.policy.camera).toBe('required');
    expect(effective.policy.attention.mode).toBe('warn'); // v3 global warn rollout default
    expect(effective.version).toBe(POLICY_SCHEMA_VERSION);
  });

  it('ignores keys the schema does not know (a direct DB write cannot inject policy)', () => {
    const effective = buildEffectiveProctoringPolicy(
      proctoredQuiz({ sneakySubmit: true, focusEvents: { mode: 'warn-then-submit', evil: 1 } })
    );
    expect(effective.policy.sneakySubmit).toBeUndefined();
    expect(effective.policy.focusEvents.evil).toBeUndefined();
  });

  it('hashes deterministically regardless of key order', () => {
    const a = buildEffectiveProctoringPolicy(proctoredQuiz({ camera: 'optional' }));
    const b = buildEffectiveProctoringPolicy(
      proctoredQuiz({ camera: 'optional' })
    );
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the hash when the configuration changes (consent re-binding, §21.4)', () => {
    const before = buildEffectiveProctoringPolicy(proctoredQuiz());
    const after = buildEffectiveProctoringPolicy(
      proctoredQuiz({ focusEvents: { toleratedViolations: 4 } })
    );
    expect(before.hash).not.toBe(after.hash);
  });
});

describe('freezeProctoringPolicySnapshot', () => {
  it('captures version, hash, policy and a frozenAt copy of the given time', () => {
    const now = new Date('2026-09-15T10:00:00Z');
    const snapshot = freezeProctoringPolicySnapshot(
      { proctoring: { enabled: true } },
      now
    );
    expect(snapshot.version).toBe(POLICY_SCHEMA_VERSION);
    expect(snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.policy.enabled).toBe(true);
    expect(snapshot.frozenAt.getTime()).toBe(now.getTime());
    expect(snapshot.frozenAt).not.toBe(now); // a copy, not the caller's Date
  });
});

describe('parseProctoringConfig (quiz authoring validation)', () => {
  it('returns null value when nothing was submitted (unproctored by default)', () => {
    expect(parseProctoringConfig(undefined)).toEqual({ value: null });
    expect(parseProctoringConfig(null)).toEqual({ value: null });
  });

  it('normalizes a minimal opt-in payload to enabled:true with no other keys', () => {
    const result = parseProctoringConfig({ enabled: true });
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({ enabled: true });
  });

  it('accepts string booleans/JSON like the section-locking endpoints do', () => {
    expect(parseProctoringConfig({ enabled: 'true' }).value).toEqual({ enabled: true });
    expect(parseProctoringConfig({ enabled: 'TRUE' }).value).toEqual({ enabled: true });
    expect(parseProctoringConfig('{"enabled":true}').value).toEqual({ enabled: true });
  });

  it('rejects non-boolean enabled values LOUDLY (never silently unproctored)', () => {
    for (const bad of ['yes', '1', 1, null]) {
      const result = parseProctoringConfig({ enabled: bad });
      expect(result.error).toMatch(/proctoring\.enabled must be a boolean/);
    }
  });

  it('rejects non-object payloads', () => {
    expect(parseProctoringConfig(42).error).toBeDefined();
    expect(parseProctoringConfig('not-json').error).toBeDefined();
    expect(parseProctoringConfig([1, 2]).error).toBeDefined();
  });

  it('validates the camera enum', () => {
    expect(parseProctoringConfig({ enabled: true, camera: 'optional' }).value.camera).toBe('optional');
    expect(parseProctoringConfig({ enabled: true, camera: 'always' }).error).toBeDefined();
  });

  it('rejects riskWeights — platform-controlled, never per-quiz (§19/§21.2)', () => {
    const result = parseProctoringConfig({
      enabled: true,
      riskWeights: { multipleFaces: { points: 999 } },
    });
    expect(result.error).toMatch(/riskWeights/);
  });

  describe('attention modes (D6 + Phase 9.1 advisory warn opt-in)', () => {
    it('accepts mode "record"', () => {
      const result = parseProctoringConfig({ enabled: true, attention: { mode: 'record' } });
      expect(result.value.attention).toEqual({ mode: 'record' });
    });

    it('rejects every escalation attempt with a plain reason', () => {
      for (const mode of ['warn-only', 'submit', 'auto', 'record ']) {
        const result = parseProctoringConfig({ enabled: true, attention: { mode } });
        expect(result.error).toMatch(/must be "record" or "warn"/);
      }
    });
  });

  describe('attention shaping thresholds (Phase 5, §13.2 — shaping only, D6 untouched)', () => {
    it('accepts and echoes valid threshold groups', () => {
      const result = parseProctoringConfig({
        enabled: true,
        attention: {
          mode: 'record',
          thresholds: {
            turnedDeg: 30,
            extreme: { yawDeg: 55, pitchDeg: 45, sustainMs: 6000 },
            repeatedHeadPose: { minEpisodes: 4, minEpisodeMs: 2500, windowMs: 600000 },
            deviation: { deg: 40, sustainMs: 5000 },
            repeatedDeviation: { minEpisodes: 5, minEpisodeMs: 1200, windowMs: 600000 },
            fallbackPadDeg: 15,
          },
        },
      });
      expect(result.error).toBeUndefined();
      expect(result.value.attention.thresholds).toEqual({
        turnedDeg: 30,
        extreme: { yawDeg: 55, pitchDeg: 45, sustainMs: 6000 },
        repeatedHeadPose: { minEpisodes: 4, minEpisodeMs: 2500, windowMs: 600000 },
        deviation: { deg: 40, sustainMs: 5000 },
        repeatedDeviation: { minEpisodes: 5, minEpisodeMs: 1200, windowMs: 600000 },
        fallbackPadDeg: 15,
      });
    });

    it('accepts the advisory warn opt-in alongside valid thresholds (Phase 9.1)', () => {
      const result = parseProctoringConfig({
        enabled: true,
        attention: { mode: 'warn', thresholds: { turnedDeg: 30 } },
      });
      expect(result.error).toBeUndefined();
      expect(result.value.attention.mode).toBe('warn');
      expect(result.value.attention.thresholds).toEqual({ turnedDeg: 30 });
    });

    it('rejects every submit-flavored attention mode — no such mode exists (D6)', () => {
      expect(parseProctoringConfig({ enabled: true, attention: { mode: 'submit' } }).error)
        .toMatch(/must be "record" or "warn"/);
      expect(parseProctoringConfig({ enabled: true, attention: { mode: 'warn-then-submit' } }).error)
        .toMatch(/must be "record" or "warn"/);
    });

    it('bounds every numeric field (out-of-range rejected, never clamped silently)', () => {
      const cases = [
        [{ turnedDeg: 0 }, /turnedDeg/],
        [{ turnedDeg: 91 }, /turnedDeg/],
        [{ fallbackPadDeg: -5 }, /fallbackPadDeg/],
        [{ extreme: { yawDeg: 120 } }, /extreme\.yawDeg/],
        [{ extreme: { sustainMs: -1 } }, /extreme\.sustainMs/],
        [{ deviation: { deg: 'wide' } }, /deviation\.deg/],
        [{ repeatedHeadPose: { minEpisodes: 1 } }, /repeatedHeadPose\.minEpisodes/],
        [{ repeatedDeviation: { windowMs: 10 } }, /repeatedDeviation\.windowMs/],
      ];
      for (const [thresholds, pattern] of cases) {
        const result = parseProctoringConfig({ enabled: true, attention: { thresholds } });
        expect(result.error).toMatch(pattern);
      }
    });

    it('rejects non-object threshold groups', () => {
      expect(parseProctoringConfig({ enabled: true, attention: { thresholds: 35 } }).error)
        .toMatch(/attention\.thresholds must be an object/);
      expect(parseProctoringConfig({ enabled: true, attention: { thresholds: { extreme: 50 } } }).error)
        .toMatch(/extreme must be an object/);
      expect(parseProctoringConfig({ enabled: true, attention: { thresholds: { repeatedHeadPose: 3 } } }).error)
        .toMatch(/repeatedHeadPose must be an object/);
    });

    it('fills the documented defaults into the EFFECTIVE policy (older quizzes unchanged)', () => {
      const effective = buildEffectiveProctoringPolicy({
        proctoring: { enabled: true, attention: { mode: 'record' } },
      });
      expect(effective.policy.attention.thresholds).toEqual(
        DEFAULT_PROCTORING_CONFIG.attention.thresholds
      );
      // A quiz overriding one leaf keeps the rest of the defaults.
      const partial = buildEffectiveProctoringPolicy({
        proctoring: { enabled: true, attention: { thresholds: { deviation: { deg: 20 } } } },
      });
      expect(partial.policy.attention.thresholds.deviation).toEqual({ deg: 20, sustainMs: 4000 });
      expect(partial.policy.attention.thresholds.turnedDeg)
        .toBe(DEFAULT_PROCTORING_CONFIG.attention.thresholds.turnedDeg);
    });
  });

  describe('CV auto-submit is not a per-quiz setting (D8)', () => {
    it('rejects multipleFaces.mode "submit"', () => {
      const result = parseProctoringConfig({ enabled: true, multipleFaces: { mode: 'submit' } });
      expect(result.error).toBeDefined();
    });

    it('allows only record|warn for multipleFaces and facePresence', () => {
      expect(parseProctoringConfig({ enabled: true, multipleFaces: { mode: 'warn' } }).value.multipleFaces).toEqual({ mode: 'warn' });
      expect(parseProctoringConfig({ enabled: true, facePresence: { mode: 'record' } }).value.facePresence).toEqual({ mode: 'record' });
      expect(parseProctoringConfig({ enabled: true, facePresence: { mode: 'submit' } }).error).toBeDefined();
    });
  });

  describe('focus ladder validation (D3, §21.5)', () => {
    it('accepts warn-then-submit with a positive tolerance', () => {
      const result = parseProctoringConfig({
        enabled: true,
        focusEvents: { mode: 'warn-then-submit', toleratedViolations: 4 },
      });
      expect(result.value.focusEvents).toEqual({ mode: 'warn-then-submit', toleratedViolations: 4 });
    });

    it('rejects warn-then-submit with zero tolerated violations', () => {
      const result = parseProctoringConfig({
        enabled: true,
        focusEvents: { mode: 'warn-then-submit', toleratedViolations: 0 },
      });
      expect(result.error).toMatch(/toleratedViolations/);
    });

    it('bounds toleratedViolations to 1..10', () => {
      expect(parseProctoringConfig({ enabled: true, focusEvents: { toleratedViolations: 11 } }).error).toBeDefined();
      expect(parseProctoringConfig({ enabled: true, focusEvents: { toleratedViolations: -1 } }).error).toBeDefined();
      expect(parseProctoringConfig({ enabled: true, focusEvents: { toleratedViolations: 'three' } }).error).toBeDefined();
    });
  });
});

describe('canonicalize', () => {
  it('sorts object keys recursively so hashes are order-insensitive', () => {
    expect(JSON.stringify(canonicalize({ b: 1, a: { d: 2, c: 3 } })))
      .toBe(JSON.stringify({ a: { c: 3, d: 2 }, b: 1 }));
    expect(hashPolicy({ a: 1, b: 2 })).toBe(hashPolicy({ b: 2, a: 1 }));
  });
});
