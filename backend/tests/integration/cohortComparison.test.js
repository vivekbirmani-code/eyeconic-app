const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuestionBank = require('../../models/QuestionBank');
const QuizAttempt = require('../../models/QuizAttempt');

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
      question: `Comparison question #${++questionSeed}?`,
      options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
      correctAnswer: 1,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body;
}

/**
 * Answer row shaped like a graded attempt answer. `subjectName` controls the
 * frozen metadataSnapshot so multi-subject quizzes can be simulated.
 */
function answerRow(question, index, isCorrect, subjectName = 'Pathology') {
  return {
    questionIndex: index,
    questionId: question._id,
    selectedAnswer: isCorrect ? 1 : 2,
    isCorrect: Boolean(isCorrect),
    metadataSnapshot: { questionType: 'mcq_single', subjectName },
  };
}

describe('Student cohort comparison (GET /api/quizzes/analytics/me/comparison)', () => {
  let admin;
  let subject;

  async function createQuiz(title, questions, assignedStudents) {
    return Quiz.create({
      title,
      subject: subject._id,
      testType: 'grand',
      duration: 180,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents,
      createdBy: admin.user._id,
    });
  }

  /**
   * @param {object} opts
   * @param {number[]} opts.results per-question outcome: 1 correct, 0 wrong,
   *   null skipped. Marks = correct*4 - wrong*1 (quiz marking scheme).
   */
  async function createFinalizedAttempt(quiz, questions, student, opts = {}) {
    const {
      results = [],
      status = 'completed',
      endTime = new Date(),
      subjectOf = () => 'Pathology',
    } = opts;

    const answers = [];
    let correct = 0;
    let incorrect = 0;
    results.forEach((outcome, index) => {
      if (outcome === null) return; // never visited → no answer row
      if (outcome === 1) correct += 1;
      else incorrect += 1;
      answers.push(answerRow(questions[index], index, outcome === 1, subjectOf(index)));
    });

    return QuizAttempt.create({
      quiz: quiz._id,
      student: student.user._id,
      status,
      startTime: new Date(endTime.getTime() - 30 * 60 * 1000),
      endTime,
      score: correct,
      totalQuestions: questions.length,
      marksObtained: correct * 4 - incorrect * 1,
      totalMarks: questions.length * 4,
      answers,
    });
  }

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    subject = await createSubject('Pathology');
  });

  it('rejects unauthenticated callers, admins and mentors', async () => {
    const mentor = await createUser({ role: 'mentor' });
    const student = await createUser({ role: 'student' });

    const noAuth = await request(app).get('/api/quizzes/analytics/me/comparison');
    expect(noAuth.status).toBe(401);

    const asAdmin = await request(app)
      .get('/api/quizzes/analytics/me/comparison')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(asAdmin.status).toBe(403);

    const asMentor = await request(app)
      .get('/api/quizzes/analytics/me/comparison')
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(asMentor.status).toBe(403);

    // Sanity: the student reaches the endpoint.
    const asStudent = await request(app)
      .get('/api/quizzes/analytics/me/comparison')
      .set('Authorization', `Bearer ${student.token}`);
    expect(asStudent.status).toBe(200);
    expect(asStudent.body.hasEligibleAttempt).toBe(false);
  });

  it('returns the empty state when the student has no finalized attempts', async () => {
    const student = await createUser({ role: 'student' });
    const questions = [await createQuestion(admin, subject)];
    const quiz = await createQuiz('Untaken GT', questions, [student.user._id]);

    // In-progress attempt must not count as eligible.
    await QuizAttempt.create({
      quiz: quiz._id,
      student: student.user._id,
      status: 'in_progress',
      totalQuestions: 1,
      totalMarks: 4,
    });

    const res = await request(app)
      .get('/api/quizzes/analytics/me/comparison')
      .set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasEligibleAttempt).toBe(false);
    expect(res.body.cohort).toBeUndefined();
  });

  it('compares against the SAME quiz cohort with correct averages and percentile', async () => {
    const students = [];
    for (let i = 0; i < 6; i += 1) {
      students.push(await createUser({ role: 'student', name: `Student ${i}` }));
    }
    const me = students[0];

    const questions = [];
    for (let i = 0; i < 4; i += 1) questions.push(await createQuestion(admin, subject));
    const quiz = await createQuiz('GT 01', questions, students.map((s) => s.user._id));

    const recent = new Date('2026-09-20T10:00:00Z');

    // Me: 3 correct + 1 wrong → 12-1 = 11/16.
    await createFinalizedAttempt(quiz, questions, me, { results: [1, 1, 1, 0], endTime: recent });
    // Marks: 16, 12 (3 correct), 6 (2c+2w), 2 (1c+2w), -2 (0c+2w).
    await createFinalizedAttempt(quiz, questions, students[1], { results: [1, 1, 1, 1], endTime: recent });
    await createFinalizedAttempt(quiz, questions, students[2], { results: [1, 1, 1, null], endTime: recent });
    await createFinalizedAttempt(quiz, questions, students[3], { results: [1, 1, 0, 0], endTime: recent });
    await createFinalizedAttempt(quiz, questions, students[4], { results: [1, 0, 0, null], endTime: recent });
    await createFinalizedAttempt(quiz, questions, students[5], { results: [0, 0, null, null], endTime: recent });

    // A DIFFERENT quiz the caller also took, EARLIER — must not contaminate
    // the cohort and must not be the selected attempt.
    const otherQuestions = [await createQuestion(admin, subject)];
    const otherQuiz = await createQuiz('GT 02', otherQuestions, [me.user._id]);
    await createFinalizedAttempt(otherQuiz, otherQuestions, me, {
      results: [1],
      endTime: new Date('2026-09-01T10:00:00Z'),
    });

    const res = await request(app)
      .get('/api/quizzes/analytics/me/comparison')
      .set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);

    expect(res.body.hasEligibleAttempt).toBe(true);
    expect(res.body.quiz.title).toBe('GT 01');
    expect(res.body.attempt.marksObtained).toBe(11);
    expect(res.body.attempt.totalMarks).toBe(16);
    expect(res.body.attempt.scorePercentage).toBe(68.75);

    const cohort = res.body.cohort;
    expect(cohort.totalStudents).toBe(6);
    expect(cohort.sufficient).toBe(true);
    // (11+16+12+6+2-2)/6 = 45/6 = 7.5
    expect(cohort.averageMarks).toBe(7.5);
    expect(cohort.highestMarks).toBe(16);
    // Percentile (excludeSelf convention): others strictly below 11 are
    // 6, 2, -2 → 3 of 5 → 60. Top percent is the complement → 40.
    expect(cohort.percentile).toBe(60);
    expect(cohort.topPercent).toBe(40);

    // Distribution buckets by score percentage: -2/16 & 2/16 → 0–20,
    // 6/16=37.5 → 21–40, none 41–60, 11/16 & 12/16 → 61–80, 16/16 → 81–100.
    const byLabel = Object.fromEntries(cohort.scoreDistribution.map((b) => [b.label, b.count]));
    expect(byLabel['0–20%']).toBe(2);
    expect(byLabel['21–40%']).toBe(1);
    expect(byLabel['41–60%']).toBe(0);
    expect(byLabel['61–80%']).toBe(2);
    expect(byLabel['81–100%']).toBe(1);
  });

  it('selects the MOST RECENT eligible attempt across quizzes', async () => {
    const student = await createUser({ role: 'student' });

    const q1 = [await createQuestion(admin, subject)];
    const q2 = [await createQuestion(admin, subject)];
    const olderQuiz = await createQuiz('Older GT', q1, [student.user._id]);
    const newerQuiz = await createQuiz('Newer GT', q2, [student.user._id]);

    const older = new Date('2026-09-01T10:00:00Z');
    const newer = new Date('2026-09-20T10:00:00Z');
    await createFinalizedAttempt(olderQuiz, q1, student, { results: [1], endTime: older });
    await createFinalizedAttempt(newerQuiz, q2, student, { results: [0], endTime: newer });

    const res = await request(app)
      .get('/api/quizzes/analytics/me/comparison')
      .set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(200);
    expect(res.body.quiz.title).toBe('Newer GT');
    expect(res.body.attempt.marksObtained).toBe(-1);
  });

  it('counts one attempt per student (approved retest does not double-weight)', async () => {
    const students = [];
    for (let i = 0; i < 5; i += 1) {
      students.push(await createUser({ role: 'student', name: `Retest cohort ${i}` }));
    }
    const me = students[0];

    const questions = [];
    for (let i = 0; i < 2; i += 1) questions.push(await createQuestion(admin, subject));
    const quiz = await createQuiz('Retest GT', questions, students.map((s) => s.user._id));

    // Me: an approved retest — old attempt (worse, earlier) + latest attempt.
    await createFinalizedAttempt(quiz, questions, me, {
      results: [0, 0],
      endTime: new Date('2026-09-01T10:00:00Z'),
    });
    await createFinalizedAttempt(quiz, questions, me, {
      results: [1, 1],
      endTime: new Date('2026-09-10T10:00:00Z'),
    });
    for (let i = 1; i < 5; i += 1) {
      await createFinalizedAttempt(quiz, questions, students[i], { results: [1, 0] });
    }

    const res = await request(app)
      .get('/api/quizzes/analytics/me/comparison')
      .set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.cohort.totalStudents).toBe(5); // not 6
    // My latest attempt (8 marks) is the one compared, not the old 4-wrong one.
    expect(res.body.attempt.marksObtained).toBe(8);
    // Average over one attempt per student: (8 + 3*4) / 5 = 4.
    expect(res.body.cohort.averageMarks).toBe(4);
  });

  it('withholds comparative stats below the minimum cohort size (privacy floor)', async () => {
    const a = await createUser({ role: 'student', name: 'Small A' });
    const b = await createUser({ role: 'student', name: 'Small B' });

    const questions = [await createQuestion(admin, subject)];
    const quiz = await createQuiz('Small GT', questions, [a.user._id, b.user._id]);

    await createFinalizedAttempt(quiz, questions, a, { results: [1] });
    await createFinalizedAttempt(quiz, questions, b, { results: [0] });

    const res = await request(app)
      .get('/api/quizzes/analytics/me/comparison')
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasEligibleAttempt).toBe(true);
    expect(res.body.attempt.marksObtained).toBe(4); // own score still shown
    expect(res.body.cohort.sufficient).toBe(false);
    expect(res.body.cohort.totalStudents).toBe(2);
    expect(res.body.cohort.averageMarks).toBeNull();
    expect(res.body.cohort.percentile).toBeNull();
    expect(res.body.cohort.scoreDistribution).toBeNull();
    expect(res.body.cohort.subjectWise).toBeNull();
  });

  it('builds subject-wise my-vs-average rows from frozen subject snapshots', async () => {
    const students = [];
    for (let i = 0; i < 5; i += 1) {
      students.push(await createUser({ role: 'student', name: `Subject cohort ${i}` }));
    }
    const me = students[0];

    const questions = [];
    for (let i = 0; i < 4; i += 1) questions.push(await createQuestion(admin, subject));
    const quiz = await createQuiz('Multi-subject GT', questions, students.map((s) => s.user._id));

    // Questions 0-1 → Anatomy, questions 2-3 → Physiology.
    const subjectOf = (index) => (index < 2 ? 'Anatomy' : 'Physiology');

    // Me: Anatomy 2/2 correct (8 marks), Physiology 1 correct + 1 wrong (3).
    await createFinalizedAttempt(quiz, questions, me, {
      results: [1, 1, 1, 0],
      subjectOf,
    });
    // Others: uniform 1 correct + 1 wrong per subject (3 marks per subject).
    for (let i = 1; i < 5; i += 1) {
      await createFinalizedAttempt(quiz, questions, students[i], {
        results: [1, 0, 1, 0],
        subjectOf,
      });
    }

    const res = await request(app)
      .get('/api/quizzes/analytics/me/comparison')
      .set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);

    const rows = res.body.cohort.subjectWise;
    expect(rows).toHaveLength(2);

    const anatomy = rows.find((r) => r.subjectName === 'Anatomy');
    expect(anatomy.questionCount).toBe(2);
    expect(anatomy.myMarks).toBe(8);
    expect(anatomy.myCorrect).toBe(2);
    // The average includes every cohort member — me included: (8 + 4*3)/5 = 4.
    expect(anatomy.avgMarks).toBe(4);

    const physiology = rows.find((r) => r.subjectName === 'Physiology');
    expect(physiology.myMarks).toBe(3);
    expect(physiology.avgMarks).toBe(3);
  });

  it('never exposes another student identity or individual score', async () => {
    const students = [];
    for (let i = 0; i < 5; i += 1) {
      students.push(
        await createUser({
          role: 'student',
          name: `Private Person ${i}`,
          email: `private-${i}-${Date.now()}@example.com`,
        })
      );
    }
    const me = students[0];

    const questions = [];
    for (let i = 0; i < 3; i += 1) questions.push(await createQuestion(admin, subject));
    const quiz = await createQuiz('Privacy GT', questions, students.map((s) => s.user._id));

    for (let i = 0; i < 5; i += 1) {
      await createFinalizedAttempt(quiz, questions, students[i], {
        results: [1, 1, i % 2],
      });
    }

    const res = await request(app)
      .get('/api/quizzes/analytics/me/comparison')
      .set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);

    const payload = JSON.stringify(res.body);
    students.slice(1).forEach((other) => {
      expect(payload).not.toContain(other.user.name);
      expect(payload).not.toContain(other.user.email);
      expect(payload).not.toContain(String(other.user._id));
    });
  });

  it('includes auto_submitted attempts in the cohort but not in-progress ones', async () => {
    const students = [];
    for (let i = 0; i < 5; i += 1) {
      students.push(await createUser({ role: 'student', name: `Mixed ${i}` }));
    }
    const me = students[0];

    const questions = [await createQuestion(admin, subject)];
    const quiz = await createQuiz('Mixed GT', questions, students.map((s) => s.user._id));

    await createFinalizedAttempt(quiz, questions, me, {
      results: [1],
      status: 'auto_submitted',
    });
    for (let i = 1; i < 4; i += 1) {
      await createFinalizedAttempt(quiz, questions, students[i], { results: [1] });
    }
    // Fifth student still writing — excluded, cohort stays at 4 (insufficient).
    await QuizAttempt.create({
      quiz: quiz._id,
      student: students[4].user._id,
      status: 'in_progress',
      totalQuestions: 1,
      totalMarks: 4,
    });

    const res = await request(app)
      .get('/api/quizzes/analytics/me/comparison')
      .set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.attempt.status).toBe('auto_submitted');
    expect(res.body.cohort.totalStudents).toBe(4);
    expect(res.body.cohort.sufficient).toBe(false);
  });
});
