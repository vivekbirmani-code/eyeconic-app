const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuestionBank = require('../../models/QuestionBank');
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

async function setupQuizWithQuestions(admin, student, subject, questionOverridesList) {
  const questions = [];
  for (const overrides of questionOverridesList) {
    questions.push(await createQuestion(admin, subject, overrides));
  }
  const quiz = await Quiz.create({
    title: 'Mixed Type Test',
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

describe('Quiz attempt lifecycle — type-aware grading + snapshots', () => {
  let admin;
  let student;
  let otherStudent;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    otherStudent = await createUser({ role: 'student' });
    subject = await createSubject('Pathology');
  });

  it('grades a mix of question types correctly and stores a server-derived snapshot', async () => {
    const { quiz, questions } = await setupQuizWithQuestions(admin, student, subject, [
      { questionType: 'mcq_single', options: ['A', 'B', 'C'], correctAnswer: 1 }, // Q0
      { questionType: 'multiple_correct', options: ['A', 'B', 'C'], correctAnswer: [0, 2] }, // Q1
      {
        questionType: 'match_the_following',
        options: undefined,
        columnA: ['Item 1', 'Item 2'],
        columnB: ['Match A', 'Match B'],
        correctAnswer: { '0': '1', '1': '0' },
      }, // Q2
      { questionType: 'numerical', options: undefined, correctAnswer: 42 }, // Q3
    ]);

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(startRes.status).toBe(201);
    const attemptId = startRes.body.attemptId;

    // Q0: correct mcq_single
    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 1 })
      .expect(200);

    // Q1: incorrect multiple_correct (missing one)
    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 1, questionId: questions[1]._id, selectedAnswer: [0] })
      .expect(200);

    // Q2: correct match_the_following
    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 2, questionId: questions[2]._id, selectedAnswer: { '0': '1', '1': '0' } })
      .expect(200);

    // Q3: skipped (numerical) — left unanswered

    const submitRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect(submitRes.status).toBe(200);

    const attemptRes = await request(app)
      .get(`/api/quizzes/attempt/${attemptId}`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(attemptRes.status).toBe(200);

    const answers = attemptRes.body.answers;
    const byIndex = (i) => answers.find((a) => a.questionIndex === i);

    expect(byIndex(0).isCorrect).toBe(true);
    expect(byIndex(1).isCorrect).toBe(false);
    expect(byIndex(2).isCorrect).toBe(true);
    // Q3 was skipped — no answer document, or isCorrect false with no marks impact
    expect(byIndex(3)).toBeUndefined();

    // Marks: +4 (Q0) -1 (Q1 wrong) +4 (Q2) = 7; Q3 skipped = 0
    expect(attemptRes.body.marksObtained).toBe(7);
    expect(attemptRes.body.score).toBe(2);

    // Snapshot correctness — server-derived, includes all 7 dimensions
    expect(byIndex(0).metadataSnapshot).toMatchObject({
      subjectName: 'Pathology',
      topicName: 'Genetics',
      subtopicName: 'Mendelian Inheritance',
      system: 'Genetic Disorders',
      questionType: 'mcq_single',
      difficulty: 'medium',
    });
  });

  it('ignores a client-submitted isCorrect / metadataSnapshot on save', async () => {
    const { quiz, questions } = await setupQuizWithQuestions(admin, student, subject, [
      { questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 0 },
    ]);

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    const attemptId = startRes.body.attemptId;

    // Submit a wrong answer but try to spoof isCorrect: true and a fake snapshot
    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({
        questionIndex: 0,
        questionId: questions[0]._id,
        selectedAnswer: 1, // wrong (correct is 0)
        isCorrect: true,
        metadataSnapshot: { difficulty: 'hard', questionType: 'numerical' },
      })
      .expect(200);

    await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});

    const attemptRes = await request(app)
      .get(`/api/quizzes/attempt/${attemptId}`)
      .set('Authorization', `Bearer ${student.token}`);

    const answer = attemptRes.body.answers[0];
    expect(answer.isCorrect).toBe(false); // server-graded truth, not the spoofed value
    expect(answer.metadataSnapshot.difficulty).toBe('medium'); // real value from QuestionBank
    expect(answer.metadataSnapshot.questionType).toBe('mcq_single');
  });

  it('rejects a mismatched client-supplied questionId', async () => {
    const { quiz, questions } = await setupQuizWithQuestions(admin, student, subject, [
      { questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 0 },
      { questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 1 },
    ]);

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    const attemptId = startRes.body.attemptId;

    const res = await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, questionId: questions[1]._id, selectedAnswer: 0 });

    expect(res.status).toBe(400);
  });

  it('preserves the snapshot even after the QuestionBank question is later reclassified', async () => {
    const { quiz, questions } = await setupQuizWithQuestions(admin, student, subject, [
      { questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 0, subtopicName: 'Original Subtopic' },
    ]);

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    const attemptId = startRes.body.attemptId;

    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 0 });

    await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});

    // Admin reclassifies the question's Subtopic after the fact.
    await request(app)
      .put(`/api/question-bank/${questions[0]._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ subtopicName: 'Reclassified Subtopic' })
      .expect(200);

    const attemptRes = await request(app)
      .get(`/api/quizzes/attempt/${attemptId}`)
      .set('Authorization', `Bearer ${student.token}`);

    expect(attemptRes.body.answers[0].metadataSnapshot.subtopicName).toBe('Original Subtopic');

    const liveQuestion = await QuestionBank.findById(questions[0]._id);
    expect(liveQuestion.subtopicName).toBe('Reclassified Subtopic');
  });

  it('rejects a student viewing another student\'s attempt', async () => {
    const { quiz } = await setupQuizWithQuestions(admin, student, subject, [
      { questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 0 },
    ]);

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    const attemptId = startRes.body.attemptId;

    const res = await request(app)
      .get(`/api/quizzes/attempt/${attemptId}`)
      .set('Authorization', `Bearer ${otherStudent.token}`);

    expect(res.status).toBe(403);
  });

  it('allows an admin and an assigned mentor to view a student attempt, but not an unassigned mentor', async () => {
    const { quiz } = await setupQuizWithQuestions(admin, student, subject, [
      { questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 0 },
    ]);

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    const attemptId = startRes.body.attemptId;

    const assignedMentor = await createUser({ role: 'mentor' });
    const unassignedMentor = await createUser({ role: 'mentor' });
    await MentorStudentAssignment.create({
      mentor: assignedMentor.user._id,
      student: student.user._id,
      isActive: true,
      assignedBy: admin.user._id,
    });

    const adminRes = await request(app)
      .get(`/api/quizzes/attempt/${attemptId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(adminRes.status).toBe(200);

    const assignedRes = await request(app)
      .get(`/api/quizzes/attempt/${attemptId}`)
      .set('Authorization', `Bearer ${assignedMentor.token}`);
    expect(assignedRes.status).toBe(200);

    const unassignedRes = await request(app)
      .get(`/api/quizzes/attempt/${attemptId}`)
      .set('Authorization', `Bearer ${unassignedMentor.token}`);
    expect(unassignedRes.status).toBe(403);
  });

  it('strips correctAnswer/explanation from the student-facing quiz payload', async () => {
    const { quiz } = await setupQuizWithQuestions(admin, student, subject, [
      { questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 0, explanation: 'Because reasons' },
    ]);

    const res = await request(app)
      .get(`/api/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${student.token}`);

    expect(res.status).toBe(200);
    const q = res.body.questions[0];
    expect(q.correctAnswer).toBeUndefined();
    expect(q.explanation).toBeUndefined();
  });

  it('computes a 7-dimension performance breakdown for the student analytics endpoint', async () => {
    const { quiz } = await setupQuizWithQuestions(admin, student, subject, [
      { questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 0, difficulty: 'easy', tags: ['high-yield'] },
      { questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 1, difficulty: 'hard', tags: ['high-yield'] },
    ]);

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    const attemptId = startRes.body.attemptId;

    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, selectedAnswer: 0 }); // correct
    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 1, selectedAnswer: 0 }); // incorrect (correct is 1)

    await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});

    const res = await request(app)
      .get(`/api/quizzes/analytics/student/${student.user._id}/performance`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.overall.attempted).toBe(2);
    expect(res.body.overall.correct).toBe(1);
    expect(res.body.byDifficulty.find((b) => b.key === 'easy').correct).toBe(1);
    expect(res.body.byDifficulty.find((b) => b.key === 'hard').correct).toBe(0);
    expect(res.body.byTag.find((b) => b.key === 'high-yield').attempted).toBe(2);
  });

  it('rejects a spoofed studentId — a student cannot start/submit as another student', async () => {
    const { quiz } = await setupQuizWithQuestions(admin, student, subject, [
      { questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 0 },
    ]);

    // otherStudent is not assigned to this quiz, so starting it must fail —
    // identity always comes from the JWT (req.user), never from the request body.
    const res = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${otherStudent.token}`)
      .send({ studentId: student.user._id.toString() });

    expect(res.status).toBe(403);
  });

  it('returns idempotent full result payload on duplicate submit', async () => {
    const { quiz, questions } = await setupQuizWithQuestions(admin, student, subject, [
      { questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 0 },
      { questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 1 },
    ]);

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    const attemptId = startRes.body.attemptId;

    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 0 });

    const firstSubmit = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect(firstSubmit.status).toBe(200);
    expect(firstSubmit.body.correctCount).toBe(1);

    const secondSubmit = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect(secondSubmit.status).toBe(200);
    expect(secondSubmit.body.isAlreadySubmitted).toBe(true);
    expect(secondSubmit.body.correctCount).toBe(1);
    expect(secondSubmit.body.marksObtained).toBe(firstSubmit.body.marksObtained);
  });

  it('returns scorecard analytics on the results endpoint', async () => {
    const { quiz, questions } = await setupQuizWithQuestions(admin, student, subject, [
      { questionType: 'mcq_single', options: ['Alpha', 'Beta'], correctAnswer: 0 },
      { questionType: 'mcq_single', options: ['Gamma', 'Delta'], correctAnswer: 1 },
    ]);

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    const attemptId = startRes.body.attemptId;

    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 0, markedForReview: true });

    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 1, questionId: questions[1]._id, selectedAnswer: 0 });

    await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});

    const resultsRes = await request(app)
      .get(`/api/quizzes/${quiz._id}/attempt/${attemptId}/results?groupBy=subject`)
      .set('Authorization', `Bearer ${student.token}`);

    expect(resultsRes.status).toBe(200);
    expect(resultsRes.body.summary.correct).toBe(1);
    expect(resultsRes.body.summary.incorrect).toBe(1);
    expect(resultsRes.body.summary.skipped).toBe(0);
    expect(resultsRes.body.summary.accuracy).toBe(50);
    expect(resultsRes.body.summary.markedForReviewCount).toBe(1);
    expect(resultsRes.body.wrongQuestions).toHaveLength(1);
    expect(resultsRes.body.questionPerformance).toHaveLength(2);
    expect(resultsRes.body.wrongQuestions[0].selectedAnswerLabel).toBe('A');
  });

  it('tracks historical incorrect attempts across quizzes for the same question', async () => {
    const sharedQuestion = await createQuestion(admin, subject, {
      questionType: 'mcq_single',
      options: ['A', 'B'],
      correctAnswer: 0,
      question: 'Shared historical question',
    });

    const quizA = await Quiz.create({
      title: 'Quiz A',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [sharedQuestion._id],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
    });

    const quizB = await Quiz.create({
      title: 'Quiz B',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [sharedQuestion._id],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
    });

  const submitWrong = async (quizId) => {
      const startRes = await request(app)
        .post(`/api/quizzes/${quizId}/start`)
        .set('Authorization', `Bearer ${student.token}`);
      const attemptId = startRes.body.attemptId;

      await request(app)
        .put(`/api/quizzes/${quizId}/attempt/${attemptId}/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionIndex: 0, questionId: sharedQuestion._id, selectedAnswer: 1 });

      await request(app)
        .post(`/api/quizzes/${quizId}/attempt/${attemptId}/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({});

      return attemptId;
    };

    await submitWrong(quizA._id);
    const attemptB = await submitWrong(quizB._id);

    const resultsRes = await request(app)
      .get(`/api/quizzes/${quizB._id}/attempt/${attemptB}/results?groupBy=subject`)
      .set('Authorization', `Bearer ${student.token}`);

    expect(resultsRes.status).toBe(200);
    expect(resultsRes.body.wrongQuestions[0].history.previousIncorrectAttempts).toBe(1);
    expect(resultsRes.body.frequentlyMissedQuestions.some(
      (item) => item.questionId === sharedQuestion._id.toString()
    )).toBe(false);
  });

  it('lists frequently missed questions after multiple incorrect attempts', async () => {
    const sharedQuestion = await createQuestion(admin, subject, {
      questionType: 'mcq_single',
      options: ['A', 'B'],
      correctAnswer: 0,
      question: 'Often missed question',
    });

    const makeQuiz = async (title) => Quiz.create({
      title,
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [sharedQuestion._id],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
    });

    const submitWrong = async (quizId) => {
      const startRes = await request(app)
        .post(`/api/quizzes/${quizId}/start`)
        .set('Authorization', `Bearer ${student.token}`);
      const attemptId = startRes.body.attemptId;

      await request(app)
        .put(`/api/quizzes/${quizId}/attempt/${attemptId}/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionIndex: 0, questionId: sharedQuestion._id, selectedAnswer: 1 });

      await request(app)
        .post(`/api/quizzes/${quizId}/attempt/${attemptId}/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({});

      return attemptId;
    };

    const quizA = await makeQuiz('Quiz A');
    const quizB = await makeQuiz('Quiz B');
    const quizC = await makeQuiz('Quiz C');

    await submitWrong(quizA._id);
    await submitWrong(quizB._id);
    const attemptC = await submitWrong(quizC._id);

    const resultsRes = await request(app)
      .get(`/api/quizzes/${quizC._id}/attempt/${attemptC}/results?groupBy=subject`)
      .set('Authorization', `Bearer ${student.token}`);

    expect(resultsRes.status).toBe(200);
    const missed = resultsRes.body.frequentlyMissedQuestions.find(
      (item) => item.questionId === sharedQuestion._id.toString()
    );
    expect(missed).toBeDefined();
    expect(missed.incorrectAttempts).toBeGreaterThanOrEqual(2);
    expect(missed.question).toContain('Often missed');
  });

  it('rejects results access for another student', async () => {
    const { quiz } = await setupQuizWithQuestions(admin, student, subject, [
      { questionType: 'mcq_single', options: ['A', 'B'], correctAnswer: 0 },
    ]);

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    const attemptId = startRes.body.attemptId;

    await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});

    const res = await request(app)
      .get(`/api/quizzes/${quiz._id}/attempt/${attemptId}/results`)
      .set('Authorization', `Bearer ${otherStudent.token}`);

    expect(res.status).toBe(403);
  });
});

describe('Results grouping — Group by controls the aggregation', () => {
  let admin;
  let student;
  let physics;
  let chemistry;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    physics = await createSubject('Physics');
    chemistry = await createSubject('Chemistry');
  });

  function fetchResults(quizId, attemptId, groupBy, token) {
    const query = groupBy !== undefined ? `?groupBy=${groupBy}` : '';
    return request(app)
      .get(`/api/quizzes/${quizId}/attempt/${attemptId}/results${query}`)
      .set('Authorization', `Bearer ${token}`);
  }

  // Sectioned quiz where Physics appears in BOTH sections and Chemistry only
  // in the first — "By Subject" must merge Physics across sections.
  async function setupSectionedAttempt() {
    const questionDefs = [
      { subject: physics, topicName: 'Kinematics' },                                                              // q0 — Section 1, correct (30s)
      { subject: chemistry, topicName: 'Organic' },                                                               // q1 — Section 1, wrong (20s)
      { subject: physics, topicName: 'Optics', questionType: 'multiple_correct', options: ['A', 'B', 'C'], correctAnswer: [0, 2] }, // q2 — Section 2, skipped via [] (15s)
      { subject: physics, topicName: 'Optics' },                                                                  // q3 — Section 2, correct (10s)
    ];

    const questions = [];
    for (let idx = 0; idx < questionDefs.length; idx++) {
      const def = questionDefs[idx];
      questions.push(await createQuestion(admin, def.subject, {
        topicName: def.topicName,
        questionType: def.questionType || 'mcq_single',
        options: def.options || ['A', 'B', 'C'],
        correctAnswer: def.correctAnswer !== undefined ? def.correctAnswer : 1,
        // Unique stem per question — same-subject duplicate text is rejected now.
        question: `${def.topicName} question ${idx + 1}`,
      }));
    }

    const quiz = await Quiz.create({
      title: 'Grouped Sections Test',
      subject: physics._id,
      testType: 'grand',
      duration: 60,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
      lockSectionsAfterSubmission: false,
      sections: [
        { name: 'Section 1', duration: 30, selectionType: 'manual', questions: [questions[0]._id, questions[1]._id] },
        { name: 'Section 2', duration: 30, selectionType: 'manual', questions: [questions[2]._id, questions[3]._id] },
      ],
    });

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(startRes.status).toBe(201);
    const attemptId = startRes.body.attemptId;

    const saveAnswer = (questionIndex, selectedAnswer, timeSpent) =>
      request(app)
        .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionIndex, questionId: questions[questionIndex]._id, selectedAnswer, timeSpent });

    await saveAnswer(0, 1, 30).expect(200);  // correct
    await saveAnswer(1, 0, 20).expect(200);  // wrong
    await saveAnswer(2, [], 15).expect(200); // multiple_correct [] -> skipped, time still tracked
    await saveAnswer(3, 1, 10).expect(200);  // correct

    const submitRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({});
    expect(submitRes.status).toBe(200);

    return { quiz, questions, attemptId };
  }

  it('aggregates by subject across sections when groupBy=subject', async () => {
    const { quiz, attemptId } = await setupSectionedAttempt();

    const res = await fetchResults(quiz._id, attemptId, 'subject', student.token);
    expect(res.status).toBe(200);
    expect(res.body.groupBy).toBe('subject');

    const rows = res.body.attempt.sectionPerformance;
    expect(rows.map((r) => r.sectionName)).toEqual(['Physics', 'Chemistry']);

    // Physics questions from Section 1 + Section 2 merged into one row.
    expect(rows[0]).toMatchObject({ correct: 2, incorrect: 0, skipped: 1, timeSpent: 55, accuracy: 100, total: 3 });
    expect(rows[1]).toMatchObject({ correct: 0, incorrect: 1, skipped: 0, timeSpent: 20, accuracy: 0, total: 1 });

    // Group rows always add up to the overall summary.
    expect(res.body.summary).toMatchObject({ correct: 2, incorrect: 1, skipped: 1, totalQuestions: 4 });
    expect(res.body.summary.accuracy).toBe(66.67);

    // Questions are labelled with the active grouping dimension.
    expect([...new Set(res.body.questions.map((q) => q.section))]).toEqual(['Physics', 'Chemistry']);
  });

  it('keeps section rows for groupBy=section, the default, and invalid values', async () => {
    const { quiz, attemptId } = await setupSectionedAttempt();

    for (const groupBy of ['section', undefined, 'bogus']) {
      const res = await fetchResults(quiz._id, attemptId, groupBy, student.token);
      expect(res.status).toBe(200);
      expect(res.body.groupBy).toBe('section');
      expect(res.body.hasSectionData).toBe(true);

      const rows = res.body.attempt.sectionPerformance;
      expect(rows.map((r) => r.sectionName)).toEqual(['Section 1', 'Section 2']);
      expect(rows[0]).toMatchObject({ correct: 1, incorrect: 1, skipped: 0, timeSpent: 50, accuracy: 50, total: 2 });
      expect(rows[1]).toMatchObject({ correct: 1, incorrect: 0, skipped: 1, timeSpent: 25, accuracy: 100, total: 2 });
    }
  });

  it('groups by topic and tag when requested', async () => {
    const { quiz, attemptId } = await setupSectionedAttempt();

    const topicRes = await fetchResults(quiz._id, attemptId, 'topic', student.token);
    expect(topicRes.status).toBe(200);
    const topicRows = topicRes.body.attempt.sectionPerformance;
    expect(topicRows.map((r) => r.sectionName)).toEqual(['Kinematics', 'Organic', 'Optics']);
    expect(topicRows[2]).toMatchObject({ correct: 1, incorrect: 0, skipped: 1, timeSpent: 25, accuracy: 100 });

    const tagRes = await fetchResults(quiz._id, attemptId, 'tag', student.token);
    expect(tagRes.status).toBe(200);
    // No tags configured -> everything lands in 'Untagged'.
    expect(tagRes.body.attempt.sectionPerformance).toHaveLength(1);
    expect(tagRes.body.attempt.sectionPerformance[0]).toMatchObject({
      sectionName: 'Untagged',
      correct: 2,
      incorrect: 1,
      skipped: 1,
      timeSpent: 75,
    });
  });

  it('groups questions without a subject under General', async () => {
    const { quiz, questions, attemptId } = await setupSectionedAttempt();
    // Simulate a legacy question stored before subject was enforced.
    await QuestionBank.updateOne({ _id: questions[1]._id }, { $unset: { subject: '' } });

    const res = await fetchResults(quiz._id, attemptId, 'subject', student.token);
    expect(res.status).toBe(200);
    const rows = res.body.attempt.sectionPerformance;
    expect(rows.map((r) => r.sectionName)).toEqual(['Physics', 'General']);
    expect(rows[1]).toMatchObject({ correct: 0, incorrect: 1, skipped: 0 });
  });

  it('falls back to subject grouping for sectionless quizzes on groupBy=section', async () => {
    const questions = [
      await createQuestion(admin, physics, { question: 'Flat physics question' }),
      await createQuestion(admin, chemistry, { question: 'Flat chemistry question' }),
    ];
    const quiz = await Quiz.create({
      title: 'Flat Quiz',
      subject: physics._id,
      testType: 'daily',
      duration: 20,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
    });

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(startRes.status).toBe(201);
    const attemptId = startRes.body.attemptId;

    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 1, timeSpent: 5 })
      .expect(200);
    // Question 1 left unanswered -> skipped.

    await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({})
      .expect(200);

    const res = await fetchResults(quiz._id, attemptId, 'section', student.token);
    expect(res.status).toBe(200);
    expect(res.body.groupBy).toBe('section');

    const rows = res.body.attempt.sectionPerformance;
    expect(rows.map((r) => r.sectionName)).toEqual(['Physics', 'Chemistry']);
    expect(rows[0]).toMatchObject({ correct: 1, skipped: 0 });
    expect(rows[1]).toMatchObject({ correct: 0, incorrect: 0, skipped: 1 });
    expect(res.body.summary).toMatchObject({ correct: 1, incorrect: 0, skipped: 1 });
  });

  it('surfaces empty sections as zero rows when grouping by section', async () => {
    const questions = [
      await createQuestion(admin, physics, { question: 'Solo question' }),
    ];
    const quiz = await Quiz.create({
      title: 'Empty Section Quiz',
      subject: physics._id,
      testType: 'daily',
      duration: 20,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
      lockSectionsAfterSubmission: false,
      sections: [
        { name: 'Section 1', duration: 10, selectionType: 'manual', questions: [questions[0]._id] },
        { name: 'Section 2', duration: 10, selectionType: 'manual', questions: [] },
      ],
    });

    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(startRes.status).toBe(201);
    const attemptId = startRes.body.attemptId;

    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 1, timeSpent: 5 })
      .expect(200);

    await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({})
      .expect(200);

    const res = await fetchResults(quiz._id, attemptId, 'section', student.token);
    expect(res.status).toBe(200);
    const rows = res.body.attempt.sectionPerformance;
    expect(rows.map((r) => r.sectionName)).toEqual(['Section 1', 'Section 2']);
    expect(rows[1]).toMatchObject({ correct: 0, incorrect: 0, skipped: 0, timeSpent: 0, accuracy: 0, total: 0 });

    // Subject grouping ignores the empty section entirely.
    const subjectRes = await fetchResults(quiz._id, attemptId, 'subject', student.token);
    expect(subjectRes.body.attempt.sectionPerformance.map((r) => r.sectionName)).toEqual(['Physics']);
  });
});
