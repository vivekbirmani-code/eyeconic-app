const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const Guest = require('../../models/Guest');
const GuestAttempt = require('../../models/GuestAttempt');
const { resetGuestOtpRateLimits } = require('../../middleware/guestOtpRateLimit');

// Session/data isolation for PUBLIC quizzes: many different students use the
// SAME share link — independently, on the same or different devices, at the
// same or different times. Every student must get their own lead, attempt
// and result, and must never inherit, resume, overwrite or view another
// student's session. Identity is the OTP-VERIFIED EMAIL (the phone is
// unverified household contact metadata) plus the lead ref; the device
// guestId only ever owns ANONYMOUS (legacy) attempts.

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
      question: `Isolation Q #${++questionSeed}?`,
      options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
      correctAnswer: 1,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body;
}

async function setupPublicQuiz(admin, subject) {
  const questions = [];
  for (let i = 0; i < 3; i++) {
    questions.push(await createQuestion(admin, subject));
  }
  const quiz = await Quiz.create({
    title: 'Isolation Test Quiz',
    subject: subject._id,
    testType: 'daily',
    duration: 10,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    createdBy: admin.user._id,
    isPublic: true,
    shareToken: `isolation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
  return { quiz, questions };
}

// Full OTP verification through the real routes. Returns the parsed verify
// response ({ guestToken, guest, alreadyAttempted? }).
async function verifyLead(quiz, { name, email, phone }) {
  resetGuestOtpRateLimits();
  const payload = { name, email, phone, marketingConsent: false };
  await request(app).post(`/api/public/quiz/${quiz.shareToken}/lead/send-otp`).send(payload);
  const otp = sentOtps[sentOtps.length - 1].otp;
  const res = await request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/lead/verify-otp`)
    .send({ ...payload, otp });
  expect(res.status).toBe(200);
  return res.body;
}

const start = (quiz, guestId, guestToken) =>
  request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/start`)
    .set('Authorization', guestToken ? `Bearer ${guestToken}` : '')
    .send({ guestId, deviceInfo: 'isolation-test' });

const submit = (quiz, guestId, guestToken, attemptId, questions, selected = 1) =>
  request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/submit`)
    .set('Authorization', guestToken ? `Bearer ${guestToken}` : '')
    .send({
      guestId,
      attemptId,
      answers: questions.map((q, i) => ({ questionIndex: i, questionId: q._id, selectedAnswer: selected, markedForReview: false, timeSpent: 2 })),
      tabSwitchCount: 0,
      tabSwitchLog: [],
    });

const result = (quiz, guestToken, attemptId) =>
  request(app)
    .get(`/api/public/quiz/${quiz.shareToken}/attempt/${attemptId}/result`)
    .set('Authorization', `Bearer ${guestToken}`);

const ELDER = { name: 'Student One', email: 'student.one@example.com', phone: '+919876543210' };
const YOUNGER = { name: 'Student Two', email: 'student.two@example.com', phone: '+919870012345' };
// Same household: the siblings' family shares ONE phone number.
const YOUNGER_SHARED_PHONE = { ...YOUNGER, phone: ELDER.phone };

describe('Public quiz session isolation — same link, many students', () => {
  let admin;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    subject = await createSubject('Pathology');
    sentOtps.length = 0;
    resetGuestOtpRateLimits();
  });

  it('Scenario A: one student end-to-end — verify, attempt, submit, own result', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);

    const verified = await verifyLead(quiz, ELDER);
    expect(verified.success).toBe(true);
    expect(verified.alreadyAttempted).toBeUndefined();

    const started = await start(quiz, 'device-A', verified.guestToken);
    expect(started.status).toBe(201);
    expect(started.body.lead._id).toBe(verified.guest._id);

    const submitted = await submit(quiz, 'device-A', verified.guestToken, started.body.attempt._id, questions);
    expect(submitted.status).toBe(200);

    const own = await result(quiz, verified.guestToken, started.body.attempt._id);
    expect(own.status).toBe(200);
    expect(own.body.guest.name).toBe(ELDER.name);
    expect(own.body.guest.email).toBe(ELDER.email);
  });

  it('Scenario B (reported bug): after Student 1 finishes, Student 2 on the SAME browser gets their OWN session', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);

    // --- Student 1 completes on the shared browser. ---
    const v1 = await verifyLead(quiz, ELDER);
    const s1 = await start(quiz, 'shared-browser', v1.guestToken);
    await submit(quiz, 'shared-browser', v1.guestToken, s1.body.attempt._id, questions);

    // --- Student 2, same browser (same device guestId in localStorage),
    //     completely different name/email/phone. ---
    const v2 = await verifyLead(quiz, YOUNGER);
    expect(v2.guest._id).not.toBe(v1.guest._id);
    // The reported symptom: this flag with Student 1's attemptId redirected
    // Student 2 to Student 1's result. It must NOT be set for a different
    // verified email.
    expect(v2.alreadyAttempted).toBeUndefined();

    const s2 = await start(quiz, 'shared-browser', v2.guestToken);
    expect(s2.status).toBe(201);
    expect(String(s2.body.attempt._id)).not.toBe(String(s1.body.attempt._id));
    expect(String(s2.body.lead._id)).toBe(String(v2.guest._id));

    const submitted = await submit(quiz, 'shared-browser', v2.guestToken, s2.body.attempt._id, questions);
    expect(submitted.status).toBe(200);

    const own = await result(quiz, v2.guestToken, s2.body.attempt._id);
    expect(own.status).toBe(200);
    expect(own.body.guest.name).toBe(YOUNGER.name);

    // Student 2's token can never render Student 1's result.
    const cross = await result(quiz, v2.guestToken, s1.body.attempt._id);
    expect(cross.status).toBe(404);
  });

  it('Scenario B-household (exact field repro): siblings share ONE phone — still isolated sessions', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);

    const v1 = await verifyLead(quiz, ELDER);
    const s1 = await start(quiz, 'family-pc', v1.guestToken);
    await submit(quiz, 'family-pc', v1.guestToken, s1.body.attempt._id, questions);

    // The younger sibling reuses the family phone number but their own email.
    const v2 = await verifyLead(quiz, YOUNGER_SHARED_PHONE);
    expect(String(v2.guest._id)).not.toBe(String(v1.guest._id));
    expect(v2.alreadyAttempted).toBeUndefined();
    // Two separate leads carry the household number.
    expect(await Guest.countDocuments({ phone: ELDER.phone })).toBe(2);

    const s2 = await start(quiz, 'family-pc', v2.guestToken);
    expect(s2.status).toBe(201);
    expect(String(s2.body.attempt._id)).not.toBe(String(s1.body.attempt._id));

    await submit(quiz, 'family-pc', v2.guestToken, s2.body.attempt._id, questions, 0); // different answers
    const own = await result(quiz, v2.guestToken, s2.body.attempt._id);
    expect(own.status).toBe(200);
    expect(own.body.guest.name).toBe(YOUNGER.name);

    const cross = await result(quiz, v2.guestToken, s1.body.attempt._id);
    expect(cross.status).toBe(404);
  });

  it('Scenario C: two students on DIFFERENT devices — isolated end to end', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);

    const v1 = await verifyLead(quiz, ELDER);
    const s1 = await start(quiz, 'device-A', v1.guestToken);
    await submit(quiz, 'device-A', v1.guestToken, s1.body.attempt._id, questions);

    const v2 = await verifyLead(quiz, YOUNGER);
    const s2 = await start(quiz, 'device-B', v2.guestToken);
    expect(s2.status).toBe(201);
    await submit(quiz, 'device-B', v2.guestToken, s2.body.attempt._id, questions);

    const [r1, r2] = await Promise.all([
      result(quiz, v1.guestToken, s1.body.attempt._id),
      result(quiz, v2.guestToken, s2.body.attempt._id),
    ]);
    expect(r1.body.guest.name).toBe(ELDER.name);
    expect(r2.body.guest.name).toBe(YOUNGER.name);

    expect((await result(quiz, v2.guestToken, s1.body.attempt._id)).status).toBe(404);
    expect((await result(quiz, v1.guestToken, s2.body.attempt._id)).status).toBe(404);
  });

  it('Scenario D-abandoned: Student 1 leaves mid-quiz; Student 2 on the SAME browser never resumes it', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);

    // Student 1 starts and answers one question, then walks away — the
    // attempt stays in_progress on the shared device.
    const v1 = await verifyLead(quiz, ELDER);
    const s1 = await start(quiz, 'shared-browser', v1.guestToken);
    await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/save-progress`)
      .set('Authorization', `Bearer ${v1.guestToken}`)
      .send({
        guestId: 'shared-browser',
        attemptId: s1.body.attempt._id,
        answers: [{ questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 1, markedForReview: false, timeSpent: 3 }],
      });

    // Student 2 verifies on the same browser and starts: a NEW attempt,
    // never Student 1's live one.
    const v2 = await verifyLead(quiz, YOUNGER);
    const s2 = await start(quiz, 'shared-browser', v2.guestToken);
    expect(s2.status).toBe(201);
    expect(String(s2.body.attempt._id)).not.toBe(String(s1.body.attempt._id));

    // Student 1's attempt is untouched — still live, still private.
    const s1Attempt = await GuestAttempt.findById(s1.body.attempt._id);
    expect(s1Attempt.status).toBe('in_progress');
    expect(s1Attempt.answers[0].selectedAnswer).toBe(1);

    // Student 1 resumes their own attempt later (same lead, any device).
    const resume1 = await start(quiz, 'shared-browser', v1.guestToken);
    expect(resume1.status).toBe(200);
    expect(String(resume1.body.attempt._id)).toBe(String(s1.body.attempt._id));

    // Student 2 cannot submit Student 1's attempt.
    const hijack = await submit(quiz, 'shared-browser', v2.guestToken, s1.body.attempt._id, questions);
    expect(hijack.status).toBe(404);
  });

  it('Scenario E: two students start CONCURRENTLY on the same browser — both attempts survive', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject);

    const v1 = await verifyLead(quiz, ELDER);
    const v2 = await verifyLead(quiz, YOUNGER);

    const [s1, s2] = await Promise.all([
      start(quiz, 'shared-browser', v1.guestToken),
      start(quiz, 'shared-browser', v2.guestToken),
    ]);
    expect(s1.status).toBe(201);
    expect(s2.status).toBe(201);
    expect(String(s1.body.attempt._id)).not.toBe(String(s2.body.attempt._id));

    // The concurrent-start reconciliation must never delete the OTHER
    // student's live attempt on a shared device.
    expect(await GuestAttempt.countDocuments({ quiz: quiz._id, status: 'in_progress' })).toBe(2);
  });

  it('re-verification (session expiry mid-flow) resumes the anonymous device attempt under the lead', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);

    // Token expired before /start: the web client degrades to an anonymous
    // (device-keyed) attempt — the legacy-compatible creation path.
    const anon = await start(quiz, 'device-A', null);
    expect(anon.status).toBe(201);
    expect(anon.body.lead).toBeUndefined();

    // The student re-verifies (same email -> one lead) and starts again on
    // the same device: the anonymous attempt is rescued under the lead, not
    // duplicated and not lost.
    const v = await verifyLead(quiz, ELDER);
    const resumed = await start(quiz, 'device-A', v.guestToken);
    expect(resumed.status).toBe(200);
    expect(String(resumed.body.attempt._id)).toBe(String(anon.body.attempt._id));
    expect(String(resumed.body.lead._id)).toBe(String(v.guest._id));

    // And it finalizes normally.
    const submitted = await submit(quiz, 'device-A', v.guestToken, resumed.body.attempt._id, questions);
    expect(submitted.status).toBe(200);
  });

  it('same student refreshing/reopening gets exactly one live attempt (no duplicates)', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject);
    const v = await verifyLead(quiz, ELDER);

    const [first, second, third] = await Promise.all([
      start(quiz, 'device-A', v.guestToken),
      start(quiz, 'device-A', v.guestToken),
      start(quiz, 'device-B', v.guestToken),
    ]);
    const ids = new Set([first, second, third].map((r) => String(r.body.attempt?._id)).filter(Boolean));
    expect(ids.size).toBe(1);
    expect(await GuestAttempt.countDocuments({ quiz: quiz._id, status: 'in_progress' })).toBe(1);
  });

  it('the SAME verified email is still one person: the one-attempt rule survives (duplicate protection intact)', async () => {
    const { quiz, questions } = await setupPublicQuiz(admin, subject);

    const v1 = await verifyLead(quiz, ELDER);
    const s1 = await start(quiz, 'device-A', v1.guestToken);
    await submit(quiz, 'device-A', v1.guestToken, s1.body.attempt._id, questions);

    // Re-verify with the same email from a new device and phone: SAME lead,
    // advisory alreadyAttempted with THEIR attempt, 409 at /start.
    const again = await verifyLead(quiz, { ...ELDER, name: 'Student One Updated', phone: '+919811111111' });
    expect(String(again.guest._id)).toBe(String(v1.guest._id));
    expect(again.alreadyAttempted).toMatchObject({ code: 'QUIZ_ALREADY_ATTEMPTED', attemptId: s1.body.attempt._id });

    const restart = await start(quiz, 'device-Z', again.guestToken);
    expect(restart.status).toBe(409);
    expect(restart.body.attemptId).toBe(s1.body.attempt._id);

    // Their own result is still viewable after re-verification.
    const own = await result(quiz, again.guestToken, s1.body.attempt._id);
    expect(own.status).toBe(200);
    expect(own.body.guest.name).toBe('Student One Updated');
  });

  it('legacy anonymous (mobile) attempts on a device stay device-owned and anonymous', async () => {
    const { quiz } = await setupPublicQuiz(admin, subject);

    const anon = await start(quiz, 'mobile-device', null);
    expect(anon.status).toBe(201);

    // A different anonymous device is unaffected; the same device resumes.
    const otherDevice = await start(quiz, 'other-mobile', null);
    expect(otherDevice.status).toBe(201);
    const same = await start(quiz, 'mobile-device', null);
    expect(same.status).toBe(200);
    expect(String(same.body.attempt._id)).toBe(String(anon.body.attempt._id));

    const stored = await GuestAttempt.findById(anon.body.attempt._id);
    expect(stored.guest).toBeNull();
  });
});
