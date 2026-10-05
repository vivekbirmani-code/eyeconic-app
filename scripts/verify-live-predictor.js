/**
 * End-to-end verification of the Rank & Branch Predictor app integration
 * (Phase 5 — Desired Branch Predictor): boots the REAL app backend AND the
 * REAL eyeconic-main website server in one node process, each on its own
 * in-memory Mongo, with the website's APP_API_BASE_URL pointed at the live
 * backend — exactly the production topology (the app calls the website
 * server's /api/predictor with a Bearer App JWT; the website verifies it
 * against the backend's /auth/me, and /gts proxies the backend's analytics).
 *
 * Driven over real HTTP, as the app's services/predictor.ts would:
 *   1. GET  /exams            (Bearer) — exam list + pattern echo
 *   2. GET  /gts              (Bearer) — auto-fill contract
 *   3. GET  /branches?exam=   (Bearer) — the catalog the branch picker lists
 *   4. POST /desired-branch   (Bearer, no GTs) — target + required corrects,
 *      no gap stage (the "target-only" run)
 *   5. POST /desired-branch   (Bearer, self-reported GTs) — gap populated
 *   6. POST /desired-branch   (Bearer, unknown branch) — UNKNOWN_BRANCH +
 *      near-miss suggestions
 *
 * Run from the repo root:  node scripts/verify-live-predictor.js
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'predictor-verify-app-secret';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const WEBSITE = path.resolve(ROOT, '..', 'eyeconic-main', 'server');

const log = (...args) => console.log('[verify]', ...args);
let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

async function main() {
  // ---- Boot the app backend (in-memory Mongo #1) --------------------------------
  const { MongoMemoryServer: BackendMongo } = require(path.join(
    BACKEND, 'node_modules', 'mongodb-memory-server'
  ));
  const backendMongo = await BackendMongo.create();
  process.env.MONGODB_URI = backendMongo.getUri();

  // Require the real server AFTER env is pinned — dotenv never overrides
  // existing env vars, so the production Atlas URI in backend/.env is inert.
  const { server: backendServer } = require(path.join(BACKEND, 'server.js'));
  await new Promise((resolve) => backendServer.listen(0, resolve));
  const backendPort = backendServer.address().port;
  log('backend listening on', backendPort);

  const User = require(path.join(BACKEND, 'models', 'User'));
  const jwt = require(path.join(BACKEND, 'node_modules', 'jsonwebtoken'));
  const student = await User.create({
    name: 'Predictor Verify',
    email: `predictor-${Date.now()}@verify.test`,
    password: 'password123',
    role: 'student',
  });
  const studentToken = jwt.sign({ userId: student._id.toString() }, process.env.JWT_SECRET);

  // ---- Boot the website server (in-memory Mongo #2, App API = live backend) -----
  const { MongoMemoryServer: WebsiteMongo } = require(path.join(
    WEBSITE, 'node_modules', 'mongodb-memory-server'
  ));
  const websiteMongo = await WebsiteMongo.create();
  process.env.MONGO_URI = websiteMongo.getUri();
  process.env.SESSION_SECRET = 'p'.repeat(40);
  process.env.APP_API_BASE_URL = `http://127.0.0.1:${backendPort}/api`;
  process.env.APP_INTEGRATION_TOKEN = 'i'.repeat(43);
  process.env.APP_BEARER_FAIL_LIMIT = '0'; // never brake the verify client

  // The website's predictor persistence (re)connects via MONGO_URI — pre-open
  // the connection so require-time health checks pass (same order its own
  // predictorApi.test.js uses).
  const websiteMongoose = require(path.join(WEBSITE, 'node_modules', 'mongoose'));
  await websiteMongoose.connect(process.env.MONGO_URI);

  const websiteApp = require(path.join(WEBSITE, 'server.js'));
  const websiteServer = websiteApp.listen(0);
  await new Promise((resolve) => websiteServer.once('listening', resolve));
  const websitePort = websiteServer.address().port;
  log('website server listening on', websitePort);

  const predictorBase = `http://127.0.0.1:${websitePort}/api/predictor`;
  const call = async (method, urlPath, { token = studentToken, body } = {}) => {
    const response = await fetch(`${predictorBase}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { status: response.status, data };
  };

  try {
    // ---- 0. auth: no Bearer → 401 ------------------------------------------------
    const anon = await call('GET', '/exams', { token: null });
    check('exams without a token is refused (401)', anon.status === 401, anon.status);

    // ---- 1. exams -----------------------------------------------------------------
    const exams = await call('GET', '/exams');
    check('exams responds 200 over Bearer', exams.status === 200, exams.status);
    const neet = exams.data?.exams?.find((e) => e.id === 'NEET_PG');
    check('NEET PG listed and available', Boolean(neet?.available), neet);
    check(
      'NEET PG pattern echo (UI input bounds)',
      neet?.pattern?.totalQuestions === 180,
      neet?.pattern
    );

    // ---- 2. gts (auto-fill contract through the live backend) --------------------
    const gts = await call('GET', '/gts');
    check('gts responds 200 over Bearer', gts.status === 200, gts.status);
    check('gts payload carries the auto-fill arrays', Array.isArray(gts.data?.gts), gts.data);

    // ---- 3. branch catalog ---------------------------------------------------------
    const catalog = await call('GET', '/branches?exam=NEET_PG');
    check('branch catalog responds 200', catalog.status === 200, catalog.status);
    const entries = catalog.data?.branches ?? [];
    check('catalog lists branches for the picker', entries.length > 0, catalog.data);
    check(
      'catalog entries carry key/display/perYear (picker + context line)',
      entries.every((b) => typeof b.key === 'string' && typeof b.display === 'string' && b.perYear),
      entries[0]
    );

    // ---- 4. desired-branch, target-only (no GTs) -----------------------------------
    // Pick an entry that actually had allotments (groups > 0) under UR.
    const withData = entries.filter((b) =>
      Object.values(b.perYear ?? {}).some((y) => y.groups > 0)
    );
    const branchKey = (withData[0] ?? entries[0]).key;
    log('using branch', branchKey);

    const targetOnly = await call('POST', '/desired-branch', {
      body: { exam: 'NEET_PG', branchKey, category: 'UR' },
    });
    // Persist-before-serve: success is 201 (the lookup is stored first).
    check('desired-branch (no GTs) responds 201', targetOnly.status === 201, targetOnly.status);
    const r1 = targetOnly.data?.result;
    check('response is persisted with an id', Boolean(targetOnly.data?.desiredBranchId) && targetOnly.data?.persisted === true, {
      desiredBranchId: targetOnly.data?.desiredBranchId,
      persisted: targetOnly.data?.persisted,
    });
    check('target stage resolved', r1?.target?.stage === 'TARGET_RANK', r1?.target?.stage);
    check(
      'target rank range is a pair of numbers',
      Array.isArray(r1?.target?.targetRankRange) &&
        r1.target.targetRankRange.length === 2 &&
        r1.target.targetRankRange.every((n) => typeof n === 'number'),
      r1?.target?.targetRankRange
    );
    check(
      'required corrects resolved with per-closing entries',
      Array.isArray(r1?.required?.perClosing) && r1.required.perClosing.length >= 1,
      r1?.required
    );
    check(
      'no current stage without GTs; gap says NO_CURRENT_DATA',
      r1?.current == null && r1?.gap?.status === 'NO_CURRENT_DATA',
      { current: r1?.current, gapStatus: r1?.gap?.status }
    );

    // ---- 5. desired-branch with self-reported GTs (gap stage) ---------------------
    const withGts = await call('POST', '/desired-branch', {
      body: {
        exam: 'NEET_PG',
        branchKey,
        category: 'UR',
        gts: [{ provenance: 'self-reported', attempts: [{ corrects: 150, status: 'completed' }] }],
      },
    });
    check('desired-branch (with GTs) responds 201', withGts.status === 201, withGts.status);
    const r2 = withGts.data?.result;
    check('current stage echoes the one GT', r2?.current?.aggregation?.n === 1, r2?.current?.aggregation);
    check('gap stage present with a known status', Boolean(r2?.gap) && typeof r2?.gap?.status === 'string', r2?.gap);

    // ---- 6. UNKNOWN_BRANCH near-misses --------------------------------------------
    const unknown = await call('POST', '/desired-branch', {
      body: { exam: 'NEET_PG', branchKey: 'not-a-real-branch', category: 'UR' },
    });
    check('unknown branch is a 400', unknown.status === 400, unknown.status);
    check(
      'UNKNOWN_BRANCH error carries suggestions',
      unknown.data?.code === 'UNKNOWN_BRANCH' && Array.isArray(unknown.data?.suggestions),
      unknown.data
    );
  } finally {
    await new Promise((resolve) => websiteServer.close(resolve));
    await websiteMongoose.connection.dropDatabase().catch(() => {});
    await websiteMongoose.connection.close().catch(() => {});
    if (websiteMongo) await websiteMongo.stop().catch(() => {});
    await new Promise((resolve) => backendServer.close(resolve));
    if (backendMongo) await backendMongo.stop().catch(() => {});
  }

  if (failures > 0) {
    console.error(`\n[verify] FAILED — ${failures} check(s) did not pass.`);
    process.exit(1);
  }
  log('all checks passed');
  process.exit(0);
}

main().catch((error) => {
  console.error('[verify] crashed:', error);
  process.exit(1);
});
