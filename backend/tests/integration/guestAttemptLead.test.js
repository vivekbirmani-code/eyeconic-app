const request = require('supertest');
const mongoose = require('mongoose');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const GuestAttempt = require('../../models/GuestAttempt');
const Guest = require('../../models/Guest');
const { resetGuestOtpRateLimits } = require('../../middleware/guestOtpRateLimit');

const sentOtps = [];
jest.mock('../../utils/mailer', () => ({
  ...jest.requireActual('../../utils/mailer'),
  sendGuestQuizOtpMail: jest.fn(async (email, otp) => {
    sentOtps.push({ email, otp });
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

// Same-subject duplicate stems are rejected by the API now — default to a unique stem; explicit question overrides still win.
let questionSeed = 0;

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
question: `Auto question #${++questionSeed}?`,
      options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
      correctAnswer: 1,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body;
}

async function setupPublicQuiz(admin, subject, { sections = null, shareSolution = undefined } = {}) {
  const questions = [];
  // Unique stems per setup call — same-subject duplicate text is rejected now.
  for (let i = 0; i < 3; i++) {
    questions.push(await createQuestion(admin, subject, { question: `Attempt lead Q${++questionSeed}-${i}` }));
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
async function verifyLead(quiz, { name = 'Rahul Sharma', email = 'rahul.sharma@example.com', phone = '+919876543210', consent = true } = {}) {
  const payload = { name, email, phone, marketingConsent: consent };
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
    expect(stored.guestEmail).toBe('rahul.sharma@example.com');
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

  it('resumes a SECTION-LOCKED attempt from a different device (expiry sync keys on the attempt)', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject, { sections: true });
    const { guestToken } = await verifyLead(quiz);

    const start1 = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: 'device-1' });
    expect(start1.status).toBe(201);
    const attemptId = start1.body.attempt._id;

    // Regression: the resume-path expiry sync once filtered by the CALLER's
    // guestId, so a cross-device resume found nothing and reported the
    // in-progress attempt as ended.
    const start2 = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: 'device-2' });
    expect(start2.status).toBe(200);
    expect(start2.body.attemptFinalized).toBeUndefined();
    expect(start2.body.attempt._id).toBe(attemptId);
    expect(start2.body.attempt.sectionStates).toHaveLength(1);

    // Cross-device continue: submit section A from device-2, then resume on
    // device-3 — must land in section B, never "ended" and never restarted.
    const sectionSubmit = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/sections/0/submit`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: 'device-2', attemptId, answers: [guestAnswer(0, questions[0]._id, 1)] });
    expect(sectionSubmit.status).toBe(200);

    const start3 = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: 'device-3' });
    expect(start3.status).toBe(200);
    expect(start3.body.attemptFinalized).toBeUndefined();
    expect(start3.body.attempt._id).toBe(attemptId);
    const active = start3.body.attempt.sectionStates.find((s) => s.status === 'in_progress');
    expect(active.index).toBe(1);
  });

  it('converges concurrent starts (race/two tabs) onto a single surviving attempt', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject, { sections: true });
    const { guestToken } = await verifyLead(quiz);

    // Five parallel starts — two browser tabs, a double-tap, and StrictMode's
    // dev double-mount all produce this shape. Every response must name the
    // SAME attempt and exactly one may survive.
    const responses = await Promise.all([1, 2, 3, 4, 5].map((n) =>
      request(app)
        .post(`/api/public/quiz/${quiz.shareToken}/start`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ guestId: `race-device-${n}` })
    ));
    responses.forEach((res) => expect(res.status).toBeLessThan(400));

    const attemptIds = new Set(responses.map((r) => r.body.attempt?._id).filter(Boolean));
    expect(attemptIds.size).toBe(1);
    expect(await GuestAttempt.countDocuments({ quiz: quiz._id, status: 'in_progress' })).toBe(1);

    // The survivor is usable: its section state is intact.
    const survivor = await GuestAttempt.findOne({ quiz: quiz._id, status: 'in_progress' });
    expect(survivor.sectionStates).toHaveLength(1);
    expect(survivor.sectionStates[0].status).toBe('in_progress');
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
    const { guestToken: tokenB } = await verifyLead(quiz, { name: 'Amit Kumar', email: 'amit.kumar@example.com', phone: '+919876543211' });

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

  it('REFUSES anonymous starts (mandatory OTP, D-P1) but pre-policy attempts stay device-operable', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);

    // Since the mandatory-verification policy (owner decision D-P1,
    // 2026-10-23) every NEW public attempt requires a verified lead —
    // enforced server-side with the actionable web-redirect payload.
    const start = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .send({ guestId: 'anon-device' });
    expect(start.status).toBe(401);
    expect(start.body.code).toBe('GUEST_VERIFICATION_REQUIRED');
    expect(start.body.webUrl).toContain(`/public-quiz/${quiz.shareToken}`);
    expect(await GuestAttempt.countDocuments({ quiz: quiz._id })).toBe(0);

    // Transition policy: attempts created BEFORE the policy (seeded here as
    // pre-policy rows) keep working through the device-keyed write routes.
    const legacy = await GuestAttempt.create({
      quiz: quiz._id,
      guestId: 'anon-device',
      guest: null,
      totalQuestions: questions.length,
      totalMarks: questions.length * 4,
      startTime: new Date(),
      answers: questions.map((q, i) => ({
        questionIndex: i, questionId: q._id, selectedAnswer: -1, isCorrect: false, markedForReview: false, timeSpent: 0,
      })),
    });

    const save = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/save-progress`)
      .send({ guestId: 'anon-device', attemptId: legacy._id, answers: [guestAnswer(0, questions[0]._id, 1)] });
    expect(save.status).toBe(200);

    const submit = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .send({ guestId: 'anon-device', attemptId: legacy._id, answers: [guestAnswer(0, questions[0]._id, 1)] });
    expect(submit.status).toBe(200);

    const stored = await GuestAttempt.findById(legacy._id);
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
      const { guestToken: tokenB } = await verifyLead(quiz, { name: 'Amit Kumar', email: 'amit.kumar@example.com', phone: '+919876543211' });

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

  describe('concurrent-start uniqueness (one live attempt per owner)', () => {
    // Regression (Oct 2026): /start's check-then-create raced under load —
    // five parallel starts could leave 2-3 live attempts for one person,
    // bouncing progress between resumes (exposed by the full parallel test
    // suite; passed 12/12 in isolation). Uniqueness is now atomic at the DB
    // layer (unique partial indexes on GuestAttempt), and losing racers
    // converge on the winner through the duplicate-key path.

    it('enforces one live attempt per LEAD at the DB layer (unique partial index)', async () => {
      const { quiz } = await setupPublicQuiz(admin, subject);
      const { guestToken, lead } = await verifyLead(quiz);

      const start = await request(app)
        .post(`/api/public/quiz/${quiz.shareToken}/start`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ guestId: 'device-1' });
      expect(start.status).toBe(201);

      // Same lead on ANY device — a second live row is rejected no matter
      // which code path builds it.
      await expect(
        GuestAttempt.create({ quiz: quiz._id, guestId: 'device-racer', guest: lead._id })
      ).rejects.toMatchObject({ code: 11000 });

      // History never blocks a fresh start: finalized rows leave the
      // partial index.
      await GuestAttempt.updateOne(
        { quiz: quiz._id, guest: lead._id, status: 'in_progress' },
        { $set: { status: 'completed' } }
      );
      const again = await GuestAttempt.create({ quiz: quiz._id, guestId: 'device-2', guest: lead._id });
      expect(again.status).toBe('in_progress');
    });

    it('enforces one live ANONYMOUS attempt per device+quiz while lead/anonymous rows coexist', async () => {
      const { quiz } = await setupPublicQuiz(admin, subject);
      const { lead } = await verifyLead(quiz);

      await GuestAttempt.create({ quiz: quiz._id, guestId: 'anon-dev' });
      await expect(
        GuestAttempt.create({ quiz: quiz._id, guestId: 'anon-dev' })
      ).rejects.toMatchObject({ code: 11000 });
      // Different device on the same quiz — fine.
      await GuestAttempt.create({ quiz: quiz._id, guestId: 'anon-dev-2' });
      // A lead attempt alongside the anonymous row on the same device —
      // independent keys by design (the lead's resume adopts the anon row).
      const alongside = await GuestAttempt.create({ quiz: quiz._id, guestId: 'anon-dev', guest: lead._id });
      expect(alongside.status).toBe('in_progress');
    });

    it('a losing racer of the unique-slot race converges on the winner (resume answer, no second attempt)', async () => {
      const { quiz } = await setupPublicQuiz(admin, subject);
      const { guestToken, lead } = await verifyLead(quiz);

      // Deterministic replay of the micro-race: this racer's resume lookup
      // found nothing, but another racer's insert wins the unique slot while
      // this one is in flight — Mongo answers E11000 on save.
      const winnerId = new mongoose.Types.ObjectId();
      const saveSpy = jest
        .spyOn(GuestAttempt.prototype, 'save')
        .mockImplementationOnce(async function () {
          // The winning racer's row lands first (native insert bypasses
          // the spy)…
          await GuestAttempt.collection.insertOne({
            _id: winnerId,
            quiz: quiz._id,
            guestId: 'racer-winner-device',
            guest: new mongoose.Types.ObjectId(lead._id),
            guestName: 'Rahul Sharma',
            guestEmail: 'rahul.sharma@example.com',
            guestPhone: '+919876543210',
            status: 'in_progress',
            startTime: new Date(),
            durationDeadline: new Date(Date.now() + 10 * 60 * 1000),
            createdAt: new Date(),
            updatedAt: new Date(),
            answers: [],
            totalQuestions: 3,
            totalMarks: 12,
            score: 0,
            marksObtained: 0,
            tabSwitchCount: 0,
          });
          // …then this racer's save is rejected by the unique index.
          const error = new Error(
            'E11000 duplicate key error collection: test.guestattempts index: guest_attempt_live_lead_unique_1'
          );
          error.code = 11000;
          error.codeName = 'DuplicateKey';
          throw error;
        });

      const res = await request(app)
        .post(`/api/public/quiz/${quiz.shareToken}/start`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ guestId: 'race-loser-device' });
      saveSpy.mockRestore();

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Resuming existing attempt');
      expect(String(res.body.attempt._id)).toBe(String(winnerId));
      expect(res.body.lead).toMatchObject({ name: 'Rahul Sharma' });
      expect(await GuestAttempt.countDocuments({ quiz: quiz._id, status: 'in_progress' })).toBe(1);
    });

    it('a losing racer whose winner already finished answers 409 already-attempted (no dead 500)', async () => {
      const { quiz } = await setupPublicQuiz(admin, subject);
      const { guestToken, lead } = await verifyLead(quiz);

      const finishedId = new mongoose.Types.ObjectId();
      const saveSpy = jest
        .spyOn(GuestAttempt.prototype, 'save')
        .mockImplementationOnce(async function () {
          await GuestAttempt.collection.insertOne({
            _id: finishedId,
            quiz: quiz._id,
            guestId: 'racer-winner-device',
            guest: new mongoose.Types.ObjectId(lead._id),
            status: 'completed',
            startTime: new Date(Date.now() - 60 * 1000),
            endTime: new Date(),
            createdAt: new Date(Date.now() - 60 * 1000),
            updatedAt: new Date(),
            answers: [],
            totalQuestions: 3,
            totalMarks: 12,
            score: 3,
            marksObtained: 12,
            tabSwitchCount: 0,
          });
          const error = new Error('E11000 duplicate key error collection: test.guestattempts');
          error.code = 11000;
          error.codeName = 'DuplicateKey';
          throw error;
        });

      const res = await request(app)
        .post(`/api/public/quiz/${quiz.shareToken}/start`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ guestId: 'late-loser-device' });
      saveSpy.mockRestore();

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('QUIZ_ALREADY_ATTEMPTED');
      expect(String(res.body.attemptId)).toBe(String(finishedId));
    });

    it('converges a 12-way concurrent start storm (all devices, one lead) onto a single attempt', async () => {
      const { quiz } = await setupPublicQuiz(admin, subject, { sections: true });
      const { guestToken } = await verifyLead(quiz);

      const responses = await Promise.all(
        Array.from({ length: 12 }, (_, n) =>
          request(app)
            .post(`/api/public/quiz/${quiz.shareToken}/start`)
            .set('Authorization', `Bearer ${guestToken}`)
            .send({ guestId: `storm-device-${n}` })
        )
      );
      responses.forEach((res) => expect(res.status).toBeLessThan(400));

      const attemptIds = new Set(responses.map((r) => r.body.attempt?._id).filter(Boolean));
      expect(attemptIds.size).toBe(1);
      expect(await GuestAttempt.countDocuments({ quiz: quiz._id, status: 'in_progress' })).toBe(1);
    });

    it('converges concurrent LEAD starts (same verified lead, e.g. two tabs) onto a single attempt', async () => {
      const { quiz } = await setupPublicQuiz(admin, subject);
      const { guestToken } = await verifyLead(quiz);

      // Anonymous storms are gone with mandatory OTP (D-P1); the property
      // that must hold is the same one the registered flow guarantees —
      // parallel /start calls under ONE identity (double-tap, two tabs,
      // StrictMode) converge on exactly one live attempt.
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          request(app)
            .post(`/api/public/quiz/${quiz.shareToken}/start`)
            .set('Authorization', `Bearer ${guestToken}`)
            .send({ guestId: 'anon-storm-device' })
        )
      );
      responses.forEach((res) => expect(res.status).toBeLessThan(400));

      const attemptIds = new Set(responses.map((r) => r.body.attempt?._id).filter(Boolean));
      expect(attemptIds.size).toBe(1);
      expect(await GuestAttempt.countDocuments({ quiz: quiz._id, status: 'in_progress' })).toBe(1);
    });
  });
});
