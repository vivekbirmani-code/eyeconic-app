// Integration tests for Phase 5 — head pose + record-only attention
// (plan §13, D6/D11): the precheck-baseline round-trip (report → signed
// token → consent → /start → session doc → resync), threshold-bearing policy
// snapshots, and the ingest-level D6 guarantee that ALL FOUR attention event
// types can never produce warnings, violations, risk or auto-submit through
// the batch endpoint (the only client event ingestion path).

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
const ProctoringViolation = require('../../../models/ProctoringViolation');
const ProctoringConsent = require('../../../models/ProctoringConsent');
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

const reportWith = (attentionBaseline) => ({
  device: { platform: 'android', osVersion: 33 },
  network: { reachable: true, authedPingMs: 120 },
  checks: [
    { id: 'device_capability', status: 'PASS' },
    { id: 'camera_permission', status: 'PASS' },
    { id: 'camera_availability', status: 'PASS' },
    {
      id: 'face_readiness', status: 'PASS',
      metadata: {
        frames: 5, agreedFrames: 4, faceCountClass: 'one', visibility: 'ok',
        ...(attentionBaseline ? { attentionBaseline } : {}),
      },
    },
    { id: 'network', status: 'PASS' },
  ],
});

const BASELINE = { yaw: 7.2, pitch: -3.4, roll: 1.1, frames: 4 };

describe('Phase 5 — attention baseline round-trip (D11, plan §13.4)', () => {
  let admin;
  let student;
  let quiz;

  beforeEach(async () => {
    await db.clearDatabase();
    resetPrecheckRateLimits();
    resetProctoringEventRateLimits();
    mockAiProctoringFlag = true;
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    const subject = await createSubject('Physiology');

    const questions = [];
    for (let i = 0; i < 2; i += 1) {
      questions.push(await QuestionBank.create({
        subject: subject._id,
        topicName: 'Neuro', subtopicName: 'Reflexes',
        system: 'Neural', questionType: 'mcq_single', difficulty: 'medium',
        question: `Q ${i}`, options: ['A', 'B', 'C', 'D'], correctAnswer: 1,
      }));
    }
    quiz = await Quiz.create({
      title: `Attention Quiz ${Date.now()}`,
      subject: subject._id, testType: 'daily', duration: 20,
      questions: questions.map((q) => q._id),
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
      proctoring: { enabled: true },
    });
    await setProctoringEnabled(true, admin.user._id);
  });

  /** Runs precheck + consent + start with the given report body. */
  const startAttempt = async (report) => {
    const pre = await request(app)
      .post(`/api/quizzes/${quiz._id}/proctoring/precheck-report`)
      .set('Authorization', `Bearer ${student.token}`)
      .send(report);
    if (pre.status !== 200 || pre.body.verdict !== 'PASS') {
      return { pre, consent: null, start: null };
    }
    const consent = await request(app)
      .post(`/api/quizzes/${quiz._id}/proctoring/consent`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ precheckToken: pre.body.precheckToken, consentTextVersion: '2026-09-v1', surface: 'app-android' });
    const start = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ precheckToken: pre.body.precheckToken });
    return { pre, consent, start };
  };

  it('carries a valid baseline: report → token → consent → session → /start response', async () => {
    const { pre, consent, start } = await startAttempt(reportWith(BASELINE));
    expect(pre.status).toBe(200);
    expect(pre.body.verdict).toBe('PASS');
    expect(consent.status).toBe(200);
    expect(start.status).toBe(201);

    // The consent record persisted the baseline from the SIGNED token summary.
    const consentDoc = await ProctoringConsent.findOne({ quiz: quiz._id, student: student.user._id });
    expect(consentDoc.precheckSummary.attentionBaseline).toMatchObject(BASELINE);

    // The session froze it (D11) with the calibration marker.
    const session = await ProctoringSession.findById(start.body.proctoringSessionId);
    expect(session.baseline).toMatchObject({
      nominalHeadPose: { yaw: 7.2, pitch: -3.4, roll: 1.1 },
      calibration: 'captured',
      detectorTier: 'headpose',
    });

    // The /start response re-serves it next to the frozen policy.
    expect(start.body.proctoringAttentionBaseline).toEqual({
      yaw: 7.2, pitch: -3.4, roll: 1.1, calibration: 'captured', detectorTier: 'headpose',
    });

    // And the frozen policy snapshot carries the Phase 5 thresholds.
    expect(start.body.proctoringPolicy.attention.thresholds).toMatchObject({
      turnedDeg: 25,
      extreme: { yawDeg: 50, pitchDeg: 50, sustainMs: 5000 },
      deviation: { deg: 35, sustainMs: 4000 },
      fallbackPadDeg: 10,
    });
  });

  it('re-serves the baseline on the resync endpoint (app restart path)', async () => {
    const { start } = await startAttempt(reportWith(BASELINE));
    expect(start.status).toBe(201);
    const resync = await request(app)
      .get(`/api/quizzes/attempt/${start.body.attemptId}/proctoring/session`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(resync.status).toBe(200);
    expect(resync.body.proctoringAttentionBaseline).toEqual({
      yaw: 7.2, pitch: -3.4, roll: 1.1, calibration: 'captured', detectorTier: 'headpose',
    });
    expect(resync.body.policy.attention.mode).toBe('record'); // D6 lock intact
  });

  it('a report WITHOUT a baseline still passes — the client falls back, never blocked', async () => {
    const { pre, start } = await startAttempt(reportWith(null));
    expect(pre.status).toBe(200);
    expect(pre.body.verdict).toBe('PASS');
    expect(start.status).toBe(201);

    const session = await ProctoringSession.findById(start.body.proctoringSessionId);
    // Mongoose instantiates the subdoc as {} — the pose is simply absent.
    expect(session.baseline?.nominalHeadPose).toBeUndefined();
    // Honest null → the client arms with global bands + calibration:'fallback'.
    expect(start.body.proctoringAttentionBaseline).toBeNull();
  });

  it('a MALFORMED baseline rejects the whole report (server owns the schema)', async () => {
    const { pre } = await startAttempt(reportWith({ yaw: 400, pitch: 0, roll: 0, frames: 4 }));
    expect(pre.status).toBe(400);
    expect(pre.body.code).toBe('VALIDATION_ERROR');
    // Nothing was consumed — no consent, no attempt, no session.
    expect(await ProctoringConsent.countDocuments({})).toBe(0);
    expect(await QuizAttempt.countDocuments({})).toBe(0);
    expect(await ProctoringSession.countDocuments({})).toBe(0);
  });

  it('a quiz authored with Phase 5 thresholds freezes them into the snapshot', async () => {
    await Quiz.updateOne({ _id: quiz._id }, {
      $set: { 'proctoring.attention.thresholds': { deviation: { deg: 20, sustainMs: 2500 } } },
    });
    const { start } = await startAttempt(reportWith(BASELINE));
    expect(start.status).toBe(201);
    const attempt = await QuizAttempt.findById(start.body.attemptId);
    expect(attempt.proctoringSnapshot.policy.attention.thresholds.deviation)
      .toEqual({ deg: 20, sustainMs: 2500 });
    // Untouched leaves keep the documented defaults.
    expect(attempt.proctoringSnapshot.policy.attention.thresholds.turnedDeg).toBe(25);
  });
});

describe('Phase 5 — all four attention types are record-only through ingest (D6)', () => {
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
    const subject = await createSubject('Anatomy');
    const questions = [];
    for (let i = 0; i < 2; i += 1) {
      questions.push(await QuestionBank.create({
        subject: subject._id, topicName: 'Limbs', subtopicName: 'Upper',
        system: 'Muscular', questionType: 'mcq_single', difficulty: 'medium',
        question: `Q ${i}`, options: ['A', 'B', 'C', 'D'], correctAnswer: 1,
      }));
    }
    quiz = await Quiz.create({
      title: `D6 Quiz ${Date.now()}`,
      subject: subject._id, testType: 'daily', duration: 20,
      questions: questions.map((q) => q._id),
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
      proctoring: { enabled: true },
    });
    await setProctoringEnabled(true, admin.user._id);

    const { start } = await startAttemptOnce();
    started = { attemptId: start.body.attemptId, sessionId: start.body.proctoringSessionId };
  });

  const startAttemptOnce = async () => {
    const pre = await request(app)
      .post(`/api/quizzes/${quiz._id}/proctoring/precheck-report`)
      .set('Authorization', `Bearer ${student.token}`)
      .send(reportWith(BASELINE));
    expect(pre.status).toBe(200);
    await request(app)
      .post(`/api/quizzes/${quiz._id}/proctoring/consent`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ precheckToken: pre.body.precheckToken, consentTextVersion: '2026-09-v1', surface: 'app-android' });
    const start = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ precheckToken: pre.body.precheckToken });
    expect(start.status).toBe(201);
    return { start };
  };

  const postEvents = (events) =>
    request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${started.attemptId}/proctoring/events`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ sessionId: started.sessionId, heartbeat: true, events });

  it('ingests all four types: stored as cv observations, ZERO actions/violations/risk', async () => {
    const attentionEvent = (type, i) => ({
      type, source: 'cv',
      openedAt: Date.now() - 60_000 + i * 3000,
      closedAt: Date.now() - 60_000 + i * 3000 + 8000,
      confidence: 0.82,
      idempotencyKey: `att5-${type}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      clientSeq: i,
      metadata: {
        basis: 'head_pose', calibration: 'captured', durationMs: 8000,
        baseline: { yaw: 7.2, pitch: -3.4 }, thresholds: {},
      },
    });

    const types = [
      'HEAD_POSE_EXTREME', 'HEAD_POSE_REPEATED',
      'ATTENTION_DEVIATION_SUSTAINED', 'ATTENTION_DEVIATION_REPEATED',
    ];
    const firstBatch = types.map((type, i) => attentionEvent(type, i));
    const res = await postEvents(firstBatch);
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(4);
    expect(res.body.actions).toBeUndefined();       // no warning, no FINAL_WARN
    expect(res.body.attemptFinalized).toBeUndefined(); // no auto-submit

    for (let round = 0; round < 5; round += 1) {
      // More of every type, beyond every plausible threshold — still nothing.
      const flood = await postEvents(types.map((type, i) => attentionEvent(type, round * 10 + i + 10)));
      expect(flood.status).toBe(200);
      expect(flood.body.actions).toBeUndefined();
      expect(flood.body.attemptFinalized).toBeUndefined();
    }

    expect(await ProctoringViolation.countDocuments({})).toBe(0);
    const session = await ProctoringSession.findById(started.sessionId);
    expect(session.riskScore).toBe(0);
    expect(session.violationsCount || 0).toBe(0);
    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.status).toBe('in_progress');

    // Stored honestly as probabilistic cv observations with the provenance.
    const stored = await ProctoringEvent.find({ session: started.sessionId }).lean();
    expect(stored).toHaveLength(24);
    expect(stored.every((e) => e.category === 'cv_observation')).toBe(true);
    expect(stored.every((e) => e.confidence === 0.82)).toBe(true);
    expect(stored.every((e) => e.severity === 'info')).toBe(true); // record-only label
    expect(stored.every((e) => e.metadata.basis === 'head_pose')).toBe(true);

    // Replays stay duplicates and never re-evaluate into anything.
    const replay = await postEvents(firstBatch);
    expect(replay.status).toBe(200);
    expect(replay.body.accepted).toBe(0);
    expect(replay.body.duplicates).toHaveLength(4);
    expect(replay.body.actions).toBeUndefined();
  });

  it('a missing confidence on an attention event is rejected (probabilistic rules)', async () => {
    const res = await postEvents([{
      type: 'HEAD_POSE_EXTREME', source: 'cv',
      openedAt: Date.now() - 30_000, closedAt: Date.now() - 22_000,
      idempotencyKey: `att5-noc-${Date.now()}`, clientSeq: 0,
      metadata: { basis: 'head_pose' },
    }]);
    expect(res.status).toBe(400);
  });
});

describe('Phase 8 §32 AC-3 — attention_disabled accommodation end-to-end', () => {
  let admin;
  let student;
  let quiz;

  beforeEach(async () => {
    await db.clearDatabase();
    resetPrecheckRateLimits();
    resetProctoringEventRateLimits();
    mockAiProctoringFlag = true;
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    const subject = await createSubject('Accommodation');

    const questions = [];
    for (let i = 0; i < 2; i += 1) {
      questions.push(await QuestionBank.create({
        subject: subject._id, topicName: 'Acc', subtopicName: 'Mod',
        system: 'Access', questionType: 'mcq_single', difficulty: 'medium',
        question: `Acc Q ${i}`, options: ['A', 'B', 'C', 'D'], correctAnswer: 1,
      }));
    }
    quiz = await Quiz.create({
      title: `AC-3 Quiz ${Date.now()}`,
      subject: subject._id, testType: 'daily', duration: 20,
      questions: questions.map((q) => q._id),
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
      proctoring: { enabled: true },
    });
    await setProctoringEnabled(true, admin.user._id);
  });

  const grantOverride = (body) =>
    request(app)
      .post('/api/quizzes/proctoring-overrides')
      .set('Authorization', `Bearer ${admin.token}`)
      .send(body);

  /** Full real path: override CRUD → precheck → consent → /start. */
  const startWithOverride = async (overrideBody) => {
    const granted = await grantOverride(overrideBody);
    expect(granted.status).toBe(201);
    const pre = await request(app)
      .post(`/api/quizzes/${quiz._id}/proctoring/precheck-report`)
      .set('Authorization', `Bearer ${student.token}`)
      .send(reportWith(BASELINE));
    expect(pre.status).toBe(200);
    const consent = await request(app)
      .post(`/api/quizzes/${quiz._id}/proctoring/consent`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ precheckToken: pre.body.precheckToken, consentTextVersion: '2026-09-v1', surface: 'app-android' });
    expect(consent.status).toBe(200);
    const start = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ precheckToken: pre.body.precheckToken });
    expect(start.status).toBe(201);
    return start;
  };

  const postBatch = (events) =>
    request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${startWithOverride.attemptId}/proctoring/events`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ sessionId: startWithOverride.sessionId, heartbeat: true, events });

  it('an attention_disabled override created via the real CRUD route disables attention in the frozen policy', async () => {
    const start = await startWithOverride({
      studentId: student.user._id,
      reasonCode: 'attention_disabled',
    });
    // Locked in jest (the verify script asserts it too — now both channels).
    expect(start.body.proctoringPolicy.attention.enabled).toBe(false);
    // Mode stays D6-locked even under the accommodation.
    expect(start.body.proctoringPolicy.attention.mode).toBe('record');
  });

  it('stray ATTENTION_* events under an attention_disabled snapshot are stored but provably inert (D6), while the focus ladder still walks', async () => {
    const start = await startWithOverride({
      studentId: student.user._id,
      reasonCode: 'attention_disabled',
    });
    startWithOverride.attemptId = start.body.attemptId;
    startWithOverride.sessionId = start.body.proctoringSessionId;

    // A buggy or hostile client keeps emitting attention events — the server
    // accepts and stores them (rejecting the batch would endanger the same
    // batch's focus events) but they can never act.
    const attentionTypes = [
      'HEAD_POSE_EXTREME', 'HEAD_POSE_REPEATED',
      'ATTENTION_DEVIATION_SUSTAINED', 'ATTENTION_DEVIATION_REPEATED',
    ];
    const stray = await postBatch(attentionTypes.map((type, i) => ({
      type, source: 'cv',
      openedAt: Date.now() - 40_000 + i * 1000,
      closedAt: Date.now() - 32_000 + i * 1000,
      confidence: 0.9,
      idempotencyKey: `ac3-att-${i}-${Math.random().toString(36).slice(2, 8)}`,
      clientSeq: i,
      metadata: { basis: 'head_pose', calibration: 'captured' },
    })));
    expect(stray.status).toBe(200);
    expect(stray.body.accepted).toBe(4);
    expect(stray.body.actions).toBeUndefined();

    // Meanwhile the focus ladder walks EXACTLY as without the accommodation:
    // default tolerance 3 → WARN ×3, then FINAL_WARN on the 4th episode.
    const focusKinds = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await postBatch([{
        type: 'APP_BACKGROUND', source: 'os',
        openedAt: Date.now() - 30_000, closedAt: Date.now() - 27_000,
        idempotencyKey: `ac3-focus-${i}-${Math.random().toString(36).slice(2, 8)}`,
        clientSeq: 10 + i,
        metadata: { pattern: 'single' },
      }]);
      expect(res.status).toBe(200);
      expect(res.body.actions).toHaveLength(1);
      focusKinds.push(res.body.actions[0].kind);
    }
    expect(focusKinds).toEqual(['WARN', 'WARN', 'WARN', 'FINAL_WARN']);

    // Consequences exist ONLY for focus.loss.
    const violations = await ProctoringViolation.find({ session: startWithOverride.sessionId });
    expect(violations).toHaveLength(4);
    expect(violations.every((v) => v.ruleId === 'focus.loss')).toBe(true);

    // Risk: the attention row contributes exactly zero (D6), focus rows do not.
    const session = await ProctoringSession.findById(startWithOverride.sessionId);
    const attentionRow = (session.riskBreakdown || []).find((row) => row.input === 'attentionEvent');
    expect(attentionRow).toMatchObject({ events: 4, points: 0, contribution: 0 });

    // Stored attention events carry no action stamp — stored-inert.
    const storedAttention = await ProctoringEvent.find({
      session: startWithOverride.sessionId, type: { $in: attentionTypes },
    });
    expect(storedAttention).toHaveLength(4);
    expect(storedAttention.every((e) => !e.actionTaken)).toBe(true);

    // Timeline keeps the attention rows visible (stored-inert, NOT filtered —
    // the locked Phase 8 decision) alongside the focus warnings.
    const timeline = await request(app)
      .get(`/api/quizzes/attempt/${startWithOverride.attemptId}/proctoring/timeline`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(timeline.status).toBe(200);
    const timelineTypes = timeline.body.timeline.events.map((e) => e.type);
    expect(timelineTypes).toEqual(expect.arrayContaining(attentionTypes));
    expect(timelineTypes).toContain('WARNING_DELIVERED');
    const attentionRows = timeline.body.timeline.events.filter(
      (e) => attentionTypes.includes(e.type)
    );
    expect(attentionRows.every((e) => e.category === 'cv_observation')).toBe(true);
  });

  it('a relaxed_thresholds override freezes the merged deviation threshold into the session policy', async () => {
    const start = await startWithOverride({
      studentId: student.user._id,
      reasonCode: 'relaxed_thresholds',
      overrides: { thresholds: { deviation: { deg: 50 } } },
    });
    // Attention stays ENABLED (this accommodation relaxes, never disables).
    expect(start.body.proctoringPolicy.attention.enabled).toBe(true);
    // Merge semantics (locked here): the override replaces the deviation
    // SECTION, so an override naming only deg carries only deg into the
    // frozen snapshot. Effective client behavior is unchanged regardless —
    // resolveAttentionThresholds resolves every leaf with ?? default, so the
    // student still gets deg 50 + the default 4000 ms sustain.
    expect(start.body.proctoringPolicy.attention.thresholds.deviation)
      .toEqual({ deg: 50 });
  });
});

// ---------- Phase 9.1 — attention 'warn' opt-in (3-look-away advisory) ----------
//
// The D6 guarantee above holds for the DEFAULT policy. This block pins the
// sole carve-out: a quiz authored with attention.mode 'warn' gets ONE
// advisory WARN banner per HEAD_POSE_REPEATED marker (the client's
// 3rd-qualifying-occurrence signal) — never a violation, never risk, never
// auto-submit. HEAD_POSE_TURNED (the per-occurrence events) stay inert so
// occurrences 1 and 2 are silent.

describe('Phase 9.1 — attention warn opt-in: advisory banner, never consequences', () => {
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
    const subject = await createSubject('Physiology');
    const questions = [];
    for (let i = 0; i < 2; i += 1) {
      questions.push(await QuestionBank.create({
        subject: subject._id, topicName: 'Neuro', subtopicName: 'Reflexes',
        system: 'Neural', questionType: 'mcq_single', difficulty: 'medium',
        question: `Q ${i}`, options: ['A', 'B', 'C', 'D'], correctAnswer: 1,
      }));
    }
    quiz = await Quiz.create({
      title: `Warn Quiz ${Date.now()}`,
      subject: subject._id, testType: 'daily', duration: 20,
      questions: questions.map((q) => q._id),
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
      proctoring: {
        enabled: true,
        focusEvents: { mode: 'record' }, // isolate the attention advisory
        multipleFaces: { mode: 'record' },
        facePresence: { mode: 'record' },
        attention: { mode: 'warn' },
      },
    });
    await setProctoringEnabled(true, admin.user._id);

    const pre = await request(app)
      .post(`/api/quizzes/${quiz._id}/proctoring/precheck-report`)
      .set('Authorization', `Bearer ${student.token}`)
      .send(reportWith(BASELINE));
    expect(pre.status).toBe(200);
    await request(app)
      .post(`/api/quizzes/${quiz._id}/proctoring/consent`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ precheckToken: pre.body.precheckToken, consentTextVersion: '2026-09-v1', surface: 'app-android' });
    const start = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ precheckToken: pre.body.precheckToken });
    expect(start.status).toBe(201);
    expect(start.body.proctoringPolicy.attention.mode).toBe('warn');
    started = { attemptId: start.body.attemptId, sessionId: start.body.proctoringSessionId };
  });

  const postEvents = (events) =>
    request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${started.attemptId}/proctoring/events`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ sessionId: started.sessionId, heartbeat: true, events });

  const occurrence = (i) => ({
    type: 'HEAD_POSE_TURNED', source: 'cv',
    openedAt: Date.now() - 90_000 + i * 5000,
    closedAt: Date.now() - 90_000 + i * 5000 + 2600,
    confidence: 0.8,
    idempotencyKey: `p91-turned-${i}-${Math.random().toString(36).slice(2, 8)}`,
    clientSeq: i,
    metadata: {
      basis: 'head_pose', calibration: 'captured', durationMs: 2600,
      peakAngleDeg: 38.5, thresholds: { turnedDeg: 25, minEpisodeMs: 2000 },
    },
  });

  const marker = (i) => ({
    type: 'HEAD_POSE_REPEATED', source: 'cv',
    openedAt: Date.now() - 90_000 + i * 5000,
    closedAt: Date.now() - 90_000 + i * 5000 + 20000,
    confidence: 0.8,
    idempotencyKey: `p91-repeated-${i}-${Math.random().toString(36).slice(2, 8)}`,
    clientSeq: i,
    metadata: {
      basis: 'head_pose', calibration: 'captured', durationMs: 20000,
      episodes: 3, thresholds: { minEpisodes: 3, minEpisodeMs: 2000, windowMs: 300000 },
    },
  });

  it('occurrences 1 and 2 are stored silently; the 3rd-occurrence marker warns — advisory only', async () => {
    // Occurrences 1 and 2: recorded, no action.
    const first = await postEvents([occurrence(0), occurrence(1)]);
    expect(first.status).toBe(200);
    expect(first.body.accepted).toBe(2);
    expect(first.body.actions).toBeUndefined();

    // 3rd occurrence + its window marker: ONE advisory WARN.
    const third = await postEvents([occurrence(2), marker(3)]);
    expect(third.status).toBe(200);
    expect(third.body.accepted).toBe(2);
    expect(third.body.actions).toHaveLength(1);
    expect(third.body.actions[0]).toMatchObject({ kind: 'WARN', code: 'warn.headTurn' });
    expect(third.body.attemptFinalized).toBeUndefined();

    // Advisory ONLY: no violations, no risk, attempt untouched.
    expect(await ProctoringViolation.countDocuments({})).toBe(0);
    const session = await ProctoringSession.findById(started.sessionId);
    expect(session.violationsCount || 0).toBe(0);
    expect(session.riskScore).toBe(0);
    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.status).toBe('in_progress');

    // The warning delivery is recorded as a system event tied to the warnId.
    const warnings = await ProctoringEvent.find({
      session: started.sessionId, type: 'WARNING_DELIVERED',
    }).lean();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].idempotencyKey).toBe(third.body.actions[0].warnId);
    expect(warnings[0].metadata.code).toBe('warn.headTurn');
  });

  it('a replayed marker batch never re-warns (idempotent delivery)', async () => {
    const batch = [occurrence(0), marker(1)];
    const first = await postEvents(batch);
    expect(first.body.actions).toHaveLength(1);
    const replay = await postEvents(batch);
    expect(replay.status).toBe(200);
    expect(replay.body.accepted).toBe(0);
    expect(replay.body.duplicates).toHaveLength(2);
    expect(replay.body.actions).toBeUndefined();
    expect(await ProctoringEvent.countDocuments({
      session: started.sessionId, type: 'WARNING_DELIVERED',
    })).toBe(1);
  });

  it('a flood of markers warns per marker but NEVER escalates to violation/submit', async () => {
    for (let round = 0; round < 6; round += 1) {
      const res = await postEvents([marker(10 + round)]);
      expect(res.status).toBe(200);
      if (res.body.actions) {
        expect(res.body.actions).toHaveLength(1);
        expect(res.body.actions[0].kind).toBe('WARN');
      }
      expect(res.body.attemptFinalized).toBeUndefined();
    }
    expect(await ProctoringViolation.countDocuments({})).toBe(0);
    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.status).toBe('in_progress');
  });
});
