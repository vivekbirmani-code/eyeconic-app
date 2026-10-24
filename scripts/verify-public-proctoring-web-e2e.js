/**
 * REAL-APP end-to-end harness for PUBLIC-QUIZ WEB AI PROCTORING.
 *
 * Boots the REAL backend (in-memory Mongo) + the REAL vite dev client and
 * drives the taking page in a real Chromium (fake camera → no face), then
 * verifies the full pipeline: engine arm → analysis loop → episode
 * generation → batch transport → server ingest → DB rows → timeline.
 *
 * Why a fake camera is enough: with NO face in frame, a working engine MUST
 * record a sustained FACE_NOT_DETECTED episode (8s enter-debounce) that
 * closes and flushes at submit. Seeing only SESSION_STARTED stored is the
 * exact silent-blindness signature reported from the field — this harness
 * reproduces or refutes it deterministically.
 *
 * Run from the repo root (needs puppeteer-core resolvable, e.g.
 *   NODE_PATH=<dir-with-puppeteer-core> node scripts/verify-public-proctoring-web-e2e.js
 * plus a local Chrome/Edge at CHROME_PATH or the default path below).
 */
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'web-e2e-harness-secret';

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const CLIENT = path.join(ROOT, 'client');

const BACKEND_PORT = 3111;
const VITE_PORT = 5180;
const CHROME_PATH = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const log = (...args) => console.log('[e2e]', ...args);

function requireBackend(modulePath) {
  return require(path.join(BACKEND, modulePath));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, timeoutMs, label) {
  const started = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => { res.resume(); resolve(); });
        req.on('error', reject);
      });
      log(`${label} is up`);
      return;
    } catch {
      if (Date.now() - started > timeoutMs) throw new Error(`${label} did not come up`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(500);
    }
  }
}

async function main() {
  const monitorMs = parseInt(process.env.E2E_MONITOR_MS || '35000', 10);

  // ---- 1. backend on in-memory mongo ----
  const { MongoMemoryServer } = require(path.join(BACKEND, 'node_modules', 'mongodb-memory-server'));
  const mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.PORT = String(BACKEND_PORT);
  process.env.WEB_APP_URL = `http://localhost:${VITE_PORT}`;
  process.env.ALLOWED_ORIGINS = `http://localhost:${VITE_PORT}`;
  const { server } = requireBackend('server');
  await new Promise((resolve) => server.listen(BACKEND_PORT, resolve));
  log('backend on', BACKEND_PORT);

  // ---- 2. seed armed quiz + verified lead + consent + real precheck token ----
  const Guest = requireBackend('models/Guest');
  const Subject = requireBackend('models/Subject');
  const QuestionBank = requireBackend('models/QuestionBank');
  const Quiz = requireBackend('models/Quiz');
  const User = requireBackend('models/User');
  const ProctoringConsent = requireBackend('models/ProctoringConsent');
  const ProctoringEvent = requireBackend('models/ProctoringEvent');
  const ProctoringSession = requireBackend('models/ProctoringSession');
  const { setProctoringEnabled } = requireBackend('utils/appSettings');
  const { buildEffectiveProctoringPolicy } = requireBackend('utils/proctoring/policySnapshot');
  const { issuePrecheckToken } = requireBackend('utils/proctoring/precheckToken');
  const { signGuestToken } = requireBackend('middleware/guestAuth');

  await setProctoringEnabled(true);
  const subject = await Subject.create({ name: 'E2E Proctoring', year: '1st', displayOrder: 1 });
  const questions = [];
  for (let i = 0; i < 3; i += 1) {
    questions.push(await QuestionBank.create({
      subject: subject._id, topicName: 'Genetics', subtopicName: 'E2E', system: 'E2E Test',
      questionType: 'mcq_single', difficulty: 'medium',
      question: `E2E Q${i}?`, options: ['A', 'B', 'C', 'D'], correctAnswer: 1,
    }));
  }
  const admin = await User.create({
    name: 'E2E Admin', email: `e2e-admin-${Date.now()}@example.com`, password: 'password123', role: 'admin',
  });
  const shareToken = `e2e-${Date.now().toString(36)}`;
  const quiz = await Quiz.create({
    title: 'Web Proctoring E2E', subject: subject._id, testType: 'daily', duration: 30,
    createdBy: admin._id, questions: questions.map((q) => q._id),
    positiveMarks: 4, negativeMarks: 1, isPublic: true, shareToken,
    proctoring: {
      enabled: true, camera: 'required',
      focusEvents: { mode: 'warn-only' }, multipleFaces: { mode: 'record' },
      facePresence: { mode: 'record' }, attention: { mode: 'warn' },
    },
  });
  const effective = buildEffectiveProctoringPolicy(quiz);

  const guest = await Guest.create({
    name: 'E2e Guest', email: `e2e-${Date.now()}@example.com`, phone: '+919876543210',
    emailVerifiedAt: new Date(), marketingConsent: { granted: false }, source: 'web',
  });
  await ProctoringConsent.findOneAndUpdate(
    { quiz: quiz._id, guest: guest._id, policyVersion: effective.version },
    {
      $set: {
        quiz: quiz._id, guest: guest._id, policyVersion: effective.version,
        policyHash: effective.hash, consentTextVersion: 'e2e-harness', grantedAt: new Date(),
      },
    },
    { upsert: true }
  );
  const { token: precheckToken } = issuePrecheckToken({
    ownerId: guest._id, ownerKind: 'guest', quizId: quiz._id,
    policyHash: effective.hash, policyVersion: effective.version,
    summary: {
      deviceClass: 'web:120', cameraBypassed: false, checks: [],
      attentionBaseline: { yaw: 2, pitch: -5, roll: 0, frames: 5 },
    },
  });
  const guestToken = signGuestToken(guest._id);
  log('seeded quiz', shareToken, 'guest', guest.email);

  // ---- 3. vite dev server ----
  const vite = spawn('cmd', ['/c', 'npx.cmd', 'vite', '--port', String(VITE_PORT), '--strictPort'], {
    cwd: CLIENT,
    env: {
      ...process.env,
      VITE_API_URL: `http://localhost:${BACKEND_PORT}/api`,
      VITE_SOCKET_URL: `http://localhost:${BACKEND_PORT}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  let viteOut = '';
  vite.stdout.on('data', (d) => { viteOut += d.toString(); });
  vite.stderr.on('data', (d) => { viteOut += d.toString(); });
  try {
    await waitForHttp(`http://localhost:${VITE_PORT}/`, 60000, 'vite');
  } catch (err) {
    console.error('VITE OUTPUT:\n', viteOut);
    throw err;
  }

  // ---- 4. drive the app ----
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage();
  const consoleLines = [];
  page.on('console', (m) => {
    const text = m.text();
    consoleLines.push(text);
    if (/proctor|detect|landmark|WebGL|camera/i.test(text)) log('[page]', text.slice(0, 220));
  });
  const batches = [];
  page.on('request', (req) => {
    if (req.url().includes('/proctoring/events') && req.method() === 'POST') {
      let body = null;
      try { body = JSON.parse(req.postData()); } catch { body = req.postData(); }
      batches.push({
        at: new Date().toISOString(),
        heartbeat: body?.heartbeat,
        eventTypes: (body?.events || []).map((e) => e.type),
        seq: body?.seq,
      });
    }
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('/proctoring') || req.url().includes('/public/')) {
      log('[requestfailed]', req.url().slice(0, 120), req.failure()?.errorText);
    }
  });
  // Network-level tracing for the timeline fetch (card-stuck diagnosis).
  for (const evt of ['request', 'response', 'requestfinished']) {
    page.on(evt, (reqOrRes) => {
      const url = reqOrRes.url();
      if (url.includes('/proctoring/timeline')) {
        log(`[net:${evt}]`, url.slice(0, 90));
      }
    });
  }

  await page.evaluateOnNewDocument((t, pt, lead) => {
    localStorage.setItem('guestToken', t);
    sessionStorage.setItem('eyeconic_public_precheck_token', pt);
    localStorage.setItem('eyeconic_public_lead', JSON.stringify(lead));
  }, guestToken, precheckToken, { _id: String(guest._id), name: guest.name, email: guest.email });

  const failures = [];
  let cardText = null;
  try {
    await page.goto(`http://localhost:${VITE_PORT}/public-quiz/${shareToken}/take`, {
      waitUntil: 'networkidle2', timeout: 60000,
    });

    // Wait for the taking UI (question header) = /start succeeded + armed.
    await page.waitForFunction(
      () => !!document.querySelector('button') && document.body.innerText.includes('Question'),
      { timeout: 30000 }
    );
    log('taking page loaded; monitoring for', monitorMs, 'ms');

    // Answer one question, then monitor.
    await page.evaluate(() => {
      const labels = [...document.querySelectorAll('button, label, div[role="button"]')];
      const option = labels.find((b) => /^(A|1)[.)]?\s*$/.test(b.textContent.trim()));
      if (option) option.click();
    });

    await sleep(12000);
    // Tab-switch scenario (real browser): away ~4s (> the 2s focus floor),
    // then back — must record TAB_HIDDEN + produce the warn.focus action
    // (focusEvents warn-only) in the batch response.
    const otherTab = await browser.newPage();
    await otherTab.bringToFront();
    await sleep(4000);
    await page.bringToFront();
    await otherTab.close();
    log('tab-switch scenario done');

    await sleep(monitorMs - 16000);
    log('batches so far:', JSON.stringify(batches));

    // Submit: 'Submit Test' then confirm 'Submit test'.
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const submit = btns.find((b) => b.textContent.includes('Submit Test'));
      if (submit) submit.click();
    });
    await page.waitForFunction(
      () => !![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Submit test'),
      { timeout: 10000 }
    );
    await page.evaluate(() => {
      const confirm = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Submit test');
      if (confirm) confirm.click();
    });
    log('submitted; waiting for result page + final flush');
    await sleep(2000);
    // Wait for the monitoring card itself (case-insensitive — the loading
    // state renders 'Loading monitoring summary…' with a lowercase m).
    let cardText = null;
    try {
      // Wait for the READY state ('Recorded violations' only renders once
      // the timeline lands) — the loading state also matches 'monitoring
      // summary', and responses can queue for seconds in this scenario.
      await page.waitForFunction(
        () => /Recorded violations/i.test(document.body.innerText),
        { timeout: 45000 }
      );
      const bodyText = await page.evaluate(() => document.body.innerText);
      const idx = bodyText.search(/monitoring summary/i);
      cardText = bodyText.slice(idx, idx + 320).replace(/\n+/g, ' | ');
    } catch {
      cardText = 'NOT RENDERED (no monitoring summary text within 15s)';
    }
    log('result page?', /result|score/i.test(page.url()) ? 'yes' : 'unclear', page.url());
    log('summary card:', cardText);
  } catch (err) {
    failures.push(`browser flow: ${err.message}`);
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    consoleLines.push('PAGE BODY: ' + bodyText.slice(0, 600));
  }

  // ---- 5. verify DB truth ----
  await sleep(2000);
  const attempt = await requireBackend('models/GuestAttempt').findOne({ quiz: quiz._id }).sort({ createdAt: -1 });
  const sessionDoc = attempt ? await ProctoringSession.findOne({ attempt: attempt._id }) : null;
  const events = sessionDoc
    ? await ProctoringEvent.find({ session: sessionDoc._id }).sort({ serverAt: 1 })
    : [];
  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;

  log('=== RESULT ===');
  log('attempt status:', attempt?.status, 'integrity:', attempt?.integrityStatus);
  log('session status:', sessionDoc?.status, 'lastSeenAt:', sessionDoc?.sessionHealth?.lastSeenAt);
  log('stored events:', JSON.stringify(counts));
  log('network batches:', JSON.stringify(batches, null, 1));
  log('card on result page:', cardText ?? '(flow failed)');

  // Verdict: the engine must NEVER record just the session marker. With the
  // fake camera (no face), a healthy pipeline records either the sustained
  // FACE_NOT_DETECTED episode or — when the fake device's track dies before
  // frames flow — the frames-watchdog / track-ended technicals. Only-SESSION
  // is the silent-blindness signature this harness exists to catch.
  const technicals = ['CAMERA_UNAVAILABLE', 'CAMERA_TRACK_ENDED', 'CAMERA_PERMISSION_REVOKED', 'MODEL_UNAVAILABLE']
    .reduce((sum, type) => sum + (counts[type] || 0), 0);
  const sawFaceAbsent = (counts.FACE_NOT_DETECTED || 0) > 0;
  const sawOnlySessionMarker = Object.keys(counts).every((t) => t === 'SESSION_STARTED' || t === 'SESSION_RESUMED');
  log(sawFaceAbsent
    ? 'PIPELINE OK: FACE_NOT_DETECTED recorded end-to-end'
    : sawOnlySessionMarker
      ? 'REPRODUCED: only the session marker stored — engine was blind (the field bug)'
      : technicals > 0
        ? `PIPELINE OK (blind path honest): no analyzable frames this run, but ${technicals} camera/model technicals recorded — never silent`
        : 'UNEXPECTED: inspect batches above');

  // Timeline endpoint sanity (the card's data source) with the guest token.
  await new Promise((resolve) => {
    const req = http.get(
      `http://localhost:${BACKEND_PORT}/api/public/quiz/${shareToken}/attempt/${attempt?._id}/proctoring/timeline`,
      { headers: { Authorization: `Bearer ${guestToken}` } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          log('timeline endpoint status', res.statusCode);
          try {
            const parsed = JSON.parse(data);
            log('timeline summary:', JSON.stringify(parsed?.timeline?.summary || parsed).slice(0, 300));
          } catch { log('timeline body:', data.slice(0, 200)); }
          resolve();
        });
      }
    );
    req.on('error', (e) => { log('timeline fetch failed', e.message); resolve(); });
  });

  // Artifacts for offline inspection.
  fs.writeFileSync(path.join(ROOT, 'e2e-console.log'), consoleLines.join('\n'));
  log('console log written to e2e-console.log');

  await browser.close();
  vite.kill();
  await new Promise((resolve) => server.close(resolve));
  await mongoServer.stop();
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => { console.error('[e2e] FATAL', err); process.exit(1); });
