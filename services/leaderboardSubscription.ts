/**
 * Socket-room subscription for a test's live leaderboard room
 * (`leaderboard:<quizId>` — join_leaderboard in backend/server.js).
 *
 * ONE implementation of the wiring both leaderboard consumers need (the
 * LiveLeaderboard card and the Test Analytics screen's payload invalidator):
 * join the room, re-join + resync on every reconnect, surface update nudges
 * for THIS test only, and leave no listeners behind on cleanup.
 *
 * The reconnect contract is the whole point: Socket.IO rooms do NOT survive a
 * disconnect, so a socket that was connected when this subscription started
 * must still re-join when it reconnects later (network blip, app
 * backgrounding, backend redeploy). Registering the 'connect' handler
 * unconditionally — and joining immediately when already connected — is what
 * keeps the board live; joining once at mount silently freezes it at whatever
 * it last fetched.
 */

export interface LeaderboardUpdatePayload {
  quizId?: string;
  attemptId?: string;
  cohort?: 'internal' | 'external';
  [key: string]: unknown;
}

/** The socket surface this module needs — satisfied by socket.io-client's
 * Socket, and by an EventEmitter-based mock in tests (no RN imports). Handler
 * params are any[] so narrowly-typed handlers stay assignable (socket.io
 * delivers untyped payloads). */
export interface LeaderboardSocket {
  connected: boolean;
  emit(event: string, ...args: unknown[]): void;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
}

export interface LeaderboardSubscriptionCallbacks {
  /** A finalized submission landed for THIS test (payload.quizId matched). */
  onUpdate: (payload: LeaderboardUpdatePayload) => void;
  /** The socket RE-connected after a disconnect and the room was re-joined —
   * resync anything that may have been missed while offline. NOT fired for
   * the initial join: consumers fetch their first snapshot at mount anyway,
   * so an initial resync would only duplicate that fetch. */
  onResync: () => void;
  /** Socket transport liveness for the LIVE/OFFLINE pill. */
  onLiveChange?: (live: boolean) => void;
}

/**
 * Per-socket room refcounts. Two consumers share ONE app socket — the
 * LiveLeaderboard card and the Analytics screen's payload invalidator — and a
 * Socket.IO room membership belongs to the SOCKET, not to whichever consumer
 * joined first. An unrefcounted `leave_leaderboard` from one consumer's
 * cleanup (e.g. LiveLeaderboard unmounting when the screen switches from the
 * Test tab to the Proctoring tab) evicts the shared socket from the room and
 * silently kills the OTHER consumer's live updates until the next reconnect.
 * Leaving only when the last subscriber for that socket+room goes away keeps
 * each subscription's lifecycle independent, which is the module's contract.
 */
const roomRefcounts = new WeakMap<LeaderboardSocket, Map<string, number>>();

export function subscribeLeaderboardRoom(
  socket: LeaderboardSocket | null,
  testId: string,
  { onUpdate, onResync, onLiveChange }: LeaderboardSubscriptionCallbacks
): () => void {
  if (!socket) {
    onLiveChange?.(false);
    return () => {};
  }

  const handleUpdate = (payload: LeaderboardUpdatePayload) => {
    // Nudges are room-scoped, but the shared screen socket carries this
    // listener across test switches too — only act on THIS test's events.
    if (!payload || payload.quizId !== testId) return;
    onUpdate(payload);
  };

  let hasJoined = false;
  const handleConnect = () => {
    onLiveChange?.(true);
    // Idempotent server-side; re-armed on every reconnect because rooms do
    // not survive a disconnect.
    socket.emit('join_leaderboard', testId);
    if (hasJoined) {
      // Anything may have been finalized while we were offline.
      onResync();
    }
    hasJoined = true;
  };

  const handleDisconnect = () => onLiveChange?.(false);

  socket.on('connect', handleConnect);
  socket.on('disconnect', handleDisconnect);
  socket.on('quiz_leaderboard_updated', handleUpdate);

  let refcounts = roomRefcounts.get(socket);
  if (!refcounts) {
    refcounts = new Map();
    roomRefcounts.set(socket, refcounts);
  }
  refcounts.set(testId, (refcounts.get(testId) ?? 0) + 1);

  if (socket.connected) {
    handleConnect();
  }

  return () => {
    socket.off('connect', handleConnect);
    socket.off('disconnect', handleDisconnect);
    socket.off('quiz_leaderboard_updated', handleUpdate);
    const remaining = (roomRefcounts.get(socket)?.get(testId) ?? 0) - 1;
    if (remaining > 0) {
      roomRefcounts.get(socket)?.set(testId, remaining);
    } else {
      roomRefcounts.get(socket)?.delete(testId);
      socket.emit('leave_leaderboard', testId);
    }
  };
}
