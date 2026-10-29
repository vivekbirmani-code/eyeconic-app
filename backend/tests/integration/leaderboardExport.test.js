const request = require('supertest');
const XLSX = require('xlsx');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuizAttempt = require('../../models/QuizAttempt');
const MentorStudentAssignment = require('../../models/MentorStudentAssignment');
const Guest = require('../../models/Guest');
const GuestAttempt = require('../../models/GuestAttempt');
const {
  LEADERBOARD_EXPORT_COLUMNS,
  COMBINED_LEADERBOARD_EXPORT_COLUMNS,
  GUEST_LEADERBOARD_EXPORT_COLUMNS,
  GUEST_LEADERBOARD_SHEET_NAME,
} = require('../../utils/leaderboardExport');

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
    // Bare-route exports render the COMBINED spec (the default cohort).
    const specIndex = COMBINED_LEADERBOARD_EXPORT_COLUMNS.findIndex((c) => c.header === header);
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

      // Header row is exactly the shared column spec (combined — the default).
      const headerIndex = lines.findIndex((line) => line.startsWith('Rank,'));
      expect(lines[headerIndex]).toBe(COMBINED_LEADERBOARD_EXPORT_COLUMNS.map((c) => c.header).join(','));

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
      expect(rows[headerIndex].slice(0, COMBINED_LEADERBOARD_EXPORT_COLUMNS.length)).toEqual(
        COMBINED_LEADERBOARD_EXPORT_COLUMNS.map((c) => c.header)
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

  // Completed guest attempt for a verified lead, seeded directly (same
  // shape the /submit grading path persists — mirrors analytics.test.js).
  // `outcomes` drives C/W/S per question: 'correct' | 'wrong' | 'skip'.
  // { anonymous: true } seeds a legacy device-keyed attempt with no lead;
  // { status: 'in_progress' } seeds an unfinished attempt.
  let leadSeed = 0;

  async function addGuestAttempt(quiz, questions, name, outcomes, marksObtained, { status = 'completed', anonymous = false, endTime = new Date() } = {}) {
    let lead = null;
    let snapshots = {};
    if (!anonymous) {
      leadSeed += 1;
      lead = await Guest.create({
        name,
        email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'guest'}.${leadSeed}@example.com`,
        emailVerifiedAt: new Date(),
        phone: `+9198765${String(100000 + leadSeed).slice(1)}`,
        marketingConsent: { granted: true, updatedAt: new Date() },
        quizzesTaken: [quiz._id],
      });
      snapshots = { guest: lead._id, guestName: name, guestEmail: lead.email, guestPhone: lead.phone };
    }

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
      guestId: `device-${leadSeed}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...snapshots,
      status,
      startTime: new Date(endTime.getTime() - 25 * 60 * 1000),
      endTime,
      score: outcomes.filter((o) => o === 'correct').length,
      totalQuestions: questions.length,
      marksObtained,
      totalMarks: questions.length * 4,
      answers,
    });
  }

  // Registered students + one guest of each excluded flavour, so the happy
  // paths prove the cohort split rather than an empty opposite side.
  async function seedMixedCohort(quiz, questions) {
    await seedRankedAttempts(quiz, questions); // Alice 68.75%, Bob 37.5%, Carol 100%
    await addGuestAttempt(quiz, questions, 'Grace Guest', ['correct', 'correct', 'correct', 'correct'], 16);
    await addGuestAttempt(quiz, questions, 'Eshan External', ['correct', 'correct', 'correct', 'wrong'], 11);
    await addGuestAttempt(quiz, questions, 'Anon Visitor', ['correct', 'correct', 'wrong', 'wrong'], 6, { anonymous: true });
    await addGuestAttempt(quiz, questions, 'Still Working', ['correct'], 4, { status: 'in_progress' });
  }

  describe('combined export (default cohort — audience selector removed)', () => {
    it('exports the merged live board in one ranked CSV (admin)', async () => {
      const { quiz, questions } = await createQuizWithQuestions([
        studentA.user._id,
        studentB.user._id,
        outsider.user._id,
      ]);
      await seedMixedCohort(quiz, questions);

      // The board the app is showing right now (admins: internal + external
      // ranked together).
      const board = await request(app)
        .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(board.status).toBe(200);
      expect(board.body.leaderboard).toHaveLength(5);

      const res = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv`,
        admin.token
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      // One combined file — the default name, no external suffix.
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).not.toContain('_leaderboard_external');
      expect(res.headers['content-disposition']).toContain('.csv');

      const lines = csvLines(res);
      expect(lines[0]).toBe('Leaderboard');
      const headerIndex = lines.findIndex((line) => line.startsWith('Rank,'));
      expect(lines[headerIndex]).toBe(COMBINED_LEADERBOARD_EXPORT_COLUMNS.map((c) => c.header).join(','));

      // Identical participants + order to the live board, no duplicates.
      const participantLines = csvParticipantLines(res);
      expect(participantLines).toHaveLength(board.body.leaderboard.length);
      expect(participantLines.map((line) => csvField(line, 'Student Name'))).toEqual(
        board.body.leaderboard.map((r) => r.studentName)
      );
      expect(participantLines.map((line) => csvField(line, 'Rank'))).toEqual(
        board.body.leaderboard.map((_, i) => String(i + 1))
      );
      const attemptIds = participantLines.map((line) => csvField(line, 'Attempt ID'));
      expect(new Set(attemptIds).size).toBe(attemptIds.length);

      // Type column tells the cohorts apart; guest rows carry lead identity.
      const typeByName = new Map(participantLines.map((line) => [
        csvField(line, 'Student Name'),
        csvField(line, 'Type'),
      ]));
      expect(typeByName.get('Carol Unmentored')).toBe('Internal');
      expect(typeByName.get('Alice Ranker')).toBe('Internal');
      expect(typeByName.get('Grace Guest')).toBe('External');
      expect(typeByName.get('Eshan External')).toBe('External');
      const guestLine = participantLines.find((line) => csvField(line, 'Student Name') === 'Grace Guest');
      expect(csvField(guestLine, 'Student Email')).toContain('grace.guest');
      expect(csvField(guestLine, 'Student ID')).toBe('');

      // Anonymous legacy and in-progress attempts never join the board.
      const joined = lines.join('\n');
      expect(joined).not.toContain('Anon Visitor');
      expect(joined).not.toContain('Still Working');
    });

    it('exports the same combined board as a typed Excel sheet (admin)', async () => {
      const { quiz, questions } = await createQuizWithQuestions([
        studentA.user._id,
        studentB.user._id,
        outsider.user._id,
      ]);
      await seedMixedCohort(quiz, questions);

      const board = await request(app)
        .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(board.status).toBe(200);

      const res = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/excel`,
        admin.token
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).not.toContain('_leaderboard_external');
      expect(res.headers['content-disposition']).toContain('.xlsx');

      const rows = excelRows(res);
      expect(rows[0][0]).toBe('Leaderboard — Leaderboard Export Test');
      expect(String(rows[1][0])).toContain('5 participants');

      const headerIndex = rows.findIndex((row) => row[0] === 'Rank');
      expect(rows[headerIndex].slice(0, COMBINED_LEADERBOARD_EXPORT_COLUMNS.length)).toEqual(
        COMBINED_LEADERBOARD_EXPORT_COLUMNS.map((c) => c.header)
      );

      const participantRows = excelParticipantRows(res);
      expect(participantRows).toHaveLength(board.body.leaderboard.length);
      const nameCol = rows[headerIndex].indexOf('Student Name');
      expect(participantRows.map((row) => row[nameCol])).toEqual(
        board.body.leaderboard.map((r) => r.studentName)
      );
      const typeCol = rows[headerIndex].indexOf('Type');
      const types = participantRows.map((row) => row[typeCol]).sort();
      expect(types).toEqual(['External', 'External', 'Internal', 'Internal', 'Internal']);
      const studentIdCol = rows[headerIndex].indexOf('Student ID');
      const guestIdx = participantRows.findIndex((row) => row[typeCol] === 'External');
      expect(participantRows[guestIdx][studentIdCol]).toBe('');
    });

    it('keeps the mentor export registered-only even with guests present', async () => {
      const { quiz, questions } = await createQuizWithQuestions([
        studentA.user._id,
        studentB.user._id,
        outsider.user._id,
      ]);
      await seedMixedCohort(quiz, questions);

      const res = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv`,
        mentor.token
      );
      expect(res.status).toBe(200);

      const participantLines = csvParticipantLines(res);
      const joined = csvLines(res).join('\n');
      expect(participantLines).toHaveLength(2); // Alice + Bob only
      expect(joined).not.toContain('Grace Guest');
      expect(joined).not.toContain('Eshan External');
      // Every mentor row is internal — mentors never receive guest data.
      participantLines.forEach((line) => {
        expect(csvField(line, 'Type')).toBe('Internal');
      });
    });
  });

  describe('external cohort (public-quiz guests)', () => {
    // ---- Guest CSV/Excel helpers (Position-keyed, not Rank-keyed) ----

    function csvGuestParticipantLines(res) {
      const lines = csvLines(res);
      const headerIndex = lines.findIndex((line) => line.startsWith('Position,'));
      expect(headerIndex).toBeGreaterThanOrEqual(0);
      return lines.slice(headerIndex + 1).filter((line) => line.trim() !== '');
    }

    function csvGuestField(line, header) {
      const specIndex = GUEST_LEADERBOARD_EXPORT_COLUMNS.findIndex((c) => c.header === header);
      return line.split(',')[specIndex];
    }

    function excelGuestRows(res) {
      const wb = readWorkbook(res);
      expect(wb.SheetNames).toEqual([GUEST_LEADERBOARD_SHEET_NAME]);
      return XLSX.utils.sheet_to_json(wb.Sheets[GUEST_LEADERBOARD_SHEET_NAME], { header: 1, defval: '' });
    }

    function excelGuestParticipantRows(res) {
      const rows = excelGuestRows(res);
      const headerIndex = rows.findIndex((row) => row[0] === 'Position');
      expect(headerIndex).toBeGreaterThanOrEqual(0);
      return rows.slice(headerIndex + 1).filter((row) => typeof row[0] === 'number');
    }

    it('exports ranked verified guests only, with lead columns (admin, CSV)', async () => {
      const { quiz, questions } = await createQuizWithQuestions([
        studentA.user._id,
        studentB.user._id,
        outsider.user._id,
      ]);
      await seedMixedCohort(quiz, questions);

      const res = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv?cohort=external`,
        admin.token
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toContain('_leaderboard_external');
      expect(res.headers['content-disposition']).toContain('.csv');

      const lines = csvLines(res);
      expect(lines[0]).toBe('External Leaderboard');
      const headerIndex = lines.findIndex((line) => line.startsWith('Position,'));
      expect(lines[headerIndex]).toBe(GUEST_LEADERBOARD_EXPORT_COLUMNS.map((c) => c.header).join(','));

      // Only the two completed verified-lead guests, ranked by score.
      const participantLines = csvGuestParticipantLines(res);
      expect(participantLines).toHaveLength(2);
      expect(participantLines.map((line) => csvGuestField(line, 'Name'))).toEqual(['Grace Guest', 'Eshan External']);
      expect(participantLines.map((line) => csvGuestField(line, 'Position'))).toEqual(['1', '2']);
      expect(csvGuestField(participantLines[0], 'Score (%)')).toBe('100');
      expect(csvGuestField(participantLines[1], 'Score (%)')).toBe('68.75');
      // Lead columns carry through (admin-only surface).
      expect(csvGuestField(participantLines[0], 'Email')).toContain('grace.guest');
      expect(csvGuestField(participantLines[0], 'Email Verified')).toBe('Yes');
      expect(csvGuestField(participantLines[0], 'Marketing Consent')).toBe('Yes');

      // Registered students, anonymous legacy attempts and in-progress guest
      // attempts never leak into the external cohort.
      const joined = lines.join('\n');
      expect(joined).not.toContain('Alice Ranker');
      expect(joined).not.toContain('Carol Unmentored');
      expect(joined).not.toContain('Anon Visitor');
      expect(joined).not.toContain('Still Working');
    });

    it('exports the same ranked guests in a typed Excel sheet (admin)', async () => {
      const { quiz, questions } = await createQuizWithQuestions([
        studentA.user._id,
        studentB.user._id,
        outsider.user._id,
      ]);
      await seedMixedCohort(quiz, questions);

      const res = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/excel?cohort=external`,
        admin.token
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(res.headers['content-disposition']).toContain('_leaderboard_external');
      expect(res.headers['content-disposition']).toContain('.xlsx');

      const rows = excelGuestRows(res);
      expect(rows[0][0]).toBe('External Leaderboard — Leaderboard Export Test');
      expect(String(rows[1][0])).toContain('2 participants');

      const headerIndex = rows.findIndex((row) => row[0] === 'Position');
      expect(rows[headerIndex].slice(0, GUEST_LEADERBOARD_EXPORT_COLUMNS.length)).toEqual(
        GUEST_LEADERBOARD_EXPORT_COLUMNS.map((c) => c.header)
      );

      const participantRows = excelGuestParticipantRows(res);
      expect(participantRows).toHaveLength(2);
      const nameCol = rows[headerIndex].indexOf('Name');
      expect(participantRows.map((row) => row[nameCol])).toEqual(['Grace Guest', 'Eshan External']);
      expect(participantRows.map((row) => row[0])).toEqual([1, 2]);

      const scoreCol = rows[headerIndex].indexOf('Score (%)');
      expect(participantRows[0][scoreCol]).toBe(100);
    });

    it('refuses the external cohort for mentors on both formats', async () => {
      const { quiz, questions } = await createQuizWithQuestions([studentA.user._id]);
      await addGuestAttempt(quiz, questions, 'Grace Guest', ['correct', 'correct', 'correct', 'correct'], 16);

      await Promise.all(
        EXPORTS.map(async ({ path }) => {
          const res = await getExport(`${path(quiz._id)}?cohort=external`, mentor.token);
          expect(res.status).toBe(403);
          expect(JSON.parse(res.body.toString('utf-8')).message).toContain('admins only');
        })
      );
    });

    it('keeps ?cohort=internal the registered-only spec for legacy callers', async () => {
      const { quiz, questions } = await createQuizWithQuestions([
        studentA.user._id,
        studentB.user._id,
        outsider.user._id,
      ]);
      await seedMixedCohort(quiz, questions);

      const bare = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv`,
        admin.token
      );
      const explicit = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv?cohort=internal`,
        admin.token
      );
      expect(bare.status).toBe(200);
      expect(explicit.status).toBe(200);

      // Bare default is the combined board (guests ride along); the explicit
      // internal param keeps serving the legacy registered-only file.
      expect(csvParticipantLines(bare)).toHaveLength(5);
      expect(csvParticipantLines(explicit)).toHaveLength(3);
      const explicitJoined = csvLines(explicit).join('\n');
      expect(explicitJoined).not.toContain('Grace Guest');
      expect(explicitJoined).not.toContain('Eshan External');
      const explicitHeader = csvLines(explicit).find((line) => line.startsWith('Rank,'));
      expect(explicitHeader).toBe(LEADERBOARD_EXPORT_COLUMNS.map((c) => c.header).join(','));
    });

    it('rejects unknown cohort values with 400 on both formats', async () => {
      const { quiz } = await createQuizWithQuestions([studentA.user._id]);

      await Promise.all(
        EXPORTS.map(async ({ path }) => {
          const bogus = await getExport(`${path(quiz._id)}?cohort=guests`, admin.token);
          expect(bogus.status).toBe(400);
          expect(JSON.parse(bogus.body.toString('utf-8')).message).toContain('Invalid cohort');

          const empty = await getExport(`${path(quiz._id)}?cohort=`, admin.token);
          expect(empty.status).toBe(400);
        })
      );
    });

    it('exports a valid empty file when the quiz has no guests', async () => {
      const { quiz, questions } = await createQuizWithQuestions([studentA.user._id]);
      await createAttempt(quiz, questions, studentA, { correct: 2, incorrect: 1 });

      const csvRes = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv?cohort=external`,
        admin.token
      );
      expect(csvRes.status).toBe(200);
      expect(csvGuestParticipantLines(csvRes)).toEqual([]);
      const lines = csvLines(csvRes);
      const detailsIndex = lines.findIndex((line) => line.startsWith('Test ID,'));
      expect(lines[detailsIndex + 1].endsWith(',0')).toBe(true); // Participants: 0

      const excelRes = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/excel?cohort=external`,
        admin.token
      );
      expect(excelRes.status).toBe(200);
      const rows = excelGuestRows(excelRes);
      expect(
        rows.some((cells) => cells.some((c) => String(c).includes('No public participants yet')))
      ).toBe(true);
      expect(excelGuestParticipantRows(excelRes)).toEqual([]);
    });

    it('accepts the token as a query parameter on the external cohort', async () => {
      const { quiz, questions } = await createQuizWithQuestions([]);
      await addGuestAttempt(quiz, questions, 'Grace Guest', ['correct', 'correct', 'correct', 'correct'], 16);

      const res = await request(app)
        .get(`/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv?cohort=external&token=${admin.token}`)
        .buffer(true)
        .parse(binaryParser);
      expect(res.status).toBe(200);
      expect(csvGuestParticipantLines(res)).toHaveLength(1);
    });

    it('escapes formula-like guest names (shared csvEscape)', async () => {
      const { quiz, questions } = await createQuizWithQuestions([]);
      await addGuestAttempt(
        quiz,
        questions,
        '=HYPERLINK("http://evil","click")',
        ['correct', 'correct', 'correct', 'correct'],
        16
      );

      const res = await getExport(
        `/api/quizzes/analytics/test/${quiz._id}/leaderboard/export/csv?cohort=external`,
        admin.token
      );
      expect(res.status).toBe(200);

      const participantLines = csvGuestParticipantLines(res);
      expect(participantLines).toHaveLength(1);
      expect(participantLines[0]).toContain(
        `"'=HYPERLINK(""http://evil"",""click"")"`
      );
    });
  });
});
