const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuestionBank = require('../../models/QuestionBank');
const QuizAttempt = require('../../models/QuizAttempt');
const { MIN_COMPARISON_COHORT } = require('../../utils/miniGt');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

const SUBJECTS = ['Psychiatry', 'Dermatology', 'Orthopaedics'];
const QUESTIONS_PER_SUBJECT = 10;

let admin;
let subjects = {}; // name → subject doc
let paidStudent;
let freeStudent;

async function seedQuestion(subjectName, index) {
  const question = await QuestionBank.create({
    subject: subjects[subjectName]._id,
    topicName: `${subjectName} Topic ${Math.floor(index / 3)}`,
    subtopicName: 'Core',
    system: `${subjectName} System`,
    questionType: 'mcq_single',
    difficulty: 'medium',
    question: `${subjectName} question #${index}?`,
    options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    correctAnswer: 1,
    explanation: 'Beta is correct.',
    // 1–3 concept tags; every third question also carries provenance junk that
    // must never surface in tag analytics.
    tags: index % 3 === 0
      ? [`${subjectName} Concept ${index % 3}`, 'excel-import', 'quiz:FMGE Quiz 1']
      : [`${subjectName} Concept ${index % 3}`, `${subjectName} Concept ${(index + 1) % 3}`],
  });
  return question;
}

async function seedBank(perSubject = QUESTIONS_PER_SUBJECT) {
  const bySubject = {};
  for (const subjectName of SUBJECTS) {
    bySubject[subjectName] = [];
    for (let i = 0; i < perSubject; i += 1) {
      bySubject[subjectName].push(await seedQuestion(subjectName, i));
    }
  }
  return bySubject;
}

/**
 * Finalized attempt with graded answer rows carrying the submit-time
 * metadataSnapshot (exactly what the engine writes at finalize).
 */
async function finalizedAttempt(quiz, student, outcomes, questions, opts = {}) {
  const answers = [];
  let correct = 0;
  let incorrect = 0;
  outcomes.forEach((outcome, index) => {
    if (outcome === null) return;
    const q = questions[index];
    if (outcome) correct += 1;
    else incorrect += 1;
    answers.push({
      questionIndex: index,
      questionId: q._id,
      selectedAnswer: outcome ? 1 : 2,
      isCorrect: Boolean(outcome),
      metadataSnapshot: {
        subjectName: q.subject.name,
        topicName: q.topicName,
        questionType: 'mcq_single',
        tags: q.tags,
      },
    });
  });
  return QuizAttempt.create({
    quiz: quiz._id,
    student: student.user._id,
    status: opts.status || 'completed',
    startTime: new Date('2026-09-25T10:00:00Z'),
    endTime: new Date('2026-09-25T10:20:00Z'),
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
  for (const name of SUBJECTS) {
    subjects[name] = await createSubject(name.toUpperCase());
  }
  paidStudent = await createUser({ role: 'student' });
  freeStudent = await createUser({ role: 'student' });
  await paidStudent.user.updateOne({ isFreeUser: false });
  await freeStudent.user.updateOne({ isFreeUser: true });
});

describe('POST /api/mini-gt/generate', () => {
  it('rejects unauthenticated and non-admin callers', async () => {
    expect((await request(app).post('/api/mini-gt/generate')).status).toBe(401);
    expect(
      (await request(app).post('/api/mini-gt/generate').set('Authorization', `Bearer ${paidStudent.token}`)).status
    ).toBe(403);
  });

  it('creates a 30-question mini quiz with 10 per subject, assigned to free users', async () => {
    await seedBank();

    const res = await request(app)
      .post('/api/mini-gt/generate')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.questionCount).toBe(30);
    expect(res.body.perSubject).toEqual(
      SUBJECTS.map((name) => expect.objectContaining({ subjectName: name.toUpperCase(), picked: 10 }))
    );

    const quiz = await Quiz.findById(res.body.quizId)
      .populate({ path: 'questions', populate: { path: 'subject', select: 'name' } });
    expect(quiz.testType).toBe('mini');
    expect(quiz.assignToAllFreeUsers).toBe(true);
    expect(quiz.duration).toBe(30);
    expect(String(quiz.assignedStudents[0])).toBe(String(freeStudent.user._id));
    // Subject blocks in canonical order.
    const names = quiz.questions.map((q) => q.subject.name);
    const firstOf = (name) => names.indexOf(name);
    expect(firstOf('PSYCHIATRY')).toBe(0);
    expect(firstOf('DERMATOLOGY')).toBe(10);
    expect(firstOf('ORTHOPAEDICS')).toBe(20);
  });

  it('refuses when the bank cannot field 10 single-best-answer questions per subject', async () => {
    await seedBank(3);
    const res = await request(app)
      .post('/api/mini-gt/generate')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INSUFFICIENT_QUESTIONS');
    expect(res.body.perSubject[0]).toMatchObject({ picked: 3, availability: 3 });
  });

  it('refuses duplicate titles', async () => {
    await seedBank();
    const first = await request(app)
      .post('/api/mini-gt/generate')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ title: 'My Mini GT' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/mini-gt/generate')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ title: 'My Mini GT' });
    expect(second.status).toBe(400);
    expect(second.body.code).toBe('DUPLICATE_TITLE');
  });
});

describe('GET /api/mini-gt/latest', () => {
  it('requires a student session', async () => {
    expect((await request(app).get('/api/mini-gt/latest')).status).toBe(401);
    expect(
      (await request(app).get('/api/mini-gt/latest').set('Authorization', `Bearer ${admin.token}`)).status
    ).toBe(403);
  });

  it('returns quiz null when no Mini GT exists', async () => {
    const res = await request(app)
      .get('/api/mini-gt/latest')
      .set('Authorization', `Bearer ${paidStudent.token}`);
    expect(res.status).toBe(200);
    expect(res.body.quiz).toBeNull();
  });

  it('shows the Mini GT to a free user who is NOT in assignedStudents', async () => {
    await seedBank();
    const gen = await request(app)
      .post('/api/mini-gt/generate')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({});
    // A free user who signed up AFTER generation: not in assignedStudents.
    const lateFreeUser = await createUser({ role: 'student' });
    await lateFreeUser.user.updateOne({ isFreeUser: true });

    const res = await request(app)
      .get('/api/mini-gt/latest')
      .set('Authorization', `Bearer ${lateFreeUser.token}`);
    expect(res.status).toBe(200);
    expect(res.body.quiz._id).toBe(gen.body.quizId);
    expect(res.body.quiz.questionCount).toBe(30);
    expect(res.body.quiz.subjectNames).toEqual(['PSYCHIATRY', 'DERMATOLOGY', 'ORTHOPAEDICS']);
    expect(res.body.quiz.attemptStatus.hasAttempted).toBe(false);
  });

  it('shows the Mini GT to a paid student who is NOT assigned (self-serve)', async () => {
    await seedBank();
    const gen = await request(app)
      .post('/api/mini-gt/generate')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({});

    const res = await request(app)
      .get('/api/mini-gt/latest')
      .set('Authorization', `Bearer ${paidStudent.token}`);
    expect(res.status).toBe(200);
    expect(res.body.quiz._id).toBe(gen.body.quizId);
    expect(res.body.quiz.attemptStatus.hasAttempted).toBe(false);

    // Self-serve parity in the quiz LIST: My Tests shows it to paid students too.
    const list = await request(app)
      .get('/api/quizzes')
      .set('Authorization', `Bearer ${paidStudent.token}`);
    expect(list.status).toBe(200);
    expect(list.body.some((q) => String(q._id) === String(gen.body.quizId))).toBe(true);
  });
});

describe('free-user access to assignToAllFreeUsers quizzes (engine parity)', () => {
  it('lets a late-signup free user load the detail and start the quiz', async () => {
    await seedBank();
    const gen = await request(app)
      .post('/api/mini-gt/generate')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({});
    const lateFreeUser = await createUser({ role: 'student' });
    await lateFreeUser.user.updateOne({ isFreeUser: true });

    const detail = await request(app)
      .get(`/api/quizzes/${gen.body.quizId}`)
      .set('Authorization', `Bearer ${lateFreeUser.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.questions).toHaveLength(30);
    // Answer key must be stripped for students.
    expect(detail.body.questions.every((q) => q.correctAnswer === undefined)).toBe(true);

    const start = await request(app)
      .post(`/api/quizzes/${gen.body.quizId}/start`)
      .set('Authorization', `Bearer ${lateFreeUser.token}`)
      .send({});
    expect(start.status).toBe(201);
    expect(start.body.attemptId).toBeTruthy();
  });

  it('lets an unassigned paid student start the SELF-SERVE mini quiz, but not a non-mini free-for-all quiz', async () => {
    await seedBank();
    const gen = await request(app)
      .post('/api/mini-gt/generate')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({});

    const start = await request(app)
      .post(`/api/quizzes/${gen.body.quizId}/start`)
      .set('Authorization', `Bearer ${paidStudent.token}`)
      .send({});
    expect(start.status).toBe(201);

    // The free-for-all clause alone still does not cover paid students —
    // only the explicit testType:'mini' self-serve rule does.
    const bySubject = await seedBank(4);
    const grandQuestions = bySubject.Psychiatry.map((q) => q._id);
    const freeForAllQuiz = await Quiz.create({
      title: 'Free For All Weekly',
      subject: subjects.Psychiatry._id,
      testType: 'weekly',
      duration: 30,
      questions: grandQuestions,
      totalMarks: grandQuestions.length * 4,
      createdBy: admin.user._id,
      assignToAllFreeUsers: true,
      assignedStudents: [freeStudent.user._id],
    });
    const refused = await request(app)
      .post(`/api/quizzes/${freeForAllQuiz._id}/start`)
      .set('Authorization', `Bearer ${paidStudent.token}`)
      .send({});
    expect(refused.status).toBe(403);

    // ...while a free user may start it (assignToAllFreeUsers rule).
    const freeStart = await request(app)
      .post(`/api/quizzes/${freeForAllQuiz._id}/start`)
      .set('Authorization', `Bearer ${freeStudent.token}`)
      .send({});
    expect(freeStart.status).toBe(201);
  });
});

describe('GET /api/mini-gt/attempts/:attemptId/analysis', () => {
  let quiz;
  let questions;

  beforeEach(async () => {
    const bySubject = await seedBank();
    questions = [...bySubject.Psychiatry, ...bySubject.Dermatology, ...bySubject.Orthopaedics];
    quiz = await Quiz.create({
      title: 'Mini GT Test',
      subject: subjects.Psychiatry._id,
      testType: 'mini',
      duration: 30,
      questions: questions.map((q) => q._id),
      totalMarks: 120,
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [paidStudent.user._id],
      createdBy: admin.user._id,
      assignToAllFreeUsers: true,
    });
  });

  function outcomesFor(correctPerSubject) {
    return SUBJECTS.flatMap((name, sIndex) =>
      Array.from({ length: QUESTIONS_PER_SUBJECT }, (_u, i) => (i < correctPerSubject[sIndex] ? 1 : 0))
    );
  }

  it('rejects invalid ids, foreign attempts and non-mini attempts', async () => {
    const bad = await request(app)
      .get('/api/mini-gt/attempts/not-an-id/analysis')
      .set('Authorization', `Bearer ${paidStudent.token}`);
    expect(bad.status).toBe(400);

    const other = await createUser({ role: 'student' });
    const attempt = await finalizedAttempt(quiz, paidStudent, outcomesFor([6, 5, 4]), questions);
    const foreign = await request(app)
      .get(`/api/mini-gt/attempts/${attempt._id}/analysis`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(foreign.status).toBe(404);

    const grandQuiz = await Quiz.create({
      title: 'A Grand Test',
      subject: subjects.Psychiatry._id,
      testType: 'grand',
      duration: 180,
      questions: questions.slice(0, 5).map((q) => q._id),
      createdBy: admin.user._id,
      assignedStudents: [paidStudent.user._id],
    });
    const grandAttempt = await finalizedAttempt(grandQuiz, paidStudent, [1, 0, 1, null, 1], questions.slice(0, 5));
    const notMini = await request(app)
      .get(`/api/mini-gt/attempts/${grandAttempt._id}/analysis`)
      .set('Authorization', `Bearer ${paidStudent.token}`);
    expect(notMini.status).toBe(404);
    expect(notMini.body.code).toBe('NOT_MINI_GT');
  });

  it('refuses in-progress attempts', async () => {
    const attempt = await QuizAttempt.create({
      quiz: quiz._id,
      student: paidStudent.user._id,
      status: 'in_progress',
      totalQuestions: 30,
      totalMarks: 120,
      answers: [],
    });
    const res = await request(app)
      .get(`/api/mini-gt/attempts/${attempt._id}/analysis`)
      .set('Authorization', `Bearer ${paidStudent.token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ATTEMPT_NOT_COMPLETED');
  });

  it('returns the full analysis to a paid student once the cohort clears the privacy floor', async () => {
    // The caller + MIN_COMPARISON_COHORT other students.
    for (let i = 0; i < MIN_COMPARISON_COHORT; i += 1) {
      const student = await createUser({ role: 'student' });
      await student.user.updateOne({ isFreeUser: false });
      await finalizedAttempt(quiz, student, outcomesFor([5, 5, 5]), questions);
    }
    const mine = await finalizedAttempt(quiz, paidStudent, outcomesFor([6, 5, 4]), questions);

    const res = await request(app)
      .get(`/api/mini-gt/attempts/${mine._id}/analysis`)
      .set('Authorization', `Bearer ${paidStudent.token}`);
    expect(res.status).toBe(200);
    expect(res.body.access.level).toBe('full');

    expect(res.body.summary).toMatchObject({ correct: 15, incorrect: 15, skipped: 0, totalQuestions: 30 });
    expect(res.body.heatmap).toHaveLength(30);

    const byName = new Map(res.body.subjects.map((s) => [s.subjectName, s]));
    expect(byName.get('PSYCHIATRY')).toMatchObject({ correct: 6, questionCount: 10 });
    expect(byName.get('PSYCHIATRY').cohortAvgMarks).not.toBeNull();

    expect(res.body.cohort.sufficient).toBe(true);
    expect(res.body.cohort.totalStudents).toBe(MIN_COMPARISON_COHORT + 1);
    expect(res.body.cohort.percentile).not.toBeNull();

    // Topics: 4 per subject (10 questions / 3 per topic), each tied to its subject.
    expect(res.body.topics.length).toBeGreaterThan(0);
    expect(res.body.topics.find((t) => t.subjectName === 'PSYCHIATRY')).toMatchObject({
      questionCount: expect.any(Number),
      accuracy: expect.anything(),
    });

    // Provenance tags never surface.
    expect(res.body.tags.some((t) => /excel-import|^quiz:/i.test(t.label))).toBe(false);
    expect(res.body.tags.length).toBeGreaterThan(0);
    expect(['weak', 'strong', 'neutral']).toEqual(expect.arrayContaining(res.body.tags.map((t) => t.status)));
  });

  it('gates the deep analysis server-side for free users', async () => {
    for (let i = 0; i < MIN_COMPARISON_COHORT; i += 1) {
      const student = await createUser({ role: 'student' });
      await student.user.updateOne({ isFreeUser: true });
      await finalizedAttempt(quiz, student, outcomesFor([5, 5, 5]), questions);
    }
    const mine = await finalizedAttempt(quiz, freeStudent, outcomesFor([6, 5, 4]), questions);

    const res = await request(app)
      .get(`/api/mini-gt/attempts/${mine._id}/analysis`)
      .set('Authorization', `Bearer ${freeStudent.token}`);
    expect(res.status).toBe(200);
    expect(res.body.access.level).toBe('limited');
    expect(res.body.access.gatedSections).toContain('tag-analysis');

    // Free tier: summary + own subject rows + tier.
    expect(res.body.summary.correct).toBe(15);
    expect(res.body.subjects).toHaveLength(3);
    expect(res.body.insight.tier).not.toBeNull();

    // Gated data never leaves the server.
    expect(res.body.heatmap).toBeUndefined();
    expect(res.body.topics).toBeUndefined();
    expect(res.body.tags).toBeUndefined();
    expect(res.body.cohort.percentile).toBeNull();
    expect(res.body.overall.cohortAvgScorePercentage).toBeNull();
    res.body.subjects.forEach((row) => expect(row.cohortAvgAccuracy).toBeNull());
  });

  it('marks small cohorts insufficient instead of leaking averages', async () => {
    const mine = await finalizedAttempt(quiz, paidStudent, outcomesFor([6, 5, 4]), questions);
    const res = await request(app)
      .get(`/api/mini-gt/attempts/${mine._id}/analysis`)
      .set('Authorization', `Bearer ${paidStudent.token}`);
    expect(res.status).toBe(200);
    expect(res.body.cohort.sufficient).toBe(false);
    expect(res.body.cohort.percentile).toBeNull();
    expect(res.body.overall.cohortAvgScorePercentage).toBeNull();
    // Own performance still shown.
    expect(res.body.subjects.find((s) => s.subjectName === 'PSYCHIATRY').correct).toBe(6);
  });
});

describe('GET /api/mini-gt/attempts', () => {
  it('lists only finalized Mini GT attempts of the caller, newest first', async () => {
    const bySubject = await seedBank();
    const questions = [...bySubject.Psychiatry, ...bySubject.Dermatology, ...bySubject.Orthopaedics];
    const quiz = await Quiz.create({
      title: 'Mini GT History',
      subject: subjects.Psychiatry._id,
      testType: 'mini',
      duration: 30,
      questions: questions.map((q) => q._id),
      totalMarks: 120,
      createdBy: admin.user._id,
      assignToAllFreeUsers: true,
    });
    const grandQuiz = await Quiz.create({
      title: 'Some Grand Test',
      subject: subjects.Psychiatry._id,
      testType: 'grand',
      duration: 180,
      questions: questions.slice(0, 5).map((q) => q._id),
      createdBy: admin.user._id,
      assignedStudents: [paidStudent.user._id],
    });

    const older = await finalizedAttempt(quiz, paidStudent, outcomes(20), questions, {
      status: 'completed',
    });
    await QuizAttempt.updateOne({ _id: older._id }, { endTime: new Date('2026-09-20T10:00:00Z') });
    const newer = await finalizedAttempt(quiz, paidStudent, outcomes(24), questions);
    await QuizAttempt.updateOne({ _id: newer._id }, { endTime: new Date('2026-09-25T10:00:00Z') });
    // Must not appear: in-progress on mini, finalized on grand.
    await QuizAttempt.create({
      quiz: quiz._id,
      student: paidStudent.user._id,
      status: 'in_progress',
      totalQuestions: 30,
      totalMarks: 120,
      answers: [],
    });
    await finalizedAttempt(grandQuiz, paidStudent, [1, 0, 1, null, 1], questions.slice(0, 5));

    const res = await request(app)
      .get('/api/mini-gt/attempts?limit=10')
      .set('Authorization', `Bearer ${paidStudent.token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.attempts.map((a) => a._id)).toEqual([String(newer._id), String(older._id)]);
    expect(res.body.attempts[0].quizTitle).toBe('Mini GT History');
  });

  function outcomes(correctCount) {
    return Array.from({ length: 30 }, (_u, i) => (i < correctCount ? 1 : 0));
  }
});
