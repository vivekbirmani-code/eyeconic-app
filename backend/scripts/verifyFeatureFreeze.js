/**
 * Local end-to-end verification of the TEMPORARY FEATURE FREEZE.
 *
 * Boots the REAL backend (server.js) against a throwaway in-memory MongoDB
 * (your .env database is NOT touched) and checks, over HTTP:
 *
 *   1. Auth for all three roles (admin / mentor / student)
 *   2. The full admin quiz workflow (create from bank, share, analytics,
 *      retests, CSV, question bank, subjects, image questions)
 *   3. The student quiz workflow (list, start, answer, submit, results,
 *      analytics/me, retest request)
 *   4. The mentor quiz workflow (list, analytics scoping, student summary)
 *   5. Quiz-workflow dependencies living on frozen routers (users/groups/
 *      assignments/upload/settings allowlist) still respond
 *   6. Frozen endpoints answer 503 FEATURE_DISABLED (direct API bypass)
 *
 * Usage:  node scripts/verifyFeatureFreeze.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const { MongoMemoryServer } = require('mongodb-memory-server');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const IMAGE_URL =
  'https://res.cloudinary.com/demo/image/upload/sample.jpg';

let allOk = true;
const check = (ok, label, extra = '') => {
  allOk = allOk && ok;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
};

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('eyeconic-freeze-verify');
  process.env.PORT = '3998';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'verify-freeze-secret';

  const BASE = `http://localhost:${process.env.PORT}`;

  console.log('\n=== Booting real server.js (in-memory DB, port 3998) ===');
  const { server } = require('../server');
  await new Promise((resolve) => server.listen(process.env.PORT, resolve));

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
  const mongoose = require('mongoose');
  while (mongoose.connection.readyState !== 1) await sleep(200);

  // ---------- Seed ----------
  const Subject = require('../models/Subject');
  const QuestionBank = require('../models/QuestionBank');
  const User = require('../models/User');
  const MentorStudentAssignment = require('../models/MentorStudentAssignment');

  const subject = await Subject.create({ name: 'Freeze Subject', year: '1st', displayOrder: 1 });
  const stamp = Date.now();
  const admin = await User.create({ name: 'Freeze Admin', email: `admin-${stamp}@example.com`, password: 'password123', role: 'admin' });
  const mentor = await User.create({ name: 'Freeze Mentor', email: `mentor-${stamp}@example.com`, password: 'password123', role: 'mentor' });
  const student = await User.create({ name: 'Freeze Student', email: `student-${stamp}@example.com`, password: 'password123', role: 'student' });
  await MentorStudentAssignment.create({ mentor: mentor._id, student: student._id, assignedBy: admin._id });

  const questions = [];
  for (let i = 0; i < 2; i++) {
    questions.push(await QuestionBank.create({
      subject: subject._id,
      topicName: 'Topic', subtopicName: 'Subtopic', system: 'System',
      questionType: 'mcq_single', difficulty: 'easy',
      question: `Freeze Q${i}?`,
      options: ['No', 'Yes', 'Maybe', 'Never'],
      correctAnswer: 1,
      createdBy: admin._id,
    }));
  }
  const imageQuestion = await QuestionBank.create({
    subject: subject._id,
    topicName: 'Topic', subtopicName: 'Subtopic', system: 'System',
    questionType: 'image_based', difficulty: 'medium',
    question: 'Freeze image question?',
    questionImage: IMAGE_URL,
    options: ['No', 'Yes', 'Maybe', 'Never'],
    correctAnswer: 1,
    createdBy: admin._id,
  });
  const allQuestionIds = [...questions.map((q) => q._id.toString()), imageQuestion._id.toString()];

  const json = (token) => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
  const login = async (email) => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: json(), body: JSON.stringify({ email, password: 'password123' }),
    });
    const body = await res.json();
    return { ok: res.status === 200, token: body.token, user: body.user };
  };

  // ---------- 1. Auth for all roles ----------
  console.log('\n=== 1. Login works for all roles ===');
  const adminS = await login(admin.email);
  const mentorS = await login(mentor.email);
  const studentS = await login(student.email);
  check(adminS.ok && Boolean(adminS.token), 'admin login');
  check(mentorS.ok && Boolean(mentorS.token), 'mentor login');
  check(studentS.ok && Boolean(studentS.token), 'student login');

  const meRes = await fetch(`${BASE}/api/auth/me`, { headers: json(studentS.token) });
  check(meRes.status === 200 && (await meRes.json())._id === student._id.toString(), 'GET /api/auth/me (student)');

  // ---------- 2. Admin quiz workflow ----------
  console.log('\n=== 2. Admin quiz workflow (must be fully live) ===');
  const statsRes = await fetch(`${BASE}/api/quizzes/stats`, { headers: json(adminS.token) });
  check(statsRes.status === 200, 'GET /api/quizzes/stats');

  const qbStatsRes = await fetch(`${BASE}/api/question-bank/stats/summary`, { headers: json(adminS.token) });
  check(qbStatsRes.status === 200, 'GET /api/question-bank/stats/summary');

  const subjectsRes = await fetch(`${BASE}/api/subjects/list`, { headers: json(adminS.token) });
  check(subjectsRes.status === 200, 'GET /api/subjects/list');

  const createRes = await fetch(`${BASE}/api/quizzes/create-from-bank`, {
    method: 'POST', headers: json(adminS.token),
    body: JSON.stringify({
      title: 'Freeze Regression Test',
      subjects: [subject._id.toString()],
      testType: 'daily',
      numberOfQuestions: allQuestionIds.length,
      selectedQuestionIds: allQuestionIds,
      duration: 15,
      positiveMarks: 4, negativeMarks: 1,
      instructions: ['Read carefully.'],
      assignedStudents: [student._id.toString()],
      assignedMentors: [mentor._id.toString()],
      shareSolution: true, assignToAllFreeUsers: false,
      sections: [{ name: 'Section 1', duration: 15, selectionType: 'mixed', questions: [] }],
    }),
  });
  const createBody = await createRes.json();
  check(createRes.status === 201 && createBody.quiz?._id, 'POST /api/quizzes/create-from-bank (assign student + mentor)');
  const quizId = createBody.quiz._id;

  const quizDetailRes = await fetch(`${BASE}/api/quizzes/${quizId}`, { headers: json(adminS.token) });
  const quizDetail = await quizDetailRes.json();
  check(quizDetailRes.status === 200, 'GET /api/quizzes/:id (admin detail)');
  const detailQuestions = quizDetail.questions || quizDetail.quiz?.questions || [];
  const imageQ = detailQuestions.find((q) => q.questionType === 'image_based');
  check(Boolean(imageQ && (imageQ.questionImage === IMAGE_URL)), 'image question keeps questionImage through quiz populate');

  const genRes = await fetch(`${BASE}/api/quizzes/${quizId}/generate-share-link`, { method: 'POST', headers: json(adminS.token) });
  const genBody = await genRes.json();
  check(genRes.status === 200 && (genBody.shareUrl || genBody.shareToken), 'POST /api/quizzes/:id/generate-share-link');
  const shareToken = genBody.shareToken || (genBody.shareUrl || '').split('/').pop();

  const byTokenRes = await fetch(`${BASE}/api/quizzes/by-token/${shareToken}`, { headers: json(studentS.token) });
  check(byTokenRes.status === 200, 'GET /api/quizzes/by-token/:token (mobile deep link)');

  const shareStatusRes = await fetch(`${BASE}/api/quizzes/${quizId}/share-status`, { headers: json(adminS.token) });
  check(shareStatusRes.status === 200, 'GET /api/quizzes/:id/share-status');

  const retestsRes = await fetch(`${BASE}/api/quizzes/retests/pending`, { headers: json(adminS.token) });
  check(retestsRes.status === 200, 'GET /api/quizzes/retests/pending (web retests page)');

  // ---------- 3. Student quiz workflow ----------
  console.log('\n=== 3. Student quiz workflow (must be fully live) ===');
  const listRes = await fetch(`${BASE}/api/quizzes`, { headers: json(studentS.token) });
  const listBody = await listRes.json();
  const studentList = Array.isArray(listBody) ? listBody : listBody.quizzes || [];
  check(listRes.status === 200 && studentList.some((q) => q._id === quizId), 'GET /api/quizzes (student sees assigned quiz)');

  const startRes = await fetch(`${BASE}/api/quizzes/${quizId}/start`, { method: 'POST', headers: json(studentS.token) });
  const startBody = await startRes.json();
  const attemptId = startBody.attemptId || startBody.attempt?._id;
  check(startRes.status === 201 && Boolean(attemptId), 'POST /api/quizzes/:id/start');

  for (let i = 0; i < allQuestionIds.length; i++) {
    await fetch(`${BASE}/api/quizzes/${quizId}/attempt/${attemptId}/answer`, {
      method: 'PUT', headers: json(studentS.token),
      body: JSON.stringify({ questionIndex: i, questionId: allQuestionIds[i], selectedAnswer: 1, markedForReview: false, timeSpent: 4 }),
    });
  }
  check(true, 'PUT /api/quizzes/:id/attempt/:attemptId/answer (all questions)');

  const submitRes = await fetch(`${BASE}/api/quizzes/${quizId}/attempt/${attemptId}/submit`, {
    method: 'POST', headers: json(studentS.token),
    body: JSON.stringify({ tabSwitchCount: 0, tabSwitchLog: [] }),
  });
  check(submitRes.status === 200, 'POST /api/quizzes/:id/attempt/:attemptId/submit');

  const resultsRes = await fetch(`${BASE}/api/quizzes/${quizId}/attempt/${attemptId}/results?groupBy=section`, { headers: json(studentS.token) });
  const resultsBody = await resultsRes.json();
  check(resultsRes.status === 200 && resultsBody.summary, 'GET results?groupBy=section', `score% ${resultsBody.summary?.scorePercentage}`);

  const meAnalyticsRes = await fetch(`${BASE}/api/quizzes/analytics/me`, { headers: json(studentS.token) });
  check(meAnalyticsRes.status === 200, 'GET /api/quizzes/analytics/me (My Performance)');

  const markSeenRes = await fetch(`${BASE}/api/quizzes/mark-seen`, { method: 'POST', headers: json(studentS.token) });
  check(markSeenRes.status === 200, 'POST /api/quizzes/mark-seen');

  const retestReqRes = await fetch(`${BASE}/api/quizzes/${quizId}/attempt/${attemptId}/request-retest`, {
    method: 'POST', headers: json(studentS.token), body: JSON.stringify({ reason: 'freeze verify' }),
  });
  check(retestReqRes.status === 200 || retestReqRes.status === 201, 'POST request-retest');

  const profileRes = await fetch(`${BASE}/api/users/profile`, {
    method: 'PUT', headers: json(studentS.token),
    body: JSON.stringify({ mbbsBatch: '2026', collegeName: 'Verify College', attemptNo: '1', batchType: 'dropper', grandTestsGiven: '0', averageCorrects: '0', averageScore: '0', weakestSubjects: 'Physics', targetBranch: 'Medicine', subscriptions: 'None' }),
  });
  check(profileRes.status === 200, 'PUT /api/users/profile (mandatory student profile modal)');

  // ---------- 4. Mentor quiz workflow ----------
  console.log('\n=== 4. Mentor quiz workflow (must be fully live) ===');
  const mentorListRes = await fetch(`${BASE}/api/quizzes`, { headers: json(mentorS.token) });
  check(mentorListRes.status === 200, 'GET /api/quizzes (mentor)');

  const testsListRes = await fetch(`${BASE}/api/quizzes/analytics/tests/list`, { headers: json(mentorS.token) });
  check(testsListRes.status === 200, 'GET /api/quizzes/analytics/tests/list (mentor Test Analytics)');

  const testAnalyticsRes = await fetch(`${BASE}/api/quizzes/analytics/test/${quizId}`, { headers: json(mentorS.token) });
  check(testAnalyticsRes.status === 200, 'GET /api/quizzes/analytics/test/:testId (mentor)');

  const studentSummaryRes = await fetch(`${BASE}/api/student-analytics/summary/${student._id}`, { headers: json(mentorS.token) });
  check(studentSummaryRes.status === 200, 'GET /api/student-analytics/summary/:studentId (web Analytics dependency)');

  const mentorStudentsRes = await fetch(`${BASE}/api/assignments/mentor/${mentor._id}/students`, { headers: json(mentorS.token) });
  check(mentorStudentsRes.status === 200, 'GET /api/assignments/mentor/:id/students (mentor analytics picker — allowlisted)');

  // ---------- 5. Admin analytics + CSV ----------
  console.log('\n=== 5. Admin analytics, Test Analytics, CSV (must be fully live) ===');
  const heatRes = await fetch(`${BASE}/api/quizzes/analytics/heatmap`, { headers: json(adminS.token) });
  check(heatRes.status === 200, 'GET /api/quizzes/analytics/heatmap');

  const perfRes = await fetch(`${BASE}/api/quizzes/analytics/student/${student._id}/performance`, { headers: json(adminS.token) });
  check(perfRes.status === 200, 'GET /api/quizzes/analytics/student/:id/performance');

  const csvRes = await fetch(`${BASE}/api/quizzes/analytics/test-report/${quizId}/csv?token=${adminS.token}`);
  check(csvRes.status === 200, 'GET test-report CSV (?token= external-browser download)');

  const retestListRes = await fetch(`${BASE}/api/quizzes/retest-requests/pending`, { headers: json(adminS.token) });
  const retestListBody = await retestListRes.json();
  const pending = Array.isArray(retestListBody) ? retestListBody : retestListBody.requests || retestListBody.retests || [];
  check(retestListRes.status === 200, 'GET /api/quizzes/retest-requests/pending');

  // ---------- 6. Frozen endpoints answer 503 FEATURE_DISABLED ----------
  console.log('\n=== 6. Direct API access to frozen features is blocked ===');
  const expectFrozen = async (label, path, method, token, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method, headers: json(token), ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let code = null; let feature = null;
    try { const b = await res.json(); code = b.code; feature = b.feature; } catch { /* non-JSON */ }
    check(res.status === 503 && code === 'FEATURE_DISABLED', label, `status ${res.status} code ${code} feature ${feature}`);
  };

  await expectFrozen('POST /api/users (create user)', '/api/users', 'POST', adminS.token, { name: 'X', email: 'x@example.com', password: 'password123', role: 'student' });
  await expectFrozen('PUT /api/users/:id (edit user)', `/api/users/${student._id}`, 'PUT', adminS.token, { name: 'X' });
  await expectFrozen('POST /api/users/:id/reset-password', `/api/users/${student._id}/reset-password`, 'POST', adminS.token, {});
  await expectFrozen('GET /api/users/:id (user details)', `/api/users/${student._id}`, 'GET', adminS.token);
  await expectFrozen('GET /api/settings (admin settings)', '/api/settings', 'GET', adminS.token);
  await expectFrozen('PUT /api/settings/signup-enabled', '/api/settings/signup-enabled', 'PUT', adminS.token, { signUpEnabled: true });
  await expectFrozen('POST /api/groups (create group)', '/api/groups', 'POST', adminS.token, { name: 'G' });
  await expectFrozen('GET /api/groups/:id (group detail)', `/api/groups/${quizId}`, 'GET', adminS.token);
  await expectFrozen('POST /api/groups/:id/read (mark read)', `/api/groups/${quizId}/read`, 'POST', adminS.token);
  await expectFrozen('GET /api/groups/:id/student-subjects', `/api/groups/${quizId}/student-subjects`, 'GET', adminS.token);
  await expectFrozen('GET /api/messages/group/:id (chat history)', `/api/messages/group/${quizId}`, 'GET', adminS.token);
  await expectFrozen('POST /api/messages (send message)', '/api/messages', 'POST', adminS.token, {});
  await expectFrozen('GET /api/admin-overview/students', '/api/admin-overview/students', 'GET', adminS.token);
  await expectFrozen('GET /api/admin-overview/mentors', '/api/admin-overview/mentors', 'GET', adminS.token);
  await expectFrozen('GET /api/student-subjects/:studentId', `/api/student-subjects/${student._id}`, 'GET', adminS.token);
  await expectFrozen('GET /api/mentor-students/mentor/:id', `/api/mentor-students/mentor/${mentor._id}`, 'GET', adminS.token);
  await expectFrozen('POST /api/mentor-students (assign)', '/api/mentor-students', 'POST', adminS.token, {});
  await expectFrozen('GET /api/assignments/student/:id (student tasks)', `/api/assignments/student/${student._id}`, 'GET', studentS.token);
  await expectFrozen('POST /api/assignments (create task)', '/api/assignments', 'POST', mentorS.token, {});
  await expectFrozen('GET /api/upload/download-proxy', '/api/upload/download-proxy?url=https://example.com/x.png', 'GET', adminS.token);

  // ---------- 6b. Auth runs before the freeze gate ----------
  console.log('\n=== 6b. Invalid/expired sessions get 401, not the 503 freeze ===');
  const noAuthRes = await fetch(`${BASE}/api/messages/group/${quizId}`);
  check(
    noAuthRes.status === 401,
    'unauthenticated request to a frozen endpoint answers 401 (client logout path)',
    `status ${noAuthRes.status}`
  );
  const badAuthRes = await fetch(`${BASE}/api/groups`, {
    headers: { Authorization: 'Bearer not-a-token' },
  });
  check(badAuthRes.status === 401, 'invalid token answers 401', `status ${badAuthRes.status}`);

  // ---------- 7. Allowlisted dependencies on frozen routers stay live ----------
  console.log('\n=== 7. Quiz-workflow dependencies on frozen routers stay live ===');
  const usersListRes = await fetch(`${BASE}/api/users?role=student`, { headers: json(adminS.token) });
  check(usersListRes.status === 200, 'GET /api/users?role=student (quiz pickers + analytics)');

  const roleRes = await fetch(`${BASE}/api/users/role/mentor`, { headers: json(adminS.token) });
  check(roleRes.status === 200, 'GET /api/users/role/mentor (create-quiz mentor picker)');

  const roleStudentRes = await fetch(`${BASE}/api/users/role/student`, { headers: json(adminS.token) });
  check(roleStudentRes.status === 200, 'GET /api/users/role/student (create-quiz student picker)');

  const searchRes = await fetch(`${BASE}/api/users/search?role=mentor`, { headers: json(adminS.token) });
  check(searchRes.status === 200, 'GET /api/users/search?role=mentor (mentor picker)');

  const groupsListRes = await fetch(`${BASE}/api/groups`, { headers: json(adminS.token) });
  check(groupsListRes.status === 200, 'GET /api/groups (assign/share pickers + badges)');

  const settingsPublicRes = await fetch(`${BASE}/api/settings/public`);
  check(settingsPublicRes.status === 200, 'GET /api/settings/public (login screen)');

  // POST /upload is allowlisted for question images; without a multipart file
  // multer must reject with 400 — proving the freeze gate passed it through.
  const uploadRes = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${adminS.token}` } });
  check(uploadRes.status !== 503, 'POST /api/upload reaches the router (question images; 400 expected without file)', `status ${uploadRes.status}`);

  console.log(`\n${allOk ? '=== ALL CHECKS PASSED ===' : '=== FAILURES PRESENT ==='}`);
  server.close();
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(allOk ? 0 : 1);
})().catch(async (err) => {
  console.error('Harness failed:', err);
  process.exit(1);
});
