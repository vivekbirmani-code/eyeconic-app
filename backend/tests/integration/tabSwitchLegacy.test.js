// Integration tests for the Phase 4 legacy tab-switch hardening (plan §27.5,
// §24.5, §29.2): the route keeps working for old builds but gains the status
// filter, rate limit, lazy §7.5 duration sync, and dual-writes TAB_HIDDEN
// integrity events for proctored attempts (parity: counter and events agree —
// Phase 4 AC 6). Non-proctored attempts keep the counter as their only
// channel, byte-identical to the previous behavior.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

let mockAiProctoringFlag = false;
jest.mock('../../config/featureAvailability', () => {
  const actual = jest.requireActual('../../config/featureAvailability');
  return {
    ...actual,
    isFeatureEnabled: (feature) =>
      feature === 'aiProctoring' ? mockAiProctoringFlag : actual.isFeatureEnabled(feature),
  };
});

const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuizAttempt = require('../../models/QuizAttempt');
const QuestionBank = require('../../models/QuestionBank');
const ProctoringSession = require('../../models/ProctoringSession');
const ProctoringEvent = require('../../models/ProctoringEvent');
const { setProctoringEnabled } = require('../../utils/appSettings');
const {
  resetPrecheckRateLimits,
  resetProctoringEventRateLimits,
  resetTabSwitchRateLimits,
} = require('../../middleware/proctoringRateLimit');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

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

const seedQuiz = async ({ proctored }) => {
  const admin = await createUser({ role: 'admin' });
  const student = await createUser({ role: 'student' });
  const subject = await createSubject('Pathology');
  const questions = [];
  for (let i = 0; i < 2; i++) {
    questions.push(await QuestionBank.create({
      subject: subject._id,
      topicName: 'Genetics',
      subtopicName: 'Mendelian Inheritance',
      system: 'Genetic Disorders',
      questionType: 'mcq_single',
      difficulty: 'medium',
      question: `Question ${i}`,
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 1,
    }));
  }
  const quiz = await Quiz.create({
    title: `TabSwitch Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    subject: subject._id,
    testType: 'daily',
    duration: 20,
    questions: questions.map((q) => q._id),
    assignedStudents: [student.user._id],
    createdBy: admin.user._id,
    ...(proctored ? { proctoring: { enabled: true } } : {}),
  });
  return { quiz, student };
};

const startAttempt = async (quiz, student, { proctored } = {}) => {
  let precheckToken;
  if (proctored) {
    const report = await request(app)
      .post(`/api/quizzes/${quiz._id}/proctoring/precheck-report`)
      .set('Authorization', `Bearer ${student.token}`)
      .send(passReport());
    const consent = await request(app)
      .post(`/api/quizzes/${quiz._id}/proctoring/consent`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ precheckToken: report.body.precheckToken, consentTextVersion: '2026-09-v1', surface: 'app-android' });
    expect(consent.status).toBe(200);
    precheckToken = report.body.precheckToken;
  }
  const start = await request(app)
    .post(`/api/quizzes/${quiz._id}/start`)
    .set('Authorization', `Bearer ${student.token}`)
    .send(precheckToken ? { precheckToken } : {});
  expect(start.status).toBe(201);
  return start.body;
};

const postTabSwitch = (quiz, student, attemptId) =>
  request(app)
    .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/tab-switch`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({});

describe('Legacy tab-switch route (Phase 4 hardening, §27.5)', () => {
  beforeEach(async () => {
    await db.clearDatabase();
    resetPrecheckRateLimits();
    resetProctoringEventRateLimits();
    resetTabSwitchRateLimits();
    mockAiProctoringFlag = true;
    await setProctoringEnabled(true, (await createUser({ role: 'admin' })).user._id);
  });

  it('non-proctored: counter-only, byte-identical legacy behavior, zero events (parity)', async () => {
    const { quiz, student } = await seedQuiz({ proctored: false });
    const started = await startAttempt(quiz, student);

    const first = await postTabSwitch(quiz, student, started.attemptId);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ message: 'Tab switch logged', count: 1 });
    const second = await postTabSwitch(quiz, student, started.attemptId);
    expect(second.body.count).toBe(2);

    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.tabSwitchCount).toBe(2);
    expect(attempt.tabSwitchLog).toHaveLength(2);
    // No session, no events — the analytics counter remains the only channel.
    expect(attempt.proctoringSnapshot).toBeUndefined();
    expect(await ProctoringEvent.countDocuments({})).toBe(0);
  });

  it('proctored: counter AND TAB_HIDDEN events agree during dual-write (AC 6)', async () => {
    const { quiz, student } = await seedQuiz({ proctored: true });
    const started = await startAttempt(quiz, student, { proctored: true });

    for (let i = 1; i <= 3; i++) {
      const res = await postTabSwitch(quiz, student, started.attemptId);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(i);
    }

    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.tabSwitchCount).toBe(3);

    const events = await ProctoringEvent.find({ attempt: started.attemptId, type: 'TAB_HIDDEN' }).sort({ openedAt: 1 });
    expect(events).toHaveLength(3); // parity: N posts → N events
    for (const event of events) {
      expect(event).toMatchObject({
        category: 'integrity',
        source: 'browser',
        severity: 'minor',
        durationMs: 0, // legacy route has no duration signal — honest point events
      });
      expect(event.metadata).toMatchObject({ legacy: true });
    }
    const session = await ProctoringSession.findOne({ attempt: started.attemptId });
    expect(session.eventCounts.TAB_HIDDEN).toBe(3);
  });

  it('rejects tab switches on completed attempts (the missing status filter)', async () => {
    const { quiz, student } = await seedQuiz({ proctored: false });
    const started = await startAttempt(quiz, student);

    const submit = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${started.attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect([200, 201]).toContain(submit.status);

    const res = await postTabSwitch(quiz, student, started.attemptId);
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('INVALID_ATTEMPT_STATUS');

    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.tabSwitchCount).toBe(0); // no post-completion increments
  });

  it('finalizes a past-deadline attempt lazily before rejecting (§7.5 doctrine)', async () => {
    const { quiz, student } = await seedQuiz({ proctored: true });
    const started = await startAttempt(quiz, student, { proctored: true });

    // Age the stored server-side deadline past the network grace.
    await QuizAttempt.updateOne(
      { _id: started.attemptId },
      { $set: { durationDeadline: new Date(Date.now() - 2 * 60 * 1000) } }
    );

    const res = await postTabSwitch(quiz, student, started.attemptId);
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('INVALID_ATTEMPT_STATUS');

    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'duration' });
    expect(attempt.tabSwitchCount).toBe(0);
    // The session closed with the finalize; no dual-write happened.
    expect(await ProctoringEvent.countDocuments({ attempt: started.attemptId, type: 'TAB_HIDDEN' })).toBe(0);
    const session = await ProctoringSession.findOne({ attempt: started.attemptId });
    expect(session.status).toBe('CLOSED');
  });

  it('swallows a deterministic-key replay without failing the route', async () => {
    const { quiz, student } = await seedQuiz({ proctored: true });
    const started = await startAttempt(quiz, student, { proctored: true });
    const session = await ProctoringSession.findOne({ attempt: started.attemptId });

    // Pre-insert the exact record the NEXT post would generate (the route's
    // deterministic key): the duplicate insert must be swallowed, and the
    // legacy counter stays authoritative.
    await ProctoringEvent.create({
      session: session._id,
      attempt: started.attemptId,
      quiz: quiz._id,
      category: 'integrity',
      type: 'TAB_HIDDEN',
      source: 'browser',
      openedAt: new Date(),
      closedAt: new Date(),
      durationMs: 0,
      severity: 'minor',
      metadata: { legacy: true },
      idempotencyKey: `legacy-tab:${started.attemptId}:1`,
      serverAt: new Date(),
    });

    const res = await postTabSwitch(quiz, student, started.attemptId);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);

    const events = await ProctoringEvent.find({ attempt: started.attemptId, type: 'TAB_HIDDEN' });
    expect(events).toHaveLength(1); // the pre-inserted record — no duplicate
  });

  it('rate limits beyond the shared events bound (60/min, reused threshold)', async () => {
    const { quiz, student } = await seedQuiz({ proctored: false });
    const started = await startAttempt(quiz, student);

    let last;
    for (let i = 0; i < 61; i++) {
      last = await postTabSwitch(quiz, student, started.attemptId);
    }
    expect(last.status).toBe(429);
    expect(last.body.code).toBe('RATE_LIMITED');

    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.tabSwitchCount).toBe(60); // the 61st was refused pre-increment
  });

  it('still 404s unknown/foreign attempts (ownership unchanged)', async () => {
    const { quiz, student } = await seedQuiz({ proctored: false });
    const other = await createUser({ role: 'student', email: `other-${Date.now()}@t.dev` });
    const started = await startAttempt(quiz, student);

    const foreign = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${started.attemptId}/tab-switch`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({});
    expect(foreign.status).toBe(404);

    const missing = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/000000000000000000000000/tab-switch`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect(missing.status).toBe(404);
  });
});
