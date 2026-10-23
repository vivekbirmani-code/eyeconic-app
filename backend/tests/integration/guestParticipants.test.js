const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuizAttempt = require('../../models/QuizAttempt');
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
      question: 'Participants test question?',
      options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
      correctAnswer: 1,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body;
}

async function setupQuiz(admin, subject) {
  const questions = [];
  for (let i = 0; i < 2; i++) {
    questions.push(await createQuestion(admin, subject, { question: `Participants Q${i}` }));
  }
  const quiz = await Quiz.create({
    title: 'Participants Analytics Quiz',
    subject: subject._id,
    testType: 'daily',
    duration: 10,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    createdBy: admin.user._id,
    isPublic: true,
    shareToken: `participants-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    assignedStudents: [],
  });
  return { quiz, questions };
}

// Completes a guest attempt for a fresh verified lead on the quiz.
async function addGuestAttempt(quiz, questions, { name, email, phone, correct = 2, consent = true }) {
  const payload = { name, email, phone, marketingConsent: consent };
  await request(app).post(`/api/public/quiz/${quiz.shareToken}/lead/send-otp`).send(payload);
  const otp = sentOtps[sentOtps.length - 1].otp;
  const verify = await request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/lead/verify-otp`)
    .send({ ...payload, otp });
  expect(verify.status).toBe(200);
  const guestToken = verify.body.guestToken;
  const guestId = `device-${phone}`;

  const start = await request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/start`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ guestId });
  const attemptId = start.body.attempt._id;

  const answers = questions.map((q, i) => ({
    questionIndex: i,
    questionId: q._id,
    selectedAnswer: i < correct ? 1 : 0,
    markedForReview: false,
    timeSpent: 10,
  }));
  const submit = await request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/submit`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ guestId, attemptId, answers, tabSwitchCount: 0, tabSwitchLog: [] });
  expect(submit.status).toBe(200);
  return attemptId;
}

describe('Public participants in admin analytics', () => {
  let admin;
  let mentor;
  let student;
  let subject;
  let quiz;
  let questions;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    mentor = await createUser({ role: 'mentor' });
    student = await createUser({ role: 'student' });
    subject = await createSubject('Pathology');
    ({ quiz, questions } = await setupQuiz(admin, subject));
    sentOtps.length = 0;
    resetGuestOtpRateLimits();
  });

  it('returns guestParticipants to admins with verified emails, full phones + consent', async () => {
    await addGuestAttempt(quiz, questions, { name: 'Rahul Sharma', email: 'rahul.sharma@example.com', phone: '+919876543210', correct: 2, consent: true });
    await addGuestAttempt(quiz, questions, { name: 'Amit Kumar', email: 'amit.kumar@example.com', phone: '+919876543211', correct: 1, consent: false });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);

    expect(Array.isArray(res.body.guestParticipants)).toBe(true);
    expect(res.body.guestParticipants).toHaveLength(2);
    const rahul = res.body.guestParticipants.find((g) => g.name === 'Rahul Sharma');
    expect(rahul).toMatchObject({
      email: 'rahul.sharma@example.com',
      emailVerified: true,
      phoneMasked: '+91 98xxxxx210',
      phone: '+919876543210', // admins follow up on the raw lead number
      phoneVerified: false, // phone is contact info only in the email-OTP flow
      marketingConsent: true,
      correct: 2,
      scorePercentage: 100,
    });
    expect(rahul.phoneMasked).not.toContain('98765');
    const amit = res.body.guestParticipants.find((g) => g.name === 'Amit Kumar');
    expect(amit.email).toBe('amit.kumar@example.com');
    expect(amit.phone).toBe('+919876543211');
    expect(amit.marketingConsent).toBe(false);

    // The legacy /analytics/:id route serves the same admin rows with the
    // full phone.
    const legacyRes = await request(app)
      .get(`/api/quizzes/analytics/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(legacyRes.status).toBe(200);
    const legacyRahul = legacyRes.body.guestParticipants.find((g) => g.name === 'Rahul Sharma');
    expect(legacyRahul.phone).toBe('+919876543210');
  });

  it('renders legacy pre-email leads without an email (null-safe rows)', async () => {
    // A lead captured before the email-OTP switch: no email on the lead or
    // the attempt snapshot. Inserted raw (bypassing mongoose validation) to
    // mirror a real pre-existing document. The analytics row must degrade
    // gracefully.
    const now = new Date();
    const { insertedId } = await Guest.collection.insertOne({
      name: 'Legacy Lead',
      phone: '+919876500000',
      phoneVerifiedAt: now,
      marketingConsent: { granted: true, updatedAt: now },
      source: 'web',
      firstQuiz: null,
      quizzesTaken: [],
      lastActiveAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const lead = { _id: insertedId };
    const start = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .set('Authorization', `Bearer ${require('../../middleware/guestAuth').signGuestToken(lead._id)}`)
      .send({ guestId: 'legacy-device' });
    await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .send({ guestId: 'legacy-device', attemptId: start.body.attempt._id, answers: [] });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    const legacy = res.body.guestParticipants.find((g) => g.name === 'Legacy Lead');
    expect(legacy).toMatchObject({ email: null, emailVerified: false, phoneVerified: true });
  });

  it('never sends guest fields to mentors (byte-compatible responses)', async () => {
    await addGuestAttempt(quiz, questions, { name: 'Rahul Sharma', email: 'rahul.sharma@example.com', phone: '+919876543210' });

    const mentorRes = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(mentorRes.status).toBe(200);
    expect(mentorRes.body).not.toHaveProperty('guestParticipants');

    const mentorList = await request(app)
      .get('/api/quizzes/analytics/tests/list')
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(mentorList.body.tests.every((t) => !('guestAttemptCount' in t))).toBe(true);

    const mentorLegacy = await request(app)
      .get(`/api/quizzes/analytics/${quiz._id}`)
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(mentorLegacy.body).not.toHaveProperty('guestParticipants');
  });

  it('keeps ranked studentPerformance registered-only while aggregates count guests', async () => {
    // Two registered attempts + two guests.
    const student2 = await createUser({ role: 'student', name: 'Second Student' });
    const seedAttempt = (user, correctCount, marks) =>
      QuizAttempt.create({
        quiz: quiz._id,
        student: user._id,
        answers: questions.map((q, i) => ({
          questionIndex: i, questionId: q._id,
          selectedAnswer: i < correctCount ? 1 : 0,
          isCorrect: i < correctCount,
          markedForReview: false, timeSpent: 10,
        })),
        status: 'completed',
        score: correctCount,
        totalQuestions: 2,
        marksObtained: marks,
        totalMarks: 8,
        endTime: new Date(),
      });
    await seedAttempt(student.user, 2, 8);
    await seedAttempt(student2.user, 1, 3);

    await addGuestAttempt(quiz, questions, { name: 'Rahul Sharma', email: 'rahul.sharma@example.com', phone: '+919876543210' });
    await addGuestAttempt(quiz, questions, { name: 'Amit Kumar', email: 'amit.kumar@example.com', phone: '+919876543211' });

    const withGuests = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(withGuests.body.studentPerformance).toHaveLength(2);
    expect(withGuests.body.studentPerformance[0].student.name).toBe(student.user.name);
    expect(withGuests.body.studentPerformance[0].rank).toBe(1);
    expect(withGuests.body.studentPerformance[1].rank).toBe(2);
    // Guests never join the ranked list (every row is a populated student).
    expect(withGuests.body.studentPerformance.every((sp) => sp.student?.email)).toBe(true);

    // Aggregates treat guests as first-class attempts: 2 registered + 2
    // guests. Completion stays scoped to the assigned cohort (0 students
    // were assigned to this public quiz → null, not a misleading 0%).
    expect(withGuests.body.overview.totalAttempted).toBe(4);
    expect(withGuests.body.overview.completionRate).toBeNull();
    expect(withGuests.body.performanceMetrics.attemptCount).toBe(4);
    // Question analytics count all four attempts.
    expect(withGuests.body.questionAnalytics[0].sampleSize).toBe(4);
    expect(withGuests.body.scoreDistribution).toHaveLength(5);
    const distributed = withGuests.body.scoreDistribution.reduce((sum, b) => sum + b.count, 0);
    expect(distributed).toBe(4);

    // Mentors keep the historical registered-only aggregates — this mentor
    // has no assigned students, so they see none of the four attempts.
    const mentorView = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(mentorView.status).toBe(200);
    expect(mentorView.body.overview.totalAttempted).toBe(0);
    expect(mentorView.body.performanceMetrics.attemptCount).toBe(0);
    expect(mentorView.body.questionAnalytics[0].sampleSize).toBe(0);
    expect(mentorView.body).not.toHaveProperty('guestParticipants');
  });

  it('exposes guestAttemptCount separately on the test lists (admins only)', async () => {
    await addGuestAttempt(quiz, questions, { name: 'Rahul Sharma', email: 'rahul.sharma@example.com', phone: '+919876543210' });

    const adminList = await request(app)
      .get('/api/quizzes/analytics/tests/list')
      .set('Authorization', `Bearer ${admin.token}`);
    const entry = adminList.body.tests.find((t) => String(t._id) === String(quiz._id));
    expect(entry.guestAttemptCount).toBe(1);
    expect(entry.attemptCount).toBe(0); // registered-only meaning preserved

    const adminLegacyList = await request(app)
      .get('/api/quizzes/analytics/list')
      .set('Authorization', `Bearer ${admin.token}`);
    const legacyEntry = adminLegacyList.body.find((t) => String(t._id) === String(quiz._id));
    expect(legacyEntry.guestAttemptCount).toBe(1);
  });

  it('appends unranked guest rows with full phone + consent to the admin CSV only', async () => {
    await addGuestAttempt(quiz, questions, { name: 'Rahul Sharma', email: 'rahul.sharma@example.com', phone: '+919876543210', consent: true });

    const adminCsv = await request(app)
      .get(`/api/quizzes/analytics/test-report/${quiz._id}/csv`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(adminCsv.status).toBe(200);
    const csv = adminCsv.text;
    expect(csv).toContain('Participant Type');
    expect(csv).toContain('Email Verified');
    expect(csv).toContain('+919876543210'); // full phone lands in the admin export
    expect(csv).toContain('rahul.sharma@example.com'); // verified lead email lands in the admin export
    expect(csv).toContain('Rahul Sharma');
    expect(csv).toContain('Guest');
    // The Overview row counts the guest attempt (public quiz: 0 assigned,
    // 1 attempted, no completion rate) — same numbers as the app + Excel.
    expect(csv).toContain('0,1,,8,8,8');

    const mentorCsv = await request(app)
      .get(`/api/quizzes/analytics/test-report/${quiz._id}/csv`)
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(mentorCsv.status).toBe(200);
    expect(mentorCsv.text).not.toContain('Participant Type');
    expect(mentorCsv.text).not.toContain('+919876543210');
    expect(mentorCsv.text).not.toContain('rahul.sharma@example.com');
    expect(mentorCsv.text).not.toContain('Rahul Sharma');
    // Mentor Overview stays registered-only: nothing attempted.
    expect(mentorCsv.text).toContain('0,0,,0,0,0');
  });

  it('serves the admin attempt-detail + results fallback for guest attempts, rejects others', async () => {
    const guestAttemptId = await addGuestAttempt(quiz, questions, {
      name: 'Rahul Sharma', email: 'rahul.sharma@example.com', phone: '+919876543210', consent: true,
    });

    // Admin: attempt detail with lead info.
    const detail = await request(app)
      .get(`/api/quizzes/attempt/${guestAttemptId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.participantType).toBe('guest');
    expect(detail.body.student).toMatchObject({
      name: 'Rahul Sharma',
      email: 'rahul.sharma@example.com',
      phone: '+919876543210',
      emailVerified: true,
      phoneVerified: false,
      marketingConsent: true,
    });

    // Admin: grouped results via the same endpoint family the mobile modal uses.
    const results = await request(app)
      .get(`/api/quizzes/${quiz._id}/attempt/${guestAttemptId}/results?groupBy=section`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(results.status).toBe(200);
    expect(results.body.participantType).toBe('guest');
    expect(results.body.student.name).toBe('Rahul Sharma');
    expect(results.body.student.email).toBe('rahul.sharma@example.com');
    expect(results.body.summary.totalQuestions).toBe(2);
    expect(results.body.attempt.sectionPerformance.length).toBeGreaterThan(0);
    expect(results.body.frequentlyMissedQuestions).toEqual([]);

    // Mentor: bare 404 — no oracle.
    const mentorDetail = await request(app)
      .get(`/api/quizzes/attempt/${guestAttemptId}`)
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(mentorDetail.status).toBe(404);

    // Student: also 404 (not 403 — same no-oracle rule for guest attempts).
    const studentDetail = await request(app)
      .get(`/api/quizzes/attempt/${guestAttemptId}`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(studentDetail.status).toBe(404);
  });

  it('excludes legacy anonymous guest attempts (no lead) from participant lists', async () => {
    // Anonymous /start is refused since D-P1 (mandatory OTP verification for
    // every public-quiz attempt), so the legacy device-keyed shape is seeded
    // directly — the analytics exclusion under test is about the ROW's
    // guest:null, not how it was created.
    await GuestAttempt.create({
      quiz: quiz._id,
      guestId: 'anon-legacy',
      status: 'completed',
      startTime: new Date(Date.now() - 10 * 60 * 1000),
      endTime: new Date(),
      answers: [],
      score: 0,
      totalQuestions: questions.length,
      marksObtained: 0,
      totalMarks: questions.length * 4,
    });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.body.guestParticipants).toEqual([]);
    expect(await GuestAttempt.countDocuments({ quiz: quiz._id, guest: null })).toBe(1);
    expect(await Guest.countDocuments({})).toBe(0);
  });
});
