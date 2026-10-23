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
}

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
}

export class WebProctoringEngine {
  private readonly opts: Required<Pick<WebProctoringEngineOptions, 'session'>> & WebProctoringEngineOptions;
  private readonly tracker: EpisodeTracker;
  private readonly focus: FocusTracker;
  private readonly buffer: ProctoringEventBuffer;
  private readonly camera: WebCameraSource = createWebCameraSource();
  private readonly lumaCanvas = document.createElement('canvas');

  private status: ProctoringEngineStatus = 'idle';
  private cameraIssue: WebCameraIssue = null;
  private consecutiveFailures = 0;
  private detectorRunning = false;

  private analysisTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private detect: ((video: HTMLVideoElement) => import('../proctoringSpike/faceLandmarker').SpikeFrameResult) | null = null;
  private closeDetector: (() => void) | null = null;
  private flushing = false;
  private finalized = false;
  /** Set by stop(); a start() suspended at an await must abort, not arm. */
  private stopped = false;

  constructor(options: WebProctoringEngineOptions) {
    this.opts = options;
    this.tracker = new EpisodeTracker({
      policy: options.policy ?? {},
      detectorTier: 'headpose',
      attentionBaseline: options.attentionBaseline ?? null,
    });
    this.focus = new FocusTracker({ policy: options.policy ?? {} });
    this.buffer = new ProctoringEventBuffer({
      storage: options.storage,
      max: 500,
    });
    this.camera.onIssue((error) => this.handleCameraIssue(error));
  }

  get state(): WebEngineState {
    return { status: this.status, cameraIssue: this.cameraIssue };
  }

  private setState(status: ProctoringEngineStatus, cameraIssue: WebCameraIssue = this.cameraIssue) {
    this.status = status;
    this.cameraIssue = cameraIssue;
    this.opts.onState?.({ status, cameraIssue });
  }

  // ---------- lifecycle ----------

  async start({ resumed = false } = {}): Promise<void> {
    if (this.status === 'monitoring' || this.status === 'paused' || this.status === 'starting') return;
    this.setState('starting');
    this.finalized = false;
    this.stopped = false;

    // Camera first (user-gesture context, permission classification).
    try {
      await this.camera.start();
    } catch (err) {
      if (this.stopped) return; // stop() ran during the permission prompt — stay down.
      const classified = classifyGetUserMediaError(err);
      // Camera is REQUIRED for proctored attempts at PRECHECK time (D-P2);
      // losing it MID-QUIZ degrades (record + warn), never blocks.
      this.emitTechnical(classified.kind === 'denied' ? 'CAMERA_PERMISSION_REVOKED' : 'CAMERA_UNAVAILABLE');
      this.setState('degraded', classified.kind === 'denied' ? 'permission' : 'camera-startup');
      this.beginTimers(resumed);
      return;
    }

    if (this.stopped) return; // stop() raced the camera start — never arm.

    // Detector (dynamic import keeps it out of unarmed bundles).
    try {
      const mod = await import('../proctoringSpike/faceLandmarker');
      await mod.initSpikeDetector('GPU');
      this.detect = mod.detectFrame;
      this.closeDetector = () => mod.closeSpikeDetector();
      this.detectorRunning = true;
    } catch {
      if (this.stopped) return;
      this.detect = null;
      this.emitTechnical('MODEL_UNAVAILABLE');
      this.setState('degraded', 'model');
      this.beginTimers(resumed);
      return;
    }

    if (this.stopped) {
      // The detector finished loading after teardown — close it and stay down.
      this.closeDetector?.();
      this.closeDetector = null;
      this.detect = null;
      this.detectorRunning = false;
      return;
    }

    this.emitSystem(resumed ? 'SESSION_RESUMED' : 'SESSION_STARTED', {
      screenCapturePrevention: 'unsupported', // honest: browsers cannot prevent it
      platform: 'web',
    });
    this.setState('monitoring', null);
    // beginTimers restores the persisted buffer (refresh replay) and, for
    // resumes, flushes it promptly — the restore is idempotent.
    this.beginTimers(resumed);
    void this.flush();
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
    void this.buffer.restore().then(() => {
      if (resumed && this.status === 'monitoring') void this.flush();
    });
  }

  pause(): void {
    if (this.status !== 'monitoring' && this.status !== 'degraded') return;
    this.setState('paused');
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.setState(this.cameraIssue ? 'degraded' : 'monitoring');
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
    if (this.status !== 'monitoring' || !this.detect || !this.detectorRunning) return;
    const video = this.camera.video;
    if (video.readyState < 2) return;
    try {
      const frame = this.detect(video);
      this.consecutiveFailures = 0;
      const luma = sampleMeanLuma(video, this.lumaCanvas);
      const observation = toFrameObservation(frame, luma);
      this.tracker.setFrameSignature(frameSignature(frame));
      const episodes = this.tracker.observeFrame(observation);
      this.recordEpisodes(episodes as WebEpisode[]);
      // Dark/frozen surface as cameraIssue for the UI banner (episodes are
      // recorded by the tracker itself — this is display state only).
      if (this.tracker.hasOpenOfType('CAMERA_FEED_DARK')) this.setState('degraded', 'dark');
      else if (this.tracker.hasOpenOfType('CAMERA_FEED_FROZEN')) this.setState('degraded', 'frozen');
      else if (this.cameraIssue === 'dark' || this.cameraIssue === 'frozen') {
        this.setState('monitoring', null);
      }
    } catch (err) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= FAILURE_THRESHOLD) {
        this.detectorRunning = false;
        this.emitTechnical('MODEL_UNAVAILABLE');
        this.setState('degraded', 'model');
      }
    }
  }

  private handleCameraIssue(error: CameraSourceError): void {
    if (this.finalized) return;
    if (error.kind === 'denied') {
      this.emitTechnical('CAMERA_PERMISSION_REVOKED');
      this.setState('degraded', 'permission');
    } else if (error.kind === 'track-ended') {
      this.emitTechnical('CAMERA_TRACK_ENDED');
      this.setState('degraded', 'camera-error');
    } else {
      this.emitTechnical('CAMERA_UNAVAILABLE');
      this.setState('degraded', 'camera-error');
    }
  }

  // ---------- event shaping + transport ----------

  private emitSystem(type: 'SESSION_STARTED' | 'SESSION_RESUMED' | 'SESSION_DEGRADED', metadata?: Record<string, unknown>): void {
    const now = this.opts.now?.() ?? Date.now();
    this.buffer.enqueue({ type, openedAt: now, closedAt: now, metadata });
  }

  private emitTechnical(type: 'MODEL_UNAVAILABLE' | 'CAMERA_UNAVAILABLE' | 'CAMERA_PERMISSION_REVOKED' | 'CAMERA_TRACK_ENDED'): void {
    const now = this.opts.now?.() ?? Date.now();
    this.buffer.enqueue({ type, openedAt: now, closedAt: now });
  }

  recordEpisodes(episodes: WebEpisode[]): void {
    if (this.finalized || episodes.length === 0) return;
    for (const e of episodes) {
      // The shared buffer types the NATIVE union; the web union adds the
      // browser-sourced TAB_HIDDEN. Runtime shapes are identical and the
      // server registry validates the type — the cast is type-level only.
      this.buffer.enqueue(e as unknown as import('@app-services/proctoring/types').ProctoringEpisodeEvent);
    }
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
    if (this.finalized) return;
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
    this.camera.stop();
    this.closeDetector?.();
    this.closeDetector = null;
    this.detect = null;
    this.detectorRunning = false;
    this.setState('stopped', null);
  }
}
