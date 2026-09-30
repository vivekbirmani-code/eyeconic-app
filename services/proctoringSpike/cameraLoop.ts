/**
 * Phase 0 CV/ML feasibility spike — camera analysis loop controller.
 * SPIKE ONLY. Drives a sequential capture → detect cycle with:
 *   - graceful failure handling (consecutive-failure backoff + 'degraded' status,
 *     never an unhandled throw),
 *   - pause/resume for app background/foreground transitions,
 *   - stop() that always wins (no further callbacks after stop resolves).
 *
 * The capture and detect functions are injected, which keeps this controller
 * unit-testable with fakes and keeps expo-camera / native bindings at the
 * screen boundary only.
 */

import { classifyFrame, DEFAULT_CLASSIFY_THRESHOLDS } from './classifyFrame';
import type { ClassifyThresholds } from './classifyFrame';
import type {
  SpikeEngineStatus,
  SpikeFrameResult,
  SpikeNativeDetectResult,
  SpikeRawFrame,
} from './types';

export type CameraCapture = () => Promise<{ base64: string | null; captureMs: number }>;
export type FaceDetect = (base64: string) => Promise<SpikeNativeDetectResult>;

export interface CameraLoopOptions {
  capture: CameraCapture;
  detect: FaceDetect;
  onFrame: (frame: SpikeFrameResult) => void;
  onError: (error: Error, consecutiveFailures: number) => void;
  onStatus: (status: SpikeEngineStatus) => void;
  /** Minimum spacing between analysis cycles (ms). 0 = as fast as possible. */
  minIntervalMs?: number;
  /** Consecutive failures before the loop enters 'degraded' (default 3). */
  degradedAfter?: number;
  /** Classifier thresholds (defaults from classifyFrame). */
  thresholds?: ClassifyThresholds;
  /** Max analysis dimension passed through to the native module. */
  maxDim?: number;
  /** Injectable clock/sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_DEGRADED_AFTER = 3;

export class CameraLoop {
  private readonly options: Required<Pick<CameraLoopOptions, 'minIntervalMs' | 'degradedAfter'>> &
    CameraLoopOptions;
  private state: 'stopped' | 'running' | 'paused' = 'stopped';
  private generation = 0;
  private frameIndex = 0;
  private consecutiveFailures = 0;

  constructor(options: CameraLoopOptions) {
    this.options = {
      minIntervalMs: options.minIntervalMs ?? 0,
      degradedAfter: options.degradedAfter ?? DEFAULT_DEGRADED_AFTER,
      ...options,
    };
  }

  get status(): SpikeEngineStatus {
    if (this.state === 'running') {
      return this.consecutiveFailures >= this.options.degradedAfter ? 'degraded' : 'running';
    }
    return this.state === 'paused' ? 'paused' : 'stopped';
  }

  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'paused') return;
    this.state = 'running';
    this.consecutiveFailures = 0;
    this.generation += 1;
    const generation = this.generation;
    this.options.onStatus('running');
    await this.runLoop(generation);
  }

  /** Pause the loop (e.g. AppState went background). Safe when not running. */
  pause(): void {
    if (this.state === 'running') {
      this.state = 'paused';
      this.options.onStatus('paused');
    }
  }

  /** Resume a paused loop. Safe when not paused. */
  resume(): void {
    if (this.state === 'paused') {
      this.state = 'running';
      this.consecutiveFailures = 0;
      this.options.onStatus('running');
      // NOTE: do NOT spawn a new runLoop here. The paused loop is still
      // alive, parked in its 100 ms sleep inside runLoop — it observes the
      // state change and resumes on its own. Spawning a second loop would
      // run TWO concurrent capture cycles per pause/resume (the parked one
      // never exits; only stop() bumps the generation), inflating the very
      // FPS/latency metrics the Phase 0 runbook measures.
    }
  }

  stop(): void {
    this.generation += 1; // invalidate any in-flight loop
    this.state = 'stopped';
    this.options.onStatus('stopped');
  }

  /**
   * State read through a method so TypeScript cannot narrow it across `await`
   * points — `stop()`/`pause()` mutate `this.state` externally while a cycle is
   * in flight, which the compiler's control-flow analysis cannot see.
   */
  private currentState(): 'stopped' | 'running' | 'paused' {
    return this.state;
  }

  private async runLoop(generation: number): Promise<void> {
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    while (this.currentState() !== 'stopped' && generation === this.generation) {
      if (this.currentState() === 'paused') {
        // Wait until resumed or stopped; sleep in small steps so state changes
        // are noticed promptly.
        await sleep(100);
        continue;
      }
      const cycleStart = Date.now();
      try {
        const { base64, captureMs } = await this.options.capture();
        if (!base64) {
          throw new Error('Camera returned no image payload');
        }
        if (this.currentState() === 'stopped' || generation !== this.generation) return;
        const native = await this.options.detect(base64);
        if (this.currentState() === 'stopped' || generation !== this.generation) return;
        this.consecutiveFailures = 0;
        const raw: SpikeRawFrame = { captureMs, native };
        const frame = classifyFrame(
          raw,
          this.frameIndex++,
          Date.now(),
          this.options.thresholds ?? DEFAULT_CLASSIFY_THRESHOLDS
        );
        this.options.onFrame(frame);
        if (this.status === 'degraded') {
          this.options.onStatus('running');
        }
      } catch (error) {
        if (this.currentState() === 'stopped' || generation !== this.generation) return;
        this.consecutiveFailures += 1;
        const err = error instanceof Error ? error : new Error(String(error));
        this.options.onError(err, this.consecutiveFailures);
        if (
          this.currentState() === 'running' &&
          this.consecutiveFailures === this.options.degradedAfter
        ) {
          this.options.onStatus('degraded');
        }
      }
      const elapsed = Date.now() - cycleStart;
      const wait = Math.max(1, this.options.minIntervalMs - elapsed);
      // Always yield at least once per cycle (min 1ms) so the event loop and
      // AppState/stop() callbacks are serviced even in "as fast as possible" mode.
      await sleep(wait);
    }
  }
}
