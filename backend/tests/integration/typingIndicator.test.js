/**
 * Typing indicator relay (Groups Phase 3).
 *
 * Boots the REAL server.js (Express + Socket.IO) and asserts the relay
 * contract:
 *   1. A REGISTERED socket emitting typing_start/typing_stop in a group room
 *      relays to the room with the VERIFIED userId (socket.userId), never a
 *      claimed one from the payload.
 *   2. An UNREGISTERED socket (no token) cannot relay typing at all.
 *   3. Malformed groupIds are dropped.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'typing-relay-test-secret';

const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');
const db = require('../helpers/db');

let app;
let server;
let ioInstance;
let User;
let Group;

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

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

const waitForEvent = (socket, event, timeoutMs = 4000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);
    const handler = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });

beforeAll(async () => {
  await db.connect();
  ({ app, server } = require('../../server'));
  ioInstance = app.get('io');
  User = require('../../models/User');
  Group = require('../../models/Group');
  await new Promise((resolve) => server.listen(0, resolve));
});

afterAll(async () => {
  await new Promise((resolve) => ioInstance.close(resolve));
  await db.closeDatabase();
});

beforeEach(async () => {
  await db.clearDatabase();
});

describe('Typing indicator relay', () => {
  let mentor;
  let student;
  let mentorToken;
  let group;

  beforeEach(async () => {
    mentor = await User.create({
      name: 'Typing Mentor', email: `tm-${Date.now()}@example.com`, password: 'password123', role: 'mentor',
    });
    student = await User.create({
      name: 'Typing Student', email: `ts-${Date.now()}@example.com`, password: 'password123', role: 'student',
    });
    mentorToken = jwt.sign(
      { userId: mentor._id.toString(), role: 'mentor' },
      process.env.JWT_SECRET
    );
    group = await Group.create({
      name: 'Typing Relay Group', type: 'general',
      members: [mentor._id, student._id], createdBy: mentor._id,
    });
  });

  it('relays typing_start with the VERIFIED userId, ignoring a spoofed claim', async () => {
    const port = server.address().port;
    const mentorClient = await connectClient(port, { token: mentorToken });
    const studentClient = await connectClient(port); // observer: joins the room
    studentClient.emit('join_room', group._id.toString());
    await settle();

    const heard = waitForEvent(studentClient, 'typing');
    // Payload tries to claim the STUDENT is the typist; the relay must
    // attribute it to the token's subject (the mentor).
    mentorClient.emit('typing_start', { groupId: group._id.toString(), userId: student._id.toString() });
    const payload = await heard;

    expect(payload.groupId).toBe(group._id.toString());
    expect(payload.userId).toBe(mentor._id.toString());

    mentorClient.disconnect();
    studentClient.disconnect();
  });

  it('relays typing_stop with the verified userId', async () => {
    const port = server.address().port;
    const mentorClient = await connectClient(port, { token: mentorToken });
    const studentClient = await connectClient(port);
    studentClient.emit('join_room', group._id.toString());
    await settle();

    const heard = waitForEvent(studentClient, 'typing_stop');
    mentorClient.emit('typing_stop', { groupId: group._id.toString() });
    const payload = await heard;

    expect(payload.userId).toBe(mentor._id.toString());

    mentorClient.disconnect();
    studentClient.disconnect();
  });

  it('does not relay typing from an unregistered socket', async () => {
    const port = server.address().port;
    const anonClient = await connectClient(port); // no token, never registers
    const mentorClient = await connectClient(port, { token: mentorToken });
    mentorClient.emit('join_room', group._id.toString());
    await settle();

    let leaked = false;
    mentorClient.once('typing', () => { leaked = true; });
    anonClient.emit('typing_start', { groupId: group._id.toString() });
    await settle(600);

    expect(leaked).toBe(false);

    anonClient.disconnect();
    mentorClient.disconnect();
  });

  it('drops malformed groupIds', async () => {
    const port = server.address().port;
    const mentorClient = await connectClient(port, { token: mentorToken });
    const studentClient = await connectClient(port);
    await settle();

    let leaked = false;
    studentClient.once('typing', () => { leaked = true; });
    mentorClient.emit('typing_start', { groupId: 'not-an-object-id' });
    mentorClient.emit('typing_start', {});
    mentorClient.emit('typing_start', 'string-payload');
    await settle(600);

    expect(leaked).toBe(false);

    mentorClient.disconnect();
    studentClient.disconnect();
  });
});
