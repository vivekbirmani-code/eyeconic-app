/**
 * Event buffer tests (Phase 3, plan §23): ordering, idempotency keys,
 * seq assignment, take/ack semantics, cap + overflow counting, persistence
 * round-trip and session-closed reset.
 */

import {
  ProctoringEventBuffer,
  nullStorage,
  type EventBufferStorage,
  type QueuedProctoringEvent,
} from '../proctoring/eventBuffer';
import type { ProctoringEpisodeEvent } from '../proctoring/types';

const episode = (type: ProctoringEpisodeEvent['type'], openedAt: number): ProctoringEpisodeEvent => ({
  type,
  openedAt,
  closedAt: openedAt + 5000,
  ...(type === 'FACE_NOT_DETECTED' ? { confidence: 0.9 } : {}),
});

describe('ProctoringEventBuffer', () => {
  it('assigns monotonic clientSeq and unique idempotency keys in enqueue order', () => {
    const buffer = new ProctoringEventBuffer();
    buffer.enqueue(episode('SESSION_STARTED', 0));
    buffer.enqueue(episode('FACE_NOT_DETECTED', 1000));
    buffer.enqueue(episode('MULTIPLE_FACES_DETECTED', 2000));

    const batch = buffer.takeBatch(10);
    expect(batch.map((e) => e.clientSeq)).toEqual([0, 1, 2]);
    const keys = new Set(batch.map((e) => e.idempotencyKey));
    expect(keys.size).toBe(3);
    expect(batch[1].type).toBe('FACE_NOT_DETECTED');
  });

  it('takeBatch snapshots without removing; ack removes exactly the acknowledged events', async () => {
    const buffer = new ProctoringEventBuffer();
    buffer.enqueue(episode('SESSION_STARTED', 0));
    buffer.enqueue(episode('FACE_NOT_DETECTED', 1000));
    buffer.enqueue(episode('MULTIPLE_FACES_DETECTED', 2000));

    const first = buffer.takeBatch(2);
    expect(buffer.size).toBe(3); // still queued
    await buffer.ack(first);
    expect(buffer.size).toBe(1);
    expect(buffer.takeBatch(10).map((e) => e.type)).toEqual(['MULTIPLE_FACES_DETECTED']);
  });

  it('drops the OLDEST events past the cap and counts the overflow', () => {
    const buffer = new ProctoringEventBuffer({ max: 3 });
    for (let i = 0; i < 6; i += 1) {
      buffer.enqueue(episode('FACE_NOT_DETECTED', i * 1000));
    }
    expect(buffer.size).toBe(3);
    expect(buffer.droppedCount).toBe(3);
    // Survivors are the NEWEST three.
    expect(buffer.takeBatch(10).map((e) => e.clientSeq)).toEqual([3, 4, 5]);
    expect(buffer.consumeOverflow()).toBe(3);
    expect(buffer.droppedCount).toBe(0);
  });

  it('restores a persisted queue and continues the seq after the max seen', async () => {
    const persisted: QueuedProctoringEvent[][] = [];
    const storage: EventBufferStorage = {
      async load() {
        return persisted.length
          ? persisted[persisted.length - 1]
          : [];
      },
      async persist(events) {
        persisted.push([...events]);
      },
      async clear() {
        persisted.length = 0;
      },
    };

    const first = new ProctoringEventBuffer({ storage });
    first.enqueue(episode('SESSION_STARTED', 0));
    first.enqueue(episode('FACE_NOT_DETECTED', 1000));
    await first.persist();

    const second = new ProctoringEventBuffer({ storage });
    await second.restore();
    expect(second.size).toBe(2);
    second.enqueue(episode('MULTIPLE_FACES_DETECTED', 5000));
    const seqs = second.takeBatch(10).map((e) => e.clientSeq);
    expect(seqs).toEqual([0, 1, 2]); // continues, never restarts
  });

  it('reset drops everything and clears persisted storage', async () => {
    let cleared = false;
    const storage: EventBufferStorage = {
      ...nullStorage(),
      async clear() {
        cleared = true;
      },
    };
    const buffer = new ProctoringEventBuffer({ storage });
    buffer.enqueue(episode('SESSION_STARTED', 0));
    await buffer.reset();
    expect(buffer.size).toBe(0);
    expect(cleared).toBe(true);
  });
});
