// Integration tests for the Phase 9 admin quiz-level AI Proctoring toggle
// (plan §D): the Create/Edit screens' exact payloads through the real
// authoring endpoints, quiz isolation (one toggle never touches another
// quiz), stored-config safety (silent record-mode, never schema defaults),
// admin-only authorization, global gates overriding the quiz toggle, and the
// admin GET /:id proctoringEligibility status surface.
//
// The aiProctoring feature flag is a hardcoded const in
// config/featureAvailability.js; this suite controls it through a mock so
// flag-on/flag-off precedence is actually exercised (same pattern as
// proctoringFoundation.test.js).

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
const QuestionBank = require('../../../models/QuestionBank');
const { setProctoringEnabled } = require('../../../utils/appSettings');
const AppSettings = require('../../../models/AppSettings');

let app;

// The EXACT payloads the Create/Edit screens send (utils/proctoringToggle.ts
// on the client). Duplicated here on purpose: if the client module ever
// drifts from what these tests prove the backend stores, the copy in the
// test is the tripwire to update.
const ON_PAYLOAD = {
  enabled: true,
  camera: 'optional',
  focusEvents: { mode: 'record' },
  multipleFaces: { mode: 'record' },
  facePresence: { mode: 'record' },
};
const OFF_PAYLOAD = { enabled: false };

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

beforeEach(async () => {
  await db.clearDatabase();
  mockAiProctoringFlag = false;
  await setProctoringEnabled(false, null);
});

async function makeBankQuestions(subject, count = 2) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const q = await QuestionBank.create({
      subject: subject._id,
      topicName: 'Genetics',
      subtopicName: 'Mendelian Inheritance',
      system: 'Genetic Disorders',
      questionType: 'mcq_single',
      difficulty: 'medium',
      question: `Toggle quiz question ${i}`,
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 1,
    });
    ids.push(q._id);
  }
  return ids;
}

const createQuiz = (admin, body) =>
  request(app)
    .post('/api/quizzes/create-from-bank')
    .set('Authorization', `Bearer ${admin.token}`)
    .send(body);

const baseQuizBody = (subject, student, questionIds, overrides = {}) => ({
  title: `Toggle Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  subjects: [subject._id.toString()],
  testType: 'daily',
  duration: 20,
  numberOfQuestions: questionIds.length,
  selectedQuestionIds: questionIds.map(String),
  positiveMarks: 4,
  negativeMarks: 0,
  assignedStudents: [student.user._id.toString()],
  ...overrides,
});

describe('Quiz-level AI Proctoring toggle — authoring + isolation', () => {
  let admin, student, mentor, subject, questionIds;

  beforeEach(async () => {
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    mentor = await createUser({ role: 'mentor' });
    subject = await createSubject();
    questionIds = await makeBankQuestions(subject);
  });

  it('create with the toggle OFF (payload omitted) produces a normal, unproctored quiz', async () => {
    const response = await createQuiz(admin, baseQuizBody(subject, student, questionIds));
    expect([200, 201]).toContain(response.status);

    const stored = await Quiz.findById(response.body.quiz._id);
    expect(stored.proctoring.enabled).toBe(false);

    // The quiz starts as an ordinary quiz: no precheck gate for the student.
    const start = await request(app)
      .post(`/api/quizzes/${stored._id}/start`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect([200, 201]).toContain(start.status);
  });

  it('create with the toggle ON stores exactly the silent-record config (never schema warn defaults)', async () => {
    const response = await createQuiz(admin, baseQuizBody(subject, student, questionIds, { proctoring: ON_PAYLOAD }));
    expect([200, 201]).toContain(response.status);

    const stored = await Quiz.findById(response.body.quiz._id);
    expect(stored.proctoring.enabled).toBe(true);
    expect(stored.proctoring.camera).toBe('optional');
    expect(stored.proctoring.focusEvents.mode).toBe('record'); // NOT the 'warn-then-submit' schema default
    expect(stored.proctoring.multipleFaces.mode).toBe('record');
    expect(stored.proctoring.facePresence.mode).toBe('record');
  });

  it('rejects a bare enabled:true? NO — it is stored but inherits warn defaults, which the UI never sends; validation still applies', async () => {
    // Documents the foot-gun the toggle design exists to prevent: the backend
    // ACCEPTS a bare {enabled:true} (schema defaults apply). The screens send
    // the complete ON_PAYLOAD only (utils/proctoringToggle.ts); this test
    // pins the danger so it stays a conscious decision.
    const response = await createQuiz(admin, baseQuizBody(subject, student, questionIds, { proctoring: { enabled: true } }));
    expect([200, 201]).toContain(response.status);
    const stored = await Quiz.findById(response.body.quiz._id);
    expect(stored.proctoring.focusEvents.mode).toBe('warn-then-submit');
  });

  it('Phase 9.1: attention.mode "warn" round-trips; submit-flavored values are rejected 400', async () => {
    const warn = await createQuiz(admin, baseQuizBody(subject, student, questionIds, {
      proctoring: { enabled: true, camera: 'optional', focusEvents: { mode: 'record' }, attention: { mode: 'warn' } },
    }));
    expect([200, 201]).toContain(warn.status);
    const stored = await Quiz.findById(warn.body.quiz._id);
    expect(stored.proctoring.attention.mode).toBe('warn');

    for (const mode of ['submit', 'warn-then-submit']) {
      const rejected = await createQuiz(admin, baseQuizBody(subject, student, questionIds, {
        proctoring: { enabled: true, attention: { mode } },
      }));
      expect(rejected.status).toBe(400);
      expect(rejected.body.message).toMatch(/attention\.mode/);
    }
  });

  it('editing quiz A ON then OFF never modifies quiz B', async () => {
    const a = await createQuiz(admin, baseQuizBody(subject, student, questionIds, { proctoring: ON_PAYLOAD }));
    const b = await createQuiz(admin, baseQuizBody(subject, student, questionIds, { proctoring: ON_PAYLOAD }));
    const quizA = a.body.quiz._id;
    const quizB = b.body.quiz._id;

    // Turn A OFF.
    const off = await request(app)
      .put(`/api/quizzes/${quizA}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ proctoring: OFF_PAYLOAD });
    expect(off.status).toBe(200);

    const storedA = await Quiz.findById(quizA);
    const storedB = await Quiz.findById(quizB);
    expect(storedA.proctoring.enabled).toBe(false);
    // B keeps its full stored config, field for field.
    expect(storedB.proctoring.enabled).toBe(true);
    expect(storedB.proctoring.camera).toBe('optional');
    expect(storedB.proctoring.focusEvents.mode).toBe('record');
    expect(storedB.proctoring.multipleFaces.mode).toBe('record');
    expect(storedB.proctoring.facePresence.mode).toBe('record');

    // And turning B back OFF leaves A untouched.
    await request(app)
      .put(`/api/quizzes/${quizB}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ proctoring: OFF_PAYLOAD });
    const reReadA = await Quiz.findById(quizA);
    expect(reReadA.proctoring.enabled).toBe(false);
  });

  it('an edit WITHOUT a proctoring payload preserves the stored config (existing quizzes compatible)', async () => {
    const created = await createQuiz(admin, baseQuizBody(subject, student, questionIds, { proctoring: ON_PAYLOAD }));
    const quizId = created.body.quiz._id;

    const edited = await request(app)
      .put(`/api/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ duration: 25 });
    expect(edited.status).toBe(200);

    const stored = await Quiz.findById(quizId);
    expect(stored.proctoring.enabled).toBe(true);
    expect(stored.proctoring.focusEvents.mode).toBe('record');
    expect(stored.duration).toBe(25);
  });

  it('non-admin users cannot change proctoring settings on any authoring endpoint', async () => {
    const created = await createQuiz(admin, baseQuizBody(subject, student, questionIds));
    const quizId = created.body.quiz._id;

    for (const [label, user] of [['student', student], ['mentor', mentor]]) {
      const put = await request(app)
        .put(`/api/quizzes/${quizId}`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ proctoring: ON_PAYLOAD });
      expect(put.status).toBe(403);

      const post = await createQuiz(user, baseQuizBody(subject, student, questionIds, { proctoring: ON_PAYLOAD }));
      expect(post.status).toBe(403);

      const stored = await Quiz.findById(quizId);
      expect(stored.proctoring.enabled).toBe(false);
      expect(`${label} changed nothing`).toBeTruthy();
    }
  });

  it('global gates override the quiz toggle: flag off or kill switch on blocks an ON quiz', async () => {
    const created = await createQuiz(admin, baseQuizBody(subject, student, questionIds, { proctoring: ON_PAYLOAD }));
    const quizId = created.body.quiz._id;

    const asAdmin = () =>
      request(app).get(`/api/quizzes/${quizId}`).set('Authorization', `Bearer ${admin.token}`);

    // Toggle ON, flag OFF → blocked by the flag.
    let detail = await asAdmin();
    expect(detail.status).toBe(200);
    expect(detail.body.proctoringEligibility.enabled).toBe(false);
    expect(detail.body.proctoringEligibility.blockers).toContain('feature_flag_off');

    // Flag ON, kill switch OFF → still blocked, now by the kill switch.
    mockAiProctoringFlag = true;
    detail = await asAdmin();
    expect(detail.body.proctoringEligibility.enabled).toBe(false);
    expect(detail.body.proctoringEligibility.blockers).toContain('global_kill_switch_off');
    expect(detail.body.proctoringEligibility.blockers).not.toContain('feature_flag_off');

    // Flag ON + kill switch ON + toggle ON → eligible.
    await setProctoringEnabled(true, admin.user._id);
    detail = await asAdmin();
    expect(detail.body.proctoringEligibility.enabled).toBe(true);
    expect(detail.body.proctoringEligibility.blockers).toEqual([]);

    // Toggle OFF wins over everything (quiz_config_disabled).
    await request(app)
      .put(`/api/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ proctoring: OFF_PAYLOAD });
    detail = await asAdmin();
    expect(detail.body.proctoringEligibility.enabled).toBe(false);
    expect(detail.body.proctoringEligibility.blockers).toContain('quiz_config_disabled');
  });

  it('admin GET /:id carries proctoring + eligibility; students get neither the field nor the status', async () => {
    const created = await createQuiz(admin, baseQuizBody(subject, student, questionIds, { proctoring: ON_PAYLOAD }));
    const quizId = created.body.quiz._id;
    mockAiProctoringFlag = true;
    await setProctoringEnabled(true, admin.user._id);

    const adminView = await request(app)
      .get(`/api/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(adminView.status).toBe(200);
    expect(adminView.body.proctoring.enabled).toBe(true);
    expect(adminView.body.proctoringEligibility).toEqual({ enabled: true, blockers: [] });

    const studentView = await request(app)
      .get(`/api/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(studentView.status).toBe(200);
    expect(studentView.body.proctoringEligibility).toBeUndefined();
    // Student routing hint present instead (server-driven flow).
    expect(studentView.body.proctoringRequired).toBe(true);
  });

  it('ordinary quiz flow keeps working after a toggle OFF: start → answer → submit → completed', async () => {
    const created = await createQuiz(admin, baseQuizBody(subject, student, questionIds, { proctoring: ON_PAYLOAD }));
    const quizId = created.body.quiz._id;

    // Admin turns it OFF before the student starts.
    await request(app)
      .put(`/api/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ proctoring: OFF_PAYLOAD });

    const start = await request(app)
      .post(`/api/quizzes/${quizId}/start`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect([200, 201]).toContain(start.status);
    const attemptId = start.body.attempt?._id ?? start.body.attemptId;

    const questions = (await Quiz.findById(quizId).populate('questions')).questions;
    const save = await request(app)
      .put(`/api/quizzes/${quizId}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, questionId: String(questions[0]._id), selectedAnswer: 1 });
    expect(save.status).toBe(200);

    const submit = await request(app)
      .post(`/api/quizzes/${quizId}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ isAutoSubmit: false });
    expect([200, 201]).toContain(submit.status);

    const attempts = await QuizAttemptCount(quizId);
    expect(attempts).toBe(1);
  });
});

async function QuizAttemptCount(quizId) {
  const QuizAttempt = require('../../../models/QuizAttempt');
  return QuizAttempt.countDocuments({ quiz: quizId, status: 'completed' });
}
