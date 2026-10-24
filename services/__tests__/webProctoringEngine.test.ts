/**
 * Web proctoring engine tests (public-quiz Phase 3 + the 2026-10-24 field
 * bug): the FULL client pipeline with the platform layer faked —
 * camera source (controllable readyState), detector (scripted frames),
 * transport (records payloads), storage (in-memory). Everything else is
 * the REAL shared EpisodeTracker/FocusTracker/buffer, so these tests pin
 * web↔mobile behavioral parity at the same seam the mobile suite pins.
 *
 * Field-bug regressions specifically covered:
 *   - a granted-but-frameless video (readyState stuck < 2) trips the
 *     frames watchdog → CAMERA_UNAVAILABLE(frames_not_flowing) point event
 *     + degraded state — NEVER a silently clean session;
 *   - faces without pose matrices trip the pose watchdog;
 *   - analysis continues while degraded and recovers (heartbeat retries);
 *   - enqueues persist immediately (refresh durability, mobile parity);
 *   - sustained look-aways still yield HEAD_POSE_TURNED occurrences + the
 *     HEAD_POSE_REPEATED marker with the exact wire shape the server
 *     registry validates (source/confidence contract).
 */

import { WebProctoringEngine, type WebDetector } from '../../client/src/services/proctoringWeb/engine';
import type { WebCameraSource } from '../../client/src/services/proctoringWeb/cameraSource';
import type { ProctoringBatchPayload } from '../../client/src/services/proctoringWeb/engineTypes';
import type { SpikeFrameResult } from '../../client/src/services/proctoringSpike/faceLandmarker';
import type {
  EventBufferStorage,
  QueuedProctoringEvent,
} from '../proctoring/eventBuffer';

// ---- DOM/window stubs (node env; the engine touches only these) ----------

type Timer = { id: number; kind: 'analysis' | 'heartbeat'; fn: () => void };
let timers: Timer[] = [];
let nextTimerId = 1;
let visibilityListeners: Array<() => void> = [];

const installDomStubs = () => {
  timers = [];
  nextTimerId = 1;
  visibilityListeners = [];
  (globalThis as Record<string, unknown>).window = {
    setInterval: (fn: () => void, _ms: number, ...rest: unknown[]) => {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.push({ id, kind: timers.length === 0 ? 'analysis' : 'heartbeat', fn });
      return id;
    },
    clearInterval: (id: number) => {
      timers = timers.filter((t) => t.id !== id);
    },
  };
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ getContext: () => null }),
    addEventListener: (_type: string, fn: () => void) => { visibilityListeners.push(fn); },
    removeEventListener: () => {},
    visibilityState: 'visible',
  };
};

/** Fire one analysis tick (the first timer registered). */
const tickAnalysis = () => { timers.filter((t) => t.kind === 'analysis').forEach((t) => t.fn()); };
/** Fire one heartbeat tick (camera/detector retries + flush driver). */
const tickHeartbeat = async () => {
  for (const t of timers.filter((t) => t.kind === 'heartbeat')) {
    // eslint-disable-next-line no-await-in-loop
    await t.fn();
  }
};

// ---- fakes ----------------------------------------------------------------

/** Frame counter so signatures jitter (a frozen stream is a technical state). */
let frameSeq = 0;
const frame = (opts: { yaw?: number; pitch?: number; faceCount?: number; noPose?: boolean } = {}): SpikeFrameResult => {
  const faceCount = opts.faceCount ?? 1;
  frameSeq += 1;
  return {
    faceCount,
    headPose: faceCount > 0 && !opts.noPose
      ? { yaw: opts.yaw ?? 2, pitch: opts.pitch ?? -3, roll: 0 }
      : null,
    latencyMs: 1,
    atMs: frameSeq,
    faceRatios: faceCount > 0 ? [0.28] : [],
    signature: faceCount > 0 ? `sig-${frameSeq}` : null,
  };
};

const makeCamera = (video: { readyState: number }) => {
  const source: WebCameraSource & { failWith?: unknown; issueCb?: (e: unknown) => void } = {
    video: video as unknown as HTMLVideoElement,
    async start() {
      if (source.failWith) {
        const err = source.failWith;
        source.failWith = undefined;
        throw err;
      }
    },
    stop() {},
    onIssue(cb) { source.issueCb = cb; },
  };
  return source;
};

const makeDetector = (script: () => SpikeFrameResult) => {
  const detector: WebDetector & { failInit?: boolean; failDetect?: boolean } = {
    async init() { if (detector.failInit) { detector.failInit = false; throw new Error('model init failed'); } },
    detect() {
      if (detector.failDetect) throw new Error('detect failed');
      return script();
    },
    close() {},
  };
  return detector;
};

const makeStorage = () => {
  let persisted: QueuedProctoringEvent[] = [];
  const storage: EventBufferStorage & { persisted: () => QueuedProctoringEvent[] } = {
    async load() { return persisted; },
    async persist(events) { persisted = [...events]; },
    async clear() { persisted = []; },
    persisted: () => persisted,
  };
  return storage;
};

const POLICY = {
  attention: {
    enabled: true,
    mode: 'warn' as const,
    thresholds: {
      turnedDeg: 25,
      extreme: { yawDeg: 50, pitchDeg: 50, sustainMs: 5000 },
      // Compressed from the frozen defaults (2000ms) — the clock is fake.
      repeatedHeadPose: { minEpisodes: 3, minEpisodeMs: 60, windowMs: 60000 },
      deviation: { deg: 35, sustainMs: 4000 },
      repeatedDeviation: { minEpisodes: 4, minEpisodeMs: 1500, windowMs: 300000 },
      fallbackPadDeg: 10,
    },
  },
  focusEvents: { mode: 'warn-only' as const, minDurationMs: 2000 },
  sessionHealth: { heartbeatIntervalMs: 10 },
};

const SESSION = { shareToken: 'st', attemptId: 'a1', sessionId: 's1', guestId: 'g1' };

const setupEngine = (overrides: {
  frame?: () => SpikeFrameResult;
  readyState?: number;
  storage?: EventBufferStorage;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transport?: (payload: ProctoringBatchPayload) => Promise<any>;
} = {}) => {
  installDomStubs();
  const video = { readyState: overrides.readyState ?? 2, videoWidth: 640, videoHeight: 480 };
  const camera = makeCamera(video);
  const script = overrides.frame ?? (() => frame());
  const detector = makeDetector(script);
  const storage = overrides.storage ?? makeStorage();
  const sent: ProctoringBatchPayload[] = [];
  let clockMs = 0;
  const states: { status: string; cameraIssue: string | null }[] = [];

  const engine = new WebProctoringEngine({
    session: SESSION,
    policy: POLICY,
    attentionBaseline: { yaw: 2, pitch: -3 },
    transport: overrides.transport ?? (async (payload) => {
      sent.push(payload);
      return { outcome: { kind: 'accepted' }, actions: [], attemptFinalized: false };
    }),
    storage,
    cameraSource: camera,
    detector,
    analysisIntervalMs: 5,
    now: () => clockMs,
    onState: (s) => states.push({ status: s.status, cameraIssue: s.cameraIssue }),
  });

  // Drain microtasks between ticks — the engine's flush awaits the
  // (fake) transport; without draining, a sync time-travel loop would leave
  // `flushing` latched and skip every later flush (a harness artifact, not
  // engine behavior — browsers drain microtasks continuously).
  const drain = () => new Promise<void>((resolve) => { setImmediate(resolve); });
  const advance = async (ms: number, perTick = 10) => {
    const steps = Math.max(1, Math.round(ms / perTick));
    for (let i = 0; i < steps; i += 1) {
      clockMs += perTick;
      tickAnalysis();
      // eslint-disable-next-line no-await-in-loop
      await drain();
    }
  };

  const allSentEvents = () => sent.flatMap((p) => p.events);
  const sentTypes = () => allSentEvents().map((e) => e.type);

  return { engine, camera, detector, storage, sent, states, video, get clockMs() { return clockMs; }, advance, allSentEvents, sentTypes, fireVisibility: () => visibilityListeners.forEach((fn) => fn()) };
};

// ---- tests ------------------------------------------------------------------

beforeEach(() => { frameSeq = 0; });

describe('web proctoring engine — detection pipeline', () => {
  it('emits SESSION_STARTED at arm (a session marker, not a camera-health fact)', async () => {
    const t = setupEngine();
    await t.engine.start();
    expect(t.sentTypes()).toContain('SESSION_STARTED');
    expect(t.engine.state.status).toBe('monitoring');
  });

  it('sustained look-aways produce HEAD_POSE_TURNED occurrences + the HEAD_POSE_REPEATED marker with the server wire contract', async () => {
    let pose: { yaw: number; pitch: number } = { yaw: 2, pitch: -3 };
    const t = setupEngine({ frame: () => frame(pose) });
    await t.engine.start();

    // Three qualifying look-aways (≥ turnedDeg for ≥ minEpisodeMs), each
    // cleared long enough (ATTENTION_CLEAR_DEBOUNCE_MS) to close its segment.
    for (let look = 0; look < 3; look += 1) {
      pose = { yaw: 42, pitch: -3 }; // deliberate turn-away, well past 25°
      await t.advance(200); // 200ms ≫ minEpisodeMs 60
      pose = { yaw: 2, pitch: -3 };
      await t.advance(1300); // > the 1000ms clear-debounce
    }

    const types = t.sentTypes();
    const turned = types.filter((x) => x === 'HEAD_POSE_TURNED').length;
    const repeated = types.filter((x) => x === 'HEAD_POSE_REPEATED').length;
    expect(turned).toBeGreaterThanOrEqual(3);
    expect(repeated).toBeGreaterThanOrEqual(1);

    // Wire contract (backend eventValidation/registry): source 'cv',
    // numeric confidence 0..1 on probabilistic observations, openedAt/closedAt.
    const sample = t.allSentEvents().find((e) => e.type === 'HEAD_POSE_TURNED');
    expect(sample).toBeTruthy();
    expect(sample!.source).toBe('cv');
    expect(typeof sample!.confidence).toBe('number');
    expect(sample!.confidence!).toBeGreaterThan(0);
    expect(sample!.confidence!).toBeLessThanOrEqual(1);
    expect(sample!.openedAt).toBeLessThanOrEqual(sample!.closedAt ?? sample!.openedAt);
    expect(sample!.metadata?.basis).toBe('head_pose');
    expect(sample!.metadata?.calibration).toBe('captured');
  });

  it('normal small head movements record nothing', async () => {
    let pose: { yaw: number; pitch: number } = { yaw: 2, pitch: -3 };
    const t = setupEngine({ frame: () => frame(pose) });
    await t.engine.start();
    // Sub-threshold drift + short glances — never a look-away occurrence.
    for (let i = 0; i < 8; i += 1) {
      pose = { yaw: 2 + (i % 3) * 4, pitch: -3 };
      await t.advance(300);
    }
    const types = t.sentTypes();
    expect(types.filter((x) => x.startsWith('HEAD_POSE') || x.startsWith('ATTENTION'))).toHaveLength(0);
  });

  it('stop() closes the in-flight look-away segment (submit flush path)', async () => {
    let pose: { yaw: number; pitch: number } = { yaw: 2, pitch: -3 };
    const t = setupEngine({ frame: () => frame(pose) });
    await t.engine.start();
    pose = { yaw: 42, pitch: -3 };
    await t.advance(300);
    await t.engine.stop();
    expect(t.sentTypes()).toContain('HEAD_POSE_TURNED');
  });

  it('tab switches emit confidence-free TAB_HIDDEN episodes (deterministic registry contract)', async () => {
    const t = setupEngine();
    await t.engine.start();
    // hidden → 3s away → visible. The visibilitychange handler reads
    // document.visibilityState from the stub.
    const doc = (globalThis as { document: { visibilityState: string } }).document;
    doc.visibilityState = 'hidden';
    t.fireVisibility();
    await t.advance(3000);
    doc.visibilityState = 'visible';
    t.fireVisibility();
    const tab = t.allSentEvents().find((e) => e.type === 'TAB_HIDDEN');
    expect(tab).toBeTruthy();
    expect(tab!.confidence).toBeUndefined(); // deterministic type — no confidence
    expect(tab!.source).toBe('browser');
  });
});

describe('web proctoring engine — the 2026-10-24 field-bug regressions', () => {
  it('a granted-but-frameless video trips the frames watchdog: CAMERA_UNAVAILABLE(frames_not_flowing), degraded state — never a silent clean session', async () => {
    const t = setupEngine({ readyState: 0 }); // camera granted, frames never arrive
    await t.engine.start();
    await t.advance(11000); // past FRAMES_STALL_WARN_MS

    const point = t.allSentEvents().find((e) => e.type === 'CAMERA_UNAVAILABLE');
    expect(point).toBeTruthy();
    expect(point!.metadata?.reason).toBe('frames_not_flowing');
    const last = t.states[t.states.length - 1];
    expect(last.status).toBe('degraded');
    expect(last.cameraIssue).toBe('camera-startup');
  });

  it('frames flowing again closes the outage (duration episode + recovery to monitoring)', async () => {
    const t = setupEngine({ readyState: 0 });
    await t.engine.start();
    await t.advance(11000);
    expect(t.states[t.states.length - 1].status).toBe('degraded');

    t.video.readyState = 2;
    await t.advance(2000);
    const last = t.states[t.states.length - 1];
    expect(last.status).toBe('monitoring');
    expect(last.cameraIssue).toBeNull();
    // The tracker's signal-close episode for the outage was emitted. A
    // single-transition signal closes point-shaped (duration 0) — the same
    // tracker semantics the mobile engine stores; the diagnostic point event
    // carries the reason, the close episode carries the transition.
    const outageEpisodes = t.allSentEvents().filter((e) => e.type === 'CAMERA_UNAVAILABLE');
    expect(outageEpisodes.length).toBeGreaterThanOrEqual(2);
  });

  it('faces without pose matrices for a sustained period trip the pose watchdog (MODEL_UNAVAILABLE, pose_output_missing)', async () => {
    const t = setupEngine({ frame: () => frame({ yaw: 2, pitch: -3, noPose: true }) });
    await t.engine.start();
    // Face detected every frame, but the detector never yields a matrix.
    await t.advance(16000); // > POSE_STALL_WARN_MS
    const point = t.allSentEvents().find(
      (e) => e.type === 'MODEL_UNAVAILABLE' && e.metadata?.reason === 'pose_output_missing'
    );
    expect(point).toBeTruthy();
    // Sticky: exactly one per arm even if it persists.
    const count = t.allSentEvents().filter(
      (e) => e.type === 'MODEL_UNAVAILABLE' && e.metadata?.reason === 'pose_output_missing'
    ).length;
    await t.advance(10000);
    const countAfter = t.allSentEvents().filter(
      (e) => e.type === 'MODEL_UNAVAILABLE' && e.metadata?.reason === 'pose_output_missing'
    ).length;
    expect(count).toBe(1);
    expect(countAfter).toBe(1);
  });

  it('detector failures degrade + the heartbeat retry recovers monitoring (self-heal)', async () => {
    const t = setupEngine();
    await t.engine.start();
    t.detector.failDetect = true;
    await t.advance(100); // 3+ consecutive failures → MODEL_UNAVAILABLE + degraded
    expect(t.states[t.states.length - 1].status).toBe('degraded');
    expect(t.states[t.states.length - 1].cameraIssue).toBe('model');
    expect(t.sentTypes()).toContain('MODEL_UNAVAILABLE');

    t.detector.failDetect = false;
    await tickHeartbeat(); // retries init, closes the outage, recomputes
    const last = t.states[t.states.length - 1];
    expect(last.status).toBe('monitoring');
    expect(last.cameraIssue).toBeNull();
  });

  it('camera startup failure still records SESSION_STARTED + CAMERA_UNAVAILABLE (never silently unmonitored)', async () => {
    const t = setupEngine();
    t.camera.failWith = { kind: 'unavailable', detail: 'frames_not_flowing' };
    await t.engine.start();
    const types = t.sentTypes();
    expect(types).toContain('SESSION_STARTED');
    expect(types).toContain('CAMERA_UNAVAILABLE');
    expect(t.states[t.states.length - 1].status).toBe('degraded');
  });

  it('a midrun track-ended camera keeps the mobile outage contract (duration episode, no diagnostic point event)', async () => {
    const t = setupEngine();
    await t.engine.start();
    await t.advance(500);
    (t.camera as unknown as { issueCb?: (e: unknown) => void }).issueCb?.({ kind: 'track-ended' });
    await t.advance(500);
    await t.engine.stop();
    const cam = t.allSentEvents().filter((e) => e.type === 'CAMERA_TRACK_ENDED');
    expect(cam.length).toBe(1); // the tracker signal-close episode — mobile parity
    expect(cam[0].source).toBe('cv');
    expect(cam[0].confidence).toBeUndefined(); // deterministic technical episode
  });

  it('every enqueue persists to storage immediately (refresh durability, mobile parity)', async () => {
    // Retryable transport on the first arm: the batch is SENT but never
    // acked, so the persisted queue must still hold the events (a refresh
    // replays them with the same idempotency keys — server collapses dupes).
    const shared = makeStorage();
    const sentKeys: string[] = [];
    const t = setupEngine({
      storage: shared,
      transport: async (payload) => {
        payload.events.forEach((e) => sentKeys.push(e.idempotencyKey));
        return { outcome: { kind: 'retryable' }, actions: [], attemptFinalized: false };
      },
    });
    await t.engine.start();
    expect(shared.persisted().length).toBeGreaterThanOrEqual(1);
    await t.engine.stop();

    const second = setupEngine({ storage: shared });
    await second.engine.start({ resumed: true });
    await new Promise((resolve) => { setTimeout(resolve, 10); }); // drain the final flush
    const replayed = second.allSentEvents().map((e) => e.idempotencyKey);
    expect(replayed.some((k) => sentKeys.includes(k))).toBe(true);
  });
});
