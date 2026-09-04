const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const GuestAttempt = require('../../models/GuestAttempt');
const Guest = require('../../models/Guest');
const { resetGuestOtpRateLimits } = require('../../middleware/guestOtpRateLimit');

const sentOtps = [];
jest.mock('../../utils/sms', () => ({
  ...jest.requireActual('../../utils/sms'),
  sendGuestOtpSms: jest.fn(async (phone, otp) => {
    sentOtps.push({ phone, otp });
  }),
}));

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

async function createQuestion(admin, subject, overrides = {}) {
  const res = await request(app)
    .post('/api/question-bank')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({
      subject: subject._id.toString(),
      topicName: 'Genetics',
      subtopicName: 'Mendelian Inheritance',
      system: 'Genetic Disorders',
      questionType: 'mcq_single',
      difficulty: 'medium',
      question: 'What is the powerhouse of the cell?',
      options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
      correctAnswer: 1,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body;
}

async function setupPublicQuiz(admin, subject, { sections = null, shareSolution = undefined } = {}) {
  const questions = [];
  for (let i = 0; i < 3; i++) {
    questions.push(await createQuestion(admin, subject, { question: `Attempt lead Q${i}` }));
  }
  const quiz = await Quiz.create({
    title: 'Guest Attempt Lead Test',
    subject: subject._id,
    testType: 'daily',
    duration: 10,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    createdBy: admin.user._id,
    isPublic: true,
    shareToken: `attempt-lead-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...(shareSolution !== undefined ? { shareSolution } : {}),
    ...(sections
      ? {
          sections: [
            { name: 'Section A', duration: 5, selectionType: 'manual', questions: [questions[0]._id, questions[1]._id] },
            { name: 'Section B', duration: 5, selectionType: 'manual', questions: [questions[2]._id] },
          ],
        }
      : {}),
  });
  return { quiz, questions };
}

// Full lead verification through the API — returns { guestToken, lead, guestId }
async function verifyLead(quiz, { name = 'Rahul Sharma', phone = '+919876543210', consent = true } = {}) {
  const payload = { name, phone, marketingConsent: consent };
  await request(app).post(`/api/public/quiz/${quiz.shareToken}/lead/send-otp`).send(payload);
  const otp = sentOtps[sentOtps.length - 1].otp;
  const res = await request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/lead/verify-otp`)
    .send({ ...payload, otp });
  expect(res.status).toBe(200);
  return { guestToken: res.body.guestToken, lead: res.body.guest };
}

const guestAnswer = (questionIndex, questionId, selectedAnswer = 1) => ({
  questionIndex,
  questionId,
  selectedAnswer,
  markedForReview: false,
  timeSpent: 3,
});

describe('Guest attempts with verified leads', () => {
  let admin;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    subject = await createSubject('Pathology');
    sentOtps.length = 0;
    resetGuestOtpRateLimits();
  });

  it('stamps new attempts with the lead ref and name/phone snapshot', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);
    const { guestToken } = await verifyLead(quiz);

    const res = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: 'device-1', deviceInfo: 'test-agent' });

    expect(res.status).toBe(201);
    expect(res.body.lead).toMatchObject({ name: 'Rahul Sharma', phoneMasked: expect.stringContaining('+91') });

    const stored = await GuestAttempt.findById(res.body.attempt._id);
    expect(String(stored.guest)).toBe(String((await Guest.findOne({ phone: '+919876543210' }))._id));
    expect(stored.guestName).toBe('Rahul Sharma');
    expect(stored.guestPhone).toBe('+919876543210');
    void questions;
  });

  it('resumes a lead attempt from a different device via the guest token', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject);
    const { guestToken } = await verifyLead(quiz);

    const start1 = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: 'device-1' });
    expect(start1.status).toBe(201);

    // Different device UUID, same verified lead -> resumes, not a new attempt.
    const start2 = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: 'device-2' });
    expect(start2.status).toBe(200);
    expect(start2.body.message).toBe('Resuming existing attempt');
    expect(start2.body.attempt._id).toBe(start1.body.attempt._id);
    expect(await GuestAttempt.countDocuments({ quiz: quiz._id })).toBe(1);
  });

  it('rejects guest tokens on user-authenticated routes', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject);
    const { guestToken } = await verifyLead(quiz);

    const res = await request(app)
      .get('/api/quizzes/analytics/list')
      .set('Authorization', `Bearer ${guestToken}`);
    expect(res.status).toBe(401);
  });

  it('grades with the quiz mark scheme (+4/-1) and stores sectionPerformance on submit', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);
    const { guestToken } = await verifyLead(quiz);

    const start = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: 'device-1' });
    expect(start.status).toBe(201);
    const attemptId = start.body.attempt._id;

    // 2 correct (index 1), 1 wrong (index 0).
    const submit = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({
        guestId: 'device-1',
        attemptId,
        answers: [
          guestAnswer(0, questions[0]._id, 0), // wrong  -> -1
          guestAnswer(1, questions[1]._id, 1), // correct -> +4
          guestAnswer(2, questions[2]._id, 1), // correct -> +4
        ],
        tabSwitchCount: 1,
        tabSwitchLog: [new Date().toISOString()],
      });
    expect(submit.status).toBe(200);
    expect(submit.body.submitted).toBe(true);
    // Scores are still never returned on the submit channel itself.
    expect(submit.body.score).toBeUndefined();

    const stored = await GuestAttempt.findById(attemptId);
    expect(stored.score).toBe(2);
    expect(stored.marksObtained).toBe(7); // 4+4-1, aligned with registered grading
    expect(stored.sectionPerformance).toHaveLength(1); // single-subject quiz
    expect(stored.sectionPerformance[0]).toMatchObject({ correct: 2, incorrect: 1, skipped: 0 });
  });

  it('denies another lead access to someone else\'s attempt (no oracle)', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject);
    const { guestToken: tokenA } = await verifyLead(quiz, { phone: '+919876543210' });
    resetGuestOtpRateLimits();
    const { guestToken: tokenB } = await verifyLead(quiz, { name: 'Amit Kumar', phone: '+919876543211' });

    const start = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ guestId: 'device-A' });
    const attemptId = start.body.attempt._id;

    const res = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ guestId: 'device-B', attemptId, answers: [] });
    expect(res.status).toBe(404);
  });

  it('keeps the legacy anonymous device-guestId flow working without any token', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);

    const start = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .send({ guestId: 'anon-device' });
    expect(start.status).toBe(201);
    expect(start.body.lead).toBeUndefined();

    const save = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/save-progress`)
      .send({ guestId: 'anon-device', attemptId: start.body.attempt._id, answers: [guestAnswer(0, questions[0]._id, 1)] });
    expect(save.status).toBe(200);

    const submit = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .send({ guestId: 'anon-device', attemptId: start.body.attempt._id, answers: [guestAnswer(0, questions[0]._id, 1)] });
    expect(submit.status).toBe(200);

    const stored = await GuestAttempt.findById(start.body.attempt._id);
    expect(stored.guest).toBeNull();
    expect(stored.guestName).toBeNull();
    expect(stored.score).toBe(1);
  });

  describe('guest result endpoint', () => {
    it('returns the lead\'s own result with solutions when shared', async () => {
      const { quiz, questions } = await setupPublicQuiz(admin, subject);
      const { guestToken } = await verifyLead(quiz);

      const start = await request(app)
        .post(`/api/public/quiz/${quiz.shareToken}/start`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ guestId: 'device-1' });
      const attemptId = start.body.attempt._id;

      await request(app)
        .post(`/api/public/quiz/${quiz.shareToken}/submit`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ guestId: 'device-1', attemptId, answers: [guestAnswer(0, questions[0]._id, 1)] });

      const res = await request(app)
        .get(`/api/public/quiz/${quiz.shareToken}/attempt/${attemptId}/result`)
        .set('Authorization', `Bearer ${guestToken}`)
        .query({ groupBy: 'section' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.summary).toMatchObject({ correct: 1, incorrect: 0, skipped: 2, totalQuestions: 3 });
      expect(res.body.summary.marksObtained).toBe(4);
      expect(res.body.guest).toMatchObject({ name: 'Rahul Sharma', phoneMasked: expect.any(String) });
      expect(res.body.attempt.sectionPerformance.length).toBeGreaterThan(0);
      // Default shareSolution=true -> solutions present.
      expect(res.body.questions.length).toBe(3);
      expect(res.body.questions[0].correctAnswer).toBeDefined();
      expect(res.body.questions[0].explanation).toBeDefined();
      // Student-history aggregations are not included for guests.
      expect(res.body.frequentlyMissedQuestions).toEqual([]);
    });

    it('hides solutions when the quiz does not share them', async () => {
      const { quiz, questions } = await setupPublicQuiz(admin, subject, { shareSolution: false });
      const { guestToken } = await verifyLead(quiz);

      const start = await request(app)
        .post(`/api/public/quiz/${quiz.shareToken}/start`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ guestId: 'device-1' });
      const attemptId = start.body.attempt._id;

      await request(app)
        .post(`/api/public/quiz/${quiz.shareToken}/submit`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ guestId: 'device-1', attemptId, answers: [guestAnswer(0, questions[0]._id, 1)] });

      const res = await request(app)
        .get(`/api/public/quiz/${quiz.shareToken}/attempt/${attemptId}/result`)
        .set('Authorization', `Bearer ${guestToken}`);

      expect(res.status).toBe(200);
      expect(res.body.quiz.shareSolution).toBe(false);
      expect(res.body.questions.every((q) => q.correctAnswer === undefined && q.explanation === undefined)).toBe(true);
    });

    it('404s for other leads, missing auth, wrong link, and in-progress attempts', async () => {
      const { quiz } = await setupPublicQuiz(admin, subject);
      const { guestToken: tokenA } = await verifyLead(quiz, { phone: '+919876543210' });
      resetGuestOtpRateLimits();
      const { guestToken: tokenB } = await verifyLead(quiz, { phone: '+919876543211' });

      const start = await request(app)
        .post(`/api/public/quiz/${quiz.shareToken}/start`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ guestId: 'device-A' });
      const attemptId = start.body.attempt._id;

      // No token.
      expect(
        (await request(app).get(`/api/public/quiz/${quiz.shareToken}/attempt/${attemptId}/result`)).status
      ).toBe(401);
      // Another lead's token.
      expect(
        (
          await request(app)
            .get(`/api/public/quiz/${quiz.shareToken}/attempt/${attemptId}/result`)
            .set('Authorization', `Bearer ${tokenB}`)
        ).status
      ).toBe(404);
      // Still in progress for the owner.
      expect(
        (
          await request(app)
            .get(`/api/public/quiz/${quiz.shareToken}/attempt/${attemptId}/result`)
            .set('Authorization', `Bearer ${tokenA}`)
        ).status
      ).toBe(404);
      // Wrong link for a finalized attempt.
      const { quiz: otherQuiz } = await setupPublicQuiz(admin, subject);
      await request(app)
        .post(`/api/public/quiz/${quiz.shareToken}/submit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ guestId: 'device-A', attemptId, answers: [] });
      expect(
        (
          await request(app)
            .get(`/api/public/quiz/${otherQuiz.shareToken}/attempt/${attemptId}/result`)
            .set('Authorization', `Bearer ${tokenA}`)
        ).status
      ).toBe(404);
    });
  });

  it('works end-to-end for section-locked quizzes with a lead token', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject, { sections: true });
    const { guestToken } = await verifyLead(quiz);

    const start = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: 'device-1' });
    expect(start.status).toBe(201);
    expect(start.body.attempt.sectionLockEnabled).toBe(true);
    const attemptId = start.body.attempt._id;

    const section0 = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/sections/0/submit`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: 'device-1', attemptId, isAutoSubmit: false, answers: [guestAnswer(0, questions[0]._id, 1), guestAnswer(1, questions[1]._id, 0)] });
    expect(section0.status).toBe(200);
    expect(section0.body.nextSection).toMatchObject({ index: 1, name: 'Section B' });

    const section1 = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/sections/1/submit`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: 'device-1', attemptId, isAutoSubmit: false, answers: [guestAnswer(2, questions[2]._id, 1)] });
    expect(section1.status).toBe(200);
    expect(section1.body.attemptFinalized).toBe(true);

    const stored = await GuestAttempt.findById(attemptId);
    expect(stored.status).toBe('completed');
    expect(stored.score).toBe(2);
    expect(stored.marksObtained).toBe(7); // 4 + (-1) + 4
  });
});
