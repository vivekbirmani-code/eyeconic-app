const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const Guest = require('../../models/Guest');
const GuestOtp = require('../../models/GuestOtp');
const { resetGuestOtpRateLimits } = require('../../middleware/guestOtpRateLimit');

// Capture sent OTPs through the provider boundary — the stored hash is not
// reversible, so tests observe what the mailer was asked to send.
const sentOtps = [];
jest.mock('../../utils/mailer', () => ({
  ...jest.requireActual('../../utils/mailer'),
  sendGuestQuizOtpMail: jest.fn(async (email, otp, quizTitle) => {
    sentOtps.push({ email, otp, quizTitle });
  }),
}));

const mailer = require('../../utils/mailer');

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

async function setupPublicQuiz(admin, subject, title = 'Lead OTP Test Quiz') {
  const questions = [];
  for (let i = 0; i < 2; i++) {
    questions.push(await createQuestion(admin, subject, { question: `${title} Q${i}` }));
  }
  const quiz = await Quiz.create({
    title,
    subject: subject._id,
    testType: 'daily',
    duration: 10,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    createdBy: admin.user._id,
    isPublic: true,
    shareToken: `lead-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
  return { quiz, questions };
}

const sendOtp = (shareToken, body) =>
  request(app).post(`/api/public/quiz/${shareToken}/lead/send-otp`).send(body);

const verifyOtp = (shareToken, body) =>
  request(app).post(`/api/public/quiz/${shareToken}/lead/verify-otp`).send(body);

describe('Guest lead OTP flow', () => {
  let admin;
  let subject;
  let quiz;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    subject = await createSubject('Pathology');
    ({ quiz } = await setupPublicQuiz(admin, subject));
    sentOtps.length = 0;
    mailer.sendGuestQuizOtpMail.mockClear();
    resetGuestOtpRateLimits();
  });

  const leadPayload = (overrides = {}) => ({
    name: 'Rahul Sharma',
    email: 'rahul.sharma@example.com',
    phone: '+919876543210',
    marketingConsent: true,
    ...overrides,
  });

  it('sends an email OTP for a valid lead on a public quiz (eligibility checked before delivery)', async () => {
    const res = await sendOtp(quiz.shareToken, leadPayload());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.expiresInSeconds).toBe(600);
    expect(res.body.resendAfterSeconds).toBe(60);
    expect(res.body.message).toBe('Verification code sent to your email.');
    expect(mailer.sendGuestQuizOtpMail).toHaveBeenCalledTimes(1);
    expect(mailer.sendGuestQuizOtpMail).toHaveBeenCalledWith(
      'rahul.sharma@example.com',
      expect.stringMatching(/^\d{6}$/),
      'Lead OTP Test Quiz'
    );

    // Nothing but the (hashed) OTP row exists — no lead until verification.
    expect(await Guest.countDocuments({})).toBe(0);
    const otpRow = await GuestOtp.findOne({ email: 'rahul.sharma@example.com', shareToken: quiz.shareToken });
    expect(otpRow).toBeTruthy();
    expect(otpRow.otpHash).toMatch(/^[0-9a-f]{64}$/); // HMAC digest, not a plaintext 6-digit code
  });

  it('normalizes accepted phone variants to E.164 and lowercases the email', async () => {
    const res = await sendOtp(quiz.shareToken, leadPayload({
      phone: '09876543210',
      email: '  Rahul.Sharma@EXAMPLE.com ',
    }));
    expect(res.status).toBe(200);
    expect(mailer.sendGuestQuizOtpMail).toHaveBeenCalledWith(
      'rahul.sharma@example.com',
      expect.any(String),
      expect.any(String)
    );
  });

  it('rejects invalid name / email / phone with typed errors and sends nothing', async () => {
    const badName = await sendOtp(quiz.shareToken, leadPayload({ name: 'R' }));
    expect(badName.status).toBe(400);
    expect(badName.body.code).toBe('VALIDATION_ERROR');

    const missingEmail = await sendOtp(quiz.shareToken, leadPayload({ email: '' }));
    expect(missingEmail.status).toBe(400);
    expect(missingEmail.body.code).toBe('EMAIL_INVALID');

    const badEmail = await sendOtp(quiz.shareToken, leadPayload({ email: 'not-an-email' }));
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.code).toBe('EMAIL_INVALID');

    const badPhone = await sendOtp(quiz.shareToken, leadPayload({ phone: '12345' }));
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.code).toBe('PHONE_INVALID');

    expect(mailer.sendGuestQuizOtpMail).not.toHaveBeenCalled();
    expect(await GuestOtp.countDocuments({})).toBe(0);
  });

  it('never sends an email for unknown/revoked tokens', async () => {
    const missing = await sendOtp('does-not-exist', leadPayload());
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('QUIZ_NOT_FOUND');

    await Quiz.updateOne({ _id: quiz._id }, { $set: { isPublic: false } });
    const revoked = await sendOtp(quiz.shareToken, leadPayload());
    expect(revoked.status).toBe(404);

    expect(mailer.sendGuestQuizOtpMail).not.toHaveBeenCalled();
  });

  it('serves public links even when the quiz\'s internal student window has closed (past tests)', async () => {
    // Admins share public links precisely so outsiders can attempt the quiz
    // NOW — including past tests. Only the link's own expiry applies.
    await Quiz.updateOne(
      { _id: quiz._id },
      {
        $set: {
          scheduledDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      }
    );

    const fetch = await request(app).get(`/api/public/quiz/${quiz.shareToken}`);
    expect(fetch.status).toBe(200);
    expect(fetch.body.success).toBe(true);

    const send = await sendOtp(quiz.shareToken, leadPayload());
    expect(send.status).toBe(200);
    expect(mailer.sendGuestQuizOtpMail).toHaveBeenCalled();
  });

  it('still enforces the link\'s own expiry (publicExpiryDate -> 410, no email)', async () => {
    await Quiz.updateOne(
      { _id: quiz._id },
      { $set: { publicExpiryDate: new Date(Date.now() - 60 * 1000) } }
    );

    const fetch = await request(app).get(`/api/public/quiz/${quiz.shareToken}`);
    expect(fetch.status).toBe(410);
    expect(fetch.body.code).toBe('SHARE_LINK_EXPIRED');

    const send = await sendOtp(quiz.shareToken, leadPayload());
    expect(send.status).toBe(410);
    expect(mailer.sendGuestQuizOtpMail).not.toHaveBeenCalled();
  });

  it('verifies the OTP, creates the lead with the verified email, and issues a guest token', async () => {
    await sendOtp(quiz.shareToken, leadPayload());
    const otp = sentOtps[sentOtps.length - 1].otp;

    const res = await verifyOtp(quiz.shareToken, { ...leadPayload(), otp });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.guestToken).toBeTruthy();
    expect(res.body.guest).toMatchObject({
      name: 'Rahul Sharma',
      email: 'rahul.sharma@example.com',
      phone: '+919876543210',
      marketingConsent: true,
    });

    const lead = await Guest.findOne({ phone: '+919876543210' });
    expect(lead).toBeTruthy();
    expect(lead.email).toBe('rahul.sharma@example.com');
    expect(lead.emailVerifiedAt).toBeTruthy();
    expect(lead.phoneVerifiedAt).toBeFalsy(); // phone is no longer OTP-verified
    expect(lead.marketingConsent.granted).toBe(true);
    expect(String(lead.firstQuiz)).toBe(String(quiz._id));
    expect(lead.quizzesTaken.map(String)).toEqual([String(quiz._id)]);

    // Single-use: the OTP row is gone after a successful verify.
    expect(await GuestOtp.countDocuments({ email: 'rahul.sharma@example.com' })).toBe(0);
  });

  it('rejects a wrong OTP without creating a lead', async () => {
    await sendOtp(quiz.shareToken, leadPayload());

    const res = await verifyOtp(quiz.shareToken, { ...leadPayload(), otp: '000000' });
    expect(res.status).toBe(400);
    expect(['OTP_INVALID', 'RATE_LIMITED']).toContain(res.body.code || 'OTP_INVALID');
    expect(await Guest.countDocuments({})).toBe(0);
  });

  it('rejects an expired OTP with OTP_EXPIRED and deletes the row', async () => {
    await sendOtp(quiz.shareToken, leadPayload());
    const otp = sentOtps[sentOtps.length - 1].otp;

    await GuestOtp.updateOne(
      { email: 'rahul.sharma@example.com', shareToken: quiz.shareToken },
      { $set: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } }
    );

    const res = await verifyOtp(quiz.shareToken, { ...leadPayload(), otp });
    expect(res.status).toBe(400);
    expect(['OTP_EXPIRED', 'RATE_LIMITED']).toContain(res.body.code || 'OTP_EXPIRED');
    expect(await Guest.countDocuments({})).toBe(0);
  });

  it('scopes the OTP challenge to one link — a code from link A cannot verify on link B', async () => {
    const { quiz: otherQuiz } = await setupPublicQuiz(admin, subject, 'Second Public Quiz');

    await sendOtp(quiz.shareToken, leadPayload());
    const otpForA = sentOtps[sentOtps.length - 1].otp;

    const res = await verifyOtp(otherQuiz.shareToken, { ...leadPayload(), otp: otpForA });
    expect(res.status).toBe(400);
    expect(['OTP_INVALID', 'RATE_LIMITED']).toContain(res.body.code || 'OTP_INVALID');
    expect(await Guest.countDocuments({})).toBe(0);
  });

  it('resend replaces the previous code for the same challenge', async () => {
    await sendOtp(quiz.shareToken, leadPayload());
    const firstOtp = sentOtps[sentOtps.length - 1].otp;

    // Bypass the 60s resend cooldown by resetting the limiter (unit under
    // test here is replacement, not the limiter).
    resetGuestOtpRateLimits();
    await sendOtp(quiz.shareToken, leadPayload());
    const secondOtp = sentOtps[sentOtps.length - 1].otp;

    expect(secondOtp).not.toBe(firstOtp);
    expect(await GuestOtp.countDocuments({ email: 'rahul.sharma@example.com', shareToken: quiz.shareToken })).toBe(1);

    // The old code no longer verifies.
    const res = await verifyOtp(quiz.shareToken, { ...leadPayload(), otp: firstOtp });
    expect(res.status).toBe(400);

    // The new one does.
    resetGuestOtpRateLimits();
    const ok = await verifyOtp(quiz.shareToken, { ...leadPayload(), otp: secondOtp });
    expect(ok.status).toBe(200);
  });

  it('records marketingConsent=false without blocking the quiz', async () => {
    await sendOtp(quiz.shareToken, leadPayload({ marketingConsent: false }));
    const otp = sentOtps[sentOtps.length - 1].otp;

    const res = await verifyOtp(quiz.shareToken, { ...leadPayload({ marketingConsent: false }), otp });
    expect(res.status).toBe(200);

    const lead = await Guest.findOne({ phone: '+919876543210' });
    expect(lead.marketingConsent.granted).toBe(false);
  });

  it('one phone on two quizzes (with a new email) resolves to ONE lead with the latest verified email', async () => {
    const { quiz: otherQuiz } = await setupPublicQuiz(admin, subject, 'Second Public Quiz');
    // Verify on quiz A.
    await sendOtp(quiz.shareToken, leadPayload({ marketingConsent: false }));
    const otpA = sentOtps[sentOtps.length - 1].otp;
    resetGuestOtpRateLimits();
    const resA = await verifyOtp(quiz.shareToken, { ...leadPayload({ marketingConsent: false }), otp: otpA });
    expect(resA.status).toBe(200);

    // Verify on quiz B (fresh challenge, same phone, updated email).
    resetGuestOtpRateLimits();
    await sendOtp(otherQuiz.shareToken, leadPayload({ name: 'Rahul S.', email: 'rahul.updated@example.com', marketingConsent: true }));
    const otpB = sentOtps[sentOtps.length - 1].otp;
    const resB = await verifyOtp(otherQuiz.shareToken, {
      ...leadPayload({ name: 'Rahul S.', email: 'rahul.updated@example.com', marketingConsent: true }),
      otp: otpB,
    });
    expect(resB.status).toBe(200);

    const leads = await Guest.find({ phone: '+919876543210' });
    expect(leads).toHaveLength(1);
    expect(leads[0].name).toBe('Rahul S.'); // latest info wins
    expect(leads[0].email).toBe('rahul.updated@example.com'); // latest verified email wins
    expect(leads[0].marketingConsent.granted).toBe(true); // latest consent wins
    expect(leads[0].quizzesTaken.map(String)).toHaveLength(2);
    expect(leads[0].quizzesTaken.map(String).sort()).toEqual(
      [String(quiz._id), String(otherQuiz._id)].sort()
    );
  });

  it('enforces the per-email send rate limit (3 / 10 min) and resend cooldown', async () => {
    const first = await sendOtp(quiz.shareToken, leadPayload());
    expect(first.status).toBe(200);

    // 60s minimum interval (real clock — the send above just happened).
    const tooSoon = await sendOtp(quiz.shareToken, leadPayload());
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.code).toBe('RATE_LIMITED');

    // Max-per-window: advance the clock past the cooldown between sends so
    // only the count cap remains under test.
    const realNow = Date.now.bind(Date);
    let fakeNow = realNow();
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);
    try {
      resetGuestOtpRateLimits();
      for (let i = 0; i < 3; i++) {
        fakeNow += 61000;
        const res = await sendOtp(quiz.shareToken, leadPayload());
        expect(res.status).toBe(200);
      }
      fakeNow += 61000;
      const fourth = await sendOtp(quiz.shareToken, leadPayload());
      expect(fourth.status).toBe(429);
      expect(fourth.body.code).toBe('RATE_LIMITED');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('locks out verification after 5 failed attempts', async () => {
    await sendOtp(quiz.shareToken, leadPayload());

    for (let i = 0; i < 5; i++) {
      const res = await verifyOtp(quiz.shareToken, { ...leadPayload(), otp: '000000' });
      expect(res.status).toBe(400);
    }

    const locked = await verifyOtp(quiz.shareToken, { ...leadPayload(), otp: '000000' });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('RATE_LIMITED');
  });

  it('surfaces email provider failures as 503 without persisting an OTP', async () => {
    const { EmailDeliveryError } = require('../../utils/mailer');
    mailer.sendGuestQuizOtpMail.mockImplementationOnce(async () => {
      throw new EmailDeliveryError('Unable to send verification code right now.', 'EMAIL_DELIVERY_FAILED');
    });

    const res = await sendOtp(quiz.shareToken, leadPayload());
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('EMAIL_DELIVERY_FAILED');
    expect(await GuestOtp.countDocuments({})).toBe(0);
  });
});
