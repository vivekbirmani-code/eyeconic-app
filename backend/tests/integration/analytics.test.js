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
      question: 'Sample question?',
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 1,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body;
}

describe('Analytics endpoints', () => {
  let admin;
  let mentor;
  let student;
  let otherStudent;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    mentor = await createUser({ role: 'mentor' });
    student = await createUser({ role: 'student', name: 'Student One' });
    otherStudent = await createUser({ role: 'student', name: 'Other Student' });
    subject = await createSubject('Pathology');

    await MentorStudentAssignment.create({
      mentor: mentor.user._id,
      student: student.user._id,
      isActive: true,
      assignedBy: admin.user._id,
    });
  });

  async function createQuizWithAttempt({ assignedStudent, marksObtained, answers, questions }) {
    const quiz = await Quiz.create({
      title: 'Analytics Test',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [assignedStudent.user._id],
      createdBy: admin.user._id,
    });

    const attempt = await QuizAttempt.create({
      quiz: quiz._id,
      student: assignedStudent.user._id,
      status: 'completed',
      startTime: new Date(Date.now() - 60 * 60 * 1000),
      endTime: new Date(),
      score: answers.filter((a) => a.isCorrect).length,
      totalQuestions: questions.length,
      marksObtained,
      totalMarks: questions.length * 4,
      answers,
    });

    return { quiz, attempt, questions };
  }

  it('returns separated scorePercentage and accuracy for test analytics', async () => {
    const q1 = await createQuestion(admin, subject);
    const q2 = await createQuestion(admin, subject, { correctAnswer: 2 });
    const { quiz } = await createQuizWithAttempt({
      assignedStudent: student,
      marksObtained: 3,
      questions: [q1, q2],
      answers: [
        {
          questionIndex: 0,
          questionId: q1._id,
          selectedAnswer: 1,
          isCorrect: true,
          metadataSnapshot: { questionType: 'mcq_single', subjectName: 'Pathology' },
        },
        {
          questionIndex: 1,
          questionId: q2._id,
          selectedAnswer: 0,
          isCorrect: false,
          metadataSnapshot: { questionType: 'mcq_single', subjectName: 'Pathology' },
        },
      ],
    });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.overview.avgScorePercentage).toBe(37.5);
    expect(res.body.overview.avgAccuracy).toBe(50);
    expect(res.body.studentPerformance[0].scorePercentage).toBe(37.5);
    expect(res.body.studentPerformance[0].accuracy).toBe(50);
    expect(res.body.scoreDistribution).toBeDefined();
  });

  it('scopes mentor test-report to assigned students only', async () => {
    const q = await createQuestion(admin, subject);
    const quiz = await Quiz.create({
      title: 'Scoped Test',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [q._id],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id, otherStudent.user._id],
      createdBy: admin.user._id,
    });

    await QuizAttempt.create({
      quiz: quiz._id,
      student: student.user._id,
      status: 'completed',
      endTime: new Date(),
      score: 1,
      totalQuestions: 1,
      marksObtained: 4,
      totalMarks: 4,
      answers: [{ questionIndex: 0, selectedAnswer: 1, isCorrect: true, metadataSnapshot: { questionType: 'mcq_single' } }],
    });
    await QuizAttempt.create({
      quiz: quiz._id,
      student: otherStudent.user._id,
      status: 'completed',
      endTime: new Date(),
      score: 0,
      totalQuestions: 1,
      marksObtained: -1,
      totalMarks: 4,
      answers: [{ questionIndex: 0, selectedAnswer: 0, isCorrect: false, metadataSnapshot: { questionType: 'mcq_single' } }],
    });

    const mentorRes = await request(app)
      .get(`/api/quizzes/analytics/test-report/${quiz._id}`)
      .set('Authorization', `Bearer ${mentor.token}`);

    expect(mentorRes.status).toBe(200);
    expect(mentorRes.body.students).toHaveLength(1);
    expect(mentorRes.body.students[0].studentName).toBe('Student One');
  });

  it('rejects unauthorized mentor for student analytics', async () => {
    const res = await request(app)
      .get(`/api/quizzes/analytics/student/${otherStudent.user._id}`)
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(res.status).toBe(403);
  });

  it('supports date range filtering on student analytics', async () => {
    const q1 = await createQuestion(admin, subject);
    const q2 = await createQuestion(admin, subject, { correctAnswer: 2 });
    const { quiz } = await createQuizWithAttempt({
      assignedStudent: student,
      marksObtained: 8,
      questions: [q1, q2],
      answers: [
        { questionIndex: 0, questionId: q1._id, selectedAnswer: 1, isCorrect: true, metadataSnapshot: { questionType: 'mcq_single' } },
        { questionIndex: 1, questionId: q2._id, selectedAnswer: 2, isCorrect: true, metadataSnapshot: { questionType: 'mcq_single' } },
      ],
    });

    const oldAttempt = await QuizAttempt.findOne({ quiz: quiz._id });
    oldAttempt.endTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await oldAttempt.save();

    const allRes = await request(app)
      .get(`/api/quizzes/analytics/student/${student.user._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(allRes.body.summary.totalTests).toBe(1);

    const filteredRes = await request(app)
      .get(`/api/quizzes/analytics/student/${student.user._id}?range=7d`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(filteredRes.body.summary.totalTests).toBe(0);
  });
});
