import { EventEmitter } from 'events';
import {
  LeaderboardSocket,
  subscribeLeaderboardRoom,
} from '../leaderboardSubscription';

/** EventEmitter-based socket.io-client stand-in: `connected` mirrors whether
 * the fake transport is up, mirroring the real Socket's flag semantics. */
class FakeSocket extends EventEmitter implements LeaderboardSocket {
  connected = false;
  emitted: Array<{ event: string; args: unknown[] }> = [];

  emit(event: string, ...args: unknown[]): boolean {
    this.emitted.push({ event, args });
    return super.emit(event, ...args);
  }

  joins(): number {
    return this.emitted.filter((e) => e.event === 'join_leaderboard').length;
  }

  leaves(): number {
    return this.emitted.filter((e) => e.event === 'leave_leaderboard').length;
  }

  connect(): void {
    this.connected = true;
    this.emit('connect');
  }

  disconnect(): void {
    this.connected = false;
    this.emit('disconnect');
  }
}

function callbacks() {
  return {
    onUpdate: jest.fn(),
    onResync: jest.fn(),
    onLiveChange: jest.fn(),
  };
}

describe('subscribeLeaderboardRoom', () => {
  const testId = '507f1f77bcf86cd799439011';

  it('degrades to offline and cleans up as a no-op without a socket', () => {
    const cb = callbacks();
    const unsubscribe = subscribeLeaderboardRoom(null, testId, cb);

    expect(cb.onLiveChange).toHaveBeenCalledWith(false);
    expect(cb.onUpdate).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('joins immediately when the socket is already connected (no resync — consumers fetch at mount)', () => {
    const socket = new FakeSocket();
    socket.connect();
    const cb = callbacks();

    subscribeLeaderboardRoom(socket, testId, cb);

    expect(socket.joins()).toBe(1);
    expect(cb.onResync).not.toHaveBeenCalled();
    expect(cb.onLiveChange).toHaveBeenCalledWith(true);
  });

  it('does not join until the socket connects', () => {
    const socket = new FakeSocket();
    const cb = callbacks();

    subscribeLeaderboardRoom(socket, testId, cb);
    expect(socket.joins()).toBe(0);
    expect(cb.onResync).not.toHaveBeenCalled();

    socket.connect();
    expect(socket.joins()).toBe(1);
    expect(cb.onResync).not.toHaveBeenCalled(); // first join is not a resync
    expect(cb.onLiveChange).toHaveBeenCalledWith(true);
  });

  it('re-joins and resyncs after every disconnect→reconnect (rooms do not survive)', () => {
    // Regression test for the live-leaderboard freeze: the 'connect' listener
    // used to be registered only when the socket was NOT connected at mount,
    // so a socket that connected once never re-joined the room and the board
    // stayed frozen until a manual refresh.
    const socket = new FakeSocket();
    socket.connect();
    const cb = callbacks();

    subscribeLeaderboardRoom(socket, testId, cb);

    socket.disconnect();
    expect(cb.onLiveChange).toHaveBeenLastCalledWith(false);

    socket.connect();
    expect(socket.joins()).toBe(2); // joined again
    expect(cb.onResync).toHaveBeenCalledTimes(1); // resynced the gap
    expect(cb.onLiveChange).toHaveBeenLastCalledWith(true);

    // A second cycle must behave identically.
    socket.disconnect();
    socket.connect();
    expect(socket.joins()).toBe(3);
    expect(cb.onResync).toHaveBeenCalledTimes(2);
  });

  it('surfaces nudges only for the subscribed test', () => {
    const socket = new FakeSocket();
    const cb = callbacks();
    subscribeLeaderboardRoom(socket, testId, cb);

    socket.emit('quiz_leaderboard_updated', {
      quizId: '000000000000000000000000',
      cohort: 'internal',
    });
    socket.emit('quiz_leaderboard_updated', { noQuizId: true });
    expect(cb.onUpdate).not.toHaveBeenCalled();

    socket.emit('quiz_leaderboard_updated', {
      quizId: testId,
      cohort: 'internal',
      attemptId: 'a1',
    });
    expect(cb.onUpdate).toHaveBeenCalledTimes(1);
    expect(cb.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ quizId: testId, attemptId: 'a1' })
    );
  });

  it('cleanup removes every listener and leaves the room exactly once', () => {
    const socket = new FakeSocket();
    socket.connect();
    const cb = callbacks();

    const unsubscribe = subscribeLeaderboardRoom(socket, testId, cb);
    unsubscribe();

    expect(socket.leaves()).toBe(1);
    expect(socket.listenerCount('connect')).toBe(0);
    expect(socket.listenerCount('disconnect')).toBe(0);
    expect(socket.listenerCount('quiz_leaderboard_updated')).toBe(0);

    // Nothing may fire after cleanup — no joins, no resyncs, no updates, no
    // live-pill flips (the last onLiveChange stays the initial `true`).
    const joinsBefore = socket.joins();
    socket.emit('quiz_leaderboard_updated', { quizId: testId });
    socket.disconnect();
    socket.connect();
    expect(socket.joins()).toBe(joinsBefore);
    expect(cb.onUpdate).not.toHaveBeenCalled();
    expect(cb.onResync).not.toHaveBeenCalled(); // resyncs only follow a reconnect
    expect(cb.onLiveChange).toHaveBeenCalledTimes(1);
    expect(cb.onLiveChange).toHaveBeenLastCalledWith(true);
  });

  it('supports independent subscriptions for the same test on one socket', () => {
    // The screen-level invalidator and the LiveLeaderboard card both
    // subscribe on ONE shared app socket, and a Socket.IO room membership
    // belongs to the socket — an unrefcounted leave from the card's cleanup
    // (unmounting when the screen switches Test → Proctoring tab) used to
    // evict the socket from the room and silently freeze the screen's live
    // updates until the next reconnect. Room leaves are refcounted: only the
    // LAST subscriber's cleanup leaves.
    const socket = new FakeSocket();
    socket.connect();
    const screenCb = callbacks();
    const cardCb = callbacks();

    const unsubscribeScreen = subscribeLeaderboardRoom(socket, testId, screenCb);
    const unsubscribeCard = subscribeLeaderboardRoom(socket, testId, cardCb);
    expect(socket.joins()).toBe(2);

    // Card unmounts (tab switch) — the shared socket STAYS in the room.
    unsubscribeCard();
    expect(socket.leaves()).toBe(0);

    // The screen subscription keeps receiving updates with no reconnect.
    socket.emit('quiz_leaderboard_updated', { quizId: testId, attemptId: 'a1' });
    expect(screenCb.onUpdate).toHaveBeenCalledTimes(1);
    expect(cardCb.onUpdate).not.toHaveBeenCalled();

    // The LAST subscriber out is what actually leaves the room.
    unsubscribeScreen();
    expect(socket.leaves()).toBe(1);
  });

  it('re-arms room joins after the refcount drains to zero', () => {
    const socket = new FakeSocket();
    socket.connect();
    const cb = callbacks();

    const unsubscribe = subscribeLeaderboardRoom(socket, testId, cb);
    unsubscribe();
    expect(socket.leaves()).toBe(1);

    // A later subscription for the same room joins and leaves normally again.
    const reunsubscribe = subscribeLeaderboardRoom(socket, testId, callbacks());
    expect(socket.joins()).toBe(2);
    reunsubscribe();
    expect(socket.leaves()).toBe(2);
  });
});
