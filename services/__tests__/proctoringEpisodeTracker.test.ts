/**
 * Episode tracker tests (Phase 3, plan §10.3/§11/§17): zero/one/multiple
 * faces, transient vs sustained loss, recovery, visibility classes, malformed
 * frames, confidence handling, camera-health signals, dark/frozen heuristics,
 * cooldown merging, precedence suppression and closeAll semantics.
 *
 * Emissions are batched: an episode is released only after close + cooldown,
 * so every scenario accumulates emissions across ALL pushes.
 */

import {
  EpisodeTracker,
  DARK_LUMA_FLOOR,
  DARK_LUMA_CLEAR,
} from '../proctoring/episodeTracker';
import type { ProctoringEpisodeEvent, ProctoringFrameObservation } from '../proctoring/types';

type Emissions = ProctoringEpisodeEvent[];

const frame = (overrides: Partial<ProctoringFrameObservation> = {}): ProctoringFrameObservation => ({
  tsMs: 0,
  faceCount: 1,
  faceCountClass: 'one',
  visibility: 'ok',
  qualityProxy: 0.9,
  largestFaceRatio: 0.35,
  meanLuma: 120,
  sanitized: false,
  ...overrides,
});

const noFace = (tsMs: number) =>
  frame({
    tsMs,
    faceCount: 0,
    faceCountClass: 'none',
    visibility: 'none',
    qualityProxy: 0,
    largestFaceRatio: null,
  });
const oneFace = (tsMs: number, extra: Partial<ProctoringFrameObservation> = {}) =>
  frame({ tsMs, ...extra });
const multiFace = (tsMs: number, count = 2, quality = 0.8) =>
  frame({
    tsMs,
    faceCount: count,
    faceCountClass: 'multiple',
    visibility: 'multiple',
    qualityProxy: quality,
  });

/** Drives a scripted frame sequence through the tracker, collecting all emissions. */
const run = (tracker: EpisodeTracker, observations: ProctoringFrameObservation[]): Emissions => {
  const all: Emissions = [];
  for (const obs of observations) {
    all.push(...tracker.observeFrame(obs));
  }
  return all;
};

describe('EpisodeTracker — face presence (plan §11.1)', () => {
  it('emits nothing for a steady one-face stream', () => {
    const tracker = new EpisodeTracker({ policy: { facePresence: { minAbsentMs: 8000 } } });
    const stream: ProctoringFrameObservation[] = [];
    for (let t = 0; t <= 60_000; t += 4000) stream.push(oneFace(t));
    expect(run(tracker, stream)).toHaveLength(0);
  });

  it('does not create an episode for transient face loss under the policy floor', () => {
    const tracker = new EpisodeTracker({ policy: { facePresence: { minAbsentMs: 8000 } } });
    // 2 s of missed frames — a glance/blink-scale gap, then recovery.
    const all = run(tracker, [oneFace(0), noFace(4000), noFace(6000), oneFace(8000), oneFace(20_000)]);
    expect(all.filter((e) => e.type === 'FACE_NOT_DETECTED')).toHaveLength(0);
  });

  it('creates one debounced FACE_NOT_DETECTED episode for sustained loss, closed on recovery', () => {
    const tracker = new EpisodeTracker({ policy: { facePresence: { minAbsentMs: 8000 } } });
    const stream: ProctoringFrameObservation[] = [];
    for (let t = 0; t <= 32_000; t += 4000) stream.push(noFace(t));

    // Still held — nothing is emitted before close + cooldown.
    expect(run(tracker, stream)).toHaveLength(0);

    // Face returns at 36 s; exit-debounce clears at 37.5 s; cooldown releases
    // at 47.5 s; the 48 s push carries the finished episode.
    const all = run(tracker, [oneFace(36_000), oneFace(37_500), oneFace(48_000)]);
    expect(all).toHaveLength(1);
    const episode = all[0];
    expect(episode.type).toBe('FACE_NOT_DETECTED');
    expect(episode.openedAt).toBe(0);
    expect(episode.closedAt).toBeGreaterThanOrEqual(32_000);
    expect(episode.confidence).toBe(1); // clean channel — no sanitized frames
    expect((episode.metadata as Record<string, unknown>).basis).toBe('detection_health');
    expect((episode.metadata as Record<string, unknown>).thresholds).toEqual({ minAbsentMs: 8000 });
    expect((episode.metadata as Record<string, unknown>).detectorTier).toBe('headpose');
  });

  it('merges a re-entry inside the cooldown window into ONE episode (§10.3)', () => {
    const tracker = new EpisodeTracker({ policy: { facePresence: { minAbsentMs: 2000 } } });
    // Absence 0–6 s, brief presence, absence again 9–20 s — the second
    // absence re-enters inside the 10 s cooldown → a single merged episode.
    const all = run(tracker, [
      noFace(0), noFace(4000), noFace(6000),
      oneFace(7000), oneFace(8000), // exit debounce clears here
      noFace(9000), noFace(20_000), // re-entry inside cooldown → merged
      oneFace(21_000), oneFace(32_000), oneFace(50_000),
    ]);
    const absence = all.filter((e) => e.type === 'FACE_NOT_DETECTED');
    expect(absence).toHaveLength(1);
    expect(absence[0].openedAt).toBe(0);
    expect(absence[0].closedAt).toBe(20_000); // spans both absences
  });
});

describe('EpisodeTracker — multiple faces (plan §11.2)', () => {
  it('creates a structured episode for sustained multiple faces with peak count + confidence', () => {
    const tracker = new EpisodeTracker({ policy: { multipleFaces: { minDurationMs: 3000 } } });
    const stream: ProctoringFrameObservation[] = [oneFace(0)];
    for (let t = 4000; t <= 20_000; t += 4000) {
      stream.push(multiFace(t, t >= 12_000 ? 3 : 2));
    }
    stream.push(oneFace(24_000), oneFace(35_000), oneFace(50_000));
    const multi = run(tracker, stream).filter((e) => e.type === 'MULTIPLE_FACES_DETECTED');

    expect(multi).toHaveLength(1);
    expect(multi[0].openedAt).toBe(4000);
    expect((multi[0].metadata as Record<string, unknown>).faceCountPeak).toBe(3);
    expect(multi[0].confidence).toBeGreaterThan(0);
    expect((multi[0].metadata as Record<string, unknown>).thresholds).toEqual({ minDurationMs: 3000 });
  });

  it('ignores a single-frame multiple-face blip', () => {
    const tracker = new EpisodeTracker({ policy: { multipleFaces: { minDurationMs: 3000 } } });
    const all = run(tracker, [oneFace(0), multiFace(4000), oneFace(8000), oneFace(20_000)]);
    expect(all.filter((e) => e.type === 'MULTIPLE_FACES_DETECTED')).toHaveLength(0);
  });
});

describe('EpisodeTracker — visibility classes (plan §11.1)', () => {
  it('maps a clipped face to FACE_PARTIALLY_VISIBLE after the sustain window', () => {
    const tracker = new EpisodeTracker();
    const stream: ProctoringFrameObservation[] = [];
    for (let t = 0; t <= 40_000; t += 4000) stream.push(oneFace(t, { visibility: 'partial' }));
    stream.push(oneFace(44_000), oneFace(56_000), oneFace(70_000));
    const partial = run(tracker, stream).filter((e) => e.type === 'FACE_PARTIALLY_VISIBLE');
    expect(partial).toHaveLength(1);
    expect(partial[0].confidence).toBeGreaterThan(0);
  });

  it('maps a too-small face to FACE_OUT_OF_FRAME with the honest reason', () => {
    const tracker = new EpisodeTracker();
    const stream: ProctoringFrameObservation[] = [];
    for (let t = 0; t <= 40_000; t += 4000) {
      stream.push(oneFace(t, { visibility: 'small', largestFaceRatio: 0.08 }));
    }
    stream.push(oneFace(44_000), oneFace(56_000), oneFace(70_000));
    const outOfFrame = run(tracker, stream).filter((e) => e.type === 'FACE_OUT_OF_FRAME');
    expect(outOfFrame).toHaveLength(1);
    expect((outOfFrame[0].metadata as Record<string, unknown>).reason).toBe('face_too_small');
    expect((outOfFrame[0].metadata as Record<string, unknown>).largestFaceRatioMin).toBe(0.08);
  });
});

describe('EpisodeTracker — confidence + malformed frames (plan §10.3, §17.4)', () => {
  it('drops face-present episodes whose median quality is below the floor (lighting/noise)', () => {
    const tracker = new EpisodeTracker({ policy: { multipleFaces: { minDurationMs: 2000 } } });
    const stream: ProctoringFrameObservation[] = [];
    for (let t = 0; t <= 40_000; t += 4000) stream.push(multiFace(t, 2, 0.1));
    stream.push(oneFace(44_000), oneFace(56_000), oneFace(70_000));
    expect(run(tracker, stream).filter((e) => e.type === 'MULTIPLE_FACES_DETECTED')).toHaveLength(0);
  });

  it('drops a face-absence episode when most frames were sanitized (unreliable channel)', () => {
    const tracker = new EpisodeTracker({ policy: { facePresence: { minAbsentMs: 2000 } } });
    const stream: ProctoringFrameObservation[] = [];
    for (let t = 0; t <= 40_000; t += 4000) {
      // 8 of 11 frames malformed — the detection channel is unreliable.
      stream.push({ ...noFace(t), sanitized: t % 16000 !== 0 });
    }
    stream.push(oneFace(44_000), oneFace(56_000), oneFace(70_000));
    expect(run(tracker, stream).filter((e) => e.type === 'FACE_NOT_DETECTED')).toHaveLength(0);
  });

  it('reduces absence confidence with sanitized frames but keeps a mostly-clean episode', () => {
    const tracker = new EpisodeTracker({ policy: { facePresence: { minAbsentMs: 2000 } } });
    const stream: ProctoringFrameObservation[] = [];
    for (let t = 0; t <= 40_000; t += 4000) stream.push({ ...noFace(t), sanitized: t === 20_000 });
    stream.push(oneFace(44_000), oneFace(56_000), oneFace(70_000));
    const absence = run(tracker, stream).find((e) => e.type === 'FACE_NOT_DETECTED');
    expect(absence).toBeDefined();
    expect(absence!.confidence).toBeLessThan(1);
    expect(absence!.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

describe('EpisodeTracker — technical signals (plan §10.2, §17.5)', () => {
  it('emits deterministic camera/detector episodes without confidence', () => {
    const tracker = new EpisodeTracker();
    tracker.signal('CAMERA_TRACK_ENDED', true, { consecutiveFailures: 3 });
    const released = tracker.signal('CAMERA_TRACK_ENDED', false);
    expect(released).toHaveLength(1);
    expect(released[0].type).toBe('CAMERA_TRACK_ENDED');
    expect(released[0].confidence).toBeUndefined();
    expect((released[0].metadata as Record<string, unknown>).consecutiveFailures).toBe(3);
    expect((released[0].metadata as Record<string, unknown>).detectorTier).toBe('headpose');
  });

  it('emits MODEL_UNAVAILABLE and CAMERA_PERMISSION_REVOKED as plain technical episodes', () => {
    for (const type of ['MODEL_UNAVAILABLE', 'CAMERA_PERMISSION_REVOKED'] as const) {
      const tracker = new EpisodeTracker();
      tracker.signal(type, true);
      const released = tracker.signal(type, false);
      expect(released.map((e) => e.type)).toEqual([type]);
      expect(released[0].confidence).toBeUndefined();
    }
  });

  it('suppresses face episodes while a technical condition is open (§17.5 precedence)', () => {
    const tracker = new EpisodeTracker({ policy: { facePresence: { minAbsentMs: 2000 } } });
    tracker.signal('CAMERA_TRACK_ENDED', true, { consecutiveFailures: 3 });
    const stream: ProctoringFrameObservation[] = [];
    for (let t = 0; t <= 40_000; t += 4000) stream.push(noFace(t));
    stream.push(oneFace(44_000), oneFace(56_000), oneFace(70_000));

    const results = run(tracker, stream);
    results.push(...tracker.signal('CAMERA_TRACK_ENDED', false));

    // The face-absence observation is meaningless while the camera was dead.
    expect(results.filter((e) => e.type === 'FACE_NOT_DETECTED')).toHaveLength(0);
    // The technical episode itself is recorded.
    expect(results.filter((e) => e.type === 'CAMERA_TRACK_ENDED')).toHaveLength(1);
    expect(tracker.hasOpenTechnical).toBe(false);
  });
});

describe('EpisodeTracker — camera-health heuristics (plan §10.2)', () => {
  it('opens CAMERA_FEED_DARK on sustained low luma and applies hysteresis on clear', () => {
    const tracker = new EpisodeTracker();
    const stream: ProctoringFrameObservation[] = [];
    for (let t = 0; t <= 20_000; t += 4000) {
      stream.push(oneFace(t, { meanLuma: DARK_LUMA_FLOOR - 5 }));
    }
    // Below the clear threshold (hysteresis band) — still dark.
    stream.push(oneFace(24_000, { meanLuma: DARK_LUMA_CLEAR - 5 }));
    const before = run(tracker, stream);
    expect(tracker.hasOpenOfType('CAMERA_FEED_DARK')).toBe(true);

    // Above the clear threshold + exit debounce + cooldown → released.
    const all = [
      ...before,
      ...run(tracker, [oneFace(28_000), oneFace(29_500), oneFace(40_000)]),
    ];
    const dark = all.filter((e) => e.type === 'CAMERA_FEED_DARK');
    expect(dark).toHaveLength(1);
    expect((dark[0].metadata as Record<string, unknown>).meanLumaMin).toBe(DARK_LUMA_FLOOR - 5);
    expect(dark[0].confidence).toBeUndefined();
  });

  it('treats null luma as no signal (never dark, never clear)', () => {
    const tracker = new EpisodeTracker();
    const stream: ProctoringFrameObservation[] = [];
    for (let t = 0; t <= 40_000; t += 4000) stream.push(oneFace(t, { meanLuma: null }));
    run(tracker, stream);
    expect(tracker.hasOpenOfType('CAMERA_FEED_DARK')).toBe(false);
  });

  it('opens CAMERA_FEED_FROZEN after 8 identical signatures and clears on change', () => {
    const tracker = new EpisodeTracker();
    const all: Emissions = [];
    for (let i = 0; i < 9; i += 1) {
      tracker.setFrameSignature('frozen-frame-signature');
      all.push(...tracker.observeFrame(oneFace(i * 4000)));
    }
    expect(tracker.hasOpenOfType('CAMERA_FEED_FROZEN')).toBe(true);

    tracker.setFrameSignature('a-different-frame');
    all.push(...tracker.observeFrame(oneFace(40_000)));
    all.push(...tracker.observeFrame(oneFace(52_000)));

    const frozen = all.filter((e) => e.type === 'CAMERA_FEED_FROZEN');
    expect(frozen).toHaveLength(1);
    expect((frozen[0].metadata as Record<string, unknown>).frames).toBeGreaterThanOrEqual(8);
    expect(frozen[0].confidence).toBeUndefined();
  });

  it('does not open FROZEN for an honestly-jittering stream', () => {
    const tracker = new EpisodeTracker();
    for (let i = 0; i < 30; i += 1) {
      tracker.setFrameSignature(`sig-${i % 3}`); // rotating signatures
      tracker.observeFrame(oneFace(i * 4000));
    }
    expect(tracker.hasOpenOfType('CAMERA_FEED_FROZEN')).toBe(false);
  });
});

describe('EpisodeTracker — closeAll (session end)', () => {
  it('closes open episodes immediately, bypassing cooldown', () => {
    const tracker = new EpisodeTracker({ policy: { facePresence: { minAbsentMs: 2000 } } });
    const stream: ProctoringFrameObservation[] = [];
    for (let t = 0; t <= 20_000; t += 4000) stream.push(noFace(t));
    run(tracker, stream);
    const released = tracker.closeAll();
    expect(released.map((e) => e.type)).toEqual(['FACE_NOT_DETECTED']);
    expect(released[0].closedAt).toBeGreaterThanOrEqual(20_000);
  });
});
