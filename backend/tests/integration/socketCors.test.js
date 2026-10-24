/**
 * Socket.IO CORS wiring (fix for the silent engine.io CORS disable).
 *
 * `socketIo(server, createSocketCorsOptions())` passed the cors options at
 * the TOP level, but Socket.IO v4 only reads them from a nested `cors` key —
 * engine.io therefore sent NO Access-Control-Allow-Origin header at all, and
 * browsers blocked every cross-origin polling handshake (net::ERR_FAILED →
 * endless reconnect loop). Production was masked only because the public web
 * client forces websocket-only transport (WebSocket upgrades are not
 * CORS-gated); the Expo app's polling-first socket could never connect from
 * a browser. This test pins the polling handshake's CORS contract against
 * the REAL server.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'socket-cors-test-secret';

const http = require('http');
const db = require('../helpers/db');

let server;

/** Raw engine.io polling handshake, the exact request a browser makes first. */
const handshake = (port, origin) =>
  new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling&t=cors-test`,
      { headers: origin ? { Origin: origin } : {} },
      (res) => {
        res.resume(); // drain — only headers matter here
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
      }
    );
    req.on('error', reject);
  });

beforeAll(async () => {
  await db.connect();
  ({ server } = require('../../server'));
  await new Promise((resolve) => server.listen(0, resolve));
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.closeDatabase();
});

describe('Socket.IO CORS', () => {
  it('echoes an allowed origin on the polling handshake (ACAO header present)', async () => {
    const port = server.address().port;
    // localhost:5173 is a default dev origin (config/cors.js) — no env needed.
    const res = await handshake(port, 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('does not bless a disallowed origin (no ACAO header)', async () => {
    const port = server.address().port;
    const res = await handshake(port, 'https://attacker.example');
    expect(res.status).toBe(200); // engine.io still answers; browsers reject
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
