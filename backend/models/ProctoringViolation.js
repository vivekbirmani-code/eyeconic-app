const mongoose = require('mongoose');

// Proctoring violation — rules-engine OUTPUT, never a client claim
// (plan §18.5, §26.4). Created only by the server (a later phase wires the
// rules engine), keyed (session, ruleId, eventRefs) so replay-derived
// re-evaluation can never double-count. Counters are replayed from the
// immutable event log; they are never blind increments.

const violationActionTakenSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['CONTINUE', 'WARN', 'FINAL_WARN', 'SUBMIT'],
  },
  at: { type: Date },
  deliveredToStudent: { type: Boolean, default: false },
}, { _id: false });

const violationReviewSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'dismissed', 'escalated'],
    default: 'pending',
  },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  note: { type: String },
}, { _id: false });

const proctoringViolationSchema = new mongoose.Schema({
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProctoringSession',
    required: true,
  },
  // The owning attempt's _id — from EITHER collection (QuizAttempt for user
  // attempts, GuestAttempt for public-quiz attempts). Ref deliberately
  // absent; violations are always resolved via the session or attempt id.
  attempt: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  quiz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
  },
  // e.g. 'focus.maxViolations'
  ruleId: { type: String, required: true },
  // Deterministic collision key (`sessionId|ruleId|eventRefs`) — violations
  // are upserted by it so re-evaluation (late events, replayed batches,
  // concurrent batches) can never double-count (§7.3, §18.5). The compound
  // {session, ruleId, eventRefs} index below cannot be unique: eventRefs is
  // an array (multikey index semantics are unreliable for dedupe).
  derivationKey: { type: String },
  eventRefs: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProctoringEvent',
  }],
  reliability: {
    type: String,
    enum: ['deterministic', 'probabilistic'],
    required: true,
  },
  countedAt: { type: Date, default: Date.now },
  actionTaken: violationActionTakenSchema,
  review: violationReviewSchema,
}, {
  timestamps: true,
});

// Idempotent derivation key — replaying the log can never double-count (§7.3).
proctoringViolationSchema.index({ session: 1, ruleId: 1, eventRefs: 1 });
// The ACTUAL dedupe guarantee: unique on the deterministic derivationKey
// (partial so legacy/absent keys never collide), mirroring the
// ProctoringEvent idempotencyKey doctrine.
proctoringViolationSchema.index(
  { derivationKey: 1 },
  { unique: true, partialFilterExpression: { derivationKey: { $type: 'string' } } }
);
proctoringViolationSchema.index({ quiz: 1, ruleId: 1 });
proctoringViolationSchema.index({ attempt: 1 });

module.exports = mongoose.model('ProctoringViolation', proctoringViolationSchema);
