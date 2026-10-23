const mongoose = require('mongoose');
const { listEventTypes } = require('../utils/proctoring/eventRegistry');

// Proctoring event — an immutable, episode-based observation record
// (plan §17.3, §26.2). Episodes, never frames: {openedAt, closedAt, duration,
// confidence, metadata}. Ingestion (a later phase) validates every payload
// through utils/proctoring/eventValidation.js and assigns serverAt, severity
// and category server-side — clients submit observation claims only.
//
// Append-only after creation; only `review` and `actionTaken` subdocuments are
// ever writable (audit-written). No evidence/image fields exist by design.

const actionTakenSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['CONTINUE', 'WARN', 'FINAL_WARN', 'SUBMIT'],
    required: true,
  },
  ruleId: { type: String },
  at: { type: Date, required: true },
  deliveredToStudent: { type: Boolean, default: false },
}, { _id: false });

const reviewSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'dismissed', 'escalated'],
  },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  note: { type: String },
}, { _id: false });

const proctoringEventSchema = new mongoose.Schema({
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProctoringSession',
    required: true,
  },
  // The owning attempt's _id — from EITHER collection (QuizAttempt for user
  // attempts, GuestAttempt for public-quiz attempts). Ref deliberately
  // absent; events are always resolved via the session or attempt id.
  attempt: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  quiz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
  },
  // Categories per §17.2; validated against utils/proctoring/eventRegistry.js.
  category: {
    type: String,
    enum: ['technical', 'cv_observation', 'integrity', 'system_action'],
    required: true,
  },
  type: {
    type: String,
    required: true,
    // Registry-enumerated (plan §17.6): unknown or banned "verdict"
    // identifiers (CHEATING/FRAUD/…) cannot be persisted even by direct DB
    // writes through this model.
    enum: listEventTypes(),
  },
  source: {
    type: String,
    enum: ['cv', 'browser', 'os', 'system'],
    required: true,
  },
  // Which spike tier produced CV events (null for non-CV events).
  detectorTier: {
    type: String,
    enum: ['headpose', 'iris'],
  },
  // Median detector confidence over the episode window; null for
  // deterministic events.
  confidence: {
    type: Number,
    min: 0,
    max: 1,
    default: null,
  },
  openedAt: { type: Date, required: true },
  closedAt: { type: Date, required: true },
  // Derived (closedAt - openedAt), stored for queryability.
  durationMs: { type: Number, default: 0 },
  // Server-assigned per policy at ingest — never a client claim.
  severity: {
    type: String,
    enum: ['info', 'minor', 'moderate', 'major'],
  },
  metadata: { type: mongoose.Schema.Types.Mixed },
  // Client UUID making batch retries idempotent (§7.3). Uniqueness is
  // enforced over documents that carry a key (system events may omit it).
  idempotencyKey: { type: String },
  clientSeq: { type: Number },
  // Client claim — forensics only.
  clientAt: { type: Date },
  // Authoritative receipt time — the only timestamp used for rules, risk and
  // timeline ordering (§17.7).
  serverAt: { type: Date, required: true },
  actionTaken: actionTakenSchema,
  review: reviewSchema,
}, {
  timestamps: true,
});

proctoringEventSchema.index({ session: 1, serverAt: 1 });
proctoringEventSchema.index({ session: 1, type: 1 });
proctoringEventSchema.index(
  { session: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  }
);
proctoringEventSchema.index({ quiz: 1, type: 1, serverAt: -1 });
proctoringEventSchema.index({ attempt: 1 });

module.exports = mongoose.model('ProctoringEvent', proctoringEventSchema);
