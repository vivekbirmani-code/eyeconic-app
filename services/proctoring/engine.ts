/**
 * ProctoringEngine — the production runtime camera-analysis orchestrator
 * (Phase 3, plan §6.3, §10.1, §23). ONE instance per attempt; everything
 * native/expo lives behind injected functions so this module is fully
 * unit-testable in the root ts-jest (node) environment.
 *
 * Pipeline: capture (paced snapshots) → Tier A detector (Phase 2 boundary)
 *   → EpisodeTracker (debounce/hysteresis/cooldown — episodes, never frames)
 *   → ProctoringEventBuffer (batched, idempotent, retrying transport)
 *   → POST /quizzes/:id/attempt/:attemptId/proctoring/events (+ heartbeat).
 *
 * Lifecycle (§10.1): idle → starting → monitoring ⇄ degraded ⇄ paused → stopped.
 * Failure doctrine: technical problems DEGRADE the session, they never block
 * the quiz and never crash the app (§23). The engine produces observations
 * only — every decision stays server-side (§24).
 *
 * The capture/detect loop reuses the Phase 0 spike's CameraLoop unchanged
 * (sequential pacing, failure tolerance, pause/resume/stop semantics — the
 * same machinery detector.ts already reuses for classification).
 */

import { CameraLoop } from '../proctoringSpike/cameraLoop';
import type { SpikeFrameResult, SpikeNativeDetectResult } from '../proctoringSpike/types';
import { isDetectorFailureError } from './failureClassifier';
import { EpisodeTracker } from './episodeTracker';
import type { ProctoringSignalType } from './episodeTracker';
import { ProctoringEventBuffer } from './eventBuffer';
import type { EventBufferStorage, QueuedProctoringEvent } from './eventBuffer';
import type {
  ProctoringEngineStatus,
  ProctoringEpisodeEvent,
  ProctoringEventType,
  ProctoringPolicy,
  ProctoringSendOutcome,
} from './types';

/** Batch bound mirrored from the server envelope cap (eventIngest.js). */
const SERVER_BATCH_MAX_EVENTS = 50;

/** Consecutive failures before a technical condition is signaled (§10.2). */
const FAILURE_THRESHOLD = 3;

/** Batches sent per flush call (bounds work per heartbeat tick). */
const MAX_BATCHES_PER_FLUSH = 5;

/**
 * Transport `source` per event type — mirrors the server registry's
 * per-type source lists (backend utils/proctoring/eventRegistry.js). The
 * server rejects an event whose source is not registered for its type, so
 * the engine — the single place client events are shaped for the wire —
 * stamps it here. Integrity events emitted on native (APP_BACKGROUND,
 * EXIT_ATTEMPTED) are 'os'; TAB_HIDDEN/WINDOW_BLUR ('browser') arrive
 * server-side via the legacy dual-write and are never client-emitted.
 */
type EventSourceValue = 'cv' | 'os' | 'system';
const EVENT_SOURCE_BY_TYPE: Record<ProctoringEventType, EventSourceValue> = {
  SESSION_STARTED: 'system',
  SESSION_RESUMED: 'system',
  SESSION_DEGRADED: 'system',
  MODEL_UNAVAILABLE: 'cv',
  CAMERA_UNAVAILABLE: 'cv',
  CAMERA_PERMISSION_REVOKED: 'cv',
  CAMERA_TRACK_ENDED: 'cv',
  CAMERA_FEED_DARK: 'cv',
  CAMERA_FEED_FROZEN: 'cv',
  FACE_NOT_DETECTED: 'cv',
  FACE_PARTIALLY_VISIBLE: 'cv',
  FACE_OUT_OF_FRAME: 'cv',
  MULTIPLE_FACES_DETECTED: 'cv',
  APP_BACKGROUND: 'os',
  EXIT_ATTEMPTED: 'os',
};

/**
 * Analysis pacing. PROVISIONAL and deliberately conservative: the only
 * measured end-to-end frame cost so far (Phase 0 partial data: capture ~830ms
 * + decode ~15ms + inference ~195ms) caps the snapshot transport below 1 fps
 * on that device. The measured device floor from the pending Phase 0 runbook
 * (report §24) replaces this constant — no production accuracy/perf claims
 * are made until then.
 */
const PROVISIONAL_ANALYSIS_INTERVAL_MS = 4000;

export type ProctoringCameraIssue =
  | null
  | 'camera-startup'
  | 'camera-error'
  | 'permission'
  | 'model'
  | 'dark'
  | 'frozen';

export interface ProctoringEngineState {
  status: ProctoringEngineStatus;
  cameraIssue: ProctoringCameraIssue;
}

export interface ProctoringBatchPayloadEvent {
  idempotencyKey: string;
  clientSeq: number;
  type: ProctoringEventType;
  /** Registry source for the type — required by server-side validation. */
  source: EventSourceValue;
  openedAt: number;
  closedAt?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface ProctoringBatchPayload {
  sessionId: string;
  seq?: number;
  heartbeat: boolean;
  bufferOverflow: number;
  events: ProctoringBatchPayloadEvent[];
}

export interface ProctoringEngineOptions {
  session: { quizId: string; attemptId: string; sessionId: string };
  policy?: ProctoringPolicy;
  /** Camera capture (expo-camera snapshot) — returns null base64 on failure. */
  capture: () => Promise<{ base64: string | null }>;
  /** Raw detector call (native ML Kit binding via the Phase 2 boundary). */
  detectRaw: (base64: string) => Promise<SpikeNativeDetectResult>;
  /** Batched transport to the server events endpoint. */
  transport: (payload: ProctoringBatchPayload) => Promise<ProctoringSendOutcome>;
  storage?: EventBufferStorage;
  /** Camera permission probe used to classify capture failures. */
  checkPermission?: () => Promise<boolean>;
  detectorTier?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  analysisIntervalMs?: number;
  /** Test seam: per-type episode threshold overrides (tracker option). */
  episodeThresholdOverrides?: Record<string, Record<string, number>>;
  /** <= 0 disables the heartbeat timer (tests drive heartbeatTick manually). */
  heartbeatIntervalMs?: number;
  /**
   * Screen-capture deterrence applied for this attempt (§15.2, Phase 4) —
   * reported inside SESSION_STARTED/RESUMED metadata for server-side
   * set-once review-context stamping. Never policy, never a client-asserted
   * session state.
   */
  deterrence?: string;
  onStateChange?: (state: ProctoringEngineState) => void;
}

export class ProctoringEngine {
  private readonly options: ProctoringEngineOptions;
  private readonly tracker: EpisodeTracker;
  private readonly buffer: ProctoringEventBuffer;
  private readonly loop: CameraLoop;
  private readonly now: () => number;

  private engineState: ProctoringEngineState = { status: 'idle', cameraIssue: null };
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private flushInFlight = false;
  private stopPromise: Promise<void> | null = null;
  /** Failure-driven technical signals currently open (recovery closes them). */
  private openFailureSignals = new Set<string>();
  private everProducedFrame = false;
  /** Backgrounding arrived while the loop was still starting. */
  private pausePending = false;

  constructor(options: ProctoringEngineOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.tracker = new EpisodeTracker({
      policy: options.policy,
      detectorTier: options.detectorTier,
      now: this.now,
      thresholdOverrides: options.episodeThresholdOverrides,
    });
    this.buffer = new ProctoringEventBuffer({ storage: options.storage });
    this.loop = new CameraLoop({
      capture: async () => {
        const captured = await options.capture();
        return { base64: captured.base64, captureMs: 0 };
      },
      detect: options.detectRaw,
      onFrame: (frame) => this.handleFrame(frame),
      onError: (error, consecutive) => this.handleLoopError(error, consecutive),
      onStatus: () => this.recomputeState(),
      minIntervalMs: options.analysisIntervalMs ?? PROVISIONAL_ANALYSIS_INTERVAL_MS,
      degradedAfter: FAILURE_THRESHOLD,
      maxDim: 640,
      sleep: options.sleep,
    });
  }

  get state(): ProctoringEngineState {
    return this.engineState;
  }

  /**
   * Status read through a method so TypeScript cannot narrow it across
   * `await` points — stop()/pause() mutate the state externally while a
   * start cycle is in flight (same discipline as the spike CameraLoop).
   */
  private currentStatus(): ProctoringEngineStatus {
    return this.engineState.status;
  }

  /**
   * Arms the engine for the attempt. `resumed: true` marks a re-arm after
   * app restart/crash (SESSION_RESUMED instead of SESSION_STARTED, §17.6).
   * Idempotent: a second call while active is a no-op (no duplicate loops,
   * no duplicate session events — one engine instance per attempt).
   */
  async start({ resumed = false }: { resumed?: boolean } = {}): Promise<void> {
    if (this.engineState.status !== 'idle') return;
    this.setState({ status: 'starting', cameraIssue: null });

    await this.buffer.restore();
    if (this.currentStatus() === 'stopped') return; // stop() won mid-start
    this.emitEpisode({
      type: resumed ? 'SESSION_RESUMED' : 'SESSION_STARTED',
      openedAt: this.now(),
      closedAt: this.now(),
      metadata: {
        detectorTier: this.options.detectorTier ?? 'headpose',
        analysisIntervalMs: this.options.analysisIntervalMs ?? PROVISIONAL_ANALYSIS_INTERVAL_MS,
        ...(this.options.deterrence ? { screenCapturePrevention: this.options.deterrence } : {}),
      },
    });

    this.startHeartbeat();
    void this.flush();
    // Fire-and-forget, exactly like the spike screen: runLoop only returns on
    // stop(), and loop.onStatus('running') fires synchronously inside start()
    // (driving recomputeState to 'monitoring'/'degraded').
    void this.loop.start();
    if (this.currentStatus() === 'stopped') return;
    if (this.pausePending) {
      this.pausePending = false;
      this.stopHeartbeat();
      this.loop.pause();
      this.setState({ status: 'paused', cameraIssue: this.engineState.cameraIssue });
      return;
    }
    this.setState({ status: this.engineState.cameraIssue ? 'degraded' : 'monitoring', cameraIssue: this.engineState.cameraIssue });
  }

  /** App backgrounded: pause analysis + heartbeat cleanly (no stale frames). */
  pause(): void {
    if (this.engineState.status === 'stopped' || this.engineState.status === 'paused') return;
    if (this.engineState.status === 'starting') {
      // Loop not live yet — honor the pause the moment it is.
      this.pausePending = true;
      return;
    }
    this.stopHeartbeat();
    this.loop.pause();
    this.setState({ ...this.engineState, status: 'paused' });
  }

  /** App foregrounded again: resume safely from live state. */
  resume(): void {
    this.pausePending = false;
    if (this.engineState.status !== 'paused') return;
    this.loop.resume();
    this.startHeartbeat();
    this.setState({ ...this.engineState, status: this.engineState.cameraIssue ? 'degraded' : 'monitoring' });
  }

  /**
   * Enqueues externally produced (non-camera) episodes — Phase 4 focus/
   * integrity signals (APP_BACKGROUND, EXIT_ATTEMPTED). Same path as camera
   * episodes: buffer → persist → best-effort flush. A PAUSED engine keeps them
   * queued (persisted) until resume (§23) — a backgrounded app cannot flush,
   * by design; no-op once stopped.
   */
  recordEpisodes(episodes: ProctoringEpisodeEvent[]): void {
    if (this.engineState.status === 'stopped' || episodes.length === 0) return;
    for (const episode of episodes) {
      this.emitEpisode(episode);
    }
    void this.buffer.persist();
    void this.flush();
  }

  /**
   * Session end (submit/finalize/unmount): closes every open episode, flushes
   * the buffer best-effort, releases timers. Always safe to call; always wins
   * (no further transport after it settles, mirroring CameraLoop.stop()).
   */
  async stop(): Promise<void> {
    if (this.engineState.status === 'stopped') return this.stopPromise ?? Promise.resolve();
    if (!this.stopPromise) {
      this.stopPromise = this.doStop();
    }
    return this.stopPromise;
  }

  private async doStop(): Promise<void> {
    this.loop.stop();
    this.stopHeartbeat();
    const episodes = this.tracker.closeAll();
    for (const episode of episodes) {
      this.emitEpisode(episode);
    }
    this.openFailureSignals.clear();
    try {
      await this.flush();
    } catch {
      // Best-effort by design (plan §23): persisted events retry on the next
      // engine arm; a failed final flush must never surface to the student.
    }
    this.setState({ status: 'stopped', cameraIssue: null });
  }

  /** One heartbeat cycle — also the piggyback flush driver. */
  async heartbeatTick(): Promise<void> {
    if (this.engineState.status === 'stopped') return;
    if (this.buffer.size > 0) {
      await this.flush();
      return;
    }
    // Standalone heartbeat: proof of client participation only — a health
    // signal, never an honesty claim (plan §16.1).
    const dropped = this.buffer.consumeOverflow();
    const outcome = await this.options.transport({
      sessionId: this.options.session.sessionId,
      heartbeat: true,
      bufferOverflow: dropped,
      events: [],
    });
    if (outcome.kind === 'session_closed') {
      await this.handleSessionClosed();
    }
  }

  get bufferedEventCount(): number {
    return this.buffer.size;
  }

  // ---- internals ----------------------------------------------------------

  private handleFrame(frame: SpikeFrameResult): void {
    if (this.engineState.status === 'stopped' || this.engineState.status === 'paused') {
      return; // stale frame (captured just before pause/stop) — never processed
    }
    this.everProducedFrame = true;

    // Recovery: one good frame closes every failure-driven technical episode
    // (camera re-acquired, detector answering again — §20.4/§23 recovery).
    if (this.openFailureSignals.size > 0) {
      for (const type of [...this.openFailureSignals]) {
        this.emitEpisodes(this.tracker.signal(type as ProctoringSignalType, false));
      }
      this.openFailureSignals.clear();
      this.recomputeState();
    }

    // Frozen-feed signature over the sanitized result (rounded — a real
    // camera's float outputs jitter; a frozen stream repeats exactly).
    this.tracker.setFrameSignature(
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

    const episodes = this.tracker.observeFrame({
      tsMs: frame.tsMs,
      faceCount: frame.faceCount,
      faceCountClass: frame.faceCountClass,
      visibility: frame.visibility,
      qualityProxy: frame.qualityProxy,
      largestFaceRatio: frame.largestFaceRatio,
      meanLuma: frame.meanLuma,
      sanitized: frame.sanitized,
    });
    this.emitEpisodes(episodes);
    this.recomputeState();
  }

  private handleLoopError(error: Error, consecutiveFailures: number): void {
    if (this.engineState.status === 'stopped') return;
    if (consecutiveFailures < FAILURE_THRESHOLD) return; // transient — §20.4 silent grace

    // Detector-side failures (module absent / ML Kit error) vs capture-side —
    // the shared classifier lives at the detector boundary (detector.ts).
    if (isDetectorFailureError(error)) {
      this.openTechnical('MODEL_UNAVAILABLE', { consecutiveFailures });
      return;
    }

    // Capture side: classify by permission probe, then by whether the camera
    // EVER produced frames (startup acquisition vs mid-run loss) — §10.2.
    const probe = this.options.checkPermission
      ? Promise.resolve(this.options.checkPermission()).catch(() => true)
      : Promise.resolve(true);
    void probe.then((granted) => {
      if (this.engineState.status === 'stopped') return;
      if (!granted) {
        this.openTechnical('CAMERA_PERMISSION_REVOKED', { consecutiveFailures });
      } else if (!this.everProducedFrame) {
        this.openTechnical('CAMERA_UNAVAILABLE', { consecutiveFailures });
      } else {
        this.openTechnical('CAMERA_TRACK_ENDED', { consecutiveFailures });
      }
    });
  }

  private openTechnical(type: ProctoringSignalType, meta: Record<string, number>): void {
    if (this.openFailureSignals.has(type)) return; // already open — no spam
    this.openFailureSignals.add(type);
    this.emitEpisodes(this.tracker.signal(type, true, meta));
    this.recomputeState();
  }

  private emitEpisodes(episodes: ProctoringEpisodeEvent[]): void {
    if (episodes.length === 0) return;
    for (const episode of episodes) {
      this.emitEpisode(episode);
    }
    void this.buffer.persist();
    void this.flush();
  }

  private emitEpisode(episode: ProctoringEpisodeEvent): void {
    this.buffer.enqueue(episode);
  }

  /** Sends queued episodes in order; retries happen on the next tick. */
  private async flush(): Promise<void> {
    if (this.flushInFlight) return;
    if (this.engineState.status === 'stopped' && this.buffer.size === 0) return;
    this.flushInFlight = true;
    try {
      for (let i = 0; i < MAX_BATCHES_PER_FLUSH; i += 1) {
        const batch = this.buffer.takeBatch(SERVER_BATCH_MAX_EVENTS);
        if (batch.length === 0) break;

        const dropped = this.buffer.consumeOverflow();
        const payload: ProctoringBatchPayload = {
          sessionId: this.options.session.sessionId,
          seq: batch[batch.length - 1].clientSeq,
          heartbeat: true, // every batch piggybacks the heartbeat (§16.2)
          bufferOverflow: dropped,
          events: batch.map((e) => this.toWireEvent(e)),
        };

        const outcome = await this.options.transport(payload);
        if (outcome.kind === 'session_closed') {
          await this.handleSessionClosed();
          return;
        }
        if (outcome.kind === 'retryable') {
          // Network/5xx/429: leave the batch queued — the next heartbeat tick
          // retries it in clientSeq order (plan §23).
          break;
        }
        // accepted (duplicates are server-side no-ops) or permanent_reject
        // (malformed data — client bug or probe): acknowledge, never retry.
        await this.buffer.ack(batch);
        if (this.buffer.size === 0) break;
      }
    } finally {
      this.flushInFlight = false;
    }
  }

  private toWireEvent(event: QueuedProctoringEvent): ProctoringBatchPayloadEvent {
    return {
      idempotencyKey: event.idempotencyKey,
      clientSeq: event.clientSeq,
      type: event.type,
      source: EVENT_SOURCE_BY_TYPE[event.type] ?? 'cv',
      openedAt: event.openedAt,
      ...(event.closedAt !== undefined ? { closedAt: event.closedAt } : {}),
      ...(event.confidence !== undefined ? { confidence: event.confidence } : {}),
      ...(event.metadata ? { metadata: event.metadata } : {}),
    };
  }

  /** The server says the attempt/session is finalized — wind everything down. */
  private async handleSessionClosed(): Promise<void> {
    await this.buffer.reset();
    this.loop.stop();
    this.stopHeartbeat();
    this.setState({ status: 'stopped', cameraIssue: null });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const intervalMs = this.options.heartbeatIntervalMs
      ?? this.options.policy?.sessionHealth?.heartbeatIntervalMs
      ?? 30000;
    if (intervalMs <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeatTick();
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private recomputeState(): void {
    if (this.engineState.status === 'stopped') return;
    const issue = this.currentIssue();
    const status: ProctoringEngineStatus =
      this.engineState.status === 'paused'
        ? 'paused'
        : this.engineState.status === 'idle' || this.engineState.status === 'starting'
          ? this.engineState.status
          : issue
            ? 'degraded'
            : 'monitoring';
    this.setState({ status, cameraIssue: issue });
  }

  private currentIssue(): ProctoringCameraIssue {
    if (this.openFailureSignals.has('CAMERA_PERMISSION_REVOKED')) return 'permission';
    if (this.openFailureSignals.has('MODEL_UNAVAILABLE')) return 'model';
    if (this.openFailureSignals.has('CAMERA_UNAVAILABLE')) return 'camera-startup';
    if (this.openFailureSignals.has('CAMERA_TRACK_ENDED')) return 'camera-error';
    if (this.tracker.hasOpenTechnical) {
      // Dark/frozen live in the tracker (frame-driven), not the signal set.
      if (this.tracker.hasOpenOfType('CAMERA_FEED_DARK')) return 'dark';
      if (this.tracker.hasOpenOfType('CAMERA_FEED_FROZEN')) return 'frozen';
    }
    return null;
  }

  private setState(next: ProctoringEngineState): void {
    const prev = this.engineState;
    if (prev.status === next.status && prev.cameraIssue === next.cameraIssue) return;
    this.engineState = next;
    this.options.onStateChange?.(next);
  }
}
