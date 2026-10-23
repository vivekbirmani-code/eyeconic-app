const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const GuestAttempt = require('../../models/GuestAttempt');
const { resetGuestOtpRateLimits } = require('../../middleware/guestOtpRateLimit');

// OTP mailer mock — public starts require a verified lead since the
// mandatory-verification policy (owner decision D-P1, 2026-10-23).
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

// Verify a fresh lead through the real OTP flow → guest token.
async function verifyLead(quiz) {
  const payload = {
    name: 'Section Tester',
    email: `section-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    phone: '+919876543210',
    marketingConsent: true,
  };
  await request(app).post(`/api/public/quiz/${quiz.shareToken}/lead/send-otp`).send(payload);
  const otp = sentOtps[sentOtps.length - 1].otp;
  const res = await request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/lead/verify-otp`)
    .send({ ...payload, otp });
  expect(res.status).toBe(200);
  return res.body.guestToken;
}

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

// Public quiz with two 15-minute manual sections (30-minute quiz).
async function setupGuestQuiz(admin, subject, { lock = true, unsetFlag = false, sections } = {}) {
  const questions = [];
  for (let i = 0; i < 4; i++) {
    questions.push(await createQuestion(admin, subject, { question: `Question ${i}` }));
  }
  const quiz = await Quiz.create({
    title: 'Guest Section Locking Test',
    subject: subject._id,
    testType: 'daily',
    duration: 30,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    createdBy: admin.user._id,
    isPublic: true,
    shareToken: `guest-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...(lock !== undefined ? { lockSectionsAfterSubmission: lock } : {}),
    sections: sections || [
      { name: 'Physics', duration: 15, selectionType: 'manual', questions: [questions[0]._id, questions[1]._id] },
      { name: 'Chemistry', duration: 15, selectionType: 'manual', questions: [questions[2]._id, questions[3]._id] },
    ],
  });
  if (unsetFlag) {
    await Quiz.updateOne({ _id: quiz._id }, { $unset: { lockSectionsAfterSubmission: '' } });
  }
  return { quiz, questions };
}

// One lead per quiz for the whole file — a second startGuest on the same
// quiz is the SAME person resuming (the /start resume semantics).
const leadTokenByQuiz = new Map();
const leadTokenFor = async (quiz) => {
  const key = String(quiz._id);
  if (!leadTokenByQuiz.has(key)) {
    leadTokenByQuiz.set(key, await verifyLead(quiz));
  }
  return leadTokenByQuiz.get(key);
};

async function startGuest(quiz, guestId, deviceInfo) {
  // Mandatory verification (D-P1): starts require a verified lead token.
  const guestToken = await leadTokenFor(quiz);
  const res = await request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/start`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ guestId, deviceInfo });
  expect(res.status).toBe(201);
  return res.body;
}

function guestAnswer(questionIndex, questionId, selectedAnswer = 1) {
  return { questionIndex, questionId, selectedAnswer, markedForReview: false, timeSpent: 5 };
}

function submitGuestSection(quiz, guestId, attemptId, sectionIndex, isAutoSubmit = false, answers = undefined) {
  return request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/sections/${sectionIndex}/submit`)
    .send({ guestId, attemptId, isAutoSubmit, ...(answers !== undefined ? { answers } : {}) });
}

describe('Section locking — guest/public attempts', () => {
  let admin;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    // Every test verifies a fresh lead (mandatory D-P1) — the per-IP OTP
    // send limiter would trip after 10 sends otherwise.
    resetGuestOtpRateLimits();
    admin = await createUser({ role: 'admin' });
    subject = await createSubject('Pathology');
  });

  it('snapshots sections at guest /start and resumes with the same state', async () => {
    const { quiz, questions } = await setupGuestQuiz(admin, subject);
    const guestId = 'guest-1';

    const body = await startGuest(quiz, guestId);
    expect(body.attempt.sectionLockEnabled).toBe(true);
    expect(body.attempt.sectionDefinitions).toHaveLength(2);
    expect(body.attempt.sectionDefinitions[0].questionIds.map(String)).toEqual(
      [questions[0]._id, questions[1]._id].map(String)
    );
    expect(body.attempt.sectionStates).toHaveLength(1);
    expect(body.attempt.sectionStates[0].status).toBe('in_progress');
    expect(body.attempt.serverNow).toBeTruthy();

    // Resume returns the same state (guest re-sync channel) — same lead,
    // same token (mandatory verification, D-P1).
    const resume = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .set('Authorization', `Bearer ${await leadTokenFor(quiz)}`)
      .send({ guestId });
    expect(resume.status).toBe(200);
    expect(resume.body.attempt._id).toBe(body.attempt._id);
    expect(resume.body.attempt.sectionStates).toHaveLength(1);
  });

  it('treats a legacy public quiz with the field absent as locking ON', async () => {
    const { quiz } = await setupGuestQuiz(admin, subject, { unsetFlag: true });
    const raw = await Quiz.collection.findOne({ _id: quiz._id });
    expect(raw.lockSectionsAfterSubmission).toBeUndefined();

    const body = await startGuest(quiz, 'guest-legacy');
    expect(body.attempt.sectionLockEnabled).toBe(true);
  });

  it('locks a section on submit and filters save-progress writes into it (merge, never replace)', async () => {
    const { quiz, questions } = await setupGuestQuiz(admin, subject);
    const guestId = 'guest-lock-write';
    const { attempt } = await startGuest(quiz, guestId);

    // Answer both questions of section 0 before submitting it.
    await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/save-progress`)
      .send({
        guestId,
        attemptId: attempt._id,
        answers: [guestAnswer(0, questions[0]._id), guestAnswer(1, questions[1]._id)],
      })
      .expect(200);

    const res = await submitGuestSection(quiz, guestId, attempt._id, 0);
    expect(res.status).toBe(200);
    expect(res.body.nextSection).toMatchObject({ index: 1, name: 'Chemistry' });

    // Attempted bypass: a save-progress snapshot that rewrites the locked
    // section's answers AND carries a legitimate current-section answer.
    const bypassRes = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/save-progress`)
      .send({
        guestId,
        attemptId: attempt._id,
        answers: [
          { ...guestAnswer(0, questions[0]._id), selectedAnswer: 3 }, // locked section — must be dropped
          guestAnswer(2, questions[2]._id, 1),                          // current section — must persist
        ],
      });
    expect(bypassRes.status).toBe(200);

    const stored = await GuestAttempt.findById(attempt._id);
    const byIndex = (i) => stored.answers.find((a) => a.questionIndex === i);
    expect(byIndex(0).selectedAnswer).toBe(1);      // locked value preserved
    expect(byIndex(2).selectedAnswer).toBe(1);      // current value accepted
  });

  it('merges only the closing section answers on section submit (final flush)', async () => {
    const { quiz, questions } = await setupGuestQuiz(admin, subject);
    const guestId = 'guest-flush';
    const { attempt } = await startGuest(quiz, guestId);

    const res = await submitGuestSection(quiz, guestId, attempt._id, 0, false, [
      guestAnswer(0, questions[0]._id),          // belongs to section 0 — accepted
      guestAnswer(2, questions[2]._id, 2),       // belongs to section 1 — dropped (not closed yet)
    ]);
    expect(res.status).toBe(200);

    const stored = await GuestAttempt.findById(attempt._id);
    const byIndex = (i) => stored.answers.find((a) => a.questionIndex === i);
    expect(byIndex(0).selectedAnswer).toBe(1);
    expect(byIndex(2).selectedAnswer).toBe(-1);   // untouched default
  });

  it('is idempotent for double submits and rejects future sections', async () => {
    const { quiz } = await setupGuestQuiz(admin, subject);
    const guestId = 'guest-idem';
    const { attempt } = await startGuest(quiz, guestId);

    const future = await submitGuestSection(quiz, guestId, attempt._id, 1);
    expect(future.status).toBe(400);
    expect(future.body.errorCode).toBe('SECTION_NOT_ACTIVE');

    expect((await submitGuestSection(quiz, guestId, attempt._id, 0)).status).toBe(200);
    const second = await submitGuestSection(quiz, guestId, attempt._id, 0);
    expect(second.status).toBe(200);
    expect(second.body.isAlreadySubmitted).toBe(true);

    const stored = await GuestAttempt.findById(attempt._id);
    expect(stored.sectionStates.filter((s) => s.status === 'submitted')).toHaveLength(1);
  });

  it('cascades expiry lazily on save-progress (tight cascade)', async () => {
    const { quiz } = await setupGuestQuiz(admin, subject);
    const guestId = 'guest-expiry';
    const { attempt } = await startGuest(quiz, guestId);

    const past = new Date(Date.now() - 2 * 60000);
    await GuestAttempt.updateOne({ _id: attempt._id }, { $set: { 'sectionStates.0.endsAt': past } });

    const res = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/save-progress`)
      .send({ guestId, attemptId: attempt._id, answers: [] });
    expect(res.status).toBe(200);

    const stored = await GuestAttempt.findById(attempt._id);
    expect(stored.status).toBe('in_progress');
    expect(stored.sectionStates[0].status).toBe('auto_submitted');
    expect(stored.sectionStates[1].startedAt.getTime()).toBe(past.getTime());
    expect(stored.sectionStates[1].status).toBe('in_progress');
  });

  it('finalizes with grading when the last section is submitted; results are never returned', async () => {
    const { quiz, questions } = await setupGuestQuiz(admin, subject);
    const guestId = 'guest-final';
    const { attempt } = await startGuest(quiz, guestId);

    await submitGuestSection(quiz, guestId, attempt._id, 0, false, [
      guestAnswer(0, questions[0]._id, 1), // correct
      guestAnswer(1, questions[1]._id, 0), // wrong
    ]);

    const res = await submitGuestSection(quiz, guestId, attempt._id, 1, false, [
      guestAnswer(2, questions[2]._id, 1), // correct
      guestAnswer(3, questions[3]._id, 0), // wrong
    ]);
    expect(res.status).toBe(200);
    expect(res.body.submitted).toBe(true);
    expect(res.body.attemptFinalized).toBe(true);
    expect(res.body.score).toBeUndefined(); // guests never receive results

    const stored = await GuestAttempt.findById(attempt._id);
    expect(stored.status).toBe('completed');
    expect(stored.score).toBe(2);
    // Guest grading is aligned with registered-user grading
    // (finalizeQuizAttempt): +positiveMarks per correct, −|negativeMarks|
    // per wrong, skipped = 0. Here (2 correct × 4) − (2 wrong × 1) = 6.
    expect(stored.marksObtained).toBe(6);
    // Subject-grouped sectionPerformance is computed and stored like
    // registered attempts (all four questions share one subject here).
    expect(stored.sectionPerformance).toHaveLength(1);
    expect(stored.sectionPerformance[0]).toMatchObject({
      correct: 2,
      incorrect: 2,
      skipped: 0,
    });
    expect(stored.sectionStates.every((s) => s.status !== 'in_progress')).toBe(true);

    // Re-submitting the whole quiz (idempotent for locked attempts, not the old 400).
    const whole = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .send({ guestId, attemptId: attempt._id, answers: [] });
    expect(whole.status).toBe(200);
    expect(whole.body.isAlreadySubmitted).toBe(true);
  });

  it('auto-finalizes when the last section expires', async () => {
    const { quiz, questions } = await setupGuestQuiz(admin, subject);
    const guestId = 'guest-auto';
    const { attempt } = await startGuest(quiz, guestId);

    await submitGuestSection(quiz, guestId, attempt._id, 0, false, [
      guestAnswer(0, questions[0]._id, 1),
    ]);

    await GuestAttempt.updateOne(
      { _id: attempt._id },
      { $set: { 'sectionStates.1.endsAt': new Date(Date.now() - 1000) } }
    );

    const res = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .set('Authorization', `Bearer ${await leadTokenFor(quiz)}`)
      .send({ guestId });
    expect(res.status).toBe(200);
    expect(res.body.attemptFinalized).toBe(true);

    const stored = await GuestAttempt.findById(attempt._id);
    expect(stored.status).toBe('auto_submitted');
    expect(stored.score).toBe(1);
  });

  it('defensive whole-quiz submit while ON ignores locked-section answers', async () => {
    const { quiz, questions } = await setupGuestQuiz(admin, subject);
    const guestId = 'guest-whole';
    const { attempt } = await startGuest(quiz, guestId);

    await submitGuestSection(quiz, guestId, attempt._id, 0, false, [
      guestAnswer(0, questions[0]._id, 1), // correct — locked in
    ]);

    // Crafted whole submit trying to rewrite the locked answer + forfeit the rest.
    const res = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .send({
        guestId,
        attemptId: attempt._id,
        answers: [{ ...guestAnswer(0, questions[0]._id), selectedAnswer: 3 }],
      });
    expect(res.status).toBe(200);

    const stored = await GuestAttempt.findById(attempt._id);
    expect(stored.status).toBe('completed');
    expect(stored.answers.find((a) => a.questionIndex === 0).selectedAnswer).toBe(1); // locked value kept
    expect(stored.score).toBe(1); // only the locked correct answer
  });

  it('keeps today\'s behavior for OFF guest quizzes (including the 400 re-submit)', async () => {
    const { quiz, questions } = await setupGuestQuiz(admin, subject, { lock: false });
    const guestId = 'guest-off';
    const { attempt } = await startGuest(quiz, guestId);
    expect(attempt.sectionLockEnabled).toBeUndefined();

    // Wholesale snapshot replace still works for non-locking attempts.
    await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/save-progress`)
      .send({
        guestId,
        attemptId: attempt._id,
        answers: [guestAnswer(3, questions[3]._id, 1), guestAnswer(0, questions[0]._id, 1)],
      })
      .expect(200);

    const stored = await GuestAttempt.findById(attempt._id);
    expect(stored.answers.find((a) => a.questionIndex === 3).selectedAnswer).toBe(1);

    // Section submit is not available.
    const sectionRes = await submitGuestSection(quiz, guestId, attempt._id, 0);
    expect(sectionRes.status).toBe(400);
    expect(sectionRes.body.errorCode).toBe('SECTION_LOCKING_DISABLED');

    const res = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .send({ guestId, attemptId: attempt._id, answers: attempt.answers });
    expect(res.status).toBe(200);

    // Historical non-idempotent 400 on re-submit is preserved for OFF quizzes.
    const again = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .send({ guestId, attemptId: attempt._id, answers: [] });
    expect(again.status).toBe(400);
  });

  it('leaves no-section public quizzes unchanged even with locking ON', async () => {
    const questions = [];
    for (let i = 0; i < 4; i++) {
      questions.push(await createQuestion(admin, subject, { question: `Q ${i}` }));
    }
    const quiz = await Quiz.create({
      title: 'Guest No Sections',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      createdBy: admin.user._id,
      isPublic: true,
      shareToken: `guest-nosec-${Date.now()}`,
    });

    const { attempt } = await startGuest(quiz, 'guest-nosec');
    expect(attempt.sectionLockEnabled).toBeUndefined();

    const res = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .send({ guestId: 'guest-nosec', attemptId: attempt._id, answers: [guestAnswer(0, questions[0]._id, 1)] });
    expect(res.status).toBe(200);
  });

  it('does not let a different guestId touch someone else\'s attempt', async () => {
    const { quiz } = await setupGuestQuiz(admin, subject);
    const { attempt } = await startGuest(quiz, 'guest-real');

    const res = await submitGuestSection(quiz, 'guest-attacker', attempt._id, 0);
    expect(res.status).toBe(404);
  });
});
