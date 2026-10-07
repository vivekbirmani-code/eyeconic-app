/**
 * End-to-end verification of the Live Leaderboard export feature.
 *
 * Boots the REAL backend (server.js — Express + Socket.IO + Mongo memory
 * server), then drives it exactly like the app does:
 *
 *   1. Seeds a quiz with ranked attempts (plus one in-progress attempt that
 *      must never appear).
 *   2. Fetches the leaderboard endpoint — the data the app renders.
 *   3. Downloads the CSV and .xlsx exports using the EXACT URL shape the app
 *      builds (services/downloads.ts: GET <base>/.../leaderboard/export/<fmt>
 *      ?token=<jwt>) and saves the real files to disk.
 *   4. Parses the downloaded .xlsx with exceljs and the CSV as text, then
 *      asserts participants, order, ranks and values match the endpoint.
 *   5. Re-checks after a late submission (server recomputes at export time)
 *      and checks mentor scoping + student rejection.
 *   6. External cohort (?cohort=external): seeds verified guest leads and
 *      downloads the guest CSV/.xlsx (admin-only, ranked with lead columns);
 *      asserts registered students and anonymous attempts stay out, mentors
 *      get 403, and bogus cohort values get 400.
 *
 * Run from the repo root:  node scripts/verify-leaderboard-export.js
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'leaderboard-export-verify-secret';

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');

let mongoServer;
let server;
let baseURL;

const log = (...args) => console.log('[verify]', ...args);
let failures = 0;

function requireBackend(modulePath) {
  // eslint-disable-next-line import/no-dynamic-require
  return require(path.join(BACKEND, modulePath));
}

function check(label, condition, detail) {
  if (condition) {
    log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`[verify] FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function api(method, urlPath, { token, asQueryToken, body } = {}) {
  return new Promise((resolve, reject) => {
    let url = new URL(urlPath.replace(/^\//, ''), baseURL);
    if (asQueryToken) url.searchParams.set('token', token);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(!asQueryToken && token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          let parsed = null;
          try {
            parsed = JSON.parse(buffer.toString('utf-8'));
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, buffer, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const { MongoMemoryServer } = require(path.join(
    BACKEND, 'node_modules', 'mongodb-memory-server'
  ));
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  log('in-memory mongo at', process.env.MONGODB_URI);

  // Require the real server AFTER env is pinned — dotenv never overrides
  // existing env vars, so the production Atlas URI in backend/.env is inert.
  const { app, server: httpServer } = requireBackend('server');
  server = httpServer;
  void app;

  const User = requireBackend('models/User');
  const Subject = requireBackend('models/Subject');
  const QuestionBank = requireBackend('models/QuestionBank');
  const Quiz = requireBackend('models/Quiz');
  const QuizAttempt = requireBackend('models/QuizAttempt');
  const MentorStudentAssignment = requireBackend('models/MentorStudentAssignment');
  const Guest = requireBackend('models/Guest');
  const GuestAttempt = requireBackend('models/GuestAttempt');

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseURL = `http://127.0.0.1:${port}/api/`;
  log('backend listening on', port);

  const jwt = require(path.join(BACKEND, 'node_modules', 'jsonwebtoken'));

  // ---- Seed ----
  const subject = await Subject.create({ name: 'Verify Pathology', year: '1st', displayOrder: 1 });
  const questions = [];
  for (let i = 0; i < 4; i += 1) {
    questions.push(await QuestionBank.create({
      subject: subject._id,
      topicName: 'Genetics',
      subtopicName: 'Mendelian',
      system: 'Disorders',
      questionType: 'mcq_single',
      difficulty: 'medium',
      question: `Export verify Q${i + 1}?`,
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 1,
    }));
  }

  const admin = await User.create({ name: 'Verify Admin', email: `admin-${Date.now()}@verify.test`, password: 'password123', role: 'admin' });
  const mentor = await User.create({ name: 'Verify Mentor', email: `mentor-${Date.now()}@verify.test`, password: 'password123', role: 'mentor' });
  const students = [];
  for (const name of ['Ann First', 'Ben Second', 'Cy Third', 'Dee Late']) {
    students.push(await User.create({
      name,
      email: `${name.split(' ')[0].toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@verify.test`,
      password: 'password123',
      role: 'student',
    }));
  }
  await MentorStudentAssignment.create({ mentor: mentor._id, student: students[0]._id, isActive: true, assignedBy: admin._id });

  const quiz = await Quiz.create({
    title: 'Export Verify Test',
    subject: subject._id,
    testType: 'daily',
    duration: 30,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    assignedStudents: students.map((s) => s._id),
    createdBy: admin._id,
  });

  const answer = (index, correct) => ({
    questionIndex: index,
    questionId: questions[index]._id,
    selectedAnswer: correct ? 1 : 2,
    isCorrect: Boolean(correct),
    metadataSnapshot: { questionType: 'mcq_single', subjectName: 'Verify Pathology' },
  });

  async function attempt(student, correct, incorrect, { status = 'completed' } = {}) {
    const answers = [];
    let i = 0;
    for (let c = 0; c < correct; c += 1) answers.push(answer(i++, true));
    for (let w = 0; w < incorrect; w += 1) answers.push(answer(i++, false));
    return QuizAttempt.create({
      quiz: quiz._id,
      student: student._id,
      status,
      startTime: new Date(Date.now() - 15 * 60 * 1000),
      endTime: new Date(),
      score: correct,
      totalQuestions: 4,
      marksObtained: correct * 4 - incorrect,
      totalMarks: 16,
      answers,
    });
  }

  // Ann 3c/1w = 11, Ben 2c/2w = 6, Cy 4c = 16; Dee mid-test (invisible).
  await attempt(students[0], 3, 1);
  await attempt(students[1], 2, 2);
  await attempt(students[2], 4, 0);
  await attempt(students[3], 4, 0, { status: 'in_progress' });

  const tokenFor = (user) => jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET);
  const adminToken = tokenFor(admin);
  const mentorToken = tokenFor(mentor);
  const studentToken = tokenFor(students[0]);
  const exportBase = `/quizzes/analytics/test/${quiz._id}/leaderboard`;

  // ---- 1. What the app shows ----
  const board = await api('GET', `${exportBase}`, { token: adminToken });
  check('leaderboard endpoint 200', board.status === 200, `status ${board.status}`);
  const shown = board.body.leaderboard;
  check('endpoint ranks Cy > Ann > Ben', JSON.stringify(shown.map((r) => r.studentName)) === JSON.stringify(['Cy Third', 'Ann First', 'Ben Second']));

  // ---- 2. CSV download, exactly the URL the app opens ----
  const csvRes = await api('GET', `${exportBase}/export/csv`, { token: adminToken, asQueryToken: true });
  check('csv export 200 (token as query param)', csvRes.status === 200, `status ${csvRes.status}`);
  check('csv content-type', csvRes.headers['content-type'] === 'text/csv; charset=utf-8');
  check('csv content-disposition attachment', /attachment/.test(csvRes.headers['content-disposition'] || ''));

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeconic-leaderboard-export-'));
  const csvPath = path.join(outDir, 'leaderboard.csv');
  fs.writeFileSync(csvPath, csvRes.buffer);

  const csvText = csvRes.buffer.toString('utf-8');
  const csvLines = csvText.split('\n');
  const csvHeaderIdx = csvLines.findIndex((l) => l.startsWith('Rank,'));
  const csvRows = csvLines.slice(csvHeaderIdx + 1).filter((l) => l.trim() !== '');
  const csvNames = csvRows.map((l) => l.split(',')[1]);
  check('csv participant count matches endpoint', csvRows.length === shown.length, `${csvRows.length} vs ${shown.length}`);
  check('csv order matches app leaderboard', JSON.stringify(csvNames) === JSON.stringify(shown.map((r) => r.studentName)));
  check('csv ranks 1..N', JSON.stringify(csvRows.map((l) => l.split(',')[0])) === JSON.stringify(['1', '2', '3']));
  check('csv excludes in-progress attempt', !csvText.includes('Dee Late'));
  check('csv carries quiz identity', csvText.includes('Export Verify Test'));

  // ---- 3. Excel download ----
  const xlsxRes = await api('GET', `${exportBase}/export/excel`, { token: adminToken, asQueryToken: true });
  check('excel export 200 (token as query param)', xlsxRes.status === 200, `status ${xlsxRes.status}`);
  check('excel content-type', xlsxRes.headers['content-type'] === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  check('excel content-disposition attachment .xlsx', /\.xlsx/.test(csvRes.headers && xlsxRes.headers['content-disposition'] || ''));

  const xlsxPath = path.join(outDir, 'leaderboard.xlsx');
  fs.writeFileSync(xlsxPath, xlsxRes.buffer);

  const Excel = requireBackend('node_modules/exceljs');
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load(xlsxRes.buffer);
  const sheet = workbook.getWorksheet('Leaderboard');
  check('excel sheet named "Leaderboard"', Boolean(sheet));
  check('excel title block names the quiz', String(sheet.getCell(1, 1).value) === 'Leaderboard — Export Verify Test');

  // Header row then participant names in column 2.
  let headerRow = 0;
  for (let row = 1; row <= 20; row += 1) {
    if (sheet.getCell(row, 1).value === 'Rank') { headerRow = row; break; }
  }
  check('excel header row found', headerRow > 0);
  const excelNames = [];
  for (let row = headerRow + 1; row <= headerRow + 200; row += 1) {
    const rank = sheet.getCell(row, 1).value;
    const name = sheet.getCell(row, 2).value;
    if (typeof rank === 'number' && name) excelNames.push({ rank, name: String(name) });
  }
  check('excel participant count matches endpoint', excelNames.length === shown.length, `${excelNames.length} vs ${shown.length}`);
  check('excel order + ranks match app leaderboard',
    JSON.stringify(excelNames) === JSON.stringify(shown.map((r, i) => ({ rank: i + 1, name: r.studentName }))));
  const scoreHeaderCol = (() => {
    for (let col = 1; col <= 20; col += 1) if (sheet.getCell(headerRow, col).value === 'Score (%)') return col;
    return 0;
  })();
  check('excel top score is 100%', sheet.getCell(headerRow + 1, scoreHeaderCol).value === 100);
  check('excel freeze pane on header', sheet.views[0] && sheet.views[0].state === 'frozen');

  // ---- 4. Late submission: export is authoritative at export time ----
  await attempt(students[3], 1, 3); // Dee finally submits (auto_submitted path not needed)
  const board2 = await api('GET', `${exportBase}`, { token: adminToken });
  const csvRes2 = await api('GET', `${exportBase}/export/csv`, { token: adminToken, asQueryToken: true });
  const csvRows2 = csvRes2.buffer.toString('utf-8').split('\n').filter((l) => /^\d+,/.test(l));
  check('late submission appears in endpoint AND export together',
    board2.body.leaderboard.length === 4 && csvRows2.length === 4,
    `endpoint ${board2.body.leaderboard.length}, csv ${csvRows2.length}`);

  // ---- 5. Authorization ----
  const studentCsv = await api('GET', `${exportBase}/export/csv`, { token: studentToken, asQueryToken: true });
  const studentXlsx = await api('GET', `${exportBase}/export/excel`, { token: studentToken, asQueryToken: true });
  const noTokenCsv = await api('GET', `${exportBase}/export/csv`, {});
  check('student rejected on both formats (403)', studentCsv.status === 403 && studentXlsx.status === 403, `${studentCsv.status}/${studentXlsx.status}`);
  check('unauthenticated rejected (401)', noTokenCsv.status === 401, `status ${noTokenCsv.status}`);

  // ---- 6. Mentor scoping ----
  const mentorCsv = await api('GET', `${exportBase}/export/csv`, { token: mentorToken, asQueryToken: true });
  const mentorNames = mentorCsv.buffer.toString('utf-8').split('\n').filter((l) => /^\d+,/.test(l)).map((l) => l.split(',')[1]);
  check('mentor export scoped to own students', JSON.stringify(mentorNames) === JSON.stringify(['Ann First']), JSON.stringify(mentorNames));

  // ---- 7. External cohort (public-quiz guests, admin-only) ----
  // Seed one verified lead per completed guest attempt plus one legacy
  // anonymous attempt that must never appear.
  let leadSeed = 0;
  async function guestAttempt(name, outcomes, marksObtained, { anonymous = false } = {}) {
    leadSeed += 1;
    let lead = null;
    let snapshots = {};
    if (!anonymous) {
      lead = await Guest.create({
        name,
        email: `${name.toLowerCase().replace(/\s+/g, '.')}-${Date.now()}-${leadSeed}@verify.test`,
        emailVerifiedAt: new Date(),
        phone: `+9198765${String(100000 + leadSeed).slice(1)}`,
        marketingConsent: { granted: true, updatedAt: new Date() },
        quizzesTaken: [quiz._id],
      });
      snapshots = { guest: lead._id, guestName: name, guestEmail: lead.email, guestPhone: lead.phone };
    }
    return GuestAttempt.create({
      quiz: quiz._id,
      guestId: `verify-device-${leadSeed}-${Math.random().toString(36).slice(2)}`,
      ...snapshots,
      status: 'completed',
      startTime: new Date(Date.now() - 20 * 60 * 1000),
      endTime: new Date(),
      score: outcomes.filter((o) => o === 'correct').length,
      totalQuestions: 4,
      marksObtained,
      totalMarks: 16,
      answers: outcomes.map((outcome, i) => ({
        questionIndex: i,
        questionId: questions[i]._id,
        selectedAnswer: outcome === 'correct' ? 1 : outcome === 'wrong' ? 0 : -1,
        isCorrect: outcome === 'correct',
        metadataSnapshot: { questionType: 'mcq_single', subjectName: 'Verify Pathology' },
      })),
    });
  }

  await guestAttempt('Gita Guest', ['correct', 'correct', 'correct', 'correct'], 16);
  await guestAttempt('Ravi Ranker', ['correct', 'correct', 'wrong', 'wrong'], 6);
  await guestAttempt('Anon Visitor', ['correct', 'correct', 'wrong', 'wrong'], 6, { anonymous: true });

  const extCsv = await api('GET', `${exportBase}/export/csv?cohort=external`, { token: adminToken, asQueryToken: true });
  check('external csv 200 (admin query token)', extCsv.status === 200, `status ${extCsv.status}`);
  check('external csv filename suffix', /_leaderboard_external\.csv/.test(extCsv.headers['content-disposition'] || ''));

  const extCsvPath = path.join(outDir, 'leaderboard-external.csv');
  fs.writeFileSync(extCsvPath, extCsv.buffer);

  const extCsvText = extCsv.buffer.toString('utf-8');
  const extCsvLines = extCsvText.split('\n');
  check('external csv titled "External Leaderboard"', extCsvLines[0] === 'External Leaderboard');
  const extHeaderIdx = extCsvLines.findIndex((l) => l.startsWith('Position,'));
  check('external csv header is the guest spec', extHeaderIdx > 0 && extCsvLines[extHeaderIdx].includes('Email Verified') && extCsvLines[extHeaderIdx].includes('Marketing Consent'));
  const extRows = extCsvLines.slice(extHeaderIdx + 1).filter((l) => l.trim() !== '');
  check('external csv ranks Gita > Ravi with dense positions',
    JSON.stringify(extRows.map((l) => [l.split(',')[0], l.split(',')[1]])) === JSON.stringify([['1', 'Gita Guest'], ['2', 'Ravi Ranker']]),
    JSON.stringify(extRows.map((l) => l.split(',').slice(0, 2))));
  check('external csv excludes registered students', !extCsvText.includes('Ann First') && !extCsvText.includes('Cy Third'));
  check('external csv excludes anonymous legacy attempt', !extCsvText.includes('Anon Visitor'));
  check('external csv carries lead columns', extRows[0].includes('Yes') && extRows[0].includes('+91'));

  const extXlsx = await api('GET', `${exportBase}/export/excel?cohort=external`, { token: adminToken, asQueryToken: true });
  check('external excel 200', extXlsx.status === 200, `status ${extXlsx.status}`);
  check('external excel filename suffix', /_leaderboard_external\.xlsx/.test(extXlsx.headers['content-disposition'] || ''));

  const extXlsxPath = path.join(outDir, 'leaderboard-external.xlsx');
  fs.writeFileSync(extXlsxPath, extXlsx.buffer);

  const extWorkbook = new Excel.Workbook();
  await extWorkbook.xlsx.load(extXlsx.buffer);
  const extSheet = extWorkbook.getWorksheet('External Leaderboard');
  check('external excel sheet named "External Leaderboard"', Boolean(extSheet));
  check('external excel title names the quiz', String(extSheet.getCell(1, 1).value) === 'External Leaderboard — Export Verify Test');
  check('external excel ranks Gita > Ravi',
    extSheet.getCell(6, 1).value === 1 && String(extSheet.getCell(6, 2).value) === 'Gita Guest'
      && extSheet.getCell(7, 1).value === 2 && String(extSheet.getCell(7, 2).value) === 'Ravi Ranker');

  const mentorExtCsv = await api('GET', `${exportBase}/export/csv?cohort=external`, { token: mentorToken, asQueryToken: true });
  const mentorExtXlsx = await api('GET', `${exportBase}/export/excel?cohort=external`, { token: mentorToken, asQueryToken: true });
  check('mentor rejected on external cohort (403)', mentorExtCsv.status === 403 && mentorExtXlsx.status === 403, `${mentorExtCsv.status}/${mentorExtXlsx.status}`);

  const bogusCsv = await api('GET', `${exportBase}/export/csv?cohort=guests`, { token: adminToken, asQueryToken: true });
  check('bogus cohort rejected (400)', bogusCsv.status === 400, `status ${bogusCsv.status}`);

  console.log('\n[verify] files written for manual inspection:');
  console.log(`[verify]   ${csvPath}`);
  console.log(`[verify]   ${xlsxPath}`);
  console.log(`[verify]   ${extCsvPath}`);
  console.log(`[verify]   ${extXlsxPath}`);

  if (failures > 0) {
    console.error(`\n[verify] FAILED with ${failures} check(s)`);
  } else {
    console.log('\nALL LEADERBOARD-EXPORT RUNTIME CHECKS PASSED');
  }
  // Hard exit like verify-live-leaderboard.js — server.close() would hang on
  // lingering keep-alive sockets and in-memory-mongo never idles.
  process.exit(failures > 0 ? 1 : 0);
}

main()
  .catch((error) => {
    console.error('[verify] crashed:', error);
    process.exit(1);
  });
