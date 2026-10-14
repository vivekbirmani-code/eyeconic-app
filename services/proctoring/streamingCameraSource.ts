/**
 * StreamingCameraSource — the Track 2b frame source for the proctoring engine
 * (plan §43/§43.3: the native MODULE owns the camera; Preview is an optional,
 * non-blocking attachment that is never on the frame path).
 *
 * Phase 3 wiring — this source DRIVES the headless module transport itself:
 * subscribe FIRST, then startProctoringStreaming (the §43.1 lesson: a bind
 * that resolves or fails fast must never outrun its own subscription);
 * pause/resume map to setStreamingPaused (analysis pauses WITHOUT unbinding
 * the camera); stop tears down in the spike screen's proven order —
 * subscription removed, pause flag cleared, then stopStreaming (full native
 * runtime release). A start rejection rides the SAME error taxonomy as
 * onCameraError (code `start_failed`), mirroring the spike screen. Frames run
 * through the SAME classifyFrame sanitizer as the snapshot path — the
 * pipeline downstream (EpisodeTracker → buffer → transport) is untouched, and
 * NO React view sits anywhere on the frame path.
 *
 * The native binding is injectable: node-env unit tests drive the identical
 * lifecycle against a fake, so the real expo-modules-core dependency is
 * resolved LAZILY (first production construction) and never loads in tests.
 */

import { classifyFrame } from '../proctoringSpike/classifyFrame';
import type {
  SpikeEngineStatus,
  SpikeFrameResult,
  SpikeNativeDetectResult,
} from '../proctoringSpike/types';

// ===== The module-binding seam =====

/**
 * The slice of the headless transport this source drives (plan §43.1).
 * One-to-one with startProctoringStreaming / stopProctoringStreaming /
 * setStreamingPaused / subscribeProctoringStreamEvents from
 * `modules/proctoring-spike/src`; injectable so tests fake the whole module.
 */
export interface ProctoringStreamBinding {
  startStreaming(options: { minIntervalMs?: number }): Promise<unknown>;
  stopStreaming(): Promise<void>;
  setStreamingPaused(paused: boolean): void;
  subscribeStreamEvents(handlers: {
    onFrameObservation?: (payload: SpikeNativeDetectResult) => void;
    onCameraError?: (error: { code: string; message: string }) => void;
  }): { remove(): void };
}

type ProctoringSpikeBindingModule = typeof import('../../modules/proctoring-spike/src');

let cachedBindingModule: ProctoringSpikeBindingModule | null = null;

/** Lazy so importing this file never pulls expo-modules-core into node tests. */
const loadBindingModule = (): ProctoringSpikeBindingModule => {
  if (!cachedBindingModule) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../modules/proctoring-spike/src') as ProctoringSpikeBindingModule;
    cachedBindingModule = mod;
  }
  return cachedBindingModule;
};

const createModuleBinding = (): ProctoringStreamBinding => {
  const mod = loadBindingModule();
  return {
    startStreaming: (options) => mod.startProctoringStreaming(options),
    stopStreaming: () => mod.stopProctoringStreaming(),
    setStreamingPaused: (paused) => mod.setProctoringStreamingPaused(paused),
    subscribeStreamEvents: (handlers) => mod.subscribeProctoringStreamEvents(handlers),
  };
};

// ===== The engine-side frame source =====

export interface StreamingCameraSourceOptions {
  onFrame: (frame: SpikeFrameResult) => void;
  onError: (error: Error, consecutiveFailures: number) => void;
  onStatus: (status: SpikeEngineStatus) => void;
  /** Test seam: defaults to the real headless module transport. */
  binding?: ProctoringStreamBinding;
  /** Frame pacing (ms) — 250 mirrors the retired view transport's cadence. */
  minIntervalMs?: number;
}

/** Mirrors CameraLoop's degraded-after threshold (the engine's banner reads it). */
const DEGRADED_AFTER = 3;

export class StreamingCameraSource {
  private readonly options: StreamingCameraSourceOptions;
  private readonly binding: ProctoringStreamBinding;
  private readonly minIntervalMs: number;
  private state: 'stopped' | 'running' | 'paused' = 'stopped';
  private generation = 0;
  private frameIndex = 0;
  private consecutiveFailures = 0;
  private subscription: { remove(): void } | null = null;

  constructor(options: StreamingCameraSourceOptions) {
    this.options = options;
    this.binding = options.binding ?? createModuleBinding();
    this.minIntervalMs = options.minIntervalMs ?? 250;
  }

  get status(): SpikeEngineStatus {
    if (this.state === 'running') {
      return this.consecutiveFailures >= DEGRADED_AFTER ? 'degraded' : 'running';
    }
    return this.state === 'paused' ? 'paused' : 'stopped';
  }

  /**
   * State read through a method so TypeScript cannot narrow it across
   * `await` points — pause()/stop() mutate externally while a start cycle
   * is in flight (same discipline as the engine's currentStatus()).
   */
  private currentState(): 'stopped' | 'running' | 'paused' {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'paused') return;
    this.state = 'running';
    const generation = ++this.generation;
    this.consecutiveFailures = 0;
    this.options.onStatus('running');

    // Subscribe BEFORE start (§43.1): a fast bind can never outrun its own
    // subscription, and the canonical error channel (onCameraError — the
    // native failure of a rejecting start arrives there too) is armed first.
    this.subscription = this.binding.subscribeStreamEvents({
      onFrameObservation: this.handleObservation,
      onCameraError: this.handleError,
    });

    try {
      await this.binding.startStreaming({ minIntervalMs: this.minIntervalMs });
    } catch (error) {
      // The spike screen's proven mapping: the rejection rides the same
      // error taxonomy (the native failure itself also arrives through
      // onCameraError — both are real events; no dedup, no masking).
      const message =
        error instanceof Error ? error.message : String(error ?? 'startStreaming failed');
      this.handleError({ code: 'start_failed', message });
      return;
    }
    if (generation !== this.generation) {
      // stop() won a race against the pending bind: its stopStreaming ran
      // before the camera existed — release the now-bound runtime (idempotent
      // natively; the service is generation-guarded per §43.1).
      this.subscription?.remove();
      this.subscription = null;
      await this.binding.stopStreaming();
      return;
    }
    if (this.currentState() === 'paused') {
      // pause() ran while the bind was in flight — re-assert it natively so
      // the camera can never stream into a source that believes it is paused.
      this.binding.setStreamingPaused(true);
    }
  }

  /** Pause analysis (AppState background) — safe when not running. */
  pause(): void {
    if (this.state === 'stopped' || this.state === 'paused') return;
    this.state = 'paused';
    this.binding.setStreamingPaused(true);
    this.options.onStatus('paused');
  }

  /**
   * Resume analysis. Unlike CameraLoop there is no parked coroutine to
   * restart — the module simply resumes inference (camera stayed bound).
   * Idempotent.
   */
  async resume(): Promise<void> {
    if (this.state === 'running' || this.state === 'stopped') return;
    this.state = 'running';
    this.binding.setStreamingPaused(false);
    this.options.onStatus('running');
  }

  /**
   * Stop — always wins; no further callbacks fire once stop() begins. The
   * spike screen's proven teardown order: drop the subscription, clear the
   * pause flag (the service is process-wide — a stale flag must not leak
   * into the next session), then release the native runtime.
   */
  async stop(): Promise<void> {
    this.generation += 1;
    this.state = 'stopped';
    this.subscription?.remove();
    this.subscription = null;
    this.binding.setStreamingPaused(false);
    this.options.onStatus('stopped');
    try {
      await this.binding.stopStreaming();
    } catch {
      // Release is best-effort at the JS seam — the native service's own
      // lifecycle guarantees the full runtime release (§43.1). A rejected
      // stop must never resurrect callbacks or surface as a student error.
    }
  }

  private handleObservation = (result: SpikeNativeDetectResult) => {
    if (this.state !== 'running') return;
    this.consecutiveFailures = 0;
    this.frameIndex += 1;
    // Same sanitizer + shape as the snapshot path (captureMs ≈ 0 — the frame
    // was never photographed; decodeMs ≈ 0 — no JPEG round-trip).
    this.options.onFrame(classifyFrame(
      { native: result, captureMs: 0 },
      this.frameIndex,
      result.frameTimestampMs ?? Date.now()
    ));
  };

  private handleError = (error: { code: string; message: string }) => {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.consecutiveFailures += 1;
    // detect_failed routes to the detector taxonomy (MODEL_UNAVAILABLE via
    // failureClassifier); camera-side codes stay camera errors so the engine
    // can classify them (permission probe → CAMERA_PERMISSION_REVOKED etc.).
    const isDetectorError = error.code === 'detect_failed';
    const wrapped = new Error(
      isDetectorError ? `ERR_DETECT: ${error.message}` : `ERR_CAMERA_${error.code}: ${error.message}`
    );
    this.options.onError(wrapped, this.consecutiveFailures);
  };
}
