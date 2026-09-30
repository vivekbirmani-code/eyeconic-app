/**
 * StreamingCameraSource — the Track 2 frame source for the proctoring engine
 * (AI Proctoring plan §5.2/§29.1: the snapshot transport was the measured FPS
 * bottleneck; CameraX ImageAnalysis replaces still-photo polling).
 *
 * The native `ProctoringCameraView` (rendered by ProctoringCameraPip) owns the
 * camera and emits sanitized observations; this module is the ENGINE-SIDE half
 * of the pair: it implements the same frame-source contract CameraLoop
 * satisfies (start/pause/resume/stop + onFrame(SpikeFrameResult) +
 * onError/onStatus) by subscribing to the observations through a tiny bus.
 * Frames run through the SAME classifyFrame sanitizer as the snapshot path —
 * the pipeline downstream (EpisodeTracker → buffer → transport) is untouched.
 *
 * Pause semantics mirror CameraLoop's: while paused, incoming observations are
 * dropped (the view is also told to pause analysis — no wasted inference); no
 * stale frame is ever delivered after resume. stop() always wins: no callback
 * fires after stop resolves.
 */

import { classifyFrame } from '../proctoringSpike/classifyFrame';
import type {
  SpikeEngineStatus,
  SpikeFrameResult,
  SpikeNativeDetectResult,
} from '../proctoringSpike/types';

// ===== The bus connecting the React view (producer) to the engine (consumer).
// Module-level by necessity: the view lives in React, the engine does not.

export type ProctoringObservationListener = (result: SpikeNativeDetectResult) => void;
export type ProctoringCameraErrorListener = (error: { code: string; message: string }) => void;

const observationListeners = new Set<ProctoringObservationListener>();
const cameraErrorListeners = new Set<ProctoringCameraErrorListener>();
const pauseListeners = new Set<(paused: boolean) => void>();
let analysisPaused = false;

/** Producer side: the PiP forwards each native observation here. */
export function emitProctoringObservation(result: SpikeNativeDetectResult): void {
  for (const listener of observationListeners) listener(result);
}

/** Producer side: the PiP forwards camera/detector errors here. */
export function emitProctoringCameraError(error: { code: string; message: string }): void {
  for (const listener of cameraErrorListeners) listener(error);
}

/** The view binds its `paused` prop to this subscription. */
export function subscribeProctoringAnalysisPaused(
  listener: (paused: boolean) => void
): () => void {
  pauseListeners.add(listener);
  listener(analysisPaused);
  return () => {
    pauseListeners.delete(listener);
  };
}

const setPaused = (paused: boolean) => {
  analysisPaused = paused;
  for (const listener of pauseListeners) listener(paused);
};

// ===== The engine-side frame source =====

export interface StreamingCameraSourceOptions {
  onFrame: (frame: SpikeFrameResult) => void;
  onError: (error: Error, consecutiveFailures: number) => void;
  onStatus: (status: SpikeEngineStatus) => void;
}

/** Mirrors CameraLoop's degraded-after threshold (the engine's banner reads it). */
const DEGRADED_AFTER = 3;

export class StreamingCameraSource {
  private readonly options: StreamingCameraSourceOptions;
  private state: 'stopped' | 'running' | 'paused' = 'stopped';
  private generation = 0;
  private frameIndex = 0;
  private consecutiveFailures = 0;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeErrors: (() => void) | null = null;

  constructor(options: StreamingCameraSourceOptions) {
    this.options = options;
  }

  get status(): SpikeEngineStatus {
    if (this.state === 'running') {
      return this.consecutiveFailures >= DEGRADED_AFTER ? 'degraded' : 'running';
    }
    return this.state === 'paused' ? 'paused' : 'stopped';
  }

  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'paused') return;
    this.state = 'running';
    this.generation += 1;
    this.consecutiveFailures = 0;
    this.options.onStatus('running');

    this.unsubscribe = () => {
      observationListeners.delete(this.handleObservation);
    };
    observationListeners.add(this.handleObservation);
    this.unsubscribeErrors = () => {
      cameraErrorListeners.delete(this.handleError);
    };
    cameraErrorListeners.add(this.handleError);
  }

  /** Pause analysis (AppState background) — safe when not running. */
  pause(): void {
    if (this.state === 'stopped' || this.state === 'paused') return;
    this.state = 'paused';
    setPaused(true);
    this.options.onStatus('paused');
  }

  /**
   * Resume analysis. Unlike CameraLoop there is no parked coroutine to
   * restart — observations simply start flowing again (the native view is
   * told to resume inference through the bus). Idempotent.
   */
  async resume(): Promise<void> {
    if (this.state === 'running' || this.state === 'stopped') return;
    this.state = 'running';
    setPaused(false);
    this.options.onStatus('running');
  }

  /** Stop — always wins; no further callbacks fire after this. */
  async stop(): Promise<void> {
    this.generation += 1;
    this.state = 'stopped';
    setPaused(false);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeErrors?.();
    this.unsubscribeErrors = null;
    this.options.onStatus('stopped');
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
