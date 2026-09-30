/**
 * FocusTracker tests (Phase 4, plan §14, §20.5, §32 AC 1–3): APP_BACKGROUND
 * episode lifecycle from AppState transitions, the benign-interruption
 * contract (blips dropped within tolerance, aggregated beyond it), the
 * prolonged/floor semantics, EXIT_ATTEMPTED point events, and the Android
 * 'inactive' transparency (permission dialogs never count). Synthetic clock —
 * the same script style as proctoringEpisodeTracker.test.ts.
 */

import {
  FocusTracker,
  BENIGN_BLIP_TOLERANCE,
  BENIGN_BLIP_WINDOW_MS,
} from '../proctoring/focusTracker';

const T0 = 1_700_000_000_000; // arbitrary epoch ms

const buildTracker = (policy?: Record<string, unknown>) => {
  let now = T0;
  const tracker = new FocusTracker({
    policy: policy as never,
    now: () => now,
  });
  return {
    tracker,
    advance: (ms: number) => { now += ms; },
    set: (ms: number) => { now = ms; },
  };
};

describe('FocusTracker — qualifying excursions (§14.2, AC 1)', () => {
  it('produces exactly one duration-bearing episode per qualifying excursion', () => {
    const { tracker, advance } = buildTracker();
    expect(tracker.onAppStateChange('background')).toEqual([]);
    advance(14_000);
    const episodes = tracker.onAppStateChange('active');
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ type: 'APP_BACKGROUND' });
    expect(episodes[0].openedAt).toBe(T0);
    expect(episodes[0].closedAt).toBe(T0 + 14_000);
    expect(episodes[0].confidence).toBeUndefined(); // deterministic — no confidence
  });

  it('uses the frozen policy floor (focusEvents.minDurationMs)', () => {
    const { tracker, advance } = buildTracker({ focusEvents: { minDurationMs: 5000 } });
    expect(tracker.minDurationMs).toBe(5000);
    tracker.onAppStateChange('background');
    advance(4999);
    expect(tracker.onAppStateChange('active')).toEqual([]); // still a blip
    tracker.onAppStateChange('background');
    advance(5000);
    expect(tracker.onAppStateChange('active')).toHaveLength(1);
  });

  it('defaults to the frozen default floor (2000 ms) without a policy', () => {
    const { tracker } = buildTracker();
    expect(tracker.minDurationMs).toBe(2000);
  });

  it('20 excursions → 20 episodes, no duplicates, no losses', () => {
    const { tracker, advance } = buildTracker();
    let total = 0;
    for (let i = 0; i < 20; i++) {
      tracker.onAppStateChange('background');
      advance(3000);
      total += tracker.onAppStateChange('active').length;
      advance(10_000);
    }
    expect(total).toBe(20);
  });
});

describe('FocusTracker — benign grace & tolerance (§20.5, AC 2–3)', () => {
  it('drops sub-floor blips entirely while within tolerance', () => {
    const { tracker, advance } = buildTracker();
    for (let i = 0; i < BENIGN_BLIP_TOLERANCE; i++) {
      tracker.onAppStateChange('background');
      advance(1500); // < 2000 floor
      expect(tracker.onAppStateChange('active')).toEqual([]);
    }
  });

  it('aggregates blips beyond tolerance into ONE repeated_brief episode, then resets', () => {
    const { tracker, advance } = buildTracker();
    let emitted = 0;
    for (let i = 0; i < BENIGN_BLIP_TOLERANCE + 1; i++) {
      tracker.onAppStateChange('background');
      advance(1200);
      emitted += tracker.onAppStateChange('active').length;
    }
    expect(emitted).toBe(1);

    // Window reset: the same tolerance applies again from scratch.
    for (let i = 0; i < BENIGN_BLIP_TOLERANCE; i++) {
      tracker.onAppStateChange('background');
      advance(1100);
      emitted += tracker.onAppStateChange('active').length;
    }
    expect(emitted).toBe(1); // still within the fresh window

    tracker.onAppStateChange('background');
    advance(1300);
    const second = tracker.onAppStateChange('active');
    expect(second).toHaveLength(1);
    expect(second[0].metadata).toMatchObject({
      pattern: 'repeated_brief',
      count: BENIGN_BLIP_TOLERANCE + 1,
      windowMs: BENIGN_BLIP_WINDOW_MS,
    });
  });

  it('expires blips from the rolling window', () => {
    const { tracker, advance } = buildTracker();
    for (let i = 0; i < BENIGN_BLIP_TOLERANCE; i++) {
      tracker.onAppStateChange('background');
      advance(1000);
      tracker.onAppStateChange('active');
      advance(90_000); // spread far beyond the 5-minute window over time
    }
    // All earlier blips have aged out: one more blip is within tolerance again.
    tracker.onAppStateChange('background');
    advance(1000);
    expect(tracker.onAppStateChange('active')).toEqual([]);
  });

  it('sub-2s blips produce no event at all — recorded-signal vs violation stays distinct', () => {
    // §29.4: "App backgrounded < 2 s (accidental touch) → dropped by floor;
    // no violation" — in Phase 4 that means NO event exists to ever count.
    const { tracker, advance } = buildTracker();
    tracker.onAppStateChange('background');
    advance(1999);
    expect(tracker.onAppStateChange('active')).toEqual([]);
  });
});

describe('FocusTracker — transient states never count (§14.4)', () => {
  it("'inactive' (Android permission dialogs / iOS control center) never opens an episode", () => {
    const { tracker, advance } = buildTracker();
    tracker.onAppStateChange('inactive');
    advance(30_000);
    expect(tracker.onAppStateChange('active')).toEqual([]); // nothing was open

    // inactive during an open background excursion does not close or split it
    tracker.onAppStateChange('background');
    advance(5000);
    tracker.onAppStateChange('inactive');
    advance(5000);
    const episodes = tracker.onAppStateChange('active');
    expect(episodes).toHaveLength(1);
    expect(episodes[0].closedAt).toBe(T0 + 40_000); // T0 + 30_000 + 5_000 + 5_000
  });

  it('double background events do not restart the open excursion', () => {
    const { tracker, advance } = buildTracker();
    tracker.onAppStateChange('background');
    advance(3000);
    tracker.onAppStateChange('background'); // duplicate OS event
    advance(3000);
    const episodes = tracker.onAppStateChange('active');
    expect(episodes).toHaveLength(1);
    expect(episodes[0].openedAt).toBe(T0);
  });
});

describe('FocusTracker — EXIT_ATTEMPTED + teardown', () => {
  it('records an informational point event on back-handler interception', () => {
    const { tracker, advance } = buildTracker();
    advance(42_000);
    const episodes = tracker.onExitAttempted();
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      type: 'EXIT_ATTEMPTED',
      openedAt: T0 + 42_000,
      closedAt: T0 + 42_000,
    });
  });

  it('closeAll closes an open excursion through the same blip/floor logic', () => {
    const blipCase = buildTracker();
    blipCase.tracker.onAppStateChange('background');
    blipCase.advance(1000);
    expect(blipCase.tracker.closeAll()).toEqual([]);

    const qualifying = buildTracker();
    qualifying.tracker.onAppStateChange('background');
    qualifying.advance(8000);
    const episodes = qualifying.tracker.closeAll();
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ type: 'APP_BACKGROUND' }); // durationMs is server-computed
    expect(episodes[0].closedAt).toBe(T0 + 8000);

    // Idempotent: a second closeAll has nothing left.
    expect(qualifying.tracker.closeAll()).toEqual([]);
  });
});
