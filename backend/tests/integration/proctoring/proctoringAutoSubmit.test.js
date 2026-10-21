// Integration tests for the Phase 6 rules engine + warning ladder + policy
// auto-submit (plan §18.4, §20.3, §20.6 — acceptance §29.2): the D3 ladder
// end-to-end (warn ×tolerance → FINAL_WARN → server-executed submit),
// autoSubmitReason recording, replayed batches never re-warning, CV-only
// streams never submitting (D8), attention never acting (D6), section-locked
// policy submits, and racing manual vs policy submits converging (CAS).

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
    { id: 'face_readiness', status: 'PASS', metadata: { frames: 5, agreedFrames: 4, faceCountClass: 'one', visibility: 'ok' } },
    { id: 'network', status: 'PASS' },
  ],
});

/** A qualifying focus-loss episode (≥ the 2000 ms frozen floor). */
const focusEpisode = (i) => ({
  type: 'APP_BACKGROUND',
  source: 'os',
  openedAt: Date.now() - 120_000 + i * 1000,
  closedAt: Date.now() - 120_000 + i * 1000 + 15_000,
  idempotencyKey: `focus-${i}-${Math.random().toString(36).slice(2, 8)}`,
  clientSeq: i,
  metadata: { pattern: 'single' },
});

const attentionEpisode = (i) => ({
  type: i % 2 === 0 ? 'HEAD_POSE_EXTREME' : 'ATTENTION_DEVIATION_SUSTAINED',
  source: 'cv',
  openedAt: Date.now() - 90_000 + i * 1000,
  closedAt: Date.now() - 90_000 + i * 1000 + 8000,
  confidence: 0.8,
  idempotencyKey: `att-${i}-${Math.random().toString(36).slice(2, 8)}`,
  clientSeq: i,
  metadata: { basis: 'head_pose' },
});

describe('Proctoring warning ladder + policy auto-submit (Phase 6)', () => {
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
      title: `AutoSubmit Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
    started = { attemptId: start.body.attemptId, sessionId: start.body.proctoringSessionId };
  });

  const postEvents = (events, extra = {}) =>
    request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${started.attemptId}/proctoring/events`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ sessionId: started.sessionId, heartbeat: true, events, ...extra });

  it('walks the full D3 ladder: WARN ×3 → FINAL_WARN → server-executed auto-submit', async () => {
    // Episodes #1–#3: each warns.
    for (let i = 0; i < 3; i++) {
      const res = await postEvents([focusEpisode(i)]);
      expect(res.status).toBe(200);
      expect(res.body.actions).toHaveLength(1);
      expect(res.body.actions[0]).toMatchObject({ kind: 'WARN', code: 'warn.focus' });
      expect(res.body.attemptFinalized).toBeUndefined();
    }

    const violations = await ProctoringViolation.find({ session: started.sessionId }).sort({ countedAt: 1 });
    expect(violations).toHaveLength(3);
    expect(violations.every((v) => v.ruleId === 'focus.loss')).toBe(true);
    expect(violations.every((v) => v.reliability === 'deterministic')).toBe(true);

    // Each warn left a WARNING_DELIVERED system event with a deterministic key.
    const warnEvents = await ProctoringEvent.find({ session: started.sessionId, type: 'WARNING_DELIVERED' });
    expect(warnEvents).toHaveLength(3);

    // Risk reflects 3 focus violations (30 each, all below the cap).
    const sessionMid = await ProctoringSession.findById(started.sessionId);
    expect(sessionMid.riskScore).toBe(90);
    expect(sessionMid.riskCategory).toBe('critical'); // 81+ band (§19.4)
    expect(sessionMid.violationsCount).toBe(3);

    // Episode #4: FINAL_WARN — never a silent submit.
    const fourth = await postEvents([focusEpisode(3)]);
    expect(fourth.status).toBe(200);
    expect(fourth.body.actions).toHaveLength(1);
    expect(fourth.body.actions[0]).toMatchObject({ kind: 'FINAL_WARN', code: 'warn.final' });
    expect(fourth.body.attemptFinalized).toBeUndefined();
    const attemptMid = await QuizAttempt.findById(started.attemptId);
    expect(attemptMid.status).toBe('in_progress');

    // Episode #5: server auto-submit.
    const fifth = await postEvents([focusEpisode(4)]);
    expect(fifth.status).toBe(200);
    expect(fifth.body.attemptFinalized).toBe(true);
    expect(fifth.body.autoSubmitted).toBe(true);
    expect(fifth.body.session.status).toBe('CLOSED');

    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({
      kind: 'policy',
      ruleId: 'focus.maxViolations',
    });
    expect(Array.isArray(attempt.autoSubmitReason.eventIds)).toBe(true);

    // The decision + the terminal violation are on the timeline.
    const autoEvent = await ProctoringEvent.findOne({ session: started.sessionId, type: 'AUTO_SUBMITTED' });
    expect(autoEvent).toBeTruthy();
    expect(autoEvent.metadata.ruleId).toBe('focus.maxViolations');
    expect(await ProctoringViolation.countDocuments({ session: started.sessionId })).toBe(5);

    // The close hook froze the summary — violations + risk included. Risk
    // caps at 3 scored focus violations (30 each) even with 5 counted.
    const session = await ProctoringSession.findById(started.sessionId);
    expect(session.status).toBe('CLOSED');
    expect(session.summary).toBeTruthy();
    expect(session.summary.violationCount).toBe(5);
    expect(session.summary.violationsByRule['focus.loss']).toBe(5);
    expect(session.riskScore).toBe(90);
  });

  it('never warns on sub-floor blips and replays never re-warn', async () => {
    const blip = await postEvents([{
      type: 'APP_BACKGROUND', source: 'os',
      openedAt: Date.now() - 30_000, closedAt: Date.now() - 29_500,
      idempotencyKey: 'blip-1', clientSeq: 0, metadata: {},
    }]);
    expect(blip.status).toBe(200);
    expect(blip.body.actions).toBeUndefined();
    expect(await ProctoringViolation.countDocuments({})).toBe(0);

    const episode = focusEpisode(10);
    const first = await postEvents([episode]);
    expect(first.body.actions).toHaveLength(1);
    const replay = await postEvents([episode]);
    expect(replay.body.accepted).toBe(0);
    expect(replay.body.duplicates).toEqual([episode.idempotencyKey]);
    expect(replay.body.actions).toBeUndefined(); // no fresh events → no re-warn
    expect(await ProctoringViolation.countDocuments({})).toBe(1);
    expect(await ProctoringEvent.countDocuments({ type: 'WARNING_DELIVERED' })).toBe(1);
  });

  it('an attention-only stream never produces any action or violation (D6)', async () => {
    for (let i = 0; i < 6; i++) {
      const res = await postEvents([attentionEpisode(i)]);
      expect(res.status).toBe(200);
      expect(res.body.actions).toBeUndefined();
    }
    expect(await ProctoringViolation.countDocuments({})).toBe(0);
    const session = await ProctoringSession.findById(started.sessionId);
    expect(session.riskScore).toBe(0);
    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.status).toBe('in_progress');
  });

  it('CV-only streams beyond every threshold warn but never auto-submit (D8)', async () => {
    for (let i = 0; i < 8; i++) {
      const res = await postEvents([{
        type: i % 2 === 0 ? 'MULTIPLE_FACES_DETECTED' : 'FACE_NOT_DETECTED',
        source: 'cv',
        openedAt: Date.now() - 100_000 + i * 2000,
        closedAt: Date.now() - 100_000 + i * 2000 + 20_000,
        confidence: 0.9,
        idempotencyKey: `cv-${i}-${Math.random().toString(36).slice(2, 8)}`,
        clientSeq: i,
        metadata: { basis: 'detection_health', faceCountPeak: 2 },
      }]);
      expect(res.status).toBe(200);
      expect(res.body.attemptFinalized).toBeUndefined();
      if (res.body.actions?.length) {
        expect(res.body.actions[0].kind).toBe('WARN');
      }
    }
    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.status).toBe('in_progress');
  });

  it('racing manual vs policy submits converge to exactly one winner (CAS)', async () => {
    // Warm the ladder to one-past-final (4 violations).
    for (let i = 0; i < 4; i++) {
      await postEvents([focusEpisode(i)]);
    }
    // The terminal batch and a manual submit race.
    const [terminal, manual] = await Promise.all([
      postEvents([focusEpisode(4)]),
      request(app)
        .post(`/api/quizzes/${quiz._id}/attempt/${started.attemptId}/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ isAutoSubmit: false }),
    ]);
    expect(terminal.status).toBe(200);
    expect([200, 400]).toContain(manual.status);

    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(['completed', 'auto_submitted']).toContain(attempt.status);
    // Exactly one terminal state, one closed session, no double finalize.
    const session = await ProctoringSession.findById(started.sessionId);
    expect(session.status).toBe('CLOSED');
    const finals = await ProctoringSession.find({ attempt: started.attemptId });
    expect(finals).toHaveLength(1);
  });

  it('a straggler batch after a finalize cannot warn or submit into the closed session', async () => {
    await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${started.attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ isAutoSubmit: false });
    const straggler = await postEvents([focusEpisode(0)]);
    expect(straggler.status).toBe(409);
    expect(straggler.body.code).toBe('SESSION_NOT_ACTIVE');
    expect(await ProctoringViolation.countDocuments({})).toBe(0);
  });

  it('a section-locked policy submit closes every remaining section', async () => {
    // Replace the seeded quiz with a section-locked variant for a fresh student.
    const student2 = await createUser({ role: 'student' });
    const sectionQuiz = await Quiz.create({
      title: `Sectioned ${Date.now()}`,
      subject: quiz.subject,
      testType: 'daily',
      duration: 20,
      questions: quiz.questions,
      sections: [
        { name: 'A', duration: 10, selectionType: 'manual', questions: [quiz.questions[0]] },
        { name: 'B', duration: 10, selectionType: 'manual', questions: [quiz.questions[1]] },
      ],
      assignedStudents: [student2.user._id],
      createdBy: admin.user._id,
      proctoring: { enabled: true },
    });
    const report = await request(app)
      .post(`/api/quizzes/${sectionQuiz._id}/proctoring/precheck-report`)
      .set('Authorization', `Bearer ${student2.token}`)
      .send(passReport());
    const consent = await request(app)
      .post(`/api/quizzes/${sectionQuiz._id}/proctoring/consent`)
      .set('Authorization', `Bearer ${student2.token}`)
      .send({ precheckToken: report.body.precheckToken, consentTextVersion: '2026-09-v1', surface: 'app-android' });
    const start = await request(app)
      .post(`/api/quizzes/${sectionQuiz._id}/start`)
      .set('Authorization', `Bearer ${student2.token}`)
      .send({ precheckToken: report.body.precheckToken });
    expect(start.status).toBe(201);

    const post = (events) => request(app)
      .post(`/api/quizzes/${sectionQuiz._id}/attempt/${start.body.attemptId}/proctoring/events`)
      .set('Authorization', `Bearer ${student2.token}`)
      .send({ sessionId: start.body.proctoringSessionId, heartbeat: true, events });

    for (let i = 0; i < 4; i++) {
      const res = await post([focusEpisode(i)]);
      expect(res.status).toBe(200);
    }
    const terminal = await post([focusEpisode(4)]);
    expect(terminal.body.attemptFinalized).toBe(true);

    const attempt = await QuizAttempt.findById(start.body.attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.sectionStates.every((s) => s.status !== 'in_progress')).toBe(true);
  });
});

// ---- Phase 9: warn-only focus policy (the owner's warning-path test mode) --

describe('warn-only focus policy (Phase 9): warnings delivered, never auto-submit', () => {
  it('APP_BACKGROUND episodes WARN via batch actions; attempt stays in_progress; events still recorded', async () => {
    await db.clearDatabase();
    resetPrecheckRateLimits();
    resetProctoringEventRateLimits();
    mockAiProctoringFlag = true;
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
        question: `Warn-only question ${i}`,
        options: ['A', 'B', 'C', 'D'],
        correctAnswer: 1,
      }));
    }
    const quiz = await Quiz.create({
      title: `WarnOnly Quiz ${Date.now()}`,
      subject: subject._id,
      testType: 'daily',
      duration: 20,
      questions: questions.map((q) => q._id),
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
      proctoring: {
        enabled: true,
        camera: 'optional',
        focusEvents: { mode: 'warn-only' },
        multipleFaces: { mode: 'record' },
        facePresence: { mode: 'record' },
      },
    });
    await setProctoringEnabled(true, admin.user._id);

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

    // Five qualifying app-away episodes (the owner's home-button test).
    const responses = [];
    for (let i = 0; i < 5; i++) {
      const response = await request(app)
        .post(`/api/quizzes/${quiz._id}/attempt/${start.body.attemptId}/proctoring/events`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ sessionId: start.body.proctoringSessionId, heartbeat: true, events: [focusEpisode(i)] });
      expect(response.status).toBe(200);
      responses.push(response.body);
    }

    const actions = responses.flatMap((body) => body.actions ?? []);
    expect(actions.length).toBeGreaterThan(0);
    // Warn-only walks the FULL visible ladder — WARN × tolerated → FINAL_WARN
    // ("last chance" message) — but the violation action never becomes submit.
    for (const action of actions) {
      expect(['WARN', 'FINAL_WARN']).toContain(action.kind);
    }
    expect(actions.some((a) => a.kind === 'WARN')).toBe(true);
    expect(actions.some((a) => a.kind === 'FINAL_WARN')).toBe(true);
    for (const body of responses) {
      expect(body.attemptFinalized).not.toBe(true);
    }

    const attempt = await QuizAttempt.findById(start.body.attemptId);
    expect(attempt.status).toBe('in_progress'); // nothing was auto-submitted

    // Recording is preserved alongside the warnings.
    const timeline = await request(app)
      .get(`/api/quizzes/attempt/${start.body.attemptId}/proctoring/timeline`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(timeline.status).toBe(200);
    const appAway = (timeline.body.timeline?.events ?? []).filter((e) => e.type === 'APP_BACKGROUND');
    expect(appAway.length).toBe(5);
  });
});
