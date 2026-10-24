/**
 * Web proctoring engine — single-tab lock (best-effort).
 *
 * The server's single-live-attempt index prevents two ATTEMPTS, not two
 * browser tabs monitoring the same one; duplicate engines would interleave
 * events into one session. This lock lets the first tab hold monitoring and
 * shows the second a "already open elsewhere" state instead. Best-effort by
 * design (documented limitation): two different browsers/profiles cannot
 * see each other — the timeline then simply shows the interleaved truth.
 *
 * Mechanics: a BroadcastChannel heartbeat. The holder pings every
 * LOCK_HEARTBEAT_MS; a challenger that hears a ping inside the staleness
 * window backs off. Refresh/close stops the ping and the next tab acquires
 * within the staleness window.
 */

const LOCK_CHANNEL = 'eyeconic-proctoring-tab-lock';
const LOCK_HEARTBEAT_MS = 1500;
const LOCK_STALE_MS = 4000;

export interface TabLock {
  /** True while THIS tab holds the lock. */
  readonly held: boolean;
  release(): void;
}

export function acquireProctoringTabLock(
  attemptId: string,
  onLost: () => void,
  /** Abort check — a cancelled acquisition must never ping or block. */
  isCancelled?: () => boolean
): Promise<TabLock> {
  return new Promise((resolve) => {
    let usingChannel = false;
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(`${LOCK_CHANNEL}:${attemptId}`);
      usingChannel = true;
    } catch {
      channel = null; // Very old browsers — degrade to localStorage-free no-lock.
    }

    let held = false;
    let lastForeignPing = 0;
    let timer: number | null = null;
    let settled = false;

    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
      // Full teardown (review finding): the interval alone left the
      // channel listener attached for the page lifetime.
      try {
        channel!.onmessage = null;
        channel!.close();
      } catch {
        // already closed
      }
    };

    if (!usingChannel) {
      // No BroadcastChannel → grant immediately (no protection, quiz still
      // works; the server remains authoritative for everything that matters).
      resolve({ get held() { return true; }, release: () => undefined });
      return;
    }

    const tryAcquire = () => {
      if (settled && !held) return;
      // A cancelled acquisition (React StrictMode's first mount, an unmount
      // during the contest window) must never claim, never ping — otherwise
      // the leaked lock's heartbeat can make the LIVE tab's lock back off
      // and leave the attempt entirely unmonitored.
      if (isCancelled?.()) {
        if (!settled) {
          settled = true;
          stop();
          resolve({ get held() { return false; }, release: stop });
        } else {
          stop();
        }
        return;
      }
      if (!held && Date.now() - lastForeignPing < LOCK_STALE_MS) {
        if (!settled) {
          settled = true;
          resolve({ get held() { return false; }, release: stop });
        }
        return;
      }
      held = true;
      if (!settled) {
        settled = true;
        resolve({
          get held() { return held; },
          release: stop,
        });
      }
    };

    channel!.onmessage = (event) => {
      const data = event.data as { type?: string } | null;
      if (data?.type === 'ping') {
        lastForeignPing = Date.now();
        if (held) {
          // Two holders cannot happen with honest heartbeats, but a
          // pathological race (two tabs acquiring inside the stale window)
          // resolves by id: the lexicographically smaller tab id keeps it.
          if ((data as { tab?: string }).tab! > TAB_ID) {
            held = false;
            stop();
            onLost();
          }
        }
      }
    };

    const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    timer = window.setInterval(() => {
      if (held) channel!.postMessage({ type: 'ping', tab: TAB_ID });
    }, LOCK_HEARTBEAT_MS);

    // First contest: wait one heartbeat window for an existing holder to
    // announce itself before claiming.
    window.setTimeout(tryAcquire, LOCK_HEARTBEAT_MS);
  });
}
