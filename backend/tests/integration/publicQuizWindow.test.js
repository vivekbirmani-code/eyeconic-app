// Route-level tests for STRICT quiz-window enforcement on PUBLIC share
// links (owner decision 2026-11-15, "strictly always"): guests obey the
// quiz's Start/End Date & Time exactly like registered students, with the
// link's own expiry (publicExpiryDate) able to close the link sooner but
// never re-open a quiz whose internal window has not started or has ended.
//
// Mirrors the registered-student coverage in quizWindow.test.js:
//   effectiveDeadline(guest) = min(attempt.durationDeadline, publicExpiryDate, expiryDate)
//
// Time is simulated by back-dating stored deadlines / windows — every
// comparison happens server-side against those stored values.

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

async function verifyLead(quiz) {
  const payload = {
    name: 'Public Window Guest',
    email: `pw-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
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
      question: `Question ${i} (public-window seed ${questionSeedRun})`,
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 1,
    }));
  }
  return questions;
}

// Public quiz with an internal window + optional link expiry.
async function setupPublicQuiz(admin, subject, {
  duration = 30,
  scheduledDate = null,
  expiryDate = null,
  publicExpiryDate = null,
} = {}) {
  const questions = await makeQuestions(subject);
  const quiz = await Quiz.create({
    title: `Public Window Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    subject: subject._id,
    testType: 'daily',
    duration,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    createdBy: admin.user._id,
    isPublic: true,
    shareToken: `pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lockSectionsAfterSubmission: false,
    ...(scheduledDate ? { scheduledDate } : {}),
    ...(expiryDate ? { expiryDate } : {}),
    ...(publicExpiryDate ? { publicExpiryDate } : {}),
  });
  return { quiz, questions };
}

const guestTokenByQuiz = new Map();
async function startGuest(quiz, guestId, expectStatus) {
  const key = String(quiz._id);
  if (!guestTokenByQuiz.has(key)) {
    guestTokenByQuiz.set(key, await verifyLead(quiz));
  }
  const res = await request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/start`)
    .set('Authorization', `Bearer ${guestTokenByQuiz.get(key)}`)
    .send({ guestId });
  if (expectStatus !== undefined) expect(res.status).toBe(expectStatus);
  return res.body;
}

const saveProgress = (quiz, guestId, token, attemptId, answers) =>
  request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/save-progress`)
    .set('Authorization', `Bearer ${token}`)
    .send({ guestId, attemptId, answers });

describe('Public share links obey the quiz Start/End window (strict semantics)', () => {
  let admin;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    subject = await createSubject('Physiology');
  });

  it('landing page reports the schedule state with serverNow and the stored dates', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject, {
      scheduledDate: new Date(Date.now() + 60 * MIN),
      expiryDate: new Date(Date.now() + 120 * MIN),
    });
    const res = await request(app).get(`/api/public/quiz/${quiz.shareToken}`);
    expect(res.status).toBe(200);
    expect(res.body.quiz.scheduleState).toBe('scheduled');
    expect(res.body.quiz.serverNow).toBeDefined();
    expect(res.body.quiz.scheduledDate).toBeDefined();
    expect(res.body.quiz.expiryDate).toBeDefined();
  });

  it('rejects guest /start before the scheduled start time (direct API included)', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject, {
      scheduledDate: new Date(Date.now() + 30 * MIN),
      expiryDate: new Date(Date.now() + 90 * MIN),
    });
    const res = await startGuest(quiz, 'device-early');
    expect(res.code).toBe('QUIZ_NOT_STARTED');
    expect(res.message).toMatch(/has not started yet/);
    // No attempt row was created.
    expect(await GuestAttempt.countDocuments({ quiz: quiz._id })).toBe(0);
  });

  it('allows guest /start at (and after) the scheduled start time', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject, {
      scheduledDate: new Date(Date.now() - 1000), // just opened
      expiryDate: new Date(Date.now() + 60 * MIN),
    });
    const body = await startGuest(quiz, 'device-on-time', 201);
    expect(body.attempt._id).toBeDefined();
  });

  it('rejects guest /start at/after the internal end even when the link itself never expires', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject, {
      expiryDate: new Date(Date.now() - 10 * MIN), // window already closed
      publicExpiryDate: new Date(Date.now() + 30 * 24 * 60 * MIN), // link valid 30d
    });
    const res = await startGuest(quiz, 'device-late');
    expect(res.code).toBe('QUIZ_WINDOW_CLOSED');
    expect(res.message).toMatch(/has ended/);
  });

  it('the EARLIER of link expiry and internal end governs (link closes first)', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject, {
      expiryDate: new Date(Date.now() + 60 * MIN), // internal end later
      publicExpiryDate: new Date(Date.now() - 5 * MIN), // link already expired
    });
    // Lead capture itself is link-governed: an expired link 410s before any
    // window logic runs (existing behavior, unchanged).
    const otp = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/lead/send-otp`)
      .send({ name: 'Link Expired Guest', email: `le-${Date.now()}@example.com`, phone: '+919876543210' });
    expect(otp.status).toBe(410);

    // And an anonymous /start is blocked by the link-level check too — the
    // min() of the two ends is enforced because EITHER closure blocks.
    const res = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .send({ guestId: 'device-link-expired' });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('SHARE_LINK_EXPIRED');
  });

  it('rejects answer saves after the internal end, finalizing from saved answers (kind: quiz_window)', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject, {
      expiryDate: new Date(Date.now() + 120 * MIN),
    });
    const started = await startGuest(quiz, 'device-mid', 201);
    const attemptId = started.attempt._id;
    const token = guestTokenByQuiz.get(String(quiz._id));

    const answers = [{ questionIndex: 0, questionId: String(questions[0]._id), selectedAnswer: 1 }];
    expect((await saveProgress(quiz, 'device-mid', token, attemptId, answers)).status).toBe(200);

    // The window closes while the guest is away.
    await Quiz.updateOne({ _id: quiz._id }, { $set: { expiryDate: new Date(Date.now() - 10 * MIN) } });

    // save-progress is a fire-and-forget channel: the late payload is
    // DROPPED, the attempt finalizes from SERVER-STORED answers, and the
    // write is reported as attemptFinalized (the client stops saving and
    // routes to its result) — the guest-flow contract, unlike the
    // registered answer route's 403.
    const rejected = await saveProgress(quiz, 'device-mid', token, attemptId, [
      { questionIndex: 1, questionId: String(questions[1]._id), selectedAnswer: 2 },
    ]);
    expect(rejected.status).toBe(200);
    expect(rejected.body.attemptFinalized).toBe(true);

    const attempt = await GuestAttempt.findById(attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'quiz_window' });
    // The post-close write never landed: index 1 was never answered.
    expect(attempt.answers.find(a => a.questionIndex === 1).selectedAnswer).toBe(-1);
  });

  it('/start after the internal end finalizes the abandoned in-progress attempt first', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject, {
      expiryDate: new Date(Date.now() + 120 * MIN),
    });
    await startGuest(quiz, 'device-abandoned', 201);

    // The window closed while the guest never returned.
    await Quiz.updateOne({ _id: quiz._id }, { $set: { expiryDate: new Date(Date.now() - 10 * MIN) } });

    // Same lead re-verifies on ANOTHER device → a fresh token, no resumable
    // attempt under this device, but the lead's attempt must still finalize.
    const res = await startGuest(quiz, 'device-abandoned', 403);
    expect(res.code).toBe('QUIZ_WINDOW_CLOSED');

    const lingering = await GuestAttempt.find({ quiz: quiz._id, status: 'in_progress' });
    // Either finalized by the gate's dangling-finalize pass (same lead) or
    // swept on the next attempt touch — never answerable either way.
    for (const attempt of lingering) {
      expect(attempt.answers).toBeDefined();
    }
    expect(await GuestAttempt.countDocuments({ quiz: quiz._id, status: 'auto_submitted' })).toBeGreaterThanOrEqual(1);
  });

  it('the sweep finalizes guest attempts on window-closed quizzes with NO link expiry', async () => {
    // Regression shape straight from the 2026-11-15 production audit: daily
    // FMGE quizzes shared with an internal 06:00–23:00 IST window and NO
    // publicExpiryDate — attempts lingered in_progress past the window.
    const { quiz } = await setupPublicQuiz(admin, subject, {
      expiryDate: new Date(Date.now() + 120 * MIN),
    });
    await startGuest(quiz, 'device-sweep', 201);

    await Quiz.updateOne({ _id: quiz._id }, { $set: { expiryDate: new Date(Date.now() - 10 * MIN) } });

    await runAttemptSweep();

    const attempt = await GuestAttempt.findOne({ quiz: quiz._id });
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'quiz_window' });
  });

  it('leaves in-window guest attempts untouched (strict gate is not over-eager)', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject, {
      scheduledDate: new Date(Date.now() - 5 * MIN),
      expiryDate: new Date(Date.now() + 60 * MIN),
    });
    await startGuest(quiz, 'device-open', 201);
    await runAttemptSweep();
    const attempt = await GuestAttempt.findOne({ quiz: quiz._id });
    expect(attempt.status).toBe('in_progress');
  });
});
