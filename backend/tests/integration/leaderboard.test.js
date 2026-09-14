const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuestionBank = require('../../models/QuestionBank');
const QuizAttempt = require('../../models/QuizAttempt');
const MentorStudentAssignment = require('../../models/MentorStudentAssignment');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

// Same-subject duplicate stems are rejected by the API now — default to a unique stem; explicit question overrides still win.
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
      question: `Leaderboard question #${++questionSeed}?`,
      options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
      correctAnswer: 1,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body;
}

function answerRow(question, index, isCorrect) {
  return {
    questionIndex: index,
    questionId: question._id,
    selectedAnswer: isCorrect ? 1 : 2,
    isCorrect: Boolean(isCorrect),
    metadataSnapshot: { questionType: 'mcq_single', subjectName: 'Pathology' },
  };
}

describe('Live leaderboard endpoint', () => {
  let admin;
  let mentor;
  let studentA;
  let studentB;
  let outsider; // student assigned to the mentor's colleague? No — a student NOT mentored by `mentor`
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    mentor = await createUser({ role: 'mentor' });
    studentA = await createUser({ role: 'student', name: 'Alice Ranker' });
    studentB = await createUser({ role: 'student', name: 'Bob Ranker' });
    outsider = await createUser({ role: 'student', name: 'Carol Unmentored' });
    subject = await createSubject('Pathology');

    await MentorStudentAssignment.create({
      mentor: mentor.user._id,
      student: studentA.user._id,
      isActive: true,
      assignedBy: admin.user._id,
    });
    await MentorStudentAssignment.create({
      mentor: mentor.user._id,
      student: studentB.user._id,
      isActive: true,
      assignedBy: admin.user._id,
    });
  });

  async function createQuizWithQuestions(assignedStudents) {
    const questions = [
      await createQuestion(admin, subject),
      await createQuestion(admin, subject),
      await createQuestion(admin, subject),
      await createQuestion(admin, subject),
    ];
    const quiz = await Quiz.create({
      title: 'Leaderboard Test',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents,
      createdBy: admin.user._id,
    });
    return { quiz, questions };
  }

  async function createAttempt(quiz, questions, student, { status = 'completed', correct = 0, incorrect = 0, skipped = 0, endTime = new Date() }) {
    const answers = [];
    let index = 0;
    for (let i = 0; i < correct; i += 1) answers.push(answerRow(questions[index], index++, true));
    for (let i = 0; i < incorrect; i += 1) answers.push(answerRow(questions[index], index++, false));
    // Skipped questions have no answer row at all (never visited).

    const marksObtained = correct * 4 - incorrect * 1;
    return QuizAttempt.create({
      quiz: quiz._id,
      student: student.user._id,
      status,
      startTime: new Date(endTime.getTime() - 20 * 60 * 1000),
      endTime,
      score: correct,
      totalQuestions: questions.length,
      marksObtained,
      totalMarks: questions.length * 4,
      answers,
    });
  }

  it('rejects students and unauthenticated callers', async () => {
    const { quiz } = await createQuizWithQuestions([studentA.user._id]);

    const noAuth = await request(app).get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`);
    expect(noAuth.status).toBe(401);

    const asStudent = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${studentA.token}`);
    expect(asStudent.status).toBe(403);
  });

  it('returns 404 for an unknown test', async () => {
    const res = await request(app)
      .get('/api/quizzes/analytics/test/000000000000000000000000/leaderboard')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(404);
  });

  it('returns an empty leaderboard (with generatedAt) when nobody has submitted', async () => {
    const { quiz } = await createQuizWithQuestions([studentA.user._id]);

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toEqual([]);
    expect(res.body.generatedAt).toBeDefined();
  });

  it('ranks by score percentage and exposes the full row contract', async () => {
    const { quiz, questions } = await createQuizWithQuestions([
      studentA.user._id,
      studentB.user._id,
      outsider.user._id,
    ]);

    // Alice: 3 correct + 1 wrong → 11/16 = 68.75%
    await createAttempt(quiz, questions, studentA, { correct: 3, incorrect: 1 });
    // Bob: 2 correct + 2 wrong → 6/16 = 37.5%
    await createAttempt(quiz, questions, studentB, { correct: 2, incorrect: 2 });
    // Carol: all 4 correct → 16/16 = 100%
    await createAttempt(quiz, questions, outsider, { correct: 4 });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);

    const rows = res.body.leaderboard;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.studentName)).toEqual([
      outsider.user.name,
      studentA.user.name,
      studentB.user.name,
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);

    const top = rows[0];
    expect(top.scorePercentage).toBe(100);
    expect(top.accuracy).toBe(100);
    expect(top.correct).toBe(4);
    expect(top.incorrect).toBe(0);
    expect(top.skipped).toBe(0);
    expect(top.marksObtained).toBe(16);
    expect(top.totalMarks).toBe(16);
    expect(top.student.email).toBe(outsider.user.email);
    expect(top.completedAt).toBeDefined();
  });

  it('breaks score-percentage ties by accuracy', async () => {
    const { quiz, questions } = await createQuizWithQuestions([
      studentA.user._id,
      studentB.user._id,
    ]);

    // Both attempts land on 8/16 = 50% score percentage with different
    // accuracy: Alice answered 4 (2/4 = 50% acc), Bob answered 3 (2/3 ≈
    // 66.67% acc) — accuracy is the first tie-breaker, so Bob ranks first.
    await QuizAttempt.create({
      quiz: quiz._id,
      student: studentA.user._id,
      status: 'completed',
      endTime: new Date(),
      totalQuestions: 4,
      score: 2,
      marksObtained: 8,
      totalMarks: 16,
      answers: [
        answerRow(questions[0], 0, true),
        answerRow(questions[1], 1, true),
        answerRow(questions[2], 2, false),
        answerRow(questions[3], 3, false),
      ],
    });

    await QuizAttempt.create({
      quiz: quiz._id,
      student: studentB.user._id,
      status: 'completed',
      endTime: new Date(),
      totalQuestions: 4,
      score: 2,
      marksObtained: 8,
      totalMarks: 16,
      answers: [
        answerRow(questions[0], 0, true),
        answerRow(questions[1], 1, true),
        answerRow(questions[2], 2, false),
      ],
    });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);

    // Same 50% score; Alice answered 4 (2/4 = 50% acc), Bob answered 3
    // (2/3 ≈ 66.67% acc) — Bob ranks above Alice.
    expect(res.body.leaderboard.map((r) => r.studentName)).toEqual([
      studentB.user.name,
      studentA.user.name,
    ]);
  });

  it('includes auto_submitted attempts and excludes in-progress ones', async () => {
    const { quiz, questions } = await createQuizWithQuestions([
      studentA.user._id,
      studentB.user._id,
    ]);

    // Alice auto-submitted (timed out): 1 correct + 1 wrong.
    await createAttempt(quiz, questions, studentA, { status: 'auto_submitted', correct: 1, incorrect: 1 });
    // Bob still mid-test — must NOT appear on the leaderboard.
    await createAttempt(quiz, questions, studentB, { status: 'in_progress', correct: 4 });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toHaveLength(1);
    expect(res.body.leaderboard[0].studentName).toBe(studentA.user.name);
  });

  it('scopes the mentor leaderboard to their own students only', async () => {
    const { quiz, questions } = await createQuizWithQuestions([
      studentA.user._id,
      studentB.user._id,
      outsider.user._id,
    ]);

    await createAttempt(quiz, questions, studentA, { correct: 2, incorrect: 1 });
    await createAttempt(quiz, questions, studentB, { correct: 3, incorrect: 1 });
    await createAttempt(quiz, questions, outsider, { correct: 4 });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(res.status).toBe(200);

    const rows = res.body.leaderboard;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.studentName)).toEqual([studentB.user.name, studentA.user.name]);
    expect(rows.some((r) => r.studentName === outsider.user.name)).toBe(false);
  });

  it('reports rank null for a single attempt (leaderboard position is client-side index + 1)', async () => {
    const { quiz, questions } = await createQuizWithQuestions([studentA.user._id]);
    await createAttempt(quiz, questions, studentA, { correct: 2, incorrect: 1 });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toHaveLength(1);
    expect(res.body.leaderboard[0].rank).toBeNull();
  });
});

describe('Live leaderboard socket emission', () => {
  let admin;
  let student;
  let subject;
  let roomEmit;
  let fakeIo;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student', name: 'Live Submitter' });
    subject = await createSubject('Pathology');

    roomEmit = jest.fn();
    fakeIo = { to: jest.fn(() => ({ emit: roomEmit })) };
    // finalizeQuizAttempt reads the io instance off the app — the same
    // indirection server.js uses (app.set('io', io)).
    app.set('io', fakeIo);
  });

  async function setupQuiz() {
    const questions = [
      await createQuestion(admin, subject),
      await createQuestion(admin, subject),
    ];
    const quiz = await Quiz.create({
      title: 'Live Emission Test',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
    });
    return { quiz, questions };
  }

  it('emits quiz_leaderboard_updated to the test room on submission and the endpoint reflects it', async () => {
    const { quiz, questions } = await setupQuiz();

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(startRes.status).toBe(201);
    const attemptId = startRes.body.attemptId;

    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 1 })
      .expect(200);

    const submitRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect(submitRes.status).toBe(200);

    expect(fakeIo.to).toHaveBeenCalledWith(`leaderboard:${quiz._id}`);
    expect(roomEmit).toHaveBeenCalledTimes(1);
    const [event, payload] = roomEmit.mock.calls[0];
    expect(event).toBe('quiz_leaderboard_updated');
    expect(payload.quizId).toBe(quiz._id.toString());
    expect(payload.attemptId).toBe(attemptId.toString());
    expect(payload.studentId).toBe(student.user._id.toString());
    expect(payload.submittedAt).toBeDefined();

    // The leaderboard a viewer would refetch shows the submission: one
    // correct answer, one skipped question → 4/8 marks = 50%.
    const board = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(board.status).toBe(200);
    expect(board.body.leaderboard).toHaveLength(1);
    expect(board.body.leaderboard[0].correct).toBe(1);
    expect(board.body.leaderboard[0].incorrect).toBe(0);
    expect(board.body.leaderboard[0].skipped).toBe(1);
    expect(board.body.leaderboard[0].scorePercentage).toBe(50);
  });

  it('does not re-emit on a duplicate (idempotent) submit', async () => {
    const { quiz, questions } = await setupQuiz();

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    const attemptId = startRes.body.attemptId;

    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 1 })
      .expect(200);

    const first = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect(first.status).toBe(200);
    expect(roomEmit).toHaveBeenCalledTimes(1);

    const duplicate = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.isAlreadySubmitted).toBe(true);
    expect(roomEmit).toHaveBeenCalledTimes(1);

    // And exactly one row — the attempt was finalized once.
    const board = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(board.body.leaderboard).toHaveLength(1);
  });
});
