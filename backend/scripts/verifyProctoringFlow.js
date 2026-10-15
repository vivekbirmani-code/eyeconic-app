/**
 * verifyProctoringFlow.js — end-to-end proctoring lifecycle verification
 * (plan §29.6, the Phase 6 demo artifact). Boots the REAL server.js on an
 * in-memory MongoDB and drives the full flow over HTTP:
 *
 *   precheck FAIL → retry PASS → consent → gated /start
 *   → double-start idempotency (one attempt + one session)
 *   → event batches (duplicate replay, out-of-order acceptance)
 *   → the complete D3 warning ladder (WARN ×3 → FINAL_WARN → policy
 *     auto-submit) → timeline + frozen-summary assertions
 *   → straggler batch rejection after finalize
 *   → duration-bypass attempt (late manual submit → auto_submitted)
 *   → timeline access control (unassigned mentor 403)
 *
 * Prints a PASS/FAIL report; exits non-zero on any failure. Family of
 * verifyPublicFlow.js / verify-live-leaderboard.js.
 *
 * Usage: node scripts/verifyProctoringFlow.js   (from backend/)
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'verify-proctoring-secret';
process.env.PORT = '3210';

const path = require('path');
const http = require('http');

const BACKEND = path.resolve(__dirname, '..');
const baseURL = `http://127.0.0.1:${process.env.PORT}`;

const log = (...args) => console.log('[verify]', ...args);
let passed = 0;
const failures = [];
const check = (label, condition, detail) => {
  if (condition) {
    passed += 1;
    log(`PASS ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

function api(method, urlPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      `${baseURL}${urlPath}`,
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
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  // In-memory Mongo, pinned BEFORE the server is required (the models read
  // MONGODB_URI at connect time).
  const { MongoMemoryServer } = require(path.join(BACKEND, 'node_modules', 'mongodb-memory-server'));
  const mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  // The rollout precedence requires the staged-rollout flag ON (§31); flip it
  // in-process exactly like the test suites' mock — no file is modified.
  const features = require(path.join(BACKEND, 'config/featureAvailability'));
  features.FEATURE_AVAILABILITY.aiProctoring = true;

  const { server } = require(path.join(BACKEND, 'server'));
  await new Promise((resolve) => server.listen(Number(process.env.PORT), resolve));
  log(`real server.js on :${process.env.PORT} (in-memory Mongo)`);

  const User = require(path.join(BACKEND, 'models/User'));
  const Subject = require(path.join(BACKEND, 'models/Subject'));
  const QuestionBank = require(path.join(BACKEND, 'models/QuestionBank'));
  const Quiz = require(path.join(BACKEND, 'models/Quiz'));
  const QuizAttempt = require(path.join(BACKEND, 'models/QuizAttempt'));
  const MentorStudentAssignment = require(path.join(BACKEND, 'models/MentorStudentAssignment'));
  const ProctoringSession = require(path.join(BACKEND, 'models/ProctoringSession'));
  const ProctoringEvent = require(path.join(BACKEND, 'models/ProctoringEvent'));
  const ProctoringViolation = require(path.join(BACKEND, 'models/ProctoringViolation'));
  const { setProctoringEnabled } = require(path.join(BACKEND, 'utils/appSettings'));
  const jwt = require(path.join(BACKEND, 'node_modules', 'jsonwebtoken'));

  // ---- Seed ----
  const subject = await Subject.create({ name: 'Verify Proctoring', year: '1st', displayOrder: 1 });
  const questions = [];
  for (let i = 0; i < 3; i += 1) {
    questions.push(await QuestionBank.create({
      subject: subject._id, topicName: 'Genetics', subtopicName: 'Mendelian',
      system: 'Disorders', questionType: 'mcq_single', difficulty: 'medium',
      question: `Verify Q${i + 1}?`, options: ['A', 'B', 'C', 'D'], correctAnswer: 1,
    }));
  }
  const admin = await User.create({ name: 'V Admin', email: 'vadmin@run.test', password: 'Vpassw0rd23', role: 'admin' });
  const student = await User.create({ name: 'V Student', email: 'vstudent@run.test', password: 'Vpassw0rd23', role: 'student' });
  const lateStudent = await User.create({ name: 'V Late', email: 'vlate@run.test', password: 'Vpassw0rd23', role: 'student' });
  const mentor = await User.create({ name: 'V Mentor', email: 'vmentor@run.test', password: 'Vpassw0rd23', role: 'mentor' });
  await MentorStudentAssignment.create({
    mentor: mentor._id, student: student._id, isActive: true, assignedBy: admin._id,
  });
  const quiz = await Quiz.create({
    title: 'Verify Proctoring Flow Quiz', subject: subject._id, testType: 'daily', duration: 20,
    questions: questions.map((q) => q._id), positiveMarks: 4, negativeMarks: 1,
    assignedStudents: [student._id, lateStudent._id], createdBy: admin._id,
    proctoring: { enabled: true },
  });
  await setProctoringEnabled(true, admin._id);

  const tokenFor = (user) => jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET);
  const studentToken = tokenFor(student);
  const lateToken = tokenFor(lateStudent);
  const adminToken = tokenFor(admin);
  const mentorToken = tokenFor(mentor);
  log('seeded users + proctored quiz, kill switch ON');

  // ---- 1. Precheck: FAIL first, then PASS ----
  const health = await api('GET', '/api/health');
  check('health endpoint responds', health.status === 200);

  const badReport = await api('POST', `/api/quizzes/${quiz._id}/proctoring/precheck-report`, {
    token: studentToken,
    body: {
      device: { platform: 'android', osVersion: 33 },
      network: { reachable: true, authedPingMs: 120 },
      checks: [
        { id: 'device_capability', status: 'PASS' },
        { id: 'camera_permission', status: 'FAIL' },
        { id: 'camera_availability', status: 'PASS' },
        { id: 'face_readiness', status: 'PASS', metadata: { frames: 5, agreedFrames: 5, faceCountClass: 'one', visibility: 'ok' } },
        { id: 'network', status: 'PASS' },
      ],
    },
  });
  check('failed precheck returns a non-PASS verdict', badReport.status === 200 && badReport.body.verdict !== 'PASS',
    JSON.stringify(badReport.body));

  const passReportBody = {
    device: { platform: 'android', osVersion: 33 },
    network: { reachable: true, authedPingMs: 120 },
    checks: [
      { id: 'device_capability', status: 'PASS' },
      { id: 'camera_permission', status: 'PASS' },
      { id: 'camera_availability', status: 'PASS' },
      { id: 'face_readiness', status: 'PASS', metadata: { frames: 5, agreedFrames: 5, faceCountClass: 'one', visibility: 'ok' } },
      { id: 'network', status: 'PASS' },
    ],
  };
  const report = await api('POST', `/api/quizzes/${quiz._id}/proctoring/precheck-report`, {
    token: studentToken, body: passReportBody,
  });
  check('passing precheck issues a token', report.status === 200 && report.body.verdict === 'PASS' && !!report.body.precheckToken);

  // ---- 2. /start refuses without consent, then works ----
  const ungated = await api('POST', `/api/quizzes/${quiz._id}/start`, {
    token: studentToken, body: { precheckToken: report.body.precheckToken },
  });
  check('start refused without consent (403)',
    ungated.status === 403
    && (ungated.body.errorCode === 'PROCTORING_CONSENT_REQUIRED' || ungated.body.code === 'PROCTORING_CONSENT_REQUIRED'),
    JSON.stringify(ungated.body));

  const consent = await api('POST', `/api/quizzes/${quiz._id}/proctoring/consent`, {
    token: studentToken,
    body: { precheckToken: report.body.precheckToken, consentTextVersion: '2026-09-v1', surface: 'app-android' },
  });
  check('consent recorded', consent.status === 200);

  const start = await api('POST', `/api/quizzes/${quiz._id}/start`, {
    token: studentToken, body: { precheckToken: report.body.precheckToken },
  });
  check('gated start creates attempt + session', start.status === 201 && !!start.body.attemptId && !!start.body.proctoringSessionId,
    JSON.stringify(start.body));
  const attemptId = start.body.attemptId;
  const sessionId = start.body.proctoringSessionId;

  const doubleStart = await api('POST', `/api/quizzes/${quiz._id}/start`, {
    token: studentToken, body: { precheckToken: report.body.precheckToken },
  });
  // A duplicate /start resumes the in-flight attempt (200) or re-creates
  // idempotently (201) — either way the SAME attempt + session come back.
  check('double-start is idempotent (same attempt + session)',
    (doubleStart.status === 200 || doubleStart.status === 201)
    && doubleStart.body.attemptId === attemptId
    && doubleStart.body.proctoringSessionId === sessionId,
    `${doubleStart.status} ${JSON.stringify({
      attemptId: doubleStart.body.attemptId, proctoringSessionId: doubleStart.body.proctoringSessionId,
    })}`);
  check('exactly one attempt + one session exist',
    (await QuizAttempt.countDocuments({})) === 1 && (await ProctoringSession.countDocuments({})) === 1);

  // ---- 3. Event transport: ingest, replay, out-of-order ----
  const postEvents = (events, extra = {}) => api('POST', `/api/quizzes/${quiz._id}/attempt/${attemptId}/proctoring/events`, {
    token: studentToken, body: { sessionId, heartbeat: true, events, ...extra },
  });

  const sessionStart = {
    type: 'SESSION_STARTED', source: 'system',
    openedAt: Date.now(), closedAt: Date.now(), idempotencyKey: 'ss-1', clientSeq: 0,
    metadata: { detectorTier: 'headpose', screenCapturePrevention: 'android-flagsecure' },
  };
  const started1 = await postEvents([sessionStart]);
  check('SESSION_STARTED accepted', started1.status === 200 && started1.body.accepted === 1);

  const replay = await postEvents([sessionStart]);
  check('replayed batch is a duplicate no-op', replay.status === 200 && replay.body.accepted === 0 && !replay.body.actions);

  const blip = await postEvents([{
    type: 'APP_BACKGROUND', source: 'os',
    openedAt: Date.now() - 30_000, closedAt: Date.now() - 29_000,
    idempotencyKey: 'blip-1', clientSeq: 1, metadata: { pattern: 'single' },
  }]);
  check('sub-floor blip never warns', blip.status === 200 && !blip.body.actions);

  // ---- 4. The D3 ladder ----
  const focusEpisode = (i) => ({
    type: 'APP_BACKGROUND', source: 'os',
    openedAt: Date.now() - 200_000 + i * 2000,
    closedAt: Date.now() - 185_000 + i * 2000,
    idempotencyKey: `vf-focus-${i}`, clientSeq: 10 + i, metadata: { pattern: 'single' },
  });

  for (let i = 0; i < 3; i += 1) {
    const res = await postEvents([focusEpisode(i)]);
    check(`ladder step ${i + 1}: WARN delivered in batch response`,
      res.status === 200 && res.body.actions?.length === 1 && res.body.actions[0].kind === 'WARN'
      && res.body.actions[0].code === 'warn.focus',
      JSON.stringify(res.body.actions));
  }

  const fourth = await postEvents([focusEpisode(3)]);
  check('ladder step 4: FINAL_WARN (attempt still live)',
    fourth.status === 200 && fourth.body.actions?.[0]?.kind === 'FINAL_WARN'
    && !fourth.body.attemptFinalized,
    JSON.stringify(fourth.body.actions));

  const warningsStored = await ProctoringEvent.countDocuments({ session: sessionId, type: 'WARNING_DELIVERED' });
  check('4 WARNING_DELIVERED system events stored (deduped by warnId)', warningsStored === 4, `got ${warningsStored}`);

  const terminal = await postEvents([focusEpisode(4)]);
  check('ladder step 5: server-executed policy auto-submit',
    terminal.status === 200 && terminal.body.attemptFinalized === true && terminal.body.autoSubmitted === true
    && terminal.body.session.status === 'CLOSED',
    JSON.stringify(terminal.body));

  const attempt = await QuizAttempt.findById(attemptId);
  check('attempt is auto_submitted with the policy reason',
    attempt.status === 'auto_submitted'
    && attempt.autoSubmitReason?.kind === 'policy'
    && attempt.autoSubmitReason?.ruleId === 'focus.maxViolations');

  const session = await ProctoringSession.findById(sessionId);
  check('session CLOSED with a frozen summary',
    session.status === 'CLOSED' && session.summary?.violationCount === 5
    && session.riskCategory !== undefined,
    JSON.stringify(session.summary ?? null));
  check('violations replay-safe (exactly 5 rows, unique derivation keys)',
    (await ProctoringViolation.countDocuments({ session: sessionId })) === 5);
  check('deterrence stamped from SESSION_STARTED metadata',
    session.deterrence?.screenCapturePrevention === 'android-flagsecure');

  const autoEvent = await ProctoringEvent.findOne({ session: sessionId, type: 'AUTO_SUBMITTED' });
  check('AUTO_SUBMITTED terminal marker stored', !!autoEvent && autoEvent.metadata?.ruleId === 'focus.maxViolations');

  // ---- 5. Straggler batch after finalize ----
  const straggler = await postEvents([focusEpisode(99)]);
  check('straggler batch rejected after finalize', straggler.status === 409 && straggler.body.code === 'SESSION_NOT_ACTIVE');

  // ---- 6. Timeline (admin + assigned mentor + access control) ----
  const timeline = await api('GET', `/api/quizzes/attempt/${attemptId}/proctoring/timeline`, { token: adminToken });
  const tl = timeline.body?.timeline;
  check('admin timeline returns ordered rows + violations + summary',
    timeline.status === 200 && Array.isArray(tl?.events) && tl.events.length >= 12
    && tl.violations.length === 5 && tl.summary.violationCount === 5
    && tl.autoSubmitReason?.kind === 'policy',
    `events=${tl?.events?.length} violations=${tl?.violations?.length}`);

  const asMentor = await api('GET', `/api/quizzes/attempt/${attemptId}/proctoring/timeline`, { token: mentorToken });
  check('assigned mentor can read the timeline', asMentor.status === 200);

  const stranger = await User.create({ name: 'V Stranger', email: 'vstranger@run.test', password: 'Vpassw0rd23', role: 'mentor' });
  const asStranger = await api('GET', `/api/quizzes/attempt/${attemptId}/proctoring/timeline`, { token: tokenFor(stranger) });
  check('unassigned mentor refused (403)', asStranger.status === 403);

  // ---- 7. Duration bypass (§7.5 regression inside the full flow) ----
  const latePrecheck = await api('POST', `/api/quizzes/${quiz._id}/proctoring/precheck-report`, {
    token: lateToken, body: passReportBody,
  });
  await api('POST', `/api/quizzes/${quiz._id}/proctoring/consent`, {
    token: lateToken,
    body: { precheckToken: latePrecheck.body.precheckToken, consentTextVersion: '2026-09-v1', surface: 'app-android' },
  });
  const lateStart = await api('POST', `/api/quizzes/${quiz._id}/start`, {
    token: lateToken, body: { precheckToken: latePrecheck.body.precheckToken },
  });
  const lateAttemptId = lateStart.body.attemptId;
  // Simulate a manipulated client: the deadline passed long ago.
  await QuizAttempt.updateOne({ _id: lateAttemptId }, { $set: { durationDeadline: new Date(Date.now() - 600_000) } });
  const lateSubmit = await api('POST', `/api/quizzes/${quiz._id}/attempt/${lateAttemptId}/submit`, {
    token: lateToken, body: { isAutoSubmit: false },
  });
  const lateAttempt = await QuizAttempt.findById(lateAttemptId);
  check('late manual submit finalized auto_submitted (client timing cannot bypass)',
    lateSubmit.status === 200 && lateAttempt.status === 'auto_submitted'
    && lateAttempt.autoSubmitReason?.kind === 'duration',
    `${lateSubmit.status} ${lateAttempt.status}`);

  // ---- 8. Phase 5: attention baseline round-trip + record-only guarantee ----
  const attStudent = await User.create({ name: 'V Attention', email: 'vattention@run.test', password: 'Vpassw0rd23', role: 'student' });
  await Quiz.updateOne({ _id: quiz._id }, { $addToSet: { assignedStudents: attStudent._id } });
  const attToken = tokenFor(attStudent);

  const BASELINE = { yaw: 7.2, pitch: -3.4, roll: 1.1, frames: 4 };
  const baselineReport = {
    device: { platform: 'android', osVersion: 33 },
    network: { reachable: true, authedPingMs: 120 },
    checks: [
      { id: 'device_capability', status: 'PASS' },
      { id: 'camera_permission', status: 'PASS' },
      { id: 'camera_availability', status: 'PASS' },
      {
        id: 'face_readiness', status: 'PASS',
        metadata: { frames: 5, agreedFrames: 4, faceCountClass: 'one', visibility: 'ok', attentionBaseline: BASELINE },
      },
      { id: 'network', status: 'PASS' },
    ],
  };
  const badBaselineReport = {
    ...baselineReport,
    checks: baselineReport.checks.map((c) => (
      c.id === 'face_readiness'
        ? { ...c, metadata: { ...c.metadata, attentionBaseline: { yaw: 400, pitch: 0, roll: 0, frames: 4 } } }
        : c
    )),
  };
  const malformed = await api('POST', `/api/quizzes/${quiz._id}/proctoring/precheck-report`, {
    token: attToken, body: badBaselineReport,
  });
  check('malformed baseline rejects the report (400)', malformed.status === 400,
    `${malformed.status} ${JSON.stringify(malformed.body?.message)}`);

  const attPre = await api('POST', `/api/quizzes/${quiz._id}/proctoring/precheck-report`, {
    token: attToken, body: baselineReport,
  });
  check('precheck with a valid baseline passes', attPre.status === 200 && attPre.body.verdict === 'PASS');
  await api('POST', `/api/quizzes/${quiz._id}/proctoring/consent`, {
    token: attToken,
    body: { precheckToken: attPre.body.precheckToken, consentTextVersion: '2026-09-v1', surface: 'app-android' },
  });
  const attStart = await api('POST', `/api/quizzes/${quiz._id}/start`, {
    token: attToken, body: { precheckToken: attPre.body.precheckToken },
  });
  check('/start response carries the frozen attention baseline + Phase 5 thresholds',
    attStart.status === 201
    && attStart.body.proctoringAttentionBaseline?.calibration === 'captured'
    && attStart.body.proctoringAttentionBaseline?.yaw === 7.2
    && attStart.body.proctoringPolicy?.attention?.thresholds?.deviation?.deg === 35,
    JSON.stringify(attStart.body?.proctoringAttentionBaseline));

  const attSession = await ProctoringSession.findById(attStart.body.proctoringSessionId);
  check('session doc froze the baseline (D11)',
    attSession?.baseline?.nominalHeadPose?.yaw === 7.2 && attSession?.baseline?.calibration === 'captured');

  const attResync = await api('GET', `/api/quizzes/attempt/${attStart.body.attemptId}/proctoring/session`, { token: attToken });
  check('resync endpoint re-serves the baseline (app-restart path)',
    attResync.status === 200 && attResync.body.proctoringAttentionBaseline?.yaw === 7.2
    && attResync.body.policy?.attention?.mode === 'record');

  // All four record-only types through the REAL ingest path: never any
  // action, violation, risk or finalize — D6 end-to-end (Phase 5 AC 4).
  const attAttemptId = attStart.body.attemptId;
  const attSessionId = attStart.body.proctoringSessionId;
  const postAttEvents = (events) => api('POST', `/api/quizzes/${quiz._id}/attempt/${attAttemptId}/proctoring/events`, {
    token: attToken, body: { sessionId: attSessionId, heartbeat: true, events },
  });
  const attentionEvent = (type, i) => ({
    type, source: 'cv',
    openedAt: Date.now() - 60_000 + i * 3000,
    closedAt: Date.now() - 60_000 + i * 3000 + 8000,
    confidence: 0.82,
    idempotencyKey: `vf-att-${type}-${i}`, clientSeq: i,
    metadata: { basis: 'head_pose', calibration: 'captured', durationMs: 8000 },
  });
  const attentionTypes = ['HEAD_POSE_EXTREME', 'HEAD_POSE_REPEATED', 'ATTENTION_DEVIATION_SUSTAINED', 'ATTENTION_DEVIATION_REPEATED'];
  const firstAttBatch = attentionTypes.map((type, i) => attentionEvent(type, i));
  const attIngest = await postAttEvents(firstAttBatch);
  check('all four attention types ingest with ZERO actions',
    attIngest.status === 200 && attIngest.body.accepted === 4 && !attIngest.body.actions
    && attIngest.body.attemptFinalized === undefined,
    JSON.stringify(attIngest.body?.actions));
  for (let round = 1; round <= 5; round += 1) {
    const flood = await postAttEvents(attentionTypes.map((type, i) => attentionEvent(type, round * 10 + i)));
    if (flood.status !== 200 || flood.body.actions || flood.body.attemptFinalized !== undefined) {
      check(`attention flood round ${round} stays inert`, false, JSON.stringify(flood.body?.actions));
    }
  }
  check('attention floods beyond every threshold stay inert (D6)',
    (await ProctoringViolation.countDocuments({ session: attSessionId })) === 0);
  const attSessionAfter = await ProctoringSession.findById(attSessionId);
  const attAttemptAfter = await QuizAttempt.findById(attAttemptId);
  check('attention events add zero risk and never finalize',
    attSessionAfter.riskScore === 0 && attAttemptAfter.status === 'in_progress');
  const attReplay = await postAttEvents(firstAttBatch);
  check('attention replays are duplicate no-ops',
    attReplay.status === 200 && attReplay.body.accepted === 0 && attReplay.body.duplicates?.length === 4);

  // Policy authoring: thresholds accepted, escalation still impossible (D6).
  const thresholdUpdate = await api('PUT', `/api/quizzes/${quiz._id}`, {
    token: adminToken,
    body: { proctoring: { enabled: true, attention: { mode: 'record', thresholds: { deviation: { deg: 20 } } } } },
  });
  check('quiz authoring accepts attention thresholds (shaping only)',
    thresholdUpdate.status === 200
    && thresholdUpdate.body.quiz?.proctoring?.attention?.thresholds?.deviation?.deg === 20,
    `${thresholdUpdate.status}`);
  const escalationUpdate = await api('PUT', `/api/quizzes/${quiz._id}`, {
    token: adminToken,
    body: { proctoring: { enabled: true, attention: { mode: 'warn', thresholds: { deviation: { deg: 20 } } } } },
  });
  check('attention escalation through the real route still 400s (D6)',
    escalationUpdate.status === 400, `${escalationUpdate.status}`);

  // ---- Report ----
  console.log('\n[verify] ========= RESULT =========');
  console.log(`[verify] passed: ${passed}  failed: ${failures.length}`);
  for (const failure of failures) console.log(`[verify]   FAIL ${failure}`);
  console.log(`[verify] ${failures.length === 0 ? 'ALL CHECKS PASSED ✅' : 'FAILURES DETECTED ❌'}`);

  server.close();
  await mongoServer.stop();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('[verify] fatal', error);
  process.exit(1);
});
