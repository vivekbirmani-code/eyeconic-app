// Guest/public-quiz deadline enforcement (product requirements, Oct 2026):
// public links are governed by the LINK's own expiry (publicExpiryDate —
// see utils/publicQuizAccess.js), and flat guest attempts now carry the same
// server-authoritative duration deadline the registered flow has (§7.5):
//
//   effectiveDeadline = min(attempt.durationDeadline, quiz.publicExpiryDate)
//
// Time is simulated by back-dating stored deadlines / the link expiry — the
// comparisons are all server-side against those stored values.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const GuestAttempt = require('../../models/GuestAttempt');
const QuestionBank = require('../../models/QuestionBank');
const { runAttemptSweep } = require('../../utils/attemptSweep');

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

const MIN = 60 * 1000;

// Verify a fresh lead through the real OTP flow → guest token.
async function verifyLead(quiz) {
  const payload = {
    name: 'Window Tester',
    email: `window-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
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

let questionSeedRun = 0;

async function makeQuestions(subject, count = 2) {
  const questions = [];
  questionSeedRun += 1;
  for (let i = 0; i < count; i++) {
    questions.push(await QuestionBank.create({
      subject: subject._id,
      topicName: 'Genetics',
      subtopicName: 'Mendelian Inheritance',
      system: 'Genetic Disorders',
      questionType: 'mcq_single',
      difficulty: 'medium',
      question: `Question ${i} (guest-window seed ${questionSeedRun})`,
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 1,
    }));
  }
  return questions;
}

// FLAT public quiz (no section locking).
async function setupPublicQuiz(admin, subject, { duration = 30, publicExpiryDate = null } = {}) {
  const questions = await makeQuestions(subject);
  const quiz = await Quiz.create({
    title: `Guest Window Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    subject: subject._id,
    testType: 'daily',
    duration,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    createdBy: admin.user._id,
    isPublic: true,
    shareToken: `gw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lockSectionsAfterSubmission: false,
    ...(publicExpiryDate ? { publicExpiryDate } : {}),
  });
  return { quiz, questions };
}

// One lead per quiz — a second startGuest on the same quiz is the SAME
// person resuming (the /start resume semantics).
const leadTokenByQuiz = new Map();
async function startGuest(quiz, guestId, expectStatus = 201) {
  // Mandatory verification (D-P1): starts require a verified lead token.
  const key = String(quiz._id);
  if (!leadTokenByQuiz.has(key)) {
    leadTokenByQuiz.set(key, await verifyLead(quiz));
  }
  const res = await request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/start`)
    .set('Authorization', `Bearer ${leadTokenByQuiz.get(key)}`)
    .send({ guestId });
  expect(res.status).toBe(expectStatus);
  return res.body;
}

const saveProgress = (quiz, guestId, attemptId, answers) =>
  request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/save-progress`)
    .send({ guestId, attemptId, answers });

const submitGuest = (quiz, guestId, attemptId, answers, isAutoSubmit = false) =>
  request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/submit`)
    .send({ guestId, attemptId, answers, isAutoSubmit });

const expireAttemptDeadline = (attemptId, msAgo = 10 * MIN) =>
  GuestAttempt.updateOne({ _id: attemptId }, { $set: { durationDeadline: new Date(Date.now() - msAgo) } });

const expireLink = (quizId, msAgo = 10 * MIN) =>
  Quiz.updateOne({ _id: quizId }, { $set: { publicExpiryDate: new Date(Date.now() - msAgo) } });

// All-correct answer payload (correctAnswer is option 1 on every question).
const allCorrect = (questions) =>
  questions.map((q, index) => ({ questionIndex: index, questionId: q._id, selectedAnswer: 1, markedForReview: false, timeSpent: 5 }));

const oneCorrect = (questions) =>
  questions.map((q, index) => ({ questionIndex: index, questionId: q._id, selectedAnswer: index === 0 ? 1 : -1, markedForReview: false, timeSpent: 5 }));

describe('Guest flat attempts — server-side duration deadline (§7.5 mirror)', () => {
  let admin;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    subject = await createSubject('Pathology');
  });

  it('computes and returns the deadline at /start', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject, { duration: 25 });
    const body = await startGuest(quiz, 'guest-1');

    expect(body.attempt.durationDeadline).toBeDefined();
    const deadline = new Date(body.attempt.durationDeadline);
    expect(deadline.getTime() - new Date(body.attempt.startTime).getTime()).toBe(25 * MIN);

    const attempt = await GuestAttempt.findById(body.attempt._id);
    expect(attempt.durationDeadline.getTime()).toBe(deadline.getTime());
  });

  it('rejects saves past the deadline and finalizes from the stored rows', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject, { duration: 30 });
    const body = await startGuest(quiz, 'guest-1');
    expect((await saveProgress(quiz, 'guest-1', body.attempt._id, oneCorrect(questions))).status).toBe(200);

    await expireAttemptDeadline(body.attempt._id);

    const late = await saveProgress(quiz, 'guest-1', body.attempt._id, allCorrect(questions));
    expect(late.status).toBe(200); // fire-and-forget channel...
    expect(late.body.attemptFinalized).toBe(true); // ...but the attempt is over

    const attempt = await GuestAttempt.findById(body.attempt._id);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'duration' });
    expect(attempt.score).toBe(1); // only the stored pre-deadline answer counted
  });

  it('a submit past the deadline grades STORED answers and ignores the late client payload', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject, { duration: 30 });
    const body = await startGuest(quiz, 'guest-1');
    await saveProgress(quiz, 'guest-1', body.attempt._id, oneCorrect(questions));

    await expireAttemptDeadline(body.attempt._id);

    // The tampered/late payload claims every answer — the server must not
    // accept answers past the cutoff.
    const res = await submitGuest(quiz, 'guest-1', body.attempt._id, allCorrect(questions));
    expect(res.status).toBe(200);
    expect(res.body.submitted).toBe(true);

    const attempt = await GuestAttempt.findById(body.attempt._id);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'duration' });
    expect(attempt.score).toBe(1); // stored answer only
  });

  it('an in-window client-timer auto-submit keeps working (store-then-grade)', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject, { duration: 30 });
    const body = await startGuest(quiz, 'guest-1');

    const res = await submitGuest(quiz, 'guest-1', body.attempt._id, allCorrect(questions), true);
    expect(res.status).toBe(200);
    expect(res.body.submitted).toBe(true);

    const attempt = await GuestAttempt.findById(body.attempt._id);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toBeUndefined(); // client-initiated, not server-enforced
    expect(attempt.score).toBe(questions.length);
  });
});

describe('Guest attempts vs the link expiry (public availability window)', () => {
  let admin;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    subject = await createSubject('Biochemistry');
  });

  it('refuses new starts once the link has expired (410, no attempt created)', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject, {
      publicExpiryDate: new Date(Date.now() - 10 * MIN),
    });
    const res = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .send({ guestId: 'guest-late' });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('SHARE_LINK_EXPIRED');
    expect(await GuestAttempt.countDocuments({ quiz: quiz._id })).toBe(0);
  });

  it('link expiry mid-attempt: the submit finalizes from stored answers and reports success', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject, {
      publicExpiryDate: new Date(Date.now() + 30 * MIN),
    });
    const body = await startGuest(quiz, 'guest-1');
    await saveProgress(quiz, 'guest-1', body.attempt._id, oneCorrect(questions));

    await expireLink(quiz._id);

    // Late payload tries to flip every answer — past the cutoff it must not
    // be accepted; the stored answers finalize instead.
    const res = await submitGuest(quiz, 'guest-1', body.attempt._id, allCorrect(questions));
    expect(res.status).toBe(200);
    expect(res.body.submitted).toBe(true);

    const attempt = await GuestAttempt.findById(body.attempt._id);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'quiz_window' });
    expect(attempt.score).toBe(1);
  });

  it('link expiry mid-attempt: save-progress reports the finalized state', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject, {
      publicExpiryDate: new Date(Date.now() + 30 * MIN),
    });
    const body = await startGuest(quiz, 'guest-1');
    await saveProgress(quiz, 'guest-1', body.attempt._id, oneCorrect(questions));

    await expireLink(quiz._id);

    const res = await saveProgress(quiz, 'guest-1', body.attempt._id, allCorrect(questions));
    expect(res.status).toBe(200);
    expect(res.body.attemptFinalized).toBe(true);

    const attempt = await GuestAttempt.findById(body.attempt._id);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.score).toBe(1);
  });

  it('a submit within the grace window of the link closing is still honored', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject, {
      publicExpiryDate: new Date(Date.now() + 30 * MIN),
    });
    const body = await startGuest(quiz, 'guest-1');

    // Link closed 5 s ago — inside the 30 s in-transit tolerance.
    await Quiz.updateOne({ _id: quiz._id }, { $set: { publicExpiryDate: new Date(Date.now() - 5000) } });

    const res = await submitGuest(quiz, 'guest-1', body.attempt._id, allCorrect(questions), true);
    expect(res.status).toBe(200);
    expect(res.body.submitted).toBe(true);

    const attempt = await GuestAttempt.findById(body.attempt._id);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toBeUndefined(); // honored as an on-time submit
    expect(attempt.score).toBe(questions.length);
  });

  it('a section-locked guest attempt cannot outlive the link expiry', async () => {
    const questions = await makeQuestions(subject, 2);
    const quiz = await Quiz.create({
      title: `Guest Section Window ${Date.now()}`,
      subject: subject._id,
      testType: 'daily',
      duration: 20,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      createdBy: admin.user._id,
      isPublic: true,
      shareToken: `gsw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      lockSectionsAfterSubmission: true,
      sections: [
        { name: 'Part A', duration: 10, selectionType: 'manual', questions: [questions[0]._id] },
        { name: 'Part B', duration: 10, selectionType: 'manual', questions: [questions[1]._id] },
      ],
      publicExpiryDate: new Date(Date.now() + 30 * MIN),
    });

    const body = await startGuest(quiz, 'guest-1');
    expect(body.attempt.sectionLockEnabled).toBe(true);

    await expireLink(quiz._id);

    const res = await saveProgress(quiz, 'guest-1', body.attempt._id, oneCorrect(questions));
    expect(res.status).toBe(200);
    expect(res.body.attemptFinalized).toBe(true);

    const attempt = await GuestAttempt.findById(body.attempt._id);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'quiz_window' });
    expect(attempt.sectionStates.every((s) => s.status !== 'in_progress')).toBe(true);
  });

  it('the sweep finalizes guest attempts past their deadline/link expiry with no guest touch', async () => {
    const overdueDuration = await setupPublicQuiz(admin, subject, { duration: 30 });
    const durationBody = await startGuest(overdueDuration.quiz, 'guest-a');
    await saveProgress(overdueDuration.quiz, 'guest-a', durationBody.attempt._id, oneCorrect(overdueDuration.questions));
    await expireAttemptDeadline(durationBody.attempt._id);

    const overdueLink = await setupPublicQuiz(admin, subject, {
      duration: 30,
      publicExpiryDate: new Date(Date.now() + 30 * MIN),
    });
    const linkBody = await startGuest(overdueLink.quiz, 'guest-b');
    await saveProgress(overdueLink.quiz, 'guest-b', linkBody.attempt._id, oneCorrect(overdueLink.questions));
    await expireLink(overdueLink.quiz._id);

    const result = await runAttemptSweep();
    expect(result.finalized).toBe(2);

    const a = await GuestAttempt.findById(durationBody.attempt._id);
    expect(a.status).toBe('auto_submitted');
    expect(a.autoSubmitReason).toMatchObject({ kind: 'duration' });
    expect(a.score).toBe(1);

    const b = await GuestAttempt.findById(linkBody.attempt._id);
    expect(b.status).toBe('auto_submitted');
    expect(b.autoSubmitReason).toMatchObject({ kind: 'quiz_window' });
    expect(b.score).toBe(1);

    // Idempotent second cycle.
    expect((await runAttemptSweep()).finalized).toBe(0);
  });
});
