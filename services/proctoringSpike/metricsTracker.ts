/**
 * Phase 0 CV/ML feasibility spike — metrics + scenario tracking (pure).
 * SPIKE ONLY. Keeps rolling performance stats and per-scenario correctness
 * tallies (FP/FN) for the controlled Phase 0 scenario suite. All numbers this
 * module produces describe the CONTROLLED SCENARIO SUITE ONLY — they are not
 * general real-world accuracy claims (plan Step 5).
 *
 * EPISODE-LEVEL TALLY (2026-09-16): alongside the per-frame FP/FN tallies,
 * every frame also feeds the PRODUCTION EpisodeTracker
 * (services/proctoring/episodeTracker.ts, read-only, default policy = the
 * production DEFAULT_PROCTORING_CONFIG thresholds) so each scenario records
 * whether the real debounce/hysteresis/cooldown logic would raise the episode
 * the scenario's integrity concern maps to. Frame-level accuracy and
 * episode-level detection are DIFFERENT acceptance metrics — production
 * stores/judges episodes only (plan §1/§17.1).
 */

import { EpisodeTracker } from '../proctoring/episodeTracker';
import type {
  FaceCountClass,
  ScenarioEpisodeTally,
  ScenarioRunSummary,
  SpikeFaceEpisodeType,
  SpikeFrameResult,
  SpikeMetricsSummary,
  SpikeScenario,
} from './types';

// Production default thresholds this measurement runs with (mirrored from
// backend/utils/proctoring/defaults.js + the client visibility sustain
// default in episodeTracker.ts — hardcoded here so the spike does not modify
// production files to export them).
const PROD_FACE_PRESENCE_MIN_ABSENT_MS = 8000;
const PROD_MULTIPLE_FACES_MIN_DURATION_MS = 3000;
const PROD_VISIBILITY_SUSTAIN_MS = 10_000;

const FACE_EPISODE_TYPES: SpikeFaceEpisodeType[] = [
  'FACE_NOT_DETECTED',
  'FACE_PARTIALLY_VISIBLE',
  'FACE_OUT_OF_FRAME',
  'MULTIPLE_FACES_DETECTED',
];

const expectedEpisodeFor = (expected: FaceCountClass): SpikeFaceEpisodeType | null => {
  if (expected === 'none') return 'FACE_NOT_DETECTED';
  if (expected === 'multiple') return 'MULTIPLE_FACES_DETECTED';
  return null;
};

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

interface RollingWindow {
  frames: SpikeFrameResult[];
  max: number;
}

export class SpikeMetricsTracker {
  private readonly window: RollingWindow;
  private readonly startedAtMs: number;
  private framesSeen = 0;
  private errorsSeen = 0;
  private sanitizedSeen = 0;
  private byClass: Record<FaceCountClass, number> = { none: 0, one: 0, multiple: 0 };
  private lastFrameTs: number | null = null;
  private interFrame: number[] = [];
  private capture: number[] = [];
  private decode: number[] = [];
  private inference: number[] = [];
  private firstFrameTs: number | null = null;
  private lastFrameWallTs: number | null = null;
  private activeScenario: {
    scenario: SpikeScenario;
    frames: number;
    matched: number;
    falsePositives: number;
    falseNegatives: number;
    multiFalsePositives: number;
    // Episode-level tally (production debounce, see module header).
    episodeOpens: Partial<Record<SpikeFaceEpisodeType, number>>;
    firstFrameTsMs: number | null;
    firstExpectedOpenMs: number | null;
    source: 'live' | 'replay';
    replayCadenceMs?: number;
  } | null = null;

  /** PRODUCTION episode logic (read-only) driving the episode-level tally. */
  private readonly episodeTracker = new EpisodeTracker({ policy: {} });

  constructor(windowSize = 120) {
    this.window = { frames: [], max: windowSize };
    this.startedAtMs = Date.now();
  }

  /** Record one classified frame. */
  push(frame: SpikeFrameResult): void {
    this.framesSeen += 1;
    if (frame.sanitized) this.sanitizedSeen += 1;
    this.byClass[frame.faceCountClass] += 1;
    this.window.frames.push(frame);
    if (this.window.frames.length > this.window.max) {
      this.window.frames.shift();
    }
    if (this.lastFrameTs !== null) {
      this.interFrame.push(Math.max(0, frame.tsMs - this.lastFrameTs));
    }
    if (this.firstFrameTs === null) this.firstFrameTs = frame.tsMs;
    this.lastFrameTs = frame.tsMs;
    this.lastFrameWallTs = Date.now();
    this.capture.push(frame.latencies.captureMs);
    this.decode.push(frame.latencies.decodeMs);
    this.inference.push(frame.latencies.inferenceMs);
    this.tallyEpisodes(frame);
    if (this.activeScenario) {
      this.tallyScenarioFrame(frame.faceCountClass);
    }
  }

  /**
   * Feeds the production EpisodeTracker exactly as the production engine does
   * (services/proctoring/engine.ts handleFrame: signature → observeFrame) and
   * counts debounced condition OPENINGS (false→true transitions). Openings
   * that re-enter inside the 10 s cooldown merge into the same stored
   * production episode but still register here as openings — the detection
   * booleans are unaffected by that distinction.
   */
  private tallyEpisodes(frame: SpikeFrameResult): void {
    this.episodeTracker.setFrameSignature(
      [
        frame.faceCount,
        frame.faceCountClass,
        frame.visibility,
        frame.headPose.yaw?.toFixed(1) ?? 'x',
        frame.headPose.pitch?.toFixed(1) ?? 'x',
        frame.headPose.roll?.toFixed(1) ?? 'x',
        frame.qualityProxy.toFixed(3),
        frame.largestFaceRatio?.toFixed(4) ?? 'x',
        frame.meanLuma ?? 'x',
      ].join('|')
    );

    const wasOpen: Record<string, boolean> = {};
    for (const type of FACE_EPISODE_TYPES) {
      wasOpen[type] = this.episodeTracker.hasOpenOfType(type);
    }

    this.episodeTracker.observeFrame({
      tsMs: frame.tsMs,
      faceCount: frame.faceCount,
      faceCountClass: frame.faceCountClass,
      visibility: frame.visibility,
      qualityProxy: frame.qualityProxy,
      largestFaceRatio: frame.largestFaceRatio,
      meanLuma: frame.meanLuma,
      sanitized: frame.sanitized,
    });

    const run = this.activeScenario;
    if (run && run.firstFrameTsMs === null) {
      run.firstFrameTsMs = frame.tsMs; // scenario clock starts at its first frame
    }
    for (const type of FACE_EPISODE_TYPES) {
      if (wasOpen[type] || !this.episodeTracker.hasOpenOfType(type)) continue;
      if (run) {
        run.episodeOpens[type] = (run.episodeOpens[type] ?? 0) + 1;
        const expected = expectedEpisodeFor(run.scenario.expectedFaceCountClass);
        if (type === expected && run.firstExpectedOpenMs === null && run.firstFrameTsMs !== null) {
          run.firstExpectedOpenMs = frame.tsMs - run.firstFrameTsMs;
        }
      }
    }
  }

  /** Record a pipeline error (capture or detection failure). */
  recordError(): void {
    this.errorsSeen += 1;
    if (this.activeScenario) {
      // Pipeline failures are excluded from accuracy tallies (they measure the
      // detector, not the classifier) but noted as frames that produced no data.
      this.activeScenario.frames += 0;
    }
  }

  private tallyScenarioFrame(clazz: FaceCountClass): void {
    if (!this.activeScenario) return;
    const expected = this.activeScenario.scenario.expectedFaceCountClass;
    this.activeScenario.frames += 1;
    if (clazz === expected) {
      this.activeScenario.matched += 1;
      return;
    }
    if (expected === 'none' && clazz !== 'none') {
      this.activeScenario.falsePositives += 1;
      if (clazz === 'multiple') this.activeScenario.multiFalsePositives += 1;
    } else {
      // Expected one/multiple but saw fewer/other → a miss (false negative).
      this.activeScenario.falseNegatives += 1;
    }
  }

  /** Begin a labeled scenario run. Only one scenario is active at a time. */
  startScenario(
    scenario: SpikeScenario,
    options: { source?: 'live' | 'replay'; replayCadenceMs?: number } = {}
  ): void {
    this.finishScenario();
    this.activeScenario = {
      scenario,
      frames: 0,
      matched: 0,
      falsePositives: 0,
      falseNegatives: 0,
      multiFalsePositives: 0,
      episodeOpens: {},
      firstFrameTsMs: null,
      firstExpectedOpenMs: null,
      source: options.source ?? 'live',
      replayCadenceMs: options.source === 'replay' ? options.replayCadenceMs ?? 1800 : undefined,
    };
  }

  /** Finish the active scenario and return its tally (null when none active). */
  finishScenario(): ScenarioRunSummary | null {
    const run = this.activeScenario;
    if (!run) return null;
    this.activeScenario = null;
    return this.summarizeRun(run);
  }

  /** Snapshot the active scenario without finishing it. */
  peekScenario(): ScenarioRunSummary | null {
    const run = this.activeScenario;
    if (!run) return null;
    return this.summarizeRun(run);
  }

  private summarizeRun(run: NonNullable<SpikeMetricsTracker['activeScenario']>): ScenarioRunSummary {
    const expected = expectedEpisodeFor(run.scenario.expectedFaceCountClass);
    const episodes: ScenarioEpisodeTally = {
      thresholds: {
        facePresenceMinAbsentMs: PROD_FACE_PRESENCE_MIN_ABSENT_MS,
        multipleFacesMinDurationMs: PROD_MULTIPLE_FACES_MIN_DURATION_MS,
        visibilitySustainMs: PROD_VISIBILITY_SUSTAIN_MS,
      },
      episodeOpens: { ...run.episodeOpens },
      expectedEpisodeType: expected,
      episodeDetected: expected !== null ? (run.episodeOpens[expected] ?? 0) > 0 : null,
      firstOpenLatencyMs: run.firstExpectedOpenMs,
      unexpectedEpisodeOpens: FACE_EPISODE_TYPES.reduce((count, type) => {
        if (type === expected) return count;
        // For one-face scenarios BOTH absence and multiple are false signals;
        // for none/multiple scenarios the other integrity episode type is.
        return count + (run.episodeOpens[type] ?? 0);
      }, 0),
    };
    return {
      scenarioId: run.scenario.id,
      expected: run.scenario.expectedFaceCountClass,
      frames: run.frames,
      matchedFrames: run.matched,
      falsePositives: run.falsePositives,
      falseNegatives: run.falseNegatives,
      multiFaceFalsePositives: run.multiFalsePositives,
      accuracy: run.frames > 0 ? run.matched / run.frames : null,
      episodes,
      source: run.source,
      ...(run.source === 'replay'
        ? {
            replay: {
              cadenceMs: run.replayCadenceMs ?? 1800,
              frames: run.frames,
              note:
                'SYNTHETIC REPLAY: prerecorded frames through the same ML Kit detector + production EpisodeTracker; timestamps set at device cadence, camera not used.',
            },
          }
        : {}),
    };
  }

  /**
   * Majority classification over the last `n` frames (stability check).
   * Returns null when fewer than n frames exist.
   */
  stableClassification(n: number): FaceCountClass | null {
    if (this.window.frames.length < n) return null;
    const recent = this.window.frames.slice(-n);
    const counts: Record<FaceCountClass, number> = { none: 0, one: 0, multiple: 0 };
    for (const f of recent) counts[f.faceCountClass] += 1;
    const entries = Object.entries(counts) as [FaceCountClass, number][];
    entries.sort((a, b) => b[1] - a[1]);
    // A majority must be unambiguous (> n/2) to count as stable.
    return entries[0][1] > n / 2 ? entries[0][0] : null;
  }

  /** Latest frame result (for the live dashboard). */
  latest(): SpikeFrameResult | null {
    return this.window.frames.length > 0
      ? this.window.frames[this.window.frames.length - 1]
      : null;
  }

  /** Aggregate session metrics. */
  summary(): SpikeMetricsSummary {
    const elapsed =
      this.firstFrameTs !== null && this.lastFrameTs !== null
        ? Math.max(0, this.lastFrameTs - this.firstFrameTs)
        : 0;
    return {
      frames: this.framesSeen,
      errors: this.errorsSeen,
      effectiveFps:
        this.framesSeen > 1 && elapsed > 0 ? ((this.framesSeen - 1) / elapsed) * 1000 : null,
      interFrameMs: { mean: mean(this.interFrame), p95: p95(this.interFrame) },
      latency: {
        captureMs: { mean: mean(this.capture), p95: p95(this.capture) },
        decodeMs: { mean: mean(this.decode), p95: p95(this.decode) },
        inferenceMs: { mean: mean(this.inference), p95: p95(this.inference) },
      },
      byFaceCountClass: { ...this.byClass },
      sanitizedFrames: this.sanitizedSeen,
      uptimeMs: Math.max(0, (this.lastFrameWallTs ?? Date.now()) - this.startedAtMs),
    };
  }
}
