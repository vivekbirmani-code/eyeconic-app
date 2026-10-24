const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const logger = require('./utils/logger');
const { createCorsOptions, createSocketCorsOptions } = require('./config/cors');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const featureGate = require('./middleware/featureGate');
const { isFeatureEnabled } = require('./config/featureAvailability');
const healthRoutes = require('./routes/health');

// Import socket helpers BEFORE routes to avoid circular deps
const socketHelpers = require('./utils/socket-helpers');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const groupRoutes = require('./routes/groups');
const messageRoutes = require('./routes/messages');
const quizRoutes = require('./routes/quizzes');
const questionBankRoutes = require('./routes/question-bank');
const dailyPyqRoutes = require('./routes/daily-pyq');
const miniGtRoutes = require('./routes/mini-gt');
const freeUserAnalyticsRoutes = require('./routes/free-user-analytics');
const subjectRoutes = require('./routes/subjects');
const studentSubjectRoutes = require('./routes/student-subjects');
const mentorStudentRoutes = require('./routes/mentor-students');
const assignmentRoutes = require('./routes/assignments');
const adminOverviewRoutes = require('./routes/admin-overview');
const settingsRoutes = require('./routes/settings');
const uploadRoutes = require('./routes/upload');
const publicQuizRoutes = require('./routes/public-quiz');
const publicLeadRoutes = require('./routes/public-lead');
const publicProctoringRoutes = require('./routes/publicProctoring');
const studentAnalyticsRoutes = require('./routes/student-analytics');
const integrationRoutes = require('./routes/integration');
const { cleanupExpiredMedia } = require('./utils/media-cleanup');
const Call = require('./models/Call');
const User = require('./models/User');
// Proctoring foundation models (plan §26): registering them at startup
// ensures their collections and indexes exist. Sessions are created by the
// /start sequence via utils/proctoring/session.js; consent, events and
// violations get their routes/pipelines in later phases.
require('./models/ProctoringConsent');
require('./models/ProctoringViolation');
require('./models/ProctoringOverride');
require('./models/ProctoringEvent');

const { sendPushNotification, sendPushToUser } = require('./utils/notifications');

const app = express();
const server = http.createServer(app);
// Socket.IO v4 takes CORS options under a `cors` key — passing them at the
// top level silently disables engine.io CORS entirely (no ACAO header on the
// polling handshake), which browsers block for any cross-origin web client.
// Production masked this because the public web client forces websocket-only
// transport (WebSocket upgrades are not CORS-gated); the Expo web app's
// polling-first socket could never connect cross-origin.
const io = socketIo(server, { cors: createSocketCorsOptions() });

// Expose io to routes
app.set('io', io);

// Single reverse proxy (Render/Vercel terminates TLS) — makes req.protocol
// honor X-Forwarded-Proto (share links must be https:// in production) and
// req.ip resolve to the real client for IP rate limiting.
app.set('trust proxy', 1);

// Initialize socket helpers with the io instance
socketHelpers.setIo(io);

// Validate critical environment variables at startup
const validateEnvironment = () => {
  const warnings = [];
  if (!process.env.JWT_SECRET) {
    warnings.push('JWT_SECRET is not set — authentication will fail');
  }
  if (!process.env.MONGODB_URI) {
    warnings.push('MONGODB_URI is not set — database connection will fail');
  }
  const hasResend = Boolean(process.env.RESEND_API_KEY?.trim());
  const hasSmtp = Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  );
  if (!hasResend && !hasSmtp && process.env.NODE_ENV === 'production') {
    warnings.push(
      'RESEND_API_KEY or SMTP credentials are not set — OTP emails (signup, password reset, and the public quiz guest flow) will fail in production'
    );
  }
  warnings.forEach((warning) => logger.warn(warning));
};

validateEnvironment();

// Public quiz links always open the web app now (never an app redirect) —
// log where they resolve so misconfiguration is visible at a glance.
const { getPublicWebAppUrl } = require('./utils/publicWebUrl');
logger.info('Public quiz web app URL', { url: getPublicWebAppUrl() });
if (process.env.NODE_ENV === 'production' && !process.env.WEB_APP_URL?.trim()) {
  logger.warn(
    'WEB_APP_URL is not set — public quiz links fall back to the legacy web origin. Set it to the eyeconic-public-web static site URL (Render dashboard → eyeconic-app-prod → Environment).'
  );
}

// Middleware — CORS must run before auth/body parsing so preflight succeeds.
app.use(cors(createCorsOptions()));
app.use(requestId);
// Increase body size limit for large Excel file uploads (base64 encoded)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Return a clean 400 for malformed JSON instead of an unhandled parser error
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.warn('Malformed JSON request body', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
    });
    return res.status(400).json({
      success: false,
      message: 'Invalid request data.',
      code: 'INVALID_JSON',
      requestId: req.requestId,
    });
  }
  return next(err);
});

// Structured request logging (never log bodies — may contain credentials)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]('HTTP request completed', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    });
  });
  next();
});

// MongoDB connection — mongoose auto-reconnects after the first connect()
const {
  connectDatabase,
  registerDatabaseEventHandlers,
} = require('./utils/database');

registerDatabaseEventHandlers();

// One-time migration for the email-OTP switch: guest OTP challenges were
// keyed by (phone, shareToken) in the SMS flow. Legacy rows are unusable
// after the switch (verify looks up by email) and would block the new
// unique (email, shareToken) index from building, so drop the whole
// collection once — it is 10-minute-TTL ephemera and mongoose recreates it
// with the new indexes. Guarded on the legacy index so later boots never
// touch live email challenges.
const migrateGuestOtpCollection = async () => {
  try {
    const collection = mongoose.connection.collection('guestotps');
    if (await collection.indexExists('phone_1_shareToken_1')) {
      await collection.drop();
      logger.info('Dropped legacy phone-keyed guest OTP collection (email-OTP migration)');
    }
  } catch (error) {
    logger.warn('Guest OTP legacy-index migration skipped', { errorMessage: error.message });
  }
};

// One-time migration for the guest-identity fix: leads used to be deduped by
// their (unverified) phone, which fused household members sharing a number
// into one identity. Identity is now the OTP-verified email. On existing
// deployments this migration (a) merges legacy duplicate-email leads into
// their oldest representative — re-pointing GuestAttempt.guest refs and
// merging quizzesTaken/consent — and (b) swaps the legacy indexes
// (unique `phone_1`, non-unique `email_1`) for the new named ones the
// schema builds (`guest_email_unique_1` unique, `guest_phone_lookup_1`).
// Idempotent: guarded on what actually exists, so later boots no-op.
const migrateGuestIdentityIndexes = async () => {
  try {
    const collection = mongoose.connection.collection('guests');

    // (a) Merge duplicate-email leads BEFORE the unique index exists —
    // otherwise the index build fails and every verify 500s.
    const duplicates = await collection.aggregate([
      { $match: { email: { $nin: [null, ''] } } },
      { $group: { _id: '$email', ids: { $push: '$_id' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();

    for (const group of duplicates) {
      // Oldest doc wins (first-verified identity; keeps firstQuiz semantics).
      const docs = await collection
        .find({ _id: { $in: group.ids } })
        .sort({ createdAt: 1, _id: 1 })
        .toArray();
      const keeper = docs[0];
      const dupes = docs.slice(1).map((d) => d._id);

      // Re-point attempt ownership from the merged-away duplicates to the
      // keeper — on the ATTEMPTS collection, not the leads collection.
      await mongoose.connection.collection('guestattempts').updateMany(
        { guest: { $in: dupes } },
        { $set: { guest: keeper._id } }
      );

      // Dedupe by string key but keep the ORIGINAL ObjectIds — quizzesTaken
      // is an ObjectId ref array and must not gain string entries.
      const mergedQuizzes = [
        ...docs.flatMap((d) => (Array.isArray(d.quizzesTaken) ? d.quizzesTaken : []))
          .reduce((byValue, id) => byValue.set(String(id), id), new Map())
          .values(),
      ];
      const anyConsent = docs.some((d) => d.marketingConsent?.granted === true);
      await collection.updateOne(
        { _id: keeper._id },
        {
          $set: {
            ...(anyConsent && keeper.marketingConsent?.granted !== true
              ? { 'marketingConsent.granted': true, 'marketingConsent.updatedAt': new Date() }
              : {}),
            ...(keeper.firstQuiz ? {} : { firstQuiz: docs.find((d) => d.firstQuiz)?.firstQuiz ?? null }),
          },
          ...(mergedQuizzes.length > 0
            ? { $addToSet: { quizzesTaken: { $each: mergedQuizzes } } }
            : {}),
        }
      );

      await collection.deleteMany({ _id: { $in: dupes } });
      logger.info('Merged duplicate-email guest leads', {
        email: group._id,
        kept: String(keeper._id),
        mergedAway: dupes.map(String),
      });
    }

    // (b) Index swap. Mongoose builds the new named indexes itself; here we
    // only drop the legacy ones and make sure the unique email index landed
    // (its auto-build can fail if it raced this migration's merge).
    for (const name of ['phone_1', 'email_1']) {
      if (await collection.indexExists(name)) {
        await collection.dropIndex(name);
        logger.info('Dropped legacy guest index', { index: name });
      }
    }
    await collection.createIndex(
      { email: 1 },
      { unique: true, name: 'guest_email_unique_1' }
    );
  } catch (error) {
    logger.warn('Guest identity-index migration skipped', { errorMessage: error.message });
  }
};

// One-time migration for the guest-attempt live-uniqueness fix: /start's
// check-then-create raced under load (double-tap, two tabs, StrictMode
// double-mount) and could leave one person with several in_progress
// attempts whose resumes bounced between them. The schema now builds
// unique partial indexes enforcing one live attempt per owner — (quiz,
// guest) for verified leads on any device, (quiz, guestId) for anonymous
// device-keyed attempts. On existing deployments this migration (a)
// removes legacy duplicate live attempts BEFORE the unique indexes build
// (otherwise the build fails), keeping the oldest as the survivor — the
// same earliest-wins rule the /start route applies — and (b) makes sure
// both indexes exist afterwards (mongoose's auto-build can race this
// migration's dedup and fail; an explicit createIndex with the identical
// name+spec repairs it). Idempotent: guarded on what actually exists, so
// later boots no-op.
const migrateGuestAttemptIndexes = async () => {
  try {
    const collection = mongoose.connection.collection('guestattempts');

    const dedupeLive = async (ownerFilter, groupBy) => {
      const duplicates = await collection.aggregate([
        { $match: { status: 'in_progress', ...ownerFilter } },
        { $group: { _id: groupBy, ids: { $push: '$_id' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ]).toArray();

      for (const group of duplicates) {
        // Oldest attempt wins — same tiebreak the /start route uses.
        const docs = await collection
          .find({ _id: { $in: group.ids } })
          .sort({ createdAt: 1, _id: 1 })
          .toArray();
        const losers = docs.slice(1).map((d) => d._id);
        await collection.deleteMany({ _id: { $in: losers } });
        logger.info('Removed duplicate live guest attempt', {
          kept: String(docs[0]._id),
          removed: losers.map(String),
        });
      }
    };

    // (a) Dedupe live attempts per owner key before the unique builds.
    await dedupeLive({ guest: { $type: 'objectId' } }, { quiz: '$quiz', guest: '$guest' });
    await dedupeLive({ guest: null }, { quiz: '$quiz', guestId: '$guestId' });

    // (b) Ensure the indexes landed (same names+specs the schema declares,
    // so deployments where mongoose already built them no-op here).
    await collection.createIndex(
      { quiz: 1, guest: 1 },
      {
        unique: true,
        name: 'guest_attempt_live_lead_unique_1',
        partialFilterExpression: { status: 'in_progress', guest: { $type: 'objectId' } },
      }
    );
    await collection.createIndex(
      { quiz: 1, guestId: 1 },
      {
        unique: true,
        name: 'guest_attempt_live_anon_unique_1',
        partialFilterExpression: { status: 'in_progress', guest: null },
      }
    );
  } catch (error) {
    logger.warn('Guest attempt live-uniqueness migration skipped', { errorMessage: error.message });
  }
};

// One-time migration for the proctoring-consent owner-index split: consent
// rows were uniquely keyed {quiz, student, policyVersion} with a PLAIN unique
// index. Guest consent rows (public-quiz proctoring) carry student:null — a
// plain unique index would treat every second guest's consent for the same
// quiz+policyVersion as a duplicate of the first (the sparse-null trap, the
// same class of bug as the shareToken revoke incident). The schema now
// declares two PARTIAL unique indexes, explicitly named so they cannot
// collide with the legacy default name; on existing deployments this drops
// the legacy index and makes sure both partials exist. Idempotent: guarded
// on what actually exists, so later boots no-op.
const migrateProctoringConsentIndexes = async () => {
  try {
    const collection = mongoose.connection.collection('proctoringconsents');
    const indexes = await collection.listIndexes().toArray().catch(() => []);
    if (indexes.some((idx) => idx.name === 'quiz_1_student_1_policyVersion_1')) {
      await collection.dropIndex('quiz_1_student_1_policyVersion_1');
      logger.info('Dropped legacy proctoring-consent unique index');
    }
    // Same names+specs the schema declares, so deployments where mongoose
    // already built them no-op here.
    await collection.createIndex(
      { quiz: 1, student: 1, policyVersion: 1 },
      {
        unique: true,
        name: 'consent_user_owner_unique_1',
        partialFilterExpression: { student: { $type: 'objectId' } },
      }
    );
    await collection.createIndex(
      { quiz: 1, guest: 1, policyVersion: 1 },
      {
        unique: true,
        name: 'consent_guest_owner_unique_1',
        partialFilterExpression: { guest: { $type: 'objectId' } },
      }
    );
  } catch (error) {
    logger.warn('Proctoring consent-index migration skipped', { errorMessage: error.message });
  }
};

const startDatabase = async () => {
  try {
    await connectDatabase(async () => {
      await migrateGuestOtpCollection();
      await migrateGuestIdentityIndexes();
      await migrateGuestAttemptIndexes();
      await migrateProctoringConsentIndexes();
      cleanupExpiredMedia();
      setInterval(cleanupExpiredMedia, 24 * 60 * 60 * 1000);

      // Overdue-attempt sweep (utils/attemptSweep.js): materializes
      // finalizations for attempts whose owner never touches the API again
      // (app closed past the deadline, quiz window closed mid-attempt). The
      // lazy per-request checks remain the hard enforcement gate; this only
      // advances state the stored deadlines already say is expired. Interval
      // and disable switch are env-configurable for tests/ops.
      if (process.env.QUIZ_SWEEP_DISABLED !== '1') {
        const { runAttemptSweep } = require('./utils/attemptSweep');
        const sweepIntervalMs = Number(process.env.QUIZ_SWEEP_INTERVAL_MS) > 0
          ? Number(process.env.QUIZ_SWEEP_INTERVAL_MS)
          : 60 * 1000;
        setTimeout(runAttemptSweep, 10 * 1000); // first cycle shortly after boot
        setInterval(runAttemptSweep, sweepIntervalMs);
        logger.info('Overdue-attempt sweep scheduled', { intervalMs: sweepIntervalMs });
      }

      // Phase 8 (§30.2) — daily proctoring metrics digest. Dormant until
      // PROCTORING_DIGEST_RECIPIENTS is configured (the sender itself logs a
      // skip when empty); PROCTORING_DIGEST_DISABLED=1 removes the timer
      // entirely. No immediate first run — first digest 24 h after boot, so a
      // restart loop can never email-storm.
      if (process.env.PROCTORING_DIGEST_DISABLED !== '1') {
        const { sendProctoringMetricsDigest } = require('./utils/proctoring/metricsDigest');
        setInterval(sendProctoringMetricsDigest, 24 * 60 * 60 * 1000);
        logger.info('Proctoring metrics digest scheduled (24h)');
      }
    });
  } catch {
    // Retry initial connection only — ongoing reconnects are handled by mongoose.
    setTimeout(startDatabase, 5000);
  }
};

startDatabase();

const { getCloudinaryHealthStatus } = require('./utils/cloudinary');
const cloudinaryHealth = getCloudinaryHealthStatus();
if (!cloudinaryHealth.configured) {
  logger.warn('Cloudinary is not configured — media and profile picture uploads will fail until CLOUDINARY_* env vars or CLOUDINARY_UPLOAD_PRESET are set.', {
    missingVars: cloudinaryHealth.missingVars,
  });
} else if (cloudinaryHealth.mode === 'unsigned_preset') {
  logger.info('Cloudinary unsigned upload preset enabled for media uploads.', {
    cloudName: cloudinaryHealth.cloudName,
    uploadPreset: cloudinaryHealth.uploadPreset,
    canDeleteAssets: cloudinaryHealth.canDeleteAssets,
  });
}

// Health endpoints (no auth required — used by load balancers and monitoring)
app.use('/health', healthRoutes);
app.use('/api/health', healthRoutes);

// Root endpoint — service identity for uptime checks and human verification
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'eyeconic-api',
  });
});

// Routes
//
// TEMPORARY FEATURE FREEZE — quiz-only availability. Routers below are gated
// by middleware/featureGate.js using config/featureAvailability.js: quiz
// routers stay fully live, frozen routers answer 503 FEATURE_DISABLED except
// for the Quiz-workflow dependencies allowlisted in the config. Re-enable a
// feature by flipping its flag in config/featureAvailability.js.
//
// `auth` runs BEFORE the gate on gated routers whose every route is
// authenticated, so expired/invalid sessions still receive the 401 that
// triggers client logout instead of a 503. `/api/settings` is excluded
// because its GET /public probe must stay unauthenticated.
const { auth: authMiddleware } = require('./middleware/auth');
app.use('/api/auth', authRoutes);
app.use('/api/users', authMiddleware, featureGate('userManagement', 'users'), userRoutes);
app.use('/api/groups', authMiddleware, featureGate('chat', 'groups'), groupRoutes);
app.use('/api/messages', authMiddleware, featureGate('chat'), messageRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/daily-pyq', dailyPyqRoutes);
app.use('/api/mini-gt', miniGtRoutes);
app.use('/api/question-bank', questionBankRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/student-subjects', authMiddleware, featureGate('mentorship'), studentSubjectRoutes);
app.use('/api/mentor-students', authMiddleware, featureGate('mentorship'), mentorStudentRoutes);
app.use('/api/assignments', authMiddleware, featureGate('mentorship', 'assignments'), assignmentRoutes);
app.use('/api/admin-overview', authMiddleware, featureGate('adminOverview'), adminOverviewRoutes);
app.use('/api/settings', featureGate('userManagement', 'settings'), settingsRoutes);
app.use('/api/upload', authMiddleware, featureGate('chat', 'upload'), uploadRoutes);
app.use('/api/public', publicQuizRoutes);
app.use('/api/public', publicLeadRoutes);
app.use('/api/public', publicProctoringRoutes);
app.use('/api/student-analytics', studentAnalyticsRoutes);
// Free Login User Dashboard (website Feature 08) — read-only mentor/admin
// analytics over the free-user population. Ungated like daily-pyq: it only
// reads the quiz ecosystem's own collections and enforces its own
// mentor/admin authorization internally.
app.use('/api/free-user-analytics', freeUserAnalyticsRoutes);
// Website (eyeconicneetpg.com) integration — versioned service-to-service
// surface for app → website session handoff. Own feature flag; every route
// inside is service-token authenticated (middleware/serviceAuth.js).
app.use('/api/integration/v1', featureGate('integration'), integrationRoutes);

// Track socket to user mapping (socket.id -> userId)
const socketUserMap = new Map();
const Group = require('./models/Group');
const Message = require('./models/Message');

const formatCallDurationLabel = (seconds = 0) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins} min ${secs} sec`;
};

const getCallDurationSeconds = (startTime, endTime) => {
  if (!startTime || !endTime) return 0;
  const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  return Math.max(0, Math.floor(durationMs / 1000));
};

const emitCallEventMessage = async ({
  groupId,
  senderId,
  senderName,
  messageType,
  content,
  callId,
  callDurationSeconds = 0
}) => {
  if (!groupId || !senderId) return;
  try {
    const callMessage = new Message({
      group: groupId,
      sender: senderId,
      content,
      messageType,
      callId,
      callDurationSeconds
    });
    await callMessage.save();

    const payload = {
      _id: callMessage._id,
      group: callMessage.group,
      sender: { _id: senderId, name: senderName || 'Unknown' },
      content: callMessage.content,
      messageType,
      callId,
      callDurationSeconds,
      createdAt: callMessage.createdAt
    };

    io.to(groupId.toString()).emit('receive_message', payload);
  } catch (error) {
    console.error('Error saving call message:', error);
  }
};

const emitCallMessageUpdate = (groupId, message) => {
  if (!groupId || !message) return;

  const sender =
    message.sender && message.sender._id
      ? { _id: message.sender._id, name: message.sender.name || 'Unknown' }
      : message.sender;

  io.to(groupId.toString()).emit('message_updated', {
    _id: message._id,
    group: message.group,
    sender,
    content: message.content,
    messageType: message.messageType,
    callId: message.callId,
    callDurationSeconds: message.callDurationSeconds,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt
  });
};

const finalizeCallEventMessage = async ({
  groupId,
  callId,
  finalMessageType,
  content,
  callDurationSeconds = 0,
  fallbackSenderId,
  fallbackSenderName
}) => {
  if (!groupId || !callId || !finalMessageType) return;

  try {
    // Robust ID conversion to ensure query works with both string and ObjectId types
    const queryGroupId = new mongoose.Types.ObjectId(groupId.toString());
    const queryCallId = new mongoose.Types.ObjectId(callId.toString());

    const callStartMessage = await Message.findOne({
      group: queryGroupId,
      callId: queryCallId,
      messageType: 'call_start'
    })
      .sort({ createdAt: -1 })
      .populate('sender', 'name profilePicture');

    if (callStartMessage) {
      callStartMessage.messageType = finalMessageType;
      callStartMessage.content = content;
      callStartMessage.callDurationSeconds = callDurationSeconds;
      await callStartMessage.save();
      emitCallMessageUpdate(groupId, callStartMessage);
      return;
    }

    await emitCallEventMessage({
      groupId,
      senderId: fallbackSenderId,
      senderName: fallbackSenderName,
      messageType: finalMessageType,
      content,
      callId,
      callDurationSeconds
    });
  } catch (error) {
    console.error('Error finalizing call message:', error);
  }
};

// Socket.IO for real-time chat and calls
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // ---- Socket identity (registration) ----------------------------------
  // register_user maps a connection to a userId so emitToUser() can deliver
  // targeted events (quiz_submitted, alerts, calls). That mapping IS identity,
  // so it is proven with the caller's user JWT — exactly like every HTTP
  // route — and never taken from a client-claimed id:
  //   - token from `io(url, { auth: { token } })` (handshake) or as the
  //     second argument of register_user(userId, token);
  //   - the socket is registered under the TOKEN's subject, so a claimed
  //     mismatching userId is ignored (and logged);
  //   - no/invalid token → registration refused (register_rejected). Legacy
  //     builds that emit only register_user(userId) lose nothing they can
  //     verify: targeted emissions fall back to the push notifications the
  //     same routes already send, and new_quiz_assigned stays a broadcast.
  const registerVerifiedSocket = async (token, claimedUserId) => {
    const verified = socketHelpers.verifySocketToken(token);
    if (!verified.ok) {
      socket.emit('register_rejected', {
        message: 'Socket registration requires a valid user token.',
      });
      console.warn(`Socket ${socket.id} registration rejected (no/invalid token)`);
      return;
    }

    const userIdStr = verified.userId;
    if (claimedUserId && claimedUserId.toString() !== userIdStr) {
      // The token wins. A mismatch means a buggy client or a probe.
      console.warn(
        `Socket ${socket.id} claimed user ${claimedUserId} but token belongs to ${userIdStr} — registering as the token subject`
      );
    }

    socketUserMap.set(socket.id, userIdStr);
    socket.userId = userIdStr;
    socketHelpers.registerSocket(socket.id, userIdStr);
    console.log(`User ${userIdStr} registered with socket ${socket.id}`);

    // Auto-join all groups user belongs to (for receiving calls globally)
    try {
      const groups = await Group.find({ members: userIdStr }).select('_id');
      groups.forEach(group => {
        socket.join(group._id.toString());
      });
      console.log(`User ${userIdStr} joined ${groups.length} group rooms`);
    } catch (error) {
      console.error('Error auto-joining groups:', error);
    }
  };

  // ---- Guest (public-quiz) lane -----------------------------------------
  // An OTP-verified lead's session token registers the socket in the GUEST
  // map (socket-helpers guestSocketMap) — a deliberately SEPARATE lane from
  // users: a guest socket can only ever receive emissions targeted at its
  // own verified guest id (live proctoring warnings, public-quiz Phase 2),
  // and joins NO rooms (no chat/call/leaderboard access for guests). Same
  // identity doctrine as the user lane: proven from the token, never claimed.
  const registerGuestSocketFromToken = (token) => {
    const verified = socketHelpers.verifyGuestSocketToken(token);
    if (!verified.ok) return false;
    socket.guestId = verified.guestId;
    socketHelpers.registerGuestSocket(socket.id, verified.guestId);
    console.log(`Guest ${verified.guestId} registered with socket ${socket.id}`);
    return true;
  };

  // Clients that pass the token in the handshake are registered immediately.
  // User lane first; a valid GUEST session token registers the guest lane
  // instead (a guest token is a fine credential — it simply belongs to the
  // public lane, so it never draws a register_rejected).
  const handshakeToken = socket.handshake?.auth?.token;
  if (handshakeToken) {
    if (socketHelpers.verifySocketToken(handshakeToken).ok) {
      registerVerifiedSocket(handshakeToken, null);
    } else if (!registerGuestSocketFromToken(handshakeToken)) {
      socket.emit('register_rejected', {
        message: 'Socket registration requires a valid user or guest token.',
      });
      console.warn(`Socket ${socket.id} registration rejected (no/invalid token)`);
    }
  }

  // Register user with socket and auto-join all their group rooms.
  // For sockets already registered via a verified handshake token, the legacy
  // register_user(userId) echo is a no-op; an explicit token argument always
  // goes through full verification.
  socket.on('register_user', async (userId, token) => {
    if (!token && socket.userId) {
      // Already proven at connect time — keep that registration.
      return;
    }
    await registerVerifiedSocket(token || socket.handshake?.auth?.token, userId);
  });

  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);
  });

  socket.on('leave_room', (roomId) => {
    socket.leave(roomId);
    console.log(`User ${socket.id} left room ${roomId}`);
  });

  // ============ LIVE LEADERBOARD ROOMS ============
  // Admins/mentors watching a test's leaderboard in Test Analytics. Requires
  // a registered socket (register_user sets socket.userId) and a server-side
  // role check, so student sockets can never listen in on class rankings.
  // quiz_leaderboard_updated is emitted to these rooms on submission.
  const leaderboardRoom = (quizId) =>
    typeof quizId === 'string' && /^[a-f\d]{24}$/i.test(quizId)
      ? `leaderboard:${quizId}`
      : null;

  socket.on('join_leaderboard', async (quizId) => {
    const room = leaderboardRoom(quizId);
    if (!room || !socket.userId) return;

    try {
      const user = await User.findById(socket.userId).select('role');
      if (!user || (user.role !== 'admin' && user.role !== 'mentor')) {
        socket.emit('leaderboard_error', { message: 'Not authorized to view leaderboards.' });
        return;
      }
      socket.join(room);
      socket.emit('leaderboard_joined', { quizId });
      console.log(`User ${socket.userId} joined leaderboard room ${room}`);
    } catch (error) {
      console.error('join_leaderboard error:', error);
    }
  });

  socket.on('leave_leaderboard', (quizId) => {
    const room = leaderboardRoom(quizId);
    if (room) {
      socket.leave(room);
      console.log(`User ${socket.userId || socket.id} left leaderboard room ${room}`);
    }
  });

  // TEMPORARY FEATURE FREEZE — chat/call client events are inert while the
  // feature is disabled (see config/featureAvailability.js). Connections,
  // register_user and room joins stay open so quiz emissions
  // (new_quiz_assigned / quiz_submitted) keep working.
  const chatFeatureDisabled = () => {
    if (isFeatureEnabled('chat')) {
      return false;
    }
    socket.emit('feature_disabled', {
      feature: 'chat',
      message:
        'This feature is temporarily unavailable and will be enabled in a future version.',
    });
    return true;
  };

  socket.on('send_message', (data) => {
    if (chatFeatureDisabled()) return;
    socket.to(data.groupId).emit('receive_message', data);
  });

  socket.on('message_updated', (data) => {
    if (chatFeatureDisabled()) return;
    socket.to(data.groupId).emit('message_updated', data);
  });

  socket.on('message_deleted', (data) => {
    if (chatFeatureDisabled()) return;
    socket.to(data.groupId).emit('message_deleted', data);
  });

  // ============ CALL SIGNALING EVENTS ============

  // Initiate a call
  socket.on('call_initiate', async (data) => {
    if (chatFeatureDisabled()) return;
    const { groupId, groupName, targetUserIds } = data;

    // Identity comes from the VERIFIED socket registration, never from the
    // payload's initiatorId — a client must not be able to place calls (or
    // attribute them to someone else) by naming another user.
    const initiatorId = socket.userId;
    if (!initiatorId) {
      socket.emit('call_error', { message: 'Socket is not registered.' });
      return;
    }

    try {
      // Validate initiator role
      const initiator = await User.findById(initiatorId);
      if (!initiator || initiator.role === 'student') {
        console.warn(`User ${initiatorId} attempted to initiate a call but is a student or not found.`);
        socket.emit('call_error', { message: 'Students are not allowed to initiate calls.' });
        return;
      }
      const initiatorName = initiator.name;

      // Create call record
      const call = new Call({
        groupId,
        initiator: initiatorId,
        participants: [{ userId: initiatorId, userName: initiatorName, joinedAt: new Date() }],
        targetUserIds: targetUserIds || []
      });
      await call.save();

      // Notify ONLY targeted users about the incoming call (not the whole group room)
      const callPayload = {
        callId: call._id,
        groupId,
        groupName,
        initiatorId,
        initiatorName,
        targetUserIds
      };

      if (targetUserIds && targetUserIds.length > 0) {
        // Emit only to each selected target user's socket(s)
        for (const targetId of targetUserIds) {
          if (targetId.toString() !== initiatorId.toString()) {
            socketHelpers.emitToUser(targetId, 'incoming_call', callPayload);
          }
        }
      } else {
        // Fallback: no targets specified -> ring the whole group (original behavior for "call all")
        socket.to(groupId).emit('incoming_call', callPayload);
      }


      await emitCallEventMessage({
        groupId,
        senderId: initiatorId,
        senderName: initiatorName,
        messageType: 'call_start',
        content: `${initiatorName} started a call`,
        callId: call._id,
        callDurationSeconds: 0
      });

      // Send push notifications to all target users (for when app is closed)
      if (targetUserIds && targetUserIds.length > 0) {
        const users = await User.find({
          _id: { $in: targetUserIds, $ne: initiatorId },
          $or: [{ pushToken: { $ne: null } }, { fcmToken: { $ne: null } }]
        }).select('pushToken fcmToken');

        for (const user of users) {
          sendPushToUser({
            expoPushToken: user.pushToken,
            fcmToken: user.fcmToken,
            title: 'Incoming Call',
            body: `${initiatorName} is calling...`,
            data: {
              type: 'incoming_call',
              callId: call._id.toString(),
              groupId,
              groupName,
              initiatorId,
              initiatorName,
              callerName: initiatorName,
            },
          });
        }
      }

      // Send call ID back to initiator
      socket.emit('call_initiated', { callId: call._id });

      console.log(`Call ${call._id} initiated in group ${groupId}`);
    } catch (error) {
      console.error('Error initiating call:', error);
      socket.emit('call_error', { message: 'Failed to initiate call' });
    }
  });

  // Send WebRTC offer
  socket.on('call_offer', (data) => {
    if (chatFeatureDisabled()) return;
    const { callId, groupId, targetUserId, offer, fromUserId } = data;
    socket.to(groupId).emit('call_offer', {
      callId,
      offer,
      fromUserId
    });
  });

  // Send WebRTC answer
  socket.on('call_answer', (data) => {
    if (chatFeatureDisabled()) return;
    const { callId, groupId, answer, fromUserId, toUserId } = data;
    socket.to(groupId).emit('call_answer', {
      callId,
      answer,
      fromUserId
    });
  });

  // Send ICE candidate
  socket.on('call_ice_candidate', (data) => {
    if (chatFeatureDisabled()) return;
    const { callId, groupId, candidate, fromUserId } = data;
    socket.to(groupId).emit('call_ice_candidate', {
      callId,
      candidate,
      fromUserId
    });
  });

  // Join an active call
  socket.on('call_join', async (data) => {
    if (chatFeatureDisabled()) return;
    const { callId, userId, userName } = data;

    try {
      const call = await Call.findById(callId);
      if (call && call.status === 'active') {
        // Add participant if not already in
        const existingParticipant = call.participants.find(
          p => p.userId.toString() === userId && !p.leftAt
        );

        if (!existingParticipant) {
          call.participants.push({ userId, userName, joinedAt: new Date() });
          await call.save();
        }

        // Join the socket room for this group
        socket.join(call.groupId.toString());

        // Notify others in the call
        socket.to(call.groupId.toString()).emit('call_user_joined', {
          callId,
          userId,
          userName
        });

        // Send current participants list back to joiner
        const activeParticipants = call.participants
          .filter(p => !p.leftAt)
          .map(p => ({
            userId: p.userId.toString(),
            userName: p.userName || 'Unknown',
            isMuted: p.isMuted || false
          }));

        socket.emit('call_joined', {
          callId,
          participants: activeParticipants,
          groupId: call.groupId.toString(),
          startTime: call.startTime
        });

        console.log(`User ${userName} joined call ${callId}`);
      }
    } catch (error) {
      console.error('Error joining call:', error);
    }
  });

  // Leave a call
  socket.on('call_leave', async (data) => {
    if (chatFeatureDisabled()) return;
    const { callId, userId } = data;

    try {
      const call = await Call.findById(callId);
      if (call) {
        // Mark participant as left
        const participant = call.participants.find(
          p => p.userId.toString() === userId && !p.leftAt
        );
        if (participant) {
          participant.leftAt = new Date();
          await call.save();
        }

        // Notify others
        socket.to(call.groupId.toString()).emit('call_user_left', {
          callId,
          userId
        });

        // Check if call is empty
        const wasActiveCall = call.status === 'active';
        const activeParticipants = call.participants.filter(p => !p.leftAt);
        if (wasActiveCall && activeParticipants.length === 0) {
          call.status = 'ended';
          call.endTime = new Date();
          await call.save();

          const durationSeconds = getCallDurationSeconds(call.startTime, call.endTime);
          const durationStr = formatCallDurationLabel(durationSeconds);
          const hasOtherParticipants = call.participants.some(
            p => p.userId.toString() !== call.initiator.toString()
          );

          if (hasOtherParticipants) {
            const leaver = await User.findById(userId);
            const leaverName = leaver?.name || 'Unknown';
            await finalizeCallEventMessage({
              groupId: call.groupId,
              callId,
              finalMessageType: 'call_end',
              content: `Call ended - Duration: ${durationStr}`,
              callDurationSeconds: durationSeconds,
              fallbackSenderId: leaver?._id || userId,
              fallbackSenderName: leaverName
            });
          } else {
            const initiatorUser = await User.findById(call.initiator);
            const initiatorName = initiatorUser?.name || 'Unknown';
            await finalizeCallEventMessage({
              groupId: call.groupId,
              callId,
              finalMessageType: 'call_missed',
              content: `${initiatorName} missed a call`,
              callDurationSeconds: durationSeconds,
              fallbackSenderId: call.initiator,
              fallbackSenderName: initiatorName
            });
          }
          socket.to(call.groupId.toString()).emit('call_ended', { callId });
        }
      }
    } catch (error) {
      console.error('Error leaving call:', error);
    }
  });

  // Toggle mute
  socket.on('call_mute', async (data) => {
    if (chatFeatureDisabled()) return;
    const { callId, userId, isMuted } = data;

    try {
      const call = await Call.findById(callId);
      if (call) {
        const participant = call.participants.find(
          p => p.userId.toString() === userId && !p.leftAt
        );
        if (participant) {
          participant.isMuted = isMuted;
          await call.save();
        }

        socket.to(call.groupId.toString()).emit('call_user_muted', {
          callId,
          userId,
          isMuted
        });
      }
    } catch (error) {
      console.error('Error toggling mute:', error);
    }
  });

  // End call for everyone
  socket.on('call_end', async (data) => {
    if (chatFeatureDisabled()) return;
    const { callId, endedBy, endedByName } = data;

    try {
      const call = await Call.findById(callId);
      if (call && call.status === 'active') {
        call.status = 'ended';
        call.endTime = new Date();
        call.participants.forEach(p => {
          if (!p.leftAt) p.leftAt = new Date();
        });
        await call.save();

        const durationSeconds = getCallDurationSeconds(call.startTime, call.endTime);
        const durationStr = formatCallDurationLabel(durationSeconds);

        const hasOtherParticipants = call.participants.some(
          p => p.userId.toString() !== call.initiator.toString()
        );

        if (hasOtherParticipants) {
          await finalizeCallEventMessage({
            groupId: call.groupId,
            callId: call._id,
            finalMessageType: 'call_end',
            content: `Call ended - Duration: ${durationStr}`,
            callDurationSeconds: durationSeconds,
            fallbackSenderId: endedBy || call.initiator,
            fallbackSenderName: endedByName || 'Unknown'
          });
        } else {
          const initiatorUser = await User.findById(call.initiator);
          const initiatorName = initiatorUser?.name || endedByName || 'Unknown';
          await finalizeCallEventMessage({
            groupId: call.groupId,
            callId: call._id,
            finalMessageType: 'call_missed',
            content: `${initiatorName} missed a call`,
            callDurationSeconds: durationSeconds,
            fallbackSenderId: call.initiator,
            fallbackSenderName: initiatorName
          });
        }

        socket.to(call.groupId.toString()).emit('call_ended', { callId });
        socket.emit('call_ended', { callId });

        console.log(`Call ${callId} ended, duration: ${durationStr}`);
      }
    } catch (error) {
      console.error('Error ending call:', error);
    }
  });

  // Decline an incoming call
  socket.on('call_decline', async (data) => {
    if (chatFeatureDisabled()) return;
    const { callId, userId, groupId } = data;
    console.log(`User ${userId} declined call ${callId}`);

    try {
      // Notify the initiator or the group that the user declined
      if (groupId) {
        socket.to(groupId.toString()).emit('call_declined', {
          callId,
          userId
        });
      }

      // If it's a 1-on-1 call, we should finalize the message as 'call_declined'
      const call = await Call.findById(callId);
      if (call && call.status === 'active' && call.targetUserIds && call.targetUserIds.length === 1) {
        // End the call record
        call.status = 'ended';
        call.endTime = new Date();
        await call.save();

        // Finalize the chat message
        const decliner = await User.findById(userId);
        const declinerName = decliner?.name || 'User';
        
        await finalizeCallEventMessage({
          groupId: call.groupId,
          callId: call._id,
          finalMessageType: 'call_declined',
          content: `${declinerName} declined the call`,
          callDurationSeconds: 0,
          fallbackSenderId: userId,
          fallbackSenderName: declinerName
        });

        // Notify everyone to clear their UI
        io.to(call.groupId.toString()).emit('call_ended', { callId: call._id });
        console.log(`Call ${callId} ended due to decline in 1-on-1`);
      }
    } catch (error) {
      console.error('Error declining call:', error);
    }
  });

  // Get active call for a group
  socket.on('get_active_call', async (data) => {
    if (chatFeatureDisabled()) return;
    const { groupId } = data;

    try {
      const call = await Call.findOne({
        groupId,
        status: 'active'
      }).populate('participants.userId', 'name');

      socket.emit('active_call', { call });
    } catch (error) {
      console.error('Error getting active call:', error);
    }
  });

  socket.on('disconnect', async () => {
    const userId = socketUserMap.get(socket.id);
    socketUserMap.delete(socket.id);
    socketHelpers.unregisterSocket(socket.id, userId);
    if (socket.guestId) {
      socketHelpers.unregisterGuestSocket(socket.id, socket.guestId);
    }
    console.log('User disconnected:', socket.id);

    // If user was in an active call, handle their departure
    if (userId) {
      try {
        // Find all active calls where this user is a participant
        const activeCalls = await Call.find({
          'participants.userId': userId,
          status: 'active'
        });

        for (const call of activeCalls) {
          // Effectively trigger the 'call_leave' logic for each active call
          const participant = call.participants.find(
            p => p.userId.toString() === userId && !p.leftAt
          );

          if (participant) {
            participant.leftAt = new Date();
            await call.save();

            // Notify others in the group
            socket.to(call.groupId.toString()).emit('call_user_left', {
              callId: call._id,
              userId
            });

            // If this was the last active participant, end the call
            const activeParticipants = call.participants.filter(p => !p.leftAt);
            if (activeParticipants.length === 0) {
              call.status = 'ended';
              call.endTime = new Date();
              await call.save();

              const durationSeconds = getCallDurationSeconds(call.startTime, call.endTime);
              const durationStr = formatCallDurationLabel(durationSeconds);

              // Update the call message in chat
              const hasOtherParticipants = call.participants.some(
                p => p.userId.toString() !== call.initiator.toString()
              );

              if (hasOtherParticipants) {
                await finalizeCallEventMessage({
                  groupId: call.groupId,
                  callId: call._id,
                  finalMessageType: 'call_end',
                  content: `Call ended - Duration: ${durationStr}`,
                  callDurationSeconds: durationSeconds,
                  fallbackSenderId: userId,
                  fallbackSenderName: participant.userName || 'Unknown'
                });
              } else {
                const initiatorUser = await User.findById(call.initiator);
                await finalizeCallEventMessage({
                  groupId: call.groupId,
                  callId: call._id,
                  finalMessageType: 'call_missed',
                  content: `${initiatorUser?.name || 'User'} missed a call`,
                  callDurationSeconds: durationSeconds,
                  fallbackSenderId: call.initiator,
                  fallbackSenderName: initiatorUser?.name || 'Unknown'
                });
              }
              socket.to(call.groupId.toString()).emit('call_ended', { callId: call._id });
            }
          }
        }
      } catch (error) {
        console.error('Error handling call cleanup on disconnect:', error);
      }
    }
  });
});

const notFoundResponse = (req, res) => {
  res.status(404).json({
    message: 'The requested resource was not found.',
    code: 'NOT_FOUND',
    requestId: req.requestId,
  });
};

// 404 handler for unknown API routes
app.use('/api', notFoundResponse);

// 404 handler for all other unknown routes (avoids Express HTML "Cannot GET /path")
app.use(notFoundResponse);

// Global error handler — must be last
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      let owningPid = null;
      try {
        const { execSync } = require('child_process');
        if (process.platform === 'win32') {
          const listenLines = execSync('netstat -ano', { encoding: 'utf8' })
            .split('\n')
            .filter((line) => line.includes(`:${PORT} `) && line.includes('LISTENING'));
          if (listenLines.length > 0) {
            owningPid = listenLines[0].trim().split(/\s+/).pop();
          }
        } else {
          owningPid =
            execSync(`lsof -t -i :${PORT} -sTCP:LISTEN`, {
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
            })
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)[0] || null;
        }
      } catch (lookupError) {
        // PID lookup is best-effort; the manual command below works without it
      }

      logger.error(`Port ${PORT} is already in use${owningPid ? ` by PID ${owningPid}` : ''}.`, {
        port: PORT,
        owningPid,
        hint: owningPid
          ? `Stop it and restart: ${process.platform === 'win32' ? `Stop-Process -Id ${owningPid} -Force` : `kill -9 ${owningPid}`}`
          : `Find the holder: ${process.platform === 'win32' ? `Get-NetTCPConnection -LocalPort ${PORT} -State Listen` : `lsof -i :${PORT}`}`,
      });
    } else {
      logger.error('Server failed to start', { port: PORT, code: error.code, errorMessage: error.message });
    }
    process.exit(1);
  });

  server.listen(PORT, () => {
    logger.info('Server started', { port: PORT, nodeEnv: process.env.NODE_ENV || 'development' });
  });
}

module.exports = { app, server };

