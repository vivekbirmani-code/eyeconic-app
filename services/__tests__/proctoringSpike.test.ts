/**
 * Phase 0 spike — deterministic unit tests for the pure spike logic.
 *
 * These tests verify APPLICATION LOGIC (sanitization, classification, tracking,
 * loop control) with fakes. They do NOT validate the ML Kit integration on a
 * device — that is the real-device Phase 0 runbook (docs/phase-0-cv-spike-report.md).
 */

import { boxClipFraction, classifyFrame } from '../proctoringSpike/classifyFrame';
import { CameraLoop } from '../proctoringSpike/cameraLoop';
import { SpikeMetricsTracker } from '../proctoringSpike/metricsTracker';
import { SPIKE_SCENARIOS } from '../proctoringSpike/types';
import type {
  SpikeFrameResult,
  SpikeNativeDetectResult,
  SpikeNativeFace,
} from '../proctoringSpike/types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeFace(overrides: Partial<SpikeNativeFace> = {}): SpikeNativeFace {
  return {
    box: { left: 100, top: 100, right: 400, bottom: 460 },
    eulerX: 0,
    eulerY: 0,
    eulerZ: 0,
    trackingId: 1,
    leftEyeOpenProbability: 0.95,
    rightEyeOpenProbability: 0.93,
    smilingProbability: 0.2,
    landmarks: {
      leftEye: { x: 180, y: 200 },
      rightEye: { x: 320, y: 200 },
      noseBase: { x: 250, y: 280 },
      mouthBottom: { x: 250, y: 380 },
      mouthLeft: { x: 190, y: 360 },
      mouthRight: { x: 310, y: 360 },
      leftEar: { x: 110, y: 280 },
      rightEar: { x: 390, y: 280 },
      leftCheek: { x: 160, y: 300 },
      rightCheek: { x: 340, y: 300 },
    },
    ...overrides,
  };
}

function makeNative(faces: SpikeNativeFace[], width = 640, height = 480): SpikeNativeDetectResult {
  return {
    tier: 'mlkit-face-detection',
    imageWidth: width,
    imageHeight: height,
    faceCount: faces.length,
    faces,
    decodeMs: 8,
    inferenceMs: 40,
    totalNativeMs: 50,
  };
}

function classify(faces: SpikeNativeFace[] | unknown, opts: { width?: number; height?: number } = {}) {
  const native =
    typeof faces === 'object' && faces !== null && Array.isArray((faces as SpikeNativeDetectResult).faces)
      ? (faces as SpikeNativeDetectResult)
      : makeNative(faces as SpikeNativeFace[], opts.width, opts.height);
  return classifyFrame({ captureMs: 100, native }, 0, 1_000);
}

// ---------------------------------------------------------------------------
// classifyFrame — zero / one / multiple faces
// ---------------------------------------------------------------------------

describe('classifyFrame: face-count classification', () => {
  it('classifies zero faces as none/none', () => {
    const frame = classify([]);
    expect(frame.faceCountClass).toBe('none');
    expect(frame.visibility).toBe('none');
    expect(frame.headPose.band).toBe('unknown');
    expect(frame.landmarkCount).toBe(0);
    expect(frame.qualityProxy).toBe(0);
  });

  it('classifies exactly one centered face as one/ok with centered pose', () => {
    const frame = classify([makeFace()]);
    expect(frame.faceCountClass).toBe('one');
    expect(frame.visibility).toBe('ok');
    expect(frame.headPose.band).toBe('centered');
    expect(frame.landmarkCount).toBe(10);
    expect(frame.sanitized).toBe(false);
    expect(frame.largestFaceRatio).toBeGreaterThan(0.3);
  });

  it('classifies two and three faces as multiple', () => {
    expect(classify([makeFace(), makeFace({ trackingId: 2 })]).faceCountClass).toBe('multiple');
    expect(
      classify([makeFace(), makeFace({ trackingId: 2 }), makeFace({ trackingId: 3 })]).faceCountClass
    ).toBe('multiple');
  });

  it('visibility is multiple when more than one face is present regardless of quality', () => {
    const tiny = makeFace({ box: { left: 0, top: 0, right: 4, bottom: 4 } });
    const frame = classify([makeFace(), tiny]);
    expect(frame.visibility).toBe('multiple');
  });
});

// ---------------------------------------------------------------------------
// classifyFrame — visibility edge cases
// ---------------------------------------------------------------------------

describe('classifyFrame: visibility edge cases', () => {
  it('marks a small face (below minFaceRatio) as small', () => {
    const small = makeFace({ box: { left: 300, top: 220, right: 330, bottom: 265 } });
    const frame = classify([small]);
    expect(frame.faceCountClass).toBe('one');
    expect(frame.visibility).toBe('small');
  });

  it('marks a face clipped by the frame edge as partial', () => {
    // 640x480 image; face hangs off the right edge by ~60% of its width.
    const clipped = makeFace({ box: { left: 480, top: 100, right: 760, bottom: 520 } });
    const frame = classify([clipped]);
    expect(frame.visibility).toBe('partial');
    expect(frame.faceCountClass).toBe('one');
  });

  it('uses the largest face for head pose when multiple faces exist', () => {
    const big = makeFace({ box: { left: 0, top: 0, right: 400, bottom: 500 }, eulerY: 45 });
    const small = makeFace({ box: { left: 500, top: 0, right: 530, bottom: 40 }, eulerY: 0 });
    const frame = classify([small, big]);
    expect(frame.headPose.band).toBe('turned'); // yaw 45 < extreme band (50)
    expect(frame.headPose.yaw).toBe(45);
  });
});

// ---------------------------------------------------------------------------
// classifyFrame — head-pose bands
// ---------------------------------------------------------------------------

describe('classifyFrame: head-pose bands', () => {
  it.each([
    [0, 0, 'centered'],
    [20, 5, 'centered'],
    [24, 0, 'centered'], // just below half of extremeYawDeg (25) -> centered
    [30, 0, 'turned'],
    [50, 0, 'extreme'],
    [0, 20, 'turned'], // half of extremePitchDeg
    [0, 40, 'extreme'],
  ] as const)('yaw=%i pitch=%i -> %s', (yaw, pitch, expected) => {
    const face = makeFace({ eulerY: yaw, eulerX: pitch });
    const frame = classify([face]);
    expect(frame.headPose.band).toBe(expected);
  });

  it('reports unknown pose when Euler angles are missing (null)', () => {
    const face = makeFace({ eulerX: null, eulerY: null, eulerZ: null });
    const frame = classify([face]);
    expect(frame.headPose.band).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// classifyFrame — malformed detector output must never throw
// ---------------------------------------------------------------------------

describe('classifyFrame: malformed native output', () => {
  it('handles faces not being an array', () => {
    const frame = classifyFrame(
      { captureMs: 10, native: { ...makeNative([]), faces: 'nope' as unknown as SpikeNativeFace[] } },
      0,
      1
    );
    expect(frame.faceCountClass).toBe('none');
    expect(frame.sanitized).toBe(true);
  });

  it('handles NaN and missing numbers in a face record', () => {
    const broken = {
      ...makeFace(),
      eulerY: Number.NaN,
      leftEyeOpenProbability: 7, // out of range -> clamped
      box: { left: 'x' as unknown as number, top: 100, right: 400, bottom: 520 },
    };
    const frame = classify([broken]);
    expect(frame.faceCountClass).toBe('one');
    expect(frame.sanitized).toBe(true);
    expect(frame.headPose.yaw).toBeNull();
  });

  it('handles broken landmark entries by nulling them', () => {
    const face = makeFace({
      landmarks: {
        leftEye: { x: Number.NaN, y: 200 } as unknown as { x: number; y: number },
        rightEye: null,
      },
    });
    const frame = classify([face]);
    expect(frame.faceCountClass).toBe('one');
    expect(frame.sanitized).toBe(true);
    expect(frame.landmarkCount).toBeLessThan(10);
  });

  it('handles a native result with zero image dimensions', () => {
    const frame = classifyFrame({ captureMs: 10, native: makeNative([makeFace()], 0, 0) }, 0, 1);
    expect(frame.sanitized).toBe(true);
    expect(frame.faceCountClass).toBe('one');
  });

  it('handles completely null native payload', () => {
    const frame = classifyFrame(
      { captureMs: 10, native: null as unknown as SpikeNativeDetectResult },
      0,
      1
    );
    expect(frame.faceCountClass).toBe('none');
    expect(frame.sanitized).toBe(true);
  });

  it('normalizes an inverted bounding box without failing', () => {
    const inverted = makeFace({ box: { left: 400, top: 520, right: 100, bottom: 100 } });
    const frame = classify([inverted]);
    expect(frame.faceCountClass).toBe('one');
    expect(frame.sanitized).toBe(false);
    expect(frame.largestFaceRatio).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// boxClipFraction
// ---------------------------------------------------------------------------

describe('boxClipFraction', () => {
  it('returns 0 for a fully inside box', () => {
    expect(boxClipFraction(makeFace(), 640, 480)).toBeCloseTo(0);
  });

  it('returns 1 for a degenerate box', () => {
    const degenerate = makeFace({ box: { left: 10, top: 10, right: 10, bottom: 10 } });
    expect(boxClipFraction(degenerate, 640, 480)).toBe(1);
  });

  it('returns the clipped fraction for an edge-hanging box', () => {
    const hanging = makeFace({ box: { left: 480, top: 0, right: 800, bottom: 480 } });
    // box is 320x480, half its width is outside.
    expect(boxClipFraction(hanging, 640, 480)).toBeCloseTo(0.5, 1);
  });
});

// ---------------------------------------------------------------------------
// SpikeMetricsTracker
// ---------------------------------------------------------------------------

function frameAt(i: number, clazz: SpikeFrameResult['faceCountClass'], tsMs: number): SpikeFrameResult {
  const base = classify([makeFace()]);
  return { ...base, frameIndex: i, tsMs, faceCountClass: clazz };
}

describe('SpikeMetricsTracker', () => {
  it('computes effective fps and latency stats', () => {
    const tracker = new SpikeMetricsTracker();
    tracker.push(frameAt(0, 'one', 0));
    tracker.push(frameAt(1, 'one', 500));
    tracker.push(frameAt(2, 'one', 1000));
    const summary = tracker.summary();
    expect(summary.frames).toBe(3);
    expect(summary.effectiveFps).toBeCloseTo(2, 5); // 2 gaps over 1000ms
    expect(summary.interFrameMs.mean).toBe(500);
    expect(summary.latency.inferenceMs.mean).toBe(40);
  });

  it('returns null stats before any frames', () => {
    const tracker = new SpikeMetricsTracker();
    const summary = tracker.summary();
    expect(summary.frames).toBe(0);
    expect(summary.effectiveFps).toBeNull();
    expect(summary.interFrameMs.mean).toBeNull();
  });

  it('stableClassification requires a strict majority and enough frames', () => {
    const tracker = new SpikeMetricsTracker();
    expect(tracker.stableClassification(3)).toBeNull();
    tracker.push(frameAt(0, 'one', 0));
    tracker.push(frameAt(1, 'one', 100));
    expect(tracker.stableClassification(3)).toBeNull(); // not enough frames
    tracker.push(frameAt(2, 'none', 200));
    expect(tracker.stableClassification(3)).toBe('one'); // 2/3 majority
    tracker.push(frameAt(3, 'multiple', 300));
    expect(tracker.stableClassification(3)).toBeNull(); // window [one,none,multiple] -> 3-way tie
  });

  it('tallies scenario matches, false positives, and false negatives', () => {
    const tracker = new SpikeMetricsTracker();
    const noFaceScenario = SPIKE_SCENARIOS.find((s) => s.id === 'B_NO_FACE')!;
    tracker.startScenario(noFaceScenario);
    tracker.push(frameAt(0, 'none', 0));
    tracker.push(frameAt(1, 'none', 100));
    tracker.push(frameAt(2, 'one', 200)); // false positive (expected none)
    tracker.push(frameAt(3, 'multiple', 300)); // FP + multi FP
    const run = tracker.finishScenario()!;
    expect(run.frames).toBe(4);
    expect(run.matchedFrames).toBe(2);
    expect(run.falsePositives).toBe(2);
    expect(run.multiFaceFalsePositives).toBe(1);
    expect(run.falseNegatives).toBe(0);
    expect(run.accuracy).toBeCloseTo(0.5);
  });

  it('counts misses on expected-one scenarios as false negatives', () => {
    const tracker = new SpikeMetricsTracker();
    const normalScenario = SPIKE_SCENARIOS.find((s) => s.id === 'A_NORMAL_ONE_FACE')!;
    tracker.startScenario(normalScenario);
    tracker.push(frameAt(0, 'one', 0));
    tracker.push(frameAt(1, 'none', 100)); // FN
    tracker.push(frameAt(2, 'multiple', 200)); // FN (wrong count)
    const run = tracker.finishScenario()!;
    expect(run.matchedFrames).toBe(1);
    expect(run.falseNegatives).toBe(2);
    expect(run.falsePositives).toBe(0);
    expect(run.accuracy).toBeCloseTo(1 / 3);
  });

  it('finishing with no active scenario returns null; errors are counted separately', () => {
    const tracker = new SpikeMetricsTracker();
    expect(tracker.finishScenario()).toBeNull();
    tracker.recordError();
    expect(tracker.summary().errors).toBe(1);
  });

  it('peekScenario snapshots without finishing', () => {
    const tracker = new SpikeMetricsTracker();
    tracker.startScenario(SPIKE_SCENARIOS[0]);
    tracker.push(frameAt(0, 'one', 0));
    const peeked = tracker.peekScenario()!;
    expect(peeked.frames).toBe(1);
    expect(tracker.peekScenario()).not.toBeNull(); // still active
    tracker.finishScenario();
    expect(tracker.peekScenario()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CameraLoop (with injected fakes — no native code involved)
//
// Every async loop test runs inside withLoop(), which guarantees loop.stop()
// even when an assertion fails mid-test. Without this, a failed assertion
// before stop() leaves the loop running forever at maximum speed, growing its
// output arrays unboundedly (this exact failure OOM'd the suite once).
// ---------------------------------------------------------------------------

const yieldSleep = () => new Promise<void>((resolve) => setImmediate(resolve));

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timeout');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function withLoop(loop: CameraLoop, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } finally {
    loop.stop();
    // Give any in-flight cycle a turn to observe the stop.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function makeFacesResult(count: number): SpikeNativeDetectResult {
  return makeNative(
    Array.from({ length: count }, (_, i) => makeFace({ trackingId: i + 1 }))
  );
}

describe('CameraLoop', () => {
  it('runs sequential capture→detect cycles and emits classified frames', async () => {
    const frames: SpikeFrameResult[] = [];
    const loop = new CameraLoop({
      capture: async () => ({ base64: 'aGk=', captureMs: 50 }),
      detect: async () => makeFacesResult(1),
      onFrame: (f) => frames.push(f),
      onError: () => fail('onError must not fire on the happy path'),
      onStatus: () => {},
      sleep: yieldSleep,
    });
    await withLoop(loop, async () => {
      void loop.start();
      await waitFor(() => frames.length >= 1);
      expect(frames[0].faceCountClass).toBe('one');
      expect(loop.status).toBe('running');
    });
    expect(loop.status).toBe('stopped');
  });

  it('stops cleanly after exactly N frames when stop() is called from onFrame', async () => {
    const frames: SpikeFrameResult[] = [];
    const loop = new CameraLoop({
      capture: async () => ({ base64: 'aGk=', captureMs: 5 }),
      detect: async () => makeFacesResult(2),
      onFrame: (f) => {
        frames.push(f);
        if (frames.length === 3) loop.stop();
      },
      onError: () => fail('no errors expected'),
      onStatus: () => {},
      sleep: yieldSleep,
    });
    await withLoop(loop, async () => {
      await loop.start();
      expect(frames).toHaveLength(3);
      expect(frames.every((f) => f.faceCountClass === 'multiple')).toBe(true);
    });
  });

  it('enters degraded after consecutive failures and reports the errors', async () => {
    const statuses: string[] = [];
    const errors: Error[] = [];
    const loop = new CameraLoop({
      capture: async () => ({ base64: 'aGk=', captureMs: 5 }),
      detect: async () => {
        throw new Error('ERR_DETECT: ML Kit failure');
      },
      onFrame: () => fail('no frames expected'),
      onError: (e) => errors.push(e),
      onStatus: (s) => statuses.push(s),
      degradedAfter: 3,
      sleep: yieldSleep,
    });
    await withLoop(loop, async () => {
      void loop.start();
      await waitFor(() => errors.length >= 4);
      expect(errors[0].message).toContain('ERR_DETECT');
      expect(statuses).toContain('degraded');
    });
  });

  it('treats a null base64 payload as a capture failure (no throw)', async () => {
    const errors: Error[] = [];
    const loop = new CameraLoop({
      capture: async () => ({ base64: null, captureMs: 5 }),
      detect: async () => makeFacesResult(1),
      onFrame: () => fail('no frames expected'),
      onError: (e) => errors.push(e),
      onStatus: () => {},
      sleep: yieldSleep,
    });
    await withLoop(loop, async () => {
      void loop.start();
      await waitFor(() => errors.length >= 1);
      expect(errors[0].message).toContain('no image payload');
    });
  });

  it('recovers to running after failures resolve', async () => {
    const statuses: string[] = [];
    let attempts = 0;
    let frames = 0;
    const loop = new CameraLoop({
      capture: async () => ({ base64: 'aGk=', captureMs: 5 }),
      detect: async () => {
        attempts += 1;
        if (attempts <= 3) throw new Error('transient');
        return makeFacesResult(1);
      },
      onFrame: () => {
        frames += 1;
      },
      onError: () => {},
      onStatus: (s) => statuses.push(s),
      degradedAfter: 3,
      sleep: yieldSleep,
    });
    await withLoop(loop, async () => {
      void loop.start();
      await waitFor(() => frames >= 1);
      expect(statuses).toEqual(
        expect.arrayContaining(['running', 'degraded', 'running'])
      );
    });
  });

  it('does not emit frames after stop() even if a cycle is mid-flight', async () => {
    const frames: SpikeFrameResult[] = [];
    let releaseDetect: (() => void) | null = null;
    const loop = new CameraLoop({
      capture: async () => ({ base64: 'aGk=', captureMs: 5 }),
      detect: () =>
        new Promise<SpikeNativeDetectResult>((resolve) => {
          releaseDetect = () => resolve(makeFacesResult(1));
        }),
      onFrame: (f) => frames.push(f),
      onError: () => {},
      onStatus: () => {},
      sleep: yieldSleep,
    });
    await withLoop(loop, async () => {
      void loop.start();
      // Cycle 1 is blocked inside detect; stop the loop, then release.
      await new Promise<void>((r) => setImmediate(r));
      loop.stop();
      releaseDetect?.();
      await new Promise<void>((r) => setImmediate(r));
      expect(frames).toHaveLength(0);
    });
  });

  it('handles malformed native results without killing the loop', async () => {
    const frames: SpikeFrameResult[] = [];
    let calls = 0;
    const loop = new CameraLoop({
      capture: async () => ({ base64: 'aGk=', captureMs: 5 }),
      detect: async () => {
        calls += 1;
        if (calls === 1) {
          return { ...makeNative([makeFace()]), faces: null as unknown as SpikeNativeFace[] };
        }
        return makeFacesResult(1);
      },
      onFrame: (f) => frames.push(f),
      onError: () => fail('malformed output must classify, not error'),
      onStatus: () => {},
      sleep: yieldSleep,
    });
    await withLoop(loop, async () => {
      void loop.start();
      await waitFor(() => frames.length >= 2);
      expect(frames[0].sanitized).toBe(true);
      expect(frames[0].faceCountClass).toBe('none');
      expect(frames[1].sanitized).toBe(false);
      expect(frames[1].faceCountClass).toBe('one');
    });
  });

  it('pause() halts frame production and resume() restarts it', async () => {
    const frames: SpikeFrameResult[] = [];
    const statuses: string[] = [];
    const loop = new CameraLoop({
      capture: async () => ({ base64: 'aGk=', captureMs: 5 }),
      detect: async () => makeFacesResult(1),
      onFrame: (f) => frames.push(f),
      onError: () => {},
      onStatus: (s) => statuses.push(s),
      sleep: yieldSleep,
    });
    await withLoop(loop, async () => {
      void loop.start();
      await waitFor(() => frames.length >= 1);
      loop.pause();
      expect(loop.status).toBe('paused');
      const framesAtPause = frames.length;
      await new Promise<void>((r) => setImmediate(r));
      expect(frames.length).toBe(framesAtPause); // no frames while paused
      loop.resume();
      expect(loop.status).toBe('running');
      await waitFor(() => frames.length > framesAtPause);
      expect(statuses).toEqual(
        expect.arrayContaining(['running', 'paused', 'running'])
      );
    });
  });
});
