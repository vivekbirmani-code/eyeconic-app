// Integration tests for the Phase 1 proctoring foundation (plan §32 Phase 1):
// models + indexes, quiz-level opt-in config (D15), rollout gates (kill
// switch > flag > quiz config), policy snapshot freeze/immutability at
// /start, session creation/idempotency/self-healing, session close on
// finalize, and the settings rollout controls.
//
// The aiProctoring feature flag is a hardcoded const in
// config/featureAvailability.js; this suite controls it through a mock so the
// flag-on/flag-off precedence is actually exercised.

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
const express = require('express');
const mongoose = require('mongoose');
const db = require('../../helpers/db');
const { buildApp, createUser, createSubject } = require('../../helpers/testApp');
const requestId = require('../../../middleware/requestId');
const errorHandler = require('../../../middleware/errorHandler');
const settingsRoutes = require('../../../routes/settings');
const Quiz = require('../../../models/Quiz');
const QuizAttempt = require('../../../models/QuizAttempt');
const QuestionBank = require('../../../models/QuestionBank');
const ProctoringSession = require('../../../models/ProctoringSession');
const ProctoringEvent = require('../../../models/ProctoringEvent');
const ProctoringConsent = require('../../../models/ProctoringConsent');
const ProctoringViolation = require('../../../models/ProctoringViolation');
const ProctoringOverride = require('../../../models/ProctoringOverride');
const AppSettings = require('../../../models/AppSettings');
const {
  isProctoringEnabled,
  setProctoringEnabled,
  isProctoringStrictCvEnabled,
  setProctoringStrictCvEnabled,
} = require('../../../utils/appSettings');
const { resetPrecheckRateLimits } = require('../../../middleware/proctoringRateLimit');

let app;

function buildSettingsApp() {
  const settingsApp = express();
  settingsApp.use(requestId);
  settingsApp.use(express.json());
  settingsApp.use('/api/settings', settingsRoutes);
  settingsApp.use(errorHandler);
  return settingsApp;
}

let settingsApp;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
  settingsApp = buildSettingsApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

async function makeQuestions(subject, count = 2) {
  const questions = [];
  for (let i = 0; i < count; i++) {
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
  return questions;
}

async function setupQuiz(admin, student, subject, { proctoring, duration = 20 } = {}) {
  const questions = await makeQuestions(subject);
  const quiz = await Quiz.create({
    title: `Proctoring Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    subject: subject._id,
    testType: 'daily',
    duration,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    assignedStudents: [student.user._id],
    createdBy: admin.user._id,
    ...(proctoring ? { proctoring } : {}),
  });
  return { quiz, questions };
}

const startAttempt = (student, quizId, body = {}) =>
  request(app)
    .post(`/api/quizzes/${quizId}/start`)
    .set('Authorization', `Bearer ${student.token}`)
    .send(body);

const submitQuiz = (student, quizId, attemptId) =>
  request(app)
    .post(`/api/quizzes/${quizId}/attempt/${attemptId}/submit`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ isAutoSubmit: false });

const saveAnswer = (student, quizId, attemptId, questionIndex, questionId) =>
  request(app)
    .put(`/api/quizzes/${quizId}/attempt/${attemptId}/answer`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ questionIndex, questionId, selectedAnswer: 1 });

// Phase 2 gate: eligible proctored quizzes start only after precheck +
// consent. These helpers walk the real client path so the Phase 1 mechanics
// below (snapshot/session/convergence) are exercised behind the gate.
const passReport = () => ({
  device: { platform: 'android', osVersion: 33 },
  network: { reachable: true, authedPingMs: 120 },
  checks: [
    { id: 'device_capability', status: 'PASS' },
    { id: 'camera_permission', status: 'PASS' },
    { id: 'camera_availability', status: 'PASS' },
    { id: 'face_readiness', status: 'PASS', metadata: { frames: 5, agreedFrames: 4, faceCountClass: 'one', visibility: 'ok' } },
    { id: 'network', status: 'PASS' },
  ],
});

async function passPrecheckAndConsent(student, quizId) {
  const report = await request(app)
    .post(`/api/quizzes/${quizId}/proctoring/precheck-report`)
    .set('Authorization', `Bearer ${student.token}`)
    .send(passReport());
  expect(report.status).toBe(200);
  const precheckToken = report.body.precheckToken;
  const consent = await request(app)
    .post(`/api/quizzes/${quizId}/proctoring/consent`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ precheckToken, consentTextVersion: '2026-09-v1', surface: 'app-android' });
  expect(consent.status).toBe(200);
  return precheckToken;
}

describe('Proctoring foundation — collections and indexes exist', () => {
  beforeAll(async () => {
    await db.clearDatabase();
  });

  it('creates every proctoring collection with its key indexes', async () => {
    // Ensure the models' collections + indexes exist, then verify them.
    await ProctoringConsent.init();
    await ProctoringViolation.init();
    await ProctoringOverride.init();
    await ProctoringEvent.init();
    await ProctoringSession.init();

    const collections = await mongoose.connection.db.listCollections().toArray();
    const names = collections.map((c) => c.name);
    for (const expected of [
      'proctoringsessions', 'proctoringevents', 'proctoringconsents',
      'proctoringviolations', 'proctoringoverrides',
    ]) {
      expect(names).toContain(expected);
    }

    const listIndexes = (collection) =>
      mongoose.connection.db.collection(collection).listIndexes().toArray();

    const sessionIndexes = await listIndexes('proctoringsessions');
    const attemptIndex = sessionIndexes.find((idx) => idx.name === 'attempt_1');
    expect(attemptIndex).toBeDefined();
    expect(attemptIndex.unique).toBe(true); // the 1:1 anchor

    const eventIndexes = await listIndexes('proctoringevents');
    const idempotencyIndex = eventIndexes.find((idx) => idx.name === 'session_1_idempotencyKey_1');
    expect(idempotencyIndex).toBeDefined();
    expect(idempotencyIndex.unique).toBe(true);
    expect(idempotencyIndex.partialFilterExpression).toEqual({ idempotencyKey: { $type: 'string' } });
    expect(eventIndexes.some((idx) => idx.name === 'session_1_serverAt_1')).toBe(true);

    const consentIndexes = await listIndexes('proctoringconsents');
    expect(consentIndexes.some((idx) => idx.name === 'quiz_1_student_1_policyVersion_1')).toBe(true);
  });

  it('rejects banned/unknown event types at the model layer (registry enum)', async () => {
    const session = await ProctoringSession.create({
      quiz: '507f1f77bcf86cd799439011',
      attempt: '507f1f77bcf86cd799439012',
      student: '507f1f77bcf86cd799439013',
    });
    await expect(ProctoringEvent.create({
      session: session._id,
      attempt: session.attempt,
      quiz: session.quiz,
      category: 'integrity',
      type: 'CHEATING_DETECTED', // banned verdict identifier
      source: 'os',
      openedAt: new Date(),
      closedAt: new Date(),
      serverAt: new Date(),
    })).rejects.toThrow();

    await expect(ProctoringEvent.create({
      session: session._id,
      attempt: session.attempt,
      quiz: session.quiz,
      category: 'integrity',
      type: 'MADE_UP_TYPE',
      source: 'os',
      openedAt: new Date(),
      closedAt: new Date(),
      serverAt: new Date(),
    })).rejects.toThrow();
  });
});

describe('Proctoring at /start — gates, snapshot, session', () => {
  let admin;
  let student;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    resetPrecheckRateLimits();
    mockAiProctoringFlag = false;
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    subject = await createSubject('Pathology');
  });

  it('is OFF by default: no config, no kill switch, no flag → zero proctoring artifacts', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject);
    const res = await startAttempt(student, quiz._id);
    expect(res.status).toBe(201);
    expect(res.body.proctoringSessionId).toBeUndefined();
    expect(res.body.proctoringPolicyDigest).toBeUndefined();

    const attempt = await QuizAttempt.findById(res.body.attemptId);
    expect(attempt.proctoringSnapshot).toBeUndefined();
    expect(await ProctoringSession.countDocuments({})).toBe(0);

    // Non-proctored flat quiz still works end to end.
    expect((await saveAnswer(student, quiz._id, res.body.attemptId, 0, questions[0]._id)).status).toBe(200);
    expect((await submitQuiz(student, quiz._id, res.body.attemptId)).body.status).toBe('completed');
  });

  it('a quiz opted in with the kill switch OFF stays unproctored (kill switch > quiz config)', async () => {
    mockAiProctoringFlag = true; // flag alone is not enough
    await setProctoringEnabled(false, admin.user._id);
    const { quiz } = await setupQuiz(admin, student, subject, { proctoring: { enabled: true } });

    const res = await startAttempt(student, quiz._id);
    expect(res.status).toBe(201);
    expect(res.body.proctoringSessionId).toBeUndefined();
    expect(await ProctoringSession.countDocuments({})).toBe(0);
    expect((await QuizAttempt.findById(res.body.attemptId)).proctoringSnapshot).toBeUndefined();
  });

  it('a quiz opted in with the flag OFF stays unproctored (flag > quiz config)', async () => {
    mockAiProctoringFlag = false;
    await setProctoringEnabled(true, admin.user._id);
    const { quiz } = await setupQuiz(admin, student, subject, { proctoring: { enabled: true } });

    const res = await startAttempt(student, quiz._id);
    expect(res.status).toBe(201);
    expect(res.body.proctoringSessionId).toBeUndefined();
    expect(await ProctoringSession.countDocuments({})).toBe(0);
  });

  it('freezes the policy snapshot and creates the ACTIVE session when every gate is on', async () => {
    mockAiProctoringFlag = true;
    await setProctoringEnabled(true, admin.user._id);
    const { quiz } = await setupQuiz(admin, student, subject, {
      proctoring: { enabled: true, focusEvents: { toleratedViolations: 4 } },
    });

    const precheckToken = await passPrecheckAndConsent(student, quiz._id);
    const res = await startAttempt(student, quiz._id, { precheckToken });
    expect(res.status).toBe(201);
    expect(res.body.proctoringSessionId).toBeDefined();
    expect(res.body.proctoringPolicyDigest).toMatch(/^[0-9a-f]{64}$/);

    const attempt = await QuizAttempt.findById(res.body.attemptId);
    expect(attempt.proctoringSnapshot.version).toBe(1);
    expect(attempt.proctoringSnapshot.hash).toBe(res.body.proctoringPolicyDigest);
    // Effective policy = quiz override merged over platform defaults.
    expect(attempt.proctoringSnapshot.policy.focusEvents.toleratedViolations).toBe(4);
    expect(attempt.proctoringSnapshot.policy.focusEvents.mode).toBe('warn-then-submit');
    expect(attempt.proctoringSnapshot.policy.attention.mode).toBe('record'); // D6 lock
    expect(attempt.proctoringSnapshot.frozenAt).toBeDefined();

    const session = await ProctoringSession.findById(res.body.proctoringSessionId);
    expect(session.status).toBe('ACTIVE');
    expect(String(session.attempt)).toBe(String(attempt._id));
    expect(session.policy.hash).toBe(attempt.proctoringSnapshot.hash);
    expect(session.ownerKind).toBe('user');
    expect(session.transitions[0]).toMatchObject({ to: 'ACTIVE', reason: 'start' });
  });

  it('keeps the snapshot immutable when the quiz config changes mid-attempt', async () => {
    mockAiProctoringFlag = true;
    await setProctoringEnabled(true, admin.user._id);
    const { quiz } = await setupQuiz(admin, student, subject, { proctoring: { enabled: true } });

    const precheckToken = await passPrecheckAndConsent(student, quiz._id);
    const start = await startAttempt(student, quiz._id, { precheckToken });
    const attemptId = start.body.attemptId;
    const frozenHash = start.body.proctoringPolicyDigest;

    await Quiz.updateOne(
      { _id: quiz._id },
      { $set: { 'proctoring.focusEvents.toleratedViolations': 5, 'proctoring.camera': 'optional' } }
    );

    // Resume: the attempt keeps its frozen snapshot, byte for byte.
    const resume = await startAttempt(student, quiz._id);
    expect(resume.status).toBe(200);
    expect(resume.body.attemptId.toString()).toBe(attemptId.toString());

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.proctoringSnapshot.hash).toBe(frozenHash);
    expect(attempt.proctoringSnapshot.policy.focusEvents.toleratedViolations).toBe(3); // default, not 5
    expect(attempt.proctoringSnapshot.policy.camera).toBe('required');
  });

  it('duplicate /start resumes the SAME attempt and the SAME session (no duplicates)', async () => {
    mockAiProctoringFlag = true;
    await setProctoringEnabled(true, admin.user._id);
    const { quiz } = await setupQuiz(admin, student, subject, { proctoring: { enabled: true } });

    const precheckToken = await passPrecheckAndConsent(student, quiz._id);
    const first = await startAttempt(student, quiz._id, { precheckToken });
    // Retries after a successful start are resumes — no re-gating.
    const second = await startAttempt(student, quiz._id);
    const third = await startAttempt(student, quiz._id);

    expect(second.status).toBe(200);
    expect(second.body.attemptId.toString()).toBe(first.body.attemptId.toString());
    expect(third.body.attemptId.toString()).toBe(first.body.attemptId.toString());
    expect(third.body.proctoringSessionId.toString()).toBe(first.body.proctoringSessionId.toString());

    expect(await QuizAttempt.countDocuments({ quiz: quiz._id, status: 'in_progress' })).toBe(1);
    expect(await ProctoringSession.countDocuments({ quiz: quiz._id })).toBe(1);
  });

  it('concurrent /start requests converge to exactly one attempt and one session', async () => {
    mockAiProctoringFlag = true;
    await setProctoringEnabled(true, admin.user._id);
    const { quiz } = await setupQuiz(admin, student, subject, { proctoring: { enabled: true } });

    const precheckToken = await passPrecheckAndConsent(student, quiz._id);
    const [a, b] = await Promise.all([
      startAttempt(student, quiz._id, { precheckToken }),
      startAttempt(student, quiz._id, { precheckToken }),
    ]);

    for (const res of [a, b]) {
      expect(res.status).toBe(201);
    }
    expect(a.body.attemptId.toString()).toBe(b.body.attemptId.toString());
    expect(a.body.proctoringSessionId.toString()).toBe(b.body.proctoringSessionId.toString());

    expect(await QuizAttempt.countDocuments({ quiz: quiz._id, status: 'in_progress' })).toBe(1);
    expect(await ProctoringSession.countDocuments({ quiz: quiz._id })).toBe(1);
  });

  it('self-heals a missing session on resume (crash between attempt save and session create)', async () => {
    mockAiProctoringFlag = true;
    await setProctoringEnabled(true, admin.user._id);
    const { quiz } = await setupQuiz(admin, student, subject, { proctoring: { enabled: true } });

    const precheckToken = await passPrecheckAndConsent(student, quiz._id);
    const start = await startAttempt(student, quiz._id, { precheckToken });
    await ProctoringSession.deleteMany({ attempt: start.body.attemptId }); // simulate the crash window
    expect(await ProctoringSession.countDocuments({})).toBe(0);

    const resume = await startAttempt(student, quiz._id);
    expect(resume.status).toBe(200);
    expect(resume.body.proctoringSessionId).toBeDefined();

    const session = await ProctoringSession.findById(resume.body.proctoringSessionId);
    expect(session.status).toBe('ACTIVE');
    expect(session.transitions.some((t) => t.reason === 'resume_self_heal')).toBe(true);
    expect(await ProctoringSession.countDocuments({})).toBe(1);
  });

  it('never retro-proctors a snapshot-less in-flight attempt (started before the feature)', async () => {
    mockAiProctoringFlag = true;
    await setProctoringEnabled(true, admin.user._id);
    const { quiz, questions } = await setupQuiz(admin, student, subject, { proctoring: { enabled: true } });

    // An attempt created directly (pre-feature shape: no snapshot).
    const legacyAttempt = await QuizAttempt.create({
      quiz: quiz._id,
      student: student.user._id,
      startTime: new Date(),
      status: 'in_progress',
      answers: [{ questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 1 }],
    });

    const resume = await startAttempt(student, quiz._id);
    expect(resume.status).toBe(200);
    expect(resume.body.attemptId.toString()).toBe(legacyAttempt._id.toString());
    expect(resume.body.proctoringSessionId).toBeUndefined(); // no retro-proctoring
    expect(await ProctoringSession.countDocuments({})).toBe(0);
  });

  it('closing the kill switch mid-attempt leaves the existing session untouched (rollback safety, §31)', async () => {
    mockAiProctoringFlag = true;
    await setProctoringEnabled(true, admin.user._id);
    const { quiz } = await setupQuiz(admin, student, subject, { proctoring: { enabled: true } });

    const precheckToken = await passPrecheckAndConsent(student, quiz._id);
    const start = await startAttempt(student, quiz._id, { precheckToken });
    await setProctoringEnabled(false, admin.user._id);

    const resume = await startAttempt(student, quiz._id);
    expect(resume.status).toBe(200);
    expect(resume.body.proctoringSessionId).toBeUndefined(); // no NEW session during rollback

    const session = await ProctoringSession.findById(start.body.proctoringSessionId);
    expect(session.status).toBe('ACTIVE'); // existing one rides to the end, frozen snapshot intact
    expect(await ProctoringSession.countDocuments({})).toBe(1);
  });

  it('closes the session when the attempt is submitted (manual finalize)', async () => {
    mockAiProctoringFlag = true;
    await setProctoringEnabled(true, admin.user._id);
    const { quiz } = await setupQuiz(admin, student, subject, { proctoring: { enabled: true } });

    const precheckToken = await passPrecheckAndConsent(student, quiz._id);
    const start = await startAttempt(student, quiz._id, { precheckToken });
    const submit = await submitQuiz(student, quiz._id, start.body.attemptId);
    expect(submit.body.status).toBe('completed');

    const session = await ProctoringSession.findById(start.body.proctoringSessionId);
    expect(session.status).toBe('CLOSED');
    expect(session.endedAt).toBeDefined();
    expect(session.transitions[session.transitions.length - 1]).toMatchObject({
      to: 'CLOSED', reason: 'attempt_completed',
    });
  });

  it('closes the session when the duration deadline finalizes the attempt', async () => {
    mockAiProctoringFlag = true;
    await setProctoringEnabled(true, admin.user._id);
    const { quiz, questions } = await setupQuiz(admin, student, subject, {
      proctoring: { enabled: true }, duration: 20,
    });

    const precheckToken = await passPrecheckAndConsent(student, quiz._id);
    const start = await startAttempt(student, quiz._id, { precheckToken });
    await QuizAttempt.updateOne(
      { _id: start.body.attemptId },
      { $set: { durationDeadline: new Date(Date.now() - 60 * 1000) } }
    );

    const answer = await saveAnswer(student, quiz._id, start.body.attemptId, 0, questions[0]._id);
    expect(answer.status).toBe(403);
    expect(answer.body.errorCode).toBe('TIME_EXPIRED');

    const session = await ProctoringSession.findById(start.body.proctoringSessionId);
    expect(session.status).toBe('CLOSED');
    expect(session.transitions[session.transitions.length - 1]).toMatchObject({
      to: 'CLOSED', reason: 'attempt_auto_submitted',
    });
  });

  it('does not create a session for a quiz the student is not assigned to (403 unchanged)', async () => {
    mockAiProctoringFlag = true;
    await setProctoringEnabled(true, admin.user._id);
    const { quiz } = await setupQuiz(admin, student, subject, { proctoring: { enabled: true } });

    const stranger = await createUser({ role: 'student' });
    const res = await startAttempt(stranger, quiz._id);
    expect(res.status).toBe(403);
    expect(await ProctoringSession.countDocuments({})).toBe(0);
    expect(await QuizAttempt.countDocuments({})).toBe(0);
  });
});

describe('Proctoring quiz authoring validation (create/update routes)', () => {
  let admin;
  let student;
  let subject;
  let questions;

  beforeEach(async () => {
    await db.clearDatabase();
    mockAiProctoringFlag = false;
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    subject = await createSubject('Pathology');
    questions = await makeQuestions(subject);
  });

  const createQuiz = (payload) =>
    request(app)
      .post('/api/quizzes/create-from-bank')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        title: `Authored Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        subject: subject._id.toString(),
        testType: 'daily',
        duration: 20,
        numberOfQuestions: questions.length,
        selectedQuestionIds: questions.map((q) => q._id.toString()),
        assignedStudents: [student.user._id.toString()],
        ...payload,
      });

  it('stores a validated opt-in config; missing payload leaves the quiz unproctored', async () => {
    const withoutConfig = await createQuiz({});
    expect(withoutConfig.status).toBe(201);
    // Schema defaults hydrate enabled:false — the D15 guarantee in serialized
    // form (an absent payload can never read as ON).
    expect(withoutConfig.body.quiz.proctoring.enabled).toBe(false);

    const withConfig = await createQuiz({
      proctoring: { enabled: true, focusEvents: { toleratedViolations: 4 } },
    });
    expect(withConfig.status).toBe(201);
    const stored = await Quiz.findById(withConfig.body.quiz._id);
    expect(stored.proctoring.enabled).toBe(true);
    expect(stored.proctoring.focusEvents.toleratedViolations).toBe(4);
    expect(stored.proctoring.attention.mode).toBe('record');
  });

  it.each([
    ['attention escalation (D6)', { enabled: true, attention: { mode: 'warn' } }],
    ['per-quiz riskWeights injection', { enabled: true, riskWeights: { multipleFaces: { points: 999 } } }],
    ['CV auto-submit as a quiz setting (D8)', { enabled: true, multipleFaces: { mode: 'submit' } }],
    ['zero-tolerance warn-then-submit', { enabled: true, focusEvents: { mode: 'warn-then-submit', toleratedViolations: 0 } }],
    ['unknown camera value', { enabled: true, camera: 'always' }],
    ['out-of-bounds tolerance', { enabled: true, focusEvents: { toleratedViolations: 99 } }],
  ])('rejects %s with 400', async (_name, proctoring) => {
    const res = await createQuiz({ proctoring });
    expect(res.status).toBe(400);
    expect(res.body.message).toBeDefined();
  });

  it('PUT /:id updates the config when provided and preserves it when absent', async () => {
    const created = await createQuiz({ proctoring: { enabled: true, camera: 'optional' } });
    const quizId = created.body.quiz._id;

    // Absent → preserved.
    const untouched = await request(app)
      .put(`/api/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ duration: 25 });
    expect(untouched.status).toBe(200);
    expect(untouched.body.quiz.proctoring.enabled).toBe(true);
    expect(untouched.body.quiz.proctoring.camera).toBe('optional');

    // Provided → replaced (validated).
    const updated = await request(app)
      .put(`/api/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ proctoring: { enabled: false } });
    expect(updated.status).toBe(200);
    expect(updated.body.quiz.proctoring.enabled).toBe(false);

    // Invalid replacement → 400, stored config unchanged.
    const invalid = await request(app)
      .put(`/api/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ proctoring: { enabled: true, attention: { mode: 'warn' } } });
    expect(invalid.status).toBe(400);
    expect((await Quiz.findById(quizId)).proctoring.enabled).toBe(false);
  });

  it('rejects non-admin authoring of proctoring config', async () => {
    const res = await request(app)
      .post('/api/quizzes/create-from-bank')
      .set('Authorization', `Bearer ${student.token}`)
      .send({
        title: 'Student Quiz', subject: subject._id.toString(), testType: 'daily',
        duration: 20, numberOfQuestions: 1,
        selectedQuestionIds: questions.map((q) => q._id.toString()),
        proctoring: { enabled: true },
      });
    expect(res.status).toBe(403);
  });
});

describe('Proctoring rollout controls (AppSettings + settings routes)', () => {
  beforeEach(async () => {
    await db.clearDatabase();
    mockAiProctoringFlag = false;
  });

  it('kill switch and strict-CV gate fail closed by default', async () => {
    expect(await isProctoringEnabled()).toBe(false);
    expect(await isProctoringStrictCvEnabled()).toBe(false);
  });

  it('kill switch accessor fails closed on a database error', async () => {
    const spy = jest.spyOn(AppSettings, 'findOneAndUpdate').mockRejectedValue(new Error('db down'));
    expect(await isProctoringEnabled()).toBe(false);
    expect(await isProctoringStrictCvEnabled()).toBe(false);
    spy.mockRestore();
  });

  it('admin lifecycle: enable, audit, disable — with role and payload guards', async () => {
    const admin = await createUser({ role: 'admin' });

    // Guards.
    expect((await request(settingsApp).put('/api/settings/proctoring-enabled').send({ proctoringEnabled: true })).status).toBe(401);
    const student = await createUser({ role: 'student' });
    expect((await request(settingsApp)
      .put('/api/settings/proctoring-enabled')
      .set('Authorization', `Bearer ${student.token}`)
      .send({ proctoringEnabled: true })).status).toBe(403);
    expect((await request(settingsApp)
      .put('/api/settings/proctoring-enabled')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ proctoringEnabled: 'yes' })).status).toBe(400);

    // Enable (audited).
    const enable = await request(settingsApp)
      .put('/api/settings/proctoring-enabled')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ proctoringEnabled: true });
    expect(enable.status).toBe(200);
    expect(enable.body).toMatchObject({ success: true, proctoringEnabled: true });
    expect(enable.body.updatedBy).toBe(String(admin.user._id));
    expect(await isProctoringEnabled()).toBe(true);

    // Strict-CV gate: same guards, off by default, admin-audited.
    const strict = await request(settingsApp)
      .put('/api/settings/proctoring-strict-cv')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ proctoringStrictCv: true });
    expect(strict.status).toBe(200);
    expect(await isProctoringStrictCvEnabled()).toBe(true);

    // Admin read includes both gates.
    const read = await request(settingsApp)
      .get('/api/settings')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(read.body).toMatchObject({ proctoringEnabled: true, proctoringStrictCv: true });

    // Disable again.
    await request(settingsApp)
      .put('/api/settings/proctoring-enabled')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ proctoringEnabled: false });
    expect(await isProctoringEnabled()).toBe(false);
  });

  it('the public settings probe exposes no proctoring flags', async () => {
    const res = await request(settingsApp).get('/api/settings/public');
    expect(res.status).toBe(200);
    expect(res.body.proctoringEnabled).toBeUndefined();
    expect(res.body.proctoringStrictCv).toBeUndefined();
  });
});
