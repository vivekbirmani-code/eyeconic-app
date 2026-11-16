const express = require('express');
const { auth, authorize } = require('../middleware/auth');
const User = require('../models/User');
const VideoCatalogItem = require('../models/VideoCatalogItem');
const InternVideoTask = require('../models/InternVideoTask');
const InternDailyEntry = require('../models/InternDailyEntry');

const router = express.Router();

/**
 * Intern Mode (2026-11). Contracts agreed with the owner:
 *  - Mentor/admin toggles a student into intern mode and configures the scope:
 *    one or more sources, EACH WITH ITS OWN subject list.
 *  - The student picks today's minutes (30..720, 15-min steps) with the time
 *    slicer in the group description.
 *  - Allocation walks the catalog in sheetRow order across the scope slice,
 *    starting at the student's first unwatched video, and adds videos while
 *    the total stays within the chosen minutes — it NEVER crosses the limit
 *    (strict stop, boss decision 2026-11-15). Unfinished videos carry over.
 *  - Re-choosing the time the same day recomputes the plan; watched tasks are
 *    never removed or re-planned.
 */

const MIN_MINUTES = 30;
const MAX_MINUTES = 720;
const STEP_MINUTES = 15;

/** "Today" for intern mode is the IST calendar day (owner + students are IST). */
function istDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

/** Catalog rows for the student's scope, in watch (sheetRow) order. */
function scopeQuery(scope) {
  return {
    isActive: true,
    $or: scope.map((s) => ({
      sourceKey: s.sourceKey,
      subject: { $in: s.subjects }
    }))
  };
}

const taskSnapshot = (v) => ({
  title: v.title,
  subject: v.subject,
  source: v.source,
  type: v.type,
  durationMin: v.durationMin,
  sheetRow: v.sheetRow
});

/* ------------------------------------------------------------------ */
/* Catalog summary — feeds the mentor's source + subject pickers       */
/* ------------------------------------------------------------------ */
router.get('/catalog/summary', auth, authorize('mentor', 'admin'), async (req, res) => {
  try {
    const rows = await VideoCatalogItem.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: { sourceKey: '$sourceKey', source: '$source', subject: '$subject' },
          videos: { $sum: 1 },
          minutes: { $sum: '$durationMin' }
        }
      },
      { $sort: { '_id.sourceKey': 1, '_id.subject': 1 } }
    ]);

    const bySource = new Map();
    rows.forEach((r) => {
      const key = r._id.sourceKey;
      if (!bySource.has(key)) {
        bySource.set(key, {
          source: r._id.source,
          sourceKey: key,
          videos: 0,
          minutes: 0,
          subjects: []
        });
      }
      const s = bySource.get(key);
      s.videos += r.videos;
      s.minutes += r.minutes;
      s.subjects.push({ subject: r._id.subject, videos: r.videos, minutes: r.minutes });
    });

    const sources = [...bySource.values()].sort((a, b) => a.source.localeCompare(b.source));
    sources.forEach((s) => s.subjects.sort((a, b) => a.subject.localeCompare(b.subject)));
    res.json({ sources });
  } catch (error) {
    console.error('Error building intern catalog summary:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/* ------------------------------------------------------------------ */
/* Intern config (toggle + scope) — mentor/admin only                  */
/* ------------------------------------------------------------------ */
router.put('/config/:studentId', auth, authorize('mentor', 'admin'), async (req, res) => {
  try {
    const { isIntern, scope = [] } = req.body;

    const student = await User.findById(req.params.studentId);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    if (student.role !== 'student') {
      return res.status(400).json({ message: 'User is not a student' });
    }

    if (isIntern === true) {
      if (!Array.isArray(scope) || scope.length === 0) {
        return res
          .status(400)
          .json({ message: 'Intern scope needs at least one source with subjects' });
      }
      for (const entry of scope) {
        if (
          !entry ||
          typeof entry.sourceKey !== 'string' ||
          !Array.isArray(entry.subjects) ||
          entry.subjects.length === 0
        ) {
          return res
            .status(400)
            .json({ message: 'Each scope entry needs a source and at least one subject' });
        }
      }

      // Validate against the catalog and resolve display names from it.
      const wantedKeys = [...new Set(scope.map((e) => e.sourceKey.trim().toLowerCase()))];
      const sourceMeta = await VideoCatalogItem.aggregate([
        { $match: { isActive: true, sourceKey: { $in: wantedKeys } } },
        {
          $group: {
            _id: '$sourceKey',
            source: { $first: '$source' },
            subjects: { $addToSet: '$subject' }
          }
        }
      ]);
      const metaByKey = new Map(sourceMeta.map((m) => [m._id, m]));

      const normalizedScope = [];
      for (const entry of scope) {
        const key = entry.sourceKey.trim().toLowerCase();
        const meta = metaByKey.get(key);
        if (!meta) {
          return res.status(400).json({ message: `Unknown video source: ${entry.sourceKey}` });
        }
        const wanted = [...new Set(entry.subjects.map((s) => String(s).trim()))].filter(Boolean);
        const unknown = wanted.filter((s) => !meta.subjects.includes(s));
        if (unknown.length > 0) {
          return res.status(400).json({
            message: `Subject(s) not available in ${meta.source}: ${unknown.join(', ')}`
          });
        }
        normalizedScope.push({ source: meta.source, sourceKey: key, subjects: wanted });
      }

      student.isIntern = true;
      student.internScope = normalizedScope;
    } else {
      // Toggle OFF: scope is kept but ignored while off (a re-toggle restores
      // the previous selection).
      student.isIntern = false;
    }

    await student.save();
    res.json({ studentId: student._id, isIntern: student.isIntern, scope: student.internScope });
  } catch (error) {
    console.error('Error saving intern config:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

const progressOf = async (studentId, scope) => {
  const [taskAgg, scopeCount] = await Promise.all([
    InternVideoTask.aggregate([
      { $match: { student: studentId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          minutes: { $sum: '$durationMin' }
        }
      }
    ]),
    scope && scope.length ? VideoCatalogItem.countDocuments(scopeQuery(scope)) : 0
  ]);
  const get = (status) => taskAgg.find((a) => a._id === status) || { count: 0, minutes: 0 };
  const watched = get('watched');
  const pending = get('pending');
  return {
    watchedCount: watched.count,
    watchedMinutes: watched.minutes,
    pendingCount: pending.count,
    pendingMinutes: pending.minutes,
    scopeVideos: scopeCount,
    finishedAll: scopeCount > 0 && scopeCount === watched.count
  };
};

router.get('/config/:studentId', auth, async (req, res) => {
  try {
    if (
      req.user.role === 'student' &&
      req.user._id.toString() !== req.params.studentId
    ) {
      return res.status(403).json({ message: 'Access denied' });
    }
    const student = await User.findById(req.params.studentId);
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const date = istDateKey();
    const [progress, today] = await Promise.all([
      student.isIntern ? progressOf(student._id, student.internScope) : null,
      student.isIntern
        ? InternDailyEntry.findOne({ student: student._id, date }).lean()
        : null
    ]);
    res.json({
      studentId: student._id,
      name: student.name,
      email: student.email,
      isIntern: student.isIntern,
      scope: student.internScope,
      progress,
      today: today
        ? { date: today.date, minutes: today.minutes, planCount: today.videoIds.length }
        : null
    });
  } catch (error) {
    console.error('Error fetching intern config:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/* ------------------------------------------------------------------ */
/* Student surface: status, time slicer, tasks                        */
/* ------------------------------------------------------------------ */
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.isIntern) return res.json({ isIntern: false });
    if (!user.internScope || user.internScope.length === 0) {
      return res.status(409).json({ message: 'Intern scope is not configured yet' });
    }

    const date = istDateKey();
    const entry = await InternDailyEntry.findOne({ student: user._id, date }).lean();
    const planTasks = entry
      ? await InternVideoTask.find({
          student: user._id,
          video: { $in: entry.videoIds }
        })
          .sort({ sheetRow: 1 })
          .lean()
      : [];

    const watched = await InternVideoTask.find({
      student: user._id,
      status: 'watched'
    })
      .select('video')
      .lean();
    const watchedIds = new Set(watched.map((t) => t.video.toString()));

    // First unwatched video outside today's plan — powers the friendly
    // "next video needs X min" message and the playlist-finished state.
    let nextVideo = null;
    const cursor = VideoCatalogItem.find(scopeQuery(user.internScope))
      .sort({ sheetRow: 1 })
      .select('title subject source type durationMin sheetRow')
      .lean()
      .cursor();
    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      if (watchedIds.has(doc._id.toString())) continue;
      nextVideo = doc;
      break;
    }
    await cursor.close();

    res.json({
      isIntern: true,
      scope: user.internScope,
      today: {
        date,
        minutes: entry ? entry.minutes : null,
        totalMinutes: entry ? entry.totalMinutes : 0,
        plan: planTasks
      },
      finishedAll: nextVideo === null
    });
  } catch (error) {
    console.error('Error fetching intern status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/time', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.isIntern) {
      return res.status(403).json({ message: 'Intern mode is not enabled for this account' });
    }
    if (!user.internScope || user.internScope.length === 0) {
      return res.status(409).json({ message: 'Intern scope is not configured yet' });
    }

    const minutes = Number(req.body && req.body.minutes);
    if (
      !Number.isInteger(minutes) ||
      minutes < MIN_MINUTES ||
      minutes > MAX_MINUTES ||
      minutes % STEP_MINUTES !== 0
    ) {
      return res.status(400).json({
        message: `Minutes must be between ${MIN_MINUTES} and ${MAX_MINUTES} in ${STEP_MINUTES}-minute steps`
      });
    }

    // Walk the scope in watch order from the first unwatched video, adding
    // while the total stays within the budget (strict stop — never over).
    const watched = await InternVideoTask.find({
      student: user._id,
      status: 'watched'
    })
      .select('video')
      .lean();
    const watchedIds = new Set(watched.map((t) => t.video.toString()));

    const plan = [];
    let used = 0;
    let nextVideo = null;
    let reason = null;

    const cursor = VideoCatalogItem.find(scopeQuery(user.internScope))
      .sort({ sheetRow: 1 })
      .select('title subject source type durationMin sheetRow')
      .lean()
      .cursor();
    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      if (watchedIds.has(doc._id.toString())) continue;
      if (used + doc.durationMin <= minutes) {
        plan.push(doc);
        used += doc.durationMin;
      } else {
        nextVideo = doc; // first unwatched video that did not fit
        break;
      }
    }
    await cursor.close();

    if (plan.length === 0) {
      reason = nextVideo
        ? 'NEXT_VIDEO_LONGER_THAN_TIME' // friendly "increase your time" message
        : 'PLAYLIST_FINISHED';
    }

    const date = istDateKey();
    await InternDailyEntry.findOneAndUpdate(
      { student: user._id, date },
      {
        minutes,
        videoIds: plan.map((v) => v._id),
        totalMinutes: used
      },
      { upsert: true, new: true }
    );

    if (plan.length > 0) {
      const taskOps = plan.map((v) => ({
        updateOne: {
          filter: { student: user._id, video: v._id },
          update: {
            $setOnInsert: {
              ...taskSnapshot(v),
              status: 'pending',
              firstAllottedAt: new Date()
            }
          },
          upsert: true
        }
      }));
      await InternVideoTask.bulkWrite(taskOps, { ordered: false });
    }

    const tasks = plan.length
      ? await InternVideoTask.find({
          student: user._id,
          video: { $in: plan.map((v) => v._id) }
        })
          .sort({ sheetRow: 1 })
          .lean()
      : [];

    res.json({
      date,
      minutes,
      totalMinutes: used,
      plan: tasks,
      reason,
      nextVideo
    });
  } catch (error) {
    console.error('Error allocating intern time:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/tasks', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.isIntern) {
      return res.status(403).json({ message: 'Intern mode is not enabled for this account' });
    }

    const date = istDateKey();
    const [tasks, entry] = await Promise.all([
      InternVideoTask.find({ student: user._id })
        .sort({ sheetRow: 1 }) // playlist (sheet) order
        .lean(),
      InternDailyEntry.findOne({ student: user._id, date }).lean()
    ]);

    res.json({
      tasks,
      today: entry
        ? { date, minutes: entry.minutes, videoIds: entry.videoIds }
        : null
    });
  } catch (error) {
    console.error('Error listing intern tasks:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/tasks/:taskId/watched', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.isIntern) {
      return res.status(403).json({ message: 'Intern mode is not enabled for this account' });
    }

    const task = await InternVideoTask.findOne({
      _id: req.params.taskId,
      student: user._id
    });
    if (!task) return res.status(404).json({ message: 'Task not found' });

    if (task.status !== 'watched') {
      task.status = 'watched';
      task.watchedAt = new Date();
      await task.save();
    }
    res.json(task);
  } catch (error) {
    console.error('Error marking intern task watched:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/* ------------------------------------------------------------------ */
/* Mentor/admin: interns overview                                      */
/* ------------------------------------------------------------------ */
router.get('/students', auth, authorize('mentor', 'admin'), async (req, res) => {
  try {
    const interns = await User.find({ role: 'student', isIntern: true })
      .select('name email internScope createdAt')
      .lean();

    const date = istDateKey();
    const [taskRows, entries] = await Promise.all([
      InternVideoTask.aggregate([
        {
          $match: {
            student: { $in: interns.map((i) => i._id) }
          }
        },
        {
          $group: {
            _id: { student: '$student', status: '$status' },
            count: { $sum: 1 },
            minutes: { $sum: '$durationMin' }
          }
        }
      ]),
      InternDailyEntry.find({ date }).lean()
    ]);

    const progressByStudent = new Map();
    taskRows.forEach((r) => {
      const key = r._id.student.toString();
      if (!progressByStudent.has(key)) {
        progressByStudent.set(key, { watchedCount: 0, watchedMinutes: 0, pendingCount: 0, pendingMinutes: 0 });
      }
      const p = progressByStudent.get(key);
      if (r._id.status === 'watched') {
        p.watchedCount += r.count;
        p.watchedMinutes += r.minutes;
      } else {
        p.pendingCount += r.count;
        p.pendingMinutes += r.minutes;
      }
    });
    const todayByStudent = new Map(
      entries.map((e) => [e.student.toString(), { minutes: e.minutes, planCount: e.videoIds.length }])
    );

    const scopeCountQueries = interns.map(async (i) => ({
      intern: i,
      scopeVideos: i.internScope && i.internScope.length
        ? await VideoCatalogItem.countDocuments(scopeQuery(i.internScope))
        : 0
    }));
    const withScopeCounts = await Promise.all(scopeCountQueries);

    res.json({
      date,
      interns: withScopeCounts.map(({ intern, scopeVideos }) => {
        const p = progressByStudent.get(intern._id.toString()) || {
          watchedCount: 0,
          watchedMinutes: 0,
          pendingCount: 0,
          pendingMinutes: 0
        };
        return {
          studentId: intern._id,
          name: intern.name,
          email: intern.email,
          scope: intern.internScope,
          today: todayByStudent.get(intern._id.toString()) || null,
          progress: { ...p, scopeVideos, finishedAll: scopeVideos > 0 && scopeVideos === p.watchedCount }
        };
      })
    });
  } catch (error) {
    console.error('Error listing interns:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
