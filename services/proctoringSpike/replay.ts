/**
 * Phase 0 spike — SCENARIO REPLAY HARNESS (pure). SPIKE ONLY.
 *
 * Runs prerecorded JPEG frames through the EXACT same pipeline as a live
 * scenario: the same native ML Kit detector call, the same classifyFrame
 * sanitization/classification, the same SpikeMetricsTracker per-frame +
 * episode-level tallies (which feed the production EpisodeTracker). The ONLY
 * differences from live capture: no camera (frames arrive as base64 strings)
 * and frame timestamps are SYNTHETIC — frame i gets tsMs = i × cadenceMs,
 * where cadenceMs defaults to the measured OnePlus Nord inter-frame time.
 *
 * Everything it produces is labeled `source: 'replay'` (synthetic validation)
 * and is reported SEPARATELY from live measurements — it validates the
 * detector + episode behavior on controlled footage, it does not substitute
 * for the live scenario data already recorded in the Phase 0 report.
 *
 * Pure module: the detector call is INJECTED so jest can drive it with fakes
 * (the native binding import would break the node environment).
 */

import { classifyFrame } from './classifyFrame';
import { SpikeMetricsTracker } from './metricsTracker';
import type {
  ScenarioRunSummary,
  SpikeFrameResult,
  SpikeMetricsSummary,
  SpikeNativeDetectResult,
  SpikeScenario,
} from './types';

/** Default synthetic cadence: measured Nord inter-frame mean (runs 1–3: 1296–1905 ms). */
export const REPLAY_CADENCE_MS = 1800;

/** Minimum frames for a ≥60 s equivalent replay at the default cadence. */
export const REPLAY_MIN_FRAMES_60S = Math.ceil(60_000 / REPLAY_CADENCE_MS);

export type ReplayDetect = (
  base64Jpeg: string,
  maxDim: number
) => Promise<SpikeNativeDetectResult>;

export interface ReplayOptions {
  scenario: SpikeScenario;
  /** base64 JPEG frames, in playback order (no data: prefix needed — the native side strips it). */
  base64Frames: string[];
  cadenceMs?: number;
  maxDim?: number;
  /** The real native detector call (injected; nativeDetectFaces at the screen). */
  detect: ReplayDetect;
  onProgress?: (done: number, total: number) => void;
}

export interface ReplayRunResult {
  summary: ScenarioRunSummary;
  session: SpikeMetricsSummary;
  frames: SpikeFrameResult[];
}

/**
 * Replays the footage and returns the SAME summary shape a live scenario
 * produces (frame-level FP/FN + episode-level tally), plus the session
 * metrics and the classified frames for debugging.
 */
export async function runScenarioReplay(options: ReplayOptions): Promise<ReplayRunResult> {
  const {
    scenario,
    base64Frames,
    cadenceMs = REPLAY_CADENCE_MS,
    maxDim = 640,
    detect,
    onProgress,
  } = options;

  if (base64Frames.length === 0) {
    throw new Error('Replay footage is empty — generate frames with scripts/make-spike-replay.mjs first');
  }

  const tracker = new SpikeMetricsTracker();
  tracker.startScenario(scenario, { source: 'replay', replayCadenceMs: cadenceMs });

  const frames: SpikeFrameResult[] = [];
  for (let i = 0; i < base64Frames.length; i += 1) {
    const native = await detect(base64Frames[i], maxDim);
    const frame = classifyFrame({ captureMs: 0, native }, i, i * cadenceMs);
    frames.push(frame);
    tracker.push(frame);
    onProgress?.(i + 1, base64Frames.length);
  }

  const summary = tracker.finishScenario();
  if (!summary) {
    throw new Error('Replay produced no scenario summary (empty footage?)');
  }
  return { summary, session: tracker.summary(), frames };
}
