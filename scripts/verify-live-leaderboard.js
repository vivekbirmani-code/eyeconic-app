/**
 * End-to-end verification of the live leaderboard real-time flow.
 *
 * Boots the REAL backend (server.js — Express + Socket.IO + Mongo memory
 * server), then drives it exactly like production traffic:
 *
 *   1. An admin viewer opens a socket, registers, and joins the test's
 *      leaderboard room.
 *   2. A student socket is REFUSED the room (role check).
 *   3. Students submit quizzes over HTTP (one, then two concurrently).
 *   4. The admin viewer asserts it received a quiz_leaderboard_updated nudge
 *      per finalized submission, and that refetching the leaderboard endpoint
 *      shows correct ranking after each step.
 *   5. A mentor viewer's refetch is scoped to only their own students.
 *
 * Run from the repo root:  node scripts/verify-live-leaderboard.js
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'live-leaderboard-verify-secret';

const http = require('http');
const path = require('path');
const { io, Socket } = require('socket.io-client');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');

let mongoServer;
let server;
let baseURL;

const log = (...args) => console.log('[verify]', ...args);

function requireBackend(modulePath) {
  // eslint-disable-next-line import/no-dynamic-require
  return require(path.join(BACKEND, modulePath));
}

function waitFor(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/**
 * Resolve once `n` events have arrived. Registered BEFORE the triggering
 * action — a leaderboard nudge can reach the socket before the submit HTTP
 * response resolves, so waiters must exist up front.
 */
function waitForEvents(socket, event, n, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const payloads = [];
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${n} "${event}" event(s); got ${payloads.length}`));
    }, timeoutMs);
    const handler = (payload) => {
      payloads.push(payload);
      if (payloads.length >= n) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payloads);
      }
    };
    socket.on(event, handler);
  });
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
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }
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
  const { MongoMemoryServer } = require(path.join(
    BACKEND, 'node_modules', 'mongodb-memory-server'
  ));
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  log('in-memory mongo at', process.env.MONGODB_URI);

  // Require the real server AFTER env is pinned — dotenv never overrides
  // existing env vars, so the production Atlas URI in backend/.env is inert.
  const mongoose = require(path.join(BACKEND, 'node_modules', 'mongoose'));
  const { app, server: httpServer } = requireBackend('server');
  server = httpServer;

  const User = requireBackend('models/User');
  const Subject = requireBackend('models/Subject');
  const QuestionBank = requireBackend('models/QuestionBank');
  const Quiz = requireBackend('models/Quiz');
  const MentorStudentAssignment = requireBackend('models/MentorStudentAssignment');

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
      question: `Verify Q${i + 1}?`,
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 1,
    }));
  }

  const admin = await User.create({ name: 'Verify Admin', email: `admin-${Date.now()}@verify.test`, password: 'password123', role: 'admin' });
  const mentor = await User.create({ name: 'Verify Mentor', email: `mentor-${Date.now()}@verify.test`, password: 'password123', role: 'mentor' });
  const students = [];
  for (const name of ['Ann First', 'Ben Second', 'Cy Third']) {
    students.push(await User.create({ name, email: `${name.split(' ')[0].toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@verify.test`, password: 'password123', role: 'student' }));
  }
  // Mentor only mentors Ann — Ben and Cy are invisible to the mentor viewer.
  await MentorStudentAssignment.create({ mentor: mentor._id, student: students[0]._id, isActive: true, assignedBy: admin._id });

  const quiz = await Quiz.create({
    title: 'Live Leaderboard Verify Test',
    subject: subject._id,
    testType: 'daily',
    duration: 30,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    assignedStudents: students.map((s) => s._id),
    createdBy: admin._id,
  });

  const tokenFor = (user) => jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET);
  const adminToken = tokenFor(admin);
  const mentorToken = tokenFor(mentor);

  const leaderboardUrl = `/quizzes/analytics/test/${quiz._id}/leaderboard`;

  // ---- Viewer sockets ----
  // Socket registration is verified against the user JWT (handshake auth) —
  // same identity discipline as every HTTP route.
  const adminSocket = io(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    auth: { token: adminToken },
  });
  const mentorSocket = io(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    auth: { token: mentorToken },
  });
  const studentSocket = io(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    auth: { token: tokenFor(students[0]) },
  });

  await waitFor(adminSocket, 'connect');
  await waitFor(mentorSocket, 'connect');
  await waitFor(studentSocket, 'connect');
  log('3 sockets connected');

  adminSocket.emit('register_user', admin._id.toString());
  mentorSocket.emit('register_user', mentor._id.toString());
  studentSocket.emit('register_user', students[0]._id.toString());
  await new Promise((r) => setTimeout(r, 300)); // registration handlers are async

  // Student must be REFUSED the leaderboard room.
  const studentJoin = waitFor(studentSocket, 'leaderboard_error', 4000);
  studentSocket.emit('join_leaderboard', quiz._id.toString());
  await studentJoin;

  // An UNVERIFIED socket claiming the admin's id must be refused outright —
  // claimed ids no longer register a socket, only proven tokens do.
  const impostorSocket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  await waitFor(impostorSocket, 'connect');
  const impostorRejected = waitFor(impostorSocket, 'register_rejected', 4000);
  impostorSocket.emit('register_user', admin._id.toString());
  await impostorRejected;
  const impostorNudge = waitFor(impostorSocket, 'quiz_leaderboard_updated', 1500).then(
    () => 'received',
    () => 'silent'
  );
  impostorSocket.disconnect();
  if ((await impostorNudge) !== 'silent') {
    throw new Error('impostor socket received leaderboard events without a valid token');
  }
  log('token-less socket claiming the admin id refused (registration rejected)');
  log('student socket correctly refused leaderboard room');

  // Admin + mentor viewers join.
  const adminJoined = waitFor(adminSocket, 'leaderboard_joined');
  const mentorJoined = waitFor(mentorSocket, 'leaderboard_joined');
  adminSocket.emit('join_leaderboard', quiz._id.toString());
  mentorSocket.emit('join_leaderboard', quiz._id.toString());
  await adminJoined;
  await mentorJoined;
  log('admin + mentor sockets joined leaderboard room');

  // ---- Submission 1 (Ann: 3 correct, 1 wrong) ----
  const submitAs = async (student, correctIndexes, wrongIndexes) => {
    const token = tokenFor(student);
    const start = await api('POST', `/quizzes/${quiz._id}/start`, { token, body: {} });
    if (start.status !== 201) throw new Error(`start failed: ${start.status} ${JSON.stringify(start.body)}`);
    const attemptId = start.body.attemptId;
    for (const idx of correctIndexes) {
      const res = await api('PUT', `/quizzes/${quiz._id}/attempt/${attemptId}/answer`, {
        token,
        body: { questionIndex: idx, questionId: questions[idx]._id.toString(), selectedAnswer: 1 },
      });
      if (res.status !== 200) throw new Error(`answer failed: ${res.status}`);
    }
    for (const idx of wrongIndexes) {
      const res = await api('PUT', `/quizzes/${quiz._id}/attempt/${attemptId}/answer`, {
        token,
        body: { questionIndex: idx, questionId: questions[idx]._id.toString(), selectedAnswer: 2 },
      });
      if (res.status !== 200) throw new Error(`answer failed: ${res.status}`);
    }
    const submitted = await api('POST', `/quizzes/${quiz._id}/attempt/${attemptId}/submit`, { token, body: {} });
    if (submitted.status !== 200) throw new Error(`submit failed: ${submitted.status} ${JSON.stringify(submitted.body)}`);
    return attemptId;
  };

  const events = [];
  adminSocket.on('quiz_leaderboard_updated', (payload) => events.push(payload));

  const firstEventPromise = waitForEvents(adminSocket, 'quiz_leaderboard_updated', 1);
  const annAttemptId = await submitAs(students[0], [0, 1, 2], [3]);
  const [firstEvent] = await firstEventPromise;
  if (firstEvent.quizId !== quiz._id.toString() || firstEvent.attemptId !== annAttemptId.toString()) {
    throw new Error(`unexpected event payload: ${JSON.stringify(firstEvent)}`);
  }
  log('event 1 received for Ann:', firstEvent.attemptId);

  let board = await api('GET', leaderboardUrl, { token: adminToken });
  if (board.status !== 200) throw new Error(`leaderboard fetch failed: ${board.status}`);
  if (board.body.leaderboard.length !== 1 || board.body.leaderboard[0].studentName !== 'Ann First') {
    throw new Error(`leaderboard after 1 submission wrong: ${JSON.stringify(board.body.leaderboard)}`);
  }
  log('leaderboard after 1 submission: [Ann] rank=1 correct');

  // ---- Concurrent submissions (Ben: 4 correct, Cy: 2 correct + 2 wrong) ----
  const bothEventsPromise = waitForEvents(adminSocket, 'quiz_leaderboard_updated', 2);
  const [benAttemptId, cyAttemptId] = await Promise.all([
    submitAs(students[1], [0, 1, 2, 3], []),
    submitAs(students[2], [0, 1], [2, 3]),
  ]);
  // Two finalized submissions → two nudges.
  const bothEvents = await bothEventsPromise;
  const attemptIds = new Set(bothEvents.map((e) => e.attemptId));
  if (!attemptIds.has(benAttemptId.toString()) || !attemptIds.has(cyAttemptId.toString())) {
    throw new Error(`concurrent events missing attempts: ${JSON.stringify(bothEvents)}`);
  }
  log('both concurrent submissions nudged the viewer');

  // Small settle window, then the refetch a viewer would do.
  await new Promise((r) => setTimeout(r, 300));
  board = await api('GET', leaderboardUrl, { token: adminToken });
  const adminRows = board.body.leaderboard;
  if (adminRows.length !== 3) throw new Error(`expected 3 rows, got ${adminRows.length}`);
  const adminOrder = adminRows.map((r) => r.studentName);
  const expectedOrder = ['Ben Second', 'Ann First', 'Cy Third']; // 100% > 68.75% > 37.5%
  if (JSON.stringify(adminOrder) !== JSON.stringify(expectedOrder)) {
    throw new Error(`admin ranking wrong: ${JSON.stringify(adminOrder)} (expected ${JSON.stringify(expectedOrder)})`);
  }
  log('admin leaderboard ranking correct after concurrent submissions:', adminOrder);

  // ---- Mentor scoping over the same socket-wired server ----
  const mentorBoard = await api('GET', leaderboardUrl, { token: mentorToken });
  const mentorRows = mentorBoard.body.leaderboard;
  if (mentorRows.length !== 1 || mentorRows[0].studentName !== 'Ann First') {
    throw new Error(`mentor leaderboard wrong: ${JSON.stringify(mentorRows)}`);
  }
  log('mentor leaderboard correctly scoped to own student only');

  // ---- Duplicate submit must not re-nudge ----
  const eventsBefore = events.length;
  const dup = await api('POST', `/quizzes/${quiz._id}/attempt/${benAttemptId}/submit`, { token: tokenFor(students[1]), body: {} });
  if (dup.status !== 200 || !dup.body.isAlreadySubmitted) {
    throw new Error(`duplicate submit did not behave idempotently: ${dup.status}`);
  }
  await new Promise((r) => setTimeout(r, 500));
  if (events.length !== eventsBefore) {
    throw new Error('duplicate submit emitted an extra leaderboard event');
  }
  log('duplicate submit emitted no extra event');

  console.log('\nALL LIVE-LEADERBOARD RUNTIME CHECKS PASSED');
  process.exit(0);
}

main().catch((error) => {
  console.error('\nVERIFY FAILED:', error);
  process.exit(1);
});
