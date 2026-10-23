const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const GuestAttempt = require('../../models/GuestAttempt');
const Guest = require('../../models/Guest');
const { resetGuestOtpRateLimits } = require('../../middleware/guestOtpRateLimit');

// One-attempt-per-person restriction for public quizzes: a guest who already
// finished a quiz cannot start it again — enforced server-side at /start
// (the authority), defended at both submit routes (concurrent-start race),
// and surfaced non-blocking at verify-otp (so result re-access still works).

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
      question: `Restriction Q #${++questionSeed}?`,
      options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
      correctAnswer: 1,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body;
}

async function setupPublicQuiz(admin, subject, { sections = null } = {}) {
  const questions = [];
  for (let i = 0; i < 3; i++) {
    questions.push(await createQuestion(admin, subject));
  }
  const quiz = await Quiz.create({
    title: 'Guest Restriction Test',
    subject: subject._id,
    testType: 'daily',
    duration: 10,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    createdBy: admin.user._id,
    isPublic: true,
    shareToken: `restriction-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

async function verifyLead(quiz, { name = 'Rahul Sharma', email = 'rahul.sharma@example.com', phone = '+919876543210', consent = true } = {}) {
  const payload = { name, email, phone, marketingConsent: consent };
  // These tests exercise the attempt restriction, not OTP rate limiting
  // (guestLeadOtp.test.js covers that) — clear the in-memory limiter so
  // back-to-back verifies with the same normalized email aren't 429'd by
  // the production 60 s resend interval.
  resetGuestOtpRateLimits();
  await request(app).post(`/api/public/quiz/${quiz.shareToken}/lead/send-otp`).send(payload);
  const otp = sentOtps[sentOtps.length - 1].otp;
  const res = await request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/lead/verify-otp`)
    .send({ ...payload, otp });
  expect(res.status).toBe(200);
  return { guestToken: res.body.guestToken, lead: res.body.guest, body: res.body };
}

async function startAttempt(quiz, guestToken, guestId = 'device-1') {
  return request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/start`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ guestId, deviceInfo: 'test-agent' });
}

async function submitAttempt(quiz, guestToken, attemptId, questions, guestId = 'device-1') {
  return request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/submit`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({
      guestId,
      attemptId,
      answers: questions.map((q, i) => ({ questionIndex: i, questionId: q._id, selectedAnswer: 1, markedForReview: false, timeSpent: 2 })),
      tabSwitchCount: 0,
      tabSwitchLog: [],
    });
}

describe('Public quiz one-attempt-per-person restriction', () => {
  let admin;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    subject = await createSubject('Pathology');
    sentOtps.length = 0;
    resetGuestOtpRateLimits();
  });

  it('blocks a new attempt after the same lead completed the quiz', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);
    const { guestToken } = await verifyLead(quiz);

    const start = await startAttempt(quiz, guestToken);
    expect(start.status).toBe(201);
    const submitted = await submitAttempt(quiz, guestToken, start.body.attempt._id, questions);
    expect(submitted.status).toBe(200);

    const restart = await startAttempt(quiz, guestToken, 'fresh-device');
    expect(restart.status).toBe(409);
    expect(restart.body.code).toBe('QUIZ_ALREADY_ATTEMPTED');
    expect(restart.body.success).toBe(false);
    expect(restart.body.message).toMatch(/already attempted/i);
    // Same lead -> the existing attempt is exposed so the client can route
    // the guest straight to their result.
    expect(restart.body.attemptId).toBe(start.body.attempt._id);
    // No second attempt row was created.
    expect(await GuestAttempt.countDocuments({ quiz: quiz._id, status: 'in_progress' })).toBe(0);
  });

  it('still resumes an in-progress attempt (no false block mid-quiz)', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject);
    const { guestToken } = await verifyLead(quiz);

    const start = await startAttempt(quiz, guestToken);
    expect(start.status).toBe(201);

    const resume = await startAttempt(quiz, guestToken, 'another-device');
    expect(resume.status).toBe(200);
    expect(resume.body.message).toBe('Resuming existing attempt');
    expect(resume.body.attempt._id).toBe(start.body.attempt._id);
  });

  it('blocks a repeat when the OTP-verified email matches (case-insensitive) — same lead keeps its own result', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);
    const { guestToken } = await verifyLead(quiz);
    const start = await startAttempt(quiz, guestToken);
    await submitAttempt(quiz, guestToken, start.body.attempt._id, questions);

    // Same person, new phone number, tweaked name, different email case —
    // the email-keyed verify resolves to the SAME lead, and the restriction
    // still holds. sameLead => the attempt id is exposed so the client can
    // route them to their own result.
    const second = await verifyLead(quiz, {
      name: 'Rahul S', // tweaked name must not matter
      email: 'RAHUL.SHARMA@example.com',
      phone: '+919812345678',
    });
    expect(String(second.lead._id)).toBe(String((await Guest.findOne({ email: 'rahul.sharma@example.com' }))._id));

    const restart = await startAttempt(quiz, second.guestToken, 'second-device');
    expect(restart.status).toBe(409);
    expect(restart.body.code).toBe('QUIZ_ALREADY_ATTEMPTED');
    expect(restart.body.attemptId).toBe(start.body.attempt._id);
  });

  it('cross-lead email matches (legacy rows) block WITHOUT exposing the other lead\'s attempt id', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);
    const { guestToken } = await verifyLead(quiz);
    const start = await startAttempt(quiz, guestToken);
    await submitAttempt(quiz, guestToken, start.body.attempt._id, questions);

    // Legacy shape: a finalized attempt whose snapshot matches this email
    // but belongs to a DIFFERENT lead (pre-email-keying data). The
    // restriction applies; the id stays private (result route is
    // lead-scoped, so it would be useless to the caller anyway).
    const legacyLead = await Guest.create({
      name: 'Legacy Lead', email: 'legacy.someone@example.com', phone: '+919800000001',
    });
    await GuestAttempt.updateOne(
      { _id: start.body.attempt._id },
      { $set: { guest: legacyLead._id } }
    );
    void questions;

    const second = await verifyLead(quiz, { email: 'rahul.sharma@example.com', phone: '+919899999999' });
    const restart = await startAttempt(quiz, second.guestToken);
    expect(restart.status).toBe(409);
    expect(restart.body.attemptId).toBeUndefined();
  });

  it('matches historical mixed-case email snapshots case-insensitively', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);
    const { guestToken } = await verifyLead(quiz);
    const start = await startAttempt(quiz, guestToken);
    const submitted = await submitAttempt(quiz, guestToken, start.body.attempt._id, questions);
    expect(submitted.status).toBe(200);

    // Simulate a pre-feature row stored before snapshots were normalized.
    await GuestAttempt.updateOne(
      { _id: start.body.attempt._id },
      { $set: { guestEmail: '  Rahul.Sharma@Example.com  ' } }
    );

    const second = await verifyLead(quiz, { email: 'rahul.sharma@example.com', phone: '+919899999999' });
    const restart = await startAttempt(quiz, second.guestToken);
    expect(restart.status).toBe(409);
  });

  it('does NOT fuse household members: same phone, different verified email => a separate person', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);
    const first = await verifyLead(quiz, { email: 'elder.sibling@example.com', phone: '+919876500001' });
    const start = await startAttempt(quiz, first.guestToken);
    await submitAttempt(quiz, first.guestToken, start.body.attempt._id, questions);

    // The younger sibling shares the family phone but has their own verified
    // email — a DIFFERENT person with their own attempt and result. (The
    // phone is unverified contact metadata, never identity.)
    const second = await verifyLead(quiz, { name: 'Younger Sibling', email: 'younger.sibling@example.com', phone: '+919876500001' });
    expect(String(second.lead._id)).not.toBe(String(first.lead._id));

    const fresh = await startAttempt(quiz, second.guestToken);
    expect(fresh.status).toBe(201);
    expect(fresh.body.attempt._id).not.toBe(start.body.attempt._id);

    // And the sibling's token cannot see the first student's result.
    const cross = await request(app)
      .get(`/api/public/quiz/${quiz.shareToken}/attempt/${start.body.attempt._id}/result`)
      .set('Authorization', `Bearer ${second.guestToken}`);
    expect(cross.status).toBe(404);
  });

  it('does NOT block a namesake: same name, different email and phone', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);
    const first = await verifyLead(quiz);
    const start = await startAttempt(quiz, first.guestToken);
    await submitAttempt(quiz, first.guestToken, start.body.attempt._id, questions);

    // A genuinely different student who happens to share the name.
    const second = await verifyLead(quiz, { email: 'other.person@example.com', phone: '+919832222222' });
    const fresh = await startAttempt(quiz, second.guestToken);
    expect(fresh.status).toBe(201);
    expect(await GuestAttempt.countDocuments({ quiz: quiz._id, status: 'in_progress' })).toBe(1);
  });

  it('is scoped per quiz: the same guest may attempt a DIFFERENT public quiz', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);
    const { guestToken } = await verifyLead(quiz);
    const start = await startAttempt(quiz, guestToken);
    await submitAttempt(quiz, guestToken, start.body.attempt._id, questions);

    const other = await setupPublicQuiz(admin, subject);
    // Same verified lead on a new link -> allowed.
    const fresh = await startAttempt(other.quiz, guestToken);
    expect(fresh.status).toBe(201);

    // And blocked once they finish that one too.
    await submitAttempt(other.quiz, guestToken, fresh.body.attempt._id, other.questions);
    const restart = await startAttempt(other.quiz, guestToken);
    expect(restart.status).toBe(409);
  });

  it('refuses the loser of two concurrently-started attempts at submit time', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);

    // The same person can end up with two LIVE attempts through pre-index
    // concurrent-start races (double tab / two tabs — the residue this
    // submit-time defense closes for legacy rows; the unique live-attempt
    // indexes now prevent NEW duplicates, so the state is seeded directly).
    // The duplicate is seeded only after the winner finalizes, because the
    // index forbids two in-progress rows for one (quiz, lead) — the defense
    // under test is stateless and keys on finalized-by-identity at submit
    // time, not on creation order.
    const lead = await verifyLead(quiz, { email: 'shared@example.com', phone: '+919876111111' });
    const attemptA = await startAttempt(quiz, lead.guestToken, 'device-a');
    expect(attemptA.status).toBe(201);

    // A finalizes first and wins.
    const submitA = await submitAttempt(quiz, lead.guestToken, attemptA.body.attempt._id, questions, 'device-a');
    expect(submitA.status).toBe(200);

    const attemptB = await GuestAttempt.create({
      quiz: quiz._id,
      guestId: 'device-b',
      guest: lead.lead._id,
      guestName: lead.lead.name,
      guestEmail: lead.lead.email,
      guestPhone: lead.lead.phone,
      totalQuestions: questions.length,
      totalMarks: 12,
      answers: questions.map((q, i) => ({ questionIndex: i, questionId: q._id, selectedAnswer: -1 })),
    });

    // The duplicate's submit is refused instead of producing a second graded result.
    const submitB = await submitAttempt(quiz, lead.guestToken, attemptB._id, questions, 'device-b');
    expect(submitB.status).toBe(409);
    expect(submitB.body.code).toBe('QUIZ_ALREADY_ATTEMPTED');

    // Exactly one finalized attempt exists; the duplicate stays ungraded.
    const finalized = await GuestAttempt.countDocuments({ quiz: quiz._id, status: { $in: ['completed', 'auto_submitted'] } });
    expect(finalized).toBe(1);

    // The same person cannot start yet another attempt either.
    const restartB = await startAttempt(quiz, lead.guestToken, 'device-b2');
    expect(restartB.status).toBe(409);
  });

  it('keeps replayed submits of an already-finalized attempt idempotent (no 409)', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);
    const { guestToken } = await verifyLead(quiz);
    const start = await startAttempt(quiz, guestToken);
    await submitAttempt(quiz, guestToken, start.body.attempt._id, questions);

    // Network replay / double click AFTER success keeps the historical
    // contract (200 isAlreadySubmitted for section-locked, 400 otherwise) —
    // the duplicate guard only applies to in-progress attempts.
    const replay = await submitAttempt(quiz, guestToken, start.body.attempt._id, questions);
    expect(replay.status).toBe(400);
    expect(replay.body.message).toMatch(/already been submitted/i);
  });

  it('verify-otp reports alreadyAttempted (advisory) after completion and still verifies', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);
    const { guestToken } = await verifyLead(quiz);
    const start = await startAttempt(quiz, guestToken);
    await submitAttempt(quiz, guestToken, start.body.attempt._id, questions);

    // Re-verification must keep succeeding (the guest needs it to view their
    // result) but flags the finished quiz for the client.
    const again = await verifyLead(quiz);
    expect(again.body.success).toBe(true);
    expect(again.body.guestToken).toBeTruthy();
    expect(again.body.alreadyAttempted).toMatchObject({
      code: 'QUIZ_ALREADY_ATTEMPTED',
      attemptId: start.body.attempt._id,
    });

    // Before any attempt exists the flag is absent.
    const other = await setupPublicQuiz(admin, subject);
    const fresh = await verifyLead(other.quiz);
    expect(fresh.body.alreadyAttempted).toBeUndefined();
  });

  it('anonymous devices are unaffected by the lead restriction but can no longer START (D-P1)', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);
    const { guestToken } = await verifyLead(quiz);
    const start = await startAttempt(quiz, guestToken);
    await submitAttempt(quiz, guestToken, start.body.attempt._id, questions);

    // No Authorization header at all: mandatory OTP (D-P1) refuses the
    // anonymous START with the actionable verification payload — a different
    // anonymous device is never affected by the restriction, and nothing
    // is created for it.
    const anon = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .send({ guestId: 'legacy-device', deviceInfo: 'React Native App' });
    expect(anon.status).toBe(401);
    expect(anon.body.code).toBe('GUEST_VERIFICATION_REQUIRED');
    expect(
      await GuestAttempt.countDocuments({ quiz: quiz._id, guestId: 'legacy-device' })
    ).toBe(0);
  });

  it('blocks restart after a section-locked quiz is completed section-by-section', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject, { sections: true });
    const { guestToken } = await verifyLead(quiz);
    const start = await startAttempt(quiz, guestToken);
    expect(start.status).toBe(201);
    const attemptId = start.body.attempt._id;

    const section0 = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/sections/0/submit`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: 'device-1', attemptId, answers: [ { questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 1 } ] });
    expect(section0.status).toBe(200);

    const section1 = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/sections/1/submit`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: 'device-1', attemptId, answers: [ { questionIndex: 2, questionId: questions[2]._id, selectedAnswer: 1 } ] });
    expect(section1.status).toBe(200);
    expect(section1.body.attemptFinalized).toBe(true);

    const restart = await startAttempt(quiz, guestToken);
    expect(restart.status).toBe(409);
    expect(restart.body.attemptId).toBe(attemptId);
  });

  it('refuses a section submit on an in-progress duplicate once the same person finalized elsewhere', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject, { sections: true });

    const lead = await verifyLead(quiz, { email: 'shared@example.com', phone: '+919876111111' });

    // Live attempt A via the API; A completes the whole quiz section-by-
    // section first. The seeded duplicate under the SAME person represents
    // legacy concurrent-start residue (the unique live-attempt indexes now
    // prevent new duplicates, so the row can only be seeded once no other
    // in_progress attempt exists for this (quiz, lead)); the defense under
    // test refuses its NEXT touch regardless of when it was created.
    const attemptA = await startAttempt(quiz, lead.guestToken, 'device-a');
    expect(attemptA.status).toBe(201);

    for (const [index, answers] of [
      [0, [{ questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 1 }]],
      [1, [{ questionIndex: 2, questionId: questions[2]._id, selectedAnswer: 1 }]],
    ]) {
      const res = await request(app)
        .post(`/api/public/quiz/${quiz.shareToken}/sections/${index}/submit`)
        .set('Authorization', `Bearer ${lead.guestToken}`)
        .send({ guestId: 'device-a', attemptId: attemptA.body.attempt._id, answers });
      expect(res.status).toBe(200);
    }

    const attemptB = await GuestAttempt.create({
      quiz: quiz._id,
      guestId: 'device-b',
      guest: lead.lead._id,
      guestName: lead.lead.name,
      guestEmail: lead.lead.email,
      guestPhone: lead.lead.phone,
      totalQuestions: questions.length,
      totalMarks: 12,
      sectionLockEnabled: true,
      sectionDefinitions: [
        { index: 0, name: 'Section A', duration: 5, questionIds: [questions[0]._id, questions[1]._id] },
        { index: 1, name: 'Section B', duration: 5, questionIds: [questions[2]._id] },
      ],
      sectionStates: [
        { index: 0, status: 'in_progress', startedAt: new Date(), endsAt: new Date(Date.now() + 5 * 60 * 1000) },
        { index: 1, status: 'in_progress', startedAt: null, endsAt: null },
      ],
      answers: questions.map((q, i) => ({ questionIndex: i, questionId: q._id, selectedAnswer: -1 })),
    });

    // The duplicate's next section submit must be refused, not graded into a
    // second result.
    const res = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/sections/0/submit`)
      .set('Authorization', `Bearer ${lead.guestToken}`)
      .send({ guestId: 'device-b', attemptId: attemptB._id, answers: [] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('QUIZ_ALREADY_ATTEMPTED');

    const finalized = await GuestAttempt.countDocuments({ quiz: quiz._id, status: { $in: ['completed', 'auto_submitted'] } });
    expect(finalized).toBe(1);
  });
});
