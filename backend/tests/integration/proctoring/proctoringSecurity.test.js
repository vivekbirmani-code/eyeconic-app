// §29.7 security suite (Phase 8 WS-B) — the six coverage gaps exploration
// found: guest token-kind confusion on proctoring surfaces, kill-switch
// semantics (§31 rollback safety), deliberate clientSeq-gap floods, rate-
// limiter isolation + window recovery, same-student cross-attempt writes,
// and plausible timestamp back-dating. One suite: the cases share the
// flag-mock / guest-mint / seeding machinery (~100 lines each if spread out).
//
// Already-covered §29.7 rows live elsewhere and are NOT duplicated here:
// forged/cross-student events, riskScore tampering, implausible timestamps,
// deadline bypass, precheck-token replay, mentor D14 scoping (see
// proctoringEvents / proctoringAttention / quizDuration suites).

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

let mockAiProctoringFlag = false;
jest.mock('../../../config/featureAvailability', () => {
  const actual = jest.requireActual('../../../config/featureAvailability');
  return {
    ...actual,
    isFeatureEnabled: (feature) =>
      feature === 'aiProctoring' ? mockAiProctoringFlag : actual.isFeatureEnabled(feature),
  };
});

const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('../../helpers/db');
const { buildApp, createUser, createSubject } = require('../../helpers/testApp');
const Quiz = require('../../../models/Quiz');
const QuestionBank = require('../../../models/QuestionBank');
const ProctoringSession = require('../../../models/ProctoringSession');
const ProctoringEvent = require('../../../models/ProctoringEvent');
const ProctoringViolation = require('../../../models/ProctoringViolation');
const { setProctoringEnabled } = require('../../../utils/appSettings');
const {
  resetPrecheckRateLimits,
  resetProctoringEventRateLimits,
} = require('../../../middleware/proctoringRateLimit');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

// ---- shared seeding (shapes copied from proctoringEvents.test.js) ----

const passReport = () => ({
  device: { platform: 'android', osVersion: 33 },
  network: { reachable: true, authedPingMs: 120 },
  checks: [
    { id: 'device_capability', status: 'PASS' },
    { id: 'camera_permission', status: 'PASS' },
    { id: 'camera_availability', status: 'PASS' },
    {
      id: 'face_readiness', status: 'PASS',
      metadata: { frames: 5, agreedFrames: 4, faceCountClass: 'one', visibility: 'ok' },
    },
    { id: 'network', status: 'PASS' },
  ],
});

// Inert transport episode: below every policy floor so only TRANSPORT is
// under test.
const episode = (overrides = {}) => ({
  type: 'FACE_NOT_DETECTED',
  source: 'cv',
  openedAt: Date.now() - 57_000,
  closedAt: Date.now() - 50_000,
  confidence: 0.91,
  idempotencyKey: `key-${Math.random().toString(36).slice(2, 12)}`,
  clientSeq: 0,
  metadata: { basis: 'detection_health', faceCountPeak: 1 },
  ...overrides,
});

// Attention-family event (D6: record-only — "no decision impact" is
// structural, which is why the flood case uses these types).
const attentionEvent = (i, overrides = {}) => ({
  type: 'HEAD_POSE_EXTREME',
  source: 'cv',
  openedAt: Date.now() - 60_000,
  closedAt: Date.now() - 58_000,
  confidence: 0.9,
  idempotencyKey: `att-sec-${i}-${Math.random().toString(36).slice(2, 10)}`,
  clientSeq: i,
  metadata: { basis: 'head_pose', calibration: 'captured' },
  ...overrides,
});

const makeProctoredQuiz = async (adminId, studentIds) => {
  const subject = await createSubject('Security');
  const questions = [];
  for (let i = 0; i < 2; i += 1) {
    questions.push(await QuestionBank.create({
      subject: subject._id,
      topicName: 'Toppic',
      subtopicName: 'Sub',
      system: 'Systems',
      questionType: 'mcq_single',
      difficulty: 'medium',
      question: `Sec Q ${i} ${Math.random().toString(36).slice(2, 6)}`,
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 1,
    }));
  }
  return Quiz.create({
    title: `Sec Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    subject: subject._id,
    testType: 'daily',
    duration: 20,
    questions: questions.map((q) => q._id),
    assignedStudents: studentIds,
    createdBy: adminId,
    proctoring: { enabled: true },
  });
};

const startProctoredAttempt = async (student, quiz) => {
  const report = await request(app)
    .post(`/api/quizzes/${quiz._id}/proctoring/precheck-report`)
    .set('Authorization', `Bearer ${student.token}`)
    .send(passReport());
  expect(report.status).toBe(200);
  const consent = await request(app)
    .post(`/api/quizzes/${quiz._id}/proctoring/consent`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ precheckToken: report.body.precheckToken, consentTextVersion: '2026-09-v1', surface: 'app-android' });
  expect(consent.status).toBe(200);
  const start = await request(app)
    .post(`/api/quizzes/${quiz._id}/start`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ precheckToken: report.body.precheckToken });
  expect(start.status).toBe(201);
  return { attemptId: start.body.attemptId, sessionId: start.body.proctoringSessionId };
};

const postEvents = (user, quizId, attemptId, body) =>
  request(app)
    .post(`/api/quizzes/${quizId}/attempt/${attemptId}/proctoring/events`)
    .set('Authorization', `Bearer ${user.token}`)
    .send(body);

const submitAttempt = (quiz, student, attemptId) =>
  request(app)
    .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ isAutoSubmit: false });

describe('§29.7 security suite (Phase 8 WS-B)', () => {
  let admin;
  let student;

  beforeEach(async () => {
    await db.clearDatabase();
    resetPrecheckRateLimits();
    resetProctoringEventRateLimits();
    mockAiProctoringFlag = true;
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    await setProctoringEnabled(true, admin.user._id);
  });

  // ---- (a) guest token-kind confusion ----
  it('rejects guest session tokens on every proctoring surface (401)', async () => {
    // Seed one proctored attempt first so 401-vs-404 ordering is unambiguous:
    // auth middleware runs before any lookup, everywhere.
    const quiz = await makeProctoredQuiz(admin.user._id, [student.user._id]);
    const started = await startProctoredAttempt(student, quiz);

    const guestToken = jwt.sign({ kind: 'guest', guestId: 'g-sec' }, process.env.JWT_SECRET);
    const asGuest = (method, url, body) =>
      request(app)[method](url)
        .set('Authorization', `Bearer ${guestToken}`)
        .send(body || {});

    const surfaces = [
      ['post', `/api/quizzes/${quiz._id}/proctoring/precheck-report`, passReport()],
      ['post', `/api/quizzes/${quiz._id}/proctoring/consent`, {}],
      ['post', `/api/quizzes/${quiz._id}/attempt/${started.attemptId}/proctoring/events`, {}],
      ['get', `/api/quizzes/attempt/${started.attemptId}/proctoring/session`],
      ['get', `/api/quizzes/attempt/${started.attemptId}/proctoring/timeline`],
      ['post', `/api/quizzes/attempt/${started.attemptId}/proctoring/review`, { decision: 'dismiss' }],
      ['get', '/api/quizzes/proctoring-overrides'],
      ['post', '/api/quizzes/proctoring-overrides', { studentId: student.user._id, reasonCode: 'attention_disabled' }],
      ['get', '/api/quizzes/proctoring-metrics/digest'],
    ];
    for (const [method, url, body] of surfaces) {
      const res = await asGuest(method, url, body);
      expect({ method, url: url.replace(/([0-9a-f]{16})[0-9a-f]{8}/gi, '$1…'), status: res.status })
        .toEqual({ method, url: url.replace(/([0-9a-f]{16})[0-9a-f]{8}/gi, '$1…'), status: 401 });
    }
  });

  // ---- (b) kill-switch semantics (§31 rollback safety) ----
  it('kill switch closed mid-attempt: new-session surfaces 503, in-flight delivery and historical reads continue', async () => {
    const quiz = await makeProctoredQuiz(admin.user._id, [student.user._id]);
    const started = await startProctoredAttempt(student, quiz);

    // Gates close MID-attempt.
    await setProctoringEnabled(false, admin.user._id);
    const studentB = await createUser({ role: 'student' });
    await Quiz.updateOne({ _id: quiz._id }, { $push: { assignedStudents: studentB.user._id } });

    const precheckB = await request(app)
      .post(`/api/quizzes/${quiz._id}/proctoring/precheck-report`)
      .set('Authorization', `Bearer ${studentB.token}`)
      .send(passReport());
    expect(precheckB.status).toBe(503);
    expect(precheckB.body.code).toBe('PROCTORING_DISABLED');

    const consentB = await request(app)
      .post(`/api/quizzes/${quiz._id}/proctoring/consent`)
      .set('Authorization', `Bearer ${studentB.token}`)
      .send({ precheckToken: 'anything', consentTextVersion: '2026-09-v1' });
    expect(consentB.status).toBe(503);
    expect(consentB.body.code).toBe('PROCTORING_DISABLED');

    // In-flight session keeps delivering.
    const events = await postEvents(student, quiz._id, started.attemptId, {
      sessionId: started.sessionId, heartbeat: true,
      events: [episode()],
    });
    expect(events.status).toBe(200);
    expect(events.body.accepted).toBe(1);

    const sessionRead = await request(app)
      .get(`/api/quizzes/attempt/${started.attemptId}/proctoring/session`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(sessionRead.status).toBe(200);

    const timeline = await request(app)
      .get(`/api/quizzes/attempt/${started.attemptId}/proctoring/timeline`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(timeline.status).toBe(200);

    // Finalize still works, and the closed session stays reviewable +
    // readable in analytics (historical reads, §31).
    const submit = await submitAttempt(quiz, student, started.attemptId);
    expect(submit.status).toBeLessThan(500);

    const review = await request(app)
      .post(`/api/quizzes/attempt/${started.attemptId}/proctoring/review`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'dismiss' });
    expect(review.status).toBe(200);

    const analytics = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(analytics.status).toBe(200);
    expect(analytics.body.proctoring).toBeDefined();
    expect(analytics.body.proctoring.attempts).toHaveLength(1);
  });

  // ---- (c) deliberate clientSeq-gap flood ----
  it('a clientSeq-gap flood flags at the session cap, stores exactly what was sent, and moves no decision', async () => {
    const quiz = await makeProctoredQuiz(admin.user._id, [student.user._id]);
    const started = await startProctoredAttempt(student, quiz);

    const sessionBefore = await ProctoringSession.findById(started.sessionId);
    const riskBefore = sessionBefore.riskScore ?? 0;

    // 10 batches × 50 events. Envelope seq matches each batch's OWN last
    // clientSeq (the only enforced rule); the RANGES deliberately gap.
    let floodResponse = null;
    for (let batch = 0; batch < 10; batch += 1) {
      const base = batch === 0 ? 0 : (batch % 2 === 1 ? 1000 + batch * 100 : 5000 + batch * 100);
      const events = [];
      for (let j = 0; j < 50; j += 1) {
        events.push(attentionEvent(base + j, { clientSeq: base + j }));
      }
      floodResponse = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        seq: base + 49,
        heartbeat: true,
        bufferOverflow: 0,
        events,
      });
      expect(floodResponse.status).toBe(200);
    }

    // The batch that crossed 500 stored events reports the flood flag.
    expect(floodResponse.body.floodFlagged).toBe(true);

    const sessionAfter = await ProctoringSession.findById(started.sessionId);
    expect(sessionAfter.integrity.floodFlagged).toBe(true);
    // Bounded: gaps never inflate storage — exactly what was sent persists.
    expect(await ProctoringEvent.countDocuments({ session: sessionAfter._id })).toBe(500);
    // D6 makes "no decision impact" absolute for attention types.
    expect(await ProctoringViolation.countDocuments({ session: sessionAfter._id })).toBe(0);
    expect(floodResponse.body.actions).toBeUndefined();
    expect(floodResponse.body.attemptFinalized).toBeUndefined();
    expect(sessionAfter.riskScore).toBe(riskBefore);
    const attentionRow = (sessionAfter.riskBreakdown || [])
      .find((row) => row.input === 'attentionEvent');
    expect(attentionRow).toMatchObject({ events: 500, points: 0, contribution: 0 });
  });

  // ---- (d) rate-limiter isolation + window recovery ----
  describe('rate limiters', () => {
    let nowSpy;

    afterEach(() => {
      if (nowSpy) {
        nowSpy.mockRestore();
        nowSpy = null;
      }
    });

    it('events limit isolates students: A exhausted (429) while B continues (200), and window expiry recovers A', async () => {
      const studentB = await createUser({ role: 'student' });
      const quiz = await makeProctoredQuiz(admin.user._id, [student.user._id, studentB.user._id]);
      const startedA = await startProctoredAttempt(student, quiz);
      const startedB = await startProctoredAttempt(studentB, quiz);

      for (let i = 0; i < 60; i += 1) {
        const res = await postEvents(student, quiz._id, startedA.attemptId, {
          sessionId: startedA.sessionId, heartbeat: true, events: [episode()],
        });
        expect(res.status).toBe(200);
      }
      const sixtyFirst = await postEvents(student, quiz._id, startedA.attemptId, {
        sessionId: startedA.sessionId, heartbeat: true, events: [episode()],
      });
      expect(sixtyFirst.status).toBe(429);
      expect(sixtyFirst.body.code).toBe('RATE_LIMITED');

      // Isolation: the limiter keys on the student only — B is untouched.
      const bRes = await postEvents(studentB, quiz._id, startedB.attemptId, {
        sessionId: startedB.sessionId, heartbeat: true, events: [episode()],
      });
      expect(bRes.status).toBe(200);

      // Window expiry recovers A — prune-on-access, not just a reset hook.
      // (Spy installed AFTER exhaustion so A's entry carries a real
      // timestamp; the +61 s shift makes it prunable.)
      const realNow = Date.now();
      nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => realNow + 61_000);
      const recovered = await postEvents(student, quiz._id, startedA.attemptId, {
        sessionId: startedA.sessionId, heartbeat: true, events: [episode()],
      });
      expect(recovered.status).toBe(200);
    });

    it('precheck limit is keyed per student+quiz: one student exhaustion never blocks another', async () => {
      const studentB = await createUser({ role: 'student' });
      const quiz = await makeProctoredQuiz(admin.user._id, [student.user._id, studentB.user._id]);

      for (let i = 0; i < 10; i += 1) {
        const res = await request(app)
          .post(`/api/quizzes/${quiz._id}/proctoring/precheck-report`)
          .set('Authorization', `Bearer ${student.token}`)
          .send(passReport());
        expect(res.status).toBe(200);
      }
      const eleventh = await request(app)
        .post(`/api/quizzes/${quiz._id}/proctoring/precheck-report`)
        .set('Authorization', `Bearer ${student.token}`)
        .send(passReport());
      expect(eleventh.status).toBe(429);
      expect(eleventh.body.code).toBe('RATE_LIMITED');

      const bFirst = await request(app)
        .post(`/api/quizzes/${quiz._id}/proctoring/precheck-report`)
        .set('Authorization', `Bearer ${studentB.token}`)
        .send(passReport());
      expect(bFirst.status).toBe(200);
    });
  });

  // ---- (e) same-student cross-attempt writes ----
  it('events against an old, finalized attempt are rejected 409 and never cross-write the live session', async () => {
    // Retakes are refused on the same quiz — so two quizzes, one student.
    const quizA = await makeProctoredQuiz(admin.user._id, [student.user._id]);
    const quizB = await makeProctoredQuiz(admin.user._id, [student.user._id]);

    const startedA = await startProctoredAttempt(student, quizA);
    const submitA = await submitAttempt(quizA, student, startedA.attemptId);
    expect(submitA.status).toBeLessThan(500);
    const sessionA = await ProctoringSession.findOne({ attempt: startedA.attemptId });
    expect(sessionA.status).toBe('CLOSED');

    const startedB = await startProctoredAttempt(student, quizB);
    const eventsOnB = await ProctoringEvent.countDocuments({ session: startedB.sessionId });

    // Late batch aimed at the FINALIZED attempt's URL.
    const res = await postEvents(student, quizA._id, startedA.attemptId, {
      sessionId: startedA.sessionId, heartbeat: true, events: [episode()],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SESSION_NOT_ACTIVE');

    const sessionAAfter = await ProctoringSession.findOne({ attempt: startedA.attemptId });
    expect(sessionAAfter.integrity.batchesRejected).toBe(1);
    expect(await ProctoringEvent.countDocuments({ session: sessionAAfter._id }))
      .toBe(await ProctoringEvent.countDocuments({ session: sessionA._id }));

    // The live session B was never touched.
    expect(await ProctoringEvent.countDocuments({ session: startedB.sessionId })).toBe(eventsOnB);
    const sessionB = await ProctoringSession.findById(startedB.sessionId);
    expect(sessionB.status).toBe('ACTIVE');
    expect(sessionB.integrity.batchesRejected || 0).toBe(0);
    // (The 403 SESSION_MISMATCH echo case is already locked in
    // proctoringEvents.test.js — not duplicated.)
  });

  // ---- (f) plausible back-dating ----
  it('back-dated episode timestamps within the 24 h bound cannot reorder the timeline or amplify consequences', async () => {
    const quiz = await makeProctoredQuiz(admin.user._id, [student.user._id]);
    const started = await startProctoredAttempt(student, quiz);
    const session = await ProctoringSession.findById(started.sessionId);

    // The real client's first event (engine.ts emits SESSION_STARTED with the
    // deterrence label) — anchors the serverAt-ordered timeline.
    const anchor = await postEvents(student, quiz._id, started.attemptId, {
      sessionId: started.sessionId, heartbeat: true,
      events: [{
        type: 'SESSION_STARTED', source: 'system',
        openedAt: Date.now(), closedAt: Date.now(),
        idempotencyKey: `sec-anchor-${Math.random().toString(36).slice(2, 8)}`, clientSeq: 0,
        metadata: { screenCapturePrevention: 'android-flagsecure' },
      }],
    });
    expect(anchor.status).toBe(200);

    // ONE back-dated episode: opens 30 min BEFORE the session started, closes
    // now — inside the 24 h plausibility bound, duration ~30 min.
    const openedAt = new Date(session.startedAt.getTime() - 30 * 60 * 1000).toISOString();
    const closedAt = new Date().toISOString();
    const backdatedKey = `sec-back-${Math.random().toString(36).slice(2, 8)}`;
    const res = await postEvents(student, quiz._id, started.attemptId, {
      sessionId: started.sessionId, heartbeat: true,
      events: [{
        type: 'APP_BACKGROUND', source: 'os',
        openedAt, closedAt,
        idempotencyKey: backdatedKey, clientSeq: 1,
        metadata: { pattern: 'single' },
      }],
    });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);

    // No multiplication: exactly ONE focus violation + one WARN for the
    // single episode — a 30 min claimed duration is one episode, not thirty.
    const violations = await ProctoringViolation.find({ session: session._id });
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe('focus.loss');
    expect(res.body.actions).toHaveLength(1);
    expect(res.body.actions[0]).toMatchObject({ kind: 'WARN', code: 'warn.focus' });

    // Replay of the SAME idempotencyKey: duplicate no-op, still one violation.
    const replay = await postEvents(student, quiz._id, started.attemptId, {
      sessionId: started.sessionId, heartbeat: true,
      events: [{
        type: 'APP_BACKGROUND', source: 'os',
        openedAt, closedAt,
        idempotencyKey: backdatedKey, clientSeq: 1,
        metadata: { pattern: 'single' },
      }],
    });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicates).toEqual([backdatedKey]);
    expect(await ProctoringViolation.countDocuments({ session: session._id })).toBe(1);

    // serverAt is the ONLY ordering authority: the back-dated event sits at
    // its RECEIPT position, after the anchor.
    const timeline = await request(app)
      .get(`/api/quizzes/attempt/${started.attemptId}/proctoring/timeline`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(timeline.status).toBe(200);
    const types = timeline.body.timeline.events.map((e) => e.type);
    expect(types[0]).toBe('SESSION_STARTED');
    const backIndex = types.indexOf('APP_BACKGROUND');
    expect(backIndex).toBeGreaterThan(0);

    // The claimed duration is stored as claimed (review context) — the
    // honest record of what the client said, not a server belief.
    const stored = await ProctoringEvent.findOne({ session: session._id, type: 'APP_BACKGROUND' });
    expect(stored.openedAt.getTime()).toBe(new Date(openedAt).getTime());

    // Beyond the 24 h plausibility bound: rejected as malformed (400).
    const tooOld = await postEvents(student, quiz._id, started.attemptId, {
      sessionId: started.sessionId, heartbeat: true,
      events: [{
        type: 'APP_BACKGROUND', source: 'os',
        openedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        closedAt: new Date().toISOString(),
        idempotencyKey: `sec-old-${Math.random().toString(36).slice(2, 8)}`, clientSeq: 2,
        metadata: { pattern: 'single' },
      }],
    });
    expect(tooOld.status).toBe(400);
    expect(tooOld.body.code).toBe('VALIDATION_ERROR');
  });
});
