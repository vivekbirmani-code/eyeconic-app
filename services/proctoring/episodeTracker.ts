/**
 * Episode tracker — on-device signal processing (Phase 3, plan §10.3, §11,
 * §17.1). Pure: no expo/native imports, injectable clock, fully unit-tested.
 *
 * Anti-jitter contract (plan §10.3): every condition becomes AT MOST ONE
 * episode per sustained interval —
 *   debounce  (persist ≥ enterMs before the episode opens; clear ≥ exitMs
 *              before it closes — single-frame noise never opens anything)
 *   sustain   (enterMs comes from the FROZEN policy for policy-governed types)
 *   confidence (face-present episodes below the median quality floor are
 *              dropped as lighting/noise, never recorded as observations)
 *   cooldown  (re-entry within cooldownMs MERGES into the previous episode —
 *              no machine-gun duplicates; closed episodes are held until the
 *              cooldown elapses before they are emitted)
 *   precedence (§17.5: while a technical camera/session condition is open,
 *              face episodes are suppressed — a broken camera makes face
 *              observations meaningless)
 *
 * The tracker emits FINISHED episode records only ({openedAt, closedAt,
 * confidence, metadata}). Nothing per-frame ever leaves this module, and the
 * AI layer produces observations — never verdicts (§6.5.1).
 */

import type {
  ProctoringEpisodeEvent,
  ProctoringEventType,
  ProctoringPolicy,
  ProctoringFrameObservation,
} from './types';

// ===== Phase 5 — head pose + record-only attention (plan §13, D6/D11) =====
//
// Derives HEAD_POSE_* / ATTENTION_DEVIATION_* OBSERVATIONS from the
// per-frame head pose. RECORD-ONLY by construction: this module produces
// episode records for the timeline and nothing else — it has no warning,
// violation or submission path at all (the server's D6 structural lock
// independently refuses to act on these types).

/**
 * Client-side fallback attention thresholds — mirror
 * backend/utils/proctoring/defaults.js attention.thresholds EXACTLY. Used
 * only when the frozen policy snapshot predates Phase 5 (or a resync failed);
 * the policy snapshot is always the source of truth when present.
 * Illustrative §13.2 values, PROVISIONAL until the §19.5 calibration round.
 */
export const DEFAULT_ATTENTION_THRESHOLDS = {
  turnedDeg: 25,
  extreme: { yawDeg: 50, pitchDeg: 50, sustainMs: 5000 },
  repeatedHeadPose: { minEpisodes: 3, minEpisodeMs: 2000, windowMs: 300000 },
  deviation: { deg: 35, sustainMs: 4000 },
  repeatedDeviation: { minEpisodes: 4, minEpisodeMs: 1500, windowMs: 300000 },
  fallbackPadDeg: 10,
} as const;

/**
 * Structural clear-debounce for attention conditions (§10.3 anti-jitter —
 * the same class of constant as DEBOUNCE_FLOOR_MS, NOT a policy detection
 * threshold): a condition must stay false this long before an episode closes
 * or a pattern segment ends, so single-frame detector noise neither splits
 * nor creates observations.
 */
const ATTENTION_CLEAR_DEBOUNCE_MS = 1000;
/** A qualifying pattern segment must span ≥ 2 frames (§13.3: any single
 * frame, however extreme, produces nothing — also guards low-FPS spans). */
const ATTENTION_SEGMENT_MIN_FRAMES = 2;
/** Bound on retained pattern segments per family (long-episode memory). */
const MAX_PATTERN_SEGMENTS = 100;

/** Raw pose reference deviation is measured against (D11). */
export interface AttentionBaselineInput {
  yaw: number;
  pitch: number;
}

interface AttentionThresholds {
  turnedDeg: number;
  extremeYawDeg: number;
  extremePitchDeg: number;
  extremeSustainMs: number;
  headPoseMinEpisodes: number;
  headPoseMinEpisodeMs: number;
  headPoseWindowMs: number;
  deviationDeg: number;
  deviationSustainMs: number;
  deviationMinEpisodes: number;
  deviationMinEpisodeMs: number;
  deviationWindowMs: number;
  /** Deg threshold actually applied (includes the D11 fallback pad when no
   * baseline was captured — wider tolerance, sensitivity can only drop). */
  effectiveDeviationDeg: number;
  fallback: boolean;
}

interface PatternWindowSegment {
  start: number;
  end: number;
  quality: number;
}

/**
 * State for one attention family ("extreme/turned" vs "deviation"). Sustained
 * episodes use the same debounce/hysteresis/cooldown contract as face
 * episodes (§10.3); pattern segments additionally accumulate toward the
 * REPEATED window events.
 */
interface AttentionFamilyState {
  /** Condition continuously true since (candidate; null while false). */
  candidateSince: number | null;
  /** Sustained episode officially open at (null while not open). */
  openSince: number | null;
  /** Condition continuously false since (null while true). */
  clearedSince: number | null;
  /** Last timestamp the condition held. */
  lastActiveAt: number | null;
  /** Per-frame quality samples while the episode is open. */
  qualities: number[];
  /** Peak |angle| observed while open (deg; family-specific meaning). */
  anglePeak: number;
  /** Open episode suppressed by a technical overlap (§17.5) — drop at close. */
  suppressed: boolean;
  /** Closed episode held for the cooldown window (merge-or-emit). */
  held: {
    openedAt: number;
    closedAt: number;
    closedAtWall: number;
    qualities: number[];
    anglePeak: number;
    suppressed: boolean;
  } | null;
  /** In-flight pattern segment (null while the condition is false). */
  segment: { start: number; lastTs: number; frames: number; qualities: number[]; anglePeak: number } | null;
  /** Qualifying segments inside the sliding repetition window. */
  window: PatternWindowSegment[];
}

/** Signal-driven technical conditions the engine reports (plan §10.2). */
export type ProctoringSignalType =
  | 'CAMERA_UNAVAILABLE'
  | 'CAMERA_PERMISSION_REVOKED'
  | 'CAMERA_TRACK_ENDED'
  | 'CAMERA_FEED_DARK'
  | 'CAMERA_FEED_FROZEN'
  | 'MODEL_UNAVAILABLE';

interface EpisodeThresholds {
  /** Condition must persist this long before the episode opens. */
  enterMs: number;
  /** Condition must clear this long before the episode closes. */
  exitMs: number;
  /** Re-entry within this window merges into the previous episode. */
  cooldownMs: number;
}

// Provisional client-side defaults for types the frozen policy does not
// govern (plan §11.1 illustrative values — calibration data will replace
// them, plan §19.5; NOT production-approved numbers).
const DEFAULT_FACE_VISIBILITY_ENTER_MS = 10_000;
const DEBOUNCE_FLOOR_MS = 1_000;
const DEFAULT_COOLDOWN_MS = 10_000;
const DEFAULT_DARK_ENTER_MS = 5_000;
const DEFAULT_FROZEN_FRAMES = 8;

/** Median face-present quality below which an episode is dropped as noise. */
const CONFIDENCE_FLOOR = 0.25;
/** Sanitized-frame fraction above which a face-absence episode is unreliable. */
const MAX_SANITIZED_FRACTION = 0.5;

/** Cap on retained per-episode samples (bounded memory on long episodes). */
const MAX_SAMPLES = 2000;

const TECHNICAL_TYPES = new Set<string>([
  'CAMERA_UNAVAILABLE',
  'CAMERA_PERMISSION_REVOKED',
  'CAMERA_TRACK_ENDED',
  'CAMERA_FEED_DARK',
  'CAMERA_FEED_FROZEN',
  'MODEL_UNAVAILABLE',
]);

const detectorMeta = (detectorTier: string) => ({ detectorTier });

interface ConditionState {
  type: ProctoringEventType;
  thresholds: EpisodeThresholds;
  /** Condition currently true since (candidate; null while false). */
  candidateSince: number | null;
  /** Episode officially opened at (null while not open). */
  openSince: number | null;
  /** Last timestamp the condition held. */
  lastActiveAt: number | null;
  /** Condition currently false since (clear-debounce; null while true). */
  clearedSince: number | null;
  confidences: number[];
  frameCount: number;
  sanitizedCount: number;
  peak: Record<string, number> | null;
  /** Sticky: drop this episode at close (technical overlap / low confidence). */
  suppressed: boolean;
  suppressReason?: string;
  /** Closed episode held for the cooldown window (merge-or-emit). */
  held: {
    openedAt: number;
    closedAt: number;
    confidences: number[];
    frameCount: number;
    sanitizedCount: number;
    peak: Record<string, number> | null;
    suppressed: boolean;
    suppressReason?: string;
    closedAtWall: number;
  } | null;
}

export interface EpisodeTrackerOptions {
  policy?: ProctoringPolicy;
  detectorTier?: string;
  now?: () => number;
  /**
   * Per-type threshold overrides (debounce/cooldown tuning is policy-per-type
   * per §10.3). Keys are event types; values replace the computed thresholds.
   * Used by tests to run episode logic in milliseconds instead of seconds.
   */
  thresholdOverrides?: Record<string, Partial<EpisodeThresholds>>;
  /**
   * Phase 5 (D11): the precheck-captured seated baseline deviation is
   * measured against. Absent/null → conservative global bands (neutral pose
   * + fallbackPadDeg wider tolerance) with a calibration:'fallback' marker;
   * zero behavioral consequence either way (attention is record-only).
   */
  attentionBaseline?: AttentionBaselineInput | null;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The repeated-pattern event type paired with each sustained attention type. */
const repeatedTypeFor = (sustainedType: ProctoringEventType): ProctoringEventType =>
  sustainedType === 'HEAD_POSE_EXTREME' ? 'HEAD_POSE_REPEATED' : 'ATTENTION_DEVIATION_REPEATED';

const freshAttentionFamily = (): AttentionFamilyState => ({
  candidateSince: null,
  openSince: null,
  clearedSince: null,
  lastActiveAt: null,
  qualities: [],
  anglePeak: 0,
  suppressed: false,
  held: null,
  segment: null,
  window: [],
});

/**
 * Resolves the effective attention thresholds from the FROZEN policy
 * snapshot (never hardcoded angles — AC §Phase 5.3), falling back to the
 * documented client defaults only when the snapshot predates Phase 5.
 */
const resolveAttentionThresholds = (policy: ProctoringPolicy): AttentionThresholds => {
  const t = policy.attention?.thresholds ?? {};
  const d = DEFAULT_ATTENTION_THRESHOLDS;
  return {
    turnedDeg: t.turnedDeg ?? d.turnedDeg,
    extremeYawDeg: t.extreme?.yawDeg ?? d.extreme.yawDeg,
    extremePitchDeg: t.extreme?.pitchDeg ?? d.extreme.pitchDeg,
    extremeSustainMs: t.extreme?.sustainMs ?? d.extreme.sustainMs,
    headPoseMinEpisodes: t.repeatedHeadPose?.minEpisodes ?? d.repeatedHeadPose.minEpisodes,
    headPoseMinEpisodeMs: t.repeatedHeadPose?.minEpisodeMs ?? d.repeatedHeadPose.minEpisodeMs,
    headPoseWindowMs: t.repeatedHeadPose?.windowMs ?? d.repeatedHeadPose.windowMs,
    deviationDeg: t.deviation?.deg ?? d.deviation.deg,
    deviationSustainMs: t.deviation?.sustainMs ?? d.deviation.sustainMs,
    deviationMinEpisodes: t.repeatedDeviation?.minEpisodes ?? d.repeatedDeviation.minEpisodes,
    deviationMinEpisodeMs: t.repeatedDeviation?.minEpisodeMs ?? d.repeatedDeviation.minEpisodeMs,
    deviationWindowMs: t.repeatedDeviation?.windowMs ?? d.repeatedDeviation.windowMs,
    effectiveDeviationDeg: (t.deviation?.deg ?? d.deviation.deg) + (t.fallbackPadDeg ?? d.fallbackPadDeg),
    fallback: true, // corrected by the constructor once the baseline is known
  };
};

export class EpisodeTracker {
  private readonly policy: ProctoringPolicy;
  private readonly detectorTier: string;
  private readonly now: () => number;
  private readonly thresholdOverrides: Record<string, Partial<EpisodeThresholds>>;
  private readonly conditions = new Map<string, ConditionState>();
  /** Rolling stasis signature (frozen-feed detection). */
  private lastSignature: string | null = null;
  private identicalSignatureCount = 0;
  /** Dark-feed hysteresis state (enter <15, clear <25). */
  private darkActive = false;

  // ---- Phase 5: attention (record-only) state ----
  private readonly attentionEnabled: boolean;
  private readonly attentionThresholds: AttentionThresholds;
  private readonly attentionCalibration: 'captured' | 'fallback';
  private readonly attentionBaseline: AttentionBaselineInput;
  private readonly extremeFamily: AttentionFamilyState = freshAttentionFamily();
  private readonly deviationFamily: AttentionFamilyState = freshAttentionFamily();

  constructor(options: EpisodeTrackerOptions = {}) {
    this.policy = options.policy ?? {};
    this.detectorTier = options.detectorTier ?? 'headpose';
    this.now = options.now ?? (() => Date.now());
    this.thresholdOverrides = options.thresholdOverrides ?? {};

    const thresholds = resolveAttentionThresholds(this.policy);
    this.attentionEnabled = this.policy.attention?.enabled !== false;
    if (options.attentionBaseline
      && Number.isFinite(options.attentionBaseline.yaw)
      && Number.isFinite(options.attentionBaseline.pitch)) {
      this.attentionBaseline = options.attentionBaseline;
      this.attentionCalibration = 'captured';
      // Baseline in hand → the deviation threshold is the policy value as-is
      // (the pad exists ONLY to widen tolerance when the reference is missing).
      thresholds.effectiveDeviationDeg = thresholds.deviationDeg;
      thresholds.fallback = false;
    } else {
      // D11 fallback: neutral pose + the pad's wider tolerance. The pad only
      // ever RAISES the deviation threshold — fallback cannot increase
      // sensitivity, and attention carries no consequence regardless.
      this.attentionBaseline = { yaw: 0, pitch: 0 };
      this.attentionCalibration = 'fallback';
    }
    this.attentionThresholds = thresholds;
  }

  /** True while any technical camera/detector condition is open (§17.5). */
  get hasOpenTechnical(): boolean {
    for (const condition of this.conditions.values()) {
      if (TECHNICAL_TYPES.has(condition.type) && condition.openSince !== null) {
        return true;
      }
    }
    return false;
  }

  /** True while one specific condition's episode is open (UI status). */
  hasOpenOfType(type: string): boolean {
    const condition = this.conditions.get(type);
    return condition?.openSince !== null && condition?.openSince !== undefined;
  }

  /**
   * Feeds one analysis frame. Returns finished episodes that left the
   * cooldown window (possibly none — most frames produce nothing, by design).
   */
  observeFrame(obs: ProctoringFrameObservation): ProctoringEpisodeEvent[] {
    const ts = obs.tsMs;
    const technicalActive = this.hasOpenTechnical;
    const emitted: ProctoringEpisodeEvent[] = [];

    const faceConditions: [ProctoringEventType, boolean, Record<string, number> | null][] = [
      ['FACE_NOT_DETECTED', obs.faceCountClass === 'none', null],
      [
        'MULTIPLE_FACES_DETECTED',
        obs.faceCountClass === 'multiple',
        { faceCountPeak: Math.max(2, obs.faceCount) },
      ],
      [
        'FACE_PARTIALLY_VISIBLE',
        obs.faceCountClass === 'one' && obs.visibility === 'partial',
        null,
      ],
      [
        'FACE_OUT_OF_FRAME',
        obs.faceCountClass === 'one' && obs.visibility === 'small',
        obs.largestFaceRatio !== null ? { largestFaceRatioMin: obs.largestFaceRatio } : null,
      ],
    ];

    for (const [type, active, peak] of faceConditions) {
      emitted.push(
        ...this.update(type, active, ts, {
          // Absence episodes carry channel-health confidence internally, not
          // face quality (there is no face to score).
          ...(type === 'FACE_NOT_DETECTED' ? {} : { confidence: obs.qualityProxy }),
          sanitized: obs.sanitized,
          peak,
          technicalActive,
        })
      );
    }

    // Camera-health darkness (§10.2): hysteresis on the sanitized mean luma.
    // Unavailable luma reports neither dark nor clear (ambiguous, no signal).
    if (obs.meanLuma !== null) {
      const darkNow = this.darkActive
        ? obs.meanLuma < DARK_LUMA_CLEAR
        : obs.meanLuma < DARK_LUMA_FLOOR;
      this.darkActive = darkNow;
      emitted.push(
        ...this.update('CAMERA_FEED_DARK', darkNow, ts, {
          peak: { meanLumaMin: obs.meanLuma },
          technicalActive,
        })
      );
    }

    // Frozen-feed detection (§10.2): N consecutive identical frame signatures.
    // The engine supplies the signature; here we only count stasis.
    emitted.push(...this.updateStasis(ts));

    // Phase 5 — head-pose/attention observations (record-only, §13/D6/D11).
    emitted.push(...this.observeAttention(obs, technicalActive));
    this.releaseExpiredAttentionHeld(ts, emitted);

    this.releaseExpiredHeld(ts, emitted);
    return emitted;
  }

  /**
   * Engine-reported technical condition transitions (camera errors,
   * permission loss, detector failure, recovery). Engine-side failure
   * counting is the debounce — signals open/close immediately here.
   */
  signal(type: ProctoringSignalType, active: boolean, meta?: Record<string, unknown>): ProctoringEpisodeEvent[] {
    const emitted: ProctoringEpisodeEvent[] = [];
    const ts = this.now();
    emitted.push(...this.update(type, active, ts, { signalMeta: meta, technicalActive: this.hasOpenTechnical }));
    this.releaseExpiredHeld(ts, emitted);
    return emitted;
  }

  /** Sets the raw frame signature used for frozen-feed stasis detection. */
  setFrameSignature(signature: string | null): void {
    if (signature === null) {
      this.lastSignature = null;
      this.identicalSignatureCount = 0;
      return;
    }
    if (signature === this.lastSignature) {
      this.identicalSignatureCount += 1;
    } else {
      this.lastSignature = signature;
      this.identicalSignatureCount = 1;
    }
  }

  /**
   * Closes every open episode (session end / engine stop). Bypasses the
   * cooldown window; suppressed episodes are dropped.
   */
  closeAll(): ProctoringEpisodeEvent[] {
    const ts = this.now();
    const emitted: ProctoringEpisodeEvent[] = [];
    for (const condition of this.conditions.values()) {
      if (condition.held) {
        const event = this.buildEpisode(condition.held, condition.type);
        if (event) emitted.push(event);
        condition.held = null;
      }
      if (condition.openSince !== null || condition.candidateSince !== null) {
        this.closeCondition(condition, ts, emitted, { bypassCooldown: true });
      }
    }
    if (this.attentionEnabled) {
      this.closeAttentionFamily(this.extremeFamily, 'HEAD_POSE_EXTREME', ts, emitted);
      this.closeAttentionFamily(this.deviationFamily, 'ATTENTION_DEVIATION_SUSTAINED', ts, emitted);
    }
    return emitted;
  }

  // ---- internals ----------------------------------------------------------

  // ===== Phase 5 — attention observation derivation (plan §13, record-only) =====

  /**
   * Per-frame attention processing. Everything is derived from the frame's
   * head pose against the FROZEN policy thresholds — never hardcoded angles.
   *
   * §17.5 precedence, structurally: pose is only meaningful for exactly one
   * reasonably-visible face ('ok'/'partial'; 'small' is FACE_OUT_OF_FRAME's
   * territory and none/multiple carry no usable pose), is discarded while
   * any technical camera condition is open, and deviation defers to an open
   * extreme orientation (the absolute signal wins; no double counting).
   */
  private observeAttention(
    obs: ProctoringFrameObservation,
    technicalActive: boolean
  ): ProctoringEpisodeEvent[] {
    if (!this.attentionEnabled) return [];
    const emitted: ProctoringEpisodeEvent[] = [];
    const t = this.attentionThresholds;
    const pose = obs.headPose;

    const usable = !technicalActive
      && obs.faceCountClass === 'one'
      && (obs.visibility === 'ok' || obs.visibility === 'partial')
      && pose !== null
      && (pose.yaw !== null || pose.pitch !== null);
    const yaw = usable ? Math.abs(pose?.yaw ?? 0) : 0;
    const pitch = usable ? Math.abs(pose?.pitch ?? 0) : 0;

    const extremeActive = usable
      && (yaw >= t.extremeYawDeg || pitch >= t.extremePitchDeg);
    const turnedActive = usable
      && (yaw >= t.turnedDeg || pitch >= t.turnedDeg);
    const deviation = usable
      ? Math.max(
        Math.abs((pose?.yaw ?? 0) - this.attentionBaseline.yaw),
        Math.abs((pose?.pitch ?? 0) - this.attentionBaseline.pitch)
      )
      : 0;
    // Deviation only counts OUTSIDE the extreme band (precedence within the
    // attention family: the stronger absolute observation owns those frames).
    const deviationActive = usable && !extremeActive && deviation >= t.effectiveDeviationDeg;

    this.updateAttentionFamily(
      this.extremeFamily,
      {
        episodeActive: extremeActive,
        segmentActive: turnedActive,
        angle: Math.max(yaw, pitch),
        quality: obs.qualityProxy,
        ts: obs.tsMs,
        technicalActive,
        sustainedType: 'HEAD_POSE_EXTREME',
        sustainedEnterMs: t.extremeSustainMs,
        minEpisodeMs: t.headPoseMinEpisodeMs,
        minEpisodes: t.headPoseMinEpisodes,
        windowMs: t.headPoseWindowMs,
        peakKey: 'peakAngleDeg',
      },
      emitted
    );
    this.updateAttentionFamily(
      this.deviationFamily,
      {
        episodeActive: deviationActive,
        segmentActive: deviationActive,
        angle: deviation,
        quality: obs.qualityProxy,
        ts: obs.tsMs,
        technicalActive,
        sustainedType: 'ATTENTION_DEVIATION_SUSTAINED',
        sustainedEnterMs: t.deviationSustainMs,
        minEpisodeMs: t.deviationMinEpisodeMs,
        minEpisodes: t.deviationMinEpisodes,
        windowMs: t.deviationWindowMs,
        peakKey: 'deviationPeakDeg',
      },
      emitted
    );
    return emitted;
  }

  /**
   * One attention family's deterministic lifecycle (clarification contract):
   *
   * Sustained episode — debounce (persist ≥ sustainedEnterMs before open),
   * hysteresis (clear ≥ ATTENTION_CLEAR_DEBOUNCE_MS before close), cooldown
   * (re-entry within DEFAULT_COOLDOWN_MS reopens the held episode — no
   * machine-gun duplicates), §17.5 suppression while a technical condition
   * overlaps. Exactly one event per sustained interval.
   *
   * Pattern segments — a segment spans consecutive active frames (gaps under
   * the clear-debounce do not split it); it QUALIFIES only when it spans
   * ≥ ATTENTION_SEGMENT_MIN_FRAMES and ≥ minEpisodeMs. Qualifying segments
   * accumulate in a sliding window (a segment counts while its end is within
   * windowMs of the newest segment's end); the moment the window holds
   * ≥ minEpisodes, exactly ONE repeated-pattern event is emitted
   * (openedAt = first segment's start, closedAt = newest segment's end) and
   * the window is CONSUMED — the next pattern event needs a fresh window.
   * Sustained intervals are ordinary qualifying segments and count toward
   * the pattern like any other.
   */
  private updateAttentionFamily(
    state: AttentionFamilyState,
    config: {
      episodeActive: boolean;
      segmentActive: boolean;
      angle: number;
      quality: number;
      ts: number;
      technicalActive: boolean;
      sustainedType: ProctoringEventType;
      sustainedEnterMs: number;
      minEpisodeMs: number;
      minEpisodes: number;
      windowMs: number;
      peakKey: string;
    },
    emitted: ProctoringEpisodeEvent[]
  ): void {
    const { ts } = config;

    // --- sustained episode lifecycle (§10.3 debounce/hysteresis/cooldown) ---
    if (config.episodeActive) {
      state.clearedSince = null; // any active frame resets the clear-debounce
      if (state.held && ts - state.held.closedAtWall < DEFAULT_COOLDOWN_MS) {
        // Cooldown merge: reopen the just-closed episode instead of starting
        // a duplicate (mirrors the face-episode contract).
        const held = state.held;
        state.held = null;
        state.openSince = held.openedAt;
        state.candidateSince = ts;
        state.clearedSince = null;
        state.qualities = held.qualities;
        state.anglePeak = held.anglePeak;
        state.suppressed = held.suppressed;
      } else if (state.candidateSince === null) {
        state.candidateSince = ts;
        state.clearedSince = null;
      }
      state.lastActiveAt = ts;
      if (state.openSince === null
        && state.candidateSince !== null
        && ts - state.candidateSince >= config.sustainedEnterMs) {
        state.openSince = state.candidateSince;
      }
      if (state.openSince !== null) {
        if (state.qualities.length < MAX_SAMPLES) state.qualities.push(config.quality);
        state.anglePeak = Math.max(state.anglePeak, config.angle);
        if (config.technicalActive) {
          state.suppressed = true; // §17.5 — dropped at close, never stored
        }
      }
    } else if (state.openSince !== null) {
      if (state.clearedSince === null) state.clearedSince = ts;
      if (ts - state.clearedSince >= ATTENTION_CLEAR_DEBOUNCE_MS) {
        this.closeAttentionEpisode(state, ts);
      }
    } else {
      // Never opened — transient candidate, discard (anti-blip rule).
      state.candidateSince = null;
      state.clearedSince = null;
      state.qualities = [];
      state.anglePeak = 0;
      state.suppressed = false;
    }

    // --- pattern segment lifecycle (feeds the REPEATED window) ---
    if (config.segmentActive) {
      if (state.segment === null) {
        state.segment = {
          start: ts, lastTs: ts, frames: 1,
          qualities: [config.quality], anglePeak: config.angle,
        };
      } else {
        state.segment.lastTs = ts;
        state.segment.frames += 1;
        if (state.segment.qualities.length < MAX_SAMPLES) state.segment.qualities.push(config.quality);
        state.segment.anglePeak = Math.max(state.segment.anglePeak, config.angle);
      }
    } else if (state.segment !== null) {
      // The segment ends only once the condition has stayed false beyond the
      // clear-debounce (a sub-second gap never splits a look-away).
      if (ts - state.segment.lastTs >= ATTENTION_CLEAR_DEBOUNCE_MS) {
        this.finishAttentionSegment(state, config, emitted);
        state.segment = null;
      }
    }
  }

  /** Closes the open sustained episode into the cooldown hold (§10.3). */
  private closeAttentionEpisode(
    state: AttentionFamilyState,
    ts: number
  ): NonNullable<AttentionFamilyState['held']> | null {
    const openedAt = state.openSince;
    if (openedAt === null) return null;
    const snapshot = {
      openedAt,
      closedAt: state.lastActiveAt ?? ts,
      closedAtWall: ts,
      qualities: [...state.qualities],
      anglePeak: state.anglePeak,
      suppressed: state.suppressed,
    };
    state.held = snapshot;
    state.openSince = null;
    state.candidateSince = null;
    state.clearedSince = null;
    state.qualities = [];
    state.anglePeak = 0;
    state.suppressed = false;
    return snapshot;
  }

  /** Emits attention episodes whose cooldown window has elapsed. */
  private releaseExpiredAttentionHeld(ts: number, emitted: ProctoringEpisodeEvent[]): void {
    for (const [state, sustainedType] of [
      [this.extremeFamily, 'HEAD_POSE_EXTREME' as ProctoringEventType],
      [this.deviationFamily, 'ATTENTION_DEVIATION_SUSTAINED' as ProctoringEventType],
    ] as const) {
      if (!state.held) continue;
      if (ts - state.held.closedAtWall >= DEFAULT_COOLDOWN_MS) {
        const event = this.buildAttentionEpisode(
          { ...state.held, qualities: [...state.held.qualities] },
          sustainedType,
          this.attentionFamilyConfigFor(sustainedType)
        );
        if (event) emitted.push(event);
        state.held = null;
      }
    }
  }

  /**
   * Qualifies a finished segment and, when the repetition window fills,
   * emits exactly one pattern event and consumes the window.
   */
  private finishAttentionSegment(
    state: AttentionFamilyState,
    config: {
      sustainedType: ProctoringEventType;
      minEpisodeMs: number;
      minEpisodes: number;
      windowMs: number;
      peakKey: string;
    },
    emitted: ProctoringEpisodeEvent[]
  ): void {
    const segment = state.segment;
    if (!segment) return;
    const durationMs = segment.lastTs - segment.start;
    if (segment.frames < ATTENTION_SEGMENT_MIN_FRAMES || durationMs < config.minEpisodeMs) {
      return; // sub-threshold glance (§13.3) — never counted, never emitted
    }
    const quality = median(segment.qualities) ?? 0;
    state.window.push({ start: segment.start, end: segment.lastTs, quality });
    // Sliding window: drop segments older than windowMs (measured from the
    // newest segment's end) — deterministic prune-then-count order.
    state.window = state.window.filter((s) => s.end >= segment.lastTs - config.windowMs);
    if (state.window.length > MAX_PATTERN_SEGMENTS) {
      state.window = state.window.slice(state.window.length - MAX_PATTERN_SEGMENTS);
    }
    if (state.window.length < config.minEpisodes) return;

    const count = state.window.length;
    const qualities = state.window.map((s) => s.quality);
    const event = this.buildAttentionEpisode(
      {
        openedAt: state.window[0].start,
        closedAt: segment.lastTs,
        qualities,
        anglePeak: segment.anglePeak,
        suppressed: false,
      },
      repeatedTypeFor(config.sustainedType),
      config,
      { episodes: count }
    );
    if (event) emitted.push(event);
    state.window = []; // consumed — the next pattern event needs a full fresh window
  }

  /** Session end: flush open episodes + the in-flight segment (deterministic). */
  private closeAttentionFamily(
    state: AttentionFamilyState,
    sustainedType: ProctoringEventType,
    ts: number,
    emitted: ProctoringEpisodeEvent[]
  ): void {
    const config = this.attentionFamilyConfigFor(sustainedType);
    if (state.held) {
      const event = this.buildAttentionEpisode(
        { ...state.held, qualities: [...state.held.qualities] },
        sustainedType,
        config
      );
      if (event) emitted.push(event);
      state.held = null;
    }
    if (state.openSince !== null) {
      // closeAll bypasses the cooldown by design (§10.3) — emit immediately.
      const closed = this.closeAttentionEpisode(state, ts);
      if (closed) {
        const event = this.buildAttentionEpisode(
          { ...closed, qualities: [...closed.qualities] },
          sustainedType,
          config
        );
        if (event) emitted.push(event);
        state.held = null;
      }
    }
    if (state.segment !== null) {
      this.finishAttentionSegment(state, config, emitted);
      state.segment = null;
    }
  }

  /** Thresholds/metadata for one family, keyed by its sustained event type. */
  private attentionFamilyConfigFor(sustainedType: ProctoringEventType): {
    sustainedType: ProctoringEventType;
    sustainedEnterMs: number;
    minEpisodeMs: number;
    minEpisodes: number;
    windowMs: number;
    peakKey: string;
  } {
    const t = this.attentionThresholds;
    if (sustainedType === 'HEAD_POSE_EXTREME') {
      return {
        sustainedType,
        sustainedEnterMs: t.extremeSustainMs,
        minEpisodeMs: t.headPoseMinEpisodeMs,
        minEpisodes: t.headPoseMinEpisodes,
        windowMs: t.headPoseWindowMs,
        peakKey: 'peakAngleDeg',
      };
    }
    return {
      sustainedType,
      sustainedEnterMs: t.deviationSustainMs,
      minEpisodeMs: t.deviationMinEpisodeMs,
      minEpisodes: t.deviationMinEpisodes,
      windowMs: t.deviationWindowMs,
      peakKey: 'deviationPeakDeg',
    };
  }

  /**
   * Shapes one attention observation for transport. Same reliability rules as
   * face-present observations: probabilistic (confidence = median frame
   * quality, dropped below the confidence floor), record-only, with the
   * basis/calibration/thresholds provenance the plan requires (§13.1/§13.2).
   */
  private buildAttentionEpisode(
    snapshot: {
      openedAt: number;
      closedAt: number;
      qualities: number[];
      anglePeak: number;
      suppressed: boolean;
    },
    type: ProctoringEventType,
    config: { minEpisodeMs: number; minEpisodes: number; windowMs: number; peakKey: string; sustainedEnterMs?: number },
    extra?: { episodes: number }
  ): ProctoringEpisodeEvent | null {
    if (snapshot.suppressed) return null;
    const med = median(snapshot.qualities);
    if (med === null || med < CONFIDENCE_FLOOR) return null; // lighting/noise guard

    const t = this.attentionThresholds;
    const thresholds = type === 'HEAD_POSE_REPEATED'
      ? { minEpisodes: config.minEpisodes, minEpisodeMs: config.minEpisodeMs, windowMs: config.windowMs }
      : type === 'ATTENTION_DEVIATION_REPEATED'
        ? { minEpisodes: config.minEpisodes, minEpisodeMs: config.minEpisodeMs, windowMs: config.windowMs }
        : type === 'HEAD_POSE_EXTREME'
          ? { yawDeg: t.extremeYawDeg, pitchDeg: t.extremePitchDeg, sustainMs: config.sustainedEnterMs ?? t.extremeSustainMs }
          : { deg: t.effectiveDeviationDeg, sustainMs: config.sustainedEnterMs ?? t.deviationSustainMs };

    return {
      type,
      openedAt: snapshot.openedAt,
      closedAt: snapshot.closedAt,
      confidence: round2(med),
      metadata: {
        ...detectorMeta(this.detectorTier),
        durationMs: Math.max(0, snapshot.closedAt - snapshot.openedAt),
        basis: 'head_pose',
        calibration: this.attentionCalibration,
        ...(this.attentionCalibration === 'fallback' ? { baseline: { yaw: 0, pitch: 0 } } : { baseline: { yaw: this.attentionBaseline.yaw, pitch: this.attentionBaseline.pitch } }),
        thresholds,
        ...(extra ? { episodes: extra.episodes } : {}),
        [config.peakKey]: round2(snapshot.anglePeak),
      },
    };
  }

  private thresholdsFor(type: ProctoringEventType): EpisodeThresholds {
    const computed = this.thresholdsForBase(type);
    return { ...computed, ...(this.thresholdOverrides[type] ?? {}) };
  }

  private thresholdsForBase(type: ProctoringEventType): EpisodeThresholds {
    switch (type) {
      case 'FACE_NOT_DETECTED':
        return {
          enterMs: Math.max(this.policy.facePresence?.minAbsentMs ?? 8000, DEBOUNCE_FLOOR_MS),
          exitMs: DEBOUNCE_FLOOR_MS,
          cooldownMs: DEFAULT_COOLDOWN_MS,
        };
      case 'MULTIPLE_FACES_DETECTED':
        return {
          enterMs: Math.max(this.policy.multipleFaces?.minDurationMs ?? 3000, DEBOUNCE_FLOOR_MS),
          exitMs: DEBOUNCE_FLOOR_MS,
          cooldownMs: DEFAULT_COOLDOWN_MS,
        };
      case 'FACE_PARTIALLY_VISIBLE':
      case 'FACE_OUT_OF_FRAME':
        return {
          enterMs: DEFAULT_FACE_VISIBILITY_ENTER_MS,
          exitMs: DEBOUNCE_FLOOR_MS,
          cooldownMs: DEFAULT_COOLDOWN_MS,
        };
      case 'CAMERA_FEED_DARK':
        return { enterMs: DEFAULT_DARK_ENTER_MS, exitMs: DEBOUNCE_FLOOR_MS, cooldownMs: DEFAULT_COOLDOWN_MS };
      default:
        // Engine-debounced technical signals: open/close immediately.
        return { enterMs: 0, exitMs: 0, cooldownMs: 0 };
    }
  }

  private conditionFor(type: ProctoringEventType): ConditionState {
    let condition = this.conditions.get(type);
    if (!condition) {
      condition = {
        type,
        thresholds: this.thresholdsFor(type),
        candidateSince: null,
        openSince: null,
        lastActiveAt: null,
        clearedSince: null,
        confidences: [],
        frameCount: 0,
        sanitizedCount: 0,
        peak: null,
        suppressed: false,
        held: null,
      };
      this.conditions.set(type, condition);
    }
    return condition;
  }

  private update(
    type: ProctoringEventType,
    active: boolean,
    ts: number,
    sample: {
      confidence?: number;
      sanitized?: boolean;
      peak?: Record<string, number> | null;
      signalMeta?: Record<string, unknown>;
      technicalActive?: boolean;
    }
  ): ProctoringEpisodeEvent[] {
    const condition = this.conditionFor(type);
    const emitted: ProctoringEpisodeEvent[] = [];

    if (active) {
      // Cooldown merge: re-entry while the just-closed episode is still held
      // reopens THAT episode instead of starting a duplicate (plan §10.3).
      if (condition.held && ts - condition.held.closedAtWall < condition.thresholds.cooldownMs) {
        const held = condition.held;
        condition.held = null;
        condition.openSince = held.openedAt;
        condition.candidateSince = ts;
        condition.clearedSince = null;
        condition.confidences = held.confidences;
        condition.frameCount = held.frameCount;
        condition.sanitizedCount = held.sanitizedCount;
        condition.peak = held.peak;
        condition.suppressed = held.suppressed;
        condition.suppressReason = held.suppressReason;
      } else if (condition.candidateSince === null) {
        condition.candidateSince = ts;
        condition.clearedSince = null;
      }
      condition.lastActiveAt = ts;

      if (condition.confidences.length < MAX_SAMPLES && typeof sample.confidence === 'number') {
        condition.confidences.push(sample.confidence);
      }
      condition.frameCount += 1;
      if (sample.sanitized) condition.sanitizedCount += 1;
      if (sample.peak) {
        // Peak metadata aggregation: *Peak keys keep the max, *Min keys the
        // min, everything else overwrites (last observed value).
        const merged: Record<string, number> = { ...(condition.peak ?? {}) };
        for (const [key, value] of Object.entries(sample.peak)) {
          const prev = merged[key];
          merged[key] = key.endsWith('Peak') ? Math.max(prev ?? value, value)
            : key.endsWith('Min') ? Math.min(prev ?? value, value)
            : value;
        }
        condition.peak = merged;
      }
      if (sample.signalMeta) {
        const mergedMeta: Record<string, number> = { ...(condition.peak ?? {}) };
        for (const [key, value] of Object.entries(sample.signalMeta)) {
          if (typeof value === 'number') mergedMeta[key] = value;
        }
        condition.peak = mergedMeta;
      }

      // Open once the enter-debounce is satisfied.
      if (condition.openSince === null
        && condition.candidateSince !== null
        && ts - condition.candidateSince >= condition.thresholds.enterMs) {
        condition.openSince = condition.candidateSince;
      }

      // Precedence (§17.5): face observations are meaningless while a
      // technical camera/session condition is open — suppress the episode.
      if (sample.technicalActive && !TECHNICAL_TYPES.has(type)) {
        condition.suppressed = true;
        condition.suppressReason = 'technical_overlap';
      }
      return emitted;
    }

    // Inactive: clear-debounce, then close.
    if (condition.openSince !== null) {
      if (condition.clearedSince === null) condition.clearedSince = ts;
      if (ts - condition.clearedSince >= condition.thresholds.exitMs) {
        this.closeCondition(condition, ts, emitted, {});
      }
    } else {
      // Never opened — transient candidate, discard (the anti-blip rule).
      condition.candidateSince = null;
      condition.clearedSince = null;
      condition.confidences = [];
      condition.frameCount = 0;
      condition.sanitizedCount = 0;
      condition.peak = null;
      condition.suppressed = false;
    }
    return emitted;
  }

  private updateStasis(ts: number): ProctoringEpisodeEvent[] {
    // Frozen while the SAME signature has persisted for ≥ DEFAULT_FROZEN_FRAMES
    // consecutive frames; recovers the moment any signature differs.
    return this.update(
      'CAMERA_FEED_FROZEN',
      this.lastSignature !== null && this.identicalSignatureCount >= DEFAULT_FROZEN_FRAMES,
      ts,
      {
        peak: this.lastSignature !== null ? { frames: this.identicalSignatureCount } : null,
        technicalActive: this.hasOpenTechnical,
      }
    );
  }

  private closeCondition(
    condition: ConditionState,
    ts: number,
    emitted: ProctoringEpisodeEvent[],
    { bypassCooldown }: { bypassCooldown?: boolean }
  ): void {
    const openedAt = condition.openSince;
    if (openedAt === null) return;
    const closedAt = condition.lastActiveAt ?? ts;

    const snapshot = {
      openedAt,
      closedAt,
      confidences: condition.confidences,
      frameCount: condition.frameCount,
      sanitizedCount: condition.sanitizedCount,
      peak: condition.peak,
      suppressed: condition.suppressed,
      suppressReason: condition.suppressReason,
      closedAtWall: ts,
    };

    // Reset the live condition.
    condition.openSince = null;
    condition.candidateSince = null;
    condition.clearedSince = null;
    condition.confidences = [];
    condition.frameCount = 0;
    condition.sanitizedCount = 0;
    condition.peak = null;
    condition.suppressed = false;
    condition.suppressReason = undefined;

    if (condition.thresholds.cooldownMs > 0 && !bypassCooldown) {
      condition.held = snapshot; // merge-or-emit later
    } else {
      const event = this.buildEpisode(snapshot, condition.type);
      if (event) emitted.push(event);
    }
  }

  private releaseExpiredHeld(ts: number, emitted: ProctoringEpisodeEvent[]): void {
    for (const condition of this.conditions.values()) {
      if (!condition.held) continue;
      if (ts - condition.held.closedAtWall >= condition.thresholds.cooldownMs) {
        const event = this.buildEpisode(condition.held, condition.type);
        if (event) emitted.push(event);
        condition.held = null;
      }
    }
  }

  /**
   * Shapes one finished episode snapshot into its transport event, applying
   * the confidence floor and reliability rules (probabilistic events carry a
   * confidence; deterministic technical events never do — §17.3/§17.4).
   * Returns null for suppressed/unreliable episodes (dropped, not emitted).
   */
  private buildEpisode(
    snapshot: NonNullable<ConditionState['held']>,
    type: ProctoringEventType
  ): ProctoringEpisodeEvent | null {
    if (snapshot.suppressed) return null;

    const durationMs = Math.max(0, snapshot.closedAt - snapshot.openedAt);
    const meta: Record<string, unknown> = { ...detectorMeta(this.detectorTier), durationMs };

    if (TECHNICAL_TYPES.has(type)) {
      // Deterministic technical episodes — no confidence field allowed.
      if (snapshot.peak) Object.assign(meta, snapshot.peak);
      if (type === 'CAMERA_FEED_DARK') meta.threshold = DARK_LUMA_FLOOR;
      return { type, openedAt: snapshot.openedAt, closedAt: snapshot.closedAt, metadata: meta };
    }

    // Probabilistic CV observations — confidence required.
    const med = median(snapshot.confidences);
    if (type === 'FACE_NOT_DETECTED') {
      const sanitizedFraction = snapshot.frameCount > 0
        ? snapshot.sanitizedCount / snapshot.frameCount : 0;
      if (sanitizedFraction > MAX_SANITIZED_FRACTION) {
        return null; // unreliable detection channel — ambiguous, drop
      }
      return {
        type,
        openedAt: snapshot.openedAt,
        closedAt: snapshot.closedAt,
        confidence: round2(Math.max(0, 1 - sanitizedFraction)),
        metadata: {
          ...meta,
          basis: 'detection_health',
          thresholds: { minAbsentMs: this.policy.facePresence?.minAbsentMs ?? 8000 },
        },
      };
    }

    // Face-present observations: median quality floor (lighting/noise guard).
    if (med === null || med < CONFIDENCE_FLOOR) return null;
    if (snapshot.peak) Object.assign(meta, snapshot.peak);
    if (type === 'MULTIPLE_FACES_DETECTED') {
      meta.thresholds = { minDurationMs: this.policy.multipleFaces?.minDurationMs ?? 3000 };
    }
    if (type === 'FACE_OUT_OF_FRAME') meta.reason = 'face_too_small';
    return {
      type,
      openedAt: snapshot.openedAt,
      closedAt: snapshot.closedAt,
      confidence: round2(med),
      metadata: meta,
    };
  }
}

/** Luma below which the feed counts as dark (plan §10.2 illustrative <15/255). */
export const DARK_LUMA_FLOOR = 15;
/** Luma at/above which a dark episode may clear (hysteresis, +10). */
export const DARK_LUMA_CLEAR = DARK_LUMA_FLOOR + 10;
