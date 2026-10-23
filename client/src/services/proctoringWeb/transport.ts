/**
 * Web proctoring engine — batch transport to the public events endpoint.
 *
 * Mirrors the mobile engine's transport contract (ProctoringBatchPayload →
 * ProctoringSendOutcome) against
 * POST /api/public/quiz/:token/attempt/:attemptId/proctoring/events.
 * The response's `actions` array (WARN/FINAL_WARN) is the always-on warning
 * channel — surfaced to the caller alongside the outcome; the live socket
 * push (warningsSocket) is the instant lane, deduped by warnId upstream.
 */

import { publicApi } from '../../services/publicApi';
import type { ProctoringSendOutcome } from '@app-services/proctoring/types';
import type { ProctoringBatchPayload } from '../proctoringWeb/engineTypes';

export interface TransportAction {
  kind: string;
  code: string;
  warnId: string;
  ruleId?: string;
}

export interface TransportResult {
  outcome: ProctoringSendOutcome;
  actions: TransportAction[];
  attemptFinalized: boolean;
}

export function createEventsTransport(
  shareToken: string,
  attemptId: string,
  guestId: string
): (payload: ProctoringBatchPayload) => Promise<TransportResult> {
  return async (payload) => {
    try {
      const response = await publicApi.post<{
        success: boolean;
        accepted?: number;
        duplicates?: string[];
        floodFlagged?: boolean;
        actions?: TransportAction[];
        attemptFinalized?: boolean;
        session?: { status: string };
      }>(`/public/quiz/${shareToken}/attempt/${attemptId}/proctoring/events`, {
        guestId,
        sessionId: payload.sessionId,
        ...(payload.seq !== undefined ? { seq: payload.seq } : {}),
        heartbeat: payload.heartbeat,
        bufferOverflow: payload.bufferOverflow,
        events: payload.events,
      });

      const data = response.data ?? ({} as Record<string, never>);
      return {
        outcome: {
          kind: 'accepted',
          duplicates: data.duplicates?.length ?? 0,
          ...(data.floodFlagged ? { floodFlagged: true } : {}),
        },
        actions: Array.isArray(data.actions) ? data.actions : [],
        attemptFinalized: data.attemptFinalized === true,
      };
    } catch (err) {
      // Outcome mapping mirrors the mobile axios mapping: 400 = permanent
      // (drop batch), 409/session-closed = stop everything, everything
      // else (network/429/5xx) = retryable with the batch kept.
      const status =
        // axios error shape (the public instance throws AxiosError)
        (err as { response?: { status?: number } })?.response?.status;
      const code =
        ((err as { response?: { data?: { code?: string } } })?.response?.data?.code as string) || undefined;
      if (status === 400) {
        return { outcome: { kind: 'permanent_reject', reason: code }, actions: [], attemptFinalized: false };
      }
      if (status === 409 || code === 'SESSION_NOT_ACTIVE' || code === 'ATTEMPT_NOT_FOUND') {
        return { outcome: { kind: 'session_closed' }, actions: [], attemptFinalized: true };
      }
      return { outcome: { kind: 'retryable', reason: code }, actions: [], attemptFinalized: false };
    }
  };
}
