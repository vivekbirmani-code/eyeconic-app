/**
 * StreamingCameraSource unit tests (Track 2, plan §29.3): the frame-source
 * half of the streaming transport — event→frame mapping through the SAME
 * classifyFrame sanitizer, pause/resume/stop semantics (no stale frames, no
 * callbacks after stop), error taxonomy routing, degraded status, and the
 * pause bus the native view subscribes to. Pure node-env: the native view is
 * faked through the module bus.
 */

import {
  StreamingCameraSource,
  emitProctoringObservation,
  emitProctoringCameraError,
  subscribeProctoringAnalysisPaused,
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

const withSource = async (
  fn: (source: StreamingCameraSource, capture: {
    frames: any[]; errors: Array<{ error: Error; consecutive: number }>; statuses: string[];
  }) => Promise<void>
) => {
  const frames: any[] = [];
  const errors: Array<{ error: Error; consecutive: number }> = [];
  const statuses: string[] = [];
  const source = new StreamingCameraSource({
    onFrame: (frame) => frames.push(frame),
    onError: (error, consecutive) => errors.push({ error, consecutive }),
    onStatus: (status) => statuses.push(status),
  });
  await source.start();
  await fn(source, { frames, errors, statuses });
  await source.stop();
};

describe('StreamingCameraSource — event→frame mapping', () => {
  test('observations map to classified frames with the shared sanitizer shape', async () => {
    await withSource(async (_source, { frames }) => {
      emitProctoringObservation(oneFaceObservation());
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

  test('malformed native payloads are sanitized, never thrown', async () => {
    await withSource(async (_source, { frames }) => {
      emitProctoringObservation(oneFaceObservation({
        faces: 'not-an-array' as unknown as SpikeNativeDetectResult['faces'],
        faceCount: Number.NaN,
      }));
      // classifyFrame sanitizes bad native output (39-test suite) — the
      // source must deliver its sanitized result, not throw across the bus.
      expect(frames).toHaveLength(1);
      expect(frames[0].sanitized).toBe(true);
    });
  });

  test('frame timestamps come from the native capture clock when present', async () => {
    await withSource(async (_source, { frames }) => {
      const ts = Date.now() - 5000;
      emitProctoringObservation(oneFaceObservation({ frameTimestampMs: ts }));
      expect(frames[0].tsMs).toBe(ts);
    });
  });
});

describe('StreamingCameraSource — lifecycle semantics', () => {
  test('paused drops observations; resume delivers fresh ones only', async () => {
    await withSource(async (source, { frames, statuses }) => {
      emitProctoringObservation(oneFaceObservation());
      source.pause();
      emitProctoringObservation(oneFaceObservation()); // dropped
      expect(frames).toHaveLength(1);
      expect(statuses).toContain('paused');
      await source.resume();
      emitProctoringObservation(oneFaceObservation());
      expect(frames).toHaveLength(2);
    });
  });

  test('pause drives the analysis-pause bus the native view binds to', async () => {
    await withSource(async (source) => {
      const seen: boolean[] = [];
      const unsubscribe = subscribeProctoringAnalysisPaused((paused) => seen.push(paused));
      source.pause();
      await source.resume();
      unsubscribe();
      expect(seen).toEqual([false, true, false]);
    });
  });

  test('stop always wins — no callbacks after stop', async () => {
    await withSource(async (source, { frames, statuses }) => {
      await source.stop();
      const statusesBefore = statuses.length;
      emitProctoringObservation(oneFaceObservation());
      emitProctoringCameraError({ code: 'bind_failed', message: 'x' });
      expect(frames).toHaveLength(0);
      expect(statuses.length).toBe(statusesBefore);
    });
  });

  test('start is idempotent (no duplicate subscriptions)', async () => {
    await withSource(async (source, { frames }) => {
      await source.start();
      emitProctoringObservation(oneFaceObservation());
      expect(frames).toHaveLength(1);
    });
  });
});

describe('StreamingCameraSource — error taxonomy', () => {
  test('detect_failed routes to the detector taxonomy (ERR_DETECT prefix)', async () => {
    await withSource(async (_source, { errors }) => {
      emitProctoringCameraError({ code: 'detect_failed', message: 'ML Kit failure' });
      expect(errors).toHaveLength(1);
      expect(errors[0].error.message).toContain('ERR_DETECT');
    });
  });

  test('camera-side codes stay camera errors (no ERR_DETECT)', async () => {
    await withSource(async (_source, { errors }) => {
      emitProctoringCameraError({ code: 'bind_failed', message: 'in use' });
      expect(errors[0].error.message).toContain('ERR_CAMERA_bind_failed');
      expect(errors[0].error.message).not.toContain('ERR_DETECT');
    });
  });

  test('status flips to degraded after 3 consecutive failures and recovers on a frame', async () => {
    await withSource(async (source, { errors }) => {
      emitProctoringCameraError({ code: 'bind_failed', message: '1' });
      emitProctoringCameraError({ code: 'bind_failed', message: '2' });
      expect(source.status).toBe('running');
      emitProctoringCameraError({ code: 'bind_failed', message: '3' });
      expect(source.status).toBe('degraded');
      expect(errors[2].consecutive).toBe(3);
      emitProctoringObservation(oneFaceObservation());
      expect(source.status).toBe('running'); // recovery closes the degraded state
    });
  });
});
