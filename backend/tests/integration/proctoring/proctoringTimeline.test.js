// Integration tests for the proctoring timeline endpoint (plan §25.3,
// Phase 7-lite): the admin/mentor review surface — access matrix (owner /
// admin / assigned mentor — the D14 rule, backend-enforced), serverAt-ordered
// episode rows, derived violations, system actions, and the frozen summary
// for closed sessions.

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

describe('Proctoring timeline endpoint (Phase 7-lite)', () => {
  let admin;
  let student;
  let mentor;
  let quiz;
  let started;

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
      title: `Timeline Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      subject: subject._id,
      testType: 'daily',
      duration: 20,
      questions: questions.map((q) => q._id),
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
      proctoring: { enabled: true },
    });
    await setProctoringEnabled(true, admin.user._id);
    await MentorStudentAssignment.create({
      mentor: mentor.user._id, student: student.user._id, isActive: true, assignedBy: admin.user._id,
    });

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

  const getTimeline = (user) =>
    request(app)
      .get(`/api/quizzes/attempt/${started.attemptId}/proctoring/timeline`)
      .set('Authorization', `Bearer ${user.token}`);

  const seedLadderEvents = async () => {
    for (let i = 0; i < 4; i++) {
      await request(app)
        .post(`/api/quizzes/${quiz._id}/attempt/${started.attemptId}/proctoring/events`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({
          sessionId: started.sessionId,
          heartbeat: true,
          events: [{
            type: 'APP_BACKGROUND', source: 'os',
            openedAt: Date.now() - 120_000 + i * 1000,
            closedAt: Date.now() - 105_000 + i * 1000,
            idempotencyKey: `tl-${i}`, clientSeq: i, metadata: { pattern: 'single' },
          }],
        });
    }
  };

  it('serves the owner, admins, and the assigned mentor; refuses everyone else', async () => {
    await seedLadderEvents();
    const otherStudent = await createUser({ role: 'student' });
    const otherMentor = await createUser({ role: 'mentor' });

    for (const user of [student, admin, mentor]) {
      const res = await getTimeline(user);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }
    for (const user of [otherStudent, otherMentor]) {
      const denied = await getTimeline(user);
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('FORBIDDEN');
    }
  });

  it('returns serverAt-ordered episode rows with warnings, violations, and live summary', async () => {
    await seedLadderEvents();

    const res = await getTimeline(admin);
    expect(res.status).toBe(200);
    const { timeline } = res.body;
    expect(timeline.session.id).toBe(String(started.sessionId));
    expect(timeline.attemptStatus).toBe('in_progress');

    // Rows: 4 APP_BACKGROUND episodes + 4 WARNING_DELIVERED actions.
    const types = timeline.events.map((e) => e.type);
    expect(types.filter((t) => t === 'APP_BACKGROUND')).toHaveLength(4);
    expect(types.filter((t) => t === 'WARNING_DELIVERED')).toHaveLength(4);
    // serverAt-ordered, never arrival- or client-ordered.
    const serverAts = timeline.events.map((e) => new Date(e.serverAt).getTime());
    expect([...serverAts].sort((a, b) => a - b)).toEqual(serverAts);

    const warn = timeline.events.find((e) => e.type === 'WARNING_DELIVERED');
    expect(warn.metadata.code).toBe('warn.focus');
    expect(warn.metadata.kind).toBe('WARN');

    expect(timeline.violations).toHaveLength(4);
    expect(timeline.violations.every((v) => v.ruleId === 'focus.loss')).toBe(true);
    expect(timeline.summary.violationCount).toBe(4);
    expect(timeline.summary.riskCategory).toBeDefined();
    // Episodes carry no frame payloads — structured rows only (§17.1).
    for (const event of timeline.events) {
      expect(event.confidence === null || event.confidence === undefined || typeof event.confidence === 'number').toBe(true);
    }
  });

  it('serves the FROZEN summary + autoSubmitReason for a policy-closed session', async () => {
    await seedLadderEvents();
    const terminal = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${started.attemptId}/proctoring/events`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({
        sessionId: started.sessionId,
        heartbeat: true,
        events: [{
          type: 'APP_BACKGROUND', source: 'os',
          openedAt: Date.now() - 60_000, closedAt: Date.now() - 45_000,
          idempotencyKey: 'tl-terminal', clientSeq: 4, metadata: { pattern: 'single' },
        }],
      });
    expect(terminal.body.attemptFinalized).toBe(true);

    const res = await getTimeline(mentor);
    expect(res.status).toBe(200);
    const { timeline } = res.body;
    expect(timeline.session.status).toBe('CLOSED');
    expect(timeline.attemptStatus).toBe('auto_submitted');
    expect(timeline.autoSubmitReason).toMatchObject({ kind: 'policy', ruleId: 'focus.maxViolations' });
    expect(timeline.summary.violationCount).toBe(5);
    expect(timeline.summary.integrityStatus).toBe('pending');
    expect(timeline.events.some((e) => e.type === 'AUTO_SUBMITTED')).toBe(true);
  });

  it('answers 400 for non-proctored attempts, 404 unknown ids, null for missing sessions', async () => {
    const student2 = await createUser({ role: 'student' });
    const plainQuiz = await Quiz.create({
      title: 'Plain timeline quiz', subject: quiz.subject, testType: 'daily', duration: 10,
      questions: quiz.questions, assignedStudents: [student2.user._id], createdBy: admin.user._id,
    });
    const plainStart = await request(app)
      .post(`/api/quizzes/${plainQuiz._id}/start`)
      .set('Authorization', `Bearer ${student2.token}`)
      .send({});
    const plain = await request(app)
      .get(`/api/quizzes/attempt/${plainStart.body.attemptId}/proctoring/timeline`)
      .set('Authorization', `Bearer ${student2.token}`);
    expect(plain.status).toBe(400);
    expect(plain.body.code).toBe('PROCTORING_NOT_ENABLED_FOR_QUIZ');

    const missing = await request(app)
      .get('/api/quizzes/attempt/507f1f77bcf86cd799439099/proctoring/timeline')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(missing.status).toBe(404);

    // A snapshot-carrying attempt whose session was deleted self-reports null
    // (no fabrication) rather than erroring.
    await ProctoringSession.deleteOne({ _id: started.sessionId });
    const noSession = await getTimeline(student);
    expect(noSession.status).toBe(200);
    expect(noSession.body.timeline).toBeNull();
  });
});
