// Integration tests for Phase 4 session health + focus signals (plan §16,
// §7.4, §14, §29.2): heartbeat-gap episodes with DEGRADED→ACTIVE transitions
// at the frozen 30000/90000 policy, the startup grace, gap idempotency under
// concurrent batches, real APP_BACKGROUND/EXIT_ATTEMPTED ingest, deterrence
// stamping from SESSION_STARTED metadata, and the record-only guarantee (no
// warning, no auto-submit — gaps never act in Phase 4).

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

const request = require('supertest');
const db = require('../../helpers/db');
const { buildApp, createUser, createSubject } = require('../../helpers/testApp');
const Quiz = require('../../../models/Quiz');
const QuizAttempt = require('../../../models/QuizAttempt');
const QuestionBank = require('../../../models/QuestionBank');
const ProctoringSession = require('../../../models/ProctoringSession');
const ProctoringEvent = require('../../../models/ProctoringEvent');
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

const sessionEvent = (type, overrides = {}) => ({
  type,
  source: 'system',
  openedAt: Date.now() - 1000,
  closedAt: Date.now() - 1000,
  idempotencyKey: `${type.toLowerCase()}-${Math.random().toString(36).slice(2, 10)}`,
  clientSeq: 0,
  ...overrides,
});

describe('Proctoring heartbeat gaps + focus signals (Phase 4)', () => {
  let admin;
  let student;
  let quiz;
  let started;

  beforeEach(async () => {
    await db.clearDatabase();
    resetPrecheckRateLimits();
    resetProctoringEventRateLimits();
    mockAiProctoringFlag = true;
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
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
    quiz = await Quiz.create({
      title: `Heartbeat Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      subject: subject._id,
      testType: 'daily',
      duration: 20,
      questions: questions.map((q) => q._id),
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
      proctoring: { enabled: true },
    });
    await setProctoringEnabled(true, admin.user._id);

    const report = await request(app)
      .post(`/api/quizzes/${quiz._id}/proctoring/precheck-report`)
      .set('Authorization', `Bearer ${student.token}`)
      .send(passReport());
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
    started = { attemptId: start.body.attemptId, sessionId: start.body.proctoringSessionId };
  });

  const postEvents = (body) =>
    request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${started.attemptId}/proctoring/events`)
      .set('Authorization', `Bearer ${student.token}`)
      .send(body);

  const heartbeatOnly = () => ({
    sessionId: started.sessionId, heartbeat: true, bufferOverflow: 0, events: [],
  });

  it('records a HEARTBEAT_GAP episode + DEGRADED→ACTIVE transitions after the frozen timeout', async () => {
    // First contact establishes lastSeenAt + the set-once frozen parameters.
    const first = await postEvents({
      ...heartbeatOnly(),
      events: [sessionEvent('SESSION_STARTED', {
        metadata: { detectorTier: 'headpose', screenCapturePrevention: 'android-flagsecure' },
      })],
    });
    expect(first.status).toBe(200);

    const sessionAfterFirst = await ProctoringSession.findById(started.sessionId);
    expect(sessionAfterFirst.sessionHealth.heartbeatIntervalMs).toBe(30000);
    expect(sessionAfterFirst.sessionHealth.timeoutMs).toBe(90000);
    expect(sessionAfterFirst.sessionHealth.lastSeenAt).toBeTruthy();
    expect(sessionAfterFirst.deterrence.screenCapturePrevention).toBe('android-flagsecure');

    // Simulate a 5-minute outage (client killed / network gone): age
    // lastSeenAt past the 90 s frozen timeout, then contact again.
    const stale = new Date(Date.now() - 5 * 60 * 1000);
    await ProctoringSession.updateOne(
      { _id: started.sessionId },
      { $set: { 'sessionHealth.lastSeenAt': stale } }
    );

    const res = await postEvents(heartbeatOnly());
    expect(res.status).toBe(200);

    const gapEvents = await ProctoringEvent.find({ session: started.sessionId, type: 'HEARTBEAT_GAP' });
    expect(gapEvents).toHaveLength(1);
    expect(gapEvents[0].category).toBe('technical');
    expect(gapEvents[0].source).toBe('system');
    expect(gapEvents[0].severity).toBe('minor');
    expect(gapEvents[0].durationMs).toBeGreaterThanOrEqual(5 * 60 * 1000);
    expect(gapEvents[0].metadata.timeoutMs).toBe(90000);
    expect(gapEvents[0].openedAt.getTime()).toBe(stale.getTime());
    expect(gapEvents[0].serverAt.getTime()).toBeGreaterThanOrEqual(gapEvents[0].closedAt.getTime());

    const session = await ProctoringSession.findById(started.sessionId);
    // Net observable status recovers to ACTIVE (§16.2/§7.4 — lazy doctrine).
    expect(session.status).toBe('ACTIVE');
    const reasons = session.transitions.map((t) => `${t.from}->${t.to}:${t.reason}`);
    expect(reasons).toContain('ACTIVE->DEGRADED:heartbeat_timeout');
    expect(reasons).toContain('DEGRADED->ACTIVE:heartbeat_recovered');
    const degradedAt = session.transitions.find((t) => t.reason === 'heartbeat_timeout').at;
    expect(degradedAt.getTime()).toBe(stale.getTime() + 90000);
    expect(session.sessionHealth.missedIntervals).toBe(1);
    expect(session.integrity.heartbeatsMissed).toBe(1);
    expect(session.integrity.unmonitoredIntervals).toHaveLength(1);
    expect(session.integrity.unmonitoredIntervals[0].cause).toBe('heartbeat_gap');
    expect(session.eventCounts.HEARTBEAT_GAP).toBe(1);
    // Recovery: lastSeenAt moved forward past the stale value.
    expect(session.sessionHealth.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime());

    // RECORD-ONLY (§16.3, onProlongedOutage 'record'): the attempt is still
    // in_progress — a gap NEVER warns or auto-submits in Phase 4.
    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.status).toBe('in_progress');
    expect(attempt.autoSubmitReason).toBeUndefined();
  });

  it('produces no gap on a fresh session (startup grace) or within the timeout', async () => {
    // Fresh session, no batch yet: lastSeenAt is null — nothing to measure.
    const first = await postEvents(heartbeatOnly());
    expect(first.status).toBe(200);
    let gaps = await ProctoringEvent.find({ session: started.sessionId, type: 'HEARTBEAT_GAP' });
    expect(gaps).toHaveLength(0);

    // Second contact well within 90 s: a temporary transport gap is NOT
    // session degradation.
    const second = await postEvents(heartbeatOnly());
    expect(second.status).toBe(200);
    gaps = await ProctoringEvent.find({ session: started.sessionId, type: 'HEARTBEAT_GAP' });
    expect(gaps).toHaveLength(0);
    const session = await ProctoringSession.findById(started.sessionId);
    expect(session.transitions).toHaveLength(1); // creation only
    expect(session.status).toBe('ACTIVE');
  });

  it('records exactly one gap when concurrent batches measure the same outage', async () => {
    const first = await postEvents(heartbeatOnly());
    expect(first.status).toBe(200);
    const stale = new Date(Date.now() - 3 * 60 * 1000);
    await ProctoringSession.updateOne(
      { _id: started.sessionId },
      { $set: { 'sessionHealth.lastSeenAt': stale } }
    );

    const [a, b] = await Promise.all([postEvents(heartbeatOnly()), postEvents(heartbeatOnly())]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const gaps = await ProctoringEvent.find({ session: started.sessionId, type: 'HEARTBEAT_GAP' });
    expect(gaps).toHaveLength(1); // deterministic idempotency key converged

    const session = await ProctoringSession.findById(started.sessionId);
    const degraded = session.transitions.filter((t) => t.reason === 'heartbeat_timeout');
    const recovered = session.transitions.filter((t) => t.reason === 'heartbeat_recovered');
    expect(degraded).toHaveLength(1); // only the insert winner wrote transitions
    expect(recovered).toHaveLength(1);
    expect(session.sessionHealth.missedIntervals).toBe(1);
  });

  it('ingests real APP_BACKGROUND and EXIT_ATTEMPTED episodes (integrity, deterministic)', async () => {
    const openedAt = Date.now() - 30_000;
    const res = await postEvents({
      sessionId: started.sessionId,
      seq: 1,
      heartbeat: true,
      bufferOverflow: 0,
      events: [
        {
          type: 'APP_BACKGROUND', source: 'os',
          openedAt, closedAt: openedAt + 14_000,
          idempotencyKey: 'bg-1', clientSeq: 0,
        },
        {
          type: 'EXIT_ATTEMPTED', source: 'os',
          openedAt: openedAt + 60_000, closedAt: openedAt + 60_000,
          idempotencyKey: 'exit-1', clientSeq: 1,
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(2);

    const stored = await ProctoringEvent.find({ session: started.sessionId, type: { $in: ['APP_BACKGROUND', 'EXIT_ATTEMPTED'] } });
    expect(stored).toHaveLength(2);
    const background = stored.find((e) => e.type === 'APP_BACKGROUND');
    expect(background).toMatchObject({
      category: 'integrity', source: 'os', severity: 'moderate', durationMs: 14_000,
    });
    const exit = stored.find((e) => e.type === 'EXIT_ATTEMPTED');
    expect(exit).toMatchObject({
      category: 'integrity', source: 'os', severity: 'info', durationMs: 0,
    });

    // Phase 4 records only — no violation was created and the attempt continues.
    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.status).toBe('in_progress');
  });

  it('rejects an APP_BACKGROUND with an unregistered source', async () => {
    const at = Date.now() - 1000;
    const res = await postEvents({
      sessionId: started.sessionId,
      heartbeat: true,
      bufferOverflow: 0,
      events: [{
        type: 'APP_BACKGROUND', source: 'cv', // registry: os only
        openedAt: at, closedAt: at,
        idempotencyKey: 'bg-bad', clientSeq: 0,
      }],
    });
    expect(res.status).toBe(400);
    expect(res.body.errors.join()).toMatch(/not valid for type APP_BACKGROUND/);
  });

  it('stamps deterrence set-once and ignores later/foreign values', async () => {
    const at = Date.now() - 1000;
    // A second SESSION_RESUMED carrying a different value must NOT overwrite.
    const res = await postEvents({
      sessionId: started.sessionId,
      heartbeat: true,
      bufferOverflow: 0,
      events: [
        sessionEvent('SESSION_RESUMED', { metadata: { screenCapturePrevention: 'android-flagsecure' } }),
        sessionEvent('SESSION_STARTED', { metadata: { screenCapturePrevention: 'ios-detect-only' } }),
      ],
    });
    expect(res.status).toBe(200);
    let session = await ProctoringSession.findById(started.sessionId);
    expect(session.deterrence.screenCapturePrevention).toBe('android-flagsecure');

    // A value outside the enum is ignored entirely.
    await postEvents({
      sessionId: started.sessionId,
      heartbeat: true,
      bufferOverflow: 0,
      events: [sessionEvent('SESSION_RESUMED', { metadata: { screenCapturePrevention: 'made-up' } })],
    });
    session = await ProctoringSession.findById(started.sessionId);
    expect(session.deterrence.screenCapturePrevention).toBe('android-flagsecure');

    // Non-session events never stamp deterrence.
    await postEvents({
      sessionId: started.sessionId,
      heartbeat: true,
      bufferOverflow: 0,
      events: [{
        type: 'EXIT_ATTEMPTED', source: 'os',
        openedAt: at, closedAt: at, idempotencyKey: 'exit-x', clientSeq: 0,
        metadata: { screenCapturePrevention: 'unsupported' },
      }],
    });
    session = await ProctoringSession.findById(started.sessionId);
    expect(session.deterrence.screenCapturePrevention).toBe('android-flagsecure');
  });

  it('records no gap after the attempt is finalized (409 path, post-close telemetry only)', async () => {
    const first = await postEvents(heartbeatOnly());
    expect(first.status).toBe(200);

    const submit = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${started.attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect([200, 201]).toContain(submit.status);

    const res = await postEvents(heartbeatOnly());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SESSION_NOT_ACTIVE');

    const gaps = await ProctoringEvent.find({ session: started.sessionId, type: 'HEARTBEAT_GAP' });
    expect(gaps).toHaveLength(0);
    const session = await ProctoringSession.findById(started.sessionId);
    expect(session.status).toBe('CLOSED');
  });
});
