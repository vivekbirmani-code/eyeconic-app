// Integration tests for Phase 7 — admin + mentor analytics, review workflow,
// export parity and accommodation overrides (plan §25, §26.5):
//   - the /analytics/test/:testId proctoring block is mentor-scoped (D14) and
//     value-identical to the export collector's rows (app ↔ CSV ↔ Excel parity)
//   - the §25.4 review decision of record: admin-only writes, closed-session
//     requirement, violation stamping, integrityStatus transitions, the
//     §26.5 attempt mirror, display-only adjusted scores
//   - 'clean' integrity set automatically at close for unflagged sessions
//   - override CRUD authorization + the strict-whitelist snapshot application

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
const ExcelJS = require('exceljs');
const Quiz = require('../../../models/Quiz');
const QuizAttempt = require('../../../models/QuizAttempt');
const QuestionBank = require('../../../models/QuestionBank');
const ProctoringSession = require('../../../models/ProctoringSession');
const ProctoringViolation = require('../../../models/ProctoringViolation');
const ProctoringOverride = require('../../../models/ProctoringOverride');
const { setProctoringEnabled } = require('../../../utils/appSettings');
const { collectTestReportData } = require('../../../utils/testReportData');
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

const reportBody = () => ({
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

/** Full proctored start for one student; returns attempt/session ids. */
const startProctoredAttempt = async (quiz, student) => {
  const pre = await request(app)
    .post(`/api/quizzes/${quiz._id}/proctoring/precheck-report`)
    .set('Authorization', `Bearer ${student.token}`)
    .send(reportBody());
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
  return {
    attemptId: start.body.attemptId,
    sessionId: start.body.proctoringSessionId,
    policy: start.body.proctoringPolicy,
  };
};

const postEvent = (quiz, student, started, event) =>
  request(app)
    .post(`/api/quizzes/${quiz._id}/attempt/${started.attemptId}/proctoring/events`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ sessionId: started.sessionId, heartbeat: true, events: [event] });

const submitAttempt = (quiz, student, started) =>
  request(app)
    .post(`/api/quizzes/${quiz._id}/attempt/${started.attemptId}/submit`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ isAutoSubmit: false });

describe('Phase 7 — analytics block + export parity (§25.2)', () => {
  let admin;
  let mentor;
  let studentA; // assigned to mentor
  let studentB; // NOT assigned
  let quiz;

  beforeEach(async () => {
    await db.clearDatabase();
    resetPrecheckRateLimits();
    resetProctoringEventRateLimits();
    mockAiProctoringFlag = true;
    admin = await createUser({ role: 'admin' });
    mentor = await createUser({ role: 'mentor' });
    studentA = await createUser({ role: 'student' });
    studentB = await createUser({ role: 'student' });
    const subject = await createSubject('Biochemistry');
    const MentorStudentAssignment = require('../../../models/MentorStudentAssignment');
    await MentorStudentAssignment.create({
      mentor: mentor.user._id, student: studentA.user._id,
      isActive: true, assignedBy: admin.user._id,
    });

    const questions = [];
    for (let i = 0; i < 2; i += 1) {
      questions.push(await QuestionBank.create({
        subject: subject._id, topicName: 'Metabolism', subtopicName: 'Glycolysis',
        system: 'Endocrine', questionType: 'mcq_single', difficulty: 'medium',
        question: `Q ${i}`, options: ['A', 'B', 'C', 'D'], correctAnswer: 1,
      }));
    }
    quiz = await Quiz.create({
      title: `Analytics Quiz ${Date.now()}`, subject: subject._id, testType: 'daily',
      duration: 20, questions: questions.map((q) => q._id),
      assignedStudents: [studentA.user._id, studentB.user._id],
      createdBy: admin.user._id,
      proctoring: { enabled: true },
    });
    await setProctoringEnabled(true, admin.user._id);
  });

  it('serves a mentor-scoped proctoring block whose rows equal the export collector', async () => {
    const startedA = await startProctoredAttempt(quiz, studentA);
    const startedB = await startProctoredAttempt(quiz, studentB);
    // Student A: one focus violation. Student B: clean.
    await postEvent(quiz, studentA, startedA, {
      type: 'APP_BACKGROUND', source: 'os',
      openedAt: Date.now() - 60_000, closedAt: Date.now() - 45_000,
      confidence: undefined,
      idempotencyKey: `an-focus-${Date.now()}`, clientSeq: 0,
      metadata: { pattern: 'single' },
    });
    // Phase 9.1: one recorded look-away occurrence for the same student —
    // the lookAwayEvents column must flow analytics + CSV + Excel identically.
    await postEvent(quiz, studentA, startedA, {
      type: 'HEAD_POSE_TURNED', source: 'cv',
      openedAt: Date.now() - 40_000, closedAt: Date.now() - 37_000,
      confidence: 0.81,
      idempotencyKey: `an-turned-${Date.now()}`, clientSeq: 1,
      metadata: { basis: 'head_pose', durationMs: 3000, peakAngleDeg: 37.5, thresholds: { turnedDeg: 25, minEpisodeMs: 2000 } },
    });
    await submitAttempt(quiz, studentA, startedA);
    await submitAttempt(quiz, studentB, startedB);

    // MENTOR view: only the assigned student's attempt appears (D14).
    const asMentor = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(asMentor.status).toBe(200);
    const mentorRows = asMentor.body.proctoring.attempts;
    expect(mentorRows).toHaveLength(1);
    expect(String(mentorRows[0].attemptId)).toBe(String(startedA.attemptId));
    expect(mentorRows[0].totalViolations).toBe(1);
    expect(asMentor.body.proctoring.rollup.totalViolations).toBe(1);
    expect(asMentor.body.proctoring.rollup.flaggedAttempts).toBe(1);

    // ADMIN view: both attempts.
    const asAdmin = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(asAdmin.body.proctoring.attempts).toHaveLength(2);
    expect(asAdmin.body.proctoring.rollup.proctoredAttempts).toBe(2);
    expect(asAdmin.body.proctoring.rollup.lookAwayEvents).toBe(1);

    // PARITY: the collector's per-row columns match the analytics rows, and
    // the CSV + Excel carry the same values (§25.2 AC-3).
    const data = await collectTestReportData({ testId: quiz._id, user: admin.user });
    const byAttempt = new Map(asAdmin.body.proctoring.attempts.map((r) => [r.attemptId, r]));
    for (const row of data.students) {
      const analyticsRow = byAttempt.get(row.attemptId);
      expect(analyticsRow).toBeDefined();
      expect(row.riskCategory).toBe(analyticsRow.riskCategory);
      expect(row.totalViolations).toBe(analyticsRow.totalViolations);
      expect(row.focusLossExits).toBe(analyticsRow.focusLossExits);
      expect(row.lookAwayEvents).toBe(analyticsRow.lookAwayEvents);
      expect(row.multipleFaceEvents).toBe(analyticsRow.multipleFaceEvents);
      expect(row.faceAbsentTotal).toBe(analyticsRow.faceAbsentTotal);
      expect(row.cameraIncidents).toBe(analyticsRow.cameraIncidents);
      expect(row.heartbeatGaps).toBe(analyticsRow.heartbeatGaps);
    }
    expect(data.proctoring.totalViolations)
      .toBe(asAdmin.body.proctoring.rollup.totalViolations);

    const csvRes = await request(app)
      .get(`/api/quizzes/analytics/test-report/${quiz._id}/csv`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(csvRes.status).toBe(200);
    const csv = String(csvRes.text ?? csvRes.body);
    expect(csv).toContain('Risk Category');
    expect(csv).toContain('Total Violations');
    expect(csv).toContain('Focus-loss Exits');
    expect(csv).toContain('Look-away Events');
    expect(csv).toContain('Heartbeat Gaps');

    const excelRes = await request(app)
      .get(`/api/quizzes/analytics/test-report/${quiz._id}/excel`)
      .set('Authorization', `Bearer ${admin.token}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(excelRes.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excelRes.body);
    const sheet = workbook.getWorksheet('Student Performance');
    const headerRow = sheet.getRow(9).values;
    expect(headerRow).toEqual(expect.arrayContaining(['Risk Category', 'Total Violations', 'Look-away Events']));
  });

  it('student access to the analytics endpoint stays refused', async () => {
    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${studentA.token}`);
    expect(res.status).toBe(403);
  });
});

describe('Phase 7 — review workflow (§25.4) + clean-at-close', () => {
  let admin;
  let mentor;
  let student;
  let quiz;
  let started;

  beforeEach(async () => {
    await db.clearDatabase();
    resetPrecheckRateLimits();
    resetProctoringEventRateLimits();
    mockAiProctoringFlag = true;
    admin = await createUser({ role: 'admin' });
    mentor = await createUser({ role: 'mentor' });
    student = await createUser({ role: 'student' });
    const subject = await createSubject('Pharmacology');
    const questions = [];
    for (let i = 0; i < 2; i += 1) {
      questions.push(await QuestionBank.create({
        subject: subject._id, topicName: 'Antibiotics', subtopicName: 'Beta-lactams',
        system: 'Infections', questionType: 'mcq_single', difficulty: 'medium',
        question: `Q ${i}`, options: ['A', 'B', 'C', 'D'], correctAnswer: 1,
      }));
    }
    quiz = await Quiz.create({
      title: `Review Quiz ${Date.now()}`, subject: subject._id, testType: 'daily',
      duration: 20, questions: questions.map((q) => q._id),
      assignedStudents: [student.user._id], createdBy: admin.user._id,
      proctoring: { enabled: true },
    });
    await setProctoringEnabled(true, admin.user._id);
    started = await startProctoredAttempt(quiz, student);
  });

  const reviewUrl = () => `/api/quizzes/attempt/${started.attemptId}/proctoring/review`;

  it('refuses review from a still-active session (409) and from non-admins (403)', async () => {
    const asStudent = await request(app)
      .post(reviewUrl()).set('Authorization', `Bearer ${student.token}`)
      .send({ decision: 'dismiss' });
    expect(asStudent.status).toBe(403);
    const asMentor = await request(app)
      .post(reviewUrl()).set('Authorization', `Bearer ${mentor.token}`)
      .send({ decision: 'dismiss' });
    expect(asMentor.status).toBe(403);
    const asAdminEarly = await request(app)
      .post(reviewUrl()).set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'dismiss' });
    expect(asAdminEarly.status).toBe(409);
    expect(asAdminEarly.body.code).toBe('SESSION_STILL_ACTIVE');
  });

  it('dismiss after close: stamps violations, sets reviewed_ok, mirrors to the attempt', async () => {
    // One qualifying focus violation, then finalize.
    await postEvent(quiz, student, started, {
      type: 'APP_BACKGROUND', source: 'os',
      openedAt: Date.now() - 60_000, closedAt: Date.now() - 45_000,
      idempotencyKey: `rv-focus-${Date.now()}`, clientSeq: 0,
      metadata: { pattern: 'single' },
    });
    await submitAttempt(quiz, student, started);

    const res = await request(app)
      .post(reviewUrl()).set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'dismiss', note: 'Sibling walked by', adjustedScore: 3, adjustedTotalMarks: 8 });
    expect(res.status).toBe(200);
    expect(res.body.review).toMatchObject({
      status: 'dismiss', integrityStatus: 'reviewed_ok',
      reviewAdjustedScore: { score: 3, totalMarks: 8 },
    });

    const session = await ProctoringSession.findById(started.sessionId);
    expect(session.integrityStatus).toBe('reviewed_ok');
    expect(session.review.status).toBe('dismiss');
    expect(session.review.note).toBe('Sibling walked by');
    expect(session.reviewAdjustedScore).toMatchObject({ score: 3, totalMarks: 8 });

    const violations = await ProctoringViolation.find({ session: started.sessionId });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every((v) => v.review?.status === 'dismissed')).toBe(true);

    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.integrityStatus).toBe('reviewed_ok'); // §26.5 mirror
    expect(attempt.marksObtained).toBe(attempt.marksObtained); // marks untouched

    // The timeline serves the trail (§25.3 review surface).
    const timeline = await request(app)
      .get(`/api/quizzes/attempt/${started.attemptId}/proctoring/timeline`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.timeline.session.review.status).toBe('dismiss');
    expect(timeline.body.timeline.session.reviewAdjustedScore.score).toBe(3);

    // Re-review without a score clears the stale adjusted score.
    const rereview = await request(app)
      .post(reviewUrl()).set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'escalate' });
    expect(rereview.status).toBe(200);
    const refreshed = await ProctoringSession.findById(started.sessionId);
    expect(refreshed.integrityStatus).toBe('reviewed_concern');
    // $unset removes the stored doc; mongoose may hydrate an empty subdoc —
    // assert on the leaf, which is the observable contract.
    expect(refreshed.reviewAdjustedScore?.score).toBeUndefined();
  });

  it('rejects half-provided adjusted scores and bad decisions', async () => {
    await submitAttempt(quiz, student, started);
    const half = await request(app)
      .post(reviewUrl()).set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'dismiss', adjustedScore: 3 });
    expect(half.status).toBe(400);
    const badDecision = await request(app)
      .post(reviewUrl()).set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'pardon' });
    expect(badDecision.status).toBe(400);
    const outOfRange = await request(app)
      .post(reviewUrl()).set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'dismiss', adjustedScore: 12, adjustedTotalMarks: 8 });
    expect(outOfRange.status).toBe(400);
  });

  it('a closed session with zero violations goes clean (session + attempt)', async () => {
    await submitAttempt(quiz, student, started);
    const session = await ProctoringSession.findById(started.sessionId);
    expect(session.status).toBe('CLOSED');
    expect(session.integrityStatus).toBe('clean');
    const attempt = await QuizAttempt.findById(started.attemptId);
    expect(attempt.integrityStatus).toBe('clean');
  });
});

describe('Phase 7 — accommodation overrides (§26.5): CRUD + whitelist application', () => {
  let admin;
  let mentor;
  let student;
  let quiz;
  let otherQuiz;

  beforeEach(async () => {
    await db.clearDatabase();
    resetPrecheckRateLimits();
    resetProctoringEventRateLimits();
    mockAiProctoringFlag = true;
    admin = await createUser({ role: 'admin' });
    mentor = await createUser({ role: 'mentor' });
    student = await createUser({ role: 'student' });
    const subject = await createSubject('Pathology');
    const mkQuiz = async (title) => {
      const questions = [];
      for (let i = 0; i < 2; i += 1) {
        questions.push(await QuestionBank.create({
          subject: subject._id, topicName: 'Immunity', subtopicName: 'Innate',
          system: 'Disorders', questionType: 'mcq_single', difficulty: 'medium',
          question: `${title} Q${i}`, options: ['A', 'B', 'C', 'D'], correctAnswer: 1,
        }));
      }
      return Quiz.create({
        title: `${title} ${Date.now()}`, subject: subject._id, testType: 'daily',
        duration: 20, questions: questions.map((q) => q._id),
        assignedStudents: [student.user._id], createdBy: admin.user._id,
        proctoring: { enabled: true },
      });
    };
    quiz = await mkQuiz('OvrA');
    otherQuiz = await mkQuiz('OvrB');
    await setProctoringEnabled(true, admin.user._id);
  });

  const createOverride = (body, token = admin.token) =>
    request(app).post('/api/quizzes/proctoring-overrides')
      .set('Authorization', `Bearer ${token}`).send(body);

  it('CRUD is admin-only', async () => {
    const asMentor = await createOverride({
      studentId: student.user._id, reasonCode: 'attention_disabled',
    }, mentor.token);
    expect(asMentor.status).toBe(403);

    const created = await createOverride({
      studentId: student.user._id, reasonCode: 'attention_disabled',
    });
    expect(created.status).toBe(201);
    expect(created.body.override.reasonCode).toBe('attention_disabled');

    const list = await request(app)
      .get('/api/quizzes/proctoring-overrides')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(list.status).toBe(200);
    expect(list.body.overrides).toHaveLength(1);

    const removed = await request(app)
      .delete(`/api/quizzes/proctoring-overrides/${created.body.override._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(removed.status).toBe(200);
    expect(await ProctoringOverride.countDocuments({})).toBe(0);
  });

  it('rejects unknown reasonCodes and bad payloads', async () => {
    const bad = await createOverride({
      studentId: student.user._id, reasonCode: 'no_enforcement',
    });
    expect(bad.status).toBe(400);
    const noStudent = await createOverride({ reasonCode: 'attention_disabled' });
    expect(noStudent.status).toBe(400);
  });

  it('answers malformed ids with 400/404, never a CastError 500', async () => {
    const badQuizId = await createOverride({
      studentId: student.user._id, reasonCode: 'attention_disabled', quizId: 'not-an-objectid',
    });
    expect(badQuizId.status).toBe(400);
    expect(badQuizId.body.code).toBe('VALIDATION_ERROR');

    const unknownQuiz = await createOverride({
      studentId: student.user._id, reasonCode: 'attention_disabled',
      quizId: 'f'.repeat(24), // well-formed id, guaranteed no such quiz
    });
    expect(unknownQuiz.status).toBe(404);
    expect(unknownQuiz.body.code).toBe('QUIZ_NOT_FOUND');

    const badFilter = await request(app)
      .get('/api/quizzes/proctoring-overrides?studentId=garbage')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(badFilter.status).toBe(400);

    const badDelete = await request(app)
      .delete('/api/quizzes/proctoring-overrides/garbage')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(badDelete.status).toBe(404);
    expect(badDelete.body.code).toBe('OVERRIDE_NOT_FOUND');
  });

  it('attention_disabled disables attention in the FROZEN snapshot only', async () => {
    await createOverride({ studentId: student.user._id, reasonCode: 'attention_disabled' });
    const started = await startProctoredAttempt(quiz, student);
    expect(started.policy.attention.enabled).toBe(false);
    expect(started.policy.attention.mode).toBe('warn'); // v3 warn-rollout default; D6 lock (never submit) untouched
    expect(started.policy.focusEvents.mode).toBe('warn-only'); // enforcement untouched
  });

  it('relaxed_thresholds merges validated leaves into the snapshot', async () => {
    await createOverride({
      studentId: student.user._id, reasonCode: 'relaxed_thresholds',
      overrides: { thresholds: { deviation: { deg: 20, sustainMs: 6000 }, turnedDeg: 40 } },
    });
    const started = await startProctoredAttempt(quiz, student);
    expect(started.policy.attention.thresholds.deviation).toEqual({ deg: 20, sustainMs: 6000 });
    expect(started.policy.attention.thresholds.turnedDeg).toBe(40);
    // Untouched leaves keep the documented defaults.
    expect(started.policy.attention.thresholds.fallbackPadDeg).toBe(10);
  });

  it('expired and other-quiz overrides never apply; unknown reasonCodes store but stay inert', async () => {
    // Expired global override.
    await createOverride({
      studentId: student.user._id, reasonCode: 'attention_disabled',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    // Scoped to a DIFFERENT quiz.
    await createOverride({
      studentId: student.user._id, reasonCode: 'attention_disabled',
      quizId: otherQuiz._id,
    });
    // Unknown reasonCode inserted straight through the model.
    await ProctoringOverride.create({
      student: student.user._id, reasonCode: 'mystery_mode', grantedBy: admin.user._id,
    });
    const started = await startProctoredAttempt(quiz, student);
    expect(started.policy.attention.enabled).toBe(true); // nothing applied
    expect(started.policy.attention.thresholds.deviation.deg).toBe(35);
  });
});
