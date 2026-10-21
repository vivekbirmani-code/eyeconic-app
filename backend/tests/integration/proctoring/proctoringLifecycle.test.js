// Integration tests for the Phase 2 proctoring lifecycle (plan §32 Phase 2):
// precheck-report → consent → gated /start. Verifies the hard lifecycle rules:
//   - precheck/consent NEVER create attempts or sessions
//   - a failed precheck consumes nothing; retries are free (rate-limit bounded)
//   - /start for a proctored quiz refuses without consent + a valid precheck
//     token, leaving zero rows behind (no API bypass)
//   - duplicate/concurrent starts still converge to exactly one attempt +
//     one session (Phase 1 machinery, now behind the gate)
//   - non-proctored quizzes are byte-identical (no token ever required)

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
const jwt = require('jsonwebtoken');
const db = require('../../helpers/db');
const { buildApp, createUser, createSubject } = require('../../helpers/testApp');
const Quiz = require('../../../models/Quiz');
const QuizAttempt = require('../../../models/QuizAttempt');
const QuestionBank = require('../../../models/QuestionBank');
const ProctoringSession = require('../../../models/ProctoringSession');
const ProctoringConsent = require('../../../models/ProctoringConsent');
const { setProctoringEnabled } = require('../../../utils/appSettings');
const { resetPrecheckRateLimits } = require('../../../middleware/proctoringRateLimit');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

const allPassChecks = () => ([
  { id: 'device_capability', status: 'PASS' },
  { id: 'camera_permission', status: 'PASS' },
  { id: 'camera_availability', status: 'PASS' },
  {
    id: 'face_readiness', status: 'PASS',
    metadata: { frames: 5, agreedFrames: 4, faceCountClass: 'one', visibility: 'ok' },
  },
  { id: 'network', status: 'PASS' },
]);

const passReport = (overrides = {}) => ({
  device: { platform: 'android', osVersion: 33 },
  network: { reachable: true, authedPingMs: 120 },
  checks: allPassChecks(),
  ...overrides,
});

const reportPrecheck = (student, quizId, payload = passReport()) =>
  request(app)
    .post(`/api/quizzes/${quizId}/proctoring/precheck-report`)
    .set('Authorization', `Bearer ${student.token}`)
    .send(payload);

const giveConsent = (student, quizId, precheckToken) =>
  request(app)
    .post(`/api/quizzes/${quizId}/proctoring/consent`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ precheckToken, consentTextVersion: '2026-09-v1', surface: 'app-android' });

const startAttempt = (student, quizId, body = {}) =>
  request(app)
    .post(`/api/quizzes/${quizId}/start`)
    .set('Authorization', `Bearer ${student.token}`)
    .send(body);

describe('Proctoring lifecycle — precheck + consent + gated start (Phase 2)', () => {
  let admin;
  let student;
  let subject;
  let quiz;

  beforeEach(async () => {
    await db.clearDatabase();
    resetPrecheckRateLimits();
    mockAiProctoringFlag = true;
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    subject = await createSubject('Pathology');

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
      title: `Proctored Lifecycle Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  // Full happy-path helper: precheck → consent → returns the token body.
  async function passPrecheckAndConsent() {
    const report = await reportPrecheck(student, quiz._id);
    expect(report.status).toBe(200);
    expect(report.body.verdict).toBe('PASS');
    const token = report.body.precheckToken;
    const consent = await giveConsent(student, quiz._id, token);
    expect(consent.status).toBe(200);
    return token;
  }

  describe('precheck-report', () => {
    it('issues a signed token on all-pass and creates NOTHING', async () => {
      const res = await reportPrecheck(student, quiz._id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, verdict: 'PASS' });
      expect(res.body.precheckToken).toBeDefined();
      expect(res.body.policyHash).toMatch(/^[0-9a-f]{64}$/);

      // The hard lifecycle rule: precheck never consumes the attempt.
      expect(await QuizAttempt.countDocuments({})).toBe(0);
      expect(await ProctoringSession.countDocuments({})).toBe(0);
    });

    it('answers FAIL (no token) when camera permission was denied — and nothing is consumed', async () => {
      const res = await reportPrecheck(student, quiz._id, passReport({
        checks: allPassChecks().map((c) =>
          c.id === 'camera_permission' ? { id: c.id, status: 'FAIL', detail: 'permission_denied' } : c
        ),
      }));
      expect(res.status).toBe(200);
      expect(res.body.verdict).toBe('FAIL');
      expect(res.body.precheckToken).toBeUndefined();
      expect(res.body.reasons.some((r) => r.reasonCode === 'camera_permission:failed')).toBe(true);
      expect(await QuizAttempt.countDocuments({})).toBe(0);
      expect(await ProctoringSession.countDocuments({})).toBe(0);
    });

    it('answers RETRYABLE for a transient camera failure', async () => {
      const res = await reportPrecheck(student, quiz._id, passReport({
        checks: allPassChecks().map((c) =>
          c.id === 'camera_availability' ? { id: c.id, status: 'RETRYABLE', detail: 'camera_busy' } : c
        ),
      }));
      expect(res.status).toBe(200);
      expect(res.body.verdict).toBe('RETRYABLE');
      expect(res.body.precheckToken).toBeUndefined();
    });

    it('answers FAIL when the one-face condition was not established (zero faces / multiple faces)', async () => {
      for (const [faceCountClass, visibility] of [['none', 'none'], ['multiple', 'multiple']]) {
        const res = await reportPrecheck(student, quiz._id, passReport({
          checks: allPassChecks().map((c) =>
            c.id === 'face_readiness'
              ? {
                  id: c.id, status: 'FAIL', detail: faceCountClass,
                  metadata: { frames: 5, agreedFrames: 0, faceCountClass, visibility },
                }
              : c
          ),
        }));
        expect(res.status).toBe(200);
        expect(res.body.verdict).toBe('FAIL');
        expect(res.body.reasons.some((r) => r.check === 'face_readiness')).toBe(true);
      }
      expect(await QuizAttempt.countDocuments({})).toBe(0);
    });

    it('refuses a below-floor device with 403 DEVICE_BELOW_FLOOR + accommodation path (D10)', async () => {
      const res = await reportPrecheck(student, quiz._id, passReport({
        device: { platform: 'android', osVersion: 24 },
      }));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'DEVICE_BELOW_FLOOR', accommodation: true });
      expect(res.body.precheckToken).toBeUndefined();
      expect(await QuizAttempt.countDocuments({})).toBe(0);
    });

    it('refuses a non-Android platform as UNSUPPORTED', async () => {
      const res = await reportPrecheck(student, quiz._id, passReport({
        device: { platform: 'ios', osVersion: 17 },
      }));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DEVICE_BELOW_FLOOR');
    });

    it('still issues a token for camera-optional quizzes with camera failures (recorded, not blocked)', async () => {
      await Quiz.updateOne({ _id: quiz._id }, { $set: { 'proctoring.camera': 'optional' } });
      const res = await reportPrecheck(student, quiz._id, passReport({
        checks: allPassChecks().map((c) =>
          ['camera_permission', 'camera_availability', 'face_readiness'].includes(c.id)
            ? { id: c.id, status: 'FAIL', detail: 'permission_denied' }
            : c
        ),
      }));
      expect(res.status).toBe(200);
      expect(res.body.verdict).toBe('PASS');
      expect(res.body.cameraBypassed).toBe(true);
    });

    it.each([
      ['unknown check id', passReport({ checks: [...allPassChecks(), { id: 'sneaky', status: 'PASS' }] })],
      ['bad status', passReport({ checks: allPassChecks().map((c) => c.id === 'network' ? { ...c, status: 'MAYBE' } : c) })],
      ['missing device', passReport({ device: undefined })],
      ['malformed face metadata', passReport({ checks: allPassChecks().map((c) => c.id === 'face_readiness' ? { ...c, metadata: { frames: 9, agreedFrames: 2 } } : c) })],
    ])('rejects a malformed report (%s) with 400', async (_name, payload) => {
      const res = await reportPrecheck(student, quiz._id, payload);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('answers 503 PROCTORING_DISABLED when the kill switch is off', async () => {
      await setProctoringEnabled(false, admin.user._id);
      const res = await reportPrecheck(student, quiz._id);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('PROCTORING_DISABLED');
    });

    it('answers 400 PROCTORING_NOT_ENABLED_FOR_QUIZ for a non-proctored quiz', async () => {
      const plain = await Quiz.create({
        title: `Plain Quiz ${Date.now()}`, subject: subject._id, testType: 'daily', duration: 10,
        questions: quiz.questions, assignedStudents: [student.user._id], createdBy: admin.user._id,
      });
      const res = await reportPrecheck(student, plain._id);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PROCTORING_NOT_ENABLED_FOR_QUIZ');
    });

    it('rejects unassigned students and non-student roles', async () => {
      const stranger = await createUser({ role: 'student' });
      expect((await reportPrecheck(stranger, quiz._id)).status).toBe(403);

      const mentorToken = (await createUser({ role: 'mentor' })).token;
      const res = await request(app)
        .post(`/api/quizzes/${quiz._id}/proctoring/precheck-report`)
        .set('Authorization', `Bearer ${mentorToken}`)
        .send(passReport());
      expect(res.status).toBe(403);
    });

    it('rate limits to 10 reports per student per quiz per hour', async () => {
      let last;
      for (let i = 0; i < 11; i++) {
        last = await reportPrecheck(student, quiz._id);
      }
      expect(last.status).toBe(429);
      expect(last.body.code).toBe('RATE_LIMITED');
    });
  });

  describe('consent', () => {
    it('records consent bound to the token and creates NOTHING', async () => {
      const report = await reportPrecheck(student, quiz._id);
      const token = report.body.precheckToken;

      const res = await giveConsent(student, quiz._id, token);
      expect(res.status).toBe(200);
      expect(res.body.consent).toMatchObject({
        policyVersion: 3, // v3 bump (global warn rollout defaults)
        consentTextVersion: '2026-09-v1',
      });

      const record = await ProctoringConsent.findOne({ quiz: quiz._id, student: student.user._id });
      expect(record.policyHash).toBe(report.body.policyHash);
      expect(record.precheckSummary.deviceClass).toBe('android:33');
      expect(record.surface).toBe('app-android');

      expect(await QuizAttempt.countDocuments({})).toBe(0);
      expect(await ProctoringSession.countDocuments({})).toBe(0);
    });

    it('is idempotent — replays update the same single record', async () => {
      const token = (await reportPrecheck(student, quiz._id)).body.precheckToken;
      await giveConsent(student, quiz._id, token);
      const replay = await giveConsent(student, quiz._id, token);
      expect(replay.status).toBe(200);
      expect(await ProctoringConsent.countDocuments({ quiz: quiz._id, student: student.user._id })).toBe(1);
    });

    it('rejects a missing/garbage token with 403 PRECHECK_TOKEN_INVALID', async () => {
      expect((await giveConsent(student, quiz._id, undefined)).status).toBe(403);
      const garbage = await giveConsent(student, quiz._id, 'not-a-jwt');
      expect(garbage.status).toBe(403);
      expect(garbage.body.code).toBe('PRECHECK_TOKEN_INVALID');
    });

    it('rejects a FORGED token (signed with the wrong secret)', async () => {
      const forged = jwt.sign(
        { kind: 'proctoring_precheck', studentId: String(student.user._id), quizId: String(quiz._id), policyHash: 'x'.repeat(64) },
        'not-the-real-secret',
        { expiresIn: 600 }
      );
      const res = await giveConsent(student, quiz._id, forged);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PRECHECK_TOKEN_INVALID');
    });

    it('rejects an expired token', async () => {
      const expired = jwt.sign(
        { kind: 'proctoring_precheck', studentId: String(student.user._id), quizId: String(quiz._id), policyHash: 'x' },
        process.env.JWT_SECRET,
        { expiresIn: -60 }
      );
      const res = await giveConsent(student, quiz._id, expired);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PRECHECK_TOKEN_INVALID');
    });

    it('rejects a token issued for ANOTHER student or ANOTHER quiz', async () => {
      const token = (await reportPrecheck(student, quiz._id)).body.precheckToken;

      const other = await createUser({ role: 'student' });
      await Quiz.updateOne({ _id: quiz._id }, { $addToSet: { assignedStudents: other.user._id } });
      const asOther = await giveConsent(other, quiz._id, token);
      expect(asOther.status).toBe(403);
      expect(asOther.body.code).toBe('PRECHECK_TOKEN_INVALID');

      const otherQuiz = await Quiz.create({
        title: `Second Quiz ${Date.now()}`, subject: subject._id, testType: 'daily', duration: 10,
        questions: quiz.questions, assignedStudents: [student.user._id], createdBy: admin.user._id,
        proctoring: { enabled: true },
      });
      const wrongQuiz = await giveConsent(student, otherQuiz._id, token);
      expect(wrongQuiz.status).toBe(403);
    });

    it('rejects a stale token after the quiz policy changed (consent binds the hash)', async () => {
      const token = (await reportPrecheck(student, quiz._id)).body.precheckToken;
      await Quiz.updateOne({ _id: quiz._id }, { $set: { 'proctoring.focusEvents.toleratedViolations': 4 } });

      const res = await giveConsent(student, quiz._id, token);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PRECHECK_TOKEN_INVALID');
    });

    it('validates consentTextVersion and surface', async () => {
      const token = (await reportPrecheck(student, quiz._id)).body.precheckToken;
      expect((await request(app)
        .post(`/api/quizzes/${quiz._id}/proctoring/consent`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ precheckToken: token, surface: 'app-android' })).status).toBe(400);
      expect((await request(app)
        .post(`/api/quizzes/${quiz._id}/proctoring/consent`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ precheckToken: token, consentTextVersion: 'v1', surface: 'desktop' })).status).toBe(400);
    });
  });

  describe('gated /start', () => {
    it('refuses /start without consent — 403 PROCTORING_CONSENT_REQUIRED, zero rows created', async () => {
      // Even with a VALID precheck token: no consent record, no start.
      const token = (await reportPrecheck(student, quiz._id)).body.precheckToken;
      const res = await startAttempt(student, quiz._id, { precheckToken: token });

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('PROCTORING_CONSENT_REQUIRED');
      expect(await QuizAttempt.countDocuments({})).toBe(0);
      expect(await ProctoringSession.countDocuments({})).toBe(0);
    });

    it('refuses a DIRECT /start with no precheck at all (API bypass attempt)', async () => {
      const res = await startAttempt(student, quiz._id);
      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('PROCTORING_CONSENT_REQUIRED');
      expect(await QuizAttempt.countDocuments({})).toBe(0);
      expect(await ProctoringSession.countDocuments({})).toBe(0);
    });

    it('refuses /start with consent but no token — 403 PROCTORING_PRECHECK_REQUIRED', async () => {
      const token = (await reportPrecheck(student, quiz._id)).body.precheckToken;
      await giveConsent(student, quiz._id, token);

      const res = await startAttempt(student, quiz._id);
      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('PROCTORING_PRECHECK_REQUIRED');
      expect(await QuizAttempt.countDocuments({})).toBe(0);
    });

    it('refuses /start with a forged/stale token — 403 PRECHECK_TOKEN_INVALID', async () => {
      const token = (await reportPrecheck(student, quiz._id)).body.precheckToken;
      await giveConsent(student, quiz._id, token);

      const forged = jwt.sign(
        { kind: 'proctoring_precheck', studentId: String(student.user._id), quizId: String(quiz._id), policyHash: 'x'.repeat(64) },
        'not-the-real-secret',
        { expiresIn: 600 }
      );
      const res = await startAttempt(student, quiz._id, { precheckToken: forged });
      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('PRECHECK_TOKEN_INVALID');
      expect(await QuizAttempt.countDocuments({})).toBe(0);
    });

    it('refuses when the policy changed AFTER consent (re-consent required)', async () => {
      await passPrecheckAndConsent();
      await Quiz.updateOne({ _id: quiz._id }, { $set: { 'proctoring.focusEvents.toleratedViolations': 4 } });

      const tokenAgain = (await reportPrecheck(student, quiz._id)).body.precheckToken;
      const res = await startAttempt(student, quiz._id, { precheckToken: tokenAgain });
      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('PROCTORING_CONSENT_REQUIRED');
      expect(await QuizAttempt.countDocuments({})).toBe(0);
    });

    it('starts after precheck + consent: exactly one attempt + one session, snapshot frozen, deadline set', async () => {
      const token = await passPrecheckAndConsent();

      const res = await startAttempt(student, quiz._id, { precheckToken: token });
      expect(res.status).toBe(201);
      expect(res.body.proctoringSessionId).toBeDefined();
      expect(res.body.durationDeadline).toBeDefined(); // Phase 1 timing intact

      expect(await QuizAttempt.countDocuments({})).toBe(1);
      expect(await ProctoringSession.countDocuments({})).toBe(1);

      const attempt = await QuizAttempt.findOne({});
      expect(attempt.proctoringSnapshot.hash).toBe(res.body.proctoringPolicyDigest);
      // Precheck/consent time never counts against the student (criterion 4):
      // the timer starts at attempt creation, strictly after consent was given.
      const consent = await ProctoringConsent.findOne({});
      expect(attempt.startTime.getTime()).toBeGreaterThanOrEqual(consent.grantedAt.getTime() - 1000);
      expect(attempt.startTime.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('resume /start after a successful start returns the SAME attempt without re-gating', async () => {
      const token = await passPrecheckAndConsent();
      const first = await startAttempt(student, quiz._id, { precheckToken: token });

      // Client retry/double-tap after success: no token needed on resume.
      const retry = await startAttempt(student, quiz._id);
      expect(retry.status).toBe(200);
      expect(retry.body.attemptId.toString()).toBe(first.body.attemptId.toString());
      expect(await QuizAttempt.countDocuments({ status: 'in_progress' })).toBe(1);
      expect(await ProctoringSession.countDocuments({})).toBe(1);
    });

    it('gating failures then a valid retry create exactly one attempt (nothing consumed by failures)', async () => {
      const blocked = await startAttempt(student, quiz._id);
      expect(blocked.status).toBe(403);
      expect(await QuizAttempt.countDocuments({})).toBe(0);

      const token = await passPrecheckAndConsent();
      const res = await startAttempt(student, quiz._id, { precheckToken: token });
      expect(res.status).toBe(201);
      expect(await QuizAttempt.countDocuments({})).toBe(1);
      expect(await ProctoringSession.countDocuments({})).toBe(1);
    });

    it('concurrent gated starts converge to exactly one attempt + one session', async () => {
      const token = await passPrecheckAndConsent();
      const [a, b] = await Promise.all([
        startAttempt(student, quiz._id, { precheckToken: token }),
        startAttempt(student, quiz._id, { precheckToken: token }),
      ]);
      expect([201, 200]).toContain(a.status);
      expect([201, 200]).toContain(b.status);
      expect(a.body.attemptId.toString()).toBe(b.body.attemptId.toString());
      expect(await QuizAttempt.countDocuments({ status: 'in_progress' })).toBe(1);
      expect(await ProctoringSession.countDocuments({})).toBe(1);
    });

    it('three-way concurrent starts all return the same canonical attempt, none stranded', async () => {
      const token = await passPrecheckAndConsent();
      const racers = await Promise.all([
        startAttempt(student, quiz._id, { precheckToken: token }),
        startAttempt(student, quiz._id, { precheckToken: token }),
        startAttempt(student, quiz._id, { precheckToken: token }),
      ]);
      const ids = racers.map((r) => r.body.attemptId.toString());
      expect(new Set(ids).size).toBe(1);
      // Every id handed to a client must still exist (convergence may only
      // delete an attempt its OWN request created, before responding).
      for (const id of ids) {
        expect(await QuizAttempt.findById(id)).not.toBeNull();
      }
      expect(await QuizAttempt.countDocuments({ status: 'in_progress' })).toBe(1);
      expect(await ProctoringSession.countDocuments({})).toBe(1);
    });

    it('does not gate when the rollout gates are off (kill switch rollback)', async () => {
      await setProctoringEnabled(false, admin.user._id);
      const res = await startAttempt(student, quiz._id);
      expect(res.status).toBe(201);
      // Unproctored start: no session, no snapshot — Phase 1 semantics.
      expect(res.body.proctoringSessionId).toBeUndefined();
      expect(await ProctoringSession.countDocuments({})).toBe(0);
    });
  });

  describe('non-proctored quizzes remain unchanged', () => {
    it('starts with no token and no proctoring artifacts', async () => {
      const plain = await Quiz.create({
        title: `Unchanged Quiz ${Date.now()}`, subject: subject._id, testType: 'daily', duration: 10,
        questions: quiz.questions, assignedStudents: [student.user._id], createdBy: admin.user._id,
      });
      const res = await startAttempt(student, plain._id);
      expect(res.status).toBe(201);
      expect(res.body.proctoringSessionId).toBeUndefined();
      expect((await QuizAttempt.findById(res.body.attemptId)).proctoringSnapshot).toBeUndefined();
      expect(await ProctoringSession.countDocuments({})).toBe(0);
      expect(await ProctoringConsent.countDocuments({})).toBe(0);
    });

    it('GET /:id exposes the proctoring routing hint only when fully effective', async () => {
      mockAiProctoringFlag = true;
      const withProctoring = await request(app)
        .get(`/api/quizzes/${quiz._id}`)
        .set('Authorization', `Bearer ${student.token}`);
      expect(withProctoring.body.proctoringRequired).toBe(true);

      await setProctoringEnabled(false, admin.user._id);
      const rolledBack = await request(app)
        .get(`/api/quizzes/${quiz._id}`)
        .set('Authorization', `Bearer ${student.token}`);
      expect(rolledBack.body.proctoringRequired).toBe(false);

      await setProctoringEnabled(true, admin.user._id);
      const plain = await Quiz.create({
        title: `Hint Quiz ${Date.now()}`, subject: subject._id, testType: 'daily', duration: 10,
        questions: quiz.questions, assignedStudents: [student.user._id], createdBy: admin.user._id,
      });
      const plainRes = await request(app)
        .get(`/api/quizzes/${plain._id}`)
        .set('Authorization', `Bearer ${student.token}`);
      expect(plainRes.body.proctoringRequired).toBeUndefined();
    });
  });
});
