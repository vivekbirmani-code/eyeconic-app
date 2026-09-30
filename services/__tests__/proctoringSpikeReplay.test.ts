/**
 * Replay harness tests (Phase 0 synthetic validation tooling, 2026-09-16).
 * Pins the contract the on-device replay depends on: the SAME frame-level and
 * episode-level metrics as a live scenario, synthetic device-cadence
 * timestamps, explicit source labeling (never conflatable with live data),
 * and ≥60 s equivalence at the default cadence.
 */

import { runScenarioReplay, REPLAY_CADENCE_MS, REPLAY_MIN_FRAMES_60S } from '../proctoringSpike/replay';
import type {
  SpikeNativeDetectResult,
  SpikeScenario,
} from '../proctoringSpike/types';

const C2: SpikeScenario = { id: 'C_MULTI_FACE_2', label: 'C', expectedFaceCountClass: 'multiple' };

let jitter = 0;

/** Native-result fake mirroring the real module's shape (multi/one faces). */
const nativeWithFaces = (faceCount: 0 | 1 | 2): SpikeNativeDetectResult => {
  jitter += 1;
  const face = (left: number) => ({
    box: { left, top: 100, right: left + 220, bottom: 380 },
    eulerX: 2, eulerY: 3 + (jitter % 4) * 0.4, eulerZ: 1, trackingId: 1,
    leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9, smilingProbability: 0.1,
    landmarks: {
      leftEye: { x: 1, y: 1 }, rightEye: { x: 2, y: 2 }, noseBase: { x: 3, y: 3 },
      mouthLeft: { x: 4, y: 4 }, mouthRight: { x: 5, y: 5 },
    },
  });
  return {
    tier: 'test', imageWidth: 640, imageHeight: 480, faceCount,
    faces: faceCount === 0 ? [] : faceCount === 1 ? [face(200)] : [face(200), face(60)],
    decodeMs: 15, inferenceMs: 190, totalNativeMs: 205,
    meanLuma: 120 + (jitter % 5),
  };
};

/** Fake detector following a per-frame script (Run-3-like ~75 % multi recall). */
const scriptedDetect = (classesAt: (i: number) => 0 | 1 | 2) => async (_b64: string) =>
  nativeWithFaces(classesAt(Math.floor(jitter / 2)));

describe('runScenarioReplay (synthetic validation harness)', () => {
  it('produces live-equivalent frame + episode metrics, labeled source "replay"', async () => {
    const frames = Array.from({ length: 40 }, () => 'ZHVtbXk='); // 40 × 1.8 s = 72 s
    const result = await runScenarioReplay({
      scenario: C2,
      base64Frames: frames,
      // 3 of 4 frames see both faces — the measured Run-3 pattern.
      detect: scriptedDetect((i) => (i % 4 === 3 ? 1 : 2)),
    });

    expect(result.summary.source).toBe('replay');
    expect(result.summary.replay).toMatchObject({
      cadenceMs: REPLAY_CADENCE_MS,
      frames: 40,
    });
    expect(result.summary.replay!.note).toMatch(/SYNTHETIC REPLAY/);
    // Frame-level: ~75 % — below the 95 % criterion, reported as-is.
    expect(result.summary.frames).toBe(40);
    expect(result.summary.accuracy).toBeGreaterThanOrEqual(0.7);
    expect(result.summary.accuracy).toBeLessThan(0.95);
    // Episode-level: the production debounce raised the episode.
    expect(result.summary.episodes.expectedEpisodeType).toBe('MULTIPLE_FACES_DETECTED');
    expect(result.summary.episodes.episodeDetected).toBe(true);
    expect(result.summary.episodes.episodeOpens.MULTIPLE_FACES_DETECTED).toBeGreaterThanOrEqual(1);
    expect(result.summary.episodes.firstOpenLatencyMs).toBeGreaterThanOrEqual(3000);
    expect(result.summary.episodes.unexpectedEpisodeOpens).toBe(0);
  });

  it('uses synthetic device-cadence timestamps (session inter-frame ≈ cadence)', async () => {
    const result = await runScenarioReplay({
      scenario: C2,
      base64Frames: Array.from({ length: 10 }, () => 'ZHVtbXk='),
      detect: scriptedDetect(() => 2),
    });
    expect(result.session.interFrameMs.mean).toBe(REPLAY_CADENCE_MS);
    expect(result.frames[3].tsMs).toBe(3 * REPLAY_CADENCE_MS);
  });

  it('does NOT open an episode for scattered transient multi frames', async () => {
    const result = await runScenarioReplay({
      scenario: C2,
      base64Frames: Array.from({ length: 40 }, () => 'ZHVtbXk='),
      detect: scriptedDetect((i) => (i % 2 === 0 ? 2 : 1)), // alternating — never sustained
    });
    expect(result.summary.accuracy).toBeCloseTo(0.5, 1);
    expect(result.summary.episodes.episodeDetected).toBe(false);
  });

  it('supports a custom cadence and reports progress', async () => {
    let lastProgress = { done: 0, total: 0 };
    const result = await runScenarioReplay({
      scenario: C2,
      base64Frames: Array.from({ length: 5 }, () => 'ZHVtbXk='),
      cadenceMs: 1000,
      detect: scriptedDetect(() => 2),
      onProgress: (done, total) => { lastProgress = { done, total }; },
    });
    expect(lastProgress).toEqual({ done: 5, total: 5 });
    expect(result.summary.replay!.cadenceMs).toBe(1000);
    expect(result.frames[4].tsMs).toBe(4000);
  });

  it('≥60 s equivalence needs at least 34 frames at the default cadence', () => {
    expect(REPLAY_MIN_FRAMES_60S).toBe(34);
    expect(REPLAY_MIN_FRAMES_60S * REPLAY_CADENCE_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('throws on empty footage (never fabricates a summary)', async () => {
    await expect(
      runScenarioReplay({ scenario: C2, base64Frames: [], detect: scriptedDetect(() => 2) })
    ).rejects.toThrow(/footage is empty/);
  });
});
