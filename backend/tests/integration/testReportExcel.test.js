const request = require('supertest');
const XLSX = require('xlsx');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuizAttempt = require('../../models/QuizAttempt');
const QuestionBank = require('../../models/QuestionBank');
const GuestAttempt = require('../../models/GuestAttempt');
const Guest = require('../../models/Guest');
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
      question: 'Excel export question?',
      options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
      correctAnswer: 1,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body;
}

async function createQuizWithAttempt({ admin, subject, assignedStudent, marksObtained }) {
  const q1 = await createQuestion(admin, subject, { question: 'Excel Q1 mitochondria question?' });
  const q2 = await createQuestion(admin, subject, { question: 'Excel Q2 ribosome question?' });
  const quiz = await Quiz.create({
    title: 'Excel Analytics Test',
    subject: subject._id,
    testType: 'daily',
    duration: 30,
    questions: [q1._id, q2._id],
    positiveMarks: 4,
    negativeMarks: 1,
    assignedStudents: [assignedStudent.user._id],
    createdBy: admin.user._id,
  });

  await QuizAttempt.create({
    quiz: quiz._id,
    student: assignedStudent.user._id,
    status: 'completed',
    startTime: new Date(Date.now() - 60 * 60 * 1000),
    endTime: new Date(),
    score: 1,
    totalQuestions: 2,
    marksObtained,
    totalMarks: 8,
    answers: [
      {
        questionIndex: 0,
        questionId: q1._id,
        selectedAnswer: 1,
        isCorrect: true,
        metadataSnapshot: { questionType: 'mcq_single', subjectName: subject.name },
      },
      {
        questionIndex: 1,
        questionId: q2._id,
        selectedAnswer: 0,
        isCorrect: false,
        metadataSnapshot: { questionType: 'mcq_single', subjectName: subject.name },
      },
    ],
  });

  return { quiz, questions: [q1, q2] };
}

// Verified lead + completed guest attempt, mirroring the post-OTP-verify state.
async function addGuestLeadAttempt(quiz, questions) {
  const lead = await Guest.create({
    name: 'Rahul Sharma',
    email: 'rahul.sharma@example.com',
    emailVerifiedAt: new Date(),
    phone: '+919876543210',
    marketingConsent: { granted: true, updatedAt: new Date() },
    quizzesTaken: [quiz._id],
  });

  await GuestAttempt.create({
    quiz: quiz._id,
    guest: lead._id,
    guestId: `device-${Date.now()}`,
    guestName: 'Rahul Sharma',
    guestEmail: 'rahul.sharma@example.com',
    guestPhone: '+919876543210',
    status: 'completed',
    startTime: new Date(Date.now() - 30 * 60 * 1000),
    endTime: new Date(),
    score: 2,
    totalQuestions: questions.length,
    marksObtained: 8,
    totalMarks: 8,
    answers: questions.map((q, i) => ({
      questionIndex: i,
      questionId: q._id,
      selectedAnswer: 1,
      isCorrect: true,
    })),
  });
}

const getExport = (quizId, token) =>
  request(app)
    .get(`/api/quizzes/analytics/test-report/${quizId}/excel`)
    .set('Authorization', `Bearer ${token}`)
    .buffer(true)
    .parse(binaryParser);

function readWorkbook(res) {
  return XLSX.read(res.body, { type: 'buffer' });
}

// All rows as arrays; the real header sits below the title/meta block.
function rowsOf(wb, sheetName) {
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
}

// Value sitting directly under a KPI band label (labels are uppercased).
function kpiValue(rows, label) {
  const wanted = label.toUpperCase();
  const labelRow = rows.findIndex((cells) =>
    cells.some((c) => String(c).toUpperCase() === wanted)
  );
  expect(labelRow).toBeGreaterThanOrEqual(0);
  const col = rows[labelRow].findIndex((c) => String(c).toUpperCase() === wanted);
  return rows[labelRow + 1][col];
}

function headerRowIndex(rows) {
  const index = rows.findIndex((row) => row[0] === 'Rank');
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

function findRowByText(rows, text) {
  const row = rows.find((cells) => cells.some((c) => String(c) === text));
  expect(row).toBeDefined();
  return row;
}

describe('Test report Excel export', () => {
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

  it('exports a two-sheet workbook with registered students, guests and questions', async () => {
    const { quiz, questions } = await createQuizWithAttempt({
      admin,
      subject,
      assignedStudent: student,
      marksObtained: 4,
    });
    await addGuestLeadAttempt(quiz, questions);

    const res = await getExport(quiz._id, admin.token);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.xlsx');

    const wb = readWorkbook(res);
    expect(wb.SheetNames).toEqual([
      'Student Performance',
      'Question-wise Analytics',
      'User Responses',
    ]);

    const studentRows = rowsOf(wb, 'Student Performance');
    const headerIndex = headerRowIndex(studentRows);
    expect(studentRows[headerIndex]).toContain('Score (%)');

    // Guests are first-class attempts in the aggregates: the KPI band counts
    // 1 registered + 1 guest, with the same numbers the analytics UI shows.
    expect(kpiValue(studentRows, 'Total Attempted')).toBe(2);
    expect(kpiValue(studentRows, 'Avg Correct')).toBe(1.5); // (1 + 2) / 2
    expect(kpiValue(studentRows, 'Avg Wrong')).toBe(0.5); // (1 + 0) / 2
    // Completion stays scoped to the assigned cohort: 1 assigned, 1 done.
    expect(kpiValue(studentRows, 'Completion')).toBe(100);

    const studentRow = findRowByText(studentRows, 'Student One');
    expect(studentRow[0]).toBe(1); // rank
    // Registered rows carry Answered (11th column for admins): 1 correct + 1
    // wrong = 2 answered questions.
    expect(studentRow[11]).toBe(2);

    const guestRow = findRowByText(studentRows, 'Rahul Sharma');
    expect(guestRow[0]).toBe(''); // unranked
    expect(guestRow).toContain('+919876543210'); // admin-only lead phone

    const questionRows = rowsOf(wb, 'Question-wise Analytics');
    const questionHeader = questionRows.findIndex((row) => row[0] === 'Q No');
    expect(questionHeader).toBeGreaterThanOrEqual(0);
    findRowByText(questionRows, 'Excel Q1 mitochondria question?');

    // Question percentages count BOTH attempts: q1 2/2 correct, q2 1/2.
    const questionHeaderText = questionRows[questionHeader];
    const correctCol = questionHeaderText.indexOf('Correct');
    const correctPctCol = questionHeaderText.indexOf('Correct (%)');
    const q1Row = findRowByText(questionRows, 'Excel Q1 mitochondria question?');
    const q2Row = findRowByText(questionRows, 'Excel Q2 ribosome question?');
    expect(q1Row[correctCol]).toBe(2);
    expect(q1Row[correctPctCol]).toBe(100);
    expect(q2Row[correctCol]).toBe(1);
    expect(q2Row[correctPctCol]).toBe(50);
  });

  it('scopes the mentor export to assigned students without lead data', async () => {
    const { quiz, questions } = await createQuizWithAttempt({
      admin,
      subject,
      assignedStudent: student,
      marksObtained: 4,
    });
    await addGuestLeadAttempt(quiz, questions);

    const res = await getExport(quiz._id, mentor.token);

    expect(res.status).toBe(200);
    const wb = readWorkbook(res);
    const studentRows = rowsOf(wb, 'Student Performance');
    const headerIndex = headerRowIndex(studentRows);

    expect(studentRows[headerIndex]).not.toContain('Participant Type');
    expect(studentRows[headerIndex]).not.toContain('Phone');
    findRowByText(studentRows, 'Student One');

    // Mentor aggregates stay registered-only: the guest never enters them.
    expect(kpiValue(studentRows, 'Total Attempted')).toBe(1);
    expect(kpiValue(studentRows, 'Avg Correct')).toBe(1);
    expect(kpiValue(studentRows, 'Avg Wrong')).toBe(1);

    expect(
      studentRows.some((cells) => cells.some((c) => String(c) === 'Rahul Sharma'))
    ).toBe(false);
    expect(
      studentRows.some((cells) => cells.some((c) => String(c).includes('+919876543210')))
    ).toBe(false);

    // Question sheet percentages also stay registered-only for mentors.
    const questionRows = rowsOf(wb, 'Question-wise Analytics');
    const questionHeaderText = questionRows.find((row) => row[0] === 'Q No');
    const correctCol = questionHeaderText.indexOf('Correct');
    const q1Row = findRowByText(questionRows, 'Excel Q1 mitochondria question?');
    expect(q1Row[correctCol]).toBe(1); // only Student One
  });

  it('exports a valid workbook for a test with zero attempts', async () => {
    const quiz = await Quiz.create({
      title: 'Empty Test',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
    });

    const res = await getExport(quiz._id, admin.token);

    expect(res.status).toBe(200);
    const wb = readWorkbook(res);
    expect(wb.SheetNames).toEqual([
      'Student Performance',
      'Question-wise Analytics',
      'User Responses',
    ]);
    const studentRows = rowsOf(wb, 'Student Performance');
    headerRowIndex(studentRows); // header present
    expect(
      studentRows.some((cells) => cells.some((c) => String(c).includes('No student has attempted')))
    ).toBe(true);
  });

  it('computes Avg Time from raw durations, not pre-rounded per-attempt times', async () => {
    // Faithful-extraction contract: the historical CSV summed RAW durations
    // and rounded only the final average. Rounding per attempt first shifts
    // the result (1s + 3s: raw avg 0.0333 -> 0.03; pre-rounded 0.02 + 0.05
    // -> 0.035 -> 0.04).
    const q1 = await createQuestion(admin, subject, { question: 'Duration Q1?' });
    const q2 = await createQuestion(admin, subject, { question: 'Duration Q2?' });
    const quiz = await Quiz.create({
      title: 'Avg Time Test',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [q1._id, q2._id],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
    });

    const base = new Date('2026-09-10T09:00:00Z');
    await QuizAttempt.create({
      quiz: quiz._id, student: student.user._id, status: 'completed',
      startTime: base, endTime: new Date(base.getTime() + 1000),
      score: 1, totalQuestions: 2, marksObtained: 4, totalMarks: 8,
      answers: [{ questionIndex: 0, questionId: q1._id, selectedAnswer: 1, isCorrect: true, metadataSnapshot: { questionType: 'mcq_single' } }],
    });
    const otherStudent = await createUser({ role: 'student', name: 'Student Two' });
    await QuizAttempt.create({
      quiz: quiz._id, student: otherStudent.user._id, status: 'completed',
      startTime: base, endTime: new Date(base.getTime() + 3000),
      score: 1, totalQuestions: 2, marksObtained: 4, totalMarks: 8,
      answers: [{ questionIndex: 0, questionId: q1._id, selectedAnswer: 1, isCorrect: true, metadataSnapshot: { questionType: 'mcq_single' } }],
    });

    const res = await getExport(quiz._id, admin.token);
    expect(res.status).toBe(200);

    const wb = readWorkbook(res);
    const rows = rowsOf(wb, 'Student Performance');
    const kpiLabelRow = rows.findIndex((cells) =>
      cells.some((c) => String(c).toUpperCase() === 'AVG TIME (MIN)')
    );
    expect(kpiLabelRow).toBeGreaterThanOrEqual(0);
    const kpiCol = rows[kpiLabelRow].findIndex((c) => String(c).toUpperCase() === 'AVG TIME (MIN)');
    expect(rows[kpiLabelRow + 1][kpiCol]).toBe(0.03);
  });

  it('returns 404 for an unknown test', async () => {
    const res = await getExport('507f1f77bcf86cd799439011', admin.token);
    expect(res.status).toBe(404);
  });

  it('rejects non-admin/mentor roles', async () => {
    const { quiz } = await createQuizWithAttempt({
      admin,
      subject,
      assignedStudent: student,
      marksObtained: 4,
    });

    const res = await getExport(quiz._id, student.token);
    expect(res.status).toBe(403);
  });

  // =========================================================================
  // User Responses sheet
  // =========================================================================

  const responseRowsOf = (wb) => {
    const rows = rowsOf(wb, 'User Responses');
    const headerIndex = rows.findIndex((row) => row[0] === 'Student Name');
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    return { rows, header: rows[headerIndex], headerIndex };
  };

  const colOf = (header, name) => {
    const col = header.indexOf(name);
    expect(col).toBeGreaterThanOrEqual(0);
    return col;
  };

  const responseRow = (wb, name, questionNumber) => {
    const { rows, header } = responseRowsOf(wb);
    const nameCol = colOf(header, 'Student Name');
    const qNoCol = colOf(header, 'Q No');
    const rowIndex = rows.findIndex(
      (cells) => cells[nameCol] === name && cells[qNoCol] === questionNumber
    );
    expect(rowIndex).toBeGreaterThanOrEqual(0);
    return { row: rows[rowIndex], header, rowIndex };
  };

  it('exports every response with identity, selection, key and verdict', async () => {
    const { quiz, questions } = await createQuizWithAttempt({
      admin,
      subject,
      assignedStudent: student,
      marksObtained: 4,
    });
    await addGuestLeadAttempt(quiz, questions);

    const res = await getExport(quiz._id, admin.token);
    expect(res.status).toBe(200);
    const wb = readWorkbook(res);

    const { rows, header } = responseRowsOf(wb);
    // One row per response: 2 questions × (1 registered + 1 guest attempt).
    // Q No is numeric only on data rows (the header carries the label).
    const dataRows = rows.filter((cells) => Number.isFinite(cells[colOf(header, 'Q No')]));
    expect(dataRows).toHaveLength(4);

    // Registered student: q1 correct (option label AND text on both sides),
    // q2 incorrect.
    const correct = responseRow(wb, 'Student One', 1);
    expect(correct.row[colOf(header, 'Email')]).toBe(student.user.email);
    expect(correct.row[colOf(header, 'Selected Option')]).toBe('B');
    expect(correct.row[colOf(header, 'Selected Answer')]).toBe('Mitochondria');
    expect(correct.row[colOf(header, 'Correct Option')]).toBe('B');
    expect(correct.row[colOf(header, 'Correct Answer')]).toBe('Mitochondria');
    expect(correct.row[colOf(header, 'Status')]).toBe('Correct');
    expect(correct.row[colOf(header, 'Marks')]).toBe(4);
    // Attempt-level totals on every row, agreeing with the attempt doc.
    expect(correct.row[colOf(header, 'Marks Obtained')]).toBe(4);
    expect(correct.row[colOf(header, 'Total Marks')]).toBe(8);
    expect(correct.row[colOf(header, 'Correct')]).toBe(1);
    expect(correct.row[colOf(header, 'Wrong')]).toBe(1);

    const wrong = responseRow(wb, 'Student One', 2);
    expect(wrong.row[colOf(header, 'Selected Answer')]).toBe('Nucleus');
    expect(wrong.row[colOf(header, 'Status')]).toBe('Incorrect');
    expect(wrong.row[colOf(header, 'Marks')]).toBe(-1);

    // Guest rows carry the lead phone as TEXT and land after the registered
    // block.
    const guest = responseRow(wb, 'Rahul Sharma', 1);
    expect(guest.row[colOf(header, 'Phone')]).toBe('+919876543210');
    expect(typeof guest.row[colOf(header, 'Phone')]).toBe('string');
    expect(guest.row[colOf(header, 'Participant Type')]).toBe('Guest');
    expect(guest.row[colOf(header, 'Rank')]).toBe('');

    // Cell-level check that Excel stored the phone as a string cell, not a
    // number (E.164 values must never lose their + or become floats).
    const sheet = wb.Sheets['User Responses'];
    const phoneAddress = XLSX.utils.encode_cell(
      { r: guest.rowIndex, c: colOf(header, 'Phone') }
    );
    const phoneCell = sheet[phoneAddress];
    expect(phoneCell).toBeDefined();
    expect(phoneCell.t).toBe('s');

    // Attempt IDs tie each row back to the Student Performance sheet.
    const studentRows = rowsOf(wb, 'Student Performance');
    const studentHeaderIndex = headerRowIndex(studentRows);
    const attemptIdCol = studentRows[studentHeaderIndex].indexOf('Attempt ID');
    const registeredAttemptId = findRowByText(studentRows, 'Student One')[attemptIdCol];
    expect(correct.row[colOf(header, 'Attempt ID')]).toBe(registeredAttemptId);
  });

  it('represents skipped questions explicitly, including never-opened ones', async () => {
    const q1 = await createQuestion(admin, subject, { question: 'Skip Q1?' });
    const q2 = await createQuestion(admin, subject, { question: 'Skip Q2?' });
    const quiz = await Quiz.create({
      title: 'Skip Test',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [q1._id, q2._id],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
    });

    // q1 visited but unanswered (legacy -1); q2 never opened (no answer doc).
    await QuizAttempt.create({
      quiz: quiz._id,
      student: student.user._id,
      status: 'completed',
      startTime: new Date(Date.now() - 30 * 60 * 1000),
      endTime: new Date(),
      score: 0,
      totalQuestions: 2,
      marksObtained: 0,
      totalMarks: 8,
      answers: [{ questionIndex: 0, questionId: q1._id, selectedAnswer: -1, isCorrect: false }],
    });

    const res = await getExport(quiz._id, admin.token);
    expect(res.status).toBe(200);
    const wb = readWorkbook(res);

    const skip1 = responseRow(wb, 'Student One', 1);
    expect(skip1.row[colOf(skip1.header, 'Status')]).toBe('Skipped');
    expect(skip1.row[colOf(skip1.header, 'Selected Answer')]).toBe('Not answered');
    expect(skip1.row[colOf(skip1.header, 'Selected Option')]).toBe('');
    expect(skip1.row[colOf(skip1.header, 'Marks')]).toBe(0);

    const skip2 = responseRow(wb, 'Student One', 2);
    expect(skip2.row[colOf(skip2.header, 'Status')]).toBe('Skipped');
    expect(skip2.row[colOf(skip2.header, 'Correct Answer')]).toBe('Mitochondria');
  });

  it('keeps multiple attempts by one student separate with attempt numbers', async () => {
    const { quiz, questions } = await createQuizWithAttempt({
      admin,
      subject,
      assignedStudent: student,
      marksObtained: 4,
    });

    // Retake: same student, different answers, submitted AFTER the first
    // attempt (created moments earlier) so it numbers as Attempt 2.
    await QuizAttempt.create({
      quiz: quiz._id,
      student: student.user._id,
      status: 'completed',
      startTime: new Date(Date.now() - 30 * 60 * 1000),
      endTime: new Date(),
      score: 2,
      totalQuestions: 2,
      marksObtained: 8,
      totalMarks: 8,
      answers: questions.map((q, i) => ({
        questionIndex: i,
        questionId: q._id,
        selectedAnswer: 1,
        isCorrect: true,
      })),
    });

    const res = await getExport(quiz._id, admin.token);
    expect(res.status).toBe(200);
    const wb = readWorkbook(res);
    const { rows, header } = responseRowsOf(wb);

    const qNoCol = colOf(header, 'Q No');
    const nameCol = colOf(header, 'Student Name');
    const attemptNoCol = colOf(header, 'Attempt No');
    const attemptIdCol = colOf(header, 'Attempt ID');
    const statusCol = colOf(header, 'Status');

    const oneRows = rows.filter((cells) => cells[nameCol] === 'Student One' && Number.isFinite(cells[qNoCol]));
    expect(oneRows).toHaveLength(4); // 2 attempts × 2 questions, never merged

    const attemptIds = [...new Set(oneRows.map((cells) => cells[attemptIdCol]))];
    expect(attemptIds).toHaveLength(2);
    const attemptNumbers = [...new Set(oneRows.map((cells) => cells[attemptNoCol]))].sort();
    expect(attemptNumbers).toEqual([1, 2]);

    // The perfect retake reads Correct on both questions; the totals column
    // per row matches the attempt those rows belong to.
    const perfectRows = oneRows.filter((cells) => cells[attemptNoCol] === 2);
    expect(perfectRows.map((cells) => cells[statusCol])).toEqual(['Correct', 'Correct']);
    perfectRows.forEach((cells) => {
      expect(cells[colOf(header, 'Marks Obtained')]).toBe(8);
    });
  });

  it('handles questions deleted from the bank after the attempt', async () => {
    const { quiz, questions } = await createQuizWithAttempt({
      admin,
      subject,
      assignedStudent: student,
      marksObtained: 4,
    });
    await QuestionBank.deleteOne({ _id: questions[1]._id });

    const res = await getExport(quiz._id, admin.token);
    expect(res.status).toBe(200);
    const wb = readWorkbook(res);

    const deleted = responseRow(wb, 'Student One', 2);
    expect(String(deleted.row[colOf(deleted.header, 'Question')])).toContain('no longer available');
    expect(deleted.row[colOf(deleted.header, 'Status')]).toBe('Incorrect');
    expect(deleted.row[colOf(deleted.header, 'Correct Answer')]).toBe('');

    // Honesty note under the table.
    const rows = rowsOf(wb, 'User Responses');
    expect(
      rows.some((cells) => cells.some((c) => String(c).includes('removed from the question bank')))
    ).toBe(true);
  });

  it('keeps the mentor export scoped: no guests, no lead columns', async () => {
    const { quiz, questions } = await createQuizWithAttempt({
      admin,
      subject,
      assignedStudent: student,
      marksObtained: 4,
    });
    await addGuestLeadAttempt(quiz, questions);

    const res = await getExport(quiz._id, mentor.token);
    expect(res.status).toBe(200);
    const wb = readWorkbook(res);
    const { rows, header } = responseRowsOf(wb);

    expect(header).not.toContain('Phone');
    expect(header).not.toContain('Participant Type');
    expect(
      rows.some((cells) => cells.some((c) => String(c) === 'Rahul Sharma'))
    ).toBe(false);
    expect(
      rows.some((cells) => cells.some((c) => String(c) === '+919876543210'))
    ).toBe(false);

    // The assigned student's responses are all present.
    const qNoCol = colOf(header, 'Q No');
    const oneRows = rows.filter((cells) => Number.isFinite(cells[qNoCol]));
    expect(oneRows).toHaveLength(2);
  });

  it('keeps long text and numerical answers intact', async () => {
    const longQuestion = `A ${'very '.repeat(60)}long stem about a clinical vignette that must wrap but never truncate — unicode: em-dash — and "quotes" included?`;
    const q1 = await createQuestion(admin, subject, {
      question: longQuestion,
      options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    });
    // Numerical questions are shaped like the attempt-question-report
    // fixtures: no options array, numeric answer key.
    const q2 = await QuestionBank.create({
      subject: subject._id,
      topicName: 'Anatomy',
      subtopicName: 'Skeletal System',
      system: 'Musculoskeletal',
      questionType: 'numerical',
      difficulty: 'medium',
      question: 'Numerical: how many bones in the adult human body?',
      correctAnswer: 206,
    });
    const quiz = await Quiz.create({
      title: 'Long Text Test',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [q1._id, q2._id],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
    });
    await QuizAttempt.create({
      quiz: quiz._id,
      student: student.user._id,
      status: 'completed',
      startTime: new Date(Date.now() - 30 * 60 * 1000),
      endTime: new Date(),
      score: 1,
      totalQuestions: 2,
      marksObtained: 4,
      totalMarks: 8,
      answers: [
        { questionIndex: 0, questionId: q1._id, selectedAnswer: 2, isCorrect: false },
        { questionIndex: 1, questionId: q2._id, selectedAnswer: 206, isCorrect: true },
      ],
    });

    const res = await getExport(quiz._id, admin.token);
    expect(res.status).toBe(200);
    const wb = readWorkbook(res);

    const long = responseRow(wb, 'Student One', 1);
    expect(long.row[colOf(long.header, 'Question')]).toBe(longQuestion);
    expect(long.row[colOf(long.header, 'Selected Answer')]).toBe('Gamma');

    const numerical = responseRow(wb, 'Student One', 2);
    expect(numerical.row[colOf(numerical.header, 'Selected Option')]).toBe('206');
    expect(numerical.row[colOf(numerical.header, 'Correct Option')]).toBe('206');
    expect(numerical.row[colOf(numerical.header, 'Status')]).toBe('Correct');
  });

  it('shows an explicit empty state on the User Responses sheet for zero attempts', async () => {
    const quiz = await Quiz.create({
      title: 'Empty Responses Test',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: [],
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents: [student.user._id],
      createdBy: admin.user._id,
    });

    const res = await getExport(quiz._id, admin.token);
    expect(res.status).toBe(200);
    const wb = readWorkbook(res);
    const rows = rowsOf(wb, 'User Responses');
    expect(
      rows.some((cells) => cells.some((c) => String(c).includes('No responses available')))
    ).toBe(true);
  });
});
