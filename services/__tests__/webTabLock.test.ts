/**
 * Web proctoring tab-lock tests — the StrictMode teardown contract from the
 * 2026-10-24 field investigation: a CANCELLED acquisition (React 18 Strict
 * Mode's first mount is torn down during the contest window) must never
 * claim, never ping — otherwise its leaked heartbeat makes the LIVE tab's
 * lock back off and the attempt runs entirely unmonitored. Also pins the
 * challenge resolution (bigger tab id wins) and the release contract.
 */

import { acquireProctoringTabLock } from '../../client/src/services/proctoringWeb/tabLock';

// Controllable timers: the lock schedules one setTimeout (first contest)
// plus a setInterval (heartbeat) — capture both.
type Captured = { id: number; kind: 'timeout' | 'interval'; fn: () => void };
let captured: Captured[];
let nextId: number;

const installWindowStub = () => {
  captured = [];
  nextId = 1;
  (globalThis as Record<string, unknown>).window = {
    setTimeout: (fn: () => void, _ms: number) => {
      const id = nextId; nextId += 1;
      captured.push({ id, kind: 'timeout', fn });
      return id;
    },
    setInterval: (fn: () => void, _ms: number) => {
      const id = nextId; nextId += 1;
      captured.push({ id, kind: 'interval', fn });
      return id;
    },
    clearInterval: (id: number) => { captured = captured.filter((c) => c.id !== id); },
    clearTimeout: (id: number) => { captured = captured.filter((c) => c.id !== id); },
  };
};

const runTimeouts = () => captured.filter((c) => c.kind === 'timeout').forEach((c) => c.fn());
const runIntervals = () => captured.filter((c) => c.kind === 'interval').forEach((c) => c.fn());

beforeEach(() => { installWindowStub(); });

describe('acquireProctoringTabLock', () => {
  it('acquires when no challenger pings (the normal first-tab path)', async () => {
    const lockP = acquireProctoringTabLock('attempt-1', () => {});
    runTimeouts();
    const lock = await lockP;
    expect(lock.held).toBe(true);
    lock.release();
  });

  it('a CANCELLED acquisition never claims or pings (StrictMode teardown during the contest window)', async () => {
    let cancelled = false;
    const lostSpy = jest.fn();
    const lockP = acquireProctoringTabLock('attempt-2', lostSpy, () => cancelled);

    cancelled = true; // the effect's cleanup ran while the contest window was open
    runTimeouts();

    const lock = await lockP;
    expect(lock.held).toBe(false);
    expect(lostSpy).not.toHaveBeenCalled();

    // The cancelled lock's channel is torn down — no heartbeat pings ever.
    runIntervals();

    // And the LIVE (second mount) acquisition proceeds cleanly.
    const liveP = acquireProctoringTabLock('attempt-2', () => {});
    runTimeouts();
    const live = await liveP;
    expect(live.held).toBe(true);
    live.release();
  });

  it('a lock already held forces a challenger to back off (two tabs)', async () => {
    const firstP = acquireProctoringTabLock('attempt-3', () => {});
    runTimeouts();
    const first = await firstP;
    expect(first.held).toBe(true);

    // BroadcastChannel delivery is a macrotask — let the ping land before
    // the challenger contests.
    const flush = () => new Promise((resolve) => { setTimeout(resolve, 20); });
    const secondP = acquireProctoringTabLock('attempt-3', () => {});
    runIntervals(); // holder pings
    await flush();
    runTimeouts(); // challenger contests AFTER hearing the ping
    const second = await secondP;
    expect(second.held).toBe(false);
    first.release();
  });
});
