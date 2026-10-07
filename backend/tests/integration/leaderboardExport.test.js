const request = require('supertest');
const XLSX = require('xlsx');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuizAttempt = require('../../models/QuizAttempt');
const MentorStudentAssignment = require('../../models/MentorStudentAssignment');
const { LEADERBOARD_EXPORT_COLUMNS } = require('../../utils/leaderboardExport');

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
      question: `Leaderboard export question #${++questionSeed}?`,
      options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
      correctAnswer: 1,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body;
}

function answerRow(question, index, isCorrect) {
  return {
    questionIndex: index,
    questionId: question._id,
    selectedAnswer: isCorrect ? 1 : 2,
    isCorrect: Boolean(isCorrect),
    metadataSnapshot: { questionType: 'mcq_single', subjectName: 'Pathology' },
  };
}

const EXPORTS = [
  { format: 'csv', path: (id) => `/api/quizzes/analytics/test/${id}/leaderboard/export/csv` },
  { format: 'excel', path: (id) => `/api/quizzes/analytics/test/${id}/leaderboard/export/excel` },
];

const getExport = (path, token) =>
  request(app)
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .buffer(true)
    .parse(binaryParser);

describe('Live leaderboard export', () => {
  let admin;
  let mentor;
  let studentA;
  let studentB;
  let outsider; // student NOT mentored by `mentor`
  let subject;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    mentor = await createUser({ role: 'mentor' });
    studentA = await createUser({ role: 'student', name: 'Alice Ranker' });
    studentB = await createUser({ role: 'student', name: 'Bob Ranker' });
    outsider = await createUser({ role: 'student', name: 'Carol Unmentored' });
    subject = await createSubject('Pathology');

    await MentorStudentAssignment.create({
      mentor: mentor.user._id,
      student: studentA.user._id,
      isActive: true,
      assignedBy: admin.user._id,
    });
    await MentorStudentAssignment.create({
      mentor: mentor.user._id,
      student: studentB.user._id,
      isActive: true,
      assignedBy: admin.user._id,
    });
  });

  async function createQuizWithQuestions(assignedStudents, title = 'Leaderboard Export Test') {
    const questions = [
      await createQuestion(admin, subject),
      await createQuestion(admin, subject),
      await createQuestion(admin, subject),
      await createQuestion(admin, subject),
    ];
    const quiz = await Quiz.create({
      title,
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: questions.map((q) => q._id),
      positiveMarks: 4,
      negativeMarks: 1,
      assignedStudents,
      createdBy: admin.user._id,
    });
    return { quiz, questions };
  }

  async function createAttempt(quiz, questions, student, { status = 'completed', correct = 0, incorrect = 0, endTime = new Date() }) {
    const answers = [];
    let index = 0;
    for (let i = 0; i < correct; i += 1) answers.push(answerRow(questions[index], index++, true));
    for (let i = 0; i < incorrect; i += 1) answers.push(answerRow(questions[index], index++, false));
    // Skipped questions have no answer row at all (never visited).

    const marksObtained = correct * 4 - incorrect * 1;
    return QuizAttempt.create({
      quiz: quiz._id,
      student: student.user._id,
      status,
      startTime: new Date(endTime.getTime() - 20 * 60 * 1000),
      endTime,
      score: correct,
      totalQuestions: questions.length,
      marksObtained,
      totalMarks: questions.length * 4,
      answers,
    });
  }

  async function seedRankedAttempts(quiz, questions) {
    // Alice: 3 correct + 1 wrong → 11/16 = 68.75%
    await createAttempt(quiz, questions, studentA, { correct: 3, incorrect: 1 });
    // Bob: 2 correct + 2 wrong → 6/16 = 37.5%
    await createAttempt(quiz, questions, studentB, { correct: 2, incorrect: 2 });
    // Carol: all 4 correct → 16/16 = 100%
    await createAttempt(quiz, questions, outsider, { correct: 4 });
  }

  // ---- CSV helpers (fixtures are comma-free, so a naive split is exact) ----

  const csvLines = (res) => res.body.toString('utf-8').split('\n');

  function csvParticipantLines(res) {
    const lines = csvLines(res);
    const headerIndex = lines.findIndex((line) => line.startsWith('Rank,'));
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    return lines.slice(headerIndex + 1).filter((line) => line.trim() !== '');
  }

  function csvField(line, header) {
    const specIndex = LEADERBOARD_EXPORT_COLUMNS.findIndex((c) => c.header === header);
    return line.split(',')[specIndex];
  }

  // ---- Excel helpers ----

  const readWorkbook = (res) => XLSX.read(res.body, { type: 'buffer' });

  function excelRows(res) {
    const wb = readWorkbook(res);
    expect(wb.SheetNames).toEqual(['Leaderboard']);
    return XLSX.utils.sheet_to_json(wb.Sheets.Leaderboard, { header: 1, defval: '' });
  }

  function excelParticipantRows(res) {
    const rows = excelRows(res);
    const headerIndex = rows.findIndex((row) => row[0] === 'Rank');
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    // Rows after the header that carry a numeric rank.
    return rows.slice(headerIndex + 1).filter((row) => typeof row[0] === 'number');
  }

  describe('authentication and authorization', () => {
    EXPORTS.forEach(({ format, path }) => {
      it(`rejects unauthenticated and non-admin/mentor callers (${format})`, async () => {
        const { quiz } = await createQuizWithQuestions([studentA.user._id]);

        const noAuth = await getExport(path(quiz._id), null);
        expect(noAuth.status).toBe(401);

        const asStudent = await getExport(path(quiz._id), studentA.token);
        expect(asStudent.status).toBe(403);
      });

      it(`returns 404 for an unknown test (${format})`, async () => {
        const res = await getExport(
          path('000000000000000000000000'),
          admin.token
        );
        expect(res.status).toBe(404);
      });
    });
  });

  describe('CSV', () => {
    it('exports every leaderboard participant in endpoint order with headers and metadata', async () => {
      const { quiz, questions } = await createQuizWithQuestions([
        studentA.user._id,
        studentB.user._id,
        outsider.user._id,
      ]);
      await seedRankedAttempts(quiz, questions);

      // The board the app is showing right now.
      const board = await request(app)
        .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(board.status).toBe(200);

      const res = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv`,
        admin.token
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('.csv');

      const lines = csvLines(res);
      expect(lines[0]).toBe('Leaderboard');
      expect(lines).toContain('Test Details');
      // Quiz identity travels with the file so an export is never ambiguous.
      const detailsIndex = lines.findIndex((line) => line.startsWith('Test ID,'));
      expect(lines[detailsIndex + 1]).toContain('Leaderboard Export Test');

      // Header row is exactly the shared column spec.
      const headerIndex = lines.findIndex((line) => line.startsWith('Rank,'));
      expect(lines[headerIndex]).toBe(LEADERBOARD_EXPORT_COLUMNS.map((c) => c.header).join(','));

      // Identical participants, identical order, no duplicates.
      const participantLines = csvParticipantLines(res);
      expect(participantLines).toHaveLength(board.body.leaderboard.length);
      expect(participantLines.map((line) => csvField(line, 'Student Name'))).toEqual(
        board.body.leaderboard.map((r) => r.studentName)
      );
      expect(participantLines.map((line) => csvField(line, 'Rank'))).toEqual(['1', '2', '3']);
      const attemptIds = participantLines.map((line) => csvField(line, 'Attempt ID'));
      expect(new Set(attemptIds).size).toBe(attemptIds.length);

      // Ranked values, not just order: Carol 100% / 16 marks on rank 1.
      expect(csvField(participantLines[0], 'Student Name')).toBe('Carol Unmentored');
      expect(csvField(participantLines[0], 'Score (%)')).toBe('100');
      expect(csvField(participantLines[0], 'Marks Obtained')).toBe('16');
      expect(csvField(participantLines[0], 'Accuracy (%)')).toBe('100');
      expect(csvField(participantLines[1], 'Score (%)')).toBe('68.75');
    });

    it('includes auto_submitted attempts and excludes in-progress ones', async () => {
      const { quiz, questions } = await createQuizWithQuestions([
        studentA.user._id,
        studentB.user._id,
      ]);
      await createAttempt(quiz, questions, studentA, { status: 'auto_submitted', correct: 1, incorrect: 1 });
      await createAttempt(quiz, questions, studentB, { status: 'in_progress', correct: 4 });

      const res = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv`,
        admin.token
      );
      expect(res.status).toBe(200);

      const participantLines = csvParticipantLines(res);
      expect(participantLines).toHaveLength(1);
      expect(csvField(participantLines[0], 'Student Name')).toBe('Alice Ranker');
    });

    it('scopes the mentor export to their own students only', async () => {
      const { quiz, questions } = await createQuizWithQuestions([
        studentA.user._id,
        studentB.user._id,
        outsider.user._id,
      ]);
      await seedRankedAttempts(quiz, questions);

      const res = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv`,
        mentor.token
      );
      expect(res.status).toBe(200);

      const names = csvParticipantLines(res).map((line) => csvField(line, 'Student Name'));
      expect(names).toHaveLength(2);
      expect(names).toContain('Alice Ranker');
      expect(names).toContain('Bob Ranker');
      expect(names).not.toContain('Carol Unmentored');
      // Ranks are dense within the exported cohort.
      expect(csvParticipantLines(res).map((line) => csvField(line, 'Rank')).sort()).toEqual(['1', '2']);
    });

    it('exports an empty leaderboard as a valid file with zero participants', async () => {
      const { quiz } = await createQuizWithQuestions([studentA.user._id]);

      const res = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv`,
        admin.token
      );
      expect(res.status).toBe(200);
      expect(csvParticipantLines(res)).toEqual([]);

      const lines = csvLines(res);
      const detailsIndex = lines.findIndex((line) => line.startsWith('Test ID,'));
      expect(lines[detailsIndex + 1].endsWith(',0')).toBe(true); // Participants: 0
    });

    it('escapes formula-like student names (shared csvEscape)', async () => {
      const hostile = await createUser({ role: 'student', name: '=HYPERLINK("http://evil","click")' });
      const { quiz, questions } = await createQuizWithQuestions([hostile.user._id]);
      await createAttempt(quiz, questions, hostile, { correct: 1, incorrect: 1 });

      const res = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv`,
        admin.token
      );
      expect(res.status).toBe(200);

      const participantLines = csvParticipantLines(res);
      expect(participantLines).toHaveLength(1);
      // Leading ' neutralizes the formula; embedded quotes are doubled and
      // the (now comma-containing) field is quoted as a whole.
      expect(participantLines[0]).toContain(
        `"'=HYPERLINK(""http://evil"",""click"")"`
      );
    });

    it('accepts the token as a query parameter (external browser download path)', async () => {
      const { quiz, questions } = await createQuizWithQuestions([studentA.user._id]);
      await createAttempt(quiz, questions, studentA, { correct: 2, incorrect: 1 });

      const res = await request(app)
        .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv?token=${admin.token}`)
        .buffer(true)
        .parse(binaryParser);
      expect(res.status).toBe(200);
      expect(csvParticipantLines(res)).toHaveLength(1);
    });
  });

  describe('Excel', () => {
    it('exports the same participants, order and values as the live leaderboard', async () => {
      const { quiz, questions } = await createQuizWithQuestions([
        studentA.user._id,
        studentB.user._id,
        outsider.user._id,
      ]);
      await seedRankedAttempts(quiz, questions);

      const board = await request(app)
        .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(board.status).toBe(200);

      const res = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/excel`,
        admin.token
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('.xlsx');

      const rows = excelRows(res);
      // Report title + quiz name + export timestamp block.
      expect(rows[0][0]).toBe('Leaderboard — Leaderboard Export Test');
      expect(String(rows[1][0])).toContain('Pathology');
      expect(String(rows[2][0])).toContain('Exported');

      const headerIndex = rows.findIndex((row) => row[0] === 'Rank');
      expect(rows[headerIndex].slice(0, LEADERBOARD_EXPORT_COLUMNS.length)).toEqual(
        LEADERBOARD_EXPORT_COLUMNS.map((c) => c.header)
      );

      const participantRows = excelParticipantRows(res);
      expect(participantRows).toHaveLength(board.body.leaderboard.length);
      const nameCol = rows[headerIndex].indexOf('Student Name');
      expect(participantRows.map((row) => row[nameCol])).toEqual(
        board.body.leaderboard.map((r) => r.studentName)
      );
      expect(participantRows.map((row) => row[0])).toEqual([1, 2, 3]);

      const scoreCol = rows[headerIndex].indexOf('Score (%)');
      const marksCol = rows[headerIndex].indexOf('Marks Obtained');
      expect(participantRows[0][scoreCol]).toBe(100);
      expect(participantRows[0][marksCol]).toBe(16);
    });

    it('scopes the mentor export to their own students only', async () => {
      const { quiz, questions } = await createQuizWithQuestions([
        studentA.user._id,
        studentB.user._id,
        outsider.user._id,
      ]);
      await seedRankedAttempts(quiz, questions);

      const res = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/excel`,
        mentor.token
      );
      expect(res.status).toBe(200);

      const rows = excelRows(res);
      const headerIndex = rows.findIndex((row) => row[0] === 'Rank');
      const nameIdx = rows[headerIndex].indexOf('Student Name');
      const names = excelParticipantRows(res).map((row) => row[nameIdx]);
      expect(names).toHaveLength(2);
      expect(names).not.toContain('Carol Unmentored');
    });

    it('exports an empty leaderboard with an explicit empty-state note', async () => {
      const { quiz } = await createQuizWithQuestions([studentA.user._id]);

      const res = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/excel`,
        admin.token
      );
      expect(res.status).toBe(200);

      const rows = excelRows(res);
      expect(rows[0][0]).toBe('Leaderboard — Leaderboard Export Test');
      expect(
        rows.some((cells) => cells.some((c) => String(c).includes('No submissions yet')))
      ).toBe(true);
      expect(excelParticipantRows(res)).toEqual([]);
    });
  });

  describe('large leaderboards', () => {
    it('exports 60 participants with a complete, dense rank sequence', async () => {
      const { quiz, questions } = await createQuizWithQuestions([], 'Bulk Leaderboard Test');

      const COUNT = 60;
      for (let i = 0; i < COUNT; i += 1) {
        // Varied correct counts force a genuine ranking pass, not DB order;
        // the first student is the sole perfect score.
        const correct = i === 0 ? 4 : i % 4;
        const incorrect = 4 - correct;
        const student = await createUser({ role: 'student', name: `Bulk Student ${String(i + 1).padStart(3, '0')}` });
        await createAttempt(quiz, questions, student, { correct, incorrect });
      }

      const board = await request(app)
        .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(board.status).toBe(200);
      expect(board.body.leaderboard).toHaveLength(COUNT);

      const csvRes = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv`,
        admin.token
      );
      expect(csvRes.status).toBe(200);
      const participantLines = csvParticipantLines(csvRes);
      expect(participantLines).toHaveLength(COUNT);
      expect(participantLines.map((line) => csvField(line, 'Rank'))).toEqual(
        Array.from({ length: COUNT }, (_, i) => String(i + 1))
      );
      const attemptIds = participantLines.map((line) => csvField(line, 'Attempt ID'));
      expect(new Set(attemptIds).size).toBe(COUNT);

      const excelRes = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/excel`,
        admin.token
      );
      expect(excelRes.status).toBe(200);
      expect(excelParticipantRows(excelRes)).toHaveLength(COUNT);

      // Top of the board is the 4-correct attempt (16/16, 100%).
      expect(csvField(participantLines[0], 'Score (%)')).toBe('100');
      expect(csvField(participantLines[0], 'Marks Obtained')).toBe('16');
    });
  });
});
