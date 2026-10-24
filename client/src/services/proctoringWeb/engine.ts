/**
 * Web proctoring engine — the browser counterpart of the mobile
 * services/proctoring/engine.ts.
 *
 * Shares EVERYTHING consequential with the mobile engine by import (the
 * repo-root EpisodeTracker/FocusTracker/ProctoringEventBuffer — the
 * calibrated logic), and replaces only the platform layer: MediaPipe
 * FaceLandmarker (dynamic import, code-split) fed by a hidden getUserMedia
 * video, DOM focus signals (visibilitychange → TAB_HIDDEN episodes),
 * localStorage buffering, and the public-events transport.
 *
 * Doctrine (unchanged from the mobile engine): events are OBSERVATIONS —
 * the server owns every decision; no pixels ever leave the page; camera
 * trouble degrades monitoring but NEVER blocks or submits the quiz
 * (owner decision D-P2/D-round2-4: record + warn, never auto-submit).
 *
 * Blindness doctrine (2026-10-24 field bug): a session whose analysis loop
 * is silently producing nothing must NEVER look like a clean session.
 * Mobile parity applies throughout —
 *   - analysis keeps running while DEGRADED (mobile's handleFrame only
 *     skips paused/stopped; a degraded camera must not freeze the tracker);
 *   - camera/model failures open TECHNICAL SIGNALS on the shared tracker
 *     (one episode per outage, §17.5 face-suppression while open) and close
 *     when frames return (mobile's openFailureSignals recovery);
 *   - a granted-but-frameless video (track live, readyState stuck < 2 — a
 *     real right-after-readiness failure mode) trips the FRAMES watchdog
 *     and is recorded as CAMERA_UNAVAILABLE(frames_not_flowing);
 *   - a detector that finds faces but never yields pose matrices trips the
 *     POSE watchdog (MODEL_UNAVAILABLE, pose_output_missing) instead of
 *     silently never emitting attention events;
 *   - the heartbeat retries camera acquisition + detector init while the
 *     engine stays armed, so transient startup failures self-heal;
 *   - every enqueue persists and flushes (mobile's emitEpisodes contract).
 */

import {
  EpisodeTracker,
  type AttentionBaselineInput,
} from '@app-services/proctoring/episodeTracker';
import { FocusTracker } from '@app-services/proctoring/focusTracker';
import { ProctoringEventBuffer } from '@app-services/proctoring/eventBuffer';
import type {
  ProctoringEngineStatus,
  ProctoringPolicy,
} from '@app-services/proctoring/types';
import type { EventBufferStorage, QueuedProctoringEvent } from '@app-services/proctoring/eventBuffer';
import {
  classifyGetUserMediaError,
  createWebCameraSource,
  type CameraSourceError,
  type WebCameraSource,
} from './cameraSource';
import { frameSignature, sampleMeanLuma, toFrameObservation } from './frameObservation';
import type { SpikeFrameResult } from '../proctoringSpike/faceLandmarker';
import {
  WEB_EVENT_SOURCE_BY_TYPE,
  type ProctoringBatchPayload,
  type WebBatchPayloadEvent,
  type WebEpisode,
} from './engineTypes';
import type { TransportAction, TransportResult } from './transport';

/** Mirrors the server envelope cap (backend eventIngest.js). */
const SERVER_BATCH_MAX_EVENTS = 50;
/** Consecutive detector failures before a technical condition is signaled. */
const FAILURE_THRESHOLD = 3;
/** Default analysis cadence — the measured Phase-0 floor may tune this. */
const DEFAULT_ANALYSIS_INTERVAL_MS = 500;
/** Standalone heartbeat cadence default (policy overrides). */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
/**
 * Watchdog: an armed engine that has not analyzed a frame for this long
 * opens CAMERA_UNAVAILABLE(frames_not_flowing) — a granted-but-frameless
 * video is an OUTAGE, not a clean session (diagnostics timing, not policy).
 */
const FRAMES_STALL_WARN_MS = 10_000;
/**
 * Watchdog: faces detected for this long without a single pose matrix →
 * MODEL_UNAVAILABLE(pose_output_missing) — attention events are impossible
 * without head pose, and that must be visible, not silent. Sticky per arm
 * (no flapping while the detector intermittently recovers).
 */
const POSE_STALL_WARN_MS = 15_000;

export type WebCameraIssue =
  | null
  | 'camera-startup'
  | 'camera-error'
  | 'permission'
  | 'model'
  | 'dark'
  | 'frozen';

export interface WebEngineState {
  status: ProctoringEngineStatus;
  cameraIssue: WebCameraIssue;
  /** Frames the analysis loop has actually processed this arm. */
  framesAnalyzed: number;
  /** Wall-clock ms of the last analyzed frame (null before the first). */
  lastFrameAtMs: number | null;
}

/** The detector seam — the real one dynamic-imports MediaPipe (test injects fakes). */
export interface WebDetector {
  init(): Promise<void>;
  detect(video: HTMLVideoElement): SpikeFrameResult;
  close(): void;
}

const createMediaPipeDetector = (): WebDetector => {
  // Lazy module refs — resolved on init so construction stays side-effect
  // free (node tests inject a fake and never load the browser bundle).
  let mod: typeof import('../proctoringSpike/faceLandmarker') | null = null;
  return {
    async init() {
      mod = await import('../proctoringSpike/faceLandmarker');
      await mod.initSpikeDetector('GPU');
    },
    detect(video) {
      if (!mod) throw new Error('Detector not initialized');
      return mod.detectFrame(video);
    },
    close() {
      mod?.closeSpikeDetector();
      mod = null;
    },
  };
};

export interface WebProctoringEngineOptions {
  session: { shareToken: string; attemptId: string; sessionId: string; guestId: string };
  policy?: ProctoringPolicy;
  attentionBaseline?: AttentionBaselineInput | null;
  transport: (payload: ProctoringBatchPayload) => Promise<TransportResult>;
  storage?: EventBufferStorage;
  onState?: (state: WebEngineState) => void;
  /** Fired for every warning (socket AND batch-response channels, pre-dedup). */
  onWarning?: (action: TransportAction) => void;
  /** Fired once when the server reports the attempt finalized. */
  onFinalized?: () => void;
  analysisIntervalMs?: number;
  now?: () => number;
  /** Test seams: inject the camera source / detector (default = platform). */
  cameraSource?: WebCameraSource;
  detector?: WebDetector;
}

/** Failure signals that retry while the engine stays armed (heartbeat-driven). */
const RETRYABLE_CAMERA_ISSUES = new Set<WebCameraIssue>(['camera-startup', 'camera-error']);

export class WebProctoringEngine {
  private readonly opts: Required<Pick<WebProctoringEngineOptions, 'session'>> & WebProctoringEngineOptions;
  private readonly tracker: EpisodeTracker;
  private readonly focus: FocusTracker;
  private readonly buffer: ProctoringEventBuffer;
  private readonly camera: WebCameraSource;
  private readonly detector: WebDetector;
  private readonly lumaCanvas = document.createElement('canvas');

  private status: ProctoringEngineStatus = 'idle';
  private cameraIssue: WebCameraIssue = null;
  private consecutiveFailures = 0;
  private detectorRunning = false;
  private cameraRunning = false;
  private cameraAttemptInFlight = false;
  private detectorAttemptInFlight = false;

  /** Failure-driven technical signals currently open (mobile parity). */
  private readonly openFailureSignals = new Set<string>();
  /** Watchdog state: frames + pose. */
  private framesAnalyzed = 0;
  private lastFrameAtMs: number | null = null;
  private armedAtMs: number | null = null;
  private faceWithoutPoseSinceMs: number | null = null;
  private poseStallSignaled = false;

  private analysisTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private flushing = false;
  private finalized = false;
  /** Set by stop(); a start() suspended at an await must abort, not arm. */
  private stopped = false;

  constructor(options: WebProctoringEngineOptions) {
    this.opts = options;
    const now = options.now ?? (() => Date.now());
    this.tracker = new EpisodeTracker({
      policy: options.policy ?? {},
      detectorTier: 'headpose',
      attentionBaseline: options.attentionBaseline ?? null,
      now,
    });
    this.focus = new FocusTracker({ policy: options.policy ?? {}, now });
    this.buffer = new ProctoringEventBuffer({
      storage: options.storage,
      max: 500,
    });
    this.camera = options.cameraSource ?? createWebCameraSource();
    this.detector = options.detector ?? createMediaPipeDetector();
    this.camera.onIssue((error) => this.handleCameraIssue(error));
  }

  get state(): WebEngineState {
    return {
      status: this.status,
      cameraIssue: this.cameraIssue,
      framesAnalyzed: this.framesAnalyzed,
      lastFrameAtMs: this.lastFrameAtMs,
    };
  }

  private setState(status: ProctoringEngineStatus, cameraIssue: WebCameraIssue = this.cameraIssue) {
    this.status = status;
    this.cameraIssue = cameraIssue;
    this.opts.onState?.(this.state);
  }

  /** Recompute the display state from live truth (mobile's recomputeState). */
  private recomputeState(): void {
    if (this.status === 'stopped' || this.status === 'paused' || this.status === 'starting') return;
    if (this.cameraIssue === 'permission' || this.cameraIssue === 'model') {
      this.setState('degraded');
      return;
    }
    if (this.cameraIssue) {
      this.setState('degraded');
      return;
    }
    this.setState('monitoring', null);
  }

  // ---------- lifecycle ----------

  async start({ resumed = false } = {}): Promise<void> {
    if (this.status === 'monitoring' || this.status === 'paused' || this.status === 'starting') return;
    this.stopped = false;
    this.armedAtMs = this.opts.now?.() ?? Date.now();
    // Restore the persisted queue FIRST (mobile order): enqueue paths
    // persist immediately, so emitting before the restore would overwrite
    // the pending queue with a one-event snapshot — losing everything a
    // refresh was supposed to replay.
    await this.buffer.restore();
    if (this.stopped) return;
    // The session marker is a SESSION fact, not a camera-health fact (mobile
    // emits it before the loop starts): a session whose camera never opens
    // still records SESSION_STARTED + the camera outage honestly.
    this.emitSystem(resumed ? 'SESSION_RESUMED' : 'SESSION_STARTED', {
      screenCapturePrevention: 'unsupported', // honest: browsers cannot prevent it
      platform: 'web',
    });
    this.beginTimers(resumed);

    // Camera first (user-gesture context, permission classification).
    await this.startCamera();
    if (this.stopped) return;
    await this.startDetector();
    if (this.stopped) return;
    if (!this.cameraRunning || !this.detectorRunning) {
      // Degraded arm — the heartbeat retries both until they come up.
      this.recomputeState();
      return;
    }
    this.setState('monitoring', null);
    void this.flush();
  }

  private async startCamera(): Promise<void> {
    if (this.cameraRunning || this.cameraAttemptInFlight) return;
    this.cameraAttemptInFlight = true;
    try {
      await this.camera.start();
      if (this.stopped) return;
      this.cameraRunning = true;
    } catch (err) {
      if (this.stopped) return; // stop() ran during the permission prompt — stay down.
      const classified = classifyGetUserMediaError(err);
      // Camera is REQUIRED for proctored attempts at PRECHECK time (D-P2);
      // losing it MID-QUIZ degrades (record + warn), never blocks.
      this.openFailureSignal(
        classified.kind === 'denied' ? 'CAMERA_PERMISSION_REVOKED' : 'CAMERA_UNAVAILABLE',
        { stage: 'start', reason: ('detail' in classified && classified.detail) ? classified.detail : classified.kind }
      );
      this.cameraIssue = classified.kind === 'denied' ? 'permission' : 'camera-startup';
      this.recomputeState();
    } finally {
      this.cameraAttemptInFlight = false;
    }
  }

  private async startDetector(): Promise<void> {
    if (this.detectorRunning || this.detectorAttemptInFlight || !this.cameraRunning) return;
    this.detectorAttemptInFlight = true;
    try {
      await this.detector.init();
      if (this.stopped) {
        this.detector.close();
        return;
      }
      this.detectorRunning = true;
    } catch {
      if (this.stopped) return;
      this.openFailureSignal('MODEL_UNAVAILABLE', { stage: 'init' });
      this.cameraIssue = 'model';
      this.recomputeState();
    } finally {
      this.detectorAttemptInFlight = false;
    }
  }

  private beginTimers(resumed: boolean) {
    // Analysis loop.
    const interval = this.opts.analysisIntervalMs ?? DEFAULT_ANALYSIS_INTERVAL_MS;
    this.analysisTimer = window.setInterval(() => void this.analysisTick(), interval);
    // Focus signals (visibilitychange → the shared tracker's app-state
    // machine → APP_BACKGROUND episodes, relabeled TAB_HIDDEN for the web).
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    // Heartbeat.
    const hb = this.opts.policy?.sessionHealth?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimer = window.setInterval(() => void this.heartbeatTick(), hb);
    // Resumes flush the restored queue promptly (restore itself already
    // happened in start() — before the first enqueue, mobile order).
    if (resumed) void this.flush();
  }

  pause(): void {
    if (this.status !== 'monitoring' && this.status !== 'degraded') return;
    this.setState('paused');
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.recomputeState();
  }

  private onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      this.recordEpisodes(this.relabelFocus(this.focus.onAppStateChange('background')));
    } else {
      this.recordEpisodes(this.relabelFocus(this.focus.onAppStateChange('active')));
      // Hidden tabs throttle timers to ~1/min — flush the focus episode
      // (and anything queued) promptly on return.
      void this.flush();
    }
  };

  /** Shared FocusTracker emits APP_BACKGROUND; the web wire type is TAB_HIDDEN. */
  private relabelFocus(episodes: { type: string; openedAt: number; closedAt?: number; confidence?: number; metadata?: Record<string, unknown> }[]): WebEpisode[] {
    return episodes.map((e) => ({ ...e, type: 'TAB_HIDDEN' as const }));
  }

  // ---------- per-frame analysis ----------

  private async analysisTick(): Promise<void> {
    // MOBILE PARITY: analysis continues while DEGRADED (handleFrame only
    // skips paused/stopped) — a degraded camera must not freeze the tracker;
    // the tracker itself suppresses face episodes under §17.5 overlap.
    if (this.status !== 'monitoring' && this.status !== 'degraded') return;
    if (!this.cameraRunning || !this.detectorRunning || this.cameraIssue === 'permission') {
      return;
    }
    const video = this.camera.video;
    if (video.readyState < 2) {
      this.noteFramesStalled();
      return;
    }
    // Frames are flowing — any frames-stall outage is over, even if the
    // detector then fails on this tick (the failure path has its own signal).
    this.noteFramesFlowing();
    try {
      const frame = this.detector.detect(video);
      this.consecutiveFailures = 0;
      const luma = sampleMeanLuma(video, this.lumaCanvas);
      const observation = toFrameObservation(frame, luma, this.opts.now?.());
      this.observePoseWatchdog(frame);
      this.tracker.setFrameSignature(frameSignature(frame));
      const episodes = this.tracker.observeFrame(observation);
      this.recordEpisodes(episodes as WebEpisode[]);
      this.framesAnalyzed += 1;
      this.lastFrameAtMs = this.opts.now?.() ?? Date.now();
      // Dark/frozen surface as cameraIssue for the UI banner (episodes are
      // recorded by the tracker itself — this is display state only).
      if (this.tracker.hasOpenOfType('CAMERA_FEED_DARK')) this.setState('degraded', 'dark');
      else if (this.tracker.hasOpenOfType('CAMERA_FEED_FROZEN')) this.setState('degraded', 'frozen');
      else if (this.cameraIssue === 'dark' || this.cameraIssue === 'frozen') {
        this.recomputeState();
      }
    } catch (err) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= FAILURE_THRESHOLD) {
        this.detectorRunning = false;
        this.openFailureSignal('MODEL_UNAVAILABLE', {
          consecutiveFailures: this.consecutiveFailures,
        });
        this.cameraIssue = 'model';
        this.recomputeState();
      }
    }
  }

  /**
   * Frames watchdog: an armed engine that has NEVER analyzed a frame (or has
   * stopped analyzing) for FRAMES_STALL_WARN_MS is in an outage — record it
   * and degrade honestly. A granted-but-frameless track (readyState stuck
   * below 2) lands here: without this, the session silently records nothing.
   */
  private noteFramesStalled(): void {
    if (this.openFailureSignals.has('CAMERA_UNAVAILABLE')) return;
    const now = this.opts.now?.() ?? Date.now();
    const since = this.lastFrameAtMs ?? this.armedAtMs ?? now;
    if (now - since < FRAMES_STALL_WARN_MS) return;
    // Distinguish the frames watchdog from a gUM-failure signal so the
    // tracker episode and the display state stay honest (both close when
    // frames flow again).
    this.openFailureSignal('CAMERA_UNAVAILABLE', { reason: 'frames_not_flowing', stalledMs: now - since });
    this.cameraIssue = this.cameraIssue ?? 'camera-startup';
    this.recomputeState();
  }

  /** Frames are flowing: close the frames-stall outage + recover display state. */
  private noteFramesFlowing(): void {
    this.closeFailureSignal('CAMERA_UNAVAILABLE', { reason: 'frames_not_flowing_recovered' });
    if (RETRYABLE_CAMERA_ISSUES.has(this.cameraIssue)) {
      this.cameraIssue = null;
      this.recomputeState();
    }
  }

  /**
   * Pose watchdog: faces detected but headPose null on every frame for
   * POSE_STALL_WARN_MS → the model's pose output is unavailable (attention
   * events are impossible) — record MODEL_UNAVAILABLE(pose_output_missing),
   * sticky per arm (intermittent recovery does not flap it).
   */
  private observePoseWatchdog(frame: SpikeFrameResult): void {
    if (frame.faceCount > 0 && frame.headPose === null) {
      const now = this.opts.now?.() ?? Date.now();
      this.faceWithoutPoseSinceMs = this.faceWithoutPoseSinceMs ?? now;
      if (!this.poseStallSignaled && now - this.faceWithoutPoseSinceMs >= POSE_STALL_WARN_MS) {
        this.poseStallSignaled = true;
        this.emitTechnical('MODEL_UNAVAILABLE', {
          reason: 'pose_output_missing',
          sustainedMs: now - this.faceWithoutPoseSinceMs,
        });
      }
      return;
    }
    this.faceWithoutPoseSinceMs = null;
  }

  private handleCameraIssue(error: CameraSourceError): void {
    if (this.finalized || this.stopped) return;
    if (error.kind === 'denied') {
      this.cameraRunning = false;
      this.openFailureSignal('CAMERA_PERMISSION_REVOKED', { stage: 'midrun' }, false);
      this.cameraIssue = 'permission';
    } else if (error.kind === 'track-ended') {
      this.cameraRunning = false;
      this.openFailureSignal('CAMERA_TRACK_ENDED', { stage: 'midrun' }, false);
      this.cameraIssue = 'camera-error';
    } else {
      this.cameraRunning = false;
      this.openFailureSignal('CAMERA_UNAVAILABLE', { stage: 'midrun', reason: error.detail ?? error.kind }, false);
      this.cameraIssue = 'camera-error';
    }
    this.recomputeState();
  }

  // ---------- technical signals (mobile openFailureSignals parity) ----------

  private openFailureSignal(type: string, meta: Record<string, unknown>, pointEvent = true): void {
    if (this.openFailureSignals.has(type)) return; // already open — no spam
    this.openFailureSignals.add(type);
    // 1. The shared tracker opens the condition (§17.5 face suppression
    //    while open) and will emit the DURATION episode when it closes —
    //    exactly the mobile engine's outage record. Midrun camera classes
    //    stop here (mobile parity: one episode + the server's camera
    //    warning ladder fires exactly once per outage).
    this.recordEpisodes(this.tracker.signal(
      type as Parameters<EpisodeTracker['signal']>[0],
      true,
      meta
    ) as WebEpisode[]);
    if (!pointEvent) return;
    // 2. Watchdog diagnostics additionally emit an immediate point event
    //    carrying the string reason — the tracker episode only survives
    //    numeric metadata, and WHY the outage opened (frames_not_flowing,
    //    pose_output_missing…) must be reviewable the moment it happens,
    //    not only after recovery.
    this.emitTechnical(
      type as 'MODEL_UNAVAILABLE' | 'CAMERA_UNAVAILABLE' | 'CAMERA_PERMISSION_REVOKED' | 'CAMERA_TRACK_ENDED',
      meta
    );
  }

  private closeFailureSignal(type: string, meta: Record<string, unknown>): void {
    if (!this.openFailureSignals.has(type)) return;
    this.openFailureSignals.delete(type);
    this.recordEpisodes(this.tracker.signal(
      type as Parameters<EpisodeTracker['signal']>[0],
      false,
      meta
    ) as WebEpisode[]);
  }

  // ---------- event shaping + transport ----------

  private emitSystem(type: 'SESSION_STARTED' | 'SESSION_RESUMED' | 'SESSION_DEGRADED', metadata?: Record<string, unknown>): void {
    const now = this.opts.now?.() ?? Date.now();
    this.buffer.enqueue({ type, openedAt: now, closedAt: now, metadata });
    void this.buffer.persist();
    void this.flush();
  }

  private emitTechnical(type: 'MODEL_UNAVAILABLE' | 'CAMERA_UNAVAILABLE' | 'CAMERA_PERMISSION_REVOKED' | 'CAMERA_TRACK_ENDED', metadata?: Record<string, unknown>): void {
    const now = this.opts.now?.() ?? Date.now();
    this.buffer.enqueue({ type, openedAt: now, closedAt: now, metadata });
    void this.buffer.persist();
    void this.flush();
  }

  recordEpisodes(episodes: WebEpisode[]): void {
    if (this.finalized || episodes.length === 0) return;
    for (const e of episodes) {
      // The shared buffer types the NATIVE union; the web union adds the
      // browser-sourced TAB_HIDDEN. Runtime shapes are identical and the
      // server registry validates the type — the cast is type-level only.
      this.buffer.enqueue(e as unknown as import('@app-services/proctoring/types').ProctoringEpisodeEvent);
    }
    void this.buffer.persist();
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing || this.finalized) return;
    this.flushing = true;
    try {
      // Bounded batches per flush (mobile contract). A retryable outcome
      // ends the flush — the batch stays queued (take/ack split) and the
      // next heartbeat/episode flush retries it.
      for (let i = 0; i < 5; i += 1) {
        const batch = this.buffer.takeBatch(SERVER_BATCH_MAX_EVENTS);
        if (batch.length === 0) break;
        // eslint-disable-next-line no-await-in-loop
        const result = await this.sendBatch(batch, false);
        if (result === 'stop') break;
        if (result === 'keep') break;
      }
    } finally {
      this.flushing = false;
    }
  }

  async heartbeatTick(): Promise<void> {
    if (this.finalized || this.stopped) return;
    // Startup self-heal (mobile's loop retries captures continuously): while
    // the engine stays armed, keep retrying the camera and the detector so a
    // transient startup failure (frameless grant, CDN hiccup) recovers
    // instead of silently un-monitoring the rest of the attempt.
    if (!this.cameraRunning && RETRYABLE_CAMERA_ISSUES.has(this.cameraIssue)) {
      await this.startCamera();
    }
    if (this.cameraRunning && !this.detectorRunning) {
      await this.startDetector();
      if (this.detectorRunning && this.cameraIssue === 'model') {
        this.cameraIssue = null;
        this.closeFailureSignal('MODEL_UNAVAILABLE', { reason: 'detector_recovered' });
        this.recomputeState();
      }
    }
    if (this.buffer.size === 0) {
      // Standalone proof-of-life (empty batch, heartbeat:true — the server
      // envelope contract allows exactly this).
      await this.sendBatch([], true);
      return;
    }
    await this.flush();
  }

  private async sendBatch(batch: QueuedProctoringEvent[], heartbeatOnly: boolean): Promise<'sent' | 'keep' | 'stop'> {
    const events: WebBatchPayloadEvent[] = batch.map((e) => ({
      idempotencyKey: e.idempotencyKey,
      clientSeq: e.clientSeq,
      type: e.type as WebBatchPayloadEvent['type'],
      source: WEB_EVENT_SOURCE_BY_TYPE[e.type as keyof typeof WEB_EVENT_SOURCE_BY_TYPE] ?? 'system',
      openedAt: e.openedAt,
      ...(e.closedAt !== undefined ? { closedAt: e.closedAt } : {}),
      ...(e.confidence !== undefined ? { confidence: e.confidence } : {}),
      ...(e.metadata ? { metadata: e.metadata } : {}),
    }));
    const payload: ProctoringBatchPayload = {
      sessionId: this.opts.session.sessionId,
      ...(events.length ? { seq: events[events.length - 1].clientSeq } : {}),
      heartbeat: heartbeatOnly && events.length === 0,
      bufferOverflow: this.buffer.consumeOverflow(),
      events,
    };

    let result: TransportResult;
    try {
      result = await this.opts.transport(payload);
    } catch {
      // Transport threw unexpectedly — retryable; the snapshot stays queued
      // (no ack) and the next flush retries it with the same keys.
      return 'keep';
    }

    for (const action of result.actions) this.opts.onWarning?.(action);
    if (result.attemptFinalized) {
      this.finalized = true;
      await this.buffer.reset();
      this.opts.onFinalized?.();
      return 'stop';
    }

    switch (result.outcome.kind) {
      case 'accepted':
      case 'permanent_reject':
        // Both consume the batch server-side (accepted = stored; permanent
        // = deliberately dropped client-side, mobile contract).
        await this.buffer.ack(batch);
        return 'sent';
      case 'session_closed':
        this.finalized = true;
        await this.buffer.reset();
        this.opts.onFinalized?.();
        return 'stop';
      default:
        return 'keep';
    }
  }

  /** Flush open episodes but KEEP timers (section submits — mobile flushNow). */
  async flushNow(): Promise<void> {
    this.recordEpisodes(this.tracker.closeAll() as WebEpisode[]);
    this.recordEpisodes(this.relabelFocus(this.focus.closeAll()));
    await this.flush();
  }

  /** Final teardown — closes everything, best-effort final flush. */
  async stop(): Promise<void> {
    // Flag before anything else: a start() suspended at an await reads this
    // on resumption and aborts instead of arming timers after teardown.
    this.stopped = true;
    if (this.status === 'stopped') return;
    if (this.analysisTimer !== null) window.clearInterval(this.analysisTimer);
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.analysisTimer = null;
    this.heartbeatTimer = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (!this.finalized) {
      this.recordEpisodes(this.tracker.closeAll() as WebEpisode[]);
      this.recordEpisodes(this.relabelFocus(this.focus.closeAll()));
      await this.flush();
    }
    this.cameraRunning = false;
    this.detectorRunning = false;
    this.camera.stop();
    this.detector.close();
    this.setState('stopped', null);
  }
}
