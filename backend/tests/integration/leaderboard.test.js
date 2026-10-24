const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuestionBank = require('../../models/QuestionBank');
const QuizAttempt = require('../../models/QuizAttempt');
const GuestAttempt = require('../../models/GuestAttempt');
const Guest = require('../../models/Guest');
const MentorStudentAssignment = require('../../models/MentorStudentAssignment');
const socketHelpers = require('../../utils/socket-helpers');
const quizRoutes = require('../../routes/quizzes');

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

// Shared by both leaderboard describes (registered rows for the merged board).
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

describe('Live leaderboard — external (public-quiz) participants', () => {
  let admin;
  let mentor;
  let studentA;
  let studentB;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    mentor = await createUser({ role: 'mentor' });
    studentA = await createUser({ role: 'student', name: 'Alice Ranker' });
    studentB = await createUser({ role: 'student', name: 'Bob Ranker' });
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

  // Local stem counter (distinct prefix from the first describe's questions —
  // same-subject duplicate stems are rejected).
  let questionSeed = 0;

  async function createQuestion() {
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        subject: subject._id,
        topicName: 'Genetics',
        subtopicName: 'Mendelian Inheritance',
        system: 'Genetic Disorders',
        questionType: 'mcq_single',
        difficulty: 'medium',
        question: `External leaderboard question #${++questionSeed}?`,
        options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
        correctAnswer: 1,
      });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function createQuiz() {
    const questions = [
      await createQuestion(),
      await createQuestion(),
      await createQuestion(),
      await createQuestion(),
    ];
    const quiz = await Quiz.create({
      title: 'Merged Leaderboard Test',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [studentA.user._id, studentB.user._id],
      createdBy: admin.user._id,
    });
    return { quiz, questions };
  }

  async function createLead(name) {
    return Guest.create({
      name,
      email: `${name.split(' ')[0].toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@guest.test`,
      emailVerifiedAt: new Date(),
      phone: `+9198${String(Date.now()).slice(-8)}`,
      source: 'web',
    });
  }

  // Mirrors what /start snapshots onto a lead-backed guest attempt.
  async function createGuestAttempt(quiz, questions, lead, {
    status = 'completed',
    correct = 0,
    incorrect = 0,
    endTime = new Date(),
    linkedUser = null,
  } = {}) {
    const answers = [];
    let index = 0;
    for (let i = 0; i < correct; i += 1) answers.push(answerRow(questions[index], index++, true));
    for (let i = 0; i < incorrect; i += 1) answers.push(answerRow(questions[index], index++, false));

    return GuestAttempt.create({
      quiz: quiz._id,
      guestId: `device-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      guest: lead._id,
      guestName: lead.name,
      guestEmail: lead.email,
      guestPhone: lead.phone,
      status,
      startTime: new Date(endTime.getTime() - 15 * 60 * 1000),
      endTime,
      score: correct,
      totalQuestions: questions.length,
      marksObtained: correct * 4 - incorrect * 1,
      totalMarks: questions.length * 4,
      answers,
      ...(linkedUser ? { linkedUser } : {}),
    });
  }

  it('ranks internal and external participants together for admins', async () => {
    const { quiz, questions } = await createQuiz();

    // Alice: 3 correct + 1 wrong → 11/16 = 68.75%.
    await createAttempt(quiz, questions, studentA, { correct: 3, incorrect: 1 });
    const topLead = await createLead('Dhruv Guest');
    const lowLead = await createLead('Esha Guest');
    // Dhruv: 4 correct → 16/16 = 100%. Esha: 2 correct + 2 wrong → 6/16 = 37.5%.
    await createGuestAttempt(quiz, questions, topLead, { correct: 4 });
    await createGuestAttempt(quiz, questions, lowLead, { correct: 2, incorrect: 2 });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);

    const rows = res.body.leaderboard;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.studentName)).toEqual(['Dhruv Guest', 'Alice Ranker', 'Esha Guest']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);

    const [top, internal, low] = rows;
    expect(top.participantType).toBe('external');
    expect(top.guestId).toBe(topLead._id.toString());
    expect(top.studentId).toBeNull();
    expect(top.studentEmail).toBe(topLead.email);
    expect(top.marksObtained).toBe(16);
    expect(top.scorePercentage).toBe(100);

    expect(internal.participantType).toBe('internal');
    expect(internal.guestId).toBeUndefined();
    expect(internal.studentId).toBe(studentA.user._id.toString());

    expect(low.participantType).toBe('external');
    expect(low.correct).toBe(2);
    expect(low.incorrect).toBe(2);
  });

  it('keeps the mentor board registered-only (external data is admin-only)', async () => {
    const { quiz, questions } = await createQuiz();
    await createAttempt(quiz, questions, studentA, { correct: 3, incorrect: 1 });
    const lead = await createLead('Vera External');
    await createGuestAttempt(quiz, questions, lead, { correct: 4 });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(res.status).toBe(200);

    const rows = res.body.leaderboard;
    expect(rows).toHaveLength(1);
    expect(rows[0].studentName).toBe(studentA.user.name);
    expect(rows[0].participantType).toBe('internal');
  });

  it('excludes legacy anonymous (device-keyed, no lead) guest attempts', async () => {
    const { quiz, questions } = await createQuiz();
    await GuestAttempt.create({
      quiz: quiz._id,
      guestId: 'anon-device-1',
      status: 'completed',
      startTime: new Date(Date.now() - 15 * 60 * 1000),
      endTime: new Date(),
      score: 4,
      totalQuestions: 4,
      marksObtained: 16,
      totalMarks: 16,
      answers: [],
    });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toEqual([]);
  });

  it('does not double-count a guest attempt materialized into a QuizAttempt at signup', async () => {
    const { quiz, questions } = await createQuiz();

    // Vera took the public quiz, then signed up: her guest attempt is marked
    // linked and Bob (her account) holds the materialized QuizAttempt.
    const lead = await createLead('Vera Linked');
    await createGuestAttempt(quiz, questions, lead, { correct: 4, linkedUser: studentB.user._id });
    await createAttempt(quiz, questions, studentB, { correct: 4 });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);

    const rows = res.body.leaderboard;
    expect(rows).toHaveLength(1);
    expect(rows[0].studentName).toBe(studentB.user.name);
    expect(rows[0].participantType).toBe('internal');
  });

  it('includes auto_submitted guest attempts and excludes in-progress ones', async () => {
    const { quiz, questions } = await createQuiz();
    const doneLead = await createLead('Auto Submitted');
    const liveLead = await createLead('Still Going');
    await createGuestAttempt(quiz, questions, doneLead, { status: 'auto_submitted', correct: 2, incorrect: 1 });
    await createGuestAttempt(quiz, questions, liveLead, { status: 'in_progress', correct: 4 });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toHaveLength(1);
    expect(res.body.leaderboard[0].studentName).toBe('Auto Submitted');
    expect(res.body.leaderboard[0].participantType).toBe('external');
  });

  it('stays isolated per quiz (guest attempts on another quiz never appear)', async () => {
    const { quiz, questions } = await createQuiz();
    const otherQuiz = await Quiz.create({
      title: 'Other Quiz',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      createdBy: admin.user._id,
    });
    const lead = await createLead('Wrong Quiz');
    await createGuestAttempt(otherQuiz, questions, lead, { correct: 4 });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toEqual([]);
  });

  it('renders the attempt snapshot identity when the lead record was deleted', async () => {
    const { quiz, questions } = await createQuiz();
    const lead = await createLead('Snapshot Survivor');
    await createGuestAttempt(quiz, questions, lead, { correct: 1, incorrect: 1 });
    await Guest.findByIdAndDelete(lead._id);

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toHaveLength(1);
    expect(res.body.leaderboard[0].studentName).toBe('Snapshot Survivor');
    expect(res.body.leaderboard[0].studentEmail).toBe(lead.email);
    expect(res.body.leaderboard[0].guestId).toBe(lead._id.toString());
  });

  it('falls back to "Guest" only when neither snapshot nor lead carries a name', async () => {
    const { quiz, questions } = await createQuiz();
    const lead = await createLead('Has A Name');
    const attempt = await createGuestAttempt(quiz, questions, lead, { correct: 1 });
    // Wipe the snapshot name AND the lead's name — nothing left to show.
    await GuestAttempt.updateOne({ _id: attempt._id }, { $unset: { guestName: 1 } });
    await Guest.updateOne({ _id: lead._id }, { $unset: { name: 1 } });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.leaderboard[0].studentName).toBe('Guest');
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
    // indirection server.js uses (app.set('io', io)). Request-less paths
    // (sweep, guest grader) fall back to the setIo-registered instance.
    app.set('io', fakeIo);
    socketHelpers.setIo(fakeIo);
  });

  afterEach(() => {
    socketHelpers.setIo(null);
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
    expect(payload.cohort).toBe('internal');
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

  it('emits a cohort:external nudge when a public-quiz guest submits (and not again on replay)', async () => {
    // Public quiz with a live share link; an anonymous device-keyed guest
    // attempt in progress (the legacy mobile flow shape — no lead required).
    const questions = [await createQuestion(admin, subject), await createQuestion(admin, subject)];
    const quiz = await Quiz.create({
      title: 'Live Guest Emission Test',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      isPublic: true,
      isActive: true,
      shareToken: `live-guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      publicExpiryDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdBy: admin.user._id,
    });
    const guestId = `guest-device-${Date.now()}`;
    const attempt = await GuestAttempt.create({
      quiz: quiz._id,
      guestId,
      status: 'in_progress',
      startTime: new Date(Date.now() - 5 * 60 * 1000),
      answers: [],
    });

    const submit = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .send({
        guestId,
        attemptId: attempt._id,
        answers: [
          { questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 1 },
          { questionIndex: 1, questionId: questions[1]._id, selectedAnswer: 2 },
        ],
      });
    expect(submit.status).toBe(200);
    expect(submit.body.submitted).toBe(true);

    expect(fakeIo.to).toHaveBeenCalledWith(`leaderboard:${quiz._id}`);
    expect(roomEmit).toHaveBeenCalledTimes(1);
    const [event, payload] = roomEmit.mock.calls[0];
    expect(event).toBe('quiz_leaderboard_updated');
    expect(payload.quizId).toBe(quiz._id.toString());
    expect(payload.attemptId).toBe(attempt._id.toString());
    expect(payload.cohort).toBe('external');
    expect(payload.studentId).toBeUndefined();
    expect(payload.submittedAt).toBeDefined();

    // Replay of the same submit is refused (non-section-lock attempts keep
    // the historical 400) and the CAS inside the grader means no re-emit.
    const replay = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .send({ guestId, attemptId: attempt._id, answers: [] });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('ALREADY_SUBMITTED');
    expect(roomEmit).toHaveBeenCalledTimes(1);
  });

  it('ranks a lead-backed external submission end to end: /start → /submit → nudge → merged board', async () => {
    const questions = [await createQuestion(admin, subject), await createQuestion(admin, subject)];
    const quiz = await Quiz.create({
      title: 'Merged Board E2E Test',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      isPublic: true,
      isActive: true,
      shareToken: `merged-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      publicExpiryDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdBy: admin.user._id,
    });

    // Verified lead (the web OTP flow's outcome) — leads are the only guest
    // cohort the merged board ranks.
    const { signGuestToken } = require('../../middleware/guestAuth');
    const lead = await Guest.create({
      name: 'Vera Boardmaker',
      email: `vera-board-${Date.now()}@guest.test`,
      emailVerifiedAt: new Date(),
      phone: `+9198${String(Date.now()).slice(-8)}`,
      source: 'web',
    });
    const guestToken = signGuestToken(lead._id);
    const deviceKey = `merged-device-${Date.now()}`;

    const start = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ guestId: deviceKey });
    expect(start.status).toBe(201);
    const guestAttemptId = start.body.attempt._id;

    const submit = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({
        guestId: deviceKey,
        attemptId: guestAttemptId,
        answers: [
          { questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 1 },
        ],
      });
    expect(submit.status).toBe(200);
    expect(submit.body.submitted).toBe(true);

    expect(fakeIo.to).toHaveBeenCalledWith(`leaderboard:${quiz._id}`);
    const nudge = roomEmit.mock.calls.at(-1)[1];
    expect(nudge.cohort).toBe('external');
    expect(nudge.attemptId).toBe(guestAttemptId.toString());

    // The refetch a viewer does on that nudge now ranks her on the board:
    // 1 correct + 1 skipped → 4/8 marks = 50%.
    const board = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(board.status).toBe(200);
    expect(board.body.leaderboard).toHaveLength(1);
    const row = board.body.leaderboard[0];
    expect(row.studentName).toBe('Vera Boardmaker');
    expect(row.participantType).toBe('external');
    expect(row.guestId).toBe(lead._id.toString());
    expect(row.scorePercentage).toBe(50);
    expect(row.correct).toBe(1);
    expect(row.skipped).toBe(1);
  });

  it('emits from the request-less lazy/sweep finalize path (overdue attempt)', async () => {
    const { quiz, questions } = await setupQuiz();

    // Overdue flat attempt: durationDeadline passed by more than the 30s
    // grace. The sweep (utils/attemptSweep.js) hands exactly this shape to
    // enforceAttemptDeadlines with req: null.
    const attempt = await QuizAttempt.create({
      quiz: quiz._id,
      student: student.user._id,
      status: 'in_progress',
      startTime: new Date(Date.now() - 60 * 60 * 1000),
      durationDeadline: new Date(Date.now() - 5 * 60 * 1000),
      answers: [answerRow(questions[0], 0, true)],
    });

    const result = await quizRoutes.enforceAttemptDeadlines(attempt, quiz, { req: null });
    expect(result.finalized).toBe(true);

    expect(fakeIo.to).toHaveBeenCalledWith(`leaderboard:${quiz._id}`);
    expect(roomEmit).toHaveBeenCalledTimes(1);
    const [event, payload] = roomEmit.mock.calls[0];
    expect(event).toBe('quiz_leaderboard_updated');
    expect(payload.quizId).toBe(quiz._id.toString());
    expect(payload.attemptId).toBe(attempt._id.toString());
    expect(payload.studentId).toBe(student.user._id.toString());
    expect(payload.cohort).toBe('internal');
    expect(payload.submittedAt).toBeDefined();

    // The finalized attempt is what a viewer's refetch would now rank.
    const board = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(board.body.leaderboard).toHaveLength(1);
    expect(board.body.leaderboard[0].correct).toBe(1);
  });
});
