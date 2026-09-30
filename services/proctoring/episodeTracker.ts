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
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

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

  constructor(options: EpisodeTrackerOptions = {}) {
    this.policy = options.policy ?? {};
    this.detectorTier = options.detectorTier ?? 'headpose';
    this.now = options.now ?? (() => Date.now());
    this.thresholdOverrides = options.thresholdOverrides ?? {};
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
    return emitted;
  }

  // ---- internals ----------------------------------------------------------

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
