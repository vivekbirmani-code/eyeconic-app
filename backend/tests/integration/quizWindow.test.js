// Route-level tests for strict quiz availability-window enforcement and the
// combined effective-deadline policy (product requirements, Oct 2026):
//
//   effectiveDeadline = min(attempt.durationDeadline, quiz.expiryDate)
//
// Time is simulated the same way quizDuration.test.js does it — back-dating
// stored deadlines / quiz windows in the database is exactly equivalent to
// time having passed, because every comparison happens server-side between
// server-now and those stored values. The overdue sweep is exercised by
// calling runAttemptSweep() directly (its server.js timer wrapper is trivial).

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuizAttempt = require('../../models/QuizAttempt');
const QuestionBank = require('../../models/QuestionBank');
const { DURATION_GRACE_MS } = require('../../utils/proctoring/durationEnforcement');
const { runAttemptSweep } = require('../../utils/attemptSweep');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

const MIN = 60 * 1000;

// Bumped per makeQuestions() call so tests that build several quizzes in one
// body under the same subject never reuse a question text (same subject +
// same text is a duplicate the unique dedup index rejects).
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
      question: `Question ${i} (window seed ${questionSeedRun})`,
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 1,
    }));
  }
  return questions;
}

// FLAT quiz with an availability window (both bounds optional).
async function setupQuiz(admin, student, subject, {
  duration = 30,
  scheduledDate = null,
  expiryDate = null,
} = {}) {
  const questions = await makeQuestions(subject);
  const quiz = await Quiz.create({
    title: `Window Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    subject: subject._id,
    testType: 'daily',
    duration,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    assignedStudents: [student.user._id],
    createdBy: admin.user._id,
    ...(scheduledDate ? { scheduledDate } : {}),
    ...(expiryDate ? { expiryDate } : {}),
  });
  return { quiz, questions };
}

// Section-locked quiz with a window.
async function setupSectionQuiz(admin, student, subject, { expiryDate = null } = {}) {
  const questions = await makeQuestions(subject, 2);
  const quiz = await Quiz.create({
    title: `Section Window Quiz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    subject: subject._id,
    testType: 'daily',
    duration: 20,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    assignedStudents: [student.user._id],
    createdBy: admin.user._id,
    lockSectionsAfterSubmission: true,
    sections: [
      { name: 'Part A', duration: 10, selectionType: 'manual', questions: [questions[0]._id] },
      { name: 'Part B', duration: 10, selectionType: 'manual', questions: [questions[1]._id] },
    ],
    ...(expiryDate ? { expiryDate } : {}),
  });
  return { quiz, questions };
}

async function startAttempt(student, quizId, expectStatus = 201) {
  const res = await request(app)
    .post(`/api/quizzes/${quizId}/start`)
    .set('Authorization', `Bearer ${student.token}`);
  expect(res.status).toBe(expectStatus);
  return res.body;
}

const saveAnswer = (student, quizId, attemptId, questionIndex, questionId, selectedAnswer = 1) =>
  request(app)
    .put(`/api/quizzes/${quizId}/attempt/${attemptId}/answer`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ questionIndex, questionId, selectedAnswer });

const submitQuiz = (student, quizId, attemptId, isAutoSubmit = false) =>
  request(app)
    .post(`/api/quizzes/${quizId}/attempt/${attemptId}/submit`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ isAutoSubmit });

const getAttempt = (student, attemptId) =>
  request(app)
    .get(`/api/quizzes/attempt/${attemptId}`)
    .set('Authorization', `Bearer ${student.token}`);

const getResults = (student, quizId, attemptId) =>
  request(app)
    .get(`/api/quizzes/${quizId}/attempt/${attemptId}/results`)
    .set('Authorization', `Bearer ${student.token}`);

// Time machines: back-date the stored attempt deadline / the quiz window.
const expireDeadline = (attemptId, msAgo = 10 * MIN) =>
  QuizAttempt.updateOne({ _id: attemptId }, { $set: { durationDeadline: new Date(Date.now() - msAgo) } });

const closeQuizWindow = (quizId, msAgo = 10 * MIN) =>
  Quiz.updateOne({ _id: quizId }, { $set: { expiryDate: new Date(Date.now() - msAgo) } });

describe('Quiz availability window — registered students (requirement 2)', () => {
  let admin;
  let student;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    subject = await createSubject('Pathology');
  });

  it('rejects /start before the scheduled start time (direct API included)', async () => {
    const { quiz } = await setupQuiz(admin, student, subject, {
      scheduledDate: new Date(Date.now() + 10 * MIN),
      expiryDate: new Date(Date.now() + 60 * MIN),
    });
    const res = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/has not started yet/i);
  });

  it('allows /start at (and after) the scheduled start time', async () => {
    const { quiz } = await setupQuiz(admin, student, subject, {
      scheduledDate: new Date(Date.now() - 1000),
      expiryDate: new Date(Date.now() + 60 * MIN),
    });
    await startAttempt(student, quiz._id); // expect 201
  });

  it('rejects /start at or after the end time — the window is a hard cutoff', async () => {
    const { quiz } = await setupQuiz(admin, student, subject, {
      expiryDate: new Date(), // exactly now: already closed
    });
    const res = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/expired/i);
  });

  it('rejects answer saves after the window closes, finalizing from saved answers (kind: quiz_window)', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject, {
      expiryDate: new Date(Date.now() + 30 * MIN),
    });
    const { attemptId } = await startAttempt(student, quiz._id);
    expect((await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id)).status).toBe(200);

    await closeQuizWindow(quiz._id);

    const rejected = await saveAnswer(student, quiz._id, attemptId, 1, questions[1]._id);
    expect(rejected.status).toBe(403);
    expect(rejected.body).toMatchObject({ errorCode: 'TIME_EXPIRED', attemptFinalized: true });

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'quiz_window' });
    // The pre-close answer survived and was graded; the post-close write never landed.
    expect(attempt.answers).toHaveLength(1);
    expect(attempt.score).toBe(1);

    // Subsequent saves hit the ordinary "no active attempt" path.
    expect((await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id)).status).toBe(404);
  });

  it('a manual submit after the window closes finalizes auto_submitted — not completed', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject, {
      expiryDate: new Date(Date.now() + 30 * MIN),
    });
    const { attemptId } = await startAttempt(student, quiz._id);
    await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);

    await closeQuizWindow(quiz._id);

    const res = await submitQuiz(student, quiz._id, attemptId, false);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('auto_submitted');

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'quiz_window' });
    expect(attempt.score).toBe(1);
  });

  it('refresh after the window closes adopts the finalized state (GET attempt resync)', async () => {
    const { quiz } = await setupQuiz(admin, student, subject, {
      expiryDate: new Date(Date.now() + 30 * MIN),
    });
    const { attemptId } = await startAttempt(student, quiz._id);

    await closeQuizWindow(quiz._id);

    const res = await getAttempt(student, attemptId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('auto_submitted');
    expect(res.body.serverNow).toBeDefined();

    // A /start resume cannot resurrect it either.
    const restart = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(restart.status).toBe(403); // window closed
    expect(await QuizAttempt.countDocuments({ quiz: quiz._id, student: student.user._id })).toBe(1);
  });

  it('/start after the window closes finalizes the abandoned in-progress attempt first', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject, {
      expiryDate: new Date(Date.now() + 30 * MIN),
    });
    const { attemptId } = await startAttempt(student, quiz._id);
    await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);

    await closeQuizWindow(quiz._id);

    const res = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(403);

    // The dangling attempt was finalized with its saved answers — the
    // student's work materialized as a result instead of dangling forever.
    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'quiz_window' });
    expect(attempt.score).toBe(1);
  });

  it('previously completed attempts and their results survive the window closing', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject, {
      expiryDate: new Date(Date.now() + 30 * MIN),
    });
    const { attemptId } = await startAttempt(student, quiz._id);
    await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);
    const submitted = await submitQuiz(student, quiz._id, attemptId, false);
    expect(submitted.body.status).toBe('completed');

    await closeQuizWindow(quiz._id);

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('completed'); // never rewritten
    expect(attempt.autoSubmitReason).toBeUndefined();

    const results = await getResults(student, quiz._id, attemptId);
    expect(results.status).toBe(200);
  });

  it('an admin shortening the window applies live to in-flight attempts', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject, {
      expiryDate: new Date(Date.now() + 120 * MIN),
    });
    const { attemptId } = await startAttempt(student, quiz._id);
    expect((await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id)).status).toBe(200);

    // Admin edits the quiz to close the window NOW (the PUT route path is
    // equivalent — enforcement reads the live quiz document).
    await closeQuizWindow(quiz._id);

    expect((await saveAnswer(student, quiz._id, attemptId, 1, questions[1]._id)).status).toBe(403);
    expect((await QuizAttempt.findById(attemptId)).status).toBe('auto_submitted');
  });

  it('a section-locked attempt cannot outlive the window: saves rejected, all sections auto-submitted', async () => {
    const { quiz, questions } = await setupSectionQuiz(admin, student, subject, {
      expiryDate: new Date(Date.now() + 60 * MIN),
    });
    const body = await startAttempt(student, quiz._id);
    const attemptId = body.attemptId;
    expect(body.sectionLockEnabled).toBe(true);

    await closeQuizWindow(quiz._id);

    const rejected = await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);
    expect(rejected.status).toBe(403);
    expect(rejected.body).toMatchObject({ errorCode: 'TIME_EXPIRED', attemptFinalized: true });

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'quiz_window' });
    // Every state the attempt recorded closed atomically with the finalize —
    // and the not-yet-opened section never opens.
    expect(attempt.sectionStates.length).toBeGreaterThan(0);
    expect(attempt.sectionStates.every((s) => s.status === 'auto_submitted')).toBe(true);
    expect(attempt.sectionStates.every((s) => s.submittedAt != null)).toBe(true);
  });
});

describe('Combined effective deadline — min(individual, window) (requirement 3)', () => {
  let admin;
  let student;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    subject = await createSubject('Biochemistry');
  });

  it('Example A — the individual duration expires first (window still open)', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject, {
      duration: 20,
      expiryDate: new Date(Date.now() + 240 * MIN), // far future
    });
    const { attemptId } = await startAttempt(student, quiz._id);
    await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);

    await expireDeadline(attemptId); // 20-minute timer ran out 10 minutes ago

    expect((await saveAnswer(student, quiz._id, attemptId, 1, questions[1]._id)).status).toBe(403);
    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'duration' }); // NOT quiz_window
  });

  it('Example B — the quiz window closes first (individual timer unexpired)', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject, {
      duration: 30,
      expiryDate: new Date(Date.now() + 30 * MIN),
    });
    const { attemptId } = await startAttempt(student, quiz._id);
    await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);

    // The student still has ~29 minutes of individual time, but the window
    // closed 10 minutes ago.
    await closeQuizWindow(quiz._id);

    expect((await saveAnswer(student, quiz._id, attemptId, 1, questions[1]._id)).status).toBe(403);
    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'quiz_window' }); // NOT duration
  });

  it('Example C — starting just before close stores the pure deadline; enforcement caps by the window', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject, {
      duration: 30,
      expiryDate: new Date(Date.now() + 2 * MIN), // closes in 2 minutes
    });
    const body = await startAttempt(student, quiz._id);

    // The stored deadline is PURE (start + 30 min) — no fresh 30-minute
    // window is granted beyond the quiz's end; the effective deadline is
    // computed at enforcement time from the live window.
    const stored = await QuizAttempt.findById(body.attemptId);
    expect(stored.durationDeadline.getTime() - new Date(body.startTime).getTime()).toBe(30 * MIN);

    // In-window saves work...
    expect((await saveAnswer(student, quiz._id, body.attemptId, 0, questions[0]._id)).status).toBe(200);

    // ...and the window closes 10 minutes later.
    await closeQuizWindow(quiz._id);
    expect((await saveAnswer(student, quiz._id, body.attemptId, 1, questions[1]._id)).status).toBe(403);
    expect((await QuizAttempt.findById(body.attemptId)).autoSubmitReason.kind).toBe('quiz_window');
  });

  it('Example D — identical deadlines finalize exactly once with exactly one reason', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject, {
      duration: 30,
      expiryDate: new Date(Date.now() + 30 * MIN),
    });
    const { attemptId } = await startAttempt(student, quiz._id);
    await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);

    // Both caps land on the same past instant.
    const samePast = new Date(Date.now() - 10 * MIN);
    await QuizAttempt.updateOne({ _id: attemptId }, { $set: { durationDeadline: samePast } });
    await Quiz.updateOne({ _id: quiz._id }, { $set: { expiryDate: samePast } });

    // A save and a manual submit race the finalization: the CAS lets exactly
    // one finalize win; the other converges to the finalized state.
    const [saveRes, submitRes] = await Promise.all([
      saveAnswer(student, quiz._id, attemptId, 1, questions[1]._id),
      submitQuiz(student, quiz._id, attemptId, false),
    ]);
    expect([200, 403]).toContain(saveRes.status);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.isAlreadySubmitted === true || submitRes.body.status === 'auto_submitted').toBe(true);

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.endTime).toBeDefined();
    expect(typeof attempt.autoSubmitReason.kind).toBe('string'); // exactly one cap reported
    expect(await QuizAttempt.countDocuments({ quiz: quiz._id, student: student.user._id })).toBe(1);
  });

  it('a duplicate submit after finalization is idempotent and does not modify the result', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject, {
      expiryDate: new Date(Date.now() + 30 * MIN),
    });
    const { attemptId } = await startAttempt(student, quiz._id);
    await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);
    await closeQuizWindow(quiz._id);

    const first = await submitQuiz(student, quiz._id, attemptId, false);
    const finalized = await QuizAttempt.findById(attemptId);
    const { endTime, score, marksObtained } = finalized;

    const second = await submitQuiz(student, quiz._id, attemptId, false);
    expect(second.status).toBe(200);
    expect(second.body.isAlreadySubmitted).toBe(true);

    const after = await QuizAttempt.findById(attemptId);
    expect(after.endTime.getTime()).toBe(endTime.getTime());
    expect(after.score).toBe(score);
    expect(after.marksObtained).toBe(marksObtained);
  });

  it('the grace window still tolerates an in-transit submit moments after the window closes', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject, {
      expiryDate: new Date(Date.now() + 30 * MIN),
    });
    const { attemptId } = await startAttempt(student, quiz._id);
    await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);

    // Window closed 5 seconds ago — inside the 30 s in-transit grace.
    await Quiz.updateOne({ _id: quiz._id }, { $set: { expiryDate: new Date(Date.now() - 5000) } });

    const res = await submitQuiz(student, quiz._id, attemptId, false);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed'); // on-time manual submit, no reason recorded
    expect((await QuizAttempt.findById(attemptId)).autoSubmitReason).toBeUndefined();
  });
});

describe('Overdue-attempt sweep — finalization without student activity (requirement 1.1)', () => {
  let admin;
  let student;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    subject = await createSubject('Physiology');
  });

  it('finalizes an overdue flat attempt with no student touch, exactly once', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject, { duration: 20 });
    const { attemptId } = await startAttempt(student, quiz._id);
    await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);
    await expireDeadline(attemptId);

    const firstPass = await runAttemptSweep();
    expect(firstPass.finalized).toBe(1);

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'duration' });
    expect(attempt.score).toBe(1); // saved answers graded

    // Idempotent: nothing left to do on the second cycle.
    const secondPass = await runAttemptSweep();
    expect(secondPass.finalized).toBe(0);
    expect(await QuizAttempt.countDocuments({ quiz: quiz._id, student: student.user._id })).toBe(1);
  });

  it('finalizes attempts on quizzes whose window closed (student never returned)', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject, {
      expiryDate: new Date(Date.now() + 30 * MIN),
    });
    const { attemptId } = await startAttempt(student, quiz._id);
    await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);
    await closeQuizWindow(quiz._id);

    await runAttemptSweep();

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.autoSubmitReason).toMatchObject({ kind: 'quiz_window' });
  });

  it('advances section-locked attempts whose cascades expired while away', async () => {
    const { quiz } = await setupSectionQuiz(admin, student, subject);
    const body = await startAttempt(student, quiz._id);

    // Both section timers ran out long ago (tight cascade: total = 20 min).
    await QuizAttempt.updateOne(
      { _id: body.attemptId },
      { $set: { 'sectionStates.0.endsAt': new Date(Date.now() - 60 * MIN) } }
    );

    await runAttemptSweep();

    const attempt = await QuizAttempt.findById(body.attemptId);
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.sectionStates.every((s) => s.status !== 'in_progress')).toBe(true);
  });

  it('leaves in-window, in-progress attempts untouched', async () => {
    const { quiz } = await setupQuiz(admin, student, subject, {
      expiryDate: new Date(Date.now() + 60 * MIN),
    });
    const { attemptId } = await startAttempt(student, quiz._id);

    const result = await runAttemptSweep();
    expect(result.finalized).toBe(0);

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('in_progress');
  });

  it('a sweep racing a manual submit converges to exactly one finalization', async () => {
    const { quiz, questions } = await setupQuiz(admin, student, subject, {
      expiryDate: new Date(Date.now() + 30 * MIN),
    });
    const { attemptId } = await startAttempt(student, quiz._id);
    await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);
    await closeQuizWindow(quiz._id);

    const [, submitRes] = await Promise.all([
      runAttemptSweep(),
      submitQuiz(student, quiz._id, attemptId, false),
    ]);
    expect(submitRes.status).toBe(200);

    const attempt = await QuizAttempt.findById(attemptId);
    expect(['auto_submitted', 'completed']).toContain(attempt.status);
    expect(attempt.endTime).toBeDefined();
    expect(await QuizAttempt.countDocuments({ quiz: quiz._id, student: student.user._id })).toBe(1);
  });
});
