// Route-level tests for the server-authoritative flat-quiz duration fix
// (plan §7.5, decision D12) — the seven normative cases proving a client
// cannot extend the allowed quiz duration with manipulated timing.
//
// Elapsed time is simulated by back-dating attempt.durationDeadline in the
// database: the enforcement logic compares (server now) vs (stored deadline),
// so a back-dated deadline is exactly equivalent to time having passed.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuizAttempt = require('../../models/QuizAttempt');
const QuestionBank = require('../../models/QuestionBank');
const { DURATION_GRACE_MS } = require('../../utils/proctoring/durationEnforcement');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

const GRACE = DURATION_GRACE_MS;

async function makeQuestions(subject, count = 2) {
  const questions = [];
  for (let i = 0; i < count; i++) {
    questions.push(await QuestionBank.create({
      subject: subject._id,
      topicName: 'Genetics',
      subtopicName: 'Mendelian Inheritance',
      system: 'Genetic Disorders',
      questionType: 'mcq_single',
      difficulty: 'medium',
      question: `Question ${i}`,
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 1,
    }));
  }
  return questions;
}

// A FLAT quiz — no sections, so no section-lock cascade: exactly the surface
// the duration fix protects.
async function setupFlatQuiz(admin, student, subject, { duration = 20 } = {}) {
  const questions = await makeQuestions(subject);
  const quiz = await Quiz.create({
    title: `Flat Duration Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    subject: subject._id,
    testType: 'daily',
    duration,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    assignedStudents: [student.user._id],
    createdBy: admin.user._id,
  });
  return { quiz, questions };
}

async function startAttempt(student, quizId) {
  const res = await request(app)
    .post(`/api/quizzes/${quizId}/start`)
    .set('Authorization', `Bearer ${student.token}`);
  expect(res.status).toBe(201);
  return res.body;
}

const saveAnswer = (student, quizId, attemptId, questionIndex, questionId, selectedAnswer = 1) =>
  request(app)
    .put(`/api/quizzes/${quizId}/attempt/${attemptId}/answer`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ questionIndex, questionId, selectedAnswer });

const submitQuiz = (student, quizId, attemptId, isAutoSubmit = false, extra = {}) =>
  request(app)
    .post(`/api/quizzes/${quizId}/attempt/${attemptId}/submit`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ isAutoSubmit, ...extra });

// Back-date (or forward-date) the stored deadline — the time machine.
const setDeadline = async (attemptId, deadline) =>
  QuizAttempt.updateOne({ _id: attemptId }, { $set: { durationDeadline: deadline } });

describe('Server-authoritative duration — flat quizzes (§7.5)', () => {
  let admin;
  let student;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    subject = await createSubject('Pathology');
  });

  it('computes and stores the deadline at /start and returns it for display-only countdowns', async () => {
    const { quiz } = await setupFlatQuiz(admin, student, subject, { duration: 20 });
    const body = await startAttempt(student, quiz._id);

    expect(body.durationDeadline).toBeDefined();
    expect(body.serverNow).toBeDefined();

    const deadline = new Date(body.durationDeadline);
    const started = new Date(body.startTime);
    expect(deadline.getTime() - started.getTime()).toBe(20 * 60 * 1000);

    const attempt = await QuizAttempt.findById(body.attemptId);
    expect(attempt.durationDeadline.getTime()).toBe(deadline.getTime());
  });

  it('(§7.5 test 1) a submit 10 minutes past the deadline finalizes as auto_submitted — no client timer needed', async () => {
    const { quiz, questions } = await setupFlatQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);

    expect((await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id)).status).toBe(200);

    await setDeadline(attemptId, new Date(Date.now() - 10 * 60 * 1000));

    const res = await submitQuiz(student, quiz._id, attemptId, false);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('auto_submitted');

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'duration' });
    expect(attempt.autoSubmitReason.deadline.getTime()).toBeLessThan(Date.now());
  });

  it('(§7.5 test 2) client clock skew of ±30 minutes changes nothing — server time only', async () => {
    const { quiz, questions } = await setupFlatQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);

    // Skew direction A: the client CLAIMS to be far in the future while the
    // server deadline has already passed — the claim is ignored, the save is
    // rejected and the attempt finalized from server time.
    await setDeadline(attemptId, new Date(Date.now() - 60 * 1000));
    const skewedFuture = await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id, 1);
    expect(skewedFuture.status).toBe(403);
    expect(skewedFuture.body.errorCode).toBe('TIME_EXPIRED');
    expect((await QuizAttempt.findById(attemptId)).status).toBe('auto_submitted');

    // Skew direction B: a fresh attempt whose client claims its clock is 30
    // minutes BEHIND (i.e. "I still have time") — the server deadline is in
    // the future, the submit completes, and no client timestamp is honored.
    const { quiz: quiz2, questions: questions2 } = await setupFlatQuiz(admin, student, subject, { duration: 30 });
    const second = await startAttempt(student, quiz2._id);
    expect((await saveAnswer(student, quiz2._id, second.attemptId, 0, questions2[0]._id, 1)).status).toBe(200);

    const claimedClientTime = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // "my device says it's later"
    const res = await submitQuiz(student, quiz2._id, second.attemptId, false, {
      clientTimestamp: claimedClientTime, // unknown field — must be ignored
      deviceTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect((await QuizAttempt.findById(second.attemptId)).autoSubmitReason).toBeUndefined();
  });

  it('(§7.5 test 3) answer saves after the deadline are rejected like any completed attempt', async () => {
    const { quiz, questions } = await setupFlatQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);

    await setDeadline(attemptId, new Date(Date.now() - (GRACE + 1000)));

    // First save past the window triggers the lazy finalize and is rejected.
    const first = await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);
    expect(first.status).toBe(403);
    expect(first.body).toMatchObject({ errorCode: 'TIME_EXPIRED', attemptFinalized: true });

    // Subsequent saves hit the ordinary "no active attempt" path — exactly
    // how saves to any completed attempt behave today.
    const second = await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);
    expect(second.status).toBe(404);
    expect(second.body.message).toBe('No active attempt found');

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason.kind).toBe('duration');
    // The rejected save never persisted an answer.
    expect(attempt.answers).toHaveLength(0);
  });

  it('(§7.5 test 4) manual submit 1 s past the grace window is auto_submitted; inside grace it completes', async () => {
    // Case A — 1 second past deadline + grace.
    const late = await setupFlatQuiz(admin, student, subject, { duration: 20 });
    const lateAttempt = await startAttempt(student, late.quiz._id);
    await setDeadline(lateAttempt.attemptId, new Date(Date.now() - (GRACE + 1000)));
    const lateRes = await submitQuiz(student, late.quiz._id, lateAttempt.attemptId, false);
    expect(lateRes.body.status).toBe('auto_submitted');
    expect((await QuizAttempt.findById(lateAttempt.attemptId)).autoSubmitReason.kind).toBe('duration');

    // Case B — still inside the grace window (deadline passed, grace not yet).
    const inGrace = await setupFlatQuiz(admin, student, subject, { duration: 20 });
    const graceAttempt = await startAttempt(student, inGrace.quiz._id);
    await setDeadline(graceAttempt.attemptId, new Date(Date.now() - 5000)); // 5 s ago; 25 s of grace left
    const graceRes = await submitQuiz(student, inGrace.quiz._id, graceAttempt.attemptId, false);
    expect(graceRes.body.status).toBe('completed');
    const attemptDoc = await QuizAttempt.findById(graceAttempt.attemptId);
    expect(attemptDoc.status).toBe('completed');
    expect(attemptDoc.autoSubmitReason).toBeUndefined();
  });

  it('(§7.5 test 5) section-locked attempts keep the endsAt cascade as the sole authority — no deadline is written', async () => {
    const questions = await makeQuestions(subject, 2);
    const quiz = await Quiz.create({
      title: `Section Duration Quiz ${Date.now()}`,
      subject: subject._id,
      testType: 'daily',
      duration: 20,
      questions: questions.map((q) => q._id),
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
      lockSectionsAfterSubmission: true,
      sections: [
        { name: 'Part A', duration: 10, selectionType: 'manual', questions: [questions[0]._id] },
        { name: 'Part B', duration: 10, selectionType: 'manual', questions: [questions[1]._id] },
      ],
    });

    const body = await startAttempt(student, quiz._id);
    expect(body.sectionLockEnabled).toBe(true);
    expect(body.durationDeadline).toBeUndefined();

    const attempt = await QuizAttempt.findById(body.attemptId);
    expect(attempt.durationDeadline).toBeUndefined();
    expect(attempt.sectionStates[0].endsAt).toBeDefined(); // the authority, unchanged

    // Manual whole-quiz submit on a section quiz still completes (existing
    // behavior; the cascade itself is regression-covered by
    // quizSectionLocking.test.js).
    const res = await submitQuiz(student, quiz._id, body.attemptId, false);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect((await QuizAttempt.findById(body.attemptId)).autoSubmitReason).toBeUndefined();
  });

  it('(§7.5 test 6) duration finalize racing a manual submit converges to exactly one winner', async () => {
    const { quiz, questions } = await setupFlatQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);
    expect((await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id)).status).toBe(200);

    await setDeadline(attemptId, new Date(Date.now() - 60 * 1000));

    // Fire a lazy-enforcement touch (answer save) and a manual submit at the
    // same moment: finalizeQuizAttempt's CAS must let exactly one finalize.
    const [saveRes, submitRes] = await Promise.all([
      saveAnswer(student, quiz._id, attemptId, 1, questions[1]._id),
      submitQuiz(student, quiz._id, attemptId, false),
    ]);

    expect([200, 403]).toContain(saveRes.status);
    expect(submitRes.status).toBe(200);
    expect(['auto_submitted', 'completed']).toContain(submitRes.body.status);

    const attempt = await QuizAttempt.findById(attemptId);
    expect(['auto_submitted']).toContain(attempt.status); // past-window reality
    expect(attempt.endTime).toBeDefined();
    expect(attempt.score).toBeDefined();
    // Exactly one attempt row was ever created.
    expect(await QuizAttempt.countDocuments({ quiz: quiz._id, student: student.user._id })).toBe(1);
  });

  it('(§7.5 test 7) resume long after the deadline adopts the finalized state (GET attempt + POST start)', async () => {
    const { quiz } = await setupFlatQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);

    await setDeadline(attemptId, new Date(Date.now() - 15 * 60 * 1000));

    // Mount-time resync (taking screen loadAttempt) returns the finalized state.
    const getRes = await request(app)
      .get(`/api/quizzes/attempt/${attemptId}`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe('auto_submitted');
    expect(getRes.body.serverNow).toBeDefined();

    // A new /start cannot resurrect the attempt OR restart the clock — the
    // one-attempt rule now counts auto_submitted as a used attempt (the
    // approved-retest flow remains the only restart path).
    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(startRes.status).toBe(400);
    expect(startRes.body.message).toBe('You have already completed this quiz');
    expect(startRes.body.attemptId.toString()).toBe(attemptId.toString());
    // No second attempt was created.
    expect(await QuizAttempt.countDocuments({ quiz: quiz._id, student: student.user._id })).toBe(1);
  });

  it('an approved retest can still start a new attempt after a deadline expiry', async () => {
    const { quiz } = await setupFlatQuiz(admin, student, subject, { duration: 20 });
    const { attemptId } = await startAttempt(student, quiz._id);
    await setDeadline(attemptId, new Date(Date.now() - 60 * 1000));
    await submitQuiz(student, quiz._id, attemptId, false);

    await QuizAttempt.updateOne({ _id: attemptId }, { $set: { retestApproved: true } });
    const restart = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(restart.status).toBe(201);
    expect(restart.body.attemptId.toString()).not.toBe(attemptId.toString());
  });

  it('keeps ordinary in-time flat-quiz behavior unchanged (manual submit completes, no reason recorded)', async () => {
    const { quiz, questions } = await setupFlatQuiz(admin, student, subject, { duration: 30 });
    const { attemptId } = await startAttempt(student, quiz._id);

    expect((await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id)).status).toBe(200);
    const res = await submitQuiz(student, quiz._id, attemptId, false);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('completed');
    expect(attempt.autoSubmitReason).toBeUndefined();
  });

  it('keeps client-timer auto-submit within the window as auto_submitted without a duration reason', async () => {
    const { quiz, questions } = await setupFlatQuiz(admin, student, subject, { duration: 30 });
    const { attemptId } = await startAttempt(student, quiz._id);
    expect((await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id)).status).toBe(200);

    // The client's own countdown fires while the server still sees time left.
    const res = await submitQuiz(student, quiz._id, attemptId, true);
    expect(res.body.status).toBe('auto_submitted');
    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toBeUndefined(); // client-initiated, not duration-enforced
  });

  it('rejects saves from a student who does not own the attempt (ownership unchanged)', async () => {
    const { quiz, questions } = await setupFlatQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);

    const other = await createUser({ role: 'student' });
    const res = await saveAnswer(other, quiz._id, attemptId, 0, questions[0]._id);
    expect(res.status).toBe(404);
  });
});
