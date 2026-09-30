/**
 * Episode-level scenario tally tests (Phase 0 instrumentation, 2026-09-16).
 * The spike metrics tracker feeds the PRODUCTION EpisodeTracker (read-only,
 * default policy) so scenarios record whether the real debounce logic would
 * raise the mapped episode. These tests pin:
 *   - frame-level vs episode-level metrics are computed independently,
 *   - sustained-but-imperfect multi-face detection (Run-3-like ~75 %/frame)
 *     still opens the production episode,
 *   - scattered transients do NOT open it (that is designed filtering),
 *   - one-face scenarios record false-signal episodes instead of expected
 *     ones, and absence scenarios map to FACE_NOT_DETECTED.
 *
 * Frames are jittered (like a real camera) so the production frozen-feed
 * stasis heuristic never fires and suppresses face episodes via §17.5.
 */

import { SpikeMetricsTracker } from '../proctoringSpike/metricsTracker';
import type { ScenarioRunSummary, SpikeFrameResult, SpikeScenario } from '../proctoringSpike/types';

const scenario = (id: string, expected: SpikeScenario['expectedFaceCountClass']): SpikeScenario => ({
  id,
  label: id,
  expectedFaceCountClass: expected,
});

const C2 = scenario('C_MULTI_FACE_2', 'multiple');
const A = scenario('A_NORMAL_ONE_FACE', 'one');
const B = scenario('B_NO_FACE', 'none');

let jitter = 0;

/** Device-like frame at ~1.55 s spacing with per-frame jitter (anti-stasis). */
const frame = (
  tsMs: number,
  faceCountClass: 'none' | 'one' | 'multiple',
  visibility: SpikeFrameResult['visibility'] =
    faceCountClass === 'none' ? 'none' : faceCountClass === 'multiple' ? 'multiple' : 'ok'
): SpikeFrameResult => {
  jitter += 1;
  const euler = 2 + (jitter % 4) * 0.3;
  return {
    frameIndex: jitter,
    tsMs,
    faceCount: faceCountClass === 'none' ? 0 : faceCountClass === 'one' ? 1 : 2,
    faceCountClass,
    visibility,
    headPose: { band: 'centered', yaw: euler, pitch: 12 + (jitter % 3), roll: 5 },
    landmarkCount: 10,
    qualityProxy: 0.9 + (jitter % 3) * 0.02, // stays above the 0.25 confidence floor
    largestFaceRatio: faceCountClass === 'none' ? null : 0.3 + (jitter % 5) * 0.01,
    latencies: { captureMs: 750, decodeMs: 15, inferenceMs: 190 },
    meanLuma: 120 + (jitter % 5),
    sanitized: false,
  };
};

/** Drives a scenario for `seconds` at ~1.55 s cadence; `classesAt` picks the frame class. */
const runScenario = (
  tracker: SpikeMetricsTracker,
  scen: SpikeScenario,
  seconds: number,
  classesAt: (index: number) => 'none' | 'one' | 'multiple'
): ScenarioRunSummary => {
  tracker.startScenario(scen);
  const step = 1550;
  const frames = Math.floor((seconds * 1000) / step);
  for (let i = 0; i < frames; i += 1) {
    tracker.push(frame(i * step, classesAt(i)));
  }
  const summary = tracker.finishScenario();
  expect(summary).not.toBeNull();
  return summary!;
};

describe('SpikeMetricsTracker — episode-level tally (production EpisodeTracker)', () => {
  it('a sustained two-person scene at ~75 %/frame detection opens the MULTIPLE_FACES episode', () => {
    const tracker = new SpikeMetricsTracker();
    // Run-3-like pattern: 3 of 4 frames detect both faces, scattered misses.
    const summary = runScenario(tracker, C2, 60, (i) => (i % 4 === 3 ? 'one' : 'multiple'));

    // Frame-level: ~75 % — the metric that stays below the 95 % suite threshold.
    expect(summary.frames).toBe(38);
    expect(summary.accuracy).toBeGreaterThanOrEqual(0.7);
    expect(summary.accuracy).toBeLessThan(0.95);
    // Episode-level: the production debounce raised the real episode.
    expect(summary.episodes.expectedEpisodeType).toBe('MULTIPLE_FACES_DETECTED');
    expect(summary.episodes.episodeDetected).toBe(true);
    expect(summary.episodes.episodeOpens.MULTIPLE_FACES_DETECTED).toBeGreaterThanOrEqual(1);
    // Opens within the enter debounce window: the first 3 consecutive
    // detections span ≥3 s → latency lands in the first few seconds.
    expect(summary.episodes.firstOpenLatencyMs).toBeGreaterThanOrEqual(3000);
    expect(summary.episodes.firstOpenLatencyMs).toBeLessThan(10000);
    // No false face-absence episodes during a two-person scene.
    expect(summary.episodes.episodeOpens.FACE_NOT_DETECTED).toBeUndefined();
    expect(summary.episodes.unexpectedEpisodeOpens).toBe(0);
    // Thresholds recorded for auditability.
    expect(summary.episodes.thresholds).toEqual({
      facePresenceMinAbsentMs: 8000,
      multipleFacesMinDurationMs: 3000,
      visibilitySustainMs: 10_000,
    });
  });

  it('scattered transient multi frames do NOT open an episode (designed filtering)', () => {
    const tracker = new SpikeMetricsTracker();
    // Alternating single/multiple — never 2-3 consecutive detections, so the
    // 3 s enter debounce never clears even though ~50 % of frames see two faces.
    const summary = runScenario(tracker, C2, 60, (i) => (i % 2 === 0 ? 'multiple' : 'one'));

    expect(summary.accuracy).toBeCloseTo(0.5, 1); // frame-level sees them
    expect(summary.episodes.episodeDetected).toBe(false); // episodes correctly filter
    expect(summary.episodes.episodeOpens.MULTIPLE_FACES_DETECTED).toBeUndefined();
  });

  it('a clean one-face scenario records zero episodes of any kind', () => {
    const tracker = new SpikeMetricsTracker();
    const summary = runScenario(tracker, A, 60, () => 'one');

    expect(summary.episodes.expectedEpisodeType).toBeNull();
    expect(summary.episodes.episodeDetected).toBeNull();
    expect(summary.episodes.unexpectedEpisodeOpens).toBe(0);
    expect(summary.episodes.episodeOpens).toEqual({});
  });

  it('a sustained empty scene opens the FACE_NOT_DETECTED episode (after the 8 s absence floor)', () => {
    const tracker = new SpikeMetricsTracker();
    const summary = runScenario(tracker, B, 60, () => 'none');

    expect(summary.episodes.expectedEpisodeType).toBe('FACE_NOT_DETECTED');
    expect(summary.episodes.episodeDetected).toBe(true);
    expect(summary.episodes.firstOpenLatencyMs).toBeGreaterThanOrEqual(8000);
    expect(summary.episodes.firstOpenLatencyMs).toBeLessThan(16000);
    expect(summary.episodes.unexpectedEpisodeOpens).toBe(0);
  });

  it('a brief face-loss blip inside a one-face scenario opens nothing', () => {
    const tracker = new SpikeMetricsTracker();
    const summary = runScenario(tracker, A, 60, (i) => (i === 10 || i === 11 ? 'none' : 'one'));

    expect(summary.episodes.unexpectedEpisodeOpens).toBe(0); // 2 frames ≈ 3 s < 8 s floor
    expect(summary.episodes.episodeOpens.FACE_NOT_DETECTED).toBeUndefined();
  });

  it('scenario tallies never mix across scenario boundaries', () => {
    const tracker = new SpikeMetricsTracker();
    const multi = runScenario(tracker, C2, 30, () => 'multiple');
    const clean = runScenario(tracker, A, 30, () => 'one');

    expect(multi.episodes.episodeDetected).toBe(true);
    expect(clean.episodes.episodeOpens).toEqual({});
    expect(clean.episodes.unexpectedEpisodeOpens).toBe(0);
  });
});
