/**
 * Local end-to-end verification of the public quiz guest flow.
 *
 * Boots the REAL backend (server.js) against a throwaway in-memory MongoDB
 * (your .env database is NOT touched) and walks the full chain over HTTP:
 *
 *   share link redirect -> quiz fetch (CORS) -> lead OTP send/verify ->
 *   start attempt -> submit -> guest result
 *
 * Usage:  node scripts/verifyPublicFlow.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const { MongoMemoryServer } = require('mongodb-memory-server');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const mongod = await MongoMemoryServer.create();
  // dotenv (inside server.js) never overrides vars that already exist, so
  // these take precedence over backend/.env for this run only.
  process.env.MONGODB_URI = mongod.getUri('eyeconic-verify');
  process.env.PORT = '3999';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'verify-public-flow-secret';
  process.env.SMS_MOCK_ECHO = 'true';

  const BASE = `http://localhost:${process.env.PORT}`;
  const WEB = 'http://localhost:5173';

  console.log('\n=== Booting real server.js (in-memory DB, port 3999) ===');
  const { server } = require('../server');
  await new Promise((resolve) => server.listen(process.env.PORT, resolve));

  // Wait for the HTTP listener.
  let tries = 0;
  for (;;) {
    try {
      await fetch(`${BASE}/health`);
      break;
    } catch {
      if (++tries > 50) throw new Error('server did not start');
      await sleep(200);
    }
  }

  // Wait for the mongoose connection, then seed one public quiz.
  const mongoose = require('mongoose');
  while (mongoose.connection.readyState !== 1) {
    await sleep(200);
  }
  const Quiz = require('../models/Quiz');
  const Subject = require('../models/Subject');
  const QuestionBank = require('../models/QuestionBank');
  const User = require('../models/User');

  const subject = await Subject.create({ name: 'Verify Subject', year: '1st', displayOrder: 1 });
  const admin = await User.create({ name: 'Verify Admin', email: `verify-${Date.now()}@example.com`, password: 'password123', role: 'admin' });
  const questions = [];
  for (let i = 0; i < 2; i++) {
    questions.push(await QuestionBank.create({
      subject: subject._id,
      topicName: 'Topic', subtopicName: 'Subtopic', system: 'System',
      questionType: 'mcq_single', difficulty: 'easy',
      question: `Verify Q${i}?`,
      options: ['No', 'Yes', 'Maybe', 'Never'],
      correctAnswer: 1,
      createdBy: admin._id,
    }));
  }
  const shareToken = 'verify-local-token';
  await Quiz.create({
    title: 'Verify Public Quiz',
    subject: subject._id,
    testType: 'daily',
    duration: 10,
    questions: questions.map((q) => q._id),
    positiveMarks: 4, negativeMarks: 1,
    createdBy: admin._id,
    isPublic: true,
    shareToken,
  });

  const guestId = 'verify-device-1';
  const log = (ok, label, extra = '') =>
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  let allOk = true;
  const check = (ok, label, extra) => { allOk = allOk && ok; log(ok, label, extra); };

  console.log('\n=== 1. Share link redirect (the browser entry point) ===');
  const shareRes = await fetch(`${BASE}/api/public/share/${shareToken}`, { redirect: 'manual' });
  check(
    shareRes.status === 302 && shareRes.headers.get('location') === `${WEB}/public-quiz/${shareToken}`,
    'GET /api/public/share/:token 302 -> client web page',
    shareRes.headers.get('location') || `status ${shareRes.status}`
  );

  console.log('\n=== 2. Quiz fetch from the web client (CORS + payload) ===');
  const quizRes = await fetch(`${BASE}/api/public/quiz/${shareToken}`, {
    headers: { Origin: WEB },
  });
  const quizBody = await quizRes.json();
  check(quizRes.status === 200 && quizBody.success === true, 'GET /api/public/quiz/:token from localhost:5173', quizBody.quiz?.title || '');
  check(
    (quizRes.headers.get('access-control-allow-origin') || '') === WEB,
    'CORS allows the dev web origin'
  );

  console.log('\n=== 3. Lead OTP send + verify (mock SMS prints the code) ===');
  const sendRes = await fetch(`${BASE}/api/public/quiz/${shareToken}/lead/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB },
    body: JSON.stringify({ name: 'Local Tester', phone: '+919876543210', marketingConsent: true }),
  });
  const sendBody = await sendRes.json();
  check(sendRes.status === 200 && sendBody.success, 'lead/send-otp', sendBody.message || '');

  // The OTP was echoed to the server console by the dev mock (SMS_MOCK_ECHO).
  const GuestOtp = require('../models/GuestOtp');
  console.log('  ......... OTP row stored (hashed). Code was printed above by the DEV mock.');

  // Grab a fresh code the same way the mock would deliver it: reuse the
  // generation path is not possible (hash-only), so re-issue and read the
  // console value is manual. For automated verification, seed a known code.
  await GuestOtp.findOneAndUpdate(
    { phone: '+919876543210', shareToken },
    { otpHash: require('crypto').createHmac('sha256', process.env.OTP_HASH_SECRET || process.env.JWT_SECRET).update('guest-otp:v1:424242').digest('hex'), createdAt: new Date() },
    { upsert: true }
  );
  const verifyRes = await fetch(`${BASE}/api/public/quiz/${shareToken}/lead/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB },
    body: JSON.stringify({ name: 'Local Tester', phone: '+919876543210', marketingConsent: true, otp: '424242' }),
  });
  const verifyBody = await verifyRes.json();
  check(verifyRes.status === 200 && verifyBody.guestToken, 'lead/verify-otp issues guestToken');

  const auth = { Authorization: `Bearer ${verifyBody.guestToken}`, 'Content-Type': 'application/json', Origin: WEB };

  console.log('\n=== 4. Start attempt (lead-stamped) ===');
  const startRes = await fetch(`${BASE}/api/public/quiz/${shareToken}/start`, {
    method: 'POST', headers: auth, body: JSON.stringify({ guestId, deviceInfo: 'verify-script' }),
  });
  const startBody = await startRes.json();
  check(startRes.status === 201 && startBody.attempt?._id, 'start creates attempt', `lead=${startBody.lead?.name || 'none'}`);
  check(Boolean(startBody.attempt?.serverNow), 'flat (non-section) start response includes serverNow for skew-safe timers');

  console.log('\n=== 5. Submit + guest result ===');
  const answers = questions.map((q, i) => ({
    questionIndex: i, questionId: String(q._id), selectedAnswer: 1, markedForReview: false, timeSpent: 5,
  }));
  const submitRes = await fetch(`${BASE}/api/public/quiz/${shareToken}/submit`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ guestId, attemptId: startBody.attempt._id, answers, tabSwitchCount: 0, tabSwitchLog: [] }),
  });
  const submitBody = await submitRes.json();
  check(submitRes.status === 200 && submitBody.submitted, 'submit finalizes attempt');

  const resultRes = await fetch(`${BASE}/api/public/quiz/${shareToken}/attempt/${startBody.attempt._id}/result`, {
    headers: { Authorization: auth.Authorization, Origin: WEB },
  });
  const resultBody = await resultRes.json();
  check(
    resultRes.status === 200 && resultBody.summary?.correct === 2 && resultBody.summary?.marksObtained === 8,
    'guest result returns aligned score (2 correct -> 8/8)',
    `score% ${resultBody.summary?.scorePercentage}`
  );

  console.log('\n=== 6. Link generation behind a TLS proxy (Render shape) ===');
  // Runs LAST: generate-share-link rotates the token, which would
  // invalidate every request above that used the original one.
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: 'password123' }),
  });
  const loginBody = await loginRes.json();
  const quizDoc = await Quiz.findOne({ shareToken });
  const genRes = await fetch(`${BASE}/api/quizzes/${quizDoc._id}/generate-share-link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginBody.token}`,
      // Simulate Render's TLS-terminating proxy — without trust proxy the
      // generated link would wrongly be http://
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-For': '203.0.113.10',
    },
  });
  const genBody = await genRes.json();
  check(
    genRes.status === 200 && genBody.shareUrl?.startsWith('https://') && genBody.shareUrl.includes('/api/public/share/'),
    'generate-share-link returns an https:// share URL behind the proxy',
    genBody.shareUrl || `status ${genRes.status}`
  );
  const statusRes = await fetch(`${BASE}/api/quizzes/${quizDoc._id}/share-status`, {
    headers: { Authorization: `Bearer ${loginBody.token}`, 'X-Forwarded-Proto': 'https' },
  });
  const statusBody = await statusRes.json();
  check(
    statusRes.status === 200 && statusBody.shareUrl?.startsWith('https://'),
    'share-status (existing-link copy) is also https:// behind the proxy'
  );

  console.log(`\n=== ${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} ===`);
  console.log('Open http://localhost:5173/public-quiz/' + shareToken + ' in your browser for the manual UI pass.\n');

  process.exit(allOk ? 0 : 1);
})().catch((error) => {
  console.error('Verification crashed:', error);
  process.exit(1);
});
