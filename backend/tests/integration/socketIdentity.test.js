/**
 * Socket registration identity (Phase 3 — solve identity).
 *
 * Boots the REAL server.js (Express + Socket.IO) like
 * scripts/verify-live-leaderboard.js does, and asserts the registration
 * contract:
 *
 *   1. A socket presenting a valid user JWT (handshake auth) is registered
 *      under the token's subject and receives that user's targeted events.
 *   2. A socket claiming a userId with NO token is refused (register_rejected)
 *      and receives NO targeted events — including the claimed user's.
 *   3. A socket presenting user A's token while claiming user B's id is
 *      registered as A (the token wins, the claim never does) — via both the
 *      handshake token and the register_user event's token argument.
 *   4. Scoped credentials (guest-kind JWTs) cannot register a socket.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'socket-identity-test-secret';

const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');
const db = require('../helpers/db');

// Required lazily (after env + mongo are pinned) like the verify script.
let app;
let server;
let ioInstance;
let socketHelpers;
let User;

const waitFor = (socket, event, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

/** Creates the client (listeners can be armed) and resolves once connected. */
const connectClient = (port, auth) =>
  new Promise((resolve, reject) => {
    const client = io(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      ...(auth !== undefined ? { auth } : {}),
    });
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for socket connect')),
      5000
    );
    client.once('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(new Error(`connect_error: ${err && err.message}`));
    });
  });

const probeReach = (client) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 400);
    client.once('identity_probe', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

beforeAll(async () => {
  await db.connect();
  ({ app, server } = require('../../server'));
  ioInstance = app.get('io');
  socketHelpers = require('../../utils/socket-helpers');
  User = require('../../models/User');
  await new Promise((resolve) => server.listen(0, resolve));
});

afterAll(async () => {
  await new Promise((resolve) => ioInstance.close(resolve));
  await db.closeDatabase();
});

beforeEach(async () => {
  await db.clearDatabase();
});

describe('Socket registration identity', () => {
  let studentA;
  let studentB;
  let tokenA;

  beforeEach(async () => {
    studentA = await User.create({
      name: 'Ann Student',
      email: `ann-${Date.now()}@example.com`,
      password: 'password123',
      role: 'student',
    });
    studentB = await User.create({
      name: 'Ben Student',
      email: `ben-${Date.now()}@example.com`,
      password: 'password123',
      role: 'student',
    });
    tokenA = jwt.sign(
      { userId: studentA._id.toString(), role: 'student' },
      process.env.JWT_SECRET
    );
  });

  it('registers a socket presenting a valid token and delivers that user events', async () => {
    const port = server.address().port;
    const client = await connectClient(port, { token: tokenA });
    await settle();

    const reach = probeReach(client);
    socketHelpers.emitToUser(studentA._id, 'identity_probe', { ok: true });
    expect(await reach).toBe(true);

    client.disconnect();
  });

  it('refuses token-less registration and delivers the CLAIMED user no events to it', async () => {
    const port = server.address().port;
    const client = await connectClient(port); // no auth

    const rejected = waitFor(client, 'register_rejected');
    client.emit('register_user', studentB._id.toString()); // claims B, proves nothing
    await rejected;
    await settle();

    const reach = probeReach(client);
    socketHelpers.emitToUser(studentB._id, 'identity_probe', { ok: true });
    socketHelpers.emitToUser(studentA._id, 'identity_probe', { ok: true });
    expect(await reach).toBe(false);

    client.disconnect();
  });

  it('registers under the TOKEN subject when the handshake-registered socket claims another id', async () => {
    const port = server.address().port;
    // Handshake carries A's token; the event then claims B's id.
    const client = await connectClient(port, { token: tokenA });
    client.emit('register_user', studentB._id.toString());
    await settle();

    const reachA = probeReach(client);
    socketHelpers.emitToUser(studentA._id, 'identity_probe', { to: 'A' });
    expect(await reachA).toBe(true);

    const reachB = probeReach(client);
    socketHelpers.emitToUser(studentB._id, 'identity_probe', { to: 'B' });
    expect(await reachB).toBe(false);

    client.disconnect();
  });

  it('registers under the TOKEN subject when the token arrives with the event and mismatches the claim', async () => {
    const port = server.address().port;
    const client = await connectClient(port); // no handshake auth

    // Claims B while presenting A's token as the second argument: the token
    // wins, so this must NOT register as B.
    client.emit('register_user', studentB._id.toString(), tokenA);
    await settle();

    const reachA = probeReach(client);
    socketHelpers.emitToUser(studentA._id, 'identity_probe', { to: 'A' });
    expect(await reachA).toBe(true);

    const reachB = probeReach(client);
    socketHelpers.emitToUser(studentB._id, 'identity_probe', { to: 'B' });
    expect(await reachB).toBe(false);

    client.disconnect();
  });

  it('refuses guest-kind tokens', async () => {
    const guestToken = jwt.sign(
      { kind: 'guest', guestId: studentB._id.toString() },
      process.env.JWT_SECRET
    );
    const port = server.address().port;

    // register_rejected can fire the moment the server processes the
    // handshake, so arm the waiter before the connect resolves.
    const client = io(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      auth: { token: guestToken },
    });
    const rejected = waitFor(client, 'register_rejected');
    await waitFor(client, 'connect');
    await rejected;
    await settle();

    const reach = probeReach(client);
    socketHelpers.emitToUser(studentB._id, 'identity_probe', { ok: true });
    expect(await reach).toBe(false);

    client.disconnect();
  });
});
