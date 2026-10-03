/**
 * Browser-level E2E verification of public-quiz SESSION ISOLATION.
 *
 * Boots the REAL backend (server.js + in-memory Mongo + an OTP-capturing
 * mailer stub) and the REAL web client (Vite dev server), then drives
 * headless Edge through the full OTP flow the way students do:
 *
 *   Student 1: open link -> name/email/phone -> OTP -> quiz -> submit ->
 *              own result.
 *   Student 2: SAME browser (shared localStorage — the siblings-on-one-PC
 *              shape), then per variant:
 *     samephone  — different name/email, SAME household phone number
 *     abandoned  — S1 left an in-progress attempt; S2 has fully different
 *                  details
 *     (default)  — fully different name/email/phone after S1 completed
 *
 * PASS = Student 2 lands on their OWN fresh quiz and, after submitting,
 * sees their OWN result (never Student 1's, never an already-attempted
 * dead end).
 *
 * Usage:  node scripts/verify-public-quiz-isolation.cjs [samephone|abandoned]
 * (run from client/; needs Edge at the standard Windows path)
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'verify-isolation-secret';
process.env.GUEST_JWT_EXPIRES_IN = '4h';
process.env.ALLOWED_ORIGINS = `http://localhost:${5174}`;

const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'backend');
const API_PORT = 3199;
const WEB_PORT = 5174;
const API = `http://localhost:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;

const log = (...a) => console.log('[verify]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const requireB = (p) => require(path.join(BACKEND, p));

// ---- captured OTPs (stubbed mailer) ----
const sentOtps = [];

async function waitForHttp(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) =>
        http.get(url, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject)
      );
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  // 1. In-memory Mongo, pinned BEFORE server require (dotenv never overrides).
  const { MongoMemoryServer } = requireB('node_modules/mongodb-memory-server');
  const mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  log('in-memory mongo up');

  // 2. Patch the mailer BEFORE server.js loads its routes — the stub captures
  //    OTPs so the browser flow can be driven for real.
  const mailer = requireB('utils/mailer');
  mailer.sendGuestQuizOtpMail = async (email, otp) => {
    sentOtps.push({ email, otp });
    log(`[mailer-stub] OTP for ${email}: ${otp}`);
  };

  const { server } = requireB('server');
  await new Promise((r) => server.listen(API_PORT, r));
  log(`backend on :${API_PORT}`);

  // 3. Seed an admin + subject + questions + PUBLIC quiz via the models.
  const User = requireB('models/User');
  const Subject = requireB('models/Subject');
  const QuestionBank = requireB('models/QuestionBank');
  const Quiz = requireB('models/Quiz');
  const admin = await User.create({ name: 'Admin', email: `admin-${Date.now()}@x.com`, password: 'password123', role: 'admin' });
  const subject = await Subject.create({ name: 'Pathology', year: '1st', displayOrder: 1 });
  const questions = [];
  for (let i = 0; i < 3; i++) {
    questions.push(await QuestionBank.create({
      subject: subject._id, topicName: 'T', subtopicName: 'S', system: 'Sys',
      questionType: 'mcq_single', difficulty: 'medium', question: `Q${i} — powerhouse?`,
      options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'], correctAnswer: 1,
      createdBy: admin._id,
    }));
  }
  const quiz = await Quiz.create({
    title: 'Isolation E2E Quiz', subject: subject._id, testType: 'daily', duration: 10,
    questions: questions.map((q) => q._id), positiveMarks: 4, negativeMarks: 1,
    createdBy: admin._id, isPublic: true,
    shareToken: `e2e-${Date.now()}`,
  });
  const shareToken = quiz.shareToken;
  log('quiz seeded:', shareToken);

  // 4. Vite dev server for the web client, pointed at our backend.
  const vite = spawn('npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], {
    cwd: path.join(ROOT, 'client'),
    env: { ...process.env, VITE_API_URL: `${API}/api` },
    shell: true,
    stdio: 'ignore',
  });
  await waitForHttp(`${WEB}/`);
  log(`web client on :${WEB_PORT}`);

  // 5. Drive the real UI.
  const puppeteer = require('puppeteer-core');
  const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 900 },
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') log('[browser err]', m.text().slice(0, 200)); });

  const otpFor = (email) => {
    const hit = sentOtps.filter((o) => o.email === email).pop();
    if (!hit) throw new Error(`no OTP captured for ${email}`);
    return hit.otp;
  };

  async function runStudent(who, { name, email, phone }) {
    log(`--- ${who}: opening link fresh (full page load, shared localStorage) ---`);
    await page.goto(`${WEB}/public-quiz/${shareToken}`, { waitUntil: 'networkidle2' });

    // Fill the lead form.
    await page.waitForSelector('#lead-name', { timeout: 20000 });
    await page.type('#lead-name', name);
    await page.type('#lead-email', email);
    await page.type('#lead-phone', phone);
    await page.click('button[type=submit]');
    log(`${who}: OTP requested`);

    // OTP step.
    await page.waitForSelector('input[inputmode="numeric"]', { timeout: 30000 });
    await sleep(400);
    await page.type('input[inputmode="numeric"]', otpFor(email));
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Verify & Start Quiz'));
      if (btn) btn.click();
    });
    log(`${who}: OTP submitted, waiting to see where we land…`);

    // Either the taking page (question palette) or a redirect to /result/:id.
    await sleep(6000);
    const url = page.url();
    log(`${who}: landed on ${url}`);
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
    const stored = await page.evaluate(() => ({
      guestToken: localStorage.getItem('guestToken'),
      attempt: localStorage.getItem('eyeconic_public_attempt'),
      guestId: localStorage.getItem('eyeconic_public_guest_id'),
    }));
    log(`${who}: localStorage=`, JSON.stringify(stored));
    return { url, bodyText, stored };
  }

  // ================= STUDENT 1 (full happy path) =================
  const VARIANT = process.argv[2] || 'samephone'; // samephone | abandoned
  const s1 = await runStudent('S1', { name: 'Student One', email: 'student1.repro@example.com', phone: '9876543210' });
  const s1OnTake = s1.url.includes('/take');
  log(`S1 reached taking page: ${s1OnTake}`);
  if (!s1OnTake) {
    log('S1 DID NOT reach the quiz — aborting. Body:', s1.bodyText.slice(0, 300));
    await browser.close(); vite.kill(); server.close(); await mongoServer.stop();
    process.exit(1);
  }

  if (VARIANT === 'abandoned') {
    // S1 answers ONE question then walks away (attempt stays in_progress).
    await page.waitForSelector('footer button', { timeout: 20000 });
    await page.evaluate(() => {
      const opt = [...document.querySelectorAll('main button')].find((b) => b.textContent.includes('Mitochondria'));
      if (opt) opt.click();
    });
    await sleep(1500); // let autosave/debounced save land
    log('S1 answered Q1 and abandoned (no submit)');

    const s2 = await runStudent('S2-abandoned', { name: 'Student Two', email: 'student2.repro@example.com', phone: '7001234567' });
    console.log('\n================ OBSERVED (abandoned) ================');
    console.log('S2 landed on  :', s2.url);
    console.log('S2 page snippet:', s2.bodyText.replace(/\n+/g, ' | ').slice(0, 400));
    console.log('=================================================\n');
    await browser.close(); vite.kill(); server.close(); await mongoServer.stop();
    process.exit(0);
  }

  // Answer everything and submit the test.
  await page.waitForSelector('footer button', { timeout: 20000 });
  for (let i = 0; i < questions.length; i++) {
    await page.evaluate(() => {
      const opt = [...document.querySelectorAll('main button')].find((b) => b.textContent.includes('Mitochondria'));
      if (opt) opt.click();
    });
    await sleep(150);
    const next = await page.$('footer button[title], footer button');
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('footer button')];
      const next = btns.find((b) => b.textContent.trim() === 'Next');
      if (next) next.click();
    });
    await sleep(150);
  }
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('footer button')];
    const submit = btns.find((b) => b.textContent.includes('Submit Test'));
    if (submit) submit.click();
  });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Submit test'), { timeout: 10000 });
  await page.evaluate(() => {
    const confirm = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Submit test');
    if (confirm) confirm.click();
  });
  await page.waitForFunction(() => location.pathname.includes('/result/'), { timeout: 30000 });
  await sleep(2500);
  const s1ResultUrl = page.url();
  const s1ResultText = await page.evaluate(() => document.body.innerText.slice(0, 800));
  log('S1 RESULT url:', s1ResultUrl);
  log('S1 result page shows "Student One":', s1ResultText.includes('Student One'));

  // ================= STUDENT 2 (same browser) =================
  // samephone variant: household shares ONE phone number — different name+email.
  const s2 = VARIANT === 'samephone'
    ? await runStudent('S2-samephone', { name: 'Student Two', email: 'student2.repro@example.com', phone: '9876543210' })
    : await runStudent('S2', { name: 'Student Two', email: 'student2.repro@example.com', phone: '7001234567' });
  console.log('\n================ OBSERVED RESULT ================');
  console.log('VARIANT:', VARIANT);
  console.log('S1 result URL :', s1ResultUrl);
  console.log('S2 landed on  :', s2.url);
  console.log('S2 sees S1 result page?', s2.url.includes('/result/') && String(s2.url).split('/').pop() === String(s1ResultUrl.split('/').pop()));
  console.log('S2 page mentions "Student One"?', s2.bodyText.includes('Student One'));
  console.log('S2 page mentions "Student Two"?', s2.bodyText.includes('Student Two'));
  console.log('S2 page snippet:', s2.bodyText.replace(/\n+/g, ' | ').slice(0, 300));

  if (s2.url.includes('/take')) {
    // Complete S2's quiz and verify their OWN result renders.
    await page.waitForSelector('footer button', { timeout: 20000 });
    for (let i = 0; i < questions.length; i++) {
      await page.evaluate(() => {
        const opt = [...document.querySelectorAll('main button')].find((b) => b.textContent.includes('Ribosome'));
        if (opt) opt.click();
      });
      await sleep(150);
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('footer button')];
        const next = btns.find((b) => b.textContent.trim() === 'Next');
        if (next) next.click();
      });
      await sleep(150);
    }
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('footer button')];
      const submit = btns.find((b) => b.textContent.includes('Submit Test'));
      if (submit) submit.click();
    });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Submit test'), { timeout: 10000 });
    await page.evaluate(() => {
      const confirm = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Submit test');
      if (confirm) confirm.click();
    });
    await page.waitForFunction(() => location.pathname.includes('/result/'), { timeout: 30000 });
    await sleep(2500);
    const s2ResultUrl = page.url();
    const s2ResultText = await page.evaluate(() => document.body.innerText.slice(0, 900));
    console.log('S2 result URL :', s2ResultUrl);
    console.log('S2 result is OWN attempt?', String(s2ResultUrl.split('/').pop()) !== String(s1ResultUrl.split('/').pop()));
    console.log('S2 result shows "Student Two"?', s2ResultText.includes('Student Two'));
    console.log('S2 result shows "Student One"?', s2ResultText.includes('Student One'));
    console.log('S2 already-attempted banner wrongly shown?', s2ResultText.includes('You have already attempted'));
  }
  console.log('=================================================\n');

  await browser.close();
  vite.kill();
  server.close();
  await mongoServer.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error('repro crashed:', err);
  process.exit(1);
});
