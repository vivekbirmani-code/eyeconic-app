const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuizAttempt = require('../../models/QuizAttempt');
const QuestionBank = require('../../models/QuestionBank');
const QuestionReport = require('../../models/QuestionReport');

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
      question: `Report test question #${++questionSeed}?`,
      options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
      correctAnswer: 1,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body;
}

// Starts the quiz through the real /start route so the attempt carries the
// full server-side lifecycle state (deadline enforcement etc.).
async function setupActiveAttempt(admin, student, subject) {
  const q1 = await createQuestion(admin, subject, { questionType: 'numerical', options: undefined, correctAnswer: 42 });
  const q2 = await createQuestion(admin, subject);
  const quiz = await Quiz.create({
    title: 'Question Report Test',
    subject: subject._id,
    testType: 'daily',
    duration: 30,
    questions: [q1._id, q2._id],
    positiveMarks: 4,
    negativeMarks: 1,
    assignedStudents: [student.user._id],
    createdBy: admin.user._id,
  });

  const startRes = await request(app)
    .post(`/api/quizzes/${quiz._id}/start`)
    .set('Authorization', `Bearer ${student.token}`);
  expect(startRes.status).toBe(201);

  return { quiz, questions: [q1, q2], attemptId: startRes.body.attemptId };
}

describe('Question reporting during a quiz attempt', () => {
  let admin;
  let student;
  let otherStudent;
  let mentor;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    otherStudent = await createUser({ role: 'student' });
    mentor = await createUser({ role: 'mentor' });
    subject = await createSubject('Pathology');
  });

  const reportPath = (quizId, attemptId) =>
    `/api/quizzes/${quizId}/attempt/${attemptId}/report-question`;

  it('stores a report tied to student, quiz, question and attempt with a question snapshot', async () => {
    const { quiz, questions, attemptId } = await setupActiveAttempt(admin, student, subject);

    const res = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${student.token}`)
      .send({
        questionIndex: 1,
        questionId: questions[1]._id,
        comment: '  Option C is factually wrong — the Golgi packages, it does not synthesize.  ',
      });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Report submitted');
    expect(res.body.reportId).toBeTruthy();

    const report = await QuestionReport.findById(res.body.reportId);
    expect(report).toBeTruthy();
    expect(String(report.student)).toBe(String(student.user._id));
    expect(String(report.quiz)).toBe(String(quiz._id));
    expect(String(report.attempt)).toBe(String(attemptId));
    expect(String(report.question)).toBe(String(questions[1]._id));
    expect(report.questionIndex).toBe(1);
    expect(report.comment).toBe('Option C is factually wrong — the Golgi packages, it does not synthesize.');
    expect(report.status).toBe('open');
    expect(report.questionSnapshot).toMatchObject({
      question: 'Report test question #2?',
      questionType: 'mcq_single',
      available: true,
    });
  });

  it('rejects empty, whitespace-only and too-long comments', async () => {
    const { quiz, attemptId } = await setupActiveAttempt(admin, student, subject);

    const empty = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, comment: '' });
    expect(empty.status).toBe(400);

    const whitespace = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, comment: '   \n\t  ' });
    expect(whitespace.status).toBe(400);

    const tooLong = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, comment: 'x'.repeat(1001) });
    expect(tooLong.status).toBe(400);

    expect(await QuestionReport.countDocuments()).toBe(0);
  });

  it('rejects invalid or mismatched question identifiers', async () => {
    const { quiz, questions, attemptId } = await setupActiveAttempt(admin, student, subject);

    const noIndex = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${student.token}`)
      .send({ comment: 'Broken question' });
    expect(noIndex.status).toBe(400);

    const outOfRange = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 99, comment: 'Broken question' });
    expect(outOfRange.status).toBe(400);

    const mismatchedId = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, questionId: questions[1]._id, comment: 'Broken question' });
    expect(mismatchedId.status).toBe(400);
  });

  it('requires authentication and the student role', async () => {
    const { quiz, attemptId } = await setupActiveAttempt(admin, student, subject);

    const anonymous = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .send({ questionIndex: 0, comment: 'Broken question' });
    expect(anonymous.status).toBe(401);

    const asAdmin = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ questionIndex: 0, comment: 'Broken question' });
    expect(asAdmin.status).toBe(403);
  });

  it('never lets a student report against another student’s attempt', async () => {
    const { quiz, attemptId } = await setupActiveAttempt(admin, student, subject);

    const res = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${otherStudent.token}`)
      .send({ questionIndex: 0, comment: 'I should not be able to do this' });
    expect(res.status).toBe(404);

    expect(await QuestionReport.countDocuments()).toBe(0);
  });

  it('rejects reports when the attempt belongs to a different quiz in the URL', async () => {
    const { quiz, attemptId } = await setupActiveAttempt(admin, student, subject);
    const other = await setupActiveAttempt(admin, student, subject);

    const res = await request(app)
      .post(reportPath(other.quiz._id, attemptId)) // attempt belongs to `quiz`
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, comment: 'Broken question' });
    expect(res.status).toBe(404);
  });

  it('rejects reports on finalized attempts', async () => {
    const { quiz, attemptId } = await setupActiveAttempt(admin, student, subject);

    await QuizAttempt.updateOne({ _id: attemptId }, { status: 'completed' });

    const res = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, comment: 'Too late' });
    expect(res.status).toBe(404);
  });

  it('enforces the attempt deadline like any other attempt write', async () => {
    const { quiz, attemptId } = await setupActiveAttempt(admin, student, subject);

    // Push the server-authoritative duration deadline into the past.
    await QuizAttempt.updateOne(
      { _id: attemptId },
      { durationDeadline: new Date(Date.now() - 60 * 1000) }
    );

    const res = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, comment: 'Broken question' });
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('TIME_EXPIRED');

    expect(await QuestionReport.countDocuments()).toBe(0);
  });

  it('allows at most one open report per question per attempt (duplicates → 409)', async () => {
    const { quiz, attemptId } = await setupActiveAttempt(admin, student, subject);

    const first = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, comment: 'First report' });
    expect(first.status).toBe(201);

    const duplicate = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, comment: 'Second report' });
    expect(duplicate.status).toBe(409);

    // A DIFFERENT question on the same attempt is fine.
    const otherQuestion = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 1, comment: 'Different question' });
    expect(otherQuestion.status).toBe(201);

    expect(await QuestionReport.countDocuments()).toBe(2);
  });

  it('keeps the question ref usable when the bank doc was already deleted', async () => {
    const { quiz, questions, attemptId } = await setupActiveAttempt(admin, student, subject);

    await QuestionBank.deleteOne({ _id: questions[0]._id });

    const res = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, comment: 'This question looked broken' });
    expect(res.status).toBe(201);

    const report = await QuestionReport.findById(res.body.reportId);
    expect(String(report.question)).toBe(String(questions[0]._id));
    expect(report.questionSnapshot.available).toBe(false);
  });

  it('does not interfere with answering, navigating or submitting the attempt', async () => {
    const { quiz, questions, attemptId } = await setupActiveAttempt(admin, student, subject);

    // Interleave the report between two answer writes, then submit.
    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, questionId: questions[0]._id, selectedAnswer: 42 })
      .expect(200);

    const report = await request(app)
      .post(reportPath(quiz._id, attemptId))
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 1, questionId: questions[1]._id, comment: 'Ambiguous stem' });
    expect(report.status).toBe(201);

    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/${attemptId}/answer`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 1, questionId: questions[1]._id, selectedAnswer: 1 })
      .expect(200);

    const submit = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/submit`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ answers: [] });
    expect(submit.status).toBe(200);

    const attempt = await QuizAttempt.findById(attemptId);
    expect(attempt.status).toBe('completed');
    expect(attempt.answers).toHaveLength(2);
    // The report survived submission untouched.
    expect(await QuestionReport.countDocuments()).toBe(1);
  });
});

describe('Question reports admin review workflow', () => {
  let admin;
  let student;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student' });
    subject = await createSubject('Pathology');
  });

  async function fileReport(comment = 'Option B seems wrong') {
    const { quiz, questions, attemptId } = await setupActiveAttempt(admin, student, subject);
    const res = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/report-question`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, questionId: questions[0]._id, comment });
    expect(res.status).toBe(201);
    return { quiz, questions, attemptId, reportId: res.body.reportId };
  }

  it('lists open reports for admins only, populated with reviewer context', async () => {
    const { quiz, questions, reportId } = await fileReport();

    const asStudent = await request(app)
      .get('/api/quizzes/question-reports')
      .set('Authorization', `Bearer ${student.token}`);
    expect(asStudent.status).toBe(403);

    const asMentor = await request(app)
      .get('/api/quizzes/question-reports')
      .set('Authorization', `Bearer ${(await createUser({ role: 'mentor' })).token}`);
    expect(asMentor.status).toBe(403);

    const res = await request(app)
      .get('/api/quizzes/question-reports')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(String(res.body[0]._id)).toBe(String(reportId));
    expect(res.body[0].student.name).toBe(student.user.name);
    expect(res.body[0].quiz.title).toBe(quiz.title);
    expect(res.body[0].question.question).toBe(questions[0].question);
    expect(res.body[0].status).toBe('open');
  });

  it('resolves and dismisses reports, and a resolved slot frees the (attempt, question) pair', async () => {
    const { quiz, attemptId, questions, reportId } = await fileReport();

    const badStatus = await request(app)
      .put(`/api/quizzes/question-reports/${reportId}/resolve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'invalid' });
    expect(badStatus.status).toBe(400);

    const resolve = await request(app)
      .put(`/api/quizzes/question-reports/${reportId}/resolve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'resolved', resolutionNote: 'Fixed the option text' });
    expect(resolve.status).toBe(200);

    const resolvedList = await request(app)
      .get('/api/quizzes/question-reports?status=resolved')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(resolvedList.body).toHaveLength(1);
    expect(resolvedList.body[0].resolutionNote).toBe('Fixed the option text');
    expect(resolvedList.body[0].resolvedBy.name).toBeTruthy();

    // Open list no longer contains it…
    const openList = await request(app)
      .get('/api/quizzes/question-reports')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(openList.body).toHaveLength(0);

    // …and the student can file a fresh report for the same question now.
    const again = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/${attemptId}/report-question`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ questionIndex: 0, questionId: questions[0]._id, comment: 'Still looks wrong' });
    expect(again.status).toBe(201);

    // Dismiss flow.
    const dismiss = await request(app)
      .put(`/api/quizzes/question-reports/${again.body.reportId}/resolve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'dismissed' });
    expect(dismiss.status).toBe(200);

    const all = await request(app)
      .get('/api/quizzes/question-reports?status=all')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(all.body).toHaveLength(2);
    expect(all.body.map((r) => r.status).sort()).toEqual(['dismissed', 'resolved']);
  });
});
