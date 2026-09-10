const request = require('supertest');
const { connect, closeDatabase, clearDatabase } = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuizAttempt = require('../../models/QuizAttempt');
const QuestionBank = require('../../models/QuestionBank');

let app;

beforeAll(async () => {
  await connect();
  app = buildApp();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('Delete Quiz Workflow End-to-End', () => {
  let admin, student, subject, question;

  beforeEach(async () => {
    admin = await createUser({ role: 'admin', name: 'Admin User' });
    student = await createUser({ role: 'student', name: 'Student User' });
    subject = await createSubject('Biochemistry');

    question = await QuestionBank.create({
      question: 'What is ATP?',
      options: ['Energy currency', 'Protein', 'Fat', 'Carbohydrate'],
      correctAnswer: 0,
      subject: subject._id,
      difficulty: 'medium',
      questionType: 'mcq_single',
      createdBy: admin.user._id,
    });
  });

  test('Test 1: Admin can delete test with no student attempts', async () => {
    const quiz = await Quiz.create({
      title: 'Quiz to Delete',
      subject: subject._id,
      testType: 'daily',
      duration: 15,
      questions: [question._id],
      assignedStudents: [],
      createdBy: admin.user._id,
    });

    const res = await request(app)
      .delete(`/api/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Test deleted successfully');

    // Verify database state: soft-deleted
    const updatedQuiz = await Quiz.findById(quiz._id);
    expect(updatedQuiz.isActive).toBe(false);
    expect(updatedQuiz.isDeleted).toBe(true);
    expect(updatedQuiz.deletedBy.toString()).toBe(admin.user._id.toString());
    expect(updatedQuiz.deletedAt).toBeDefined();

    // Verify Quiz list omits it
    const listRes = await request(app)
      .get('/api/quizzes')
      .set('Authorization', `Bearer ${admin.token}`);
    
    expect(listRes.status).toBe(200);
    const found = listRes.body.find(q => q._id === quiz._id.toString());
    expect(found).toBeUndefined();
  });

  test('Test 2: Delete assigned test removes it from student available tests', async () => {
    const quiz = await Quiz.create({
      title: 'Assigned Test',
      subject: subject._id,
      testType: 'weekly',
      duration: 30,
      questions: [question._id],
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
    });

    // Student can see it initially
    const initStudentList = await request(app)
      .get('/api/quizzes')
      .set('Authorization', `Bearer ${student.token}`);
    expect(initStudentList.body.some(q => q._id === quiz._id.toString())).toBe(true);

    // Admin deletes it
    await request(app)
      .delete(`/api/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    // Student no longer sees it in list
    const afterStudentList = await request(app)
      .get('/api/quizzes')
      .set('Authorization', `Bearer ${student.token}`);
    expect(afterStudentList.body.some(q => q._id === quiz._id.toString())).toBe(false);

    // Direct access returns 404 with clear message
    const getRes = await request(app)
      .get(`/api/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.message).toContain('deleted by the administrator');

    // Starting attempt returns 404 with clear message
    const startRes = await request(app)
      .post(`/api/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(startRes.status).toBe(404);
    expect(startRes.body.message).toContain('deleted by the administrator');
  });

  test('Test 3: Completed student attempt is retained when quiz is deleted', async () => {
    const quiz = await Quiz.create({
      title: 'Completed Test',
      subject: subject._id,
      testType: 'grand',
      duration: 60,
      questions: [question._id],
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
    });

    const attempt = await QuizAttempt.create({
      quiz: quiz._id,
      student: student.user._id,
      status: 'completed',
      score: 100,
      marksObtained: 4,
      totalMarks: 4,
      totalQuestions: 1,
      answers: [{
        questionIndex: 0,
        questionId: question._id,
        selectedAnswer: 0,
        isCorrect: true,
      }]
    });

    // Delete quiz
    await request(app)
      .delete(`/api/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    // Verify QuizAttempt remains intact in DB for student analytics/history
    const savedAttempt = await QuizAttempt.findById(attempt._id);
    expect(savedAttempt).toBeDefined();
    expect(savedAttempt.score).toBe(100);
    expect(savedAttempt.status).toBe('completed');
  });

  test('Test 4: Non-admin users cannot delete tests', async () => {
    const quiz = await Quiz.create({
      title: 'Protected Test',
      subject: subject._id,
      testType: 'daily',
      duration: 15,
      questions: [question._id],
      createdBy: admin.user._id,
    });

    // Student attempt to delete -> 403
    const studentRes = await request(app)
      .delete(`/api/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${student.token}`);
    expect(studentRes.status).toBe(403);

    // Unauthenticated attempt -> 401
    const unauthRes = await request(app)
      .delete(`/api/quizzes/${quiz._id}`);
    expect(unauthRes.status).toBe(401);

    // Test remains active in DB
    const checkQuiz = await Quiz.findById(quiz._id);
    expect(checkQuiz.isActive).toBe(true);
  });

  test('Test 5: Idempotent double deletion', async () => {
    const quiz = await Quiz.create({
      title: 'Double Delete Test',
      subject: subject._id,
      testType: 'daily',
      duration: 15,
      questions: [question._id],
      createdBy: admin.user._id,
    });

    // First delete
    const firstRes = await request(app)
      .delete(`/api/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(firstRes.status).toBe(200);

    // Second delete attempt -> 404
    const secondRes = await request(app)
      .delete(`/api/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(secondRes.status).toBe(404);
    expect(secondRes.body.message).toContain('already deleted');
  });

  test('Test 6: Deleted public share links return explicit deleted message', async () => {
    const quiz = await Quiz.create({
      title: 'Public Shared Test',
      subject: subject._id,
      testType: 'daily',
      duration: 15,
      questions: [question._id],
      createdBy: admin.user._id,
      isPublic: true,
      shareToken: 'test-share-token-12345'
    });

    // Verify public endpoint works before delete
    const pubBefore = await request(app)
      .get('/api/public/quiz/test-share-token-12345');
    expect(pubBefore.status).toBe(200);

    // Delete quiz
    await request(app)
      .delete(`/api/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    // Public endpoint now returns 404 with QUIZ_DELETED code and clear message
    const pubAfter = await request(app)
      .get('/api/public/quiz/test-share-token-12345');
    expect(pubAfter.status).toBe(404);
    expect(pubAfter.body.code).toBe('QUIZ_DELETED');
    expect(pubAfter.body.message).toContain('deleted by the administrator');
  });
});
