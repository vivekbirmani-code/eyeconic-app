const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
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
      question: `Auto question #${++questionSeed}?`,
      options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
      correctAnswer: 1,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body;
}

async function submitQuizAttempt(appInstance, student, quiz, question, selectedAnswer = 1) {
  const startRes = await request(appInstance)
    .post(`/api/quizzes/${quiz._id}/start`)
    .set('Authorization', `Bearer ${student.token}`);
  const attemptId = startRes.body.attemptId;

  await request(appInstance)
    .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({ questionIndex: 0, questionId: question._id, selectedAnswer });

  await request(appInstance)
    .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
    .set('Authorization', `Bearer ${student.token}`)
    .send({});

  return attemptId;
}

describe('Student performance analytics', () => {
  let admin;
  let studentA;
  let studentB;
  let mentor;
  let subject;
  let sharedQuestion;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    studentA = await createUser({ role: 'student' });
    studentB = await createUser({ role: 'student' });
    mentor = await createUser({ role: 'mentor' });
    subject = await createSubject('Pathology');
    sharedQuestion = await createQuestion(admin, subject, {
      question: 'Shared analytics question',
      options: ['A', 'B'],
      correctAnswer: 0,
    });
  });

  it('returns student self-service performance via /analytics/me', async () => {
    const quiz = await Quiz.create({
      title: 'Performance Quiz',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [sharedQuestion._id],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [studentA.user._id],
      createdBy: admin.user._id,
    });

    await submitQuizAttempt(app, studentA, quiz, sharedQuestion, 0);

    const res = await request(app)
      .get('/api/quizzes/analytics/me')
      .set('Authorization', `Bearer ${studentA.token}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.totalTests).toBe(1);
    expect(res.body.summary.totalCorrect).toBe(1);
    expect(res.body.attempts).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.student.id).toBe(studentA.user._id.toString());
  });

  it('isolates analytics between students for the same question', async () => {
    const makeQuiz = async (title, studentId) => Quiz.create({
      title,
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [sharedQuestion._id],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [studentId],
      createdBy: admin.user._id,
    });

    const quizA1 = await makeQuiz('A Quiz 1', studentA.user._id);
    const quizA2 = await makeQuiz('A Quiz 2', studentA.user._id);
    const quizA3 = await makeQuiz('A Quiz 3', studentA.user._id);
    const quizB1 = await makeQuiz('B Quiz 1', studentB.user._id);

    await submitQuizAttempt(app, studentA, quizA1, sharedQuestion, 1);
    await submitQuizAttempt(app, studentA, quizA2, sharedQuestion, 1);
    await submitQuizAttempt(app, studentA, quizA3, sharedQuestion, 1);
    await submitQuizAttempt(app, studentB, quizB1, sharedQuestion, 1);

    const resA = await request(app)
      .get(`/api/quizzes/analytics/student/${studentA.user._id}/frequently-missed`)
      .set('Authorization', `Bearer ${studentA.token}`);

    const resB = await request(app)
      .get(`/api/quizzes/analytics/student/${studentB.user._id}/frequently-missed`)
      .set('Authorization', `Bearer ${studentB.token}`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const missedA = resA.body.items.find((item) => item.questionId === sharedQuestion._id.toString());
    const missedB = resB.body.items.find((item) => item.questionId === sharedQuestion._id.toString());

    expect(missedA.incorrectAttempts).toBe(3);
    expect(missedB).toBeUndefined();
  });

  it('tracks question history chronologically per student', async () => {
    const quiz1 = await Quiz.create({
      title: 'History Quiz 1',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [sharedQuestion._id],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [studentA.user._id],
      createdBy: admin.user._id,
    });
    const quiz2 = await Quiz.create({
      title: 'History Quiz 2',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [sharedQuestion._id],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [studentA.user._id],
      createdBy: admin.user._id,
    });
    const quiz3 = await Quiz.create({
      title: 'History Quiz 3',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [sharedQuestion._id],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [studentA.user._id],
      createdBy: admin.user._id,
    });

    await submitQuizAttempt(app, studentA, quiz1, sharedQuestion, 1);
    await submitQuizAttempt(app, studentA, quiz2, sharedQuestion, 1);
    await submitQuizAttempt(app, studentA, quiz3, sharedQuestion, 0);

    const historyRes = await request(app)
      .get(`/api/quizzes/analytics/student/${studentA.user._id}/questions/${sharedQuestion._id}/history`)
      .set('Authorization', `Bearer ${studentA.token}`);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body.summary.totalAttempts).toBe(3);
    expect(historyRes.body.summary.correctAttempts).toBe(1);
    expect(historyRes.body.summary.incorrectAttempts).toBe(2);
    expect(historyRes.body.summary.latestResult).toBe('correct');
    expect(historyRes.body.attempts[0].result).toBe('correct');
  });

  it('rejects cross-student analytics access', async () => {
    const res = await request(app)
      .get(`/api/quizzes/analytics/student/${studentB.user._id}`)
      .set('Authorization', `Bearer ${studentA.token}`);

    expect(res.status).toBe(403);
  });

  it('allows mentor access only for assigned students', async () => {
    await MentorStudentAssignment.create({
      mentor: mentor.user._id,
      student: studentA.user._id,
      isActive: true,
      assignedBy: admin.user._id,
    });

    const allowed = await request(app)
      .get(`/api/quizzes/analytics/student/${studentA.user._id}`)
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(allowed.status).toBe(200);

    const denied = await request(app)
      .get(`/api/quizzes/analytics/student/${studentB.user._id}`)
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(denied.status).toBe(403);
  });

  it('paginates quiz history', async () => {
    for (let i = 0; i < 3; i += 1) {
      const quiz = await Quiz.create({
        title: `Paged Quiz ${i + 1}`,
        subject: subject._id,
        testType: 'daily',
        duration: 30,
        questions: [sharedQuestion._id],
        positiveMarks: 4,
        negativeMarks: 1,
        assignedStudents: [studentA.user._id],
        createdBy: admin.user._id,
      });
      await submitQuizAttempt(app, studentA, quiz, sharedQuestion, 0);
    }

    const page1 = await request(app)
      .get('/api/quizzes/analytics/me?page=1&limit=2')
      .set('Authorization', `Bearer ${studentA.token}`);
    const page2 = await request(app)
      .get('/api/quizzes/analytics/me?page=2&limit=2')
      .set('Authorization', `Bearer ${studentA.token}`);

    expect(page1.status).toBe(200);
    expect(page1.body.attempts).toHaveLength(2);
    expect(page1.body.pagination.total).toBe(3);
    expect(page2.body.attempts).toHaveLength(1);
  });

  it('returns empty state for new students', async () => {
    const res = await request(app)
      .get('/api/quizzes/analytics/me')
      .set('Authorization', `Bearer ${studentA.token}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.totalTests).toBe(0);
    expect(res.body.attempts).toHaveLength(0);
    expect(res.body.frequentlyMissedQuestions).toHaveLength(0);
  });

  it('does not count unattempted answers as incorrect in frequently missed', async () => {
    const quiz = await Quiz.create({
      title: 'Skipped Quiz',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [sharedQuestion._id],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [studentA.user._id],
      createdBy: admin.user._id,
    });

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${studentA.token}`);
    await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${startRes.body.attemptId}/submit`)
      .set('Authorization', `Bearer ${studentA.token}`)
      .send({});

    const res = await request(app)
      .get('/api/quizzes/analytics/me')
      .set('Authorization', `Bearer ${studentA.token}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.totalSkipped).toBe(1);
    expect(res.body.summary.totalIncorrect).toBe(0);
    expect(res.body.frequentlyMissedQuestions).toHaveLength(0);
  });
});
