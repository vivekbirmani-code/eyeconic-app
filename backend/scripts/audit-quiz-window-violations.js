// READ-ONLY production audit: find quiz-window violations.
// Never writes. Uses the same MONGODB_URI as the backend (.env).
// Covers registered (quizattempts) AND guest (guestattempts) attempts vs the
// quiz's internal window (scheduledDate/expiryDate) and, for guests, the
// public link expiry (publicExpiryDate).
//
// Origin: 2026-11-15 bug report "quizzes never follow their Start/End times".
// First run found 13 guest attempts started before scheduledDate and 18
// ended after expiryDate — all via public share links (strict-window fix:
// backend/utils/publicQuizAccess.js + durationEnforcement publicMode).
// Re-run after deploying that fix: counts should stay flat for NEW attempts
// and lingering in_progress rows should drop to 0 once the 60s sweep runs.
// Usage: cd backend && node scripts/audit-quiz-window-violations.js
require('dotenv').config();
const mongoose = require('mongoose');

const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = 'test';

(async () => {
  await mongoose.connect(MONGO, { dbName: DB_NAME });
  const db = mongoose.connection.db;
  const quizzes = db.collection('quizzes');

  const withWindow = await quizzes.find({
    isActive: true, isDeleted: { $ne: true },
    $or: [{ scheduledDate: { $type: 'date' } }, { expiryDate: { $type: 'date' } }],
  }, { projection: { title: 1, scheduledDate: 1, expiryDate: 1, createdAt: 1, updatedAt: 1, testType: 1, shareToken: 1, publicExpiryDate: 1 } })
    .sort({ createdAt: -1 }).limit(500).toArray();
  console.log(`Quizzes (active, with internal window): ${withWindow.length}`);

  const now = new Date();
  const summarize = async (label, collectionName) => {
    const attempts = db.collection(collectionName);
    let violStart = 0, violEnd = 0, violLingering = 0, total = 0;
    const samples = [];
    for (const q of withWindow) {
      const atts = attempts.find(
        collectionName === 'guestattempts'
          ? { quiz: q._id }
          : { quiz: q._id },
        { projection: { startTime: 1, endTime: 1, status: 1, createdAt: 1 } }
      ).limit(3000);
      for await (const a of atts) {
        total++;
        if (q.scheduledDate && a.startTime && a.startTime < q.scheduledDate) {
          violStart++;
          if (samples.length < 15) samples.push({ kind: 'STARTED_EARLY', quiz: q.title, start: q.scheduledDate.toISOString(), attemptStart: a.startTime.toISOString(), status: a.status, shared: Boolean(q.shareToken) });
        }
        if (q.expiryDate && a.endTime && a.endTime > q.expiryDate) {
          violEnd++;
          if (samples.length < 15) samples.push({ kind: 'ENDED_LATE', quiz: q.title, end: q.expiryDate.toISOString(), attemptEnd: a.endTime.toISOString(), status: a.status, shared: Boolean(q.shareToken) });
        }
        if (q.expiryDate && a.status === 'in_progress' && now > new Date(q.expiryDate.getTime() + 5 * 60000)) {
          violLingering++;
          if (samples.length < 15) samples.push({ kind: 'LINGERING', quiz: q.title, end: q.expiryDate.toISOString(), status: a.status, shared: Boolean(q.shareToken) });
        }
      }
    }
    console.log(`\n=== ${label} (${collectionName}) — scanned ${total} ===`);
    console.log(`Started BEFORE scheduledDate: ${violStart}`);
    console.log(`endTime AFTER expiryDate:     ${violEnd}`);
    console.log(`in_progress past expiry:      ${violLingering}`);
    if (samples.length) console.log(JSON.stringify(samples, null, 2));
  };

  await summarize('REGISTERED attempts', 'quizattempts');
  await summarize('GUEST attempts', 'guestattempts');

  // Shared quizzes with internal windows (population exposed by gap A)
  const shared = withWindow.filter(q => q.shareToken);
  console.log(`\nShared (public-link) quizzes WITH internal window: ${shared.length}`);
  for (const q of shared.slice(0, 10)) {
    console.log(` - ${q.title} | start=${q.scheduledDate?.toISOString() || '-'} end=${q.expiryDate?.toISOString() || '-'} linkExp=${q.publicExpiryDate?.toISOString() || '-'}`);
  }

  // Window quizzes edited after creation (dates possibly changed post-hoc)
  const edited = withWindow.filter(q => q.updatedAt - q.createdAt > 60000).length;
  console.log(`\nWindow quizzes edited after creation: ${edited}/${withWindow.length}`);

  // Legacy window-less shared quizzes, for context
  const sharedNoWindow = await quizzes.countDocuments({ isActive: true, isDeleted: { $ne: true }, shareToken: { $type: 'string' }, scheduledDate: null, expiryDate: null });
  console.log(`Shared quizzes with NO internal window: ${sharedNoWindow}`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
