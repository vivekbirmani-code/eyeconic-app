/**
 * UI end-to-end verification of the student question-level report.
 *
 * Boots the REAL stack the way a developer runs it:
 *   1. Backend server.js on :3100 with an in-memory Mongo (MONGODB_URI
 *      pinned before require — the Atlas URI in backend/.env stays inert)
 *      and CORS opened for the Metro origin.
 *   2. Seeds admin + student + a mixed-verdict quiz attempt.
 *   3. Metro web dev server on :8090 with EXPO_PUBLIC_API_URL pointed at
 *      the local backend (dev mode, so the app resolves the dev API host).
 *   4. Drives the real admin UI with headless Chromium (playwright-core +
 *      locally cached browser): Student Analytics -> student -> attempt ->
 *     AttemptDetailModal -> Question-Level Report section; checks filters,
 *     verdict chips, response/answer rendering, CSV download event, and a
 *     phone-width pass. Screenshots land in a temp dir (path is printed).
 *
 * Run from the repo root:  node scripts/verify-question-report-ui.js
 *
 * NOTE (2026-10-16, Vivek's Windows box): this script boots the full stack
 * correctly, but headless Chromium cannot reach the local Metro/backend
 * ports on this machine (connections are refused/reset by a local network
 * filter while Node/curl requests to the same ports succeed). It is kept
 * for environments where browser->localhost works (CI, other machines);
 * locally, use scripts/verify-question-report.js (API-level, 45 checks)
 * plus a manual click-through of the modal.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'question-report-ui-secret';

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const BACKEND_PORT = 3100;
const METRO_PORT = 8095;

process.env.ALLOWED_ORIGINS = `http://localhost:${METRO_PORT},http://127.0.0.1:${METRO_PORT}`;

const log = (...args) => console.log('[ui-verify]', ...args);
let failures = 0;
const check = (label, condition, detail) => {
  if (condition) log(`PASS  ${label}`);
  else {
    failures += 1;
    console.error(`[ui-verify] FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Killing cmd.exe on Windows orphans the Metro node child — take the whole
// tree down so the next run can bind the port.
function killProcessTree(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      require('child_process').execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      child.kill();
    }
  } else {
    child.kill();
  }
}

function requireBackend(modulePath) {
  // eslint-disable-next-line import/no-dynamic-require
  return require(path.join(BACKEND, modulePath));
}

// Chromium binary from the local ms-playwright cache (any recent revision).
function findChromium() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!fs.existsSync(base)) return null;
  const candidates = fs.readdirSync(base)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const dir of candidates) {
    for (const sub of ['chrome-win64', 'chrome-win', 'chrome-mac', 'chrome-linux']) {
      const exe = path.join(base, dir, sub, process.platform === 'win32' ? 'chrome.exe' : 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

async function main() {
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeconic-question-report-ui-'));
  log('screenshots ->', shotDir);

  // ---- 1. Backend on :3100 with in-memory Mongo ----
  const { MongoMemoryServer } = require(path.join(BACKEND, 'node_modules', 'mongodb-memory-server'));
  const mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  const { server } = requireBackend('server');
  await new Promise((resolve) => server.listen(BACKEND_PORT, '0.0.0.0', resolve));
  log('backend on', BACKEND_PORT);

  // ---- 2. Seed ----
  const User = requireBackend('models/User');
  const Subject = requireBackend('models/Subject');
  const QuestionBank = requireBackend('models/QuestionBank');
  const Quiz = requireBackend('models/Quiz');
  const QuizAttempt = requireBackend('models/QuizAttempt');

  const subject = await Subject.create({ name: 'UI Verify Pathology', year: '1st', displayOrder: 1 });
  const mk = (overrides) => QuestionBank.create({
    subject: subject._id, topicName: 'Genetics', subtopicName: 'Mendelian', system: 'Disorders',
    questionType: 'mcq_single', difficulty: 'medium', question: 'UI question?',
    options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'], correctAnswer: 1, ...overrides,
  });
  const q1 = await mk({ question: 'UI Q1: Which organelle is the powerhouse?' });
  const q2 = await mk({ question: 'UI Q2: Where is protein synthesized?' });
  const q3 = await mk({ question: 'UI Q3: Which organelle packages proteins?' });
  const q4 = await mk({ question: 'UI Q4: Pick the membrane-bound organelles?', questionType: 'multiple_correct', correctAnswer: [0, 1] });

  const admin = await User.create({ name: 'UI Admin', email: `uiadmin-${Date.now()}@verify.test`, password: 'password123', role: 'admin' });
  const student = await User.create({ name: 'Uma Student', email: `uma-${Date.now()}@verify.test`, password: 'password123', role: 'student' });

  const quiz = await Quiz.create({
    title: 'UI Question Report Test', subject: subject._id, testType: 'daily', duration: 20,
    questions: [q1._id, q2._id, q3._id, q4._id], positiveMarks: 4, negativeMarks: 1,
    assignedStudents: [student._id], createdBy: admin._id,
  });
  const snap = (type) => ({ questionType: type, subjectName: 'UI Verify Pathology' });
  await QuizAttempt.create({
    quiz: quiz._id, student: student._id, status: 'completed',
    startTime: new Date(Date.now() - 12 * 60 * 1000), endTime: new Date(),
    score: 2, totalQuestions: 4, marksObtained: 7, totalMarks: 16,
    answers: [
      { questionIndex: 0, questionId: q1._id, selectedAnswer: 1, isCorrect: true, timeSpent: 40, metadataSnapshot: snap('mcq_single') },
      { questionIndex: 1, questionId: q2._id, selectedAnswer: 0, isCorrect: false, timeSpent: 35, metadataSnapshot: snap('mcq_single') },
      { questionIndex: 2, questionId: q3._id, selectedAnswer: -1, isCorrect: false, timeSpent: 15, metadataSnapshot: snap('mcq_single') },
      { questionIndex: 3, questionId: q4._id, selectedAnswer: [0, 1], isCorrect: true, timeSpent: 65, metadataSnapshot: snap('multiple_correct') },
    ],
  });

  const jwt = require(path.join(BACKEND, 'node_modules', 'jsonwebtoken'));
  const adminToken = jwt.sign({ userId: admin._id.toString() }, process.env.JWT_SECRET);

  // ---- 3. Metro web dev server on :8090 ----
  // Windows: spawning npx.cmd directly fails with EINVAL (Node CVE patch
  // requires a shell for .cmd) — go through cmd.exe explicitly.
  const isWindows = process.platform === 'win32';
  const metroCommand = isWindows
    ? { file: 'cmd.exe', args: ['/c', 'npx', 'expo', 'start', '--web', '--port', String(METRO_PORT), '--clear'] }
    : { file: 'npx', args: ['expo', 'start', '--web', '--port', String(METRO_PORT), '--clear'] };
  const metro = spawn(metroCommand.file, metroCommand.args, {
    cwd: ROOT,
    env: {
      // Strip the harness's backend-only vars: NODE_ENV=test breaks Metro's
      // web transform (bundle 500s), MONGODB_URI/JWT are backend concerns.
      ...process.env,
      NODE_ENV: 'development',
      CI: '1',
      EXPO_PUBLIC_API_URL: `http://localhost:${BACKEND_PORT}`,
      EXPO_NO_TELEMETRY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(isWindows ? { windowsHide: true } : {}),
  });
  let metroReady = false;
  const metroLogPath = path.join(shotDir, 'metro.log');
  const metroLog = fs.createWriteStream(metroLogPath, { flags: 'a' });
  let metroExited = false;
  metro.stdout.on('data', (chunk) => {
    const text = String(chunk);
    metroLog.write(text);
    if (/Waiting on|Web is running|Starting Metro|log_|Bundling/.test(text)) {
      if (/Web is running|waiting on http:\/\/localhost:(\d+)/i.test(text)) metroReady = true;
    }
  });
  metro.stderr.on('data', (chunk) => {
    const text = String(chunk);
    metroLog.write(`[stderr] ${text}`);
  });
  metro.on('exit', (code) => {
    metroExited = true;
    console.error(`[ui-verify] metro exited early, code=${code}; log: ${metroLogPath}`);
  });

  // Metro answers GET / with the dev page once up — poll it.
  const http = require('http');
  const metroUp = () => new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${METRO_PORT}/`, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
  log('waiting for Metro (first web compile can take a while)...');
  let metroOk = false;
  for (let i = 0; i < 120; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await metroUp()) { metroOk = true; break; }
    // eslint-disable-next-line no-await-in-loop
    await sleep(2500);
  }
  check('metro dev server up', metroOk);
  if (!metroOk) {
    killProcessTree(metro);
    process.exit(1);
  }

  // Warm the web bundle from the script BEFORE Chromium asks for it: this
  // machine's network filter kills Chromium's long-lived connection during
  // the first ~20s compile (ERR_CONNECTION_REFUSED on the entry bundle).
  // Node-side requests survive the compile; once Metro's cache is warm the
  // browser's own request returns in milliseconds.
  const warmBundle = () => new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${METRO_PORT}/node_modules/expo-router/entry.bundle?platform=web&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable`,
      { timeout: 180000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
  log('warming the web bundle (first compile)...');
  let bundleWarm = false;
  for (let i = 0; i < 6 && !bundleWarm; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    bundleWarm = await warmBundle();
    if (!bundleWarm) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(5000);
    }
  }
  check('web bundle compiled + served', bundleWarm);

  // ---- 4. Drive the UI ----
  const { chromium } = require(path.join(os.tmpdir(), 'ui-verify', 'node_modules', 'playwright-core'));
  const executablePath = findChromium();
  check('cached chromium found', Boolean(executablePath), executablePath || 'none');
  // --no-proxy-server: this machine's system proxy otherwise resets/refuses
  // connections to the local Metro server (curl works, Chromium doesn't).
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-proxy-server'],
  });

  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  // Skip the T&C gate + login: seed the exact storage keys the app reads.
  await context.addInitScript(([token]) => {
    window.localStorage.setItem('disclaimer_accepted', 'true');
    window.localStorage.setItem('authToken', token);
  }, [adminToken]);

  const page = await context.newPage();
  const apiCalls = [];
  const consoleErrors = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/')) apiCalls.push(req.url());
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('requestfailed', (req) => {
    consoleErrors.push(`REQUEST FAILED: ${req.url()} — ${req.failure()?.errorText}`);
  });

  const appUrl = `http://127.0.0.1:${METRO_PORT}/quizzes/student-analytics`;
  log('opening', appUrl);
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 240000 });
  try {
    await page.waitForSelector('text=Student Analytics', { timeout: 180000 });
  } catch (error) {
    await page.screenshot({ path: path.join(shotDir, '00-failure.png') });
    const text = await page.textContent('body').catch(() => '(no body)');
    console.error('[ui-verify] page body head:', text.slice(0, 800));
    console.error('[ui-verify] console errors:', consoleErrors.slice(0, 10).join(' | ').slice(0, 1500));
    console.error('[ui-verify] api calls:', apiCalls.slice(0, 10).join(' | '));
    console.error(`[ui-verify] metroExited=${metroExited}; metro log tail:`);
    console.error(fs.readFileSync(metroLogPath, 'utf-8').slice(-2000));
    throw error;
  }
  await page.screenshot({ path: path.join(shotDir, '01-student-list.png'), fullPage: false });

  // Switch to the Student Analytics tab (default tab is Test Analytics).
  await page.click('text=Student Analytics');
  await page.waitForSelector('text=Select a Student', { timeout: 60000 });
  await page.click('text=Uma Student');
  await page.waitForSelector('text=Test History', { timeout: 60000 });
  await page.screenshot({ path: path.join(shotDir, '02-student-analytics.png') });

  // Open the attempt detail modal from the Test History card.
  await page.click('text=UI Question Report Test');
  await page.waitForSelector('text=Question-Level Report', { timeout: 60000 });
  // Give the report fetch a moment, then scroll it into view.
  await page.waitForSelector('text=Student response', { timeout: 60000 });
  await page.screenshot({ path: path.join(shotDir, '03-modal-top.png') });

  const reportSection = page.locator('text=Question-Level Report').first();
  await reportSection.scrollIntoViewIfNeeded();

  // Verdict rendering: chip text + per-question rows.
  await page.waitForSelector('text=UI Q1: Which organelle is the powerhouse?', { timeout: 30000 });
  check('question cards render question text', true);
  const body = await page.textContent('body');
  check('correct verdict chip shown', body.includes('Correct'));
  check('incorrect verdict chip shown', body.includes('Incorrect'));
  check('skipped verdict chip shown', body.includes('Skipped'));
  check('student response rendered', body.includes('Mitochondria'));
  check('correct answer rendered', body.includes('Nucleus'));
  check('not answered rendered for skipped', body.includes('Not answered'));
  check('marks shown (+4 / -1)', body.includes('+4') && body.includes('-1'));
  check('report fetched from backend',
    apiCalls.some((url) => url.includes('/quizzes/analytics/attempt/') && url.includes('/question-report')),
    apiCalls.filter((u) => u.includes('question-report')).join(' '));
  await page.screenshot({ path: path.join(shotDir, '04-question-report.png'), fullPage: false });

  // Filter chips: Incorrect (2) should leave two question cards.
  await page.click('text=Incorrect (2)');
  await sleep(400);
  const q1Visible = await page.locator('text=UI Q1: Which organelle').count();
  const q2Visible = await page.locator('text=UI Q2: Where is protein').count();
  check('incorrect filter hides correct questions', q1Visible === 0 && q2Visible > 0);
  await page.screenshot({ path: path.join(shotDir, '05-filter-incorrect.png') });
  await page.click('text=All (4)');
  await sleep(300);

  // CSV export triggers a real browser download of the report file.
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.click('text=CSV');
  const download = await downloadPromise;
  const suggested = download.suggestedFilename();
  check('csv download filename pattern', /_QuestionReport_\d{4}-\d{2}-\d{2}\.csv$/.test(suggested), suggested);
  const csvTarget = path.join(shotDir, suggested);
  await download.saveAs(csvTarget);
  const csvText = fs.readFileSync(csvTarget, 'utf-8');
  check('downloaded csv carries report content',
    csvText.includes('Uma Student') && csvText.includes('UI Q1: Which organelle is the powerhouse?')
    && csvText.includes(',Skipped,'));

  // ---- 5. Phone-width pass ----
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  await phone.addInitScript(([token]) => {
    window.localStorage.setItem('disclaimer_accepted', 'true');
    window.localStorage.setItem('authToken', token);
  }, [adminToken]);
  const ppage = await phone.newPage();
  await ppage.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await ppage.waitForSelector('text=Student Analytics', { timeout: 120000 });
  await ppage.click('text=Student Analytics');
  await ppage.waitForSelector('text=Uma Student', { timeout: 60000 });
  await ppage.click('text=Uma Student');
  await ppage.waitForSelector('text=UI Question Report Test', { timeout: 60000 });
  await ppage.click('text=UI Question Report Test');
  await ppage.waitForSelector('text=Question-Level Report', { timeout: 60000 });
  await ppage.waitForSelector('text=Student response', { timeout: 60000 });
  const scrollWidth = await ppage.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await ppage.evaluate(() => document.documentElement.clientWidth);
  check('no horizontal page overflow at 390px', scrollWidth <= clientWidth + 1, `${scrollWidth} vs ${clientWidth}`);
  await ppage.locator('text=Question-Level Report').first().scrollIntoViewIfNeeded();
  await ppage.screenshot({ path: path.join(shotDir, '06-phone-report.png'), fullPage: false });

  await browser.close();
  killProcessTree(metro);
  await new Promise((resolve) => server.close(resolve));
  await mongoServer.stop();

  log(failures === 0 ? `ALL CHECKS PASSED — screenshots in ${shotDir}` : `${failures} CHECK(S) FAILED — screenshots in ${shotDir}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('[ui-verify] fatal', error);
  failures += 1;
  process.exit(1);
});
