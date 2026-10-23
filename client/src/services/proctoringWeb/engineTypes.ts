/**
 * Web proctoring engine — wire-shaping types.
 *
 * The shared ProctoringEventType union (services/proctoring/types.ts) is the
 * NATIVE surface: its TAB_HIDDEN/WINDOW_BLUR arrive server-side via the
 * legacy dual-write there. The WEB engine emits TAB_HIDDEN directly from
 * visibilitychange, so the web union extends the shared one and the wire
 * source map adds the browser-sourced types. Everything else (episodes,
 * idempotency keys, clientSeq, batching) is byte-identical to the mobile
 * contract — the server cannot tell the engines apart, by design.
 */

import type {
  ProctoringEpisodeEvent,
  ProctoringEventType,
} from '@app-services/proctoring/types';

/** Web-emittable event types (shared union + browser focus signals). */
export type WebProctoringEventType = ProctoringEventType | 'TAB_HIDDEN' | 'WINDOW_BLUR';

export type WebEventSourceValue = 'cv' | 'os' | 'system' | 'browser';

/** Registry source per type — mirrors the server's per-type source lists. */
export const WEB_EVENT_SOURCE_BY_TYPE: Record<WebProctoringEventType, WebEventSourceValue> = {
  SESSION_STARTED: 'system',
  SESSION_RESUMED: 'system',
  SESSION_DEGRADED: 'system',
  MODEL_UNAVAILABLE: 'cv',
  CAMERA_UNAVAILABLE: 'cv',
  CAMERA_PERMISSION_REVOKED: 'cv',
  CAMERA_TRACK_ENDED: 'cv',
  CAMERA_FEED_DARK: 'cv',
  CAMERA_FEED_FROZEN: 'cv',
  FACE_NOT_DETECTED: 'cv',
  FACE_PARTIALLY_VISIBLE: 'cv',
  FACE_OUT_OF_FRAME: 'cv',
  MULTIPLE_FACES_DETECTED: 'cv',
  HEAD_POSE_EXTREME: 'cv',
  HEAD_POSE_TURNED: 'cv',
  HEAD_POSE_REPEATED: 'cv',
  ATTENTION_DEVIATION_SUSTAINED: 'cv',
  ATTENTION_DEVIATION_REPEATED: 'cv',
  APP_BACKGROUND: 'os',
  EXIT_ATTEMPTED: 'os',
  // Web-only: emitted directly by the web focus tracker (the registered
  // flow's web telemetry reaches these types via the legacy dual-write).
  TAB_HIDDEN: 'browser',
  WINDOW_BLUR: 'browser',
};

export interface WebBatchPayloadEvent {
  idempotencyKey: string;
  clientSeq: number;
  type: WebProctoringEventType;
  source: WebEventSourceValue;
  openedAt: number;
  closedAt?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface ProctoringBatchPayload {
  sessionId: string;
  seq?: number;
  heartbeat: boolean;
  bufferOverflow: number;
  events: WebBatchPayloadEvent[];
}

/** A finished episode, with the web type union (TAB_HIDDEN relabeling). */
export type WebEpisode = Omit<ProctoringEpisodeEvent, 'type'> & {
  type: WebProctoringEventType;
};
