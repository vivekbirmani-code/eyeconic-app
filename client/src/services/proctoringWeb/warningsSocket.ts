/**
 * Web proctoring engine — live warning lane.
 *
 * Connects the public Socket.IO server with the OTP-verified guest token
 * (handshake auth — the server registers it in the SEPARATE guest lane and
 * derives identity from the token, never from client claims). Emits of
 * `proctoring_warning` for THIS guest arrive instantly; the batch-response
 * `actions` channel remains the always-on fallback (deduped by warnId in
 * the hook). Auto-reconnect is socket.io default behavior — a missed
 * warning during a disconnect is recovered by the next batch response.
 */

import { io, type Socket } from 'socket.io-client';

export interface ProctoringWarningPayload {
  warnId: string;
  kind: string;
  code: string;
  quizId?: string;
  attemptId?: string;
}

const resolveSocketUrl = (): string => {
  if (import.meta.env.VITE_SOCKET_URL) return import.meta.env.VITE_SOCKET_URL;
  // Derive from the API URL like every other socket consumer
  // (NotificationContext derives the socket origin the same way) — a
  // deployment that sets only VITE_API_URL must never dial localhost
  // (review finding).
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) return apiUrl.replace(/\/api\/?$/, '');
  return 'http://localhost:3000';
};

export function connectGuestWarningsSocket(
  guestToken: string,
  onWarning: (payload: ProctoringWarningPayload) => void
): () => void {
  const socket: Socket = io(resolveSocketUrl(), {
    transports: ['websocket', 'polling'],
    auth: { token: guestToken },
    // Proctoring warnings must never keep a dead connection spinning.
    reconnectionAttempts: 20,
    reconnectionDelay: 2000,
  });

  socket.on('proctoring_warning', (payload: ProctoringWarningPayload) => {
    if (payload && typeof payload.warnId === 'string') onWarning(payload);
  });

  return () => {
    socket.removeAllListeners('proctoring_warning');
    socket.disconnect();
  };
}
