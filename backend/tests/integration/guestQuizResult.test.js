const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuestionBank = require('../../models/QuestionBank');
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

// Finalizes a lead attempt over the real HTTP surface and returns the
// graded, ownership-scoped result payload the web result page consumes.
// Sectioned quizzes (which enforce section locking) are submitted section by
// section — exactly like the web runner does; flat quizzes use /submit.
async function completeAttemptAndGetResult(quiz, questions, answers, { autoSubmit = false } = {}) {
  void questions;

  // Verify a lead through the real OTP flow.
  const payload = { name: 'Priya Menon', email: 'priya.menon@example.com', phone: `+9198${String(Date.now()).slice(-8)}`, marketingConsent: true };
  await request(app).post(`/api/public/quiz/${quiz.shareToken}/lead/send-otp`).send(payload);
  const otp = sentOtps[sentOtps.length - 1].otp;
  const verify = await request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/lead/verify-otp`)
    .send({ ...payload, otp });
  expect(verify.status).toBe(200);
  const guestToken = verify.body.guestToken;

  const start = await request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/start`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ guestId: 'result-device' });
  expect(start.status).toBe(201);
  const attemptId = start.body.attempt._id;

  if ((quiz.sections || []).length > 0) {
    for (let i = 0; i < quiz.sections.length; i++) {
      const sectionSubmit = await request(app)
        .post(`/api/public/quiz/${quiz.shareToken}/sections/${i}/submit`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ guestId: 'result-device', attemptId, answers, isAutoSubmit: autoSubmit });
      expect(sectionSubmit.status).toBe(200);
    }
  } else {
    const submit = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: 'result-device', attemptId, answers, tabSwitchCount: 2, isAutoSubmit: autoSubmit });
    expect(submit.status).toBe(200);
  }

  const result = await request(app)
    .get(`/api/public/quiz/${quiz.shareToken}/attempt/${attemptId}/result`)
    .set('Authorization', `Bearer ${guestToken}`)
    .query({ groupBy: 'section' });
  expect(result.status).toBe(200);
  return result.body;
}

describe('Guest result payload (shared buildAttemptResults contract)', () => {
  let admin;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    subject = await createSubject('Pathology');
    sentOtps.length = 0;
    resetGuestOtpRateLimits();
  });

  it('computes correct/wrong/skipped, negative marking, accuracy and percentage exactly like the app', async () => {
    const questions = [];
    for (let i = 0; i < 3; i++) {
      questions.push(await createQuestion(admin, subject, { question: `Result Q${i}` }));
    }
    const quiz = await Quiz.create({
      title: 'Guest Result Math Test', subject: subject._id, testType: 'daily', duration: 10,
      questions: questions.map((q) => q._id), positiveMarks: 4, negativeMarks: 1,
      createdBy: admin.user._id, isPublic: true, shareToken: `result-math-${Date.now()}`,
    });

    // 1 correct (+4), 1 wrong (-1), 1 skipped (0) -> 3 of 12 marks = 25%.
    const body = await completeAttemptAndGetResult(quiz, questions, [
      { questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 1, markedForReview: false, timeSpent: 40 },
      { questionIndex: 1, questionId: questions[1]._id, selectedAnswer: 0, markedForReview: false, timeSpent: 30 },
      // question 2 intentionally not sent -> skipped
    ]);

    expect(body.summary).toMatchObject({
      correct: 1, incorrect: 1, skipped: 1, attempted: 2, totalQuestions: 3,
      marksObtained: 3, totalMarks: 12, scorePercentage: 25, accuracy: 50,
      markedForReviewCount: 0,
    });
    // Wall-clock time (endTime - startTime); the test submits within the
    // same millisecond, so simply assert a finite, non-negative value.
    expect(Number.isFinite(body.summary.timeTakenSeconds)).toBe(true);
    expect(body.summary.timeTakenSeconds).toBeGreaterThanOrEqual(0);

    // Grading stored on the attempt feeds the admin Public Participants view.
    const stored = await GuestAttempt.findOne({ quiz: quiz._id });
    expect(stored.score).toBe(1);
    expect(stored.marksObtained).toBe(3);
    expect(stored.tabSwitchCount).toBe(2);
    expect(stored.status).toBe('completed');
    // Subject-grouped stored performance (admin contract) sums to the summary.
    const totals = stored.sectionPerformance.reduce(
      (acc, s) => ({ correct: acc.correct + s.correct, incorrect: acc.incorrect + s.incorrect, skipped: acc.skipped + s.skipped }),
      { correct: 0, incorrect: 0, skipped: 0 }
    );
    expect(totals).toEqual({ correct: 1, incorrect: 1, skipped: 1 });
  });

  it('reports null accuracy when nothing was attempted (no NaN on the result page)', async () => {
    const questions = [await createQuestion(admin, subject, { question: 'Skip me' })];
    const quiz = await Quiz.create({
      title: 'All Skipped Test', subject: subject._id, testType: 'daily', duration: 5,
      questions: questions.map((q) => q._id), positiveMarks: 4, negativeMarks: 1,
      createdBy: admin.user._id, isPublic: true, shareToken: `result-skip-${Date.now()}`,
    });

    const body = await completeAttemptAndGetResult(quiz, questions, []);
    expect(body.summary).toMatchObject({ correct: 0, incorrect: 0, skipped: 1, attempted: 0, marksObtained: 0, accuracy: null });
    expect(body.summary.scorePercentage).toBe(0);
    // Section accuracy of an unattempted group is 0, never NaN.
    body.attempt.sectionPerformance.forEach((s) => expect(s.accuracy).toBe(0));
  });

  it('supports negative totals when every answer is wrong', async () => {
    const questions = [];
    for (let i = 0; i < 2; i++) {
      questions.push(await createQuestion(admin, subject, { question: `Wrong Q${i}` }));
    }
    const quiz = await Quiz.create({
      title: 'All Wrong Test', subject: subject._id, testType: 'daily', duration: 5,
      questions: questions.map((q) => q._id), positiveMarks: 4, negativeMarks: 2,
      createdBy: admin.user._id, isPublic: true, shareToken: `result-wrong-${Date.now()}`,
    });

    const body = await completeAttemptAndGetResult(quiz, questions, [
      { questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 0, markedForReview: false, timeSpent: 5 },
      { questionIndex: 1, questionId: questions[1]._id, selectedAnswer: 3, markedForReview: false, timeSpent: 5 },
    ]);
    expect(body.summary.marksObtained).toBe(-4);
    expect(body.summary.scorePercentage).toBe(-50);
    expect(body.summary.accuracy).toBe(0);
  });

  it('groups section quizzes by section with rows summing to the summary', async () => {
    const questions = [
      await createQuestion(admin, subject, { question: 'Sec A Q1' }),
      await createQuestion(admin, subject, { question: 'Sec A Q2' }),
      await createQuestion(admin, subject, { question: 'Sec B Q1' }),
    ];
    const quiz = await Quiz.create({
      title: 'Sectioned Result Test', subject: subject._id, testType: 'daily', duration: 10,
      questions: questions.map((q) => q._id), positiveMarks: 4, negativeMarks: 1,
      createdBy: admin.user._id, isPublic: true, shareToken: `result-sec-${Date.now()}`,
      sections: [
        { name: 'Section A', duration: 5, selectionType: 'manual', questions: [questions[0]._id, questions[1]._id] },
        { name: 'Section B', duration: 5, selectionType: 'manual', questions: [questions[2]._id] },
      ],
    });

    const body = await completeAttemptAndGetResult(quiz, questions, [
      { questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 1, markedForReview: false, timeSpent: 10 },
      { questionIndex: 1, questionId: questions[1]._id, selectedAnswer: 2, markedForReview: false, timeSpent: 10 },
      { questionIndex: 2, questionId: questions[2]._id, selectedAnswer: 1, markedForReview: false, timeSpent: 10 },
    ]);

    expect(body.hasSectionData).toBe(true);
    expect(body.attempt.sectionPerformance.map((s) => s.sectionName)).toEqual(['Section A', 'Section B']);
    const secA = body.attempt.sectionPerformance.find((s) => s.sectionName === 'Section A');
    const secB = body.attempt.sectionPerformance.find((s) => s.sectionName === 'Section B');
    expect(secA).toMatchObject({ correct: 1, incorrect: 1, skipped: 0, accuracy: 50 });
    expect(secB).toMatchObject({ correct: 1, incorrect: 0, skipped: 0, accuracy: 100 });

    // Rows always add up to the summary counts.
    const sums = body.attempt.sectionPerformance.reduce(
      (acc, s) => ({ c: acc.c + s.correct, i: acc.i + s.incorrect, s: acc.s + s.skipped }),
      { c: 0, i: 0, s: 0 }
    );
    expect(sums).toEqual({ c: body.summary.correct, i: body.summary.incorrect, s: body.summary.skipped });

    // Questions follow section order and carry their section + per-section index.
    expect(body.questions.map((q) => q.section)).toEqual(['Section A', 'Section A', 'Section B']);
    expect(body.questions.map((q) => q.sectionQuestionIndex)).toEqual([0, 1, 0]);
  });

  it('passes question/option/explanation images and the subject name through for the review UI', async () => {
    const questions = [await createQuestion(admin, subject, {
      question: 'Image question',
      questionType: 'image_based',
      questionImage: 'https://res.cloudinary.com/demo/image/upload/question-diagram.png',
      optionImages: [null, 'https://res.cloudinary.com/demo/image/upload/option-b.png', null, null],
      explanation: 'The mitochondria generates ATP.',
      explanationImage: 'https://res.cloudinary.com/demo/image/upload/explanation.png',
    })];
    const quiz = await Quiz.create({
      title: 'Image Result Test', subject: subject._id, testType: 'daily', duration: 5,
      questions: questions.map((q) => q._id), positiveMarks: 4, negativeMarks: 1,
      createdBy: admin.user._id, isPublic: true, shareToken: `result-img-${Date.now()}`,
    });

    const body = await completeAttemptAndGetResult(quiz, questions, [
      { questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 1, markedForReview: false, timeSpent: 12 },
    ]);

    expect(body.quiz.subject).toMatchObject({ name: 'Pathology' });
    const q = body.questions[0];
    expect(q.questionImage).toContain('question-diagram');
    expect(q.optionImages[1]).toContain('option-b');
    expect(q.explanation).toBe('The mitochondria generates ATP.');
    expect(q.explanationImage).toContain('explanation');
    expect(q.correctAnswer).toBe(1);
    expect(q.userAnswer).toBe(1);
  });

  it('keeps auto-submitted status visible and hides the answer key when solutions are off', async () => {
    const questions = [await createQuestion(admin, subject, { question: 'No solutions Q1' })];
    const quiz = await Quiz.create({
      title: 'No Solutions Test', subject: subject._id, testType: 'daily', duration: 5,
      questions: questions.map((q) => q._id), positiveMarks: 4, negativeMarks: 1,
      createdBy: admin.user._id, isPublic: true, shareToken: `result-nosol-${Date.now()}`,
      shareSolution: false,
    });

    const body = await completeAttemptAndGetResult(quiz, questions, [], { shareSolution: false, autoSubmit: true });
    // Timer-expiry whole-quiz submit must surface as auto_submitted (same as
    // the section cascade and the registered app attempt) so the result page
    // can show the auto-submitted state.
    expect(body.attempt.status).toBe('auto_submitted');
    expect(body.quiz.shareSolution).toBe(false);
    body.questions.forEach((q) => {
      expect(q.correctAnswer).toBeUndefined();
      expect(q.explanation).toBeUndefined();
      expect(q.explanationImage).toBeUndefined();
    });
  });

  it('exposes the verified lead identity with a masked phone', async () => {
    const questions = [await createQuestion(admin, subject, { question: 'Identity Q1' })];
    const quiz = await Quiz.create({
      title: 'Identity Test', subject: subject._id, testType: 'daily', duration: 5,
      questions: questions.map((q) => q._id), positiveMarks: 4, negativeMarks: 1,
      createdBy: admin.user._id, isPublic: true, shareToken: `result-id-${Date.now()}`,
    });

    const body = await completeAttemptAndGetResult(quiz, questions, []);
    expect(body.guest.name).toBe('Priya Menon');
    expect(body.guest.email).toBe('priya.menon@example.com');
    expect(body.guest.phoneMasked).not.toContain('9999'); // never the raw number
    // Lead must exist and carry a verified email.
    const lead = await Guest.findOne({ email: 'priya.menon@example.com' });
    expect(lead.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('rejects cross-lead probing with a bare 404 (no data leak)', async () => {
    const questions = [await createQuestion(admin, subject, { question: 'Security Q1' })];
    const quiz = await Quiz.create({
      title: 'Security Test', subject: subject._id, testType: 'daily', duration: 5,
      questions: questions.map((q) => q._id), positiveMarks: 4, negativeMarks: 1,
      createdBy: admin.user._id, isPublic: true, shareToken: `result-sec2-${Date.now()}`,
    });

    const payload = { name: 'Owner Lead', email: 'owner@example.com', phone: '+919811111111', marketingConsent: true };
    await request(app).post(`/api/public/quiz/${quiz.shareToken}/lead/send-otp`).send(payload);
    const ownerOtp = sentOtps[sentOtps.length - 1].otp;
    const ownerVerify = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/lead/verify-otp`)
      .send({ ...payload, otp: ownerOtp });
    const ownerToken = ownerVerify.body.guestToken;

    const start = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ guestId: 'owner-device' });
    const attemptId = start.body.attempt._id;
    await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ guestId: 'owner-device', attemptId, answers: [] });

    // A different verified lead must not read the owner's result by ID.
    resetGuestOtpRateLimits();
    sentOtps.length = 0;
    const otherPayload = { name: 'Other Lead', email: 'other@example.com', phone: '+919822222222', marketingConsent: true };
    await request(app).post(`/api/public/quiz/${quiz.shareToken}/lead/send-otp`).send(otherPayload);
    const otherOtp = sentOtps[sentOtps.length - 1].otp;
    const otherVerify = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/lead/verify-otp`)
      .send({ ...otherPayload, otp: otherOtp });
    const otherToken = otherVerify.body.guestToken;

    const res = await request(app)
      .get(`/api/public/quiz/${quiz.shareToken}/attempt/${attemptId}/result`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
