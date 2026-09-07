/**
 * Browser-level verification of the public quiz under the TEMPORARY FEATURE
 * FREEZE — no production database is touched.
 *
 *   1. Boots the REAL backend (server.js) on an in-memory MongoDB at :3000
 *      (the port the web client dev server expects via VITE_API_URL).
 *   2. Seeds one public quiz with a text question + a Cloudinary image
 *      question, and mints a verified guest + guestToken in-process.
 *   3. Starts the REAL web client (Vite dev server, :5173).
 *   4. Drives headless Edge through the committed image-verification harness:
 *      entry page -> /take (attempt starts) -> image question renders (HTTP
 *      200 + decoded) -> submit -> result page -> review image.
 *
 * Usage:  node scripts/verifyFeatureFreezeWeb.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SHARE_TOKEN = 'freeze-web-verify';
const IMAGE_URL = 'https://res.cloudinary.com/demo/image/upload/w_600/sample.jpg';

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('eyeconic-freeze-web');
  process.env.PORT = '3000';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'verify-freeze-web-secret';
  const BASE = 'http://localhost:3000';
  const WEB = 'http://localhost:5173';

  console.log('=== Booting real server.js (in-memory DB, port 3000) ===');
  const { server } = require('../server');
  await new Promise((resolve) => server.listen(3000, resolve));
  const mongoose = require('mongoose');
  while (mongoose.connection.readyState !== 1) await sleep(200);

  // ---------- Seed ----------
  const Subject = require('../models/Subject');
  const QuestionBank = require('../models/QuestionBank');
  const User = require('../models/User');
  const Quiz = require('../models/Quiz');
  const Guest = require('../models/Guest');
  const { signGuestToken } = require('../middleware/guestAuth');

  const subject = await Subject.create({ name: 'Web Verify Subject', year: '1st', displayOrder: 1 });
  const admin = await User.create({ name: 'Web Verify Admin', email: `web-${Date.now()}@example.com`, password: 'password123', role: 'admin' });
  const textQ = await QuestionBank.create({
    subject: subject._id, topicName: 'Topic', subtopicName: 'Sub', system: 'Sys',
    questionType: 'mcq_single', difficulty: 'easy',
    question: 'Freeze web text question?', options: ['No', 'Yes', 'Maybe', 'Never'],
    correctAnswer: 1, createdBy: admin._id,
  });
  const imageQ = await QuestionBank.create({
    subject: subject._id, topicName: 'Topic', subtopicName: 'Sub', system: 'Sys',
    questionType: 'image_based', difficulty: 'medium',
    question: 'Freeze web image question?', questionImage: IMAGE_URL,
    options: ['No', 'Yes', 'Maybe', 'Never'],
    correctAnswer: 1, createdBy: admin._id,
  });
  await Quiz.create({
    title: 'Freeze Web Verify Quiz', subject: subject._id, testType: 'daily',
    duration: 10, questions: [textQ._id, imageQ._id],
    positiveMarks: 4, negativeMarks: 1, createdBy: admin._id,
    isPublic: true, shareToken: SHARE_TOKEN,
  });
  const guest = await Guest.create({
    name: 'Freeze Web Guest', email: `guest-${Date.now()}@eyeconic.test`,
    phone: `+9199${Date.now().toString().slice(-8)}`,
    emailVerifiedAt: new Date(), source: 'web', lastActiveAt: new Date(),
  });
  const guestToken = signGuestToken(guest._id);
  console.log(`Seeded public quiz ${SHARE_TOKEN} + guest ${guest._id}`);

  // ---------- Vite dev server ----------
  console.log('=== Starting Vite dev server (:5173) ===');
  const vite = spawn('npm', ['run', 'dev'], {
    cwd: path.join(__dirname, '..', '..', 'client'),
    shell: true, stdio: 'ignore',
  });
  let tries = 0;
  for (;;) {
    try {
      const res = await fetch(`${WEB}/`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (++tries > 120) {
      console.error('FAIL  vite dev server did not start');
      vite.kill(); server.close(); await mongoose.disconnect(); await mongod.stop();
      process.exit(1);
    }
    await sleep(500);
  }
  console.log('Vite dev server ready');

  // Sanity: the gated backend answers the web client's API base.
  const quizRes = await fetch(`${BASE}/api/public/quiz/${SHARE_TOKEN}`, { headers: { Origin: WEB } });
  console.log(`${quizRes.status === 200 ? 'PASS' : 'FAIL'}  GET /api/public/quiz/:token from :5173 (status ${quizRes.status})`);

  // ---------- Browser harness ----------
  console.log('=== Running browser image/submit/result harness (headless Edge) ===');
  const harness = spawn(process.execPath, ['scripts/verifyPublicQuizImages.mjs', guestToken, SHARE_TOKEN, 'desktop'], {
    cwd: path.join(__dirname, '..', '..', 'client'),
    stdio: 'inherit',
  });
  const harnessCode = await new Promise((resolve) => harness.on('close', resolve));

  console.log(`\n=== BROWSER HARNESS ${harnessCode === 0 ? 'PASSED' : 'FAILED (exit ' + harnessCode + ')'} ===`);
  vite.kill();
  server.close();
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(harnessCode === 0 && quizRes.status === 200 ? 0 : 1);
})().catch((err) => {
  console.error('Orchestrator failed:', err);
  process.exit(1);
});
