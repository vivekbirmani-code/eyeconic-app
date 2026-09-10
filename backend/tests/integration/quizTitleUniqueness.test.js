const request = require('supertest');
const xlsx = require('xlsx');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const QuestionBank = require('../../models/QuestionBank');
const Quiz = require('../../models/Quiz');

let app;
let adminToken;
let studentToken;
let subject;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

beforeEach(async () => {
  await db.clearDatabase();
  const admin = await createUser({ role: 'admin' });
  const student = await createUser({ role: 'student' });
  adminToken = admin.token;
  studentToken = student.token;
  subject = await createSubject('Microbiology');
});

const baseRow = (overrides = {}) => ({
  SUBJECT: 'Microbiology',
  TOPIC: 'Bacteriology',
  SUBTOPIC: 'Gram Positive Cocci',
  SYSTEM: 'Infectious Diseases',
  QUESTION_TYPE: 'mcq_single',
  DIFFICULTY: 'medium',
  QUESTION: 'Which bacterium is catalase positive?',
  OPTION1: 'Streptococcus',
  OPTION2: 'Staphylococcus',
  OPTION3: 'Enterococcus',
  OPTION4: 'Lactobacillus',
  CORRECT: '2',
  ...overrides,
});

const toBuffer = (rows, sheetName = 'Question Bank') => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), sheetName);
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const importFile = (token, buffer, fields = {}) =>
  request(app)
    .post('/api/quizzes/import-excel')
    .set('Authorization', `Bearer ${token}`)
    .field('quizTitle', fields.quizTitle !== undefined ? fields.quizTitle : 'Test quiz 1')
    .field('testType', fields.testType || 'daily')
    .field('duration', fields.duration || '30')
    .field('positiveMarks', fields.positiveMarks || '4')
    .field('negativeMarks', fields.negativeMarks || '1')
    .attach('file', buffer, {
      filename: fields.filename || 'import.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

describe('Quiz Title Uniqueness and Reusability Workflow', () => {

  test('Scenario A — Active duplicate title is rejected', async () => {
    // 1. Create an active quiz via import
    const firstRes = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Question 1' })]), { quizTitle: 'Test quiz 1' });
    expect(firstRes.status).toBe(201);
    expect(firstRes.body.quiz.title).toBe('Test quiz 1');

    // 2. Attempt to create another quiz with the exact same title via import -> REJECTED
    const secondRes = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Question 2' })]), { quizTitle: 'Test quiz 1' });
    expect(secondRes.status).toBe(400);
    expect(secondRes.body.errorType).toBe('DUPLICATE_TITLE');
    expect(secondRes.body.message).toContain('already exists');

    // 3. Attempt to create via manual quiz creation API -> REJECTED
    const question = await QuestionBank.create({
      question: 'Question 3',
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 0,
      subject: subject._id,
      topicName: 'Bacteriology',
      subtopicName: 'Gram Positive Cocci',
      system: 'Infectious Diseases',
      difficulty: 'medium',
      questionType: 'mcq_single',
      createdBy: (await require('../../models/User').findOne({ role: 'admin' }))._id,
    });

    const manualRes = await request(app)
      .post('/api/quizzes/create-from-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Test quiz 1',
        subject: subject._id,
        testType: 'daily',
        duration: 30,
        selectedQuestionIds: [question._id],
        numberOfQuestions: 1,
      });
    expect(manualRes.status).toBe(400);
    expect(manualRes.body.errorType).toBe('DUPLICATE_TITLE');
  });

  test('Scenario B — Deleted quiz title can be reused for import and creation', async () => {
    // 1. Create quiz "Test quiz 1"
    const createRes = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Question 1' })]), { quizTitle: 'Test quiz 1' });
    expect(createRes.status).toBe(201);
    const quizId = createRes.body.quiz._id;

    // 2. Delete the quiz
    const delRes = await request(app)
      .delete(`/api/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.status).toBe(200);

    // Verify DB state: soft deleted
    const deletedQuizDoc = await Quiz.findById(quizId);
    expect(deletedQuizDoc.isDeleted).toBe(true);
    expect(deletedQuizDoc.isActive).toBe(false);

    // 3. Verify Past Tests listing excludes it
    const listRes = await request(app)
      .get('/api/quizzes')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.body.some(q => q._id === quizId)).toBe(false);

    // 4. Re-import quiz with the exact same title "Test quiz 1" -> MUST SUCCEED
    const reImportRes = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Question 1 (New)' })]), { quizTitle: 'Test quiz 1' });
    expect(reImportRes.status).toBe(201);
    expect(reImportRes.body.quiz.title).toBe('Test quiz 1');
    expect(reImportRes.body.quiz._id).not.toBe(quizId);

    // 5. Verify the newly created quiz appears in Past Tests
    const newListRes = await request(app)
      .get('/api/quizzes')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(newListRes.body.some(q => q._id === reImportRes.body.quiz._id)).toBe(true);
  });

  test('Scenario C — Different titles can be created independently', async () => {
    const quiz1 = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Q1' })]), { quizTitle: 'Test quiz 1' });
    expect(quiz1.status).toBe(201);

    const quiz2 = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Q2' })]), { quizTitle: 'Test quiz 2' });
    expect(quiz2.status).toBe(201);
  });

  test('Scenario D — Multiple deleted quizzes can all be recreated', async () => {
    const q1 = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Q1' })]), { quizTitle: 'Test quiz 1' });
    const q2 = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Q2' })]), { quizTitle: 'Test quiz 2' });

    // Delete both
    await request(app).delete(`/api/quizzes/${q1.body.quiz._id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    await request(app).delete(`/api/quizzes/${q2.body.quiz._id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);

    // Recreate both
    const req1 = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Q1 New' })]), { quizTitle: 'Test quiz 1' });
    const req2 = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Q2 New' })]), { quizTitle: 'Test quiz 2' });
    expect(req1.status).toBe(201);
    expect(req2.status).toBe(201);
  });

  test('Scenario E — Whitespace normalization during uniqueness checks', async () => {
    await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Q1' })]), { quizTitle: 'Test quiz 1' });

    // Attempting to create " Test quiz 1 " should be detected as duplicate
    const res = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Q2' })]), { quizTitle: '  Test quiz 1  ' });
    expect(res.status).toBe(400);
    expect(res.body.errorType).toBe('DUPLICATE_TITLE');
  });

  test('Scenario F — Invalid import file still fails validation correctly', async () => {
    const res = await request(app)
      .post('/api/quizzes/import-excel')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('quizTitle', 'Bad File Quiz')
      .field('testType', 'daily')
      .field('duration', '30')
      .attach('file', Buffer.from('not an excel file'), { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Unsupported file type');
  });

  test('Scenario G — Selective deletion frees only the deleted quiz title while active titles stay protected', async () => {
    const q1 = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Q1' })]), { quizTitle: 'Quiz A' });
    expect(q1.status).toBe(201);
    const q2 = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Q2' })]), { quizTitle: 'Quiz B' });
    expect(q2.status).toBe(201);

    // Delete Quiz A only
    await request(app).delete(`/api/quizzes/${q1.body.quiz._id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);

    // Recreating Quiz A should succeed
    const reA = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Q1 New' })]), { quizTitle: 'Quiz A' });
    expect(reA.status).toBe(201);

    // Creating Quiz B again should still be rejected (Quiz B is still active)
    const dupB = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Q2 New' })]), { quizTitle: 'Quiz B' });
    expect(dupB.status).toBe(400);
    expect(dupB.body.errorType).toBe('DUPLICATE_TITLE');
  });

  test('Scenario H — PUT /api/quizzes/:id title update respects title uniqueness and soft deletion', async () => {
    const q1 = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Q1' })]), { quizTitle: 'Quiz Title 1' });
    const q2 = await importFile(adminToken, toBuffer([baseRow({ QUESTION: 'Q2' })]), { quizTitle: 'Quiz Title 2' });

    // Updating q2's title to "Quiz Title 1" (active) -> REJECTED
    const updateRes1 = await request(app)
      .put(`/api/quizzes/${q2.body.quiz._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Quiz Title 1' });
    expect(updateRes1.status).toBe(400);
    expect(updateRes1.body.errorType).toBe('DUPLICATE_TITLE');

    // Delete q1
    await request(app).delete(`/api/quizzes/${q1.body.quiz._id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);

    // Now updating q2's title to "Quiz Title 1" (deleted) -> ALLOWED
    const updateRes2 = await request(app)
      .put(`/api/quizzes/${q2.body.quiz._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Quiz Title 1' });
    expect(updateRes2.status).toBe(200);
    expect(updateRes2.body.quiz.title).toBe('Quiz Title 1');
  });
});
