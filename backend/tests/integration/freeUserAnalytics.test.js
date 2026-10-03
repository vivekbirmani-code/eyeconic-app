/**
 * Free Login User Dashboard (website Feature 08) integration tests:
 * mentor/admin authorization, free-user scoping, rollups, streaks,
 * drop-off and weekly feature usage.
 */
const request = require('supertest');
const db = require('../helpers/db');
const User = require('../../models/User');
const Subject = require('../../models/Subject');
const Quiz = require('../../models/Quiz');
const QuizAttempt = require('../../models/QuizAttempt');
const DailyPyqAttempt = require('../../models/DailyPyqAttempt');
const dailyPyqUtil = require('../../utils/dailyPyq');
const { buildApp, createUser } = require('../helpers/testApp');

const app = buildApp();

let mentorToken, adminToken, studentToken;
let subject, quiz;
const today = dailyPyqUtil.istDateKey();
const yesterday = dailyPyqUtil.addDaysKey(today, -1);

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function createFreeUser(name, email, extras = {}) {
  return User.create({
    name,
    email,
    password: 'password123',
    role: 'student',
    isFreeUser: true,
    ...extras,
  });
}

async function createQuizAttempt(user, { marks = 8, totalMarks = 10, endTime = new Date() } = {}) {
  return QuizAttempt.create({
    quiz: quiz._id,
    student: user._id,
    status: 'completed',
    answers: [],
    score: Math.round(marks / 4),
    totalQuestions: Math.round(totalMarks / 4),
    marksObtained: marks,
    totalMarks,
    startTime: new Date(Date.now() - 30 * 60 * 1000),
    endTime,
  });
}

async function createPyqAttempt(user, dateKey, { score = 30 } = {}) {
  return DailyPyqAttempt.create({
    student: user._id,
    date: dateKey,
    questionIds: [],
    answers: [],
    correctCount: 8,
    incorrectCount: 1,
    skippedCount: 1,
    totalQuestions: 10,
    score,
    maxScore: 40,
    timeTakenSeconds: 300,
    submittedAt: new Date(`${dateKey}T05:00:00+05:30`),
  });
}

beforeAll(async () => {
  await db.connect();

  ({ token: mentorToken } = await createUser({ role: 'mentor', name: 'Analytics Mentor' }));
  ({ token: adminToken } = await createUser({ role: 'admin', name: 'Analytics Admin' }));
  ({ token: studentToken } = await createUser({ role: 'student', name: 'Paid Student' }));

  subject = await Subject.create({ name: 'Psychiatry', year: '4th', displayOrder: 1 });
  const admin = await User.findOne({ role: 'admin' });
  quiz = await Quiz.create({
    title: 'Mini GT Psychiatry #1',
    subject: subject._id,
    testType: 'daily',
    duration: 15,
    createdBy: admin._id,
    assignToAllFreeUsers: true,
  });
});

afterAll(async () => {
  await db.closeDatabase();
});

describe('Free-user analytics', () => {
  let activeFree, casualFree, dormantFree;

  beforeAll(async () => {
    activeFree = await createFreeUser('Active Free', 'active-free@example.com', {
      freeUserProfile: { year: 'Intern', issues: 'Revision', resources: ['Marrow', 'PrepLadder'], isReadyToTransform: true },
      isProfileComplete: true,
    });
    casualFree = await createFreeUser('Casual Free', 'casual-free@example.com', {
      freeUserProfile: { year: '2nd', issues: 'Basics', resources: ['Marrow'] },
    });
    dormantFree = await createFreeUser('Dormant Free', 'dormant-free@example.com');

    // Active: two finalized attempts (80%, 40%) + PYQ today and yesterday.
    await createQuizAttempt(activeFree, { marks: 8, totalMarks: 10 });
    await createQuizAttempt(activeFree, { marks: 4, totalMarks: 10 });
    await createPyqAttempt(activeFree, today, { score: 32 });
    await createPyqAttempt(activeFree, yesterday, { score: 28 });

    // Casual: PYQ yesterday only (streak 1, still counted in PYQ population).
    await createPyqAttempt(casualFree, yesterday, { score: 20 });

    // Dormant: registered, never active.
  });

  describe('authorization', () => {
    it('requires authentication', async () => {
      const res = await request(app).get('/api/free-user-analytics/overview');
      expect(res.status).toBe(401);
    });

    it('denies students (including free users)', async () => {
      const res = await request(app).get('/api/free-user-analytics/overview').set(authHeader(studentToken));
      expect(res.status).toBe(403);
      const jwt = require('jsonwebtoken');
      const freeToken = jwt.sign({ userId: activeFree._id.toString() }, process.env.JWT_SECRET);
      const freeRes = await request(app).get('/api/free-user-analytics/overview').set(authHeader(freeToken));
      expect(freeRes.status).toBe(403);
    });

    it('allows mentors and admins', async () => {
      const mentorRes = await request(app).get('/api/free-user-analytics/ids').set(authHeader(mentorToken));
      expect(mentorRes.status).toBe(200);
      const adminRes = await request(app).get('/api/free-user-analytics/ids').set(authHeader(adminToken));
      expect(adminRes.status).toBe(200);
    });
  });

  describe('GET /overview', () => {
    it('counts free users, activity and platform choices', async () => {
      const res = await request(app).get('/api/free-user-analytics/overview').set(authHeader(mentorToken));
      expect(res.status).toBe(200);

      // 3 seeded free users here (paid student excluded).
      expect(res.body.totals.freeUsers).toBeGreaterThanOrEqual(3);
      expect(res.body.miniGt.attemptsTotal).toBeGreaterThanOrEqual(2);
      expect(res.body.miniGt.attemptingUsers).toBeGreaterThanOrEqual(1);
      expect(res.body.dailyPyq.attemptsTotal).toBeGreaterThanOrEqual(3);
      expect(res.body.dailyPyq.attemptsToday).toBeGreaterThanOrEqual(1);

      // Active free ids include the active user in all windows.
      const id = String(activeFree._id);
      expect(res.body.activeUserIds.dau).toContain(id);
      expect(res.body.activeUserIds.wau).toContain(id);
      expect(res.body.activeUserIds.mau).toContain(id);

      const marrow = res.body.platformChoice.find((p) => p.platform === 'Marrow');
      expect(marrow.count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /users', () => {
    it('paginates with per-user rollups', async () => {
      const res = await request(app)
        .get('/api/free-user-analytics/users')
        .query({ page: 1, limit: 2 })
        .set(authHeader(mentorToken));
      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(2);
      expect(res.body.page).toBe(1);
      expect(res.body.total).toBeGreaterThanOrEqual(3);

      const row = res.body.users.find((u) => u._id === String(activeFree._id));
      if (row) {
        expect(row.miniGt.attempts).toBe(2);
        expect(row.miniGt.avgScorePercentage).toBe(60);
        expect(row.dailyPyq.currentStreak).toBe(2);
        expect(row.platforms).toEqual(['Marrow', 'PrepLadder']);
        expect(row.lastActiveAt).toBeTruthy();
      }
    });

    it('searches by name and email server-side', async () => {
      const res = await request(app)
        .get('/api/free-user-analytics/users')
        .query({ q: 'casual-free@example.com' })
        .set(authHeader(mentorToken));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.users[0].name).toBe('Casual Free');
    });

    it('filters by sign-up date range', async () => {
      const future = dailyPyqUtil.addDaysKey(today, 1);
      const res = await request(app)
        .get('/api/free-user-analytics/users')
        .query({ from: future })
        .set(authHeader(mentorToken));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.users).toHaveLength(0);
    });

    it('restricts to an explicit id list', async () => {
      const res = await request(app)
        .get('/api/free-user-analytics/users')
        .query({ ids: String(dormantFree._id) })
        .set(authHeader(mentorToken));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.users[0]._id).toBe(String(dormantFree._id));
    });
  });

  describe('GET /users/:id', () => {
    it('returns the drilldown with histories and streaks', async () => {
      const res = await request(app)
        .get(`/api/free-user-analytics/users/${activeFree._id}`)
        .set(authHeader(mentorToken));
      expect(res.status).toBe(200);

      expect(res.body.user.name).toBe('Active Free');
      expect(res.body.user.freeUserProfile.resources).toEqual(['Marrow', 'PrepLadder']);
      expect(res.body.miniGt.summary.totalAttempts).toBe(2);
      expect(res.body.miniGt.summary.avgScorePercentage).toBe(60);
      expect(res.body.miniGt.summary.bestScorePercentage).toBe(80);
      expect(res.body.miniGt.attempts[0].subjectName).toBe('Psychiatry');
      expect(res.body.dailyPyq.streaks.current).toBe(2);
      expect(res.body.dailyPyq.totalAttempts).toBe(2);
    });

    it('rejects invalid ids and non-free users', async () => {
      const bad = await request(app).get('/api/free-user-analytics/users/nope').set(authHeader(mentorToken));
      expect(bad.status).toBe(400);

      const paid = await User.findOne({ role: 'student', isFreeUser: { $ne: true } });
      const notFree = await request(app).get(`/api/free-user-analytics/users/${paid._id}`).set(authHeader(mentorToken));
      expect(notFree.status).toBe(404);
    });
  });

  describe('GET /performance', () => {
    it('computes subject averages, completion, leaderboard and drop-off', async () => {
      const res = await request(app).get('/api/free-user-analytics/performance').set(authHeader(adminToken));
      expect(res.status).toBe(200);

      expect(res.body.miniGt.totalAttempts).toBeGreaterThanOrEqual(2);
      expect(res.body.miniGt.avgScorePercentage).toBe(60);
      const psychiatry = res.body.miniGt.subjectWise.find((s) => s.subjectName === 'Psychiatry');
      expect(psychiatry.attempts).toBeGreaterThanOrEqual(2);
      expect(psychiatry.avgScorePercentage).toBe(60);

      // Completion counts distinct users with >= 1 PYQ attempt.
      expect(res.body.dailyPyq.usersWithAttempt).toBeGreaterThanOrEqual(2);

      // Leaderboard: active user (streak 2) ranks above casual (streak 1).
      expect(res.body.streakLeaderboard[0].userId).toBe(String(activeFree._id));
      expect(res.body.streakLeaderboard[0].currentStreak).toBe(2);

      // Drop-off: dormant (never active) flagged; active user not listed.
      const dormantRow = res.body.dropoff.users.find((u) => u.userId === String(dormantFree._id));
      expect(dormantRow).toBeTruthy();
      expect(dormantRow.neverActive).toBe(true);
      expect(res.body.dropoff.users.find((u) => u.userId === String(activeFree._id))).toBeFalsy();

      // Weekly usage buckets: last bucket holds this week's events.
      const lastIdx = res.body.featureUsage.weekLabels.length - 1;
      expect(res.body.featureUsage.rows[0].counts[lastIdx]).toBeGreaterThanOrEqual(2); // Mini GT
      expect(res.body.featureUsage.rows[1].counts[lastIdx]).toBeGreaterThanOrEqual(3); // Daily PYQ
    });
  });
});
