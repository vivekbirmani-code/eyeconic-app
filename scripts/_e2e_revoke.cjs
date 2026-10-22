/**
 * TEMPORARY E2E verification of the revoke-share-link fix (delete after run).
 *
 * Boots the REAL backend (server.js + in-memory Mongo), pre-seeds the exact
 * production landmine (one quiz doc with an EXPLICIT null shareToken — what
 * the 2026-10-21 revoke of "FMGE MOCK GT PART 2" left behind), then drives
 * the admin workflow exactly as the app does:
 *
 *   1. generate-share-link on quiz A → public metadata reachable
 *   2. revoke quiz B (the operation that 500s in production right now,
 *      because the pre-seeded null doc already owns the unique index key)
 *   3. revoke quiz A too (sequential revokes — the bug's worst case)
 *   4. all public paths reject both revoked tokens (metadata, legacy 302,
 *      guest /start)
 *   5. re-generate on A → works, new token live
 *   6. raw DB assertions: no NEW explicit nulls, quiz data intact
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'revoke-e2e-verify-secret';

const http = require('http');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..', 'backend');
const ROOT = path.resolve(__dirname, '..');

let server;
let baseURL;
let failures = 0;

const log = (...a) => console.log('[e2e]', ...a);
const check = (name, ok, detail) => {
  if (ok) { log(`PASS  ${name}`); } else { failures += 1; log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

function api(method, urlPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath.replace(/^\//, ''), baseURL);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const { MongoMemoryServer } = require(path.join(BACKEND, 'node_modules', 'mongodb-memory-server'));
  const mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  // Require the real server AFTER env is pinned (dotenv won't override).
  const mongoose = require(path.join(BACKEND, 'node_modules', 'mongoose'));
  const { server: httpServer } = require(path.join(BACKEND, 'server'));
  server = httpServer;

  const User = require(path.join(BACKEND, 'models', 'User'));
  const Subject = require(path.join(BACKEND, 'models', 'Subject'));
  const QuestionBank = require(path.join(BACKEND, 'models', 'QuestionBank'));
  const Quiz = require(path.join(BACKEND, 'models', 'Quiz'));
  const jwt = require(path.join(BACKEND, 'node_modules', 'jsonwebtoken'));

  await Quiz.init(); // build the unique sparse index BEFORE seeding

  // ---- Seed ----
  const admin = await User.create({
    name: 'E2E Admin', email: 'e2e-admin@example.com', password: 'password123', role: 'admin',
  });
  const token = jwt.sign({ userId: admin._id.toString() }, process.env.JWT_SECRET);
  const subject = await Subject.create({ name: 'E2E Pathology', year: '1st', displayOrder: 1 });

  const mkQuiz = async (title) => Quiz.create({
    title, subject: subject._id, testType: 'grand', duration: 60,
    questions: [], createdBy: admin._id,
  });

  // The landmine from production: yesterday's successful revoke left exactly
  // one doc with an EXPLICIT null shareToken — it owns the index's null key.
  const landmine = await mkQuiz('FMGE MOCK GT (yesterday, revoked)');
  await Quiz.collection.updateOne({ _id: landmine._id }, { $set: { shareToken: null, isPublic: false } });

  const quizA = await mkQuiz('Quiz A — live link');
  const quizB = await mkQuiz('Quiz B — live link');

  await new Promise((resolve) => server.listen(0, resolve));
  baseURL = `http://127.0.0.1:${server.address().port}/api/`;
  log('backend listening on', server.address().port);

  // ---- 1. Generate a link on A, exactly like the app's Generate button ----
  const genA = await api('POST', `quizzes/${quizA._id}/generate-share-link`, { token, body: {} });
  check('generate link on A → 200', genA.status === 200, `status=${genA.status}`);
  const tokenA = genA.body.shareToken;
  const metaA = await api('GET', `public/quiz/${tokenA}`);
  check('public metadata for A is live before revoke', metaA.status === 200, `status=${metaA.status}`);

  // ---- 2. The exact failing production operation ----
  const genB = await api('POST', `quizzes/${quizB._id}/generate-share-link`, { token, body: {} });
  check('generate link on B → 200', genB.status === 200, `status=${genB.status}`);
  const tokenB = genB.body.shareToken;
  const revokeB = await api('POST', `quizzes/${quizB._id}/revoke-share-link`, { token, body: {} });
  check('revoke B → 200 despite pre-existing null doc (THE BUG)', revokeB.status === 200 && revokeB.body.success === true,
    `status=${revokeB.status} body=${JSON.stringify(revokeB.body)}`);

  // ---- 3. Sequential revoke (worst case) ----
  const revokeA = await api('POST', `quizzes/${quizA._id}/revoke-share-link`, { token, body: {} });
  check('revoke A right after B → 200', revokeA.status === 200 && revokeA.body.success === true,
    `status=${revokeA.status} body=${JSON.stringify(revokeA.body)}`);

  // ---- 4. Every public path rejects both revoked tokens ----
  const metaA2 = await api('GET', `public/quiz/${tokenA}`);
  check('A metadata after revoke → 404', metaA2.status === 404, `status=${metaA2.status}`);
  const metaB2 = await api('GET', `public/quiz/${tokenB}`);
  check('B metadata after revoke → 404', metaB2.status === 404, `status=${metaB2.status}`);

  const redirect = await api('GET', `public/share/${tokenB}`);
  check('legacy 302 carries ?invalid=1', redirect.status === 302 && redirect.headers.location.includes('invalid=1'),
    `status=${redirect.status} loc=${redirect.headers.location}`);

  const start = await api('POST', `public/quiz/${tokenB}/start`, { body: { guestId: 'e2e-device-key' } });
  check('guest start on revoked token → 404', start.status === 404, `status=${start.status}`);

  // ---- 5. Re-generate works; old token stays dead ----
  const regenA = await api('POST', `quizzes/${quizA._id}/generate-share-link`, { token, body: {} });
  check('re-generate on A → 200 with a NEW token', regenA.status === 200 && regenA.body.shareToken !== tokenA,
    `status=${regenA.status}`);
  const metaNew = await api('GET', `public/quiz/${regenA.body.shareToken}`);
  check('new token is live', metaNew.status === 200, `status=${metaNew.status}`);
  const oldA3 = await api('GET', `public/quiz/${tokenA}`);
  check('old token stays dead after re-generate', oldA3.status === 404, `status=${oldA3.status}`);

  // ---- 6. Raw DB assertions ----
  const rawA = await Quiz.collection.findOne({ _id: quizA._id });
  const rawB = await Quiz.collection.findOne({ _id: quizB._id });
  check('B: shareToken field REMOVED (no explicit null written)',
    !('shareToken' in rawB) && rawB.isPublic === false && rawB.publicExpiryDate === null,
    `doc=${JSON.stringify({ shareToken: rawB.shareToken, isPublic: rawB.isPublic })}`);
  check('A: only the re-generated token present (no null churn)',
    rawA.shareToken === regenA.body.shareToken && rawA.isPublic === true,
    `doc=${JSON.stringify({ shareToken: rawA.shareToken, isPublic: rawA.isPublic })}`);
  const explicitNulls = await Quiz.collection.countDocuments({ shareToken: { $exists: true, $type: 'null' } });
  check('still exactly ONE explicit null (the pre-seeded landmine, now inert)', explicitNulls === 1, `count=${explicitNulls}`);
  check('quiz content untouched (title/duration/questions preserved)',
    rawB.title === 'Quiz B — live link' && rawB.duration === 60 && Array.isArray(rawB.questions),
    `title=${rawB.title} duration=${rawB.duration}`);
  check('landmine doc untouched', rawA && (await Quiz.collection.findOne({ _id: landmine._id })).shareToken === null);

  // share-status reflects revoked state (what the Share sheet reads on reopen)
  const statusB = await api('GET', `quizzes/${quizB._id}/share-status`, { token });
  check('share-status shows revoked (no link) after reopen', statusB.status === 200
    && statusB.body.isPublic === false && statusB.body.shareUrl === null,
    `body=${JSON.stringify(statusB.body)}`);

  // Authorization still enforced on the real server stack
  const noAuth = await api('POST', `quizzes/${quizA._id}/revoke-share-link`, { body: {} });
  check('revoke without token → 401', noAuth.status === 401, `status=${noAuth.status}`);

  await server.close();
  await mongoose.disconnect();
  await mongoServer.stop();

  console.log(failures === 0 ? '\nALL E2E CHECKS PASSED' : `\n${failures} E2E CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('E2E CRASHED:', e);
  if (server) await server.close();
  process.exit(1);
});
