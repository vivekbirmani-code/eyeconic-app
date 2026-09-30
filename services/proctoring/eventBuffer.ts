/**
 * Proctoring event buffer (Phase 3, plan §6.3, §23) — the client-side
 * transport queue between episode emission and the batched events endpoint.
 *
 * Contract (plan §23 "Network drops mid-quiz"):
 *   - episodes enqueue in emission order with a monotonic clientSeq and a
 *     client-generated idempotencyKey (batch retries can never double-count,
 *     plan §7.3);
 *   - the buffer survives engine restarts via injectable persistence
 *     (AsyncStorage in the app; in-memory in tests);
 *   - a bounded cap drops the OLDEST entries first (deviation from the
 *     letter of §23's "oldest lowest-severity": severity is a server-owned
 *     field the client must not assert, so age is the only honest ordering);
 *     drops are counted and reported to the server in the next batch
 *     envelope (`bufferOverflow`) for delivery-reliability metrics;
 *   - take/ack split: the engine snapshots a batch, sends it, and only then
 *     acknowledges — a failed send leaves the events queued for retry.
 */

import type { ProctoringEpisodeEvent } from './types';

export interface QueuedProctoringEvent extends ProctoringEpisodeEvent {
  idempotencyKey: string;
  clientSeq: number;
}

export interface EventBufferStorage {
  load(): Promise<QueuedProctoringEvent[]>;
  persist(events: QueuedProctoringEvent[]): Promise<void>;
  clear(): Promise<void>;
}

/** Default storage: nothing (events live only for the engine's lifetime). */
export const nullStorage = (): EventBufferStorage => ({
  async load() {
    return [];
  },
  async persist() {
    /* no-op */
  },
  async clear() {
    /* no-op */
  },
});

export interface EventBufferOptions {
  storage?: EventBufferStorage;
  /** Queue cap (plan §23 illustrative 500). */
  max?: number;
  makeKey?: () => string;
}

const DEFAULT_MAX = 500;

const defaultMakeKey = () =>
  `ep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export class ProctoringEventBuffer {
  private readonly storage: EventBufferStorage;
  private readonly max: number;
  private readonly makeKey: () => string;
  private queue: QueuedProctoringEvent[] = [];
  private nextSeq = 0;
  private overflowCount = 0;

  constructor(options: EventBufferOptions = {}) {
    this.storage = options.storage ?? nullStorage();
    this.max = options.max ?? DEFAULT_MAX;
    this.makeKey = options.makeKey ?? defaultMakeKey;
  }

  /** Restores a persisted queue (clientSeq continues after the max seen). */
  async restore(): Promise<void> {
    const persisted = await this.storage.load();
    if (Array.isArray(persisted) && persisted.length > 0) {
      this.queue = persisted.filter(
        (e) => e && typeof e.idempotencyKey === 'string' && Number.isInteger(e.clientSeq)
      );
      this.nextSeq = this.queue.reduce((max, e) => Math.max(max, e.clientSeq + 1), 0);
    }
  }

  /**
   * Adds one episode with a fresh client-generated idempotencyKey and the
   * next monotonic clientSeq. When the cap is hit the OLDEST entries are
   * dropped and counted.
   */
  enqueue(event: ProctoringEpisodeEvent): QueuedProctoringEvent {
    const queued: QueuedProctoringEvent = {
      ...event,
      idempotencyKey: this.makeKey(),
      clientSeq: this.nextSeq,
    };
    this.nextSeq += 1;
    this.queue.push(queued);

    while (this.queue.length > this.max) {
      this.queue.shift();
      this.overflowCount += 1;
    }
    return queued;
  }

  get size(): number {
    return this.queue.length;
  }

  /** Episodes dropped by the cap since the last consumeOverflow(). */
  get droppedCount(): number {
    return this.overflowCount;
  }

  consumeOverflow(): number {
    const count = this.overflowCount;
    this.overflowCount = 0;
    return count;
  }

  /** Snapshots the oldest `count` events WITHOUT removing them (ack does). */
  takeBatch(count: number): QueuedProctoringEvent[] {
    return this.queue.slice(0, Math.max(0, count));
  }

  /** Removes acknowledged events (by clientSeq) and persists the rest. */
  async ack(batch: QueuedProctoringEvent[]): Promise<void> {
    const acked = new Set(batch.map((e) => e.clientSeq));
    this.queue = this.queue.filter((e) => !acked.has(e.clientSeq));
    await this.storage.persist(this.queue);
  }

  /** Drops everything (session finalized — no further delivery is possible). */
  async reset(): Promise<void> {
    this.queue = [];
    this.overflowCount = 0;
    await this.storage.clear();
  }

  /** Persists the current queue without changing it. */
  async persist(): Promise<void> {
    await this.storage.persist(this.queue);
  }
}
