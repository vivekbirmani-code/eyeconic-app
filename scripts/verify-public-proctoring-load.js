/**
 * Synthetic load + integrity harness for PUBLIC-QUIZ AI PROCTORING
 * (Phase 5, docs/public-quiz-proctoring-plan.md).
 *
 * Boots the REAL backend (server.js — Express + Socket.IO + in-memory
 * Mongo; the production Atlas URI in backend/.env is inert because env is
 * pinned BEFORE the server loads), then drives N concurrent simulated
 * guests through the COMPLETE proctored public flow:
 *
 *   consent (direct insert) + signed precheck token -> gated /start ->
 *   R rounds of event batches (episodes + piggybacked heartbeats,
 *   realistic envelope shapes) -> submit -> verify CLOSED sessions,
 *   correct event accounting, zero duplicates, server-executed grading.
 *
 * Measures per-request latency (start / events / submit), throughput,
 * wall time, and heap delta — the first real capacity numbers for the
 * public proctoring surface. NOT a browser/CV benchmark (the detector is
 * client-side); this measures the SERVER surfaces only.
 *
 * Run from the repo root:
 *   node scripts/verify-public-proctoring-load.js [guests=25] [rounds=8]
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'public-proctoring-load-secret';
// Dev OTP console echo is irrelevant here (consent is seeded directly) —
// silence nothing else; the server runs its normal config.

const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');

const GUESTS = Math.max(1, parseInt(process.argv[2], 10) || 25);
const ROUNDS = Math.max(1, parseInt(process.argv[3], 10) || 8);

let mongoServer;
let server;
let baseURL;

const log = (...args) => console.log('[load]', ...args);

function requireBackend(modulePath) {
  // eslint-disable-next-line import/no-dynamic-require
  return require(path.join(BACKEND, modulePath));
}

function api(method, urlPath, { token, body } = {}) {
  const started = process.hrtime.bigint();
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath.replace(/^\//, ''), baseURL);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }
          resolve({
            status: res.statusCode,
            body: parsed,
            latencyMs: Number(process.hrtime.bigint() - started) / 1e6,
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const percentile = (sorted, p) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const stats = (latencies) => {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: Math.round(percentile(sorted, 50) * 10) / 10,
    p95: Math.round(percentile(sorted, 95) * 10) / 10,
    max: Math.round(sorted[sorted.length - 1] * 10) / 10,
  };
};

async function main() {
  const { MongoMemoryServer } = require(path.join(
    BACKEND, 'node_modules', 'mongodb-memory-server'
  ));
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  const heapBefore = process.memoryUsage().heapUsed;
  const wallStarted = Date.now();

  const mongoose = require(path.join(BACKEND, 'node_modules', 'mongoose'));
  const { app, server: httpServer } = requireBackend('server');
  server = httpServer;
  await new Promise((resolve) => server.listen(0, resolve));
  // Trailing slash REQUIRED: relative URL resolution against the base
  // replaces the last path segment without it (the /api prefix vanished).
  baseURL = `http://127.0.0.1:${server.address().port}/api/`;
  log(`backend up on ${server.address().port}; guests=${GUESTS} rounds=${ROUNDS}`);

  const Guest = requireBackend('models/Guest');
  const Subject = requireBackend('models/Subject');
  const QuestionBank = requireBackend('models/QuestionBank');
  const Quiz = requireBackend('models/Quiz');
  const ProctoringConsent = requireBackend('models/ProctoringConsent');
  const ProctoringSession = requireBackend('models/ProctoringSession');
  const ProctoringEvent = requireBackend('models/ProctoringEvent');
  const GuestAttempt = requireBackend('models/GuestAttempt');
  const { setProctoringEnabled } = requireBackend('utils/appSettings');
  const { buildEffectiveProctoringPolicy } = requireBackend('utils/proctoring/policySnapshot');
  const { issuePrecheckToken } = requireBackend('utils/proctoring/precheckToken');
  const { signGuestToken } = requireBackend('middleware/guestAuth');

  // ---- Seed: one armed public quiz ----
  await setProctoringEnabled(true);
  const subject = await Subject.create({ name: 'Load Pathology', year: '1st', displayOrder: 1 });
  const questions = [];
  for (let i = 0; i < 5; i += 1) {
    questions.push(await QuestionBank.create({
      subject: subject._id,
      topicName: 'Genetics',
      subtopicName: 'Load',
      system: 'Load Test',
      questionType: 'mcq_single',
      difficulty: 'medium',
      question: `Load Q${Date.now()}-${i}?`,
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 1,
    }));
  }
  const shareToken = `load-${Date.now()}`;
  const User = requireBackend('models/User');
  const adminUser = await User.create({
    name: 'Load Admin',
    email: `load-admin-${Date.now()}@example.com`,
    password: 'password123',
    role: 'admin',
  });
  const quiz = await Quiz.create({
    title: `Proctoring Load Test ${new Date().toISOString()}`,
    subject: subject._id,
    testType: 'daily',
    duration: 30,
    createdBy: adminUser._id,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    isPublic: true,
    shareToken,
    proctoring: {
      enabled: true,
      camera: 'required',
      focusEvents: { mode: 'warn-only' },
      multipleFaces: { mode: 'record' },
      facePresence: { mode: 'record' },
      attention: { mode: 'warn' },
    },
  });
  const effective = buildEffectiveProctoringPolicy(quiz);
  log('armed quiz', quiz.title, 'policy hash', effective.hash.slice(0, 12));

  // ---- Simulated guest factory ----
  let guestCounter = 0;
  const makeGuest = async () => {
    guestCounter += 1;
    // Guests via the MODEL (never raw insertOne — the public-flow lesson).
    const guest = await Guest.create({
      name: `Load Guest ${guestCounter}`,
      email: `load-${Date.now()}-${guestCounter}@example.com`,
      phone: '+919876543210',
      emailVerifiedAt: new Date(),
      marketingConsent: { granted: false },
      source: 'web',
    });
    // Consent is seeded directly (the OTP+precheck HTTP flow is covered by
    // the integration suite; this harness isolates the START/EVENTS/SUBMIT
    // surfaces under load). The precheck token is REALLY issued so /start's
    // gate verifies a genuine signed attestation.
    await ProctoringConsent.findOneAndUpdate(
      { quiz: quiz._id, guest: guest._id, policyVersion: effective.version },
      {
        $set: {
          quiz: quiz._id,
          guest: guest._id,
          policyVersion: effective.version,
          policyHash: effective.hash,
          consentTextVersion: 'load-harness',
          grantedAt: new Date(),
        },
      },
      { upsert: true }
    );
    const { token: precheckToken } = issuePrecheckToken({
      ownerId: guest._id,
      ownerKind: 'guest',
      quizId: quiz._id,
      policyHash: effective.hash,
      policyVersion: effective.version,
      summary: { deviceClass: 'web:120', cameraBypassed: false, checks: [] },
    });
    return {
      guest,
      guestToken: signGuestToken(guest._id),
      deviceKey: `load-device-${guestCounter}`,
      precheckToken,
      sessionId: null,
      attemptId: null,
      seq: 0,
      keyCounter: 0,
    };
  };

  const startLat = [];
  const eventLat = [];
  const submitLat = [];
  const failures = [];

  const startGuest = async (g) => {
    const res = await api('POST', `/public/quiz/${shareToken}/start`, {
      token: g.guestToken,
      body: { guestId: g.deviceKey, deviceInfo: 'load-harness', precheckToken: g.precheckToken },
    });
    startLat.push(res.latencyMs);
    if (res.status !== 201 || !res.body.proctoringSessionId) {
      failures.push(`start ${res.status}: ${JSON.stringify(res.body).slice(0, 160)}`);
      return false;
    }
    g.sessionId = res.body.proctoringSessionId;
    g.attemptId = res.body.attempt._id;
    return true;
  };

  // One event batch: SESSION_STARTED first, then a realistic episode mix
  // with a piggybacked heartbeat (the production envelope shape).
  const sendRound = async (g, round) => {
    g.keyCounter += 1;
    const events = [];
    const pushEvent = (type, source, durationMs, confidence) => {
      g.seq += 1;
      events.push({
        idempotencyKey: `load-${g.guest._id}-${g.keyCounter}-${events.length}`,
        clientSeq: g.seq,
        type,
        source,
        openedAt: Date.now() - durationMs,
        closedAt: Date.now(),
        ...(confidence !== undefined ? { confidence } : {}),
      });
    };
    if (round === 0) {
      pushEvent('SESSION_STARTED', 'system', 0);
    }
    pushEvent('TAB_HIDDEN', 'browser', 3200);
    pushEvent('APP_BACKGROUND', 'os', 5100);
    pushEvent('FACE_PARTIALLY_VISIBLE', 'cv', 9000, 0.81);
    pushEvent('HEAD_POSE_TURNED', 'cv', 2600, 0.74);
    const res = await api(
      'POST',
      `/public/quiz/${shareToken}/attempt/${g.attemptId}/proctoring/events`,
      {
        token: g.guestToken,
        body: {
          guestId: g.deviceKey,
          sessionId: String(g.sessionId),
          seq: events[events.length - 1].clientSeq,
          heartbeat: true,
          bufferOverflow: 0,
          events,
        },
      }
    );
    eventLat.push(res.latencyMs);
    if (res.status !== 200) {
      failures.push(`events r${round} ${res.status}: ${JSON.stringify(res.body).slice(0, 160)}`);
      return false;
    }
    // Warnings are expected under warn-only focus once the ladder climbs.
    return true;
  };

  const submitGuest = async (g) => {
    const res = await api('POST', `/public/quiz/${shareToken}/submit`, {
      token: g.guestToken,
      body: {
        guestId: g.deviceKey,
        attemptId: g.attemptId,
        answers: questions.map((q, i) => ({
          questionIndex: i,
          questionId: String(q._id),
          selectedAnswer: i % 4, // a deterministic answer mix
          markedForReview: false,
          timeSpent: 12,
        })),
        tabSwitchCount: ROUNDS,
        tabSwitchLog: [],
        isAutoSubmit: false,
      },
    });
    submitLat.push(res.latencyMs);
    if (res.status !== 200) {
      failures.push(`submit ${res.status}: ${JSON.stringify(res.body).slice(0, 160)}`);
      return false;
    }
    return true;
  };

  // ---- Drive: all guests concurrent, rounds interleaved per guest ----
  log(`driving ${GUESTS} guests x ${ROUNDS} event rounds (concurrent)...`);
  const guestList = [];
  for (let i = 0; i < GUESTS; i += 1) guestList.push(await makeGuest());

  const started = await Promise.all(guestList.map(startGuest));
  if (failures.length > 0) throw new Error(failures[0]);

  const roundResults = await Promise.all(
    guestList.map(async (g, idx) => {
      for (let r = 0; r < ROUNDS; r += 1) {
        // Stagger starts slightly so batches interleave like real traffic.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, (idx % 5) * 3));
        // eslint-disable-next-line no-await-in-loop
        const ok = await sendRound(g, r);
        if (!ok) return false;
      }
      return true;
    })
  );
  if (failures.length > 0) throw new Error(failures[0]);
  if (roundResults.some((ok) => !ok)) throw new Error('a guest failed mid-rounds');

  const submitted = await Promise.all(guestList.map(submitGuest));
  if (failures.length > 0) throw new Error(failures[0]);
  if (submitted.some((ok) => !ok)) throw new Error('a guest failed to submit');

  const wallMs = Date.now() - wallStarted;
  const heapDeltaMb = Math.round(((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024) * 10) / 10;

  // ---- Integrity accounting (no duplicates, everything closed + graded) ----
  const sessions = await ProctoringSession.find({ quiz: quiz._id });
  const closed = sessions.filter((s) => s.status === 'CLOSED').length;
  const eventDocs = await ProctoringEvent.countDocuments({ quiz: quiz._id });
  const expectedEvents = GUESTS * (ROUNDS * 4 + 1); // per round: 4; round0 +SESSION_STARTED
  const attemptsFinal = await GuestAttempt.countDocuments({ quiz: quiz._id, status: 'completed' });
  const dupKeys = await ProctoringEvent.aggregate([
    { $group: { _id: '$idempotencyKey', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: 'dups' },
  ]);

  log('---- integrity ----');
  log(`sessions: ${sessions.length} (closed ${closed}) | attempts completed: ${attemptsFinal}/${GUESTS}`);
  log(`events stored: ${eventDocs} (expected ~${expectedEvents} client events + server warnings)`);
  log(`duplicate idempotency keys: ${dupKeys[0]?.dups ?? 0}`);

  if (sessions.length !== GUESTS || closed !== GUESTS) throw new Error('session count/close mismatch');
  if (attemptsFinal !== GUESTS) throw new Error('not all attempts completed');
  if (eventDocs < expectedEvents) throw new Error(`missing events: ${eventDocs} < ${expectedEvents}`);
  if ((dupKeys[0]?.dups ?? 0) !== 0) throw new Error('duplicate idempotency keys stored');

  log('---- latency (ms) ----');
  log(`start : ${JSON.stringify(stats(startLat))}`);
  log(`events: ${JSON.stringify(stats(eventLat))}`);
  log(`submit: ${JSON.stringify(stats(submitLat))}`);
  const totalRequests = startLat.length + eventLat.length + submitLat.length;
  log(`total requests: ${totalRequests} | wall: ${(wallMs / 1000).toFixed(1)}s | rps: ${(totalRequests / (wallMs / 1000)).toFixed(1)} | heap delta: ${heapDeltaMb} MB`);

  console.log('\nPUBLIC-PROCTORING LOAD RUN PASSED');
  process.exit(0);
}

main().catch(async (error) => {
  console.error('\nLOAD RUN FAILED:', error);
  process.exit(1);
});
