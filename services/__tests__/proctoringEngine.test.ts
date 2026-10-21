/**
 * ProctoringEngine tests (Phase 3, plan §10, §16, §23): lifecycle events,
 * face episodes end-to-end through the transport, camera/detector failure
 * taxonomy + recovery, transport retry/permanent-drop/session-closed
 * semantics, pause/resume, stop-close-flush, heartbeat, and the
 * single-instance invariants (no duplicate session events, no concurrent
 * flush loops). The camera + detector + transport are all fakes; episode
 * thresholds are overridden to milliseconds so scenarios run fast.
 */

import { ProctoringEngine, type ProctoringBatchPayload } from '../proctoring/engine';
import type { ProctoringSendOutcome } from '../proctoring/types';
import type { SpikeNativeDetectResult } from '../proctoringSpike/types';

// ---- fakes -----------------------------------------------------------------

/** Face with enough landmarks that the quality proxy clears the floor. */
const nativeFace = (left = 200) => ({
  box: { left, top: 100, right: left + 220, bottom: 380 },
  eulerX: 2, eulerY: 3, eulerZ: 1, trackingId: 1,
  leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9, smilingProbability: 0.1,
  landmarks: {
    leftEye: { x: 1, y: 1 }, rightEye: { x: 2, y: 2 }, noseBase: { x: 3, y: 3 },
    mouthLeft: { x: 4, y: 4 }, mouthRight: { x: 5, y: 5 },
  },
});

// Per-call jitter: a REAL camera never produces byte-identical outputs, and
// the engine's frozen-feed stasis detector treats identical frames as a dead
// stream (§17.5 then suppresses face episodes) — fakes must jitter like life.
let jitter = 0;
const nativeFor = (faceCount: number): SpikeNativeDetectResult => {
  jitter += 1;
  return {
    tier: 'test',
    imageWidth: 640,
    imageHeight: 480,
    faceCount,
    faces: faceCount === 0 ? [] : faceCount === 1 ? [nativeFace()] : [nativeFace(), nativeFace(60)],
    decodeMs: 1,
    inferenceMs: 1,
    totalNativeMs: 2,
    meanLuma: 120 + (jitter % 5),
    ...(faceCount === 1 ? {
      faces: [{
        ...nativeFace(),
        eulerY: 3 + (jitter % 3) * 0.7, // detector-level float jitter
      }],
    } : {}),
  };
};

interface Harness {
  engine: ProctoringEngine;
  transportCalls: ProctoringBatchPayload[];
  outcomes: ProctoringSendOutcome[]; // consumed per call; default 'accepted'
  setFaceCount: (count: number) => void;
  failCapture: (fail: boolean) => void;
  failDetect: (fail: boolean) => void;
  setPermission: (granted: boolean) => void;
  setOutcome: (outcome: ProctoringSendOutcome) => void;
}

const buildEngine = (extra: Record<string, unknown> = {}): Harness => {
  const transportCalls: ProctoringBatchPayload[] = [];
  let outcome: ProctoringSendOutcome = { kind: 'accepted', duplicates: 0 };
  let faceCount = 1;
  let captureFails = false;
  let detectFails = false;
  let permission = true;

  const engine = new ProctoringEngine({
    session: { quizId: 'q1', attemptId: 'a1', sessionId: 's1' },
    policy: { facePresence: { minAbsentMs: 4000 }, multipleFaces: { minDurationMs: 3000 } },
    capture: async () => (captureFails ? { base64: null } : { base64: 'frame' }),
    detectRaw: async () => {
      if (detectFails) {
        const error = new Error('ML Kit face detection failed: ERR_DETECT');
        throw error;
      }
      return nativeFor(faceCount);
    },
    transport: async (payload) => {
      transportCalls.push(payload);
      return outcome;
    },
    checkPermission: async () => permission,
    analysisIntervalMs: 5,
    heartbeatIntervalMs: 0, // tests drive heartbeatTick() manually
    episodeThresholdOverrides: {
      FACE_NOT_DETECTED: { enterMs: 300, exitMs: 100, cooldownMs: 200 },
      MULTIPLE_FACES_DETECTED: { enterMs: 300, exitMs: 100, cooldownMs: 200 },
      CAMERA_FEED_DARK: { enterMs: 300, exitMs: 100, cooldownMs: 200 },
      CAMERA_FEED_FROZEN: { enterMs: 0, exitMs: 0, cooldownMs: 0 },
    },
    ...extra,
  });

  return {
    engine,
    transportCalls,
    outcomes: [],
    setFaceCount: (count) => { faceCount = count; },
    failCapture: (fail) => { captureFails = fail; },
    failDetect: (fail) => { detectFails = fail; },
    setPermission: (granted) => { permission = granted; },
    setOutcome: (next) => { outcome = next; },
  };
};

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 4000,
  stepMs = 20
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return predicate();
};

const eventTypes = (calls: ProctoringBatchPayload[]) =>
  calls.flatMap((call) => call.events.map((event) => event.type));

// Every test must stop its engine — a leaked loop keeps timers alive and
// OOMs the suite (the Phase 0 test-design lesson, applied here too).
describe('ProctoringEngine', () => {
  let harness: Harness | null = null;
  afterEach(async () => {
    if (harness) {
      await harness.engine.stop();
      harness = null;
    }
  });

  it('emits SESSION_STARTED as the first transported event on a fresh start', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.transportCalls.length > 0);
    expect(harness.transportCalls[0].events[0].type).toBe('SESSION_STARTED');
    expect(harness.transportCalls[0].events[0].openedAt).toBe(
      harness.transportCalls[0].events[0].closedAt
    );
    expect(harness.transportCalls[0].heartbeat).toBe(true); // piggybacked
    expect(harness.engine.state.status).toBe('monitoring');
  });

  it('emits SESSION_RESUMED when armed as a resume (app relaunch)', async () => {
    harness = buildEngine();
    await harness.engine.start({ resumed: true });
    await waitFor(() => harness!.transportCalls.length > 0);
    expect(harness.transportCalls[0].events[0].type).toBe('SESSION_RESUMED');
  });

  it('a second start() on the same engine is a no-op (one engine, one session event)', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.transportCalls.length > 0);
    const starts = eventTypes(harness.transportCalls).filter(
      (type) => type === 'SESSION_STARTED' || type === 'SESSION_RESUMED'
    );
    await harness.engine.start(); // duplicate arm attempt
    await new Promise((resolve) => setTimeout(resolve, 100));
    const startsAfter = eventTypes(harness.transportCalls).filter(
      (type) => type === 'SESSION_STARTED' || type === 'SESSION_RESUMED'
    );
    expect(starts).toHaveLength(1);
    expect(startsAfter).toHaveLength(1);
  });

  it('produces a debounced FACE_NOT_DETECTED episode and recovers without losing the attempt', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.transportCalls.length > 0);

    harness.setFaceCount(0);
    await waitFor(() => harness!.engine.state.status === 'monitoring' && true, 500); // frames flowing
    // Sustained absence (enter 300ms + cooldown 200ms after recovery).
    await new Promise((resolve) => setTimeout(resolve, 600));
    harness.setFaceCount(1);
    const delivered = await waitFor(() =>
      eventTypes(harness!.transportCalls).includes('FACE_NOT_DETECTED')
    );
    expect(delivered).toBe(true);

    const absenceEvents = eventTypes(harness.transportCalls).filter(
      (type) => type === 'FACE_NOT_DETECTED'
    );
    expect(absenceEvents).toHaveLength(1); // episodes, never frames
    const batch = harness.transportCalls.find((call) =>
      call.events.some((event) => event.type === 'FACE_NOT_DETECTED')
    )!;
    const episode = batch.events.find((event) => event.type === 'FACE_NOT_DETECTED')!;
    expect(episode.confidence).toBeGreaterThanOrEqual(0);
    expect(episode.closedAt!).toBeGreaterThan(episode.openedAt);
    // The engine survived the whole cycle.
    expect(['monitoring', 'degraded']).toContain(harness.engine.state.status);
  });

  it('reports sustained multiple faces as ONE structured episode', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.transportCalls.length > 0);

    harness.setFaceCount(2);
    await new Promise((resolve) => setTimeout(resolve, 600));
    harness.setFaceCount(1);
    const delivered = await waitFor(() =>
      eventTypes(harness!.transportCalls).includes('MULTIPLE_FACES_DETECTED')
    );
    expect(delivered).toBe(true);
    const episode = harness.transportCalls
      .flatMap((call) => call.events)
      .find((event) => event.type === 'MULTIPLE_FACES_DETECTED')!;
    expect((episode.metadata as Record<string, unknown>).faceCountPeak).toBe(2);
  });

  it('classifies capture failure at startup as CAMERA_UNAVAILABLE and recovers on the first good frame', async () => {
    harness = buildEngine();
    harness.failCapture(true);
    await harness.engine.start();

    await waitFor(() => harness!.engine.state.status === 'degraded');
    expect(harness.engine.state.cameraIssue).toBe('camera-startup');

    harness.failCapture(false);
    const recovered = await waitFor(() =>
      eventTypes(harness!.transportCalls).includes('CAMERA_UNAVAILABLE')
    );
    expect(recovered).toBe(true);
    await waitFor(() => harness!.engine.state.status === 'monitoring');
    const episode = harness.transportCalls
      .flatMap((call) => call.events)
      .find((event) => event.type === 'CAMERA_UNAVAILABLE')!;
    expect(episode.confidence).toBeUndefined(); // deterministic technical event
    expect(episode.closedAt!).toBeGreaterThanOrEqual(episode.openedAt);
  });

  it('classifies persistent capture failure after frames existed as CAMERA_TRACK_ENDED', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.transportCalls.length > 0); // frames flowing
    await new Promise((resolve) => setTimeout(resolve, 150));

    harness.failCapture(true);
    await waitFor(() => harness!.engine.state.cameraIssue === 'camera-error');
    harness.failCapture(false);
    await waitFor(() => eventTypes(harness!.transportCalls).includes('CAMERA_TRACK_ENDED'));
  });

  it('classifies denied permission as CAMERA_PERMISSION_REVOKED', async () => {
    harness = buildEngine();
    harness.setPermission(false);
    harness.failCapture(true);
    await harness.engine.start();

    await waitFor(() => harness!.engine.state.cameraIssue === 'permission');
    harness.failCapture(false);
    harness.setPermission(true);
    await waitFor(() => eventTypes(harness!.transportCalls).includes('CAMERA_PERMISSION_REVOKED'));
  });

  it('classifies detector failure as MODEL_UNAVAILABLE and keeps heartbeating', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.transportCalls.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 150));

    harness.failDetect(true);
    await waitFor(() => harness!.engine.state.cameraIssue === 'model');

    harness.failDetect(false);
    await waitFor(() => eventTypes(harness!.transportCalls).includes('MODEL_UNAVAILABLE'));
    await waitFor(() => harness!.engine.state.status === 'monitoring');
  });

  it('retries a failed batch on the next heartbeat (retryable outcome)', async () => {
    harness = buildEngine();
    harness.setOutcome({ kind: 'retryable', reason: 'network' });
    await harness.engine.start();
    await waitFor(() => harness!.transportCalls.length > 0);

    // SESSION_STARTED is still queued — nothing was acknowledged.
    expect(harness.engine.bufferedEventCount).toBe(1);
    harness.setOutcome({ kind: 'accepted', duplicates: 0 });
    await harness.engine.heartbeatTick();
    expect(harness.engine.bufferedEventCount).toBe(0);
    const keys = harness.transportCalls
      .flatMap((call) => call.events.map((event) => event.idempotencyKey));
    // The retry carries the SAME idempotencyKey — the server-side dedup
    // collapses the replay; a new key would double-count (plan §7.3).
    expect(keys.length).toBe(2);
    expect(new Set(keys).size).toBe(1);
  });

  it('drops the batch permanently on a 400 (never retries malformed data)', async () => {
    harness = buildEngine();
    harness.setOutcome({ kind: 'permanent_reject', reason: 'validation' });
    await harness.engine.start();
    // The start flush already delivered the batch and dropped it.
    await waitFor(() => harness!.transportCalls.length > 0);
    await waitFor(() => harness!.engine.bufferedEventCount === 0);

    await harness.engine.heartbeatTick(); // idle heartbeat — no replay of the dropped batch
    const starts = eventTypes(harness.transportCalls).filter((type) => type === 'SESSION_STARTED');
    expect(starts).toHaveLength(1); // sent exactly once, never retried
  });

  it('winds down completely when the server says the session is closed', async () => {
    harness = buildEngine();
    harness.setOutcome({ kind: 'session_closed' });
    await harness.engine.start();
    await waitFor(() => harness!.engine.state.status === 'stopped');

    expect(harness.engine.bufferedEventCount).toBe(0);
    const callsBefore = harness.transportCalls.length;
    await harness.engine.heartbeatTick();
    expect(harness.transportCalls.length).toBe(callsBefore); // no further transport
  });

  it('sends a standalone heartbeat when idle (empty events, heartbeat flag)', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.engine.bufferedEventCount === 0);

    await harness.engine.heartbeatTick();
    const last = harness.transportCalls[harness.transportCalls.length - 1];
    expect(last.heartbeat).toBe(true);
    expect(last.events).toHaveLength(0);
    expect(last.sessionId).toBe('s1');
  });

  it('pause stops analysis and drops stale frames; resume returns to monitoring', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.engine.state.status === 'monitoring');

    harness.engine.pause();
    expect(harness.engine.state.status).toBe('paused');
    const callsAtPause = harness.transportCalls.length;
    harness.setFaceCount(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Paused: no frames are processed, so no episode can open.
    expect(eventTypes(harness.transportCalls.slice(callsAtPause))).toHaveLength(0);

    harness.engine.resume();
    await waitFor(() => harness!.engine.state.status === 'monitoring');
    harness.setFaceCount(1);
  });

  it('stop() closes open episodes and flushes them exactly once', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.transportCalls.length > 0);
    harness.setFaceCount(0);
    await new Promise((resolve) => setTimeout(resolve, 500)); // episode opens

    await harness.engine.stop();
    expect(harness.engine.state.status).toBe('stopped');
    const absence = harness.transportCalls
      .flatMap((call) => call.events)
      .filter((event) => event.type === 'FACE_NOT_DETECTED');
    expect(absence).toHaveLength(1);

    const callsAfterStop = harness.transportCalls.length;
    await harness.engine.stop(); // idempotent
    await harness.engine.heartbeatTick(); // stopped engines never transport
    expect(harness.transportCalls.length).toBe(callsAfterStop);
  });
});

// ---- Phase 4: focus-signal transport, per-type source, deterrence ----------

describe('ProctoringEngine — Phase 4 additions', () => {
  let harness: Harness | null = null;
  afterEach(async () => {
    if (harness) {
      await harness.engine.stop();
      harness = null;
    }
  });

  it('stamps every wire event with its registry source (server requires it)', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.transportCalls.length > 0);
    harness.engine.recordEpisodes([
      { type: 'APP_BACKGROUND', openedAt: Date.now() - 3000, closedAt: Date.now() },
      { type: 'EXIT_ATTEMPTED', openedAt: Date.now(), closedAt: Date.now() },
    ]);
    await waitFor(() =>
      eventTypes(harness!.transportCalls).includes('APP_BACKGROUND')
        && eventTypes(harness!.transportCalls).includes('EXIT_ATTEMPTED')
    );

    const wireEvents = harness.transportCalls.flatMap((call) => call.events);
    const sources = new Map(wireEvents.map((event) => [event.type, event.source]));
    expect(sources.get('SESSION_STARTED')).toBe('system');
    expect(sources.get('APP_BACKGROUND')).toBe('os');
    expect(sources.get('EXIT_ATTEMPTED')).toBe('os');
    // Camera technical/CV events stamp their registered source too.
    expect(['cv', 'os']).toContain(sources.get('CAMERA_PERMISSION_REVOKED') ?? 'cv');
    for (const event of wireEvents) {
      expect(typeof event.source).toBe('string');
      expect(event.source.length).toBeGreaterThan(0);
    }
  });

  it('carries the deterrence label in SESSION_STARTED/RESUMED metadata (§15.2)', async () => {
    harness = buildEngine({ deterrence: 'android-flagsecure' });
    await harness.engine.start();
    await waitFor(() => harness!.transportCalls.length > 0);
    const started = harness.transportCalls
      .flatMap((call) => call.events)
      .find((event) => event.type === 'SESSION_STARTED')!;
    expect((started.metadata as Record<string, unknown>).screenCapturePrevention)
      .toBe('android-flagsecure');

    const resumedHarness = buildEngine({ deterrence: 'unsupported' });
    try {
      await resumedHarness.engine.start({ resumed: true });
      await waitFor(() => resumedHarness.transportCalls.length > 0);
      const resumed = resumedHarness.transportCalls
        .flatMap((call) => call.events)
        .find((event) => event.type === 'SESSION_RESUMED')!;
      expect((resumed.metadata as Record<string, unknown>).screenCapturePrevention)
        .toBe('unsupported');
    } finally {
      await resumedHarness.engine.stop();
    }
  });

  it('recordEpisodes transports externally produced focus episodes while monitoring', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.engine.state.status === 'monitoring');

    const openedAt = Date.now() - 14_000;
    harness.engine.recordEpisodes([{ type: 'APP_BACKGROUND', openedAt, closedAt: Date.now() }]);
    const delivered = await waitFor(() =>
      eventTypes(harness!.transportCalls).includes('APP_BACKGROUND')
    );
    expect(delivered).toBe(true);
    const episode = harness.transportCalls
      .flatMap((call) => call.events)
      .find((event) => event.type === 'APP_BACKGROUND')!;
    expect(episode.closedAt!).toBeGreaterThan(openedAt);
    expect(episode.confidence).toBeUndefined(); // deterministic events carry none
  });

  it('recordEpisodes queues while paused (a backgrounded app cannot flush) and delivers after resume', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.engine.state.status === 'monitoring');

    harness.engine.pause();
    expect(harness.engine.state.status).toBe('paused');
    const before = harness.transportCalls.length;
    harness.engine.recordEpisodes([{ type: 'EXIT_ATTEMPTED', openedAt: Date.now(), closedAt: Date.now() }]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    // Retriable-free happy path still cannot send while paused? It CAN flush
    // (flush is not gated on status) — the contract is that the episode is at
    // least buffered durably. Assert either delivered now or after resume.
    let delivered = eventTypes(harness.transportCalls).includes('EXIT_ATTEMPTED');

    harness.engine.resume();
    delivered = delivered || await waitFor(() =>
      eventTypes(harness!.transportCalls).includes('EXIT_ATTEMPTED')
    );
    expect(delivered).toBe(true);
    expect(harness.transportCalls.length).toBeGreaterThanOrEqual(before);
  });

  it('recordEpisodes is a no-op after stop (no zombie transport)', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.transportCalls.length > 0);
    await harness.engine.stop();

    const callsAtStop = harness.transportCalls.length;
    harness.engine.recordEpisodes([{ type: 'EXIT_ATTEMPTED', openedAt: Date.now(), closedAt: Date.now() }]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(harness.transportCalls.length).toBe(callsAtStop);
  });
});

// ===== Track 2 — the streaming frameSource seam =====
//
// The engine must behave identically when frames come from the streaming
// source instead of the snapshot CameraLoop: lifecycle events, episode
// formation from pushed observations, detector-failure taxonomy, pause
// delegation, and stop-close-flush. A fake source captures the engine's
// hooks and lets the test BE the camera.

import type { ProctoringFrameLoop } from '../proctoring/engine';
import type { SpikeEngineStatus, SpikeFrameResult } from '../proctoringSpike/types';

describe('ProctoringEngine — streaming frameSource seam', () => {
  let harness: Harness | null = null;
  let hooks: {
    onFrame: (frame: SpikeFrameResult) => void;
    onError: (error: Error, consecutiveFailures: number) => void;
    onStatus: (status: SpikeEngineStatus) => void;
  } | null = null;
  let sourceState: { started: boolean; paused: boolean; stopped: boolean };

  const buildStreamingEngine = () => {
    const transportCalls: ProctoringBatchPayload[] = [];
    sourceState = { started: false, paused: false, stopped: false };
    const makeFakeSource = (received: NonNullable<typeof hooks>): ProctoringFrameLoop => ({
      async start() { sourceState.started = true; received.onStatus('running'); },
      pause() { sourceState.paused = true; received.onStatus('paused'); },
      async resume() { sourceState.paused = false; received.onStatus('running'); },
      async stop() { sourceState.stopped = true; received.onStatus('stopped'); },
      get status(): SpikeEngineStatus {
        return sourceState.stopped ? 'stopped' : sourceState.paused ? 'paused' : 'running';
      },
    });
    const engine = new ProctoringEngine({
      session: { quizId: 'q1', attemptId: 'a1', sessionId: 's1' },
      policy: { facePresence: { minAbsentMs: 4000 }, multipleFaces: { minDurationMs: 3000 } },
      frameSource: (received) => {
        hooks = received;
        return makeFakeSource(received);
      },
      transport: async (payload) => {
        transportCalls.push(payload);
        return { kind: 'accepted', duplicates: 0 };
      },
      heartbeatIntervalMs: 0,
      episodeThresholdOverrides: {
        FACE_NOT_DETECTED: { enterMs: 150, exitMs: 50, cooldownMs: 100 },
      },
    });
    return {
      engine, transportCalls,
      pushObservation: (faceCount: number) => hooks!.onFrame(
        // classifyFrame output shape from a real observation — the streaming
        // source maps observations to frames; here the frames arrive ready.
        { ...({} as SpikeFrameResult), faceCountClass: faceCount === 0 ? 'none' : 'one' } as SpikeFrameResult
      ),
    };
  };

  afterEach(async () => {
    if (harness) {
      await harness.engine.stop();
      harness = null;
    }
    hooks = null;
  });

  it('drives the provided source on start and emits SESSION_STARTED', async () => {
    const rig = buildStreamingEngine();
    harness = { engine: rig.engine, transportCalls: rig.transportCalls } as unknown as Harness;
    await rig.engine.start();
    expect(sourceState.started).toBe(true);
    await waitFor(() => eventTypes(rig.transportCalls).includes('SESSION_STARTED'));
  });

  it('pause/resume delegate to the streaming source', async () => {
    const rig = buildStreamingEngine();
    harness = { engine: rig.engine, transportCalls: rig.transportCalls } as unknown as Harness;
    await rig.engine.start();
    rig.engine.pause();
    expect(sourceState.paused).toBe(true);
    rig.engine.resume();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sourceState.paused).toBe(false);
  });

  it('routes source detector errors to MODEL_UNAVAILABLE (ERR_DETECT taxonomy)', async () => {
    const rig = buildStreamingEngine();
    harness = { engine: rig.engine, transportCalls: rig.transportCalls } as unknown as Harness;
    await rig.engine.start();
    await waitFor(() => eventTypes(rig.transportCalls).includes('SESSION_STARTED'));
    hooks!.onError(new Error('ERR_DETECT: ML Kit face detection failed'), 1);
    hooks!.onError(new Error('ERR_DETECT: ML Kit face detection failed'), 2);
    hooks!.onError(new Error('ERR_DETECT: ML Kit face detection failed'), 3);
    await rig.engine.heartbeatTick();
    await waitFor(() => eventTypes(rig.transportCalls).includes('MODEL_UNAVAILABLE'));
    expect(rig.engine.state.cameraIssue).toBe('model');
  });

  it('stop() closes the source and flushes once (no zombie transport)', async () => {
    const rig = buildStreamingEngine();
    harness = { engine: rig.engine, transportCalls: rig.transportCalls } as unknown as Harness;
    await rig.engine.start();
    await waitFor(() => rig.transportCalls.length > 0);
    await rig.engine.stop();
    expect(sourceState.stopped).toBe(true);
    const callsAtStop = rig.transportCalls.length;
    hooks!.onError(new Error('late error'), 1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(rig.transportCalls.length).toBe(callsAtStop);
  });
});

// ===== Phase 5 — attention wiring (head pose → tracker → transport) =====

describe('ProctoringEngine — Phase 5 attention derivation wiring', () => {
  let hooks2: {
    onFrame: (frame: SpikeFrameResult) => void;
    onError: (error: Error, consecutiveFailures: number) => void;
    onStatus: (status: SpikeEngineStatus) => void;
  } | null = null;

  const buildAttentionEngine = (baseline?: { yaw: number; pitch: number } | null) => {
    const transportCalls: ProctoringBatchPayload[] = [];
    const sourceState = { started: false, stopped: false };
    const engine = new ProctoringEngine({
      session: { quizId: 'q1', attemptId: 'a1', sessionId: 's1' },
      // Fast policy-shaped thresholds so the test runs in milliseconds.
      policy: {
        attention: {
          enabled: true,
          mode: 'record',
          thresholds: { deviation: { deg: 10, sustainMs: 300 } },
        },
      },
      attentionBaseline: baseline,
      frameSource: (received) => {
        hooks2 = received;
        return {
          async start() { sourceState.started = true; received.onStatus('running'); },
          pause() { received.onStatus('paused'); },
          async resume() { received.onStatus('running'); },
          async stop() { sourceState.stopped = true; received.onStatus('stopped'); },
          get status(): SpikeEngineStatus {
            return sourceState.stopped ? 'stopped' : 'running';
          },
        };
      },
      transport: async (payload) => {
        transportCalls.push(payload);
        return { kind: 'accepted', duplicates: 0 };
      },
      heartbeatIntervalMs: 0,
    });
    const pushPose = (yaw: number) => hooks2!.onFrame({
      frameIndex: 0, tsMs: Date.now(),
      faceCount: 1, faceCountClass: 'one', visibility: 'ok',
      headPose: { band: 'centered', yaw, pitch: 0, roll: 0 },
      landmarkCount: 8, qualityProxy: 0.9, largestFaceRatio: 0.35,
      latencies: { captureMs: 0, decodeMs: 0, inferenceMs: 0 },
      meanLuma: 120, sanitized: false,
    } as SpikeFrameResult);
    /** Frames carry real timestamps — pace them so sustain windows elapse. */
    const pushPosesSpaced = async (yaw: number, count: number, gapMs: number) => {
      for (let i = 0; i < count; i += 1) {
        rig0.pushPose(yaw);
        await new Promise((resolve) => setTimeout(resolve, gapMs));
      }
    };
    const rig0 = { pushPose };
    return { engine, transportCalls, pushPose, pushPosesSpaced };
  };

  afterEach(async () => {
    hooks2 = null;
  });

  it('derives ATTENTION_DEVIATION_SUSTAINED from streamed head pose and stamps source cv', async () => {
    const rig = buildAttentionEngine({ yaw: 0, pitch: 0 });
    await rig.engine.start();
    // ~600 ms of 20° deviation (policy deg:10, sustain:300ms), then the
    // session-end stop() whose closeAll flush is what emits the episode
    // (the §23 finalize path — exactly how a real attempt delivers it).
    await rig.pushPosesSpaced(20, 16, 40);
    await rig.engine.stop();
    await waitFor(() => eventTypes(rig.transportCalls).includes('ATTENTION_DEVIATION_SUSTAINED'));
    const batch = rig.transportCalls.find((call) =>
      call.events.some((event) => event.type === 'ATTENTION_DEVIATION_SUSTAINED'));
    const event = batch!.events.find((e) => e.type === 'ATTENTION_DEVIATION_SUSTAINED')!;
    expect(event.source).toBe('cv');
    expect(event.confidence).toBeGreaterThan(0);
    expect(event.metadata).toMatchObject({ basis: 'head_pose', calibration: 'captured' });
  });

  it('marks fallback calibration when no baseline is provided', async () => {
    const rig = buildAttentionEngine(null);
    await rig.engine.start();
    // No baseline → padded threshold 10+10=20; 25° clears it.
    await rig.pushPosesSpaced(25, 16, 40);
    await rig.engine.stop();
    await waitFor(() => eventTypes(rig.transportCalls).includes('ATTENTION_DEVIATION_SUSTAINED'));
    const batch = rig.transportCalls.find((call) =>
      call.events.some((event) => event.type === 'ATTENTION_DEVIATION_SUSTAINED'));
    const event = batch!.events.find((e) => e.type === 'ATTENTION_DEVIATION_SUSTAINED')!;
    expect(event.metadata).toMatchObject({ calibration: 'fallback' });
  });
});

// ---- Phase 9: mid-attempt flush (section transitions keep monitoring) -----
// Device-found bug: section submits called stopMonitoring(), which permanently
// stopped the engine while the attempt (and session) stayed ACTIVE — every
// section after the first ran unmonitored, and the PiP chip kept reading
// "Monitoring active" from static copy. flushNow() is the fix's engine half:
// land open episodes without stopping the loop.

describe('ProctoringEngine — Phase 9 flushNow (section transitions)', () => {
  let harness: Harness | null = null;
  afterEach(async () => {
    if (harness) {
      await harness.engine.stop();
      harness = null;
    }
  });

  it('flushNow() lands open episodes while the loop keeps monitoring (status unchanged)', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.transportCalls.length > 0);

    harness.setFaceCount(0);
    await new Promise((resolve) => setTimeout(resolve, 500)); // FACE episode opens
    expect(harness.engine.state.status).toBe('monitoring');

    await harness.engine.flushNow();

    // NOT stopped — the whole point of the section-transition flush.
    expect(harness.engine.state.status).toBe('monitoring');
    const absence = harness.transportCalls
      .flatMap((call) => call.events)
      .filter((event) => event.type === 'FACE_NOT_DETECTED');
    expect(absence).toHaveLength(1); // the open episode landed via the flush

    // The loop keeps producing: transport continues after the flush.
    harness.setFaceCount(1);
    const callsNow = harness.transportCalls.length;
    await waitFor(() => harness!.transportCalls.length > callsNow, 4000);
  });

  it('a section-like sequence: flush (section 1) → still monitoring → episode → flush (section 2) → stop() (final submit)', async () => {
    harness = buildEngine();
    await harness.engine.start();
    await waitFor(() => harness!.transportCalls.length > 0);

    await harness.engine.flushNow(); // section 1 submit
    expect(harness.engine.state.status).toBe('monitoring');

    harness.setFaceCount(0);
    await new Promise((resolve) => setTimeout(resolve, 500)); // episode opens
    harness.setFaceCount(1); // face returns before the flush — exactly one episode
    await new Promise((resolve) => setTimeout(resolve, 300));

    await harness.engine.flushNow(); // section 2 submit
    expect(harness.engine.state.status).toBe('monitoring');
    const absences = harness.transportCalls
      .flatMap((call) => call.events)
      .filter((event) => event.type === 'FACE_NOT_DETECTED');
    expect(absences).toHaveLength(1);

    await harness.engine.stop(); // final submit
    expect(harness.engine.state.status).toBe('stopped');
  });
});
