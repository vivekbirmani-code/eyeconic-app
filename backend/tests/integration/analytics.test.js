const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuestionBank = require('../../models/QuestionBank');
const QuizAttempt = require('../../models/QuizAttempt');
const GuestAttempt = require('../../models/GuestAttempt');
const Guest = require('../../models/Guest');
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

// Public participants are first-class attempts: guest attempts join every
// test-level aggregate for ADMINS through the same computeTestAnalytics call
// the exports use. Mentors keep registered-only aggregates and never receive
// guest fields. Rankings stay registered-only in every case.
describe('Test analytics with public participants', () => {
  let admin;
  let mentor;
  let student;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    mentor = await createUser({ role: 'mentor' });
    student = await createUser({ role: 'student', name: 'Student One' });
    subject = await createSubject('Pathology');

    await MentorStudentAssignment.create({
      mentor: mentor.user._id,
      student: student.user._id,
      isActive: true,
      assignedBy: admin.user._id,
    });
  });

  // Completed guest attempt for a verified lead, seeded directly (same shape
  // the /submit grading path persists). `outcomes` drives C/W/S per question:
  // 'correct' | 'wrong' | 'skip'. Phone is unique per lead (indexed unique).
  let leadSeed = 0;
  async function addGuestAttempt(quiz, questions, name, outcomes, marksObtained) {
    const lead = await Guest.create({
      name,
      email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      emailVerifiedAt: new Date(),
      phone: `+9198765${String(100000 + (leadSeed += 1)).slice(1)}`,
      marketingConsent: { granted: true, updatedAt: new Date() },
      quizzesTaken: [quiz._id],
    });

    const answers = questions.map((q, i) => {
      const outcome = outcomes[i] || 'skip';
      return {
        questionIndex: i,
        questionId: q._id,
        selectedAnswer: outcome === 'correct' ? 1 : outcome === 'wrong' ? 0 : -1,
        isCorrect: outcome === 'correct',
        metadataSnapshot: { questionType: 'mcq_single', subjectName: 'Pathology' },
      };
    });

    return GuestAttempt.create({
      quiz: quiz._id,
      guest: lead._id,
      guestId: `device-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      guestName: name,
      guestEmail: lead.email,
      guestPhone: lead.phone,
      status: 'completed',
      startTime: new Date(Date.now() - 30 * 60 * 1000),
      endTime: new Date(),
      score: outcomes.filter((o) => o === 'correct').length,
      totalQuestions: questions.length,
      marksObtained,
      totalMarks: questions.length * 4,
      answers,
    });
  }

  function buildQuiz({ questions, assignedStudents = [] }) {
    return Quiz.create({
      title: `Public Analytics Test ${Date.now()}-${Math.random().toString(36).slice(2)}`,
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents,
      createdBy: admin.user._id,
    });
  }

  it('computes every aggregate from guests alone on a public-only test', async () => {
    const q1 = await createQuestion(admin, subject);
    const q2 = await createQuestion(admin, subject, { question: 'Public Q2?' });
    const quiz = await buildQuiz({ questions: [q1, q2] }); // assignedStudents: []

    // Dinesh: 1 correct + 1 wrong (4 - 1 = 3 marks); Minal: both correct (8).
    await addGuestAttempt(quiz, [q1, q2], 'Dinesh Sharma', ['correct', 'wrong'], 3);
    await addGuestAttempt(quiz, [q1, q2], 'Minal Singh', ['correct', 'correct'], 8);

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);

    expect(res.body.overview.totalAssigned).toBe(0);
    expect(res.body.overview.totalAttempted).toBe(2);
    // Nothing was assigned — completion is null ("—"), not 0%.
    expect(res.body.overview.completionRate).toBeNull();
    expect(res.body.overview.avgScore).toBe(5.5); // (3 + 8) / 2
    expect(res.body.overview.avgScorePercentage).toBe(68.75); // (37.5 + 100) / 2
    expect(res.body.overview.avgAccuracy).toBe(75); // (50 + 100) / 2
    expect(res.body.overview.highestScore).toBe(8);
    expect(res.body.overview.lowestScore).toBe(3);

    expect(res.body.performanceMetrics.avgCorrect).toBe(1.5);
    expect(res.body.performanceMetrics.avgWrong).toBe(0.5);
    expect(res.body.performanceMetrics.avgSkipped).toBe(0);

    // Question-wise analytics from BOTH guests: q1 2/2 correct, q2 1 correct,
    // 1 wrong. Percentages use 2 completed attempts as denominator.
    expect(res.body.questionAnalytics[0]).toMatchObject({
      sampleSize: 2, correctCount: 2, wrongCount: 0, skippedCount: 0, percentCorrect: 100,
    });
    expect(res.body.questionAnalytics[1]).toMatchObject({
      sampleSize: 2, correctCount: 1, wrongCount: 1, skippedCount: 0, percentCorrect: 50,
    });

    // Distribution: Dinesh 37.5% → 21–40% bucket; Minal 100% → 81–100%.
    const byLabel = Object.fromEntries(res.body.scoreDistribution.map((b) => [b.label, b.count]));
    expect(byLabel).toEqual({ '0–20%': 0, '21–40%': 1, '41–60%': 0, '61–80%': 0, '81–100%': 1 });

    // Guests appear in their own unranked section; rankings stay empty.
    expect(res.body.studentPerformance).toEqual([]);
    expect(res.body.guestParticipants).toHaveLength(2);
    const dinesh = res.body.guestParticipants.find((g) => g.name === 'Dinesh Sharma');
    expect(dinesh).toMatchObject({ correct: 1, incorrect: 1, skipped: 0, accuracy: 50 });

    // Mentors see none of it: registered-only aggregates, no guest section.
    const mentorRes = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(mentorRes.status).toBe(200);
    expect(mentorRes.body.overview.totalAttempted).toBe(0);
    expect(mentorRes.body).not.toHaveProperty('guestParticipants');
  });

  it('unions registered + guest attempts on mixed tests without touching rankings', async () => {
    const q1 = await createQuestion(admin, subject);
    const q2 = await createQuestion(admin, subject, { question: 'Mixed Q2?' });
    const quiz = await buildQuiz({ questions: [q1, q2], assignedStudents: [student.user._id] });

    // Registered: 1 correct, 1 wrong → 3 marks (37.5%).
    await QuizAttempt.create({
      quiz: quiz._id,
      student: student.user._id,
      status: 'completed',
      startTime: new Date(Date.now() - 60 * 60 * 1000),
      endTime: new Date(),
      score: 1,
      totalQuestions: 2,
      marksObtained: 3,
      totalMarks: 8,
      answers: [
        { questionIndex: 0, questionId: q1._id, selectedAnswer: 1, isCorrect: true, metadataSnapshot: { questionType: 'mcq_single' } },
        { questionIndex: 1, questionId: q2._id, selectedAnswer: 0, isCorrect: false, metadataSnapshot: { questionType: 'mcq_single' } },
      ],
    });
    // Guest: both correct → 8 marks (100%).
    await addGuestAttempt(quiz, [q1, q2], 'Rahul Sharma', ['correct', 'correct'], 8);

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);

    expect(res.body.overview.totalAttempted).toBe(2);
    // Completion is scoped to the ASSIGNED cohort: 1 registered student
    // assigned, 1 completed → 100%, unaffected by the guest.
    expect(res.body.overview.completionRate).toBe(100);
    expect(res.body.overview.avgScore).toBe(5.5);
    expect(res.body.overview.avgScorePercentage).toBe(68.75);

    expect(res.body.studentPerformance).toHaveLength(1);
    expect(res.body.studentPerformance[0].student.name).toBe('Student One');
    expect(res.body.guestParticipants).toHaveLength(1);

    expect(res.body.questionAnalytics[0]).toMatchObject({ sampleSize: 2, correctCount: 2 });
    expect(res.body.questionAnalytics[1]).toMatchObject({ sampleSize: 2, correctCount: 1, wrongCount: 1 });
  });

  it('counts skipped and partial guest answers in question analytics', async () => {
    const q1 = await createQuestion(admin, subject);
    const q2 = await createQuestion(admin, subject, { question: 'Skip Q2?' });
    const q3 = await createQuestion(admin, subject, { question: 'Skip Q3?' });
    const quiz = await buildQuiz({ questions: [q1, q2, q3] });

    // Guest 1: correct, wrong, skip; Guest 2: skip, skip, correct.
    await addGuestAttempt(quiz, [q1, q2, q3], 'Partial One', ['correct', 'wrong', 'skip'], 3);
    await addGuestAttempt(quiz, [q1, q2, q3], 'Partial Two', ['skip', 'skip', 'correct'], 4);

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);

    expect(res.body.questionAnalytics[0]).toMatchObject({
      sampleSize: 2, correctCount: 1, wrongCount: 0, skippedCount: 1,
      percentCorrect: 50, percentWrong: 0, percentSkipped: 50,
    });
    expect(res.body.questionAnalytics[1]).toMatchObject({
      correctCount: 0, wrongCount: 1, skippedCount: 1,
    });
    expect(res.body.questionAnalytics[2]).toMatchObject({
      correctCount: 1, wrongCount: 0, skippedCount: 1,
    });
    // Easiest/hardest derive from the same guest-inclusive rows.
    expect(res.body.easiestQuestion).not.toBeNull();
    expect(res.body.hardestQuestion).not.toBeNull();
  });

  it('keeps a zero-attempt assigned test at explicit zeros and nulls', async () => {
    const q1 = await createQuestion(admin, subject);
    const quiz = await buildQuiz({ questions: [q1], assignedStudents: [student.user._id] });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test/${quiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);

    expect(res.body.overview.totalAssigned).toBe(1);
    expect(res.body.overview.totalAttempted).toBe(0);
    // Assigned but nobody completed → an honest 0%, and no averages yet.
    expect(res.body.overview.completionRate).toBe(0);
    expect(res.body.overview.avgScorePercentage).toBeNull();
    expect(res.body.overview.avgAccuracy).toBeNull();
    expect(res.body.overview.avgScore).toBe(0);
    expect(res.body.questionAnalytics[0].sampleSize).toBe(0);
    expect(res.body.questionAnalytics[0].percentCorrect).toBe(0);
    expect(res.body.scoreDistribution.every((b) => b.count === 0)).toBe(true);
    expect(res.body.studentPerformance).toEqual([]);
    expect(res.body.guestParticipants).toEqual([]);
  });
});

describe('CSV export hardening', () => {
  let admin;
  let student;
  let subject;

  async function createQuizWithTitle(title) {
    return Quiz.create({
      title,
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [],
      createdBy: admin.user._id,
    });
  }

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    student = await createUser({ role: 'student', name: 'Student One' });
    subject = await createSubject('Pathology');
  });

  it('sanitizes hostile quiz titles in the filename header and CSV cells', async () => {
    // Quotes, newlines and control chars previously reached Content-Disposition
    // raw (header injection / 500) and the title cell unescaped.
    const quiz = await createQuizWithTitle('Bad"Title\r\n=SUM(A1)');

    const res = await request(app)
      .get(`/api/quizzes/analytics/test-report/${quiz._id}/csv`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="Bad Title SUMA1_report.csv"; ' +
        "filename*=UTF-8''Bad%20Title%20%3DSUM(A1)_report.csv"
    );
    // Title cell survives in the body, RFC-4180 quoted.
    expect(res.text).toContain('"Bad""Title =SUM(A1)"');
  });

  it('neutralizes Excel formula cells while keeping negative numeric marks', async () => {
    const quiz = await createQuizWithTitle('=SUM(A1)');
    await QuizAttempt.create({
      quiz: quiz._id,
      student: student.user._id,
      status: 'completed',
      startTime: new Date(Date.now() - 60 * 60 * 1000),
      endTime: new Date(),
      score: 0,
      totalQuestions: 0,
      marksObtained: -2,
      totalMarks: 0,
      answers: [],
    });

    const res = await request(app)
      .get(`/api/quizzes/analytics/test-report/${quiz._id}/csv`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    // Leading = is neutralized with an apostrophe prefix in the cell...
    expect(res.text).toContain("'=SUM(A1)");
    // ...and stripped from the ASCII download filename, but preserved in the
    // RFC 5987 filename* parameter.
    expect(res.headers['content-disposition']).toBe(
      "attachment; filename=\"SUMA1_report.csv\"; filename*=UTF-8''%3DSUM(A1)_report.csv"
    );
    // Plain negative marks (negative marking) stay numeric, not apostrophe-prefixed.
    expect(res.text).toMatch(/,-2,/);
    expect(res.text).not.toContain("'-2");
  });

  it('keeps phone-number cells intact (no apostrophe prefix on +91...)', async () => {
    // Lead phones are the point of the guest-participant export; escaping
    // their leading "+" would corrupt click-to-dial / CRM matching.
    const quiz = await createQuizWithTitle('+919876543210');

    const res = await request(app)
      .get(`/api/quizzes/analytics/test-report/${quiz._id}/csv`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    // The cell (quiz title row) carries the phone verbatim...
    expect(res.text).toContain('+919876543210');
    expect(res.text).not.toContain("'+91");
    // ...while genuinely hostile "+" payloads are still neutralized.
    const hostile = await createQuizWithTitle('+cmd|/C calc');
    const hostileRes = await request(app)
      .get(`/api/quizzes/analytics/test-report/${hostile._id}/csv`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(hostileRes.text).toContain("'+cmd|/C calc");
  });

  it('preserves non-ASCII titles via the RFC 5987 filename* parameter', async () => {
    // Devanagari/Tamil titles used to collapse to the same ASCII fallback,
    // making consecutive exports overwrite each other.
    const quiz = await createQuizWithTitle('डिजिटल टेस्ट');

    const res = await request(app)
      .get(`/api/quizzes/analytics/test-report/${quiz._id}/csv`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    // ASCII fallback stays injection-safe...
    expect(res.headers['content-disposition']).toContain(
      'filename="test_report.csv"'
    );
    // ...and the Unicode title survives in filename*.
    expect(res.headers['content-disposition']).toContain(
      "filename*=UTF-8''%E0%A4%A1%E0%A4%BF%E0%A4%9C%E0%A4%BF%E0%A4%9F%E0%A4%B2%20%E0%A4%9F%E0%A5%87%E0%A4%B8%E0%A5%8D%E0%A4%9F_report.csv"
    );
  });

  it('serves the export with download-safe response headers', async () => {
    const quiz = await createQuizWithTitle('Header Test');

    const res = await request(app)
      .get(`/api/quizzes/analytics/test-report/${quiz._id}/csv`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
