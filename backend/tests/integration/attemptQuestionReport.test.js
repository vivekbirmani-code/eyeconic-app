const request = require('supertest');
const XLSX = require('xlsx');
const mongoose = require('mongoose');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuizAttempt = require('../../models/QuizAttempt');
const GuestAttempt = require('../../models/GuestAttempt');
const Guest = require('../../models/Guest');
const QuestionBank = require('../../models/QuestionBank');
const MentorStudentAssignment = require('../../models/MentorStudentAssignment');

// Superagent has no parser for the xlsx MIME type — buffer the bytes ourselves.
const binaryParser = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

// Question-bank documents are created directly (the API route strips answer
// fields for students and the report needs exact answer-key shapes anyway).
async function createQuestion(subject, overrides = {}) {
  return QuestionBank.create({
    subject: subject._id,
    topicName: 'Genetics',
    subtopicName: 'Mendelian Inheritance',
    system: 'Genetic Disorders',
    questionType: 'mcq_single',
    difficulty: 'medium',
    question: 'Default question text?',
    options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
    correctAnswer: 1,
    ...overrides,
  });
}

// QuestionBank enforces one ACTIVE doc per (subject, normalized text) —
// fixtures that create parallel attempts need distinct texts.
let fixtureSeq = 0;

/**
 * A six-question attempt covering every supported question type and all three
 * verdicts:
 *   Q1 mcq_single   correct
 *   Q2 mcq_single   incorrect
 *   Q3 mcq_single   skipped (visited, not answered)
 *   Q4 multiple_correct correct
 *   Q5 match_the_following incorrect
 *   Q6 numerical    skipped (no answer row at all)
 */
async function createFullAttempt({ subject, studentId, quizOverrides = {}, marksObtained }) {
  fixtureSeq += 1;
  const tag = ` [set ${fixtureSeq}]`;
  const q1 = await createQuestion(subject, { question: `Q1 mitochondria question?${tag}` });
  const q2 = await createQuestion(subject, { question: `Q2 ribosome question?${tag}` });
  const q3 = await createQuestion(subject, { question: `Q3 golgi question?${tag}` });
  const q4 = await createQuestion(subject, {
    question: `Q4 multiple correct question?${tag}`,
    questionType: 'multiple_correct',
    correctAnswer: [0, 2],
  });
  const q5 = await createQuestion(subject, {
    question: `Q5 match the following question?${tag}`,
    questionType: 'match_the_following',
    columnA: ['Mitosis', 'Meiosis'],
    columnB: ['Cell division for growth', 'Cell division for gametes'],
    correctAnswer: { 0: '0', 1: '1' },
  });
  const q6 = await createQuestion(subject, {
    question: `Q6 numerical question?${tag}`,
    questionType: 'numerical',
    options: undefined,
    correctAnswer: 42,
  });

  const quiz = await Quiz.create({
    title: 'Question Report Test',
    subject: subject._id,
    testType: 'daily',
    duration: 30,
    questions: [q1._id, q2._id, q3._id, q4._id, q5._id, q6._id],
    positiveMarks: 4,
    negativeMarks: 1,
    assignedStudents: [studentId],
    createdBy: new mongoose.Types.ObjectId(),
    ...quizOverrides,
  });

  const attempt = await QuizAttempt.create({
    quiz: quiz._id,
    student: studentId,
    status: 'completed',
    startTime: new Date(Date.now() - 30 * 60 * 1000),
    endTime: new Date(),
    score: 2,
    totalQuestions: 6,
    marksObtained: marksObtained !== undefined ? marksObtained : 6, // 3*4 - 2*1... adjusted below
    totalMarks: 24,
    answers: [
      { questionIndex: 0, questionId: q1._id, selectedAnswer: 1, isCorrect: true, timeSpent: 30, metadataSnapshot: { questionType: 'mcq_single' } },
      { questionIndex: 1, questionId: q2._id, selectedAnswer: 0, isCorrect: false, timeSpent: 45, metadataSnapshot: { questionType: 'mcq_single' } },
      { questionIndex: 2, questionId: q3._id, selectedAnswer: -1, isCorrect: false, timeSpent: 10, metadataSnapshot: { questionType: 'mcq_single' } },
      { questionIndex: 3, questionId: q4._id, selectedAnswer: [0, 2], isCorrect: true, timeSpent: 60, metadataSnapshot: { questionType: 'multiple_correct' } },
      { questionIndex: 4, questionId: q5._id, selectedAnswer: { 0: '1', 1: '0' }, isCorrect: false, timeSpent: 90, metadataSnapshot: { questionType: 'match_the_following' } },
      // Q6: no answer row at all — never visited.
    ],
  });

  return { quiz, attempt, questions: [q1, q2, q3, q4, q5, q6] };
}

const getJson = (attemptId, token) =>
  request(app).get(`/api/quizzes/analytics/attempt/${attemptId}/question-report`).set('Authorization', `Bearer ${token}`);

const getCsv = (attemptId, token) =>
  request(app).get(`/api/quizzes/analytics/attempt/${attemptId}/question-report/csv`).set('Authorization', `Bearer ${token}`);

const getExcel = (attemptId, token) =>
  request(app).get(`/api/quizzes/analytics/attempt/${attemptId}/question-report/excel`)
    .set('Authorization', `Bearer ${token}`)
    .buffer(true)
    .parse(binaryParser);

function csvRows(res) {
  const wb = XLSX.read(res.text, { type: 'string' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
}

function excelRows(res) {
  const wb = XLSX.read(res.body, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
}

function findRowByText(rows, text) {
  const row = rows.find((cells) => cells.some((c) => String(c) === text));
  expect(row).toBeDefined();
  return row;
}

describe('Attempt question report', () => {
  let admin;
  let mentor;
  let unassignedMentor;
  let student;
  let otherStudent;
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    mentor = await createUser({ role: 'mentor' });
    unassignedMentor = await createUser({ role: 'mentor', name: 'Unassigned Mentor' });
    student = await createUser({ role: 'student', name: 'Student One' });
    otherStudent = await createUser({ role: 'student', name: 'Student Two' });
    subject = await createSubject('Pathology');

    await MentorStudentAssignment.create({
      mentor: mentor.user._id,
      student: student.user._id,
      isActive: true,
      assignedBy: admin.user._id,
    });
  });

  describe('authorization and scoping', () => {
    it('serves admins the report for any registered attempt', async () => {
      const { attempt } = await createFullAttempt({ subject, studentId: student.user._id });
      const res = await getJson(attempt._id, admin.token);

      expect(res.status).toBe(200);
      expect(res.body.participantType).toBe('registered');
      expect(res.body.student.name).toBe('Student One');
      expect(res.body.student.email).toContain('@example.com');
    });

    it('serves mentors only their assigned students', async () => {
      const { attempt } = await createFullAttempt({ subject, studentId: student.user._id });
      const assignedRes = await getJson(attempt._id, mentor.token);
      expect(assignedRes.status).toBe(200);

      const other = await createFullAttempt({ subject, studentId: otherStudent.user._id });
      const deniedRes = await getJson(other.attempt._id, unassignedMentor.token);
      expect(deniedRes.status).toBe(403);
    });

    it('rejects students and unauthenticated callers', async () => {
      const { attempt } = await createFullAttempt({ subject, studentId: student.user._id });

      const studentRes = await getJson(attempt._id, student.token);
      expect(studentRes.status).toBe(403);

      const anonRes = await request(app).get(`/api/quizzes/analytics/attempt/${attempt._id}/question-report`);
      expect(anonRes.status).toBe(401);
    });

    it('resolves guest attempts for admins only', async () => {
      const { quiz, questions } = await createFullAttempt({ subject, studentId: student.user._id });
      const lead = await Guest.create({
        name: 'Rahul Sharma',
        email: 'rahul.sharma@example.com',
        phone: '+919876543210',
        emailVerifiedAt: new Date(),
      });
      const guestAttempt = await GuestAttempt.create({
        quiz: quiz._id,
        guest: lead._id,
        guestId: 'device-report-1',
        guestName: 'Rahul Sharma',
        guestEmail: 'rahul.sharma@example.com',
        status: 'completed',
        startTime: new Date(Date.now() - 20 * 60 * 1000),
        endTime: new Date(),
        score: 1,
        totalQuestions: questions.length,
        marksObtained: 0,
        totalMarks: 24,
        answers: questions.map((q, i) => ({
          questionIndex: i,
          questionId: q._id,
          selectedAnswer: 1,
          isCorrect: q.questionType === 'mcq_single' && i === 0,
          metadataSnapshot: { questionType: q.questionType },
        })),
      });

      const adminRes = await getJson(guestAttempt._id, admin.token);
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.participantType).toBe('guest');
      expect(adminRes.body.student.name).toBe('Rahul Sharma');

      // Mentors/students get a bare 404 — guest leads are admin-privileged.
      const mentorRes = await getJson(guestAttempt._id, mentor.token);
      expect(mentorRes.status).toBe(404);
    });

    it('returns 404 for unknown or malformed attempt ids', async () => {
      const missing = await getJson('012345678901234567890123', admin.token);
      expect(missing.status).toBe(404);

      const malformed = await request(app)
        .get('/api/quizzes/analytics/attempt/not-an-objectid/question-report')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(malformed.status).toBe(404);
    });

    it('rejects in-progress attempts with 400', async () => {
      const { quiz, questions } = await createFullAttempt({ subject, studentId: student.user._id });
      const inProgress = await QuizAttempt.create({
        quiz: quiz._id,
        student: student.user._id,
        status: 'in_progress',
        totalQuestions: questions.length,
        answers: [],
      });
      const res = await getJson(inProgress._id, admin.token);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('ATTEMPT_NOT_COMPLETED');
    });
  });

  describe('report content', () => {
    it('represents every question with response, verdict and answer key', async () => {
      const { attempt } = await createFullAttempt({ subject, studentId: student.user._id });
      const res = await getJson(attempt._id, admin.token);
      expect(res.status).toBe(200);

      const { questions, attempt: summary } = res.body;
      expect(questions).toHaveLength(6);
      expect(summary.totalQuestions).toBe(6);
      expect(summary.correct).toBe(2);
      expect(summary.incorrect).toBe(2);
      expect(summary.skipped).toBe(2);

      const byNumber = (n) => questions.find((q) => q.questionNumber === n);

      // Correct mcq: response + key formatted with label and text.
      const q1 = byNumber(1);
      expect(q1.result).toBe('correct');
      expect(q1.resultLabel).toBe('Correct');
      expect(q1.studentResponseLabel).toBe('B');
      expect(q1.studentResponseText).toBe('Mitochondria');
      expect(q1.correctAnswerLabel).toBe('B');
      expect(q1.marks).toBe(4);

      // Incorrect mcq: response distinguished from the key.
      const q2 = byNumber(2);
      expect(q2.result).toBe('incorrect');
      expect(q2.studentResponseText).toBe('Nucleus');
      expect(q2.correctAnswerText).toBe('Mitochondria');
      expect(q2.marks).toBe(-1);

      // Skipped: never treated as correct, no invented response.
      const q3 = byNumber(3);
      expect(q3.result).toBe('skipped');
      expect(q3.resultLabel).toBe('Skipped');
      expect(q3.studentResponseText).toBe('Not answered');
      expect(q3.marks).toBe(0);

      // Multiple-correct: set comparison, labels joined.
      const q4 = byNumber(4);
      expect(q4.result).toBe('correct');
      expect(q4.studentResponseLabel).toBe('A, C');
      expect(q4.questionTypeLabel).toBe('Multiple Correct');

      // Match-the-following: pair formatting.
      const q5 = byNumber(5);
      expect(q5.result).toBe('incorrect');
      expect(q5.studentResponseText).toContain('Mitosis');
      expect(q5.correctAnswerText).toContain('Mitosis');

      // Numerical without any answer row: skipped.
      const q6 = byNumber(6);
      expect(q6.result).toBe('skipped');
      expect(q6.studentResponseText).toBe('Not answered');
      expect(q6.correctAnswerText).toBe('42');

      // Ordering preserved.
      expect(questions.map((q) => q.questionNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('exposes the answer key even when the quiz hides solutions from students', async () => {
      const { attempt } = await createFullAttempt({
        subject,
        studentId: student.user._id,
        quizOverrides: { shareSolution: false },
      });
      const res = await getJson(attempt._id, admin.token);
      expect(res.status).toBe(200);
      expect(res.body.questions[0].correctAnswerText).toBe('Mitochondria');
    });

    it('scopes to the exact attempt when the student retook the test', async () => {
      const { quiz, questions } = await createFullAttempt({ subject, studentId: student.user._id });
      const second = await QuizAttempt.create({
        quiz: quiz._id,
        student: student.user._id,
        status: 'completed',
        startTime: new Date(),
        endTime: new Date(),
        score: 0,
        totalQuestions: 6,
        marksObtained: -6,
        totalMarks: 24,
        answers: questions.map((q, i) => ({
          questionIndex: i,
          questionId: q._id,
          selectedAnswer: 0,
          isCorrect: false,
          metadataSnapshot: { questionType: q.questionType },
        })),
      });

      const res = await getJson(second._id, admin.token);
      expect(res.status).toBe(200);
      expect(res.body.attempt._id).toBe(String(second._id));
      expect(res.body.attempt.marksObtained).toBe(-6);
      // Every answered question wrong in the retake — none of the first
      // attempt's verdicts leak into the second report.
      expect(res.body.questions.every((q) => q.result === 'incorrect')).toBe(true);
    });

    it('handles questions deleted from the bank after the attempt', async () => {
      const { attempt, questions } = await createFullAttempt({ subject, studentId: student.user._id });
      await QuestionBank.deleteOne({ _id: questions[5]._id });

      const res = await getJson(attempt._id, admin.token);
      expect(res.status).toBe(200);

      const q6 = res.body.questions.find((q) => q.questionNumber === 6);
      expect(q6.questionUnavailable).toBe(true);
      expect(q6.question).toBeNull();
      expect(res.body.missingQuestionCount).toBe(1);

      // Summary still counts all six slots and Q6's skipped verdict survives.
      expect(res.body.attempt.totalQuestions).toBe(6);
      expect(res.body.questions).toHaveLength(6);
      expect(q6.result).toBe('skipped');

      // Pairing stays identity-based: earlier questions keep their own
      // responses despite the populate shift.
      const q1 = res.body.questions.find((q) => q.questionNumber === 1);
      expect(q1.studentResponseText).toBe('Mitochondria');
    });
  });

  describe('CSV export', () => {
    it('matches the JSON report and survives multiline/unicode/formula text', async () => {
      const injection = await createQuestion(subject, {
        question: '=SUM(A1:A9) formula-looking question\nwith a second line',
      });
      const unicodeQ = await createQuestion(subject, {
        question: 'Unicode ₹ ∑ question — H₂O',
      });
      const quiz = await Quiz.create({
        title: 'CSV Escape Test',
        subject: subject._id,
        testType: 'weekly',
        duration: 10,
        questions: [injection._id, unicodeQ._id],
        positiveMarks: 4,
        negativeMarks: 1,
        createdBy: new mongoose.Types.ObjectId(),
      });
      const attempt = await QuizAttempt.create({
        quiz: quiz._id,
        student: student.user._id,
        status: 'completed',
        startTime: new Date(),
        endTime: new Date(),
        score: 1,
        totalQuestions: 2,
        marksObtained: 4,
        totalMarks: 8,
        answers: [
          { questionIndex: 0, questionId: injection._id, selectedAnswer: 1, isCorrect: true, metadataSnapshot: { questionType: 'mcq_single' } },
          { questionIndex: 1, questionId: unicodeQ._id, selectedAnswer: -1, isCorrect: false, metadataSnapshot: { questionType: 'mcq_single' } },
        ],
      });

      const jsonRes = await getJson(attempt._id, admin.token);
      const res = await getCsv(attempt._id, admin.token);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('.csv');
      expect(res.headers['content-disposition']).toContain('_QuestionReport_');

      const rows = csvRows(res);

      // Summary carries the same numbers as the JSON surface.
      const summaryHeaderIndex = rows.findIndex((row) => row[0] === 'Score (Questions Correct)');
      expect(summaryHeaderIndex).toBeGreaterThanOrEqual(0);
      const summaryValues = rows[summaryHeaderIndex + 1];
      expect(summaryValues[0]).toBe(jsonRes.body.attempt.score);
      expect(summaryValues[1]).toBe(jsonRes.body.attempt.marksObtained);
      expect(summaryValues[5]).toBe(jsonRes.body.attempt.correct);
      expect(summaryValues[7]).toBe(jsonRes.body.attempt.skipped);

      findRowByText(rows, 'Student One');
      findRowByText(rows, 'CSV Escape Test');

      const headerIndex = rows.findIndex((row) => row[0] === 'Question No');
      expect(headerIndex).toBeGreaterThanOrEqual(0);
      // Merged KPI cells pad SheetJS rows to sheet width — compare the
      // actual header cells only.
      expect(rows[headerIndex].slice(0, 11)).toEqual([
        'Question No', 'Section', 'Subject', 'Topic', 'Type', 'Question',
        'Student Response', 'Result', 'Correct Answer', 'Marks', 'Time Spent (s)',
      ]);

      // One row per question, same verdicts as the JSON payload.
      const dataRows = rows.slice(headerIndex + 1).filter((row) => Number.isInteger(row[0]));
      expect(dataRows).toHaveLength(2);
      expect(dataRows[0][7]).toBe('Correct');
      expect(dataRows[0][9]).toBe(4);
      expect(dataRows[1][7]).toBe('Skipped');
      expect(dataRows[1][9]).toBe(0);

      // Formula injection: the raw CSV text neutralizes the leading "=" with
      // an apostrophe (the established csvEscape convention).
      expect(res.text).toContain("'=SUM(A1:A9) formula-looking question with a second line");
      // Multiline text collapsed without breaking rows, unicode intact.
      expect(String(dataRows[0][5])).toContain('second line');
      expect(String(dataRows[1][5])).toBe('Unicode ₹ ∑ question — H₂O');
    });
  });

  describe('Excel export', () => {
    it('builds a styled single-sheet workbook consistent with the JSON report', async () => {
      const { attempt } = await createFullAttempt({ subject, studentId: student.user._id });
      const jsonRes = await getJson(attempt._id, admin.token);
      const res = await getExcel(attempt._id, admin.token);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('.xlsx');

      const wb = XLSX.read(res.body, { type: 'buffer' });
      expect(wb.SheetNames).toEqual(['Question Report']);

      const rows = excelRows(res);
      const headerIndex = rows.findIndex((row) => row[0] === 'Q No');
      expect(headerIndex).toBeGreaterThanOrEqual(0);
      expect(rows[headerIndex].slice(0, 11)).toEqual([
        'Q No', 'Section', 'Subject', 'Topic', 'Type', 'Question',
        'Student Response', 'Result', 'Correct Answer', 'Marks', 'Time (s)',
      ]);

      const dataRows = rows.slice(headerIndex + 1).filter((row) => Number.isInteger(row[0]));
      expect(dataRows).toHaveLength(6);

      // Row-per-row parity with the JSON collector output.
      jsonRes.body.questions.forEach((q, i) => {
        expect(dataRows[i][0]).toBe(q.questionNumber);
        expect(dataRows[i][7]).toBe(q.resultLabel);
        expect(dataRows[i][9]).toBe(q.marks);
      });

      findRowByText(rows, 'Student One');
      findRowByText(rows, 'Question Report Test');
      // Title block: "Student One — Question Report Test".
      expect(String(rows[0][0])).toContain('Student One');
    });

    it('keeps the mentor export scoped and working', async () => {
      const { attempt } = await createFullAttempt({ subject, studentId: student.user._id });
      const res = await getExcel(attempt._id, mentor.token);
      expect(res.status).toBe(200);

      const rows = excelRows(res);
      findRowByText(rows, 'Student One');
    });

    it('preserves tricky student responses as exact text cells', async () => {
      // Option texts and stored answers in every representation Excel loves
      // to reinterpret; answers stored the way the client stores them
      // (numbers when parseable, raw strings otherwise).
      const defs = [
        { options: ['00123', '12/10/2026', '25%', '0.2500'], selectedAnswer: 0 },
        { options: ['1E10', '-05', '206', 'normal'], selectedAnswer: 1 },
        { options: ['=1+1', '@x', 'y', 'z'], selectedAnswer: 0 },
        { numerical: true, selectedAnswer: '0.2500' },
        { numerical: true, selectedAnswer: '12/10/2026' },
      ];

      const questions = [];
      for (let i = 0; i < defs.length; i += 1) {
        const def = defs[i];
        questions.push(await createQuestion(subject, {
          question: `Tricky report Q${i + 1}? [set ${++fixtureSeq}]`,
          ...(def.numerical
            ? { questionType: 'numerical', options: undefined, correctAnswer: 1 }
            : { options: def.options, correctAnswer: 0 }),
        }));
      }

      const quiz = await Quiz.create({
        title: 'Tricky Report Test',
        subject: subject._id,
        testType: 'daily',
        duration: 30,
        questions: questions.map((q) => q._id),
        positiveMarks: 4,
        negativeMarks: 1,
        assignedStudents: [student.user._id],
        createdBy: new mongoose.Types.ObjectId(),
      });

      const attempt = await QuizAttempt.create({
        quiz: quiz._id,
        student: student.user._id,
        status: 'completed',
        startTime: new Date(Date.now() - 30 * 60 * 1000),
        endTime: new Date(),
        score: 0,
        totalQuestions: defs.length,
        marksObtained: 0,
        totalMarks: defs.length * 4,
        answers: defs.map((def, i) => ({
          questionIndex: i,
          questionId: questions[i]._id,
          selectedAnswer: def.selectedAnswer,
          isCorrect: false,
          timeSpent: 10,
        })),
      });

      const res = await getExcel(attempt._id, admin.token);
      expect(res.status).toBe(200);

      const wb = XLSX.read(res.body, { type: 'buffer' });
      const sheet = wb.Sheets['Question Report'];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      const headerRowIndex = rows.findIndex((row) => row.includes('Student Response'));
      expect(headerRowIndex).toBeGreaterThanOrEqual(0);
      const headers = rows[headerRowIndex];
      const responseCol = XLSX.utils.encode_col(headers.indexOf('Student Response'));
      const marksCol = XLSX.utils.encode_col(headers.indexOf('Marks'));

      // MCQ rows render as label + em-dash + text (the sheet's established
      // convention); numerical rows are the raw value alone.
      const expected = ['A — 00123', 'B — -05', 'A — =1+1', '0.2500', '12/10/2026'];
      expected.forEach((text, i) => {
        const rowNumber = headerRowIndex + 2 + i;
        const cell = sheet[`${responseCol}${rowNumber}`];
        expect(cell).toBeDefined();
        expect(cell.t).toBe('s'); // shared string — Excel cannot reinterpret
        expect(cell.v).toBe(text);

        const marksCell = sheet[`${marksCol}${rowNumber}`];
        expect(marksCell.t).toBe('n');
        expect(marksCell.v).toBe(-1);
      });

      // No formula cells anywhere on the sheet (SheetJS marks formulas via .f).
      Object.keys(sheet).forEach((address) => {
        if (address[0] === '!') return;
        expect(sheet[address].f).toBeUndefined();
      });
    });
  });
});
