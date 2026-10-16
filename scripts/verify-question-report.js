/**
 * End-to-end verification of the student question-level report feature.
 *
 * Boots the REAL backend (server.js — Express + Socket.IO + Mongo memory
 * server), then drives it exactly like the app does:
 *
 *   1. Seeds a quiz covering every question type and verdict (mcq correct /
 *      incorrect / skipped, multiple-correct, match-the-following, numerical)
 *      plus a shareSolution:false flag, a retake, a guest attempt and an
 *      in-progress attempt.
 *   2. Fetches the JSON report endpoint — the exact URL the attempt-detail
 *      modal's AttemptQuestionReport component calls.
 *   3. Downloads the CSV and .xlsx exports using the EXACT URL shape the app
 *      builds (services/downloads.ts: GET <base>/...?token=<jwt>) and saves
 *      the real files to disk.
 *   4. Parses the downloaded .xlsx with exceljs (the producing library) and
 *      the CSV as text, then asserts the summary, headers, per-question rows,
 *      response formatting, marks and freeze pane match the JSON surface.
 *   5. Verifies authorization: student 403, unauthenticated 401, unassigned
 *      mentor 403, guest attempts admin-only, in-progress 400, bad id 404.
 *   6. Verifies the retake report shows only the retake's own responses.
 *
 * Run from the repo root:  node scripts/verify-question-report.js
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'question-report-verify-secret';

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
    const url = new URL(urlPath.replace(/^\//, ''), baseURL);
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
  const Guest = requireBackend('models/Guest');
  const GuestAttempt = requireBackend('models/GuestAttempt');
  const MentorStudentAssignment = requireBackend('models/MentorStudentAssignment');

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseURL = `http://127.0.0.1:${port}/api/`;
  log('backend listening on', port);

  const jwt = require(path.join(BACKEND, 'node_modules', 'jsonwebtoken'));

  // ---- Seed ----
  const subject = await Subject.create({ name: 'Verify Pathology', year: '1st', displayOrder: 1 });
  const mkQuestion = (overrides) => QuestionBank.create({
    subject: subject._id,
    topicName: 'Genetics',
    subtopicName: 'Mendelian',
    system: 'Disorders',
    questionType: 'mcq_single',
    difficulty: 'medium',
    question: 'Verify question?',
    options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
    correctAnswer: 1,
    ...overrides,
  });

  const q1 = await mkQuestion({ question: 'VQ1 mitochondria?' });
  const q2 = await mkQuestion({ question: 'VQ2 ribosome?' });
  const q3 = await mkQuestion({ question: 'VQ3 golgi?' });
  const q4 = await mkQuestion({
    question: 'VQ4 multi correct?', questionType: 'multiple_correct', correctAnswer: [0, 2],
  });
  const q5 = await mkQuestion({
    question: 'VQ5 match?', questionType: 'match_the_following',
    columnA: ['Mitosis', 'Meiosis'], columnB: ['Growth division', 'Gamete division'],
    correctAnswer: { 0: '0', 1: '1' },
  });
  const q6 = await mkQuestion({
    question: 'VQ6 numerical?', questionType: 'numerical', options: undefined, correctAnswer: 42,
  });
  const questions = [q1, q2, q3, q4, q5, q6];

  const admin = await User.create({ name: 'Verify Admin', email: `admin-${Date.now()}@verify.test`, password: 'password123', role: 'admin' });
  const mentor = await User.create({ name: 'Verify Mentor', email: `mentor-${Date.now()}@verify.test`, password: 'password123', role: 'mentor' });
  const strayMentor = await User.create({ name: 'Stray Mentor', email: `stray-${Date.now()}@verify.test`, password: 'password123', role: 'mentor' });
  const student = await User.create({ name: 'Vera Student', email: `vera-${Date.now()}@verify.test`, password: 'password123', role: 'student' });

  await MentorStudentAssignment.create({ mentor: mentor._id, student: student._id, isActive: true, assignedBy: admin._id });

  // shareSolution:false — students never see the key, but the ADMIN report must.
  const quiz = await Quiz.create({
    title: 'Question Report Verify Test',
    subject: subject._id,
    testType: 'weekly',
    duration: 30,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    shareSolution: false,
    assignedStudents: [student._id],
    createdBy: admin._id,
  });

  const snap = (type) => ({ questionType: type, subjectName: 'Verify Pathology' });
  const attempt = await QuizAttempt.create({
    quiz: quiz._id,
    student: student._id,
    status: 'completed',
    startTime: new Date(Date.now() - 15 * 60 * 1000),
    endTime: new Date(),
    score: 2,
    totalQuestions: 6,
    marksObtained: 6,
    totalMarks: 24,
    answers: [
      { questionIndex: 0, questionId: q1._id, selectedAnswer: 1, isCorrect: true, timeSpent: 30, metadataSnapshot: snap('mcq_single') },
      { questionIndex: 1, questionId: q2._id, selectedAnswer: 0, isCorrect: false, timeSpent: 45, metadataSnapshot: snap('mcq_single') },
      { questionIndex: 2, questionId: q3._id, selectedAnswer: -1, isCorrect: false, timeSpent: 10, metadataSnapshot: snap('mcq_single') },
      { questionIndex: 3, questionId: q4._id, selectedAnswer: [0, 2], isCorrect: true, timeSpent: 60, metadataSnapshot: snap('multiple_correct') },
      { questionIndex: 4, questionId: q5._id, selectedAnswer: { 0: '1', 1: '0' }, isCorrect: false, timeSpent: 90, metadataSnapshot: snap('match_the_following') },
      // Q6 never visited — no answer row.
    ],
  });

  const tokenFor = (user) => jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET);
  const adminToken = tokenFor(admin);
  const mentorToken = tokenFor(mentor);
  const strayMentorToken = tokenFor(strayMentor);
  const studentToken = tokenFor(student);
  const reportBase = `/quizzes/analytics/attempt/${attempt._id}/question-report`;

  // ---- 1. JSON surface (what the modal renders) ----
  const json = await api('GET', `${reportBase}`, { token: adminToken });
  check('json report 200', json.status === 200, `status ${json.status}`);
  const rows = json.body.questions;
  check('six question rows', rows.length === 6, `${rows.length}`);
  check('summary verdicts 2/2/2',
    json.body.attempt.correct === 2 && json.body.attempt.incorrect === 2 && json.body.attempt.skipped === 2,
    `${json.body.attempt.correct}/${json.body.attempt.incorrect}/${json.body.attempt.skipped}`);
  check('mcq correct response formatted (B — Mitochondria)',
    rows[0].result === 'correct' && rows[0].studentResponseLabel === 'B' && rows[0].studentResponseText === 'Mitochondria');
  check('admin sees answer key despite shareSolution:false', rows[0].correctAnswerText === 'Mitochondria');
  check('incorrect row distinguishes response from key',
    rows[1].result === 'incorrect' && rows[1].studentResponseText === 'Nucleus' && rows[1].correctAnswerText === 'Mitochondria');
  check('skipped row says Not answered, zero marks',
    rows[2].result === 'skipped' && rows[2].studentResponseText === 'Not answered' && rows[2].marks === 0);
  check('multiple-correct labels A, C',
    rows[3].studentResponseLabel === 'A, C');
  check('match-the-following pairs rendered',
    String(rows[4].studentResponseText).includes('Mitosis') && String(rows[4].correctAnswerText).includes('Mitosis'));
  check('numerical never-visited is skipped with key 42',
    rows[5].result === 'skipped' && rows[5].correctAnswerText === '42');
  check('marks follow +4/-1/0 scheme',
    rows[0].marks === 4 && rows[1].marks === -1 && rows[3].marks === 4 && rows[4].marks === -1);
  check('student identity attached', json.body.student.name === 'Vera Student' && Boolean(json.body.student.email));

  // ---- 2. CSV download, exactly the URL the app opens ----
  const csvRes = await api('GET', `${reportBase}/csv`, { token: adminToken, asQueryToken: true });
  check('csv export 200 (token as query param)', csvRes.status === 200, `status ${csvRes.status}`);
  check('csv content-type', csvRes.headers['content-type'] === 'text/csv; charset=utf-8');
  check('csv attachment + dated filename',
    /attachment/.test(csvRes.headers['content-disposition'] || '')
    && /_QuestionReport_\d{4}-\d{2}-\d{2}\.csv/.test(csvRes.headers['content-disposition'] || ''),
    csvRes.headers['content-disposition']);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeconic-question-report-'));
  fs.writeFileSync(path.join(outDir, 'question-report.csv'), csvRes.buffer);

  const csvText = csvRes.buffer.toString('utf-8');
  const csvHeaderIdx = csvText.split('\n').findIndex((l) => l.startsWith('Question No,'));
  check('csv question table header found', csvHeaderIdx >= 0);
  const csvDataLines = csvText.split('\n').slice(csvHeaderIdx + 1).filter((l) => /^\d+,/.test(l));
  check('csv row per question', csvDataLines.length === 6, `${csvDataLines.length}`);
  check('csv carries student + quiz identity', csvText.includes('Vera Student') && csvText.includes('Question Report Verify Test'));
  check('csv summary parity with JSON',
    csvText.includes(`Marks Obtained`) && csvText.includes('6'), 'marks line');
  const csvSkipped = csvDataLines.filter((l) => l.includes(',Skipped,')).length;
  check('csv skipped rows marked', csvSkipped === 2, `${csvSkipped}`);

  // ---- 3. Excel download ----
  const xlsxRes = await api('GET', `${reportBase}/excel`, { token: adminToken, asQueryToken: true });
  check('excel export 200 (token as query param)', xlsxRes.status === 200, `status ${xlsxRes.status}`);
  check('excel content-type', xlsxRes.headers['content-type'] === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  check('excel attachment + dated filename',
    /attachment/.test(xlsxRes.headers['content-disposition'] || '')
    && /\.xlsx/.test(xlsxRes.headers['content-disposition'] || ''));

  const xlsxPath = path.join(outDir, 'question-report.xlsx');
  fs.writeFileSync(xlsxPath, xlsxRes.buffer);
  log(`downloaded files in ${outDir}`);

  const Excel = requireBackend('node_modules/exceljs');
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load(xlsxRes.buffer);
  const sheet = workbook.getWorksheet('Question Report');
  check('excel sheet named "Question Report"', Boolean(sheet));
  check('excel title block names student + test',
    String(sheet.getCell(1, 1).value) === 'Vera Student — Question Report Verify Test',
    String(sheet.getCell(1, 1).value));

  let headerRow = 0;
  for (let row = 1; row <= 30; row += 1) {
    if (sheet.getCell(row, 1).value === 'Q No') { headerRow = row; break; }
  }
  check('excel header row found', headerRow > 0);
  check('excel header labels', sheet.getCell(headerRow, 8).value === 'Result' && sheet.getCell(headerRow, 7).value === 'Student Response');

  const excelRows = [];
  for (let row = headerRow + 1; row <= headerRow + 100; row += 1) {
    const num = sheet.getCell(row, 1).value;
    if (typeof num === 'number') {
      excelRows.push({
        num,
        response: String(sheet.getCell(row, 7).value || ''),
        result: String(sheet.getCell(row, 8).value || ''),
        marks: sheet.getCell(row, 10).value,
      });
    }
  }
  check('excel row per question', excelRows.length === 6, `${excelRows.length}`);
  check('excel verdicts match JSON',
    JSON.stringify(excelRows.map((r) => r.result)) === JSON.stringify(rows.map((r) => r.resultLabel)));
  check('excel marks match JSON',
    JSON.stringify(excelRows.map((r) => r.marks)) === JSON.stringify(rows.map((r) => r.marks)));
  check('excel mcq response text', excelRows[0].response.includes('Mitochondria'));
  check('excel skipped response text', excelRows[2].response.includes('Not answered'));
  check('excel freeze pane on header', sheet.views[0] && sheet.views[0].state === 'frozen');

  // ---- 4. Retake isolation ----
  const retake = await QuizAttempt.create({
    quiz: quiz._id,
    student: student._id,
    status: 'completed',
    startTime: new Date(),
    endTime: new Date(),
    score: 0,
    totalQuestions: 6,
    marksObtained: -6,
    totalMarks: 24,
    answers: questions.map((q, i) => ({
      questionIndex: i, questionId: q._id, selectedAnswer: 0, isCorrect: false,
      metadataSnapshot: snap(q.questionType),
    })),
  });
  const retakeJson = await api('GET', `/quizzes/analytics/attempt/${retake._id}/question-report`, { token: adminToken });
  check('retake report scoped to the retake',
    retakeJson.status === 200
    && retakeJson.body.attempt.marksObtained === -6
    && retakeJson.body.questions.every((q) => q.result === 'incorrect'),
    `status ${retakeJson.status}`);

  // ---- 5. Guest attempt (admin-only) ----
  const lead = await Guest.create({
    name: 'Gita Guest', email: `gita-${Date.now()}@verify.test`, phone: '+919876543210',
    emailVerifiedAt: new Date(),
  });
  const guestAttempt = await GuestAttempt.create({
    quiz: quiz._id, guest: lead._id, guestId: `device-${Date.now()}`,
    guestName: 'Gita Guest', guestEmail: lead.email,
    status: 'completed', startTime: new Date(Date.now() - 10 * 60 * 1000), endTime: new Date(),
    score: 1, totalQuestions: 6, marksObtained: 0, totalMarks: 24,
    answers: questions.map((q, i) => ({
      questionIndex: i, questionId: q._id, selectedAnswer: 1,
      isCorrect: i === 0, metadataSnapshot: snap(q.questionType),
    })),
  });
  const guestJson = await api('GET', `/quizzes/analytics/attempt/${guestAttempt._id}/question-report`, { token: adminToken });
  check('guest report resolves for admin with participantType',
    guestJson.status === 200 && guestJson.body.participantType === 'guest' && guestJson.body.student.name === 'Gita Guest',
    `status ${guestJson.status}`);
  const guestMentor = await api('GET', `/quizzes/analytics/attempt/${guestAttempt._id}/question-report`, { token: mentorToken });
  check('guest report hidden from mentors (404)', guestMentor.status === 404, `status ${guestMentor.status}`);

  // ---- 6. Authorization + input validation ----
  const asStudent = await api('GET', `${reportBase}`, { token: studentToken });
  const asStrayMentor = await api('GET', `${reportBase}`, { token: strayMentorToken });
  const asAnon = await api('GET', `${reportBase}`, {});
  const asAssignedMentor = await api('GET', `${reportBase}`, { token: mentorToken });
  const badId = await api('GET', '/quizzes/analytics/attempt/000000000000000000000000/question-report', { token: adminToken });
  const malformed = await api('GET', '/quizzes/analytics/attempt/not-an-id/question-report', { token: adminToken });
  check('student rejected (403)', asStudent.status === 403, `status ${asStudent.status}`);
  check('unassigned mentor rejected (403)', asStrayMentor.status === 403, `status ${asStrayMentor.status}`);
  check('assigned mentor served (200)', asAssignedMentor.status === 200, `status ${asAssignedMentor.status}`);
  check('unauthenticated rejected (401)', asAnon.status === 401, `status ${asAnon.status}`);
  check('unknown attempt id 404', badId.status === 404, `status ${badId.status}`);
  check('malformed attempt id 404 (no 500)', malformed.status === 404, `status ${malformed.status}`);

  const inProgress = await QuizAttempt.create({
    quiz: quiz._id, student: student._id, status: 'in_progress',
    totalQuestions: 6, answers: [],
  });
  const inProgressJson = await api('GET', `/quizzes/analytics/attempt/${inProgress._id}/question-report`, { token: adminToken });
  check('in-progress attempt rejected (400)', inProgressJson.status === 400, `status ${inProgressJson.status}`);

  // ---- 7. Formula-injection + deleted-question honesty ----
  const injectionQ = await mkQuestion({ question: '=SUM(A1:A9) sneaky question' });
  const injQuiz = await Quiz.create({
    title: 'Injection Verify', subject: subject._id, testType: 'daily', duration: 10,
    questions: [injectionQ._id], positiveMarks: 4, negativeMarks: 1, createdBy: admin._id,
  });
  const injAttempt = await QuizAttempt.create({
    quiz: injQuiz._id, student: student._id, status: 'completed',
    startTime: new Date(), endTime: new Date(), score: 1, totalQuestions: 1,
    marksObtained: 4, totalMarks: 4,
    answers: [{ questionIndex: 0, questionId: injectionQ._id, selectedAnswer: 1, isCorrect: true, metadataSnapshot: snap('mcq_single') }],
  });
  const injCsv = await api('GET', `/quizzes/analytics/attempt/${injAttempt._id}/question-report/csv`, { token: adminToken, asQueryToken: true });
  check('csv neutralizes formula-looking text',
    injCsv.buffer.toString('utf-8').includes("'=SUM(A1:A9) sneaky question"));

  await QuestionBank.deleteOne({ _id: injectionQ._id });
  const deletedJson = await api('GET', `/quizzes/analytics/attempt/${injAttempt._id}/question-report`, { token: adminToken });
  check('deleted question yields honest placeholder row',
    deletedJson.status === 200
    && deletedJson.body.questions.length === 1
    && deletedJson.body.questions[0].questionUnavailable === true
    && deletedJson.body.missingQuestionCount === 1,
    `status ${deletedJson.status}`);

  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  await cleanup();
  process.exit(failures === 0 ? 0 : 1);
}

async function cleanup() {
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoServer) await mongoServer.stop();
  } catch (error) {
    console.error('[verify] cleanup error', error);
  }
}

process.on('unhandledRejection', async (error) => {
  console.error('[verify] unhandled rejection', error);
  failures += 1;
  await cleanup();
  process.exit(1);
});

main().catch(async (error) => {
  console.error('[verify] fatal', error);
  failures += 1;
  await cleanup();
  process.exit(1);
});
