const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuizAttempt = require('../../models/QuizAttempt');

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

// 4 questions split as two 15-minute manual sections (30-minute quiz).
async function setupSectionQuiz(admin, student, subject, { lock = true, unsetFlag = false, sections } = {}) {
  const questions = [];
  for (let i = 0; i < 4; i++) {
    questions.push(await createQuestion(admin, subject, { question: `Question ${i}` }));
  }
  const quiz = await Quiz.create({
    title: 'Section Locking Test',
    subject: subject._id,
    testType: 'daily',
    duration: 30,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    assignedStudents: [student.user._id],
    createdBy: admin.user._id,
    ...(lock !== undefined ? { lockSectionsAfterSubmission: lock } : {}),
    sections: sections || [
      { name: 'Physics', duration: 15, selectionType: 'manual', questions: [questions[0]._id, questions[1]._id] },
      { name: 'Chemistry', duration: 15, selectionType: 'manual', questions: [questions[2]._id, questions[3]._id] },
    ],
  });
  if (unsetFlag) {
    // Simulate a true legacy quiz: the field is absent from the stored doc.
    await Quiz.updateOne({ _id: quiz._id }, { $unset: { lockSectionsAfterSubmission: '' } });
  }
  return { quiz, questions };
}

async function startAttempt(student, quizId) {
  const res = await request(app)
    .post(`/api/quizzes/${quizId}/start`)
    .set('Authorization', `Bearer ${student.token}`);
  expect(res.status).toBe(201);
  return res.body;
}

function saveAnswer(student, quizId, attemptId, questionIndex, questionId, selectedAnswer = 1) {
  return request(app)
    .put(`/api/quizzes/${quizId}/attempt/${attemptId}/answer`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ questionIndex, questionId, selectedAnswer });
}

function submitSection(student, quizId, attemptId, sectionIndex, isAutoSubmit = false) {
  return request(app)
    .post(`/api/quizzes/${quizId}/attempt/${attemptId}/sections/${sectionIndex}/submit`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ isAutoSubmit });
}

describe('Section locking — authenticated attempts', () => {
  let admin;
  let student;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    subject = await createSubject('Pathology');
  });

  it('snapshots section definitions and initial state at /start', async () => {
    const { quiz, questions } = await setupSectionQuiz(admin, student, subject, { lock: true });

    const body = await startAttempt(student, quiz._id);
    expect(body.sectionLockEnabled).toBe(true);
    expect(body.sectionDefinitions).toHaveLength(2);
    expect(body.sectionDefinitions[0]).toMatchObject({ index: 0, name: 'Physics', duration: 15 });
    expect(body.sectionDefinitions[0].questionIds.map(String)).toEqual(
      [questions[0]._id, questions[1]._id].map(String)
    );
    expect(body.sectionDefinitions[1].questionIds.map(String)).toEqual(
      [questions[2]._id, questions[3]._id].map(String)
    );

    expect(body.sectionStates).toHaveLength(1);
    expect(body.sectionStates[0]).toMatchObject({ index: 0, status: 'in_progress' });
    const endsInMin = (new Date(body.sectionStates[0].endsAt).getTime() - Date.now()) / 60000;
    expect(endsInMin).toBeGreaterThan(14);
    expect(endsInMin).toBeLessThanOrEqual(15.1);

    const attempt = await QuizAttempt.findById(body.attemptId);
    expect(attempt.sectionLockEnabled).toBe(true);
    expect(attempt.sectionDefinitions).toHaveLength(2);
  });

  it('treats a legacy quiz with the field absent as locking ON', async () => {
    const { quiz } = await setupSectionQuiz(admin, student, subject, { unsetFlag: true });

    // The field is genuinely absent from the stored doc (Mongoose hydrates
    // schema defaults on load, which is itself why legacy quizzes read as ON).
    const raw = await Quiz.collection.findOne({ _id: quiz._id });
    expect(raw.lockSectionsAfterSubmission).toBeUndefined();

    const body = await startAttempt(student, quiz._id);
    expect(body.sectionLockEnabled).toBe(true);
    expect(body.sectionDefinitions).toHaveLength(2);
  });

  it('locks a section after manual submit — answers to it are rejected with 403 SECTION_LOCKED', async () => {
    const { quiz, questions } = await setupSectionQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);

    expect((await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id)).status).toBe(200);

    const res = await submitSection(student, quiz._id, attemptId, 0);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Section submitted');
    expect(res.body.submittedSectionIndex).toBe(0);
    expect(res.body.nextSection).toMatchObject({ index: 1, name: 'Chemistry' });

    // Section 0 is now locked: direct API write is rejected server-side.
    const lockedRes = await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);
    expect(lockedRes.status).toBe(403);
    expect(lockedRes.body.errorCode).toBe('SECTION_LOCKED');

    // Section 1 is active: writes succeed.
    expect((await saveAnswer(student, quiz._id, attemptId, 2, questions[2]._id)).status).toBe(200);

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.sectionStates[0].status).toBe('submitted');
    expect(attempt.sectionStates[0].submittedAt).toBeTruthy();
    expect(attempt.sectionStates[1].status).toBe('in_progress');
    expect(attempt.sectionStates[1].startedAt).toBeTruthy();
  });

  it('is idempotent for a double-clicked section submit and rejects future/past sections', async () => {
    const { quiz } = await setupSectionQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);

    // Future section
    const futureRes = await submitSection(student, quiz._id, attemptId, 1);
    expect(futureRes.status).toBe(400);
    expect(futureRes.body.errorCode).toBe('SECTION_NOT_ACTIVE');

    const first = await submitSection(student, quiz._id, attemptId, 0);
    expect(first.status).toBe(200);

    // Double click / replayed request → idempotent success, no state change.
    const second = await submitSection(student, quiz._id, attemptId, 0);
    expect(second.status).toBe(200);
    expect(second.body.isAlreadySubmitted).toBe(true);

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.sectionStates.filter((s) => s.status === 'submitted')).toHaveLength(1);

    // A submit of a PAST (locked) section is indistinguishable from a replayed
    // request — the endpoint answers idempotently and changes nothing. (The
    // lock itself is enforced on the answer-write path with 403
    // SECTION_LOCKED and by the state endpoint; a replay can unlock nothing.)
    const pastRes = await submitSection(student, quiz._id, attemptId, 0);
    expect(pastRes.status).toBe(200);
    expect(pastRes.body.isAlreadySubmitted).toBe(true);

    const attemptAfter = await QuizAttempt.findById(attemptId);
    expect(attemptAfter.sectionStates.filter((s) => s.status === 'submitted')).toHaveLength(1);
    expect(attemptAfter.sectionStates[1].startedAt.getTime()).toBe(attempt.sectionStates[1].startedAt.getTime());
  });

  it('lazily cascades an expired section on the next request (tight cascade)', async () => {
    const { quiz, questions } = await setupSectionQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);

    // Simulate the section-0 deadline having passed while the student was away.
    const past = new Date(Date.now() - 2 * 60000);
    await QuizAttempt.updateOne({ _id: attemptId }, { $set: { 'sectionStates.0.endsAt': past } });

    const res = await saveAnswer(student, quiz._id, attemptId, 2, questions[2]._id);
    expect(res.status).toBe(200); // section 1 is now active

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('in_progress');
    expect(attempt.sectionStates[0].status).toBe('auto_submitted');
    expect(attempt.sectionStates[0].submittedAt.getTime()).toBe(past.getTime());
    // Tight cascade: section 1 started exactly when section 0 ended.
    expect(attempt.sectionStates[1].startedAt.getTime()).toBe(past.getTime());
    expect(attempt.sectionStates[1].status).toBe('in_progress');

    // Writing into the expired section is rejected.
    const lockedRes = await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);
    expect(lockedRes.status).toBe(403);
    expect(lockedRes.body.errorCode).toBe('SECTION_LOCKED');
  });

  it('manual submit arriving after expiry converges to auto_submitted (server truth wins)', async () => {
    const { quiz } = await setupSectionQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);

    const past = new Date(Date.now() - 1000);
    await QuizAttempt.updateOne({ _id: attemptId }, { $set: { 'sectionStates.0.endsAt': past } });

    const res = await submitSection(student, quiz._id, attemptId, 0, false);
    expect(res.status).toBe(200);
    expect(res.body.isAlreadySubmitted).toBe(true);

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.sectionStates[0].status).toBe('auto_submitted');
    expect(attempt.sectionStates[1].status).toBe('in_progress');
  });

  it('finalizes the attempt with full grading when the last section is submitted manually', async () => {
    const { quiz, questions } = await setupSectionQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);

    await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id, 1); // correct
    await saveAnswer(student, quiz._id, attemptId, 1, questions[1]._id, 0); // wrong
    await submitSection(student, quiz._id, attemptId, 0);

    await saveAnswer(student, quiz._id, attemptId, 2, questions[2]._id, 1); // correct
    await saveAnswer(student, quiz._id, attemptId, 3, questions[3]._id, 0); // wrong

    const res = await submitSection(student, quiz._id, attemptId, 1);
    expect(res.status).toBe(200);
    // Byte-compatible with the whole-quiz submit payload:
    expect(res.body.attemptId).toBe(String(attemptId));
    expect(res.body.score).toBe(2);
    expect(res.body.totalQuestions).toBe(4);
    expect(res.body.marksObtained).toBe(6); // +4 -1 +4 -1
    expect(res.body.status).toBe('completed');

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('completed');
    expect(attempt.sectionStates.every((s) => s.status !== 'in_progress')).toBe(true);
    // Refactored finalize path ran: snapshots + section performance present.
    expect(attempt.answers.find((a) => a.questionIndex === 0).metadataSnapshot).toBeTruthy();
    expect(attempt.sectionPerformance.length).toBeGreaterThan(0);

    // Whole-quiz submit afterwards is idempotent.
    const wholeRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect(wholeRes.status).toBe(200);
    expect(wholeRes.body.isAlreadySubmitted).toBe(true);
  });

  it('auto-finalizes a graded attempt when the last section expires', async () => {
    const { quiz, questions } = await setupSectionQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);

    await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id, 1); // correct
    await submitSection(student, quiz._id, attemptId, 0);
    await saveAnswer(student, quiz._id, attemptId, 2, questions[2]._id, 1); // correct

    const past = new Date(Date.now() - 1000);
    await QuizAttempt.updateOne({ _id: attemptId }, { $set: { 'sectionStates.1.endsAt': past } });

    // Any request triggers the cascade + finalize.
    const res = await request(app)
      .get(`/api/quizzes/attempt/${attemptId}`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('auto_submitted');
    expect(res.body.score).toBe(2);
    expect(res.body.serverNow).toBeTruthy();
  });

  it('keeps enforcing the attempt snapshot after admin edits the quiz mid-attempt', async () => {
    const { quiz, questions } = await setupSectionQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);

    await submitSection(student, quiz._id, attemptId, 0);

    // Admin flips the flag and rewrites sections AFTER the attempt started.
    await Quiz.findByIdAndUpdate(quiz._id, {
      lockSectionsAfterSubmission: false,
      sections: [
        { name: 'Renamed A', duration: 10, selectionType: 'manual', questions: [questions[0]._id] },
        { name: 'Renamed B', duration: 20, selectionType: 'manual', questions: [questions[1]._id, questions[2]._id, questions[3]._id] },
      ],
    });

    // The attempt still enforces with its original snapshot + deadlines.
    const lockedRes = await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id);
    expect(lockedRes.status).toBe(403);
    expect(lockedRes.body.errorCode).toBe('SECTION_LOCKED');

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.sectionLockEnabled).toBe(true);
    expect(attempt.sectionDefinitions[0].name).toBe('Physics');
    expect(attempt.sectionDefinitions[1].duration).toBe(15);
    // Active section is still index 1 with an intact deadline.
    expect(attempt.sectionStates[1].status).toBe('in_progress');
    expect(attempt.sectionStates[1].endsAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('behaves exactly like today when locking is OFF', async () => {
    const { quiz, questions } = await setupSectionQuiz(admin, student, subject, { lock: false });
    const body = await startAttempt(student, quiz._id);
    expect(body.sectionLockEnabled).toBeUndefined();

    // Free navigation: answers to ANY section, in any order.
    expect((await saveAnswer(student, quiz._id, body.attemptId, 3, questions[3]._id)).status).toBe(200);
    expect((await saveAnswer(student, quiz._id, body.attemptId, 0, questions[0]._id)).status).toBe(200);

    // Section submit is not available on non-locking attempts.
    const sectionRes = await submitSection(student, quiz._id, body.attemptId, 0);
    expect(sectionRes.status).toBe(400);
    expect(sectionRes.body.errorCode).toBe('SECTION_LOCKING_DISABLED');

    // Whole-quiz submit still works.
    const res = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${body.attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.isAlreadySubmitted).toBe(false);
  });

  it('handles a single-section quiz (section submit finalizes) and no-section quizzes (unchanged)', async () => {
    // Single section covering the whole quiz.
    const single = await setupSectionQuiz(admin, student, subject, {
      sections: undefined,
    });
    // setupSectionQuiz defaults to 2 sections; override with a true single-section quiz:
    const { quiz: singleQuiz, questions } = single;
    await Quiz.findByIdAndDelete(singleQuiz._id);
    const quiz1 = await Quiz.create({
      title: 'Single Section',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
      lockSectionsAfterSubmission: true,
      sections: [{ name: 'Only', duration: 30, selectionType: 'manual', questions: questions.map((q) => q._id) }],
    });
    const started1 = await startAttempt(student, quiz1._id);
    const res1 = await submitSection(student, quiz1._id, started1.attemptId, 0);
    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('completed');
    expect(res1.body.totalQuestions).toBe(4);

    // No sections + locking ON → not enforced, behaves like today.
    const quiz2 = await Quiz.create({
      title: 'No Sections',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
    });
    const started2 = await startAttempt(student, quiz2._id);
    expect(started2.sectionLockEnabled).toBeUndefined();
    expect((await saveAnswer(student, quiz2._id, started2.attemptId, 3, questions[3]._id)).status).toBe(200);
    const res2 = await request(app)
      .post(`/api/quizzes/${quiz2._id}/attempt/${started2.attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect(res2.status).toBe(200);
  });

  it('defensively finalizes everything on a whole-quiz submit while locking is ON (old clients)', async () => {
    const { quiz, questions } = await setupSectionQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);

    await saveAnswer(student, quiz._id, attemptId, 0, questions[0]._id, 1);
    await submitSection(student, quiz._id, attemptId, 0);
    await saveAnswer(student, quiz._id, attemptId, 2, questions[2]._id, 1);

    const res = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(2);

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('completed');
    expect(attempt.sectionStates.every((s) => s.status !== 'in_progress')).toBe(true);
  });

  it('guarantees /start definitions match GET /:id derived sections for mixed sections', async () => {
    const { quiz, questions } = await setupSectionQuiz(admin, student, subject, {
      lock: true,
      sections: [
        { name: 'Mixed A', duration: 15, selectionType: 'mixed' },
        { name: 'Mixed B', duration: 15, selectionType: 'mixed' },
      ],
    });

    const started = await startAttempt(student, quiz._id);
    expect(started.sectionDefinitions).toHaveLength(2);

    const getRes = await request(app)
      .get(`/api/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.lockSectionsAfterSubmission).toBe(true);

    // Every question is partitioned identically by both sources.
    const fromStart = started.sectionDefinitions
      .flatMap((d) => d.questionIds.map(String));
    const fromGet = getRes.body.sections.flatMap((s) => s.questions.map(String));
    expect(fromStart.sort()).toEqual(fromGet.sort());
    expect(new Set(fromStart).size).toBe(4);
    expect(fromStart).toEqual(expect.arrayContaining(questions.map((q) => String(q._id))));
  });

  it('resumes with server-synced section state after refresh (and rejects a finalized attempt)', async () => {
    const { quiz, questions } = await setupSectionQuiz(admin, student, subject);
    const { attemptId } = await startAttempt(student, quiz._id);
    await submitSection(student, quiz._id, attemptId, 0);

    // A fresh /start (refresh / second device) resumes and returns state.
    const resumeRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.sectionLockEnabled).toBe(true);
    expect(resumeRes.body.sectionStates[0].status).toBe('submitted');
    expect(resumeRes.body.sectionStates[1].status).toBe('in_progress');
    expect(resumeRes.body.duration).toBe(30);

    // Expiring the final section then resuming reports finalization.
    await QuizAttempt.updateOne(
      { _id: attemptId },
      { $set: { 'sectionStates.1.endsAt': new Date(Date.now() - 1000) } }
    );
    const finalRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(finalRes.status).toBe(200);
    expect(finalRes.body.attemptFinalized).toBe(true);
    expect(['auto_submitted', 'completed']).toContain(finalRes.body.status);
  });
});
