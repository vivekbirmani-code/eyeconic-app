/**
 * Web proctoring engine — localStorage-backed event buffer storage.
 *
 * Implements the shared EventBufferStorage contract (services/proctoring/
 * eventBuffer.ts) for the browser: the same take/ack semantics as the
 * mobile AsyncStorage adapter, keyed per attempt, capped by the buffer
 * itself. Survives refreshes (a mid-quiz refresh replays the queued
 * episodes on the next arm — the server collapses duplicates by
 * idempotency key).
 */

import type { EventBufferStorage, QueuedProctoringEvent } from '@app-services/proctoring/eventBuffer';

// Episode events are tiny JSON (~200 B each) and the buffer caps itself at
// 500 — ~100 KB worst case, comfortably inside localStorage's ~5 MB.
const keyFor = (attemptId: string) => `eyeconic_proctoring_buffer_${attemptId}`;

export const localStorageBufferStorage = (attemptId: string): EventBufferStorage => ({
  async load(): Promise<QueuedProctoringEvent[]> {
    try {
      const raw = localStorage.getItem(keyFor(attemptId));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as QueuedProctoringEvent[]) : [];
    } catch {
      return [];
    }
  },
  async persist(events: QueuedProctoringEvent[]): Promise<void> {
    try {
      localStorage.setItem(keyFor(attemptId), JSON.stringify(events));
    } catch {
      // Quota/private-mode — the in-memory queue keeps working; only the
      // refresh-replay cushion is lost.
    }
  },
  async clear(): Promise<void> {
    try {
      localStorage.removeItem(keyFor(attemptId));
    } catch {
      // ignore
    }
  },
});
