const mongoose = require('mongoose');

// Proctoring session — 1:1 with a QuizAttempt (unique {attempt} index),
// created inside the /start sequence, never earlier (plan §26.1, §7).
//
// State is server-authoritative only (§7.4):
//   (absent) → ACTIVE on /start success (ensureProctoringSession)
//   ACTIVE ⇄ DEGRADED on server-computed session-health rules (later phases)
//   ACTIVE | DEGRADED → CLOSED on attempt finalize (any path)
//   ACTIVE → CLOSED_FAILED only if an attempt is administratively voided
// Every transition is appended to `transitions` with a reason and timestamp.
//
// No evidence/images exist anywhere in this schema by design (plan §4.4).

const transitionSchema = new mongoose.Schema({
  from: { type: String, default: null },
  to: { type: String, required: true },
  reason: { type: String },
  at: { type: Date, required: true },
}, { _id: false });

const proctoringSessionSchema = new mongoose.Schema({
  quiz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
  },
  attempt: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuizAttempt',
    required: true,
    unique: true, // the 1:1 anchor — duplicate/concurrent starts converge here
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // Discriminator for a future guest surface (V2); registered attempts use 'user'.
  ownerKind: {
    type: String,
    enum: ['user', 'guest'],
    default: 'user',
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'DEGRADED', 'CLOSED', 'CLOSED_FAILED'],
    default: 'ACTIVE',
  },
  // Identity of the frozen policy this session enforces. The full policy
  // snapshot lives on the attempt (attempt.proctoringSnapshot) — this records
  // which version/hash that snapshot carried at session creation.
  policy: {
    version: { type: Number, default: null },
    hash: { type: String, default: null },
  },
  startedAt: {
    type: Date,
    default: Date.now,
  },
  endedAt: {
    type: Date,
  },
  // Precheck baseline (captured in a later phase; kept for schema stability).
  baseline: {
    capturedAt: { type: Date },
    faceBox: { type: mongoose.Schema.Types.Mixed },
    nominalHeadPose: { type: mongoose.Schema.Types.Mixed },
    interOcularPx: { type: Number },
    detectorTier: { type: String },
    calibration: {
      type: String,
      enum: ['captured', 'fallback'],
    },
  },
  // Deterrence actually applied (platform-honest record, plan §15.2).
  deterrence: {
    screenCapturePrevention: {
      type: String,
      enum: ['android-flagsecure', 'ios-detect-only', 'unsupported', 'disabled'],
    },
  },
  // Session health (heartbeat machinery arrives in a later phase).
  sessionHealth: {
    lastSeenAt: { type: Date },
    heartbeatIntervalMs: { type: Number },
    timeoutMs: { type: Number },
    missedIntervals: { type: Number, default: 0 },
  },
  // Integrity markers for honest reporting (§16.4) — server-computed only.
  integrity: {
    heartbeatsMissed: { type: Number, default: 0 },
    batchesRejected: { type: Number, default: 0 },
    floodFlagged: { type: Boolean, default: false },
    detectorFallback: { type: Boolean, default: false },
    unmonitoredIntervals: [{
      _id: false,
      from: { type: Date },
      to: { type: Date },
      cause: { type: String },
    }],
  },
  // Risk is computed server-side only, replay-derived from the event log —
  // never accepted from clients (§19.1). Populated by later phases.
  riskScore: { type: Number, default: 0 },
  riskCategory: {
    type: String,
    enum: ['normal', 'low', 'moderate', 'high', 'critical'],
  },
  riskBreakdown: { type: mongoose.Schema.Types.Mixed },
  // Denormalized {type: n} counts for cheap summaries (later phases).
  eventCounts: { type: mongoose.Schema.Types.Mixed },
  violationsCount: { type: Number, default: 0 },
  summary: { type: mongoose.Schema.Types.Mixed },
  integrityStatus: {
    type: String,
    enum: ['pending', 'clean', 'reviewed_ok', 'reviewed_concern'],
    default: 'pending',
  },
  // Phase 7 (§25.4) — the human review decision of record. Admin-written
  // only; the platform NEVER alters marks (reviewAdjustedScore is a
  // display-only value shown alongside the original).
  review: {
    status: {
      type: String,
      enum: ['confirmed', 'dismissed', 'escalated'],
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    note: { type: String, maxlength: 1000 },
  },
  reviewAdjustedScore: {
    score: { type: Number, min: 0 },
    totalMarks: { type: Number, min: 0 },
  },
  transitions: [transitionSchema],
}, {
  timestamps: true,
});

proctoringSessionSchema.index({ quiz: 1, status: 1 });
proctoringSessionSchema.index({ student: 1, startedAt: -1 });
proctoringSessionSchema.index({ quiz: 1, riskCategory: 1 }); // review queue

module.exports = mongoose.model('ProctoringSession', proctoringSessionSchema);
