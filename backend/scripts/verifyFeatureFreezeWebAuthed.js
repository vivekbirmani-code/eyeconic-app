/**
 * Browser-level verification of the TEMPORARY FEATURE FREEZE on the web
 * client's AUTHENTICATED area — no production database is touched.
 *
 *   1. Boots the REAL backend (server.js) on an in-memory MongoDB at :3000.
 *   2. Creates an admin + student (password login) through the models.
 *   3. Logs in over the real API and drives headless Edge with the session
 *      token against the real web client:
 *
 *        /dashboard, /users, /groups, /groups/:id  -> Coming Soon state
 *        sidebar: Dashboard/Groups/Users disabled, Tests active
 *        /quizzes + /quizzes/question-bank         -> live quiz screens
 *        history back/forward                      -> still gated
 *
 * Usage:  node scripts/verifyFeatureFreezeWebAuthed.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const { MongoMemoryServer } = require('mongodb-memory-server');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const WEB = process.env.VERIFY_WEB_ORIGIN || 'http://localhost:5173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

let allOk = true;
const check = (ok, label, extra = '') => {
  allOk = allOk && ok;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
};

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('eyeconic-freeze-authed');
  process.env.PORT = '3000';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'verify-freeze-authed-secret';
  const BASE = 'http://localhost:3000';

  console.log('=== Booting real server.js (in-memory DB, port 3000) ===');
  const { server } = require('../server');
  await new Promise((resolve) => server.listen(3000, resolve));
  const mongoose = require('mongoose');
  while (mongoose.connection.readyState !== 1) await sleep(200);

  const User = require('../models/User');
  const stamp = Date.now();
  const admin = await User.create({ name: 'Authed Admin', email: `authed-admin-${stamp}@example.com`, password: 'password123', role: 'admin' });

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: 'password123' }),
  });
  const { token } = await loginRes.json();
  check(loginRes.status === 200 && Boolean(token), 'admin login via API');

  // puppeteer-core is a client-side harness dependency (client/scripts uses it).
  const puppeteer = require(require('path').join(
    __dirname, '..', '..', 'client', 'node_modules', 'puppeteer-core'
  ));
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 900 },
  });
  const page = await browser.newPage();
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle2' });
  await page.evaluate((t) => localStorage.setItem('userToken', t), token);

  const comingSoonOn = async (path, label) => {
    await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle2' });
    await sleep(800); // AuthContext boot + page render
    const body = await page.evaluate(() => document.body.innerText);
    check(body.includes('Coming Soon') && body.includes('temporarily unavailable'), label, path);
    return body;
  };

  console.log('\n=== Frozen pages render the Coming Soon state (direct URL) ===');
  await comingSoonOn('/dashboard', 'GET /dashboard shows Coming Soon');
  await comingSoonOn('/users', 'GET /users shows Coming Soon');
  await comingSoonOn('/groups', 'GET /groups shows Coming Soon');
  await comingSoonOn('/groups/000000000000000000000000', 'GET /groups/:id (deep link) shows Coming Soon');

  console.log('\n=== Quiz pages stay live ===');
  await page.goto(`${WEB}/quizzes`, { waitUntil: 'networkidle2' });
  await sleep(1000);
  let body = await page.evaluate(() => document.body.innerText);
  check(!body.includes('Coming Soon') && /question bank|create|analytics|retest/i.test(body), 'GET /quizzes renders the live Quiz Hub', body.split('\n')[0]);

  await page.goto(`${WEB}/quizzes/question-bank`, { waitUntil: 'networkidle2' });
  await sleep(1000);
  body = await page.evaluate(() => document.body.innerText);
  check(!body.includes('Coming Soon') && /question bank/i.test(body), 'GET /quizzes/question-bank renders live');

  console.log('\n=== Sidebar: disabled items visible but not clickable, Tests active ===');
  const sidebar = await page.evaluate(() => {
    const items = [...document.querySelectorAll('aside nav > a, aside nav > div[aria-disabled="true"]')];
    return items.map((el) => ({
      text: el.textContent.trim().replace(/Soon/gi, '').trim(),
      disabled: el.getAttribute('aria-disabled') === 'true',
      isLink: el.tagName === 'A',
    }));
  });
  const byName = (n) => sidebar.find((s) => s.text.toLowerCase().includes(n));
  check(byName('dashboard')?.disabled === true && byName('dashboard')?.isLink === false, 'sidebar Dashboard disabled (not a link)');
  check(byName('groups')?.disabled === true && byName('groups')?.isLink === false, 'sidebar Groups disabled (not a link)');
  check(byName('users')?.disabled === true && byName('users')?.isLink === false, 'sidebar Users disabled (not a link)');
  check(byName('tests')?.disabled === false && byName('tests')?.isLink === true, 'sidebar Tests is an active link');

  console.log('\n=== Browser history navigation stays gated ===');
  await page.goto(`${WEB}/groups`, { waitUntil: 'networkidle2' });
  await sleep(500);
  await page.goto(`${WEB}/quizzes`, { waitUntil: 'networkidle2' });
  await sleep(500);
  await page.goBack({ waitUntil: 'networkidle2' }); // back to /groups
  await sleep(800);
  body = await page.evaluate(() => document.body.innerText);
  check(body.includes('Coming Soon'), 'history back to /groups still shows Coming Soon');
  await page.goForward({ waitUntil: 'networkidle2' }); // forward to /quizzes
  await sleep(800);
  body = await page.evaluate(() => document.body.innerText);
  check(!body.includes('Coming Soon'), 'history forward to /quizzes renders live Quiz Hub');

  await page.screenshot({ path: `${require('os').tmpdir()}/eyeconic-freeze-authed.png` });

  await browser.close();
  console.log(`\n${allOk ? '=== ALL CHECKS PASSED ===' : '=== FAILURES PRESENT ==='}`);
  server.close();
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(allOk ? 0 : 1);
})().catch(async (err) => {
  console.error('Harness failed:', err);
  process.exit(1);
});
