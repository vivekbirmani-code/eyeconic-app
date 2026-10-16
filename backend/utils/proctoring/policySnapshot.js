// Per-quiz proctoring configuration, effective-policy resolution and the
// frozen policy snapshot written onto an attempt at /start (plan §21).
//
// Mirrors the section-locking doctrine: editable config lives on the Quiz doc;
// the EFFECTIVE policy is frozen onto the QuizAttempt at /start and is
// immutable for that attempt's lifetime — later admin edits never move
// goalposts for in-flight attempts.
//
// Rollout precedence (plan §31): kill switch (AppSettings.proctoringEnabled)
//   > feature flag (config/featureAvailability.js aiProctoring)
//   > quiz config (Quiz.proctoring.enabled — opt-in, default false, D15).

const crypto = require('crypto');
const {
  POLICY_SCHEMA_VERSION,
  DEFAULT_PROCTORING_CONFIG,
  DEFAULT_RISK_WEIGHTS,
} = require('./defaults');

// ---------- quiz-level enablement (D15: absent config can NEVER enable) ----------

/**
 * True only when the quiz document explicitly opted into proctoring.
 * An absent `proctoring` subdoc, an absent `enabled` field, or enabled:false
 * all read as disabled — the missing-means-on trap is structurally impossible.
 */
const isQuizProctoringEnabled = (quiz) =>
  !!quiz && !!quiz.proctoring && quiz.proctoring.enabled === true;

// ---------- rollout eligibility (kill switch > flag > quiz config) ----------

/**
 * Pure rollout resolution. The route layer supplies the global kill switch
 * (utils/appSettings.isProctoringEnabled, fail-closed) and the feature flag
 * (config/featureAvailability.isFeatureEnabled('aiProctoring')).
 *
 * @returns {{enabled: boolean, blockers: string[]}} when enabled, blockers is
 *          empty; otherwise every failing gate is listed for observability.
 */
const resolveProctoringEligibility = ({
  quizConfigEnabled = false,
  globalEnabled = false,
  featureFlagEnabled = false,
} = {}) => {
  const blockers = [];
  if (quizConfigEnabled !== true) blockers.push('quiz_config_disabled');
  if (globalEnabled !== true) blockers.push('global_kill_switch_off');
  if (featureFlagEnabled !== true) blockers.push('feature_flag_off');
  return { enabled: blockers.length === 0, blockers };
};

// ---------- canonical form + hashing ----------

// Stable, key-sorted JSON so the same logical policy always hashes equally.
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
  }
  return value;
};

const hashPolicy = (policy) =>
  crypto.createHash('sha256').update(JSON.stringify(canonicalize(policy))).digest('hex');

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Deep merge that only ever copies RECOGNIZED keys from the quiz config onto
// the defaults — an unknown key written directly to the DB can never inject
// policy the schema does not know about.
const mergeSection = (defaults, override) => {
  if (!isPlainObject(defaults) || !isPlainObject(override)) return defaults;
  const merged = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (override[key] === undefined) continue;
    merged[key] = isPlainObject(defaults[key])
      ? mergeSection(defaults[key], override[key])
      : override[key];
  }
  return merged;
};

// ---------- effective policy + snapshot ----------

/**
 * Resolves the quiz's effective policy: defaults merged with the quiz's
 * validated overrides. Returns null when the quiz has not opted in — a
 * non-proctored quiz never produces a policy or a snapshot.
 *
 * @returns {{policy: object, version: number, hash: string}|null}
 */
const buildEffectiveProctoringPolicy = (quiz) => {
  if (!isQuizProctoringEnabled(quiz)) return null;

  const policy = mergeSection(
    { ...DEFAULT_PROCTORING_CONFIG, riskWeights: DEFAULT_RISK_WEIGHTS },
    quiz.proctoring
  );

  return {
    policy,
    version: POLICY_SCHEMA_VERSION,
    hash: hashPolicy(policy),
  };
};

/**
 * Freezes the effective policy snapshot stored on the attempt at /start
 * (plan §7.1 step 4). Write-once: callers must only store this when the
 * attempt has no snapshot yet; it is never recomputed for an existing
 * attempt.
 *
 * Phase 7 (§26.5): `overrides` (the student's ACTIVE accommodation rows,
 * loaded by the caller) are applied to the frozen copy ONLY — the quiz-level
 * effective policy and its consent-binding hash are untouched, and the
 * snapshot's hash is recomputed over the FINAL policy so the digest stays
 * truthful for this attempt.
 *
 * @returns {{version: number, hash: string, policy: object, frozenAt: Date}}
 */
const freezeProctoringPolicySnapshot = (quiz, now = new Date(), { overrides } = {}) => {
  const effective = buildEffectiveProctoringPolicy(quiz);
  if (!effective) return null;
  const policy = Array.isArray(overrides) && overrides.length > 0
    ? applyProctoringOverrides(effective.policy, overrides)
    : effective.policy;
  return {
    version: effective.version,
    hash: hashPolicy(policy),
    policy,
    frozenAt: new Date(now),
  };
};

/**
 * Phase 7 (§26.5) — applies accommodation overrides to a frozen policy copy
 * under a STRICT whitelist; anything unrecognized is skipped fail-closed:
 *
 *   attention_disabled  → attention.enabled = false (observations stop
 *                         entirely; mode stays locked to 'record', D6)
 *   relaxed_thresholds  → the override's `overrides.thresholds` object is
 *                         re-validated through parseProctoringConfig (same
 *                         clamps as authoring) and merged leaf-by-leaf
 *
 * Consequence-bearing sections (focusEvents, multipleFaces, cameraHealth…)
 * are deliberately NOT overridable here — accommodations relax observation,
 * they never weaken enforcement.
 */
const applyProctoringOverrides = (policy, overrides) => {
  const merged = JSON.parse(JSON.stringify(policy ?? {}));
  for (const override of overrides) {
    if (!override || typeof override !== 'object') continue;
    if (override.expiresAt && new Date(override.expiresAt).getTime() <= Date.now()) continue;
    if (override.reasonCode === 'attention_disabled') {
      merged.attention = { ...(merged.attention ?? {}), enabled: false };
      continue;
    }
    if (override.reasonCode === 'relaxed_thresholds' && override.overrides?.thresholds) {
      // Re-validate through the authoring parser — the same bounds, enums
      // and D6 lock apply; a malformed override payload is skipped, never
      // half-applied.
      const parsed = parseProctoringConfig({
        enabled: true,
        attention: { mode: 'record', thresholds: override.overrides.thresholds },
      });
      if (parsed.error || !parsed.value?.attention?.thresholds) continue;
      merged.attention = {
        ...(merged.attention ?? {}),
        thresholds: {
          ...(merged.attention?.thresholds ?? {}),
          ...parsed.value.attention.thresholds,
        },
      };
    }
    // Unlisted reasonCodes store but never apply (fail-closed).
  }
  return merged;
};

// ---------- authoring-side validation (quiz create/update payloads) ----------

const clampInt = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return { error: true, fallback };
  if (num < min || num > max) return { error: true, fallback };
  return { value: Math.round(num) };
};

const asBoolean = (value) => value === true || value === 'true';

const oneOf = (value, allowed) => allowed.includes(value);

// {minEpisodes, minEpisodeMs, windowMs} — the shared shape of the two
// repeated-pattern threshold groups (attention shaping only, plan §13.2).
const parseRepeatedGroup = (raw, label) => {
  if (!isPlainObject(raw)) return { error: `proctoring.attention.thresholds.${label} must be an object` };
  const parsed = {};
  if (raw.minEpisodes !== undefined) {
    const r = clampInt(raw.minEpisodes, 2, 50, null);
    if (r.error) return { error: `proctoring.attention.thresholds.${label}.minEpisodes must be an integer between 2 and 50` };
    parsed.minEpisodes = r.value;
  }
  if (raw.minEpisodeMs !== undefined) {
    const r = clampInt(raw.minEpisodeMs, 0, 60 * 60 * 1000, null);
    if (r.error) return { error: `proctoring.attention.thresholds.${label}.minEpisodeMs must be between 0 and 3600000` };
    parsed.minEpisodeMs = r.value;
  }
  if (raw.windowMs !== undefined) {
    const r = clampInt(raw.windowMs, 1000, 24 * 60 * 60 * 1000, null);
    if (r.error) return { error: `proctoring.attention.thresholds.${label}.windowMs must be between 1000 and 86400000` };
    parsed.windowMs = r.value;
  }
  return { value: Object.keys(parsed).length > 0 ? parsed : null };
};

/**
 * Validates + normalizes a `proctoring` payload submitted to quiz
 * create/update routes. Returns { value } with a fully-populated normalized
 * config, { value: null } when nothing was submitted, or { error } (400).
 *
 * Enforces the V1 invariants:
 *  - `enabled` is opt-in only (D15)
 *  - attention.mode may ONLY be 'record' (D6 — no V1-representable policy can
 *    escalate attention events)
 *  - focusEvents 'warn-then-submit' requires toleratedViolations >= 1 (§21.5)
 */
const parseProctoringConfig = (raw) => {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { error: 'proctoring must be an object' };
    }
  }
  if (!isPlainObject(raw)) return { error: 'proctoring must be an object' };

  const {
    enabled, camera, focusEvents, multipleFaces, facePresence, attention,
    cameraHealth, sessionHealth, screenCapturePrevention, maxViolations,
    violationAction, riskWeights,
  } = raw;

  const config = { enabled: false };
  if (enabled !== undefined) {
    // Booleans, and the exact strings 'true'/'false' (any case — the same
    // string-form leniency the section-locking endpoints apply). Anything
    // else fails LOUDLY: a value like 'yes' must never silently persist as
    // a disabled (or enabled) quiz.
    if (typeof enabled === 'boolean') {
      config.enabled = enabled;
    } else if (typeof enabled === 'string' && ['true', 'false'].includes(enabled.trim().toLowerCase())) {
      config.enabled = enabled.trim().toLowerCase() === 'true';
    } else {
      return { error: 'proctoring.enabled must be a boolean' };
    }
  }

  if (camera !== undefined && !oneOf(camera, ['required', 'optional'])) {
    return { error: 'proctoring.camera must be "required" or "optional"' };
  } else if (camera !== undefined) {
    config.camera = camera;
  }

  if (focusEvents !== undefined) {
    if (!isPlainObject(focusEvents)) return { error: 'proctoring.focusEvents must be an object' };
    const section = {};
    if (focusEvents.mode !== undefined) {
      if (!oneOf(focusEvents.mode, ['record', 'warn-only', 'warn-then-submit'])) {
        return { error: 'proctoring.focusEvents.mode must be "record", "warn-only" or "warn-then-submit"' };
      }
      section.mode = focusEvents.mode;
    }
    if (focusEvents.toleratedViolations !== undefined) {
      const parsed = clampInt(focusEvents.toleratedViolations, 1, 10, null);
      if (parsed.error) return { error: 'proctoring.focusEvents.toleratedViolations must be an integer between 1 and 10' };
      section.toleratedViolations = parsed.value;
    }
    if (focusEvents.minDurationMs !== undefined) {
      const parsed = clampInt(focusEvents.minDurationMs, 0, 60 * 60 * 1000, null);
      if (parsed.error) return { error: 'proctoring.focusEvents.minDurationMs must be between 0 and 3600000' };
      section.minDurationMs = parsed.value;
    }
    if (focusEvents.prolongedAbsenceMs !== undefined) {
      const parsed = clampInt(focusEvents.prolongedAbsenceMs, 0, 24 * 60 * 60 * 1000, null);
      if (parsed.error) return { error: 'proctoring.focusEvents.prolongedAbsenceMs must be a positive number of milliseconds' };
      section.prolongedAbsenceMs = parsed.value;
    }
    if (Object.keys(section).length > 0) config.focusEvents = section;
  }

  if (multipleFaces !== undefined) {
    if (!isPlainObject(multipleFaces)) return { error: 'proctoring.multipleFaces must be an object' };
    const section = {};
    if (multipleFaces.mode !== undefined) {
      if (!oneOf(multipleFaces.mode, ['record', 'warn'])) {
        return { error: 'proctoring.multipleFaces.mode must be "record" or "warn" (CV-driven auto-submit is not a per-quiz setting)' };
      }
      section.mode = multipleFaces.mode;
    }
    if (multipleFaces.minDurationMs !== undefined) {
      const parsed = clampInt(multipleFaces.minDurationMs, 0, 60 * 60 * 1000, null);
      if (parsed.error) return { error: 'proctoring.multipleFaces.minDurationMs must be between 0 and 3600000' };
      section.minDurationMs = parsed.value;
    }
    if (Object.keys(section).length > 0) config.multipleFaces = section;
  }

  if (facePresence !== undefined) {
    if (!isPlainObject(facePresence)) return { error: 'proctoring.facePresence must be an object' };
    const section = {};
    if (facePresence.mode !== undefined) {
      if (!oneOf(facePresence.mode, ['record', 'warn'])) {
        return { error: 'proctoring.facePresence.mode must be "record" or "warn"' };
      }
      section.mode = facePresence.mode;
    }
    if (facePresence.minAbsentMs !== undefined) {
      const parsed = clampInt(facePresence.minAbsentMs, 0, 24 * 60 * 60 * 1000, null);
      if (parsed.error) return { error: 'proctoring.facePresence.minAbsentMs must be a positive number of milliseconds' };
      section.minAbsentMs = parsed.value;
    }
    if (Object.keys(section).length > 0) config.facePresence = section;
  }

  // D6: attention is record-only in V1 — reject any attempt to configure it
  // otherwise at authoring time. (There is deliberately no "submit" option.)
  // Phase 5 adds SHAPING thresholds only (plan §13.2): they decide when a
  // record-only observation episode opens and can never attach a consequence.
  if (attention !== undefined) {
    if (!isPlainObject(attention)) return { error: 'proctoring.attention must be an object' };
    const section = {};
    if (attention.enabled !== undefined) {
      section.enabled = asBoolean(attention.enabled);
    }
    if (attention.mode !== undefined) {
      if (attention.mode !== 'record') {
        return { error: 'proctoring.attention.mode is locked to "record" in V1 (attention observations can never trigger actions)' };
      }
      section.mode = attention.mode;
    }
    if (attention.thresholds !== undefined) {
      if (!isPlainObject(attention.thresholds)) {
        return { error: 'proctoring.attention.thresholds must be an object' };
      }
      const t = attention.thresholds;
      const parsedThresholds = {};
      const angle = (value, label, max) => {
        const parsed = clampInt(value, 1, max, null);
        if (parsed.error) return { error: `proctoring.attention.thresholds.${label} must be an integer between 1 and ${max}` };
        return { value: parsed.value };
      };
      const ms = (value, label, max) => {
        const parsed = clampInt(value, 0, max, null);
        if (parsed.error) return { error: `proctoring.attention.thresholds.${label} must be between 0 and ${max}` };
        return { value: parsed.value };
      };
      if (t.turnedDeg !== undefined) {
        const parsed = angle(t.turnedDeg, 'turnedDeg', 90);
        if (parsed.error) return { error: parsed.error };
        parsedThresholds.turnedDeg = parsed.value;
      }
      if (t.extreme !== undefined) {
        if (!isPlainObject(t.extreme)) return { error: 'proctoring.attention.thresholds.extreme must be an object' };
        const parsed = {};
        if (t.extreme.yawDeg !== undefined) {
          const r = angle(t.extreme.yawDeg, 'extreme.yawDeg', 90);
          if (r.error) return { error: r.error };
          parsed.yawDeg = r.value;
        }
        if (t.extreme.pitchDeg !== undefined) {
          const r = angle(t.extreme.pitchDeg, 'extreme.pitchDeg', 90);
          if (r.error) return { error: r.error };
          parsed.pitchDeg = r.value;
        }
        if (t.extreme.sustainMs !== undefined) {
          const r = ms(t.extreme.sustainMs, 'extreme.sustainMs', 60 * 60 * 1000);
          if (r.error) return { error: r.error };
          parsed.sustainMs = r.value;
        }
        if (Object.keys(parsed).length > 0) parsedThresholds.extreme = parsed;
      }
      if (t.repeatedHeadPose !== undefined) {
        const parsed = parseRepeatedGroup(t.repeatedHeadPose, 'repeatedHeadPose');
        if (parsed.error) return { error: parsed.error };
        if (parsed.value) parsedThresholds.repeatedHeadPose = parsed.value;
      }
      if (t.deviation !== undefined) {
        if (!isPlainObject(t.deviation)) return { error: 'proctoring.attention.thresholds.deviation must be an object' };
        const parsed = {};
        if (t.deviation.deg !== undefined) {
          const r = angle(t.deviation.deg, 'deviation.deg', 90);
          if (r.error) return { error: r.error };
          parsed.deg = r.value;
        }
        if (t.deviation.sustainMs !== undefined) {
          const r = ms(t.deviation.sustainMs, 'deviation.sustainMs', 60 * 60 * 1000);
          if (r.error) return { error: r.error };
          parsed.sustainMs = r.value;
        }
        if (Object.keys(parsed).length > 0) parsedThresholds.deviation = parsed;
      }
      if (t.repeatedDeviation !== undefined) {
        const parsed = parseRepeatedGroup(t.repeatedDeviation, 'repeatedDeviation');
        if (parsed.error) return { error: parsed.error };
        if (parsed.value) parsedThresholds.repeatedDeviation = parsed.value;
      }
      if (t.fallbackPadDeg !== undefined) {
        const parsed = angle(t.fallbackPadDeg, 'fallbackPadDeg', 90);
        if (parsed.error) return { error: parsed.error };
        parsedThresholds.fallbackPadDeg = parsed.value;
      }
      if (Object.keys(parsedThresholds).length > 0) section.thresholds = parsedThresholds;
    }
    if (Object.keys(section).length > 0) config.attention = section;
  }

  if (cameraHealth !== undefined) {
    if (!isPlainObject(cameraHealth)) return { error: 'proctoring.cameraHealth must be an object' };
    const section = {};
    if (cameraHealth.lossWarnAfterMs !== undefined) {
      const parsed = clampInt(cameraHealth.lossWarnAfterMs, 0, 60 * 60 * 1000, null);
      if (parsed.error) return { error: 'proctoring.cameraHealth.lossWarnAfterMs must be between 0 and 3600000' };
      section.lossWarnAfterMs = parsed.value;
    }
    if (cameraHealth.lossSubmitAfterMs !== undefined) {
      const parsed = clampInt(cameraHealth.lossSubmitAfterMs, 0, 24 * 60 * 60 * 1000, null);
      if (parsed.error) return { error: 'proctoring.cameraHealth.lossSubmitAfterMs must be a positive number of milliseconds' };
      section.lossSubmitAfterMs = parsed.value;
    }
    if (cameraHealth.rejoinAttempts !== undefined) {
      const parsed = clampInt(cameraHealth.rejoinAttempts, 0, 10, null);
      if (parsed.error) return { error: 'proctoring.cameraHealth.rejoinAttempts must be an integer between 0 and 10' };
      section.rejoinAttempts = parsed.value;
    }
    if (Object.keys(section).length > 0) config.cameraHealth = section;
  }

  if (sessionHealth !== undefined) {
    if (!isPlainObject(sessionHealth)) return { error: 'proctoring.sessionHealth must be an object' };
    const section = {};
    if (sessionHealth.heartbeatIntervalMs !== undefined) {
      const parsed = clampInt(sessionHealth.heartbeatIntervalMs, 5000, 10 * 60 * 1000, null);
      if (parsed.error) return { error: 'proctoring.sessionHealth.heartbeatIntervalMs must be between 5000 and 600000' };
      section.heartbeatIntervalMs = parsed.value;
    }
    if (sessionHealth.timeoutMs !== undefined) {
      const parsed = clampInt(sessionHealth.timeoutMs, 10000, 60 * 60 * 1000, null);
      if (parsed.error) return { error: 'proctoring.sessionHealth.timeoutMs must be between 10000 and 3600000' };
      section.timeoutMs = parsed.value;
    }
    if (sessionHealth.onProlongedOutage !== undefined) {
      if (!oneOf(sessionHealth.onProlongedOutage, ['record', 'warn', 'submit'])) {
        return { error: 'proctoring.sessionHealth.onProlongedOutage must be "record", "warn" or "submit"' };
      }
      section.onProlongedOutage = sessionHealth.onProlongedOutage;
    }
    if (Object.keys(section).length > 0) config.sessionHealth = section;
  }

  if (screenCapturePrevention !== undefined) {
    if (!isPlainObject(screenCapturePrevention)) {
      return { error: 'proctoring.screenCapturePrevention must be an object' };
    }
    const section = {};
    if (screenCapturePrevention.enabled !== undefined) {
      section.enabled = asBoolean(screenCapturePrevention.enabled);
    }
    if (Object.keys(section).length > 0) config.screenCapturePrevention = section;
  }

  if (maxViolations !== undefined) {
    const parsed = clampInt(maxViolations, 1, 10, null);
    if (parsed.error) return { error: 'proctoring.maxViolations must be an integer between 1 and 10' };
    config.maxViolations = parsed.value;
  }

  if (violationAction !== undefined) {
    if (!oneOf(violationAction, ['warn', 'submit'])) {
      return { error: 'proctoring.violationAction must be "warn" or "submit"' };
    }
    config.violationAction = violationAction;
  }

  // riskWeights are platform-controlled provisional weights (§19); they are
  // snapshot from defaults, never author-configurable in V1.
  if (riskWeights !== undefined) {
    return { error: 'proctoring.riskWeights are platform-controlled and cannot be set per quiz' };
  }

  // §21.5: the warn-then-submit ladder needs at least one tolerated violation.
  const effectiveFocus = {
    ...DEFAULT_PROCTORING_CONFIG.focusEvents,
    ...(config.focusEvents || {}),
  };
  if (effectiveFocus.mode === 'warn-then-submit' && effectiveFocus.toleratedViolations < 1) {
    return { error: 'focusEvents.toleratedViolations must be at least 1 when mode is "warn-then-submit"' };
  }

  return { value: config };
};

module.exports = {
  isQuizProctoringEnabled,
  resolveProctoringEligibility,
  canonicalize,
  hashPolicy,
  buildEffectiveProctoringPolicy,
  freezeProctoringPolicySnapshot,
  applyProctoringOverrides,
  parseProctoringConfig,
};
