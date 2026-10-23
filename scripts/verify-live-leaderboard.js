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
 *   6. An external (public-quiz guest) submission nudges the same room with
 *      cohort:'external' and lands in the admin analytics payload.
 *   7. A viewer that disconnects mid-test stops receiving nudges; after it
 *      reconnects and RE-JOINS the room (what the fixed app client does on
 *      every 'connect' — rooms do not survive a disconnect), later
 *      submissions reach it again and the refetched board is complete.
 *   8. A burst of 5 concurrent submissions produces exactly 5 nudges and a
 *      consistent 5-row board delta.
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

  // ---- External student: public-quiz guest submission must nudge too ----
  // Same questions, separate PUBLIC quiz (guest attempts live on GuestAttempt
  // and surface in the admin analytics payload as guestParticipants).
  const publicQuiz = await Quiz.create({
    title: 'Live Guest Verify Test',
    subject: subject._id,
    testType: 'daily',
    duration: 15,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    createdBy: admin._id,
    isPublic: true,
    isActive: true,
    shareToken: `verify-guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    publicExpiryDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    assignedStudents: [],
  });

  const guestId = `verify-device-${Date.now()}`;

  // The viewer is now watching the PUBLIC quiz's board — join that room too.
  const guestJoined = waitFor(adminSocket, 'leaderboard_joined');
  adminSocket.emit('join_leaderboard', publicQuiz._id.toString());
  await guestJoined;

  // Verified lead (the web OTP flow's outcome) — admin analytics only counts
  // lead-attempted guests (guest: {$ne: null}), so an anonymous device
  // attempt would never reach guestParticipants.
  const GuestModel = requireBackend('models/Guest');
  const { signGuestToken } = requireBackend('middleware/guestAuth');
  const lead = await GuestModel.create({
    name: 'Vera External',
    email: `verify-guest-${Date.now()}@verify.test`,
    emailVerifiedAt: new Date(),
    phone: `+9198${String(Date.now()).slice(-8)}`,
    source: 'web',
  });
  const guestToken = signGuestToken(lead._id);

  const guestStart = await api('POST', `/public/quiz/${publicQuiz.shareToken}/start`, {
    token: guestToken,
    body: { guestId },
  });
  if (guestStart.status !== 201) {
    throw new Error(`guest start failed: ${guestStart.status} ${JSON.stringify(guestStart.body)}`);
  }
  const guestAttemptId = guestStart.body.attempt._id;

  const guestEventPromise = waitForEvents(adminSocket, 'quiz_leaderboard_updated', 1);
  const guestSubmit = await api('POST', `/public/quiz/${publicQuiz.shareToken}/submit`, {
    token: guestToken,
    body: {
      guestId,
      attemptId: guestAttemptId,
      answers: questions.map((q, i) => ({
        questionIndex: i,
        questionId: q._id.toString(),
        selectedAnswer: i < 3 ? 1 : 2, // 3 correct, 1 wrong
      })),
      tabSwitchCount: 0,
      tabSwitchLog: [],
    },
  });
  if (guestSubmit.status !== 200) {
    throw new Error(`guest submit failed: ${guestSubmit.status} ${JSON.stringify(guestSubmit.body)}`);
  }
  const [guestEvent] = await guestEventPromise;
  if (
    guestEvent.quizId !== publicQuiz._id.toString()
    || guestEvent.cohort !== 'external'
    || guestEvent.attemptId !== guestAttemptId.toString()
  ) {
    throw new Error(`unexpected guest event payload: ${JSON.stringify(guestEvent)}`);
  }
  log('external guest submission nudged the viewer (cohort external)');

  // The analytics payload the admin screen refetches now carries the guest.
  const analytics = await api('GET', `/quizzes/analytics/test/${publicQuiz._id}`, { token: adminToken });
  if (analytics.status !== 200) throw new Error(`analytics fetch failed: ${analytics.status}`);
  const guests = analytics.body.guestParticipants || [];
  if (guests.length !== 1 || guests[0].attemptId !== guestAttemptId.toString()) {
    throw new Error(`guest participants wrong after submit: ${JSON.stringify(guests)}`);
  }
  log('admin analytics payload reflects the external guest submission');

  // Internal board for the guest quiz stays empty — cohorts never mix.
  const guestBoard = await api('GET', `/quizzes/analytics/test/${publicQuiz._id}/leaderboard`, { token: adminToken });
  if (guestBoard.status !== 200 || guestBoard.body.leaderboard.length !== 0) {
    throw new Error(`internal board for guest quiz should be empty: ${JSON.stringify(guestBoard.body)}`);
  }
  log('internal leaderboard stays cohort-clean for the public quiz');

  // ---- Reconnect contract: rooms do not survive a disconnect ----
  // A submission landing while the viewer is offline must not reach it, and
  // the viewer must be able to RE-JOIN after reconnecting (the fixed app
  // client re-emits join_leaderboard on every 'connect').
  const eventsBeforeOffline = events.length;
  adminSocket.disconnect();

  const offlineStudent = await User.create({
    name: 'Dee Offline',
    email: `dee-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@verify.test`,
    password: 'password123',
    role: 'student',
  });
  await Quiz.updateOne({ _id: quiz._id }, { $push: { assignedStudents: offlineStudent._id } });
  await submitAs(offlineStudent, [0, 1], [2, 3]);

  await new Promise((r) => setTimeout(r, 500));
  if (events.length !== eventsBeforeOffline) {
    throw new Error('disconnected viewer received a leaderboard event');
  }
  log('offline submission did not reach the disconnected viewer');

  // Refetch would show the missed row (this is what the client's reconnect
  // resync does).
  board = await api('GET', leaderboardUrl, { token: adminToken });
  if (board.body.leaderboard.length !== 4 || !board.body.leaderboard.some((r) => r.studentName === 'Dee Offline')) {
    throw new Error(`board missing offline submission: ${JSON.stringify(board.body.leaderboard.map((r) => r.studentName))}`);
  }
  log('refetch after reconnect resync shows the missed submission');

  // Reconnect + re-join, then a submission must nudge again.
  const rejoined = waitFor(adminSocket, 'leaderboard_joined');
  adminSocket.connect();
  await waitFor(adminSocket, 'connect');
  adminSocket.emit('join_leaderboard', quiz._id.toString());
  await rejoined;

  const resyncStudent = await User.create({
    name: 'Eli Resync',
    email: `eli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@verify.test`,
    password: 'password123',
    role: 'student',
  });
  await Quiz.updateOne({ _id: quiz._id }, { $push: { assignedStudents: resyncStudent._id } });
  const resyncEventPromise = waitForEvents(adminSocket, 'quiz_leaderboard_updated', 1);
  const eliAttemptId = await submitAs(resyncStudent, [0, 1, 2], []);
  const [resyncEvent] = await resyncEventPromise;
  if (resyncEvent.attemptId !== eliAttemptId.toString()) {
    throw new Error(`post-reconnect nudge wrong: ${JSON.stringify(resyncEvent)}`);
  }
  log('re-connected + re-joined viewer receives nudges again');

  // ---- Burst: 5 concurrent submissions → exactly 5 nudges, complete board ----
  const burstStudents = [];
  for (let i = 0; i < 5; i += 1) {
    burstStudents.push(await User.create({
      name: `Burst ${i + 1}`,
      email: `burst${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@verify.test`,
      password: 'password123',
      role: 'student',
    }));
  }
  await Quiz.updateOne({ _id: quiz._id }, { $push: { assignedStudents: { $each: burstStudents.map((s) => s._id) } } });

  const burstEventsPromise = waitForEvents(adminSocket, 'quiz_leaderboard_updated', 5);
  const burstAttemptIds = await Promise.all(
    burstStudents.map((student, i) => submitAs(student, [i % 4], []))
  );
  const burstEvents = await burstEventsPromise;
  const burstIds = new Set(burstEvents.map((e) => e.attemptId));
  for (const id of burstAttemptIds) {
    if (!burstIds.has(id.toString())) {
      throw new Error(`burst nudge missing for attempt ${id}`);
    }
  }
  if (burstEvents.length !== 5) {
    throw new Error(`expected exactly 5 burst nudges, got ${burstEvents.length}`);
  }
  log('burst of 5 concurrent submissions produced exactly 5 nudges');

  board = await api('GET', leaderboardUrl, { token: adminToken });
  const expectedRows = 3 + 1 + 1 + 5;
  if (board.body.leaderboard.length !== expectedRows) {
    throw new Error(`board after burst wrong: expected ${expectedRows} rows, got ${board.body.leaderboard.length}`);
  }
  // Every distinct attempt appears exactly once — no duplicates, none lost.
  const idCounts = board.body.leaderboard.reduce((acc, row) => {
    acc[row._id] = (acc[row._id] || 0) + 1;
    return acc;
  }, {});
  if (Object.values(idCounts).some((c) => c !== 1)) {
    throw new Error('duplicate attempt rows on the board after burst');
  }
  log(`board complete after burst: ${board.body.leaderboard.length} unique rows`);

  console.log('\nALL LIVE-LEADERBOARD RUNTIME CHECKS PASSED');
  process.exit(0);
}

main().catch((error) => {
  console.error('\nVERIFY FAILED:', error);
  process.exit(1);
});
