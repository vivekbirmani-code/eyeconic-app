const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const DailyPyqAttempt = require('../models/DailyPyqAttempt');
const { auth, authorize } = require('../middleware/auth');
const { istDateKey, addDaysKey, computeStreaks } = require('../utils/dailyPyq');
const { roundTo2 } = require('../utils/analytics');

/**
 * Free Login User Dashboard (website Feature 08) — read-only analytics over
 * the free registered user population, served to the website's mentor
 * dashboard through the website server's proxy.
 *
 * Caller: the Eyeconic website server (which forwards a signed-in mentor's or
 * admin's App JWT). Every route requires an authenticated user whose DB role
 * is mentor or admin — free students can never read other users' data.
 *
 * Metric definitions (single source of truth, reused by the website merge):
 *  - Free user            role === 'student' && isFreeUser === true (set at
 *                         signup; admins/mentors/paid students excluded).
 *  - Mini CCT attempt     a finalized QuizAttempt (completed/auto_submitted)
 *                         by a free user — the tests free users see (assigned
 *                         to all free users or individually).
 *  - Mini CCT score       marksObtained / totalMarks * 100 (the canonical
 *                         scorePercentage); attempts with totalMarks 0 are
 *                         excluded from averages, never counted as 0.
 *  - Active user (DAU/WAU/MAU) a free user with >= 1 activity event inside a
 *                         trailing IST-day window (WAU = last 7 days incl.
 *                         today). App-side events: finalized quiz attempt
 *                         (endTime) and Daily PYQ submission (submittedAt).
 *                         The website unions these with predictor events.
 *  - Daily PYQ streak     utils/dailyPyq.js#computeStreaks (IST calendar
 *                         days, today-or-yesterday anchored).
 *  - Drop-off             a free user with no App-side activity in the last
 *                         DROP_OFF_THRESHOLD_DAYS days (or never active).
 *                         No product definition existed; 7 days chosen and
 *                         documented here, overridable per request (3..30).
 *
 * All list endpoints paginate server-side; rollups are constant-count
 * aggregations over the page's user ids (never per-user loops).
 */

const router = express.Router();
router.use(auth, authorize('mentor', 'admin'));

const FREE_USER_QUERY = Object.freeze({ role: 'student', isFreeUser: true });
const FINALIZED_STATUSES = Object.freeze(['completed', 'auto_submitted']);

const DROP_OFF_THRESHOLD_DAYS = 7;
const FEATURE_USAGE_WEEKS = 4;
const MAX_PAGE_LIMIT = 100;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_IDS_FILTER = 2000;
const DRILLDOWN_ATTEMPT_CAP = 50;
const DRILLDOWN_PYQ_CAP = 60;
const LEADERBOARD_SIZE = 10;
const DROP_OFF_LIST_CAP = 500;

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

// ── IST time windows ────────────────────────────────────────────────────────

/** IST midnight of an IST date key, as a UTC Date (IST = +05:30). */
function istMidnightUtc(dateKey) {
  return new Date(`${dateKey}T00:00:00+05:30`);
}

function windows(now = new Date()) {
  const today = istDateKey(now);
  return {
    today,
    dauFrom: istMidnightUtc(today),
    wauFrom: istMidnightUtc(addDaysKey(today, -(7 - 1))),
    mauFrom: istMidnightUtc(addDaysKey(today, -(30 - 1))),
    monthStart: istMidnightUtc(`${today.slice(0, 7)}-01`),
  };
}

/** Week buckets (oldest → newest) of FEATURE_USAGE_WEEKS × 7 IST days. */
function weekBuckets(todayKey) {
  const buckets = [];
  for (let i = FEATURE_USAGE_WEEKS - 1; i >= 0; i -= 1) {
    const start = addDaysKey(todayKey, -(i * 7 + 6));
    const end = addDaysKey(todayKey, -(i * 7));
    buckets.push({ startKey: start, endKey: end, from: istMidnightUtc(start), to: istMidnightUtc(addDaysKey(end, 1)) });
  }
  return buckets;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

async function freeUserIds() {
  const docs = await User.find(FREE_USER_QUERY).select('_id').lean();
  return docs.map((d) => d._id);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Percentage of marks, guarded against zero totals (null = excluded). */
function pct(marksObtained, totalMarks) {
  const m = Number(marksObtained);
  const t = Number(totalMarks);
  if (!Number.isFinite(m) || !Number.isFinite(t) || t <= 0) return null;
  return roundTo2((m / t) * 100);
}

/**
 * App-side rollups for a set of free users: quiz attempts (count, avg %,
 * last endTime) and Daily PYQ (count, dates pushed for streaks, last
 * submittedAt). Two aggregations regardless of how many users are asked.
 */
async function activityRollups(userIds) {
  if (userIds.length === 0) {
    return { quiz: new Map(), pyq: new Map() };
  }

  const quizAgg = await QuizAttempt.aggregate([
    { $match: { student: { $in: userIds }, status: { $in: FINALIZED_STATUSES } } },
    {
      $group: {
        _id: '$student',
        attempts: { $sum: 1 },
        sumPct: {
          $sum: {
            $cond: [
              { $gt: ['$totalMarks', 0] },
              { $multiply: [{ $divide: ['$marksObtained', '$totalMarks'] }, 100] },
              0,
            ],
          },
        },
        countPct: { $sum: { $cond: [{ $gt: ['$totalMarks', 0] }, 1, 0] } },
        lastAttemptAt: { $max: '$endTime' },
      },
    },
  ]);

  const pyqAgg = await DailyPyqAttempt.aggregate([
    { $match: { student: { $in: userIds } } },
    {
      $group: {
        _id: '$student',
        attempts: { $sum: 1 },
        dates: { $push: '$date' },
        lastAttemptAt: { $max: '$submittedAt' },
      },
    },
  ]);

  const quiz = new Map();
  for (const row of quizAgg) {
    quiz.set(String(row._id), {
      attempts: row.attempts,
      avgScorePercentage: row.countPct > 0 ? roundTo2(row.sumPct / row.countPct) : null,
      lastAttemptAt: row.lastAttemptAt || null,
    });
  }

  const pyq = new Map();
  for (const row of pyqAgg) {
    pyq.set(String(row._id), {
      attempts: row.attempts,
      dates: row.dates,
      lastAttemptAt: row.lastAttemptAt || null,
    });
  }

  return { quiz, pyq };
}

/** Distinct free-user ids with App-side activity in each window ($facet). */
async function activeUserIdsByWindow(freeIds, win) {
  if (freeIds.length === 0) return { dau: [], wau: [], mau: [] };
  const studentIn = { $in: freeIds };

  const facetBranch = (from, timeField) => [
    { $match: { student: studentIn, [timeField]: { $gte: from } } },
    { $group: { _id: '$student' } },
  ];

  const [quizFacet, pyqFacet] = await Promise.all([
    QuizAttempt.aggregate([
      { $match: { student: studentIn, status: { $in: FINALIZED_STATUSES } } },
      {
        $facet: {
          dau: facetBranch(win.dauFrom, 'endTime'),
          wau: facetBranch(win.wauFrom, 'endTime'),
          mau: facetBranch(win.mauFrom, 'endTime'),
        },
      },
    ]),
    DailyPyqAttempt.aggregate([
      { $match: { student: studentIn } },
      {
        $facet: {
          dau: facetBranch(win.dauFrom, 'submittedAt'),
          wau: facetBranch(win.wauFrom, 'submittedAt'),
          mau: facetBranch(win.mauFrom, 'submittedAt'),
        },
      },
    ]),
  ]);

  const collect = (...arrays) => {
    const ids = new Set();
    for (const arr of arrays) {
      for (const row of arr || []) ids.add(String(row._id));
    }
    return [...ids];
  };

  return {
    dau: collect(quizFacet[0] && quizFacet[0].dau, pyqFacet[0] && pyqFacet[0].dau),
    wau: collect(quizFacet[0] && quizFacet[0].wau, pyqFacet[0] && pyqFacet[0].wau),
    mau: collect(quizFacet[0] && quizFacet[0].mau, pyqFacet[0] && pyqFacet[0].mau),
  };
}

// ── GET /overview ───────────────────────────────────────────────────────────

router.get('/overview', async (_req, res) => {
  try {
    const win = windows();
    const freeIds = await freeUserIds();

    const [freeUsersTotal, freeUsersThisMonth, platformChoiceAgg, activeUserIds, quizAgg, pyqAgg] =
      await Promise.all([
        User.countDocuments(FREE_USER_QUERY),
        User.countDocuments({ ...FREE_USER_QUERY, createdAt: { $gte: win.monthStart } }),
        User.aggregate([
          { $match: { ...FREE_USER_QUERY, 'freeUserProfile.resources': { $exists: true, $ne: [] } } },
          { $unwind: '$freeUserProfile.resources' },
          { $group: { _id: '$freeUserProfile.resources', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        activeUserIdsByWindow(freeIds, win),
        QuizAttempt.aggregate([
          { $match: { student: { $in: freeIds }, status: { $in: FINALIZED_STATUSES } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              students: { $addToSet: '$student' },
            },
          },
        ]),
        DailyPyqAttempt.aggregate([
          { $match: { student: { $in: freeIds } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              students: { $addToSet: '$student' },
              today: { $sum: { $cond: [{ $eq: ['$date', win.today] }, 1, 0] } },
              last7d: { $sum: { $cond: [{ $gte: ['$submittedAt', win.wauFrom] }, 1, 0] } },
            },
          },
        ]),
      ]);

    const quizRow = quizAgg[0] || { total: 0, students: [] };
    const pyqRow = pyqAgg[0] || { total: 0, students: [], today: 0, last7d: 0 };

    return res.json({
      totals: {
        freeUsers: freeUsersTotal,
        freeUsersThisMonth,
      },
      activeUserIds, // website unions these with predictor-side activity
      miniCct: {
        attemptsTotal: quizRow.total,
        attemptingUsers: quizRow.students.length,
      },
      dailyPyq: {
        attemptsTotal: pyqRow.total,
        attemptingUsers: pyqRow.students.length,
        attemptsToday: pyqRow.today,
        attemptsLast7d: pyqRow.last7d,
      },
      platformChoice: platformChoiceAgg.map((row) => ({ platform: row._id, count: row.count })),
      window: { today: win.today },
    });
  } catch (error) {
    console.error('Free-user analytics overview error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /ids ────────────────────────────────────────────────────────────────

// Free-user ids only (strings) — lets the website scope its own predictor
// collections to the same population without duplicating the definition.
router.get('/ids', async (_req, res) => {
  try {
    const ids = await freeUserIds();
    return res.json({ ids: ids.map(String) });
  } catch (error) {
    console.error('Free-user analytics ids error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /users (paginated, server-side search/filter) ───────────────────────

router.get('/users', async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Number.parseInt(req.query.limit, 10) || DEFAULT_PAGE_LIMIT));

    const query = { ...FREE_USER_QUERY };

    const q = String(req.query.q || '').trim();
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      query.$or = [{ name: pattern }, { email: pattern }];
    }

    // Sign-up date range (IST calendar days, inclusive).
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    const dateRange = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) dateRange.$gte = istMidnightUtc(from);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) dateRange.$lt = istMidnightUtc(addDaysKey(to, 1));
    if (Object.keys(dateRange).length > 0) query.createdAt = dateRange;

    // Server-side id restriction (e.g. the website's "exam selected" filter
    // resolves to predictor user ids it computed itself).
    if (typeof req.query.ids === 'string' && req.query.ids.length > 0) {
      const ids = req.query.ids.split(',').map((s) => s.trim()).filter((s) => OBJECT_ID_PATTERN.test(s));
      if (ids.length === 0) {
        return res.json({ users: [], total: 0, page, pages: 0, limit });
      }
      query._id = { $in: ids.slice(0, MAX_IDS_FILTER).map((id) => new mongoose.Types.ObjectId(id)) };
    }

    const sortField = String(req.query.sort || 'newest');
    const sort = sortField === 'oldest' ? { createdAt: 1 } : sortField === 'name' ? { name: 1 } : { createdAt: -1 };

    const [total, users] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .select('name email phone createdAt isProfileComplete freeUserProfile isActive')
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const pageIds = users.map((u) => u._id);
    const { quiz, pyq } = await activityRollups(pageIds);
    const today = istDateKey();

    const rows = users.map((user) => {
      const id = String(user._id);
      const quizRow = quiz.get(id) || { attempts: 0, avgScorePercentage: null, lastAttemptAt: null };
      const pyqRow = pyq.get(id) || { attempts: 0, dates: [], lastAttemptAt: null };
      const streaks = pyqRow.dates.length > 0 ? computeStreaks(pyqRow.dates, today) : { current: 0, best: 0 };
      const lastActiveCandidates = [quizRow.lastAttemptAt, pyqRow.lastAttemptAt].filter(Boolean);
      return {
        _id: id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        registeredAt: user.createdAt,
        isActive: user.isActive !== false,
        isProfileComplete: user.isProfileComplete === true,
        year: user.freeUserProfile && user.freeUserProfile.year ? user.freeUserProfile.year : null,
        platforms: (user.freeUserProfile && user.freeUserProfile.resources) || [],
        miniCct: {
          attempts: quizRow.attempts,
          avgScorePercentage: quizRow.avgScorePercentage,
          lastAttemptAt: quizRow.lastAttemptAt,
        },
        dailyPyq: {
          attempts: pyqRow.attempts,
          currentStreak: streaks.current,
          bestStreak: streaks.best,
          lastAttemptAt: pyqRow.lastAttemptAt,
        },
        lastActiveAt: lastActiveCandidates.length > 0 ? new Date(Math.max(...lastActiveCandidates.map(Number))) : null,
      };
    });

    return res.json({
      users: rows,
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    });
  } catch (error) {
    console.error('Free-user analytics users error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /users/:id (drilldown) ──────────────────────────────────────────────

router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!OBJECT_ID_PATTERN.test(id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const user = await User.findOne({ _id: id, ...FREE_USER_QUERY })
      .select('name email phone createdAt freeUserProfile isProfileComplete isActive')
      .lean();
    if (!user) {
      return res.status(404).json({ message: 'Free user not found' });
    }

    const [attempts, pyqDocs, pyqDates, totalQuizAttempts] = await Promise.all([
      QuizAttempt.find({ student: user._id, status: { $in: FINALIZED_STATUSES } })
        .select('quiz score totalQuestions marksObtained totalMarks endTime')
        .populate({ path: 'quiz', select: 'title testType subject', populate: { path: 'subject', select: 'name' } })
        .sort({ endTime: -1 })
        .limit(DRILLDOWN_ATTEMPT_CAP)
        .lean(),
      DailyPyqAttempt.find({ student: user._id })
        .select('date score maxScore correctCount incorrectCount skippedCount totalQuestions submittedAt')
        .sort({ date: -1 })
        .limit(DRILLDOWN_PYQ_CAP)
        .lean(),
      DailyPyqAttempt.find({ student: user._id }).select('date').lean(),
      QuizAttempt.countDocuments({ student: user._id, status: { $in: FINALIZED_STATUSES } }),
    ]);

    const today = istDateKey();
    const streaks = computeStreaks(pyqDates.map((d) => d.date), today);

    const attemptRows = attempts.map((a) => ({
      _id: String(a._id),
      quizId: a.quiz ? String(a.quiz._id) : null,
      quizTitle: a.quiz ? a.quiz.title : 'Untitled',
      testType: a.quiz ? a.quiz.testType : null,
      subjectName: a.quiz && a.quiz.subject ? a.quiz.subject.name : null,
      score: a.score,
      totalQuestions: a.totalQuestions,
      marksObtained: a.marksObtained,
      totalMarks: a.totalMarks,
      scorePercentage: pct(a.marksObtained, a.totalMarks),
      endTime: a.endTime,
    }));
    const percentages = attemptRows.map((a) => a.scorePercentage).filter((v) => v !== null);

    const pyqAttempts = pyqDocs.map((d) => ({
      _id: String(d._id),
      date: d.date,
      score: d.score,
      maxScore: d.maxScore,
      correctCount: d.correctCount,
      incorrectCount: d.incorrectCount,
      skippedCount: d.skippedCount,
      totalQuestions: d.totalQuestions,
      submittedAt: d.submittedAt,
    }));
    const pyqAvg = pyqAttempts.length > 0
      ? roundTo2(pyqAttempts.reduce((s, a) => s + a.score, 0) / pyqAttempts.length)
      : null;

    const lastActiveCandidates = [
      attemptRows.length > 0 ? attemptRows[0].endTime : null,
      pyqAttempts.length > 0 ? pyqAttempts[0].submittedAt : null,
    ].filter(Boolean);

    return res.json({
      user: {
        _id: String(user._id),
        name: user.name,
        email: user.email,
        phone: user.phone,
        registeredAt: user.createdAt,
        isActive: user.isActive !== false,
        isProfileComplete: user.isProfileComplete === true,
        freeUserProfile: user.freeUserProfile || null,
      },
      miniCct: {
        attempts: attemptRows,
        // Recent attempts are capped at DRILLDOWN_ATTEMPT_CAP; the summary
        // covers the user's FULL history (totalQuizAttempts is exact).
        capped: totalQuizAttempts > attemptRows.length,
        summary: {
          totalAttempts: totalQuizAttempts,
          avgScorePercentage: percentages.length > 0
            ? roundTo2(percentages.reduce((s, v) => s + v, 0) / percentages.length)
            : null,
          bestScorePercentage: percentages.length > 0 ? Math.max(...percentages) : null,
        },
      },
      dailyPyq: {
        attempts: pyqAttempts,
        totalAttempts: pyqDates.length,
        averageScore: pyqAvg,
        streaks,
      },
      lastActiveAt: lastActiveCandidates.length > 0
        ? new Date(Math.max(...lastActiveCandidates.map(Number)))
        : null,
      // The website enriches this payload with predictor history.
    });
  } catch (error) {
    console.error('Free-user analytics drilldown error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /performance (population metrics + engagement) ──────────────────────

router.get('/performance', async (req, res) => {
  try {
    const dropOffDays = Math.min(30, Math.max(3, Number.parseInt(req.query.dropOffDays, 10) || DROP_OFF_THRESHOLD_DAYS));
    const win = windows();
    const freeIds = await freeUserIds();
    const freeIdSet = new Set(freeIds.map(String));

    // Subject-wise + overall Mini CCT aggregates in one pass per quiz.
    const [byQuiz, pyqByStudent, freeUsersTotal, pyqTodayCount] = await Promise.all([
      QuizAttempt.aggregate([
        { $match: { student: { $in: freeIds }, status: { $in: FINALIZED_STATUSES } } },
        {
          $group: {
            _id: '$quiz',
            attempts: { $sum: 1 },
            sumPct: {
              $sum: {
                $cond: [
                  { $gt: ['$totalMarks', 0] },
                  { $multiply: [{ $divide: ['$marksObtained', '$totalMarks'] }, 100] },
                  0,
                ],
              },
            },
            countPct: { $sum: { $cond: [{ $gt: ['$totalMarks', 0] }, 1, 0] } },
          },
        },
        { $lookup: { from: 'quizzes', localField: '_id', foreignField: '_id', as: 'quizDoc' } },
        { $unwind: '$quizDoc' },
        {
          $lookup: {
            from: 'subjects',
            localField: 'quizDoc.subject',
            foreignField: '_id',
            as: 'subjectDoc',
          },
        },
        { $unwind: { path: '$subjectDoc', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ['$subjectDoc.name', 'Unspecified'] },
            attempts: { $sum: '$attempts' },
            sumPct: { $sum: '$sumPct' },
            countPct: { $sum: '$countPct' },
          },
        },
      ]),
      DailyPyqAttempt.aggregate([
        { $match: { student: { $in: freeIds } } },
        {
          $group: {
            _id: '$student',
            dates: { $push: '$date' },
            lastAttemptAt: { $max: '$submittedAt' },
          },
        },
      ]),
      User.countDocuments(FREE_USER_QUERY),
      DailyPyqAttempt.countDocuments({ student: { $in: freeIds }, date: win.today }),
    ]);

    // Subject rows (grouped by the quiz's subject; quizzes without a subject
    // land under 'Unspecified').
    const subjectRows = byQuiz.map((row) => ({
      subjectName: row._id,
      attempts: row.attempts,
      avgScorePercentage: row.countPct > 0 ? roundTo2(row.sumPct / row.countPct) : null,
    })).sort((a, b) => b.attempts - a.attempts);

    const totalAttempts = subjectRows.reduce((s, r) => s + r.attempts, 0);
    const sumPct = byQuiz.reduce((s, r) => s + r.sumPct, 0);
    const countPct = byQuiz.reduce((s, r) => s + r.countPct, 0);

    // Streak leaderboard + completion + drop-off from the per-student PYQ rollup.
    const today = win.today;
    const leaderboard = pyqByStudent
      .map((row) => ({
        userId: String(row._id),
        streaks: computeStreaks(row.dates, today),
        lastAttemptAt: row.lastAttemptAt,
      }))
      .sort((a, b) => b.streaks.current - a.streaks.current || b.streaks.best - a.streaks.best)
      .slice(0, LEADERBOARD_SIZE);

    const leaderboardIds = leaderboard.map((row) => new mongoose.Types.ObjectId(row.userId));
    const leaderboardUsers = leaderboardIds.length > 0
      ? await User.find({ _id: { $in: leaderboardIds } }).select('name email').lean()
      : [];
    const leaderboardNames = new Map(leaderboardUsers.map((u) => [String(u._id), u]));
    const leaderboardRows = leaderboard.map((row) => {
      const u = leaderboardNames.get(row.userId);
      return {
        userId: row.userId,
        name: u ? u.name : 'Unknown',
        email: u ? u.email : '',
        currentStreak: row.streaks.current,
        bestStreak: row.streaks.best,
        lastAttemptAt: row.lastAttemptAt,
      };
    });

    const usersWithPyq = pyqByStudent.length;
    const completionRate = freeUsersTotal > 0 ? roundTo2((usersWithPyq / freeUsersTotal) * 100) : null;
    const active7d = pyqByStudent.filter((row) => row.lastAttemptAt && row.lastAttemptAt >= win.wauFrom).length;

    // Drop-off: last App-side activity per free user (quiz + PYQ merged).
    const [quizLast] = await Promise.all([
      QuizAttempt.aggregate([
        { $match: { student: { $in: freeIds }, status: { $in: FINALIZED_STATUSES } } },
        { $group: { _id: '$student', lastAttemptAt: { $max: '$endTime' } } },
      ]),
    ]);
    const lastActive = new Map();
    for (const row of quizLast) lastActive.set(String(row._id), row.lastAttemptAt || null);
    for (const row of pyqByStudent) {
      const prev = lastActive.get(String(row._id)) || null;
      if (!prev || (row.lastAttemptAt && row.lastAttemptAt > prev)) {
        lastActive.set(String(row._id), row.lastAttemptAt || prev);
      }
    }

    const cutoff = istMidnightUtc(addDaysKey(today, -dropOffDays));
    const dropoffUserIds = [...freeIdSet].filter((id) => {
      const last = lastActive.get(id);
      return !last || last < cutoff;
    });
    const dropoffDocs = dropoffUserIds.length > 0
      ? await User.find({ _id: { $in: dropoffUserIds.map((id) => new mongoose.Types.ObjectId(id)) } })
        .select('name email createdAt')
        .sort({ createdAt: -1 })
        .limit(DROP_OFF_LIST_CAP)
        .lean()
      : [];
    const dropoffRows = dropoffDocs.map((u) => ({
      userId: String(u._id),
      name: u.name,
      email: u.email,
      registeredAt: u.createdAt,
      lastActiveAt: lastActive.get(String(u._id)) || null,
      neverActive: !lastActive.get(String(u._id)),
    }));

    // Feature usage: Mini CCT + Daily PYQ per IST-week bucket. $bucket needs
    // boundaries [start0 … startN-1, endOfLastBucket) — without the final
    // edge the newest week would fall into `default` and be dropped.
    const buckets = weekBuckets(today);
    const bucketBoundaries = [...buckets.map((b) => b.from), istMidnightUtc(addDaysKey(today, 1))];
    const countByBucket = async (Model, match, field) => {
      const rows = await Model.aggregate([
        { $match: match },
        {
          $bucket: {
            groupBy: `$${field}`,
            boundaries: bucketBoundaries,
            default: 'before',
          },
        },
      ]);
      const counts = new Array(buckets.length).fill(0);
      for (const row of rows) {
        const idx = buckets.findIndex((b) => Number(b.from) === Number(row._id));
        if (idx >= 0) counts[idx] = row.count;
      }
      return counts;
    };

    const usageFloor = buckets[0].from;
    const [miniCctUsage, dailyPyqUsage] = await Promise.all([
      countByBucket(QuizAttempt, { student: { $in: freeIds }, status: { $in: FINALIZED_STATUSES }, endTime: { $gte: usageFloor } }, 'endTime'),
      countByBucket(DailyPyqAttempt, { student: { $in: freeIds }, submittedAt: { $gte: usageFloor } }, 'submittedAt'),
    ]);

    return res.json({
      miniCct: {
        totalAttempts,
        avgScorePercentage: countPct > 0 ? roundTo2(sumPct / countPct) : null,
        subjectWise: subjectRows,
      },
      dailyPyq: {
        usersWithAttempt: usersWithPyq,
        completionRate,
        activeUsersLast7d: active7d,
        attemptsToday: pyqTodayCount,
      },
      streakLeaderboard: leaderboardRows,
      dropoff: {
        thresholdDays: dropOffDays,
        totalDropoffUsers: dropoffUserIds.length,
        users: dropoffRows,
      },
      featureUsage: {
        weekLabels: buckets.map((b) => b.startKey),
        rows: [
          { feature: 'Mini CCT', counts: miniCctUsage },
          { feature: 'Daily PYQ', counts: dailyPyqUsage },
        ],
      },
      window: { today },
    });
  } catch (error) {
    console.error('Free-user analytics performance error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
