/**
 * End-to-end verification of the Intern Mode flow against the REAL backend
 * (server.js — real mounting, real auth middleware, real feature gate) with
 * an in-memory Mongo. Mirrors exactly what the app screens call:
 *
 *   1.  Mentor opens the scope pickers        -> GET  /intern/catalog/summary
 *   2.  Student is a normal student           -> GET  /intern/me (isIntern false)
 *   3.  Student cannot use the slicer yet     -> POST /intern/time (403)
 *   4.  Student cannot configure              -> PUT  /intern/config/:id (403)
 *   5.  Mentor saves a bad subject            -> 400
 *   6.  Mentor toggles intern ON with scope   -> PUT  /intern/config/:id
 *       (two sources, each with its own subjects)
 *   7.  Student status now intern             -> GET  /intern/me
 *   8.  Student sets 105 min                  -> POST /intern/time (strict stop)
 *   9.  Student marks video 1 watched         -> POST /intern/tasks/:id/watched
 *   10. Same-day re-choose 90 min             -> POST /intern/time (carry-over
 *       starts at first unwatched; watched task never re-planned)
 *   11. Zero-fit day                          -> POST /intern/time 30 (reason)
 *   12. Task list with today plan             -> GET  /intern/tasks
 *   13. Another intern cannot watch my task   -> POST watched (404)
 *   14. Slicer step validation                -> POST /intern/time 37 (400)
 *   15. Mentor overview shows today + progress-> GET  /intern/students
 *   16. Mentor config view shows today entry  -> GET  /intern/config/:id
 *   17. Toggle OFF hides the slicer           -> PUT config off; GET /me
 *   18. Off-intern task list rejected         -> GET /intern/tasks (403)
 *
 * Run from the repo root:  node scripts/verify-intern-flow.js
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'intern-flow-verify-secret';

const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');

let server;
let baseURL;
let passed = 0;
let failed = 0;

const log = (...args) => console.log('[verify]', ...args);

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  }
}

function requireBackend(modulePath) {
  return require(path.join(BACKEND, modulePath));
}

function api(method, urlPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath.replace(/^\//, ''), baseURL);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const { MongoMemoryServer } = require(path.join(BACKEND, 'node_modules', 'mongodb-memory-server'));
  const mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  log('in-memory mongo at', process.env.MONGODB_URI);

  const { server: httpServer } = requireBackend('server');
  server = httpServer;
  await new Promise((resolve) => server.listen(0, resolve));
  baseURL = `http://127.0.0.1:${server.address().port}/api/`;
  log('backend listening on', server.address().port);

  const jwt = require(path.join(BACKEND, 'node_modules', 'jsonwebtoken'));
  const User = requireBackend('models/User');
  const VideoCatalogItem = requireBackend('models/VideoCatalogItem');

  // ---- Seed: users + a compact catalog (sheet order = sheetRow) ----
  const mentor = await User.create({ name: 'V Mentor', email: `m-${Date.now()}@v.test`, password: 'password123', role: 'mentor' });
  const student = await User.create({ name: 'V Intern', email: `s-${Date.now()}@v.test`, password: 'password123', role: 'student' });
  const otherIntern = await User.create({ name: 'V Other', email: `o-${Date.now()}@v.test`, password: 'password123', role: 'student' });
  const tokenOf = (u) => jwt.sign({ userId: u._id.toString() }, process.env.JWT_SECRET);

  const rows = [
    { sheetRow: 2, source: 'MARROW', sourceKey: 'marrow', subject: 'ANATOMY', type: 'Main Videos', title: 'GAMETOGENESIS', durationMin: 30 },
    { sheetRow: 3, source: 'MARROW', sourceKey: 'marrow', subject: 'ANATOMY', type: 'Main Videos', title: 'WEEKS OF DEV', durationMin: 45 },
    { sheetRow: 4, source: 'MARROW', sourceKey: 'marrow', subject: 'ANATOMY', type: 'Main Videos', title: 'HISTOLOGY 1', durationMin: 45 },
    { sheetRow: 5, source: 'MARROW', sourceKey: 'marrow', subject: 'ANATOMY', type: 'Main Videos', title: 'HISTOLOGY 2', durationMin: 50 },
    { sheetRow: 6, source: 'MARROW', sourceKey: 'marrow', subject: 'PHYSIOLOGY', type: 'Main Videos', title: 'HOMEOSTASIS', durationMin: 40 }, // out of scope
    { sheetRow: 7, source: 'PrepLadder', sourceKey: 'prepladder', subject: 'MEDICINE', type: 'MAIN VIDEOS', title: 'CARDIO INTRO', durationMin: 60 },
    { sheetRow: 8, source: 'PrepLadder', sourceKey: 'prepladder', subject: 'MEDICINE', type: 'MAIN VIDEOS', title: 'ECG BASICS', durationMin: 30 },
  ];
  await VideoCatalogItem.insertMany(rows.map((r) => ({ ...r, seriesKey: `${r.subject}${r.type}${r.source}`, dedupKey: `${r.subject}${r.type}${r.source}|${r.title}`, isActive: true })));

  const mTok = tokenOf(mentor);
  const sTok = tokenOf(student);
  const oTok = tokenOf(otherIntern);

  // 1. Catalog summary
  const summary = await api('GET', 'intern/catalog/summary', { token: mTok });
  const marrow = summary.body.sources.find((s) => s.sourceKey === 'marrow');
  check('1 mentor catalog summary', summary.status === 200 && marrow && marrow.videos === 5, `sources=${summary.body.sources.length}`);

  // 2. Student not an intern yet
  const me0 = await api('GET', 'intern/me', { token: sTok });
  check('2 student starts non-intern', me0.status === 200 && me0.body.isIntern === false);

  // 3. Slicer unavailable before toggle
  const t0 = await api('POST', 'intern/time', { token: sTok, body: { minutes: 60 } });
  check('3 slicer blocked for non-intern', t0.status === 403);

  // 4. Student cannot configure
  const c0 = await api('PUT', `intern/config/${student._id}`, { token: sTok, body: { isIntern: true, scope: [{ sourceKey: 'marrow', subjects: ['ANATOMY'] }] } });
  check('4 student cannot configure', c0.status === 403);

  // 5. Bad subject rejected
  const cBad = await api('PUT', `intern/config/${student._id}`, { token: mTok, body: { isIntern: true, scope: [{ sourceKey: 'marrow', subjects: ['SURGERY'] }] } });
  check('5 unknown subject rejected', cBad.status === 400, cBad.body.message);

  // 6. Mentor toggles ON with a multi-source scope
  const c1 = await api('PUT', `intern/config/${student._id}`, { token: mTok, body: { isIntern: true, scope: [
    { sourceKey: 'marrow', subjects: ['ANATOMY'] },
    { sourceKey: 'prepladder', subjects: ['MEDICINE'] },
  ] } });
  check('6 mentor configures intern scope', c1.status === 200 && c1.body.isIntern === true && c1.body.scope.length === 2);

  const oCfg = await api('PUT', `intern/config/${otherIntern._id}`, { token: mTok, body: { isIntern: true, scope: [{ sourceKey: 'marrow', subjects: ['ANATOMY'] }] } });
  check('6b second intern configured', oCfg.status === 200 && oCfg.body.isIntern === true);

  // 7. Student status
  const me1 = await api('GET', 'intern/me', { token: sTok });
  check('7 student sees intern status', me1.status === 200 && me1.body.isIntern === true && me1.body.scope.length === 2 && me1.body.today.plan.length === 0);

  // 8. First slicer use: 105 min, strict stop (30+45=75; next 45 would cross)
  const t1 = await api('POST', 'intern/time', { token: sTok, body: { minutes: 105 } });
  check('8 allocation strict stop', t1.status === 200 && t1.body.plan.length === 2 && t1.body.totalMinutes === 75 && t1.body.nextVideo && t1.body.nextVideo.title === 'HISTOLOGY 1', `plan=${t1.body.plan.length} total=${t1.body.totalMinutes}min`);

  // 9. Watch the first video (idempotent)
  const w1 = await api('POST', `intern/tasks/${t1.body.plan[0]._id}/watched`, { token: sTok });
  const w1b = await api('POST', `intern/tasks/${t1.body.plan[0]._id}/watched`, { token: sTok });
  check('9 mark watched idempotent', w1.status === 200 && w1.body.status === 'watched' && w1b.status === 200 && w1b.body.status === 'watched');

  // 10. Same-day re-choose 90: carry-over starts at first unwatched (45+45)
  const t2 = await api('POST', 'intern/time', { token: sTok, body: { minutes: 90 } });
  const t2Titles = t2.body.plan.map((p) => p.title);
  check('10 carry-over from first unwatched', t2.status === 200 && t2Titles.join(',') === 'WEEKS OF DEV,HISTOLOGY 1' && t2.body.totalMinutes === 90, t2Titles.join(','));

  // 11. Zero-fit day (first unwatched is WEEKS OF DEV, 45 min, budget 30)
  const t3 = await api('POST', 'intern/time', { token: sTok, body: { minutes: 30 } });
  check('11 zero-fit day reason', t3.status === 200 && t3.body.plan.length === 0 && t3.body.reason === 'NEXT_VIDEO_LONGER_THAN_TIME' && t3.body.nextVideo.durationMin === 45);

  // 12. Task list — 3 tasks were ever allotted (HISTOLOGY 2 never fit)
  const tasks = await api('GET', 'intern/tasks', { token: sTok });
  check('12 task list playlist order', tasks.status === 200 && tasks.body.tasks.length === 3 && tasks.body.tasks.map((x) => x.title).join(',') === 'GAMETOGENESIS,WEEKS OF DEV,HISTOLOGY 1' && tasks.body.today.minutes === 30, `${tasks.body.tasks.length} tasks`);

  // 13. Other intern cannot watch my task
  const steal = await api('POST', `intern/tasks/${tasks.body.tasks[1]._id}/watched`, { token: oTok });
  check('13 other intern blocked from my task', steal.status === 404);

  // 14. Step validation
  const bad = await api('POST', 'intern/time', { token: sTok, body: { minutes: 37 } });
  check('14 slicer step validation', bad.status === 400);

  // 15. Mentor overview
  const students = await api('GET', 'intern/students', { token: mTok });
  const row = students.body.interns.find((i) => i.studentId === student._id.toString());
  check('15 mentor overview', students.status === 200 && row && row.today && row.today.minutes === 30 && row.progress.watchedCount === 1 && row.progress.scopeVideos === 6, `interns=${students.body.interns.length}`);

  // 16. Mentor config view with today entry (3 tasks: 1 watched, 2 pending)
  const cfgView = await api('GET', `intern/config/${student._id}`, { token: mTok });
  check('16 config view has today', cfgView.status === 200 && cfgView.body.today && cfgView.body.today.minutes === 30 && cfgView.body.progress.pendingCount === 2 && cfgView.body.progress.scopeVideos === 6);

  // 17. Toggle OFF
  const off = await api('PUT', `intern/config/${student._id}`, { token: mTok, body: { isIntern: false } });
  const me2 = await api('GET', 'intern/me', { token: sTok });
  check('17 toggle off hides slicer', off.status === 200 && me2.status === 200 && me2.body.isIntern === false);

  // 18. Off-intern task list rejected
  const tasks2 = await api('GET', 'intern/tasks', { token: sTok });
  check('18 off-intern tasks blocked', tasks2.status === 403);

  log(`RESULT: ${passed} passed, ${failed} failed`);
  server.close();
  const mongoose = require(path.join(BACKEND, 'node_modules', 'mongoose'));
  await mongoose.disconnect();
  await mongoServer.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('VERIFY FAILED:', err);
  if (server) server.close();
  process.exit(1);
});
