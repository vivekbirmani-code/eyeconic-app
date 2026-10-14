/**
 * StreamingCameraSource unit tests (Track 2b Phase 3, plan §43.3): the source
 * now DRIVES the headless module transport — subscribe-before-start ordering,
 * start/pause/resume/stop lifecycle against an injected fake binding, the
 * pause-reassert race guard, the stop-during-start release, event→frame
 * mapping through the SAME classifyFrame sanitizer, error taxonomy routing
 * (start_failed included, no dedup of the duplicated native failure), degraded
 * status, and no-callbacks-after-stop semantics. Pure node-env: the native
 * module is faked through the injectable binding.
 */

import {
  StreamingCameraSource,
  ProctoringStreamBinding,
} from '../proctoring/streamingCameraSource';
import type { SpikeNativeDetectResult } from '../proctoringSpike/types';

const oneFaceObservation = (overrides: Partial<SpikeNativeDetectResult> = {}): SpikeNativeDetectResult => ({
  tier: 'mlkit-face-detection',
  imageWidth: 640,
  imageHeight: 480,
  faceCount: 1,
  faces: [{
    box: { left: 200, top: 100, right: 400, bottom: 350 },
    eulerX: 0, eulerY: 0, eulerZ: 0,
    trackingId: 1,
    leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9, smilingProbability: 0.1,
    landmarks: {},
  }],
  decodeMs: 0,
  inferenceMs: 200,
  totalNativeMs: 205,
  meanLuma: 120,
  frameTimestampMs: Date.now(),
  ...overrides,
});

type BindingHandlers = Parameters<ProctoringStreamBinding['subscribeStreamEvents']>[0];

const createFakeBinding = () => {
  const calls: string[] = [];
  const native = {
    startCalls: 0,
    stopCalls: 0,
    paused: null as boolean | null,
    startOptions: null as { minIntervalMs?: number } | null,
  };
  let handlers: BindingHandlers = {};
  const binding: ProctoringStreamBinding = {
    async startStreaming(options) {
      calls.push('start');
      native.startCalls += 1;
      native.startOptions = options;
      return { ok: true, transportRevision: '2b-1' };
    },
    async stopStreaming() {
      calls.push('stop');
      native.stopCalls += 1;
    },
    setStreamingPaused(paused) {
      calls.push(paused ? 'pause' : 'unpause');
      native.paused = paused;
    },
    subscribeStreamEvents(next) {
      calls.push('subscribe');
      handlers = next;
      return {
        remove: () => {
          calls.push('unsubscribe');
          handlers = {};
        },
      };
    },
  };
  return {
    binding,
    calls,
    native,
    emit: (result: SpikeNativeDetectResult) => handlers.onFrameObservation?.(result),
    emitError: (error: { code: string; message: string }) => handlers.onCameraError?.(error),
    hasHandlers: () => Object.keys(handlers).length > 0,
  };
};

const withSource = async (
  fn: (source: StreamingCameraSource, capture: {
    frames: any[]; errors: { error: Error; consecutive: number }[]; statuses: string[];
  }, fake: ReturnType<typeof createFakeBinding>) => Promise<void>
) => {
  const frames: any[] = [];
  const errors: { error: Error; consecutive: number }[] = [];
  const statuses: string[] = [];
  const fake = createFakeBinding();
  const source = new StreamingCameraSource({
    onFrame: (frame) => frames.push(frame),
    onError: (error, consecutive) => errors.push({ error, consecutive }),
    onStatus: (status) => statuses.push(status),
    binding: fake.binding,
  });
  await source.start();
  await fn(source, { frames, errors, statuses }, fake);
  await source.stop();
};

describe('StreamingCameraSource — module transport lifecycle', () => {
  test('subscribes BEFORE starting the native stream (§43.1 ordering)', async () => {
    await withSource(async (_source, _capture, fake) => {
      expect(fake.calls.slice(0, 2)).toEqual(['subscribe', 'start']);
    });
  });

  test('starts the native stream with the view transport cadence (250 ms)', async () => {
    await withSource(async (_source, _capture, fake) => {
      expect(fake.native.startOptions).toEqual({ minIntervalMs: 250 });
    });
  });

  test('teardown order: unsubscribe → clear pause → stop native stream', async () => {
    const fake = createFakeBinding();
    const statuses: string[] = [];
    const source = new StreamingCameraSource({
      onFrame: () => {}, onError: () => {}, onStatus: (s) => statuses.push(s),
      binding: fake.binding,
    });
    await source.start();
    await source.stop();
    const tail = fake.calls.slice(-3);
    expect(tail).toEqual(['unsubscribe', 'unpause', 'stop']);
    expect(fake.native.paused).toBe(false);
    expect(fake.native.stopCalls).toBe(1);
  });

  test('pause drops incoming frames natively and locally; resume delivers fresh ones', async () => {
    await withSource(async (source, { frames }, fake) => {
      source.pause();
      expect(fake.native.paused).toBe(true);
      fake.emit(oneFaceObservation()); // dropped — no stale frame ever delivered
      expect(frames).toHaveLength(0);

      await source.resume();
      expect(fake.native.paused).toBe(false);
      fake.emit(oneFaceObservation());
      expect(frames).toHaveLength(1);
      expect(frames[0].frameIndex).toBe(1);
    });
  });

  test('a bind racing a pause re-asserts the pause once it resolves', async () => {
    const fake = createFakeBinding();
    const statuses: string[] = [];
    let resolveStart!: (value: unknown) => void;
    fake.binding.startStreaming = () => new Promise((resolve) => { resolveStart = resolve; });
    const source = new StreamingCameraSource({
      onFrame: () => {}, onError: () => {}, onStatus: (s) => statuses.push(s),
      binding: fake.binding,
    });
    const startPromise = source.start();
    source.pause(); // engine paused while the bind was still in flight
    expect(statuses).toEqual(['running', 'paused']);
    resolveStart({ ok: true });
    await startPromise;
    expect(fake.native.paused).toBe(true); // re-asserted, not lost
  });

  test('a bind racing a stop releases the native runtime once it resolves', async () => {
    const fake = createFakeBinding();
    const statuses: string[] = [];
    let resolveStart!: (value: unknown) => void;
    fake.binding.startStreaming = () => new Promise((resolve) => { resolveStart = resolve; });
    const source = new StreamingCameraSource({
      onFrame: () => {}, onError: () => {}, onStatus: (s) => statuses.push(s),
      binding: fake.binding,
    });
    const startPromise = source.start();
    await source.stop(); // runs before the bind resolves
    resolveStart({ ok: true });
    await startPromise;
    // stop()'s own release ran pre-bind; the start continuation releases the
    // now-bound camera — two calls by design (native stop is idempotent and
    // generation-guarded, §43.1).
    expect(fake.native.stopCalls).toBe(2);
    expect(fake.hasHandlers()).toBe(false); // subscription dropped
    expect(statuses[statuses.length - 1]).toBe('stopped');
  });

  test('a rejected start rides the error taxonomy as ERR_CAMERA_start_failed', async () => {
    const fake = createFakeBinding();
    fake.binding.startStreaming = async () => { throw new Error('camera_in_use'); };
    const errors: { error: Error; consecutive: number }[] = [];
    const statuses: string[] = [];
    const source = new StreamingCameraSource({
      onFrame: () => {},
      onError: (error, consecutive) => errors.push({ error, consecutive }),
      onStatus: (s) => statuses.push(s),
      binding: fake.binding,
    });
    await source.start();
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toBe('ERR_CAMERA_start_failed: camera_in_use');
    expect(errors[0].consecutive).toBe(1);
    // The same native failure also arrives via onCameraError — both are real
    // events, no dedup (honest double delivery, spike-screen semantics).
    fake.emitError({ code: 'camera_in_use', message: 'camera_in_use' });
    expect(errors).toHaveLength(2);
    expect(errors[1].consecutive).toBe(2);
  });

  test('a rejected stop never surfaces as an error or resurrects callbacks', async () => {
    const fake = createFakeBinding();
    fake.binding.stopStreaming = async () => { throw new Error('native teardown glitch'); };
    const errors: { error: Error; consecutive: number }[] = [];
    const source = new StreamingCameraSource({
      onFrame: () => {},
      onError: (error, consecutive) => errors.push({ error, consecutive }),
      onStatus: () => {},
      binding: fake.binding,
    });
    await source.start();
    await expect(source.stop()).resolves.toBeUndefined();
    expect(errors).toHaveLength(0);
    expect(source.status).toBe('stopped');
  });
});

describe('StreamingCameraSource — event→frame mapping', () => {
  test('observations map to classified frames with the shared sanitizer shape', async () => {
    await withSource(async (_source, { frames }, fake) => {
      fake.emit(oneFaceObservation());
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({
        faceCount: 1,
        faceCountClass: 'one',
        visibility: 'ok',
        frameIndex: 1,
        latencies: {
          captureMs: 0,   // no photograph was taken
          decodeMs: 0,    // no JPEG round-trip
          inferenceMs: 200,
        },
      });
      expect(typeof frames[0].meanLuma).toBe('number');
    });
  });

  test('frameIndex sequences across delivered observations', async () => {
    await withSource(async (_source, { frames }, fake) => {
      fake.emit(oneFaceObservation());
      fake.emit(oneFaceObservation());
      fake.emit(oneFaceObservation());
      expect(frames.map((f: any) => f.frameIndex)).toEqual([1, 2, 3]);
    });
  });

  test('malformed native payloads are sanitized, never thrown', async () => {
    await withSource(async (_source, { frames }, fake) => {
      fake.emit(oneFaceObservation({
        faces: 'not-an-array' as unknown as SpikeNativeDetectResult['faces'],
        faceCount: Number.NaN,
      }));
      expect(frames).toHaveLength(1);
      expect(frames[0].faceCountClass).toBe('none');
    });
  });

  test('frames missing a native timestamp fall back to wall clock', async () => {
    await withSource(async (_source, { frames }, fake) => {
      const before = Date.now();
      fake.emit(oneFaceObservation({ frameTimestampMs: undefined }));
      expect(frames[0].tsMs).toBeGreaterThanOrEqual(before);
    });
  });
});

describe('StreamingCameraSource — error taxonomy and degraded status', () => {
  test('camera codes stay camera errors; detect_failed routes to the detector taxonomy', async () => {
    await withSource(async (_source, { errors }, fake) => {
      fake.emitError({ code: 'bind_failed', message: 'in use' });
      fake.emitError({ code: 'detect_failed', message: 'ML Kit failure' });
      expect(errors[0].error.message).toContain('ERR_CAMERA_bind_failed');
      expect(errors[1].error.message).toContain('ERR_DETECT');
    });
  });

  test('three consecutive failures degrade; one frame recovers', async () => {
    await withSource(async (source, { frames }, fake) => {
      fake.emitError({ code: 'bind_failed', message: '1' });
      fake.emitError({ code: 'bind_failed', message: '2' });
      expect(source.status).toBe('running');
      fake.emitError({ code: 'bind_failed', message: '3' });
      expect(source.status).toBe('degraded');
      fake.emit(oneFaceObservation());
      expect(source.status).toBe('running');
      expect(frames).toHaveLength(1);
    });
  });

  test('no callback of any kind fires after stop', async () => {
    const fake = createFakeBinding();
    const frames: any[] = [];
    const errors: { error: Error; consecutive: number }[] = [];
    const statuses: string[] = [];
    const source = new StreamingCameraSource({
      onFrame: (frame) => frames.push(frame),
      onError: (error, consecutive) => errors.push({ error, consecutive }),
      onStatus: (status) => statuses.push(status),
      binding: fake.binding,
    });
    await source.start();
    await source.stop();
    fake.emit(oneFaceObservation());
    fake.emitError({ code: 'bind_failed', message: 'late' });
    expect(frames).toHaveLength(0);
    expect(errors).toHaveLength(0);
    expect(statuses[statuses.length - 1]).toBe('stopped');
  });
});
