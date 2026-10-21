/**
 * Phase 5 — head pose + record-only attention derivation (plan §13, §29.4
 * movement/blink/glance/look-away rows, D6/D11).
 *
 * Contract under test:
 *  - thresholds come from the FROZEN policy snapshot (never hardcoded angles)
 *  - the §13.3 normal-behavior matrix produces NOTHING (anti-"no head
 *    movement" contract — blinking, drift, brief glances, single frames)
 *  - sustained/repeated deviations produce record-only episodes with
 *    basis/confidence/threshold/calibration provenance, deterministically
 *  - §17.5 precedence (technical overlap, face gating, extreme-vs-deviation)
 *  - D11 fallback (wider tolerance, calibration:'fallback', zero behavioral
 *    consequence)
 *  - attention.enabled:false emits nothing at all
 */

import { EpisodeTracker, DEFAULT_ATTENTION_THRESHOLDS } from '../proctoring/episodeTracker';
import type { ProctoringFrameObservation, ProctoringPolicy } from '../proctoring/types';

/** 10 fps analysis cadence — episode math stays human-readable. */
const STEP = 100;
const QUALITY = 0.9;

let clock = 0;
const frame = (
  yaw: number | null,
  pitch: number | null,
  overrides: Partial<ProctoringFrameObservation> = {}
): ProctoringFrameObservation => ({
  tsMs: (clock += STEP),
  faceCount: yaw === null && pitch === null ? 0 : 1,
  faceCountClass: yaw === null && pitch === null ? 'none' : 'one',
  visibility: yaw === null && pitch === null ? 'none' : 'ok',
  qualityProxy: QUALITY,
  largestFaceRatio: 0.35,
  meanLuma: 120,
  sanitized: false,
  headPose: yaw === null && pitch === null ? null : { yaw, pitch, roll: 0 },
  ...overrides,
});

const centered = (overrides: Partial<ProctoringFrameObservation> = {}) =>
  frame(0, 0, overrides);

/** Feeds `count` frames of one pose, returning emitted episodes. */
const hold = (tracker: EpisodeTracker, yaw: number | null, pitch: number | null, count: number) => {
  const emitted = [];
  for (let i = 0; i < count; i += 1) {
    emitted.push(...tracker.observeFrame(frame(yaw, pitch)));
  }
  return emitted.flat();
};

const makeTracker = (policy?: ProctoringPolicy, baseline?: { yaw: number; pitch: number } | null) =>
  new EpisodeTracker({
    policy,
    ...(baseline !== undefined ? { attentionBaseline: baseline } : {}),
  });

const types = (episodes: { type: string }[]) => episodes.map((e) => e.type);
const sustainedOf = (type: string) => (episodes: any[]) =>
  episodes.filter((e) => e.type === type && !/REPEATED/.test(type));

// ---------- §13.3 normal-behavior matrix: everything here produces NOTHING ----------

describe('Phase 5 attention — normal behavior is protected (§13.3/§29.4)', () => {
  const nothingExpected = (episodes: any[]) => {
    expect(episodes.filter((e) => /HEAD_POSE|ATTENTION/.test(e.type))).toEqual([]);
  };

  test('blinking (quality dips, pose stays centered) never events', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [];
    for (let i = 0; i < 100; i += 1) {
      emitted.push(...tracker.observeFrame(centered({ qualityProxy: i % 7 === 0 ? 0.2 : QUALITY })));
    }
    nothingExpected(emitted.flat());
  });

  test('slow drift within ±25° produces nothing, however long', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [];
    for (let i = 0; i < 300; i += 1) {
      const yaw = 24 * Math.sin(i / 50);
      emitted.push(...tracker.observeFrame(frame(yaw, 0)));
    }
    nothingExpected(emitted.flat());
  });

  test('posture adjustments / nodding (brief ±35° excursions under minEpisodeMs)', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [];
    for (let cycle = 0; cycle < 20; cycle += 1) {
      for (let i = 0; i < 10; i += 1) emitted.push(...tracker.observeFrame(frame(0, 0)));
      for (let i = 0; i < 12; i += 1) emitted.push(...tracker.observeFrame(frame(35, 0))); // 1.2 s < 1.5 s
      for (let i = 0; i < 10; i += 1) emitted.push(...tracker.observeFrame(frame(0, 0)));
    }
    nothingExpected(emitted.flat());
  });

  test('any single frame, however extreme, produces nothing (even at snapshot cadence)', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    // 4 s cadence — one anomalous frame spans seconds on the snapshot path;
    // the ≥2-frame segment guard + sustain debounce still refuse it.
    clock += STEP;
    expect(tracker.observeFrame(frame(0, 0))).toEqual([]);
    clock += 3900;
    expect(tracker.observeFrame(frame(80, 0))).toEqual([]); // the extreme single frame
    clock += 3900;
    const after = tracker.observeFrame(frame(0, 0));
    nothingExpected(after);
    clock += 3900;
    nothingExpected(tracker.observeFrame(frame(0, 0)));
  });

  test('brief looking away (< 2 s) produces nothing', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [
      ...hold(tracker, 0, 0, 20),
      ...hold(tracker, 40, 0, 14), // 1.4 s in the deviation band
      ...hold(tracker, 0, 0, 30),
    ];
    nothingExpected(emitted);
  });
});

// ---------- policy-driven thresholds (AC: no hardcoded angles) ----------

describe('Phase 5 attention — thresholds read from the policy snapshot', () => {
  test('deviation.deg: 10 trips at 10° (not the default 35)', () => {
    const tracker = makeTracker({
      attention: { enabled: true, mode: 'record', thresholds: { deviation: { deg: 10, sustainMs: 2000 } } },
    }, { yaw: 0, pitch: 0 });
    const emitted = [
      ...hold(tracker, 11, 0, 30), // 3 s ≥ 2 s sustain
      ...hold(tracker, 0, 0, 130), // close (1 s debounce) + 10 s cooldown release
    ];
    const sustained = sustainedOf('ATTENTION_DEVIATION_SUSTAINED')(emitted);
    expect(sustained).toHaveLength(1);
    expect(sustained[0].metadata.thresholds).toMatchObject({ deg: 10, sustainMs: 2000 });
  });

  test('extreme.yawDeg: 20 trips at 20° with the policy sustain window', () => {
    const tracker = makeTracker({
      attention: { enabled: true, thresholds: { extreme: { yawDeg: 20, pitchDeg: 20, sustainMs: 1500 } } },
    }, { yaw: 0, pitch: 0 });
    const emitted = [
      ...hold(tracker, 21, 0, 30),
      ...hold(tracker, 0, 0, 130), // close + cooldown release
    ];
    const extreme = emitted.filter((e: any) => e.type === 'HEAD_POSE_EXTREME');
    expect(extreme).toHaveLength(1);
    expect(extreme[0].metadata.thresholds).toMatchObject({ yawDeg: 20, pitchDeg: 20, sustainMs: 1500 });
  });

  test('a snapshot predating Phase 5 (no thresholds) uses the documented client defaults', () => {
    const tracker = makeTracker({ attention: { enabled: true, mode: 'record' } }, { yaw: 0, pitch: 0 });
    // 30° deviation: above turnedDeg(25)? No — deviation band is 35 default.
    const belowDefault = [
      ...hold(tracker, 34, 0, 80), // 8 s of 34° — under the 35° default band
      ...hold(tracker, 0, 0, 130),
    ];
    expect(types(belowDefault.filter((e: any) => /ATTENTION/.test(e.type)))).toEqual([]);
    const aboveDefault = [
      ...hold(tracker, 36, 0, 80), // 8 s of 36° — over the default band
      ...hold(tracker, 0, 0, 130),
    ];
    expect(types(aboveDefault.filter((e: any) => /ATTENTION/.test(e.type)))).toEqual(['ATTENTION_DEVIATION_SUSTAINED']);
    expect(DEFAULT_ATTENTION_THRESHOLDS.deviation.deg).toBe(35);
  });
});

// ---------- sustained + repeated derivation ----------

describe('Phase 5 attention — sustained looking away (record-only episodes)', () => {
  test('10 s look-away → exactly one ATTENTION_DEVIATION_SUSTAINED with full provenance', () => {
    const tracker = makeTracker(undefined, { yaw: 5, pitch: 0 });
    const during = hold(tracker, 45, 0, 100); // deviation 40° for 10 s
    expect(types(during)).toEqual([]); // nothing until the episode CLOSES
    const closing = hold(tracker, 5, 0, 130); // return + clear-debounce + cooldown
    const sustained = sustainedOf('ATTENTION_DEVIATION_SUSTAINED')(closing);
    expect(sustained).toHaveLength(1);
    expect(sustained[0]).toMatchObject({
      type: 'ATTENTION_DEVIATION_SUSTAINED',
      confidence: QUALITY,
    });
    expect(sustained[0].metadata).toMatchObject({
      basis: 'head_pose',
      calibration: 'captured',
      durationMs: 9_900, // lastActive 10.0 s - first-active 0.1 s
      deviationPeakDeg: 40,
      baseline: { yaw: 5, pitch: 0 },
    });
    expect(sustained[0].metadata.thresholds).toMatchObject({ deg: 35, sustainMs: 4000 });
    expect(sustained[0].metadata.detectorTier).toBe('headpose');
  });

  test('sustained extreme orientation → HEAD_POSE_EXTREME and NO deviation double-count', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [
      ...hold(tracker, 55, 0, 60), // 6 s at 55° (extreme band owns these frames)
      ...hold(tracker, 0, 0, 130),
    ];
    const extreme = emitted.filter((e: any) => e.type === 'HEAD_POSE_EXTREME');
    expect(extreme).toHaveLength(1);
    expect(extreme[0].metadata.peakAngleDeg).toBe(55);
    expect(emitted.filter((e: any) => /ATTENTION_DEVIATION/.test(e.type))).toEqual([]);
  });

  test('a sub-second glance back during a long look-away does not split the episode', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [
      ...hold(tracker, 40, 0, 50), // 5 s away — episode opens at 4.1 s
      ...hold(tracker, 0, 0, 8), // 0.8 s back (< clear-debounce 1 s — no split)
      ...hold(tracker, 40, 0, 60), // 6 s away again — same episode
      ...hold(tracker, 0, 0, 130),
    ];
    const sustained = sustainedOf('ATTENTION_DEVIATION_SUSTAINED')(emitted);
    expect(sustained).toHaveLength(1);
    expect(sustained[0].metadata.durationMs).toBeGreaterThanOrEqual(10_000);
  });

  test('cooldown merge: re-entry within the cooldown reopens ONE episode', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [
      ...hold(tracker, 40, 0, 60), // 6 s away
      ...hold(tracker, 0, 0, 15), // 1.5 s back: episode closes into the hold…
      ...hold(tracker, 40, 0, 30), // …and re-enters inside the 10 s cooldown → merge
      ...hold(tracker, 0, 0, 130),
    ];
    const sustained = sustainedOf('ATTENTION_DEVIATION_SUSTAINED')(emitted);
    expect(sustained).toHaveLength(1); // merged, not two
  });
});

describe('Phase 5 attention — repeated patterns (deterministic window)', () => {
  /** One glance: `awayMs` in the deviation band, then ≥1.2 s centered. */
  const glance = (tracker: EpisodeTracker, awayMs: number) => {
    const emitted = [
      ...hold(tracker, 40, 0, Math.round(awayMs / STEP)),
      ...hold(tracker, 0, 0, 12),
    ];
    return emitted;
  };

  test('4 qualifying glances → exactly one ATTENTION_DEVIATION_REPEATED, window resets', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [
      ...glance(tracker, 2000), // each glance: 2 s ≥ 1.5 s min, < 4 s sustain
      ...glance(tracker, 2000),
      ...glance(tracker, 2000),
      ...glance(tracker, 2000),
    ];
    const repeated = emitted.filter((e: any) => e.type === 'ATTENTION_DEVIATION_REPEATED');
    expect(repeated).toHaveLength(1);
    expect(repeated[0].metadata).toMatchObject({
      basis: 'head_pose',
      episodes: 4,
      calibration: 'captured',
    });
    expect(repeated[0].metadata.thresholds).toMatchObject({ minEpisodes: 4, minEpisodeMs: 1500, windowMs: 300000 });
    // openedAt = first glance start, closedAt = last glance end
    expect(repeated[0].closedAt - repeated[0].openedAt).toBeGreaterThanOrEqual(4 * 2000 + 3 * 1200 - STEP);
    expect(repeated[0].confidence).toBe(QUALITY);

    // Window consumed: 3 more glances → nothing; a 4th → a second event.
    const secondRound = [
      ...glance(tracker, 2000),
      ...glance(tracker, 2000),
      ...glance(tracker, 2000),
    ];
    expect(secondRound.filter((e: any) => e.type === 'ATTENTION_DEVIATION_REPEATED')).toEqual([]);
    const completed = [...glance(tracker, 2000)];
    expect(completed.filter((e: any) => e.type === 'ATTENTION_DEVIATION_REPEATED')).toHaveLength(1);
  });

  test('glances under minEpisodeMs never count', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [
      ...glance(tracker, 1400),
      ...glance(tracker, 1400),
      ...glance(tracker, 1400),
      ...glance(tracker, 1400),
      ...glance(tracker, 1400),
      ...glance(tracker, 1400),
    ];
    expect(emitted.filter((e: any) => /ATTENTION|HEAD_POSE/.test(e.type))).toEqual([]);
  });

  test('segments older than windowMs fall out of the window', () => {
    const tracker = makeTracker({
      attention: { enabled: true, thresholds: { repeatedDeviation: { minEpisodes: 3, minEpisodeMs: 1500, windowMs: 10000 } } },
    }, { yaw: 0, pitch: 0 });
    const emitted = [
      ...glance(tracker, 2000),
      ...glance(tracker, 2000),
      // > windowMs of centered frames: the first two glances age out
      ...hold(tracker, 0, 0, 120),
      ...glance(tracker, 2000),
    ];
    expect(emitted.filter((e: any) => e.type === 'ATTENTION_DEVIATION_REPEATED')).toEqual([]);
  });

  test('a sustained look-away also counts toward the repeated pattern', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [
      ...glance(tracker, 6000), // sustained (emits SUSTAINED on close) AND counts
      ...glance(tracker, 2000),
      ...glance(tracker, 2000),
      ...glance(tracker, 2000),
      // The 1.2 s gaps close the episode into the cooldown hold and re-entry
      // merges it — ONE continuous SUSTAINED episode spans the pattern, and
      // it releases after the 10 s cooldown (hence this longer quiet tail).
      ...hold(tracker, 0, 0, 115),
    ];
    expect(emitted.filter((e: any) => e.type === 'ATTENTION_DEVIATION_SUSTAINED')).toHaveLength(1);
    expect(emitted.filter((e: any) => e.type === 'ATTENTION_DEVIATION_REPEATED')).toHaveLength(1);
  });

  test('3 turned segments → HEAD_POSE_REPEATED (orient-away includes non-extreme turns)', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const turnedGlance = () => [
      ...hold(tracker, 30, 0, 25), // 2.5 s ≥ 2 s head-pose min
      ...hold(tracker, 0, 0, 12),
    ];
    const emitted = [
      ...turnedGlance(),
      ...turnedGlance(),
      ...turnedGlance(),
    ];
    const repeated = emitted.filter((e: any) => e.type === 'HEAD_POSE_REPEATED');
    expect(repeated).toHaveLength(1);
    expect(repeated[0].metadata.episodes).toBe(3);
    expect(repeated[0].metadata.thresholds).toMatchObject({ minEpisodes: 3, minEpisodeMs: 2000, windowMs: 300000 });
    // The 30° turns are below the deviation band → no deviation events.
    expect(emitted.filter((e: any) => /ATTENTION_DEVIATION/.test(e.type))).toEqual([]);
  });
});

// ---------- §17.5 precedence + face gating ----------

describe('Phase 5 attention — precedence and gating (§17.5)', () => {
  test('no usable face → attention inactive even with pose-shaped frames', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [
      ...hold(tracker, 55, 0, 5),
      ...Array.from({ length: 100 }, () =>
        tracker.observeFrame(frame(55, 0, { faceCount: 0, faceCountClass: 'none', visibility: 'none' }))).flat(),
      ...Array.from({ length: 100 }, () =>
        tracker.observeFrame(frame(55, 0, { faceCount: 2, faceCountClass: 'multiple', visibility: 'multiple' }))).flat(),
      ...Array.from({ length: 100 }, () =>
        tracker.observeFrame(frame(55, 0, { visibility: 'small' }))).flat(), // FACE_OUT_OF_FRAME territory
    ];
    expect(emitted.filter((e: any) => /HEAD_POSE|ATTENTION/.test(e.type))).toEqual([]);
  });

  test('a technical overlap suppresses the open attention episode (never stored)', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    // Open a technical condition while a deviation episode is open.
    tracker.signal('MODEL_UNAVAILABLE', true, { consecutiveFailures: 3 });
    const emitted = [
      ...hold(tracker, 40, 0, 60), // technical active → unusable, no new activity
      ...hold(tracker, 0, 0, 60),
    ];
    tracker.signal('MODEL_UNAVAILABLE', false);
    const closing = hold(tracker, 0, 0, 60);
    expect([...emitted, ...closing].filter((e: any) => /HEAD_POSE|ATTENTION/.test(e.type))).toEqual([]);
  });

  test('attention disabled in policy emits nothing at all', () => {
    const tracker = makeTracker({ attention: { enabled: false } }, { yaw: 0, pitch: 0 });
    const emitted = [
      ...hold(tracker, 55, 0, 80),
      ...hold(tracker, 0, 0, 130),
      ...tracker.closeAll(),
    ];
    expect(emitted.filter((e: any) => /HEAD_POSE|ATTENTION/.test(e.type))).toEqual([]);
  });
});

// ---------- D11 baseline fallback ----------

describe('Phase 5 attention — calibration fallback (D11)', () => {
  test('no baseline → wider tolerance (deg + fallbackPadDeg): 40° records nothing', () => {
    const tracker = makeTracker(undefined, null); // no baseline captured
    const belowPadded = [
      ...hold(tracker, 40, 0, 80), // 40° < 35+10
      ...hold(tracker, 0, 0, 130),
    ];
    expect(belowPadded.filter((e: any) => /ATTENTION_DEVIATION/.test(e.type))).toEqual([]);
  });

  test('no baseline: 46° deviation records with calibration fallback + neutral baseline', () => {
    const tracker = makeTracker(undefined, null);
    const emitted = [
      ...hold(tracker, 46, 0, 80), // 46°: over padded 45, under extreme 50
      ...hold(tracker, 0, 0, 130),
    ];
    const sustained = sustainedOf('ATTENTION_DEVIATION_SUSTAINED')(emitted);
    expect(sustained).toHaveLength(1);
    expect(sustained[0].metadata).toMatchObject({
      calibration: 'fallback',
      baseline: { yaw: 0, pitch: 0 },
    });
    expect(sustained[0].metadata.thresholds.deg).toBe(45);
  });

  test('the same 40° deviation DOES record with a captured baseline (pad is the only difference)', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [
      ...hold(tracker, 40, 0, 80),
      ...hold(tracker, 0, 0, 130),
    ];
    expect(sustainedOf('ATTENTION_DEVIATION_SUSTAINED')(emitted)).toHaveLength(1);
  });

  test('fallback pads ONLY the deviation band — absolute extreme stays at the policy value', () => {
    const tracker = makeTracker(undefined, null);
    const emitted = [
      ...hold(tracker, 50, 0, 80), // exactly the extreme threshold → extreme, not deviation
      ...hold(tracker, 0, 0, 130),
    ];
    expect(emitted.filter((e: any) => e.type === 'HEAD_POSE_EXTREME')).toHaveLength(1);
    expect(emitted.filter((e: any) => /ATTENTION_DEVIATION/.test(e.type))).toEqual([]);
  });
});

// ---------- confidence floor + determinism ----------

describe('Phase 5 attention — reliability + determinism', () => {
  test('episodes below the median quality floor are dropped as noise', () => {
    const noisy = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const noisyEmitted = [
      ...Array.from({ length: 60 }, () => noisy.observeFrame(frame(40, 0, { qualityProxy: 0.2 }))).flat(),
      ...Array.from({ length: 130 }, () => noisy.observeFrame(frame(0, 0, { qualityProxy: 0.2 }))).flat(),
    ];
    expect(noisyEmitted.filter((e: any) => /HEAD_POSE|ATTENTION/.test(e.type))).toEqual([]);
  });

  test('the same frame sequence always derives the same episodes (bit-stable)', () => {
    const run = () => {
      clock = 0;
      const tracker = makeTracker(undefined, { yaw: 5, pitch: 0 });
      const episodes = [
        ...hold(tracker, 45, 0, 60),
        ...hold(tracker, 5, 0, 15),
        ...hold(tracker, 45, 0, 30),
        ...hold(tracker, 5, 0, 200),
        ...glanceSequence(tracker),
      ];
      return JSON.stringify(episodes);
    };
    const glanceSequence = (tracker: EpisodeTracker) => [
      ...hold(tracker, 40, 0, 20),
      ...hold(tracker, 0, 0, 12),
      ...hold(tracker, 40, 0, 20),
      ...hold(tracker, 0, 0, 12),
      ...hold(tracker, 40, 0, 20),
      ...hold(tracker, 0, 0, 12),
      ...hold(tracker, 40, 0, 20),
      ...hold(tracker, 0, 0, 12),
    ];
    expect(run()).toBe(run());
  });

  test('closeAll flushes an open sustained episode and never invents a partial pattern', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    hold(tracker, 40, 0, 60); // open episode, 6 s
    const flushed = tracker.closeAll();
    expect(sustainedOf('ATTENTION_DEVIATION_SUSTAINED')(flushed)).toHaveLength(1);
    expect(flushed.filter((e: any) => /REPEATED/.test(e.type))).toEqual([]);
  });
});

// ---------- device-derived band boundaries (Nord 2026-10-15, §45.3) ----------
//
// The device session showed the deviation pocket is narrow: baseline yaw
// −1.6°, so deviation-active = measured yaw ∈ [33.4°, 50°). These tests lock
// the EXACT boundary semantics at both edges so calibration rounds can't
// silently shift them.

describe('Phase 5 attention — deviation/extreme band boundaries (device-derived)', () => {
  const sustainedDeviationAt = (yaw: number) => {
    const tracker = makeTracker(undefined, { yaw: -1.6, pitch: 0 });
    const emitted = [
      ...hold(tracker, yaw, 0, 80), // 8 s hold — well past the 4 s sustain
      ...hold(tracker, 0, 0, 130), // close + cooldown release
    ];
    return emitted.filter((e: any) => /ATTENTION_DEVIATION|HEAD_POSE/.test(e.type));
  };

  test('33° (just under the 33.4° lower edge) → no deviation episode, but one look-away occurrence', () => {
    // 33° is outside the deviation pocket (baseline −1.6°), yet ≥ the 25°
    // turned band — an 8 s hold is ONE qualifying occurrence (Phase 9.1:
    // HEAD_POSE_TURNED), never a deviation/extreme episode.
    const events = sustainedDeviationAt(33);
    expect(events.filter((e: any) => /ATTENTION_DEVIATION|HEAD_POSE_EXTREME|REPEATED/.test(e.type)))
      .toEqual([]);
    expect(events.filter((e: any) => e.type === 'HEAD_POSE_TURNED')).toHaveLength(1);
  });

  test('35° (just inside the pocket) → one ATTENTION_DEVIATION_SUSTAINED', () => {
    const events = sustainedDeviationAt(35);
    expect(events.filter((e: any) => e.type === 'ATTENTION_DEVIATION_SUSTAINED')).toHaveLength(1);
  });

  test('49° (just under the extreme band) → deviation, NOT extreme', () => {
    const events = sustainedDeviationAt(49);
    expect(events.filter((e: any) => e.type === 'ATTENTION_DEVIATION_SUSTAINED')).toHaveLength(1);
    expect(events.filter((e: any) => e.type === 'HEAD_POSE_EXTREME')).toEqual([]);
  });

  test('51° (just past the extreme band) → extreme owns the frames, no deviation', () => {
    const events = sustainedDeviationAt(51);
    expect(events.filter((e: any) => e.type === 'HEAD_POSE_EXTREME')).toHaveLength(1);
    expect(events.filter((e: any) => e.type === 'ATTENTION_DEVIATION_SUSTAINED')).toEqual([]);
  });

  test('the repeated-deviation window fills from pocket glances (device protocol shape)', () => {
    // 5 anchored glances of 2.5 s each in the pocket → ≥ minEpisodes (4)
    // qualifying segments → exactly one REPEATED event.
    const tracker = makeTracker(undefined, { yaw: -1.6, pitch: 0 });
    const glance = () => [...hold(tracker, 42, 0, 25), ...hold(tracker, 0, 0, 12)];
    const emitted = [
      ...glance(), ...glance(), ...glance(), ...glance(), ...glance(),
    ];
    const repeated = emitted.filter((e: any) => e.type === 'ATTENTION_DEVIATION_REPEATED');
    expect(repeated).toHaveLength(1);
    expect(repeated[0].metadata.episodes).toBeGreaterThanOrEqual(4);
    // Sustained glances (2.5 s < 4 s sustain) emit nothing individually.
    expect(emitted.filter((e: any) => e.type === 'ATTENTION_DEVIATION_SUSTAINED')).toEqual([]);
  });
});

// ---------- Phase 9.1 — look-away occurrences (HEAD_POSE_TURNED) ----------
//
// One TURNED event per QUALIFYING orient-away occurrence (≥2 frames and
// ≥ minEpisodeMs 2000 ms past the 25° turned band, sub-second gaps bridged).
// HEAD_POSE_REPEATED remains the 3rd-occurrence window marker the server's
// advisory warn keys on — occurrences 1 and 2 are recorded but silent.

describe('Phase 9.1 — look-away occurrences (HEAD_POSE_TURNED)', () => {
  const turnedOf = (episodes: any[]) => episodes.filter((e) => e.type === 'HEAD_POSE_TURNED');
  const repeatedOf = (episodes: any[]) => episodes.filter((e) => e.type === 'HEAD_POSE_REPEATED');

  /** One look-away: 3 s past the turned band, then 1.5 s back at center. */
  const glance = (tracker: EpisodeTracker) => [
    ...hold(tracker, 35, 0, 30),
    ...hold(tracker, 0, 0, 15),
  ];

  test('1st occurrence: recorded, no window marker', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = glance(tracker);
    expect(types(turnedOf(emitted))).toEqual(['HEAD_POSE_TURNED']);
    expect(repeatedOf(emitted)).toEqual([]);
  });

  test('2nd occurrence: recorded, still no window marker', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [...glance(tracker), ...glance(tracker)];
    expect(turnedOf(emitted)).toHaveLength(2);
    expect(repeatedOf(emitted)).toEqual([]);
  });

  test('3rd qualifying occurrence: recorded AND completes the window (one REPEATED marker)', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [...glance(tracker), ...glance(tracker), ...glance(tracker)];
    expect(turnedOf(emitted)).toHaveLength(3);
    expect(repeatedOf(emitted)).toHaveLength(1);
    expect(repeatedOf(emitted)[0].metadata.episodes).toBe(3);
  });

  test('4th and 5th occurrences keep recording; the next marker needs a full fresh window (6th)', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [
      ...glance(tracker), ...glance(tracker), ...glance(tracker),
      ...glance(tracker), ...glance(tracker),
    ];
    expect(turnedOf(emitted)).toHaveLength(5);
    expect(repeatedOf(emitted)).toHaveLength(1); // window consumed at the 3rd
    const more = [...glance(tracker)]; // 6th occurrence
    expect(turnedOf(more)).toHaveLength(1);
    expect(repeatedOf(more)).toHaveLength(1);
  });

  test('a sustained single head turn is ONE occurrence — no per-frame counting', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [
      ...hold(tracker, 40, 0, 90), // 9 s continuously turned
      ...hold(tracker, 0, 0, 15),
    ];
    expect(turnedOf(emitted)).toHaveLength(1);
    expect(repeatedOf(emitted)).toEqual([]);
  });

  test('a sub-second face loss inside a turn does not split the occurrence', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [
      ...hold(tracker, 35, 0, 20), // 2 s turned
      ...hold(tracker, null, null, 8), // 0.8 s face lost — under the 1 s clear-debounce
      ...hold(tracker, 35, 0, 20), // still the same occurrence
      ...hold(tracker, 0, 0, 15),
    ];
    expect(turnedOf(emitted)).toHaveLength(1);
  });

  test('occurrence counting survives a section transition (closeAll/flushNow keeps the window)', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const before = [
      ...glance(tracker),
      ...glance(tracker),
      ...tracker.closeAll(), // Phase 9 flushNow — monitoring CONTINUES on this tracker
    ];
    expect(turnedOf(before)).toHaveLength(2);
    expect(repeatedOf(before)).toEqual([]);
    const after = [...glance(tracker)]; // 3rd occurrence, post-transition
    expect(turnedOf(after)).toHaveLength(1);
    expect(repeatedOf(after)).toHaveLength(1); // window reached across the transition
  });

  test('a sub-threshold glance (< 2 s) is never an occurrence', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const emitted = [
      ...hold(tracker, 35, 0, 15), // 1.5 s — under minEpisodeMs
      ...hold(tracker, 0, 0, 15),
    ];
    expect(turnedOf(emitted)).toEqual([]);
  });

  test('occurrence provenance: thresholds + basis + peak angle + confidence', () => {
    const tracker = makeTracker(undefined, { yaw: 0, pitch: 0 });
    const [occurrence] = turnedOf([...glance(tracker), ...hold(tracker, 0, 0, 5)]);
    expect(occurrence.metadata).toMatchObject({
      basis: 'head_pose',
      calibration: 'captured',
      thresholds: { turnedDeg: DEFAULT_ATTENTION_THRESHOLDS.turnedDeg, minEpisodeMs: DEFAULT_ATTENTION_THRESHOLDS.repeatedHeadPose.minEpisodeMs },
    });
    expect(occurrence.metadata.peakAngleDeg).toBeGreaterThanOrEqual(35);
    expect(typeof occurrence.confidence).toBe('number');
  });
});
