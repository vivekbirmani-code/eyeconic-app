// Guest socket lane (socket-helpers) — the separate registration map that
// lets OTP-verified leads receive live proctoring warnings. Locks the lane
// separation rules: guest tokens register ONLY as guests, user/precheck
// tokens never register as guests, and emissions reach exactly the verified
// guest's sockets.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const jwt = require('jsonwebtoken');
const {
  setIo,
  verifyGuestSocketToken,
  registerGuestSocket,
  unregisterGuestSocket,
  emitToGuest,
} = require('../../../utils/socket-helpers');

// Minimal io stub: sockets.sockets is a Map of socketId → {emit spy}.
const makeFakeIo = () => {
  const sockets = new Map();
  return {
    sockets: { sockets },
    addSocket: (id) => {
      const socket = { emitted: [] };
      socket.emit = (event, data) => socket.emitted.push({ event, data });
      sockets.set(id, socket);
      return socket;
    },
  };
};

const signGuest = (guestId) =>
  jwt.sign({ kind: 'guest', guestId: String(guestId) }, process.env.JWT_SECRET, { expiresIn: '1h' });
const signUser = (userId) =>
  jwt.sign({ userId: String(userId) }, process.env.JWT_SECRET, { expiresIn: '1h' });

describe('guest socket lane', () => {
  let io;
  beforeAll(() => {
    io = makeFakeIo();
    setIo(io);
  });

  it('verifies ONLY guest-kind tokens', () => {
    expect(verifyGuestSocketToken(signGuest('507f1f77bcf86cd799439011'))).toEqual({
      ok: true, guestId: '507f1f77bcf86cd799439011',
    });
    expect(verifyGuestSocketToken(signUser('507f1f77bcf86cd799439022')).ok).toBe(false);
    expect(verifyGuestSocketToken('garbage').ok).toBe(false);
    expect(verifyGuestSocketToken('').ok).toBe(false);
  });

  it('emits to exactly the registered guest sockets (multi-socket, multi-guest)', () => {
    const guestA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const guestB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    const s1 = io.addSocket('socket-1');
    const s2 = io.addSocket('socket-2');
    const s3 = io.addSocket('socket-3'); // guest B — must NOT receive A's events

    registerGuestSocket('socket-1', guestA);
    registerGuestSocket('socket-2', guestA);
    registerGuestSocket('socket-3', guestB);

    emitToGuest(guestA, 'proctoring_warning', { warnId: 'w1' });

    expect(s1.emitted).toEqual([{ event: 'proctoring_warning', data: { warnId: 'w1' } }]);
    expect(s2.emitted).toEqual([{ event: 'proctoring_warning', data: { warnId: 'w1' } }]);
    expect(s3.emitted).toEqual([]);

    // Unregister one socket — the other still receives.
    unregisterGuestSocket('socket-1', guestA);
    emitToGuest(guestA, 'proctoring_warning', { warnId: 'w2' });
    expect(s1.emitted.length).toBe(1);
    expect(s2.emitted.length).toBe(2);
  });

  it('cleans the map entry when the last socket for a guest disconnects', () => {
    const guest = 'cccccccccccccccccccccccc';
    io.addSocket('socket-4');
    registerGuestSocket('socket-4', guest);
    unregisterGuestSocket('socket-4', guest);
    // Re-registering after cleanup must work (no stale Set).
    io.addSocket('socket-5');
    registerGuestSocket('socket-5', guest);
    const s5 = io.sockets.sockets.get('socket-5');
    emitToGuest(guest, 'ping', {});
    expect(s5.emitted.length).toBe(1);
  });
});
