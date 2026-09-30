// Integration tests for the Phase 3 proctoring event transport (plan §27.2,
// §29.2): batched ingest, idempotency/dedup, out-of-order tolerance, server-
// owned field authority, ownership/mismatch rejection, session-state gating,
// lazy §7.5 duration enforcement, flood quarantine, rate limiting, and the
// session resync endpoint.

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
const MentorStudentAssignment = require('../../../models/MentorStudentAssignment');
const ProctoringSession = require('../../../models/ProctoringSession');
const ProctoringEvent = require('../../../models/ProctoringEvent');
const { setProctoringEnabled } = require('../../../utils/appSettings');
const {
  resetPrecheckRateLimits,
  resetProctoringEventRateLimits,
} = require('../../../middleware/proctoringRateLimit');
const { EVENT_FLOOD_SESSION_CAP } = require('../../../utils/proctoring/defaults');

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

const episode = (overrides = {}) => ({
  type: 'FACE_NOT_DETECTED',
  source: 'cv',
  openedAt: Date.now() - 60_000,
  closedAt: Date.now() - 50_000,
  confidence: 0.91,
  idempotencyKey: `key-${Math.random().toString(36).slice(2, 10)}`,
  clientSeq: 0,
  metadata: { basis: 'detection_health', faceCountPeak: 1 },
  ...overrides,
});

describe('Proctoring event transport (Phase 3)', () => {
  let admin;
  let student;
  let mentor;
  let quiz;
  let started; // {attemptId, sessionId}

  beforeEach(async () => {
    await db.clearDatabase();
    resetPrecheckRateLimits();
    resetProctoringEventRateLimits();
    mockAiProctoringFlag = true;
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    mentor = await createUser({ role: 'mentor' });
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
      title: `Proctoring Events Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      subject: subject._id,
      testType: 'daily',
      duration: 20,
      questions: questions.map((q) => q._id),
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
      proctoring: { enabled: true },
    });
    await setProctoringEnabled(true, admin.user._id);
  });

  const startProctoredAttempt = async () => {
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
    expect(start.body.proctoringSessionId).toBeDefined();
    expect(start.body.proctoringPolicy).toBeDefined();
    return { attemptId: start.body.attemptId, sessionId: start.body.proctoringSessionId };
  };

  const postEvents = (user, quizId, attemptId, body) =>
    request(app)
      .post(`/api/quizzes/${quizId}/attempt/${attemptId}/proctoring/events`)
      .set('Authorization', `Bearer ${user.token}`)
      .send(body);

  describe('happy-path ingest', () => {
    beforeEach(async () => {
      started = await startProctoredAttempt();
    });

    it('stores episodes with server-owned fields and updates session health + counts', async () => {
      const openedAt = Date.now() - 60_000;
      const res = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        seq: 1,
        heartbeat: true,
        bufferOverflow: 0,
        events: [
          {
            type: 'SESSION_STARTED', source: 'system',
            openedAt, closedAt: openedAt, idempotencyKey: 's-start', clientSeq: 0,
            metadata: { detectorTier: 'headpose' },
          },
          episode({ openedAt, closedAt: openedAt + 9000, clientSeq: 1, confidence: 0.91 }),
        ],
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, accepted: 2 });
      expect(res.body.serverNow).toBeDefined();
      expect(res.body.session.id).toBe(String(started.sessionId));

      const stored = await ProctoringEvent.find({ session: started.sessionId }).sort({ clientSeq: 1 });
      expect(stored).toHaveLength(2);

      expect(stored[0]).toMatchObject({
        type: 'SESSION_STARTED',
        category: 'technical',
        severity: 'info',
        durationMs: 0,
      });
      expect(stored[0].serverAt).toBeDefined();
      expect(stored[1]).toMatchObject({
        type: 'FACE_NOT_DETECTED',
        category: 'cv_observation',
        source: 'cv',
        detectorTier: 'headpose',
        confidence: 0.91,
        durationMs: 9000,
        severity: 'moderate',
      });

      const session = await ProctoringSession.findById(started.sessionId);
      expect(session.eventCounts).toEqual({ SESSION_STARTED: 1, FACE_NOT_DETECTED: 1 });
      expect(session.sessionHealth.lastSeenAt).toBeTruthy();
      // Heartbeat parameters come from the FROZEN policy snapshot defaults.
      expect(session.sessionHealth.heartbeatIntervalMs).toBe(30000);
      expect(session.sessionHealth.timeoutMs).toBe(90000);
      expect(session.integrity.floodFlagged).toBe(false);
    });

    it('uses the FROZEN policy for heartbeat parameters, not the live quiz config', async () => {
      // Admin tightens the live config AFTER the attempt started.
      await Quiz.updateOne(
        { _id: quiz._id },
        { $set: { 'proctoring.sessionHealth': { heartbeatIntervalMs: 45000, timeoutMs: 120000 } } }
      );
      const res = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events: [episode()],
      });
      expect(res.status).toBe(200);
      const session = await ProctoringSession.findById(started.sessionId);
      expect(session.sessionHealth.heartbeatIntervalMs).toBe(30000); // frozen default
      expect(session.sessionHealth.timeoutMs).toBe(90000);
    });

    it('accepts a heartbeat-only batch and updates lastSeenAt', async () => {
      const before = await ProctoringSession.findById(started.sessionId);
      await new Promise((resolve) => setTimeout(resolve, 15));
      const res = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events: [],
      });
      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(0);
      const after = await ProctoringSession.findById(started.sessionId);
      expect(new Date(after.sessionHealth.lastSeenAt).getTime())
        .toBeGreaterThan(new Date(before.sessionHealth.lastSeenAt || 0).getTime());
    });
  });

  describe('idempotency, duplicates and ordering (plan §7.3)', () => {
    beforeEach(async () => {
      started = await startProctoredAttempt();
    });

    it('replays a retried batch as duplicates — never re-counted', async () => {
      const body = {
        sessionId: started.sessionId,
        seq: 0,
        heartbeat: true,
        events: [episode({ idempotencyKey: 'fixed-key', clientSeq: 0 })],
      };
      const first = await postEvents(student, quiz._id, started.attemptId, body);
      expect(first.status).toBe(200);
      expect(first.body.accepted).toBe(1);

      const replay = await postEvents(student, quiz._id, started.attemptId, body);
      expect(replay.status).toBe(200);
      expect(replay.body.accepted).toBe(0);
      expect(replay.body.duplicates).toEqual(['fixed-key']);
      expect(await ProctoringEvent.countDocuments({ session: started.sessionId })).toBe(1);

      const session = await ProctoringSession.findById(started.sessionId);
      expect(session.eventCounts.FACE_NOT_DETECTED).toBe(1); // counted once
    });

    it('accepts out-of-order batches (late episode with earlier openedAt) and orders by serverAt', async () => {
      const late = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events: [episode({ idempotencyKey: 'late', clientSeq: 5, openedAt: Date.now() - 120_000 })],
      });
      expect(late.status).toBe(200);
      const early = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events: [episode({
          idempotencyKey: 'early',
          clientSeq: 2,
          openedAt: Date.now() - 30_000,
          closedAt: Date.now() - 25_000,
        })],
      });
      expect(early.status).toBe(200);

      const timeline = await ProctoringEvent.find({ session: started.sessionId }).sort({ serverAt: 1 });
      expect(timeline.map((e) => e.idempotencyKey)).toEqual(['late', 'early']);
    });

    it('flags (but accepts) a session past the flood cap', async () => {
      // Seed the session to just under the cap with existing events.
      const existing = Array.from({ length: EVENT_FLOOD_SESSION_CAP - 1 }, (_, i) => ({
        session: started.sessionId,
        attempt: started.attemptId,
        quiz: quiz._id,
        category: 'technical',
        type: 'SESSION_RESUMED',
        source: 'system',
        openedAt: new Date(),
        closedAt: new Date(),
        durationMs: 0,
        severity: 'info',
        idempotencyKey: `seed-${i}`,
        serverAt: new Date(),
      }));
      await ProctoringEvent.insertMany(existing);

      const res = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events: [episode()],
      });
      expect(res.status).toBe(200); // accepted-but-flagged, never dropped
      expect(res.body.floodFlagged).toBe(true);
      const session = await ProctoringSession.findById(started.sessionId);
      expect(session.integrity.floodFlagged).toBe(true);
    });
  });

  describe('server authority + validation (plan §24)', () => {
    beforeEach(async () => {
      started = await startProctoredAttempt();
    });

    it('strips forged server-owned fields (severity/riskScore/serverAt/review)', async () => {
      const res = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events: [episode({
          severity: 'major',
          riskScore: 0,
          serverAt: '2020-01-01T00:00:00Z',
          review: { status: 'dismissed' },
          violationsCount: 99,
        })],
      });
      expect(res.status).toBe(200);
      const stored = await ProctoringEvent.findOne({ session: started.sessionId });
      expect(stored.severity).toBe('moderate'); // server-assigned
      expect(stored.serverAt.getTime()).toBeGreaterThan(new Date('2025-01-01').getTime());
      expect(stored.review).toBeUndefined();
      expect(stored.riskScore).toBeUndefined();
    });

    it('rejects unknown and banned event types', async () => {
      for (const type of ['PHONE_DETECTED', 'AI_CHEATING_DETECTED', 'NOT_A_TYPE']) {
        const res = await postEvents(student, quiz._id, started.attemptId, {
          sessionId: started.sessionId,
          heartbeat: true,
          events: [episode({ type })],
        });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
      expect(await ProctoringEvent.countDocuments({})).toBe(0);
    });

    it('rejects confidence-rule violations (deterministic-with / probabilistic-without)', async () => {
      const withConfidence = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events: [{ type: 'CAMERA_TRACK_ENDED', source: 'cv', openedAt: Date.now(), closedAt: Date.now(), idempotencyKey: 'a', clientSeq: 0, confidence: 0.9 }],
      });
      expect(withConfidence.status).toBe(400);

      const withoutConfidence = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events: [{ type: 'FACE_OUT_OF_FRAME', source: 'cv', openedAt: Date.now(), closedAt: Date.now(), idempotencyKey: 'b', clientSeq: 0 }],
      });
      expect(withoutConfidence.status).toBe(400);
    });

    it('rejects implausible timestamps and envelope inconsistencies', async () => {
      const farFuture = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events: [episode({ openedAt: Date.now() + 3 * 60 * 60 * 1000, closedAt: Date.now() + 3 * 60 * 60 * 1000 })],
      });
      expect(farFuture.status).toBe(400);

      const inverted = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events: [episode({ openedAt: Date.now(), closedAt: Date.now() - 5000 })],
      });
      expect(inverted.status).toBe(400);

      const seqMismatch = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        seq: 42,
        heartbeat: true,
        events: [episode({ clientSeq: 0 })],
      });
      expect(seqMismatch.status).toBe(400);

      const emptyNoHeartbeat = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        events: [],
      });
      expect(emptyNoHeartbeat.status).toBe(400);
    });

    it('rejects a batch over 50 events without storing anything', async () => {
      const events = Array.from({ length: 51 }, (_, i) =>
        episode({ idempotencyKey: `bulk-${i}`, clientSeq: i })
      );
      const res = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events,
      });
      expect(res.status).toBe(400);
      expect(await ProctoringEvent.countDocuments({})).toBe(0);
    });

    it('rejects a mismatched session id (403 SESSION_MISMATCH)', async () => {
      const res = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: '507f1f77bcf86cd7994390ff',
        heartbeat: true,
        events: [episode()],
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SESSION_MISMATCH');
    });
  });

  describe('ownership and state gating', () => {
    beforeEach(async () => {
      started = await startProctoredAttempt();
    });

    it('rejects another student writing into the session (404, no existence leak)', async () => {
      const intruder = await createUser({ role: 'student' });
      const res = await postEvents(intruder, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events: [episode()],
      });
      expect(res.status).toBe(404);
      expect(await ProctoringEvent.countDocuments({})).toBe(0);
    });

    it('rejects the right student with a wrong quiz id (404)', async () => {
      const otherSubject = await createSubject('Physiology');
      const otherQuiz = await Quiz.create({
        title: 'Unrelated quiz', subject: otherSubject._id, testType: 'daily', duration: 10,
        questions: [], assignedStudents: [student.user._id], createdBy: admin.user._id,
      });
      const res = await postEvents(student, otherQuiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events: [episode()],
      });
      expect(res.status).toBe(404);
    });

    it('rejects events for a non-proctored attempt (no snapshot → no session)', async () => {
      await Quiz.updateOne({ _id: quiz._id }, { $set: { 'proctoring.enabled': false } });
      const plain = await request(app)
        .post(`/api/quizzes/${quiz._id}/start`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({});
      // One-attempt rule: the existing in_progress attempt resumes — use a
      // fresh student + unproctored quiz instead.
      const student2 = await createUser({ role: 'student' });
      const unproctoredQuiz = await Quiz.create({
        title: 'Plain quiz', subject: quiz.subject, testType: 'daily', duration: 10,
        questions: quiz.questions, assignedStudents: [student2.user._id], createdBy: admin.user._id,
      });
      const plainStart = await request(app)
        .post(`/api/quizzes/${unproctoredQuiz._id}/start`)
        .set('Authorization', `Bearer ${student2.token}`)
        .send({});
      expect(plainStart.status).toBe(201);

      const res = await postEvents(student2, unproctoredQuiz._id, plainStart.body.attemptId, {
        heartbeat: true,
        events: [episode()],
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PROCTORING_NOT_ENABLED_FOR_QUIZ');
    });

    it('rejects events after a real submit (409 SESSION_NOT_ACTIVE) and counts post-close batches', async () => {
      const submit = await request(app)
        .post(`/api/quizzes/${quiz._id}/attempt/${started.attemptId}/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ isAutoSubmit: false });
      expect(submit.status).toBe(200);

      const session = await ProctoringSession.findById(started.sessionId);
      expect(session.status).toBe('CLOSED'); // finalize hook closed it

      const res = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events: [episode()],
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SESSION_NOT_ACTIVE');
      expect(await ProctoringEvent.countDocuments({ session: started.sessionId })).toBe(0);

      const after = await ProctoringSession.findById(started.sessionId);
      expect(after.integrity.batchesRejected).toBe(1);
    });

    it('lazily finalizes a past-deadline attempt on event ingest (§7.5) and rejects the batch', async () => {
      await QuizAttempt.updateOne(
        { _id: started.attemptId },
        { $set: { durationDeadline: new Date(Date.now() - 60_000) } }
      );
      const res = await postEvents(student, quiz._id, started.attemptId, {
        sessionId: started.sessionId,
        heartbeat: true,
        events: [episode()],
      });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'SESSION_NOT_ACTIVE', attemptFinalized: true });

      const attempt = await QuizAttempt.findById(started.attemptId);
      expect(attempt.status).toBe('auto_submitted');
      expect(attempt.autoSubmitReason?.kind).toBe('duration');
      const session = await ProctoringSession.findById(started.sessionId);
      expect(session.status).toBe('CLOSED');
    });

    it('rate-limits event batches (60/min/student)', async () => {
      let last;
      for (let i = 0; i <= 60; i += 1) {
        last = await postEvents(student, quiz._id, started.attemptId, {
          sessionId: started.sessionId,
          heartbeat: true,
          events: [],
        });
      }
      expect(last.status).toBe(429);
      expect(last.body.code).toBe('RATE_LIMITED');
    });
  });

  describe('session resync endpoint (GET /attempt/:attemptId/proctoring/session)', () => {
    beforeEach(async () => {
      started = await startProctoredAttempt();
      await MentorStudentAssignment.create({
        mentor: mentor.user._id, student: student.user._id, isActive: true, assignedBy: admin.user._id,
      });
    });

    it('returns session state + frozen policy to the owner', async () => {
      const res = await request(app)
        .get(`/api/quizzes/attempt/${started.attemptId}/proctoring/session`)
        .set('Authorization', `Bearer ${student.token}`);
      expect(res.status).toBe(200);
      expect(res.body.session).toMatchObject({ id: String(started.sessionId), status: 'ACTIVE' });
      expect(res.body.session.heartbeat.intervalMs).toBe(30000);
      expect(res.body.policy.sessionHealth.heartbeatIntervalMs).toBe(30000);
      expect(res.body.attemptStatus).toBe('in_progress');
      expect(res.body.serverNow).toBeDefined();
    });

    it('serves admins and assigned mentors; refuses other students and unassigned mentors', async () => {
      const otherStudent = await createUser({ role: 'student' });
      const otherMentor = await createUser({ role: 'mentor' });

      const asAdmin = await request(app)
        .get(`/api/quizzes/attempt/${started.attemptId}/proctoring/session`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(asAdmin.status).toBe(200);

      const asMentor = await request(app)
        .get(`/api/quizzes/attempt/${started.attemptId}/proctoring/session`)
        .set('Authorization', `Bearer ${mentor.token}`);
      expect(asMentor.status).toBe(200);

      for (const token of [otherStudent.token, otherMentor.token]) {
        const denied = await request(app)
          .get(`/api/quizzes/attempt/${started.attemptId}/proctoring/session`)
          .set('Authorization', `Bearer ${token}`);
        expect(denied.status).toBe(403);
      }
    });

    it('answers 400 for non-proctored attempts and 404 for unknown ids', async () => {
      const student2 = await createUser({ role: 'student' });
      const unproctoredQuiz = await Quiz.create({
        title: 'Plain quiz 2', subject: quiz.subject, testType: 'daily', duration: 10,
        questions: quiz.questions, assignedStudents: [student2.user._id], createdBy: admin.user._id,
      });
      const plainStart = await request(app)
        .post(`/api/quizzes/${unproctoredQuiz._id}/start`)
        .set('Authorization', `Bearer ${student2.token}`)
        .send({});
      const plain = await request(app)
        .get(`/api/quizzes/attempt/${plainStart.body.attemptId}/proctoring/session`)
        .set('Authorization', `Bearer ${student2.token}`);
      expect(plain.status).toBe(400);
      expect(plain.body.code).toBe('PROCTORING_NOT_ENABLED_FOR_QUIZ');

      const missing = await request(app)
        .get('/api/quizzes/attempt/507f1f77bcf86cd799439099/proctoring/session')
        .set('Authorization', `Bearer ${student.token}`);
      expect(missing.status).toBe(404);
    });
  });

  describe('attempt resync carries the session hint (GET /attempt/:id)', () => {
    it('includes proctoringSession for snapshot-carrying attempts only', async () => {
      started = await startProctoredAttempt();
      const res = await request(app)
        .get(`/api/quizzes/attempt/${started.attemptId}`)
        .set('Authorization', `Bearer ${student.token}`);
      expect(res.status).toBe(200);
      expect(res.body.proctoringSession).toMatchObject({ id: String(started.sessionId), status: 'ACTIVE' });

      const student2 = await createUser({ role: 'student' });
      const unproctoredQuiz = await Quiz.create({
        title: 'Plain quiz 3', subject: quiz.subject, testType: 'daily', duration: 10,
        questions: quiz.questions, assignedStudents: [student2.user._id], createdBy: admin.user._id,
      });
      const plainStart = await request(app)
        .post(`/api/quizzes/${unproctoredQuiz._id}/start`)
        .set('Authorization', `Bearer ${student2.token}`)
        .send({});
      const plain = await request(app)
        .get(`/api/quizzes/attempt/${plainStart.body.attemptId}`)
        .set('Authorization', `Bearer ${student2.token}`);
      expect(plain.status).toBe(200);
      expect(plain.body.proctoringSession).toBeUndefined();
    });
  });
});
