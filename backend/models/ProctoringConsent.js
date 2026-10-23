const mongoose = require('mongoose');

// Proctoring consent — recorded PRE-start (a later phase adds the consent
// route + gating; the model ships in Phase 1 per plan §26.3). Keyed
// {quiz, owner, policyVersion} so replays/retries upsert idempotently and
// re-consent is required when a quiz's policy version changes (plan §9.3).
// Deliberately NOT attempt-bound: consent survives precheck retries and
// failed start requests.
//
// The owner is a registered student (`student`, User) for internal attempts
// or an OTP-verified lead (`guest`, Guest) for public-quiz attempts — exactly
// one is set. Index note below.

const proctoringConsentSchema = new mongoose.Schema({
  quiz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  guest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Guest',
    default: null,
  },
  policyVersion: {
    type: Number,
    required: true,
  },
  // Copy-version audit: which centralized consent text the student saw (§9.2).
  consentTextVersion: {
    type: String,
  },
  policyHash: { type: String },
  grantedAt: {
    type: Date,
    default: Date.now,
  },
  precheckSummary: {
    deviceClass: { type: String },
    checks: [{
      _id: false,
      id: { type: String },
      pass: { type: Boolean },
      detail: { type: String },
    }],
    networkProbe: { type: mongoose.Schema.Types.Mixed },
    // Phase 5 (D11): precheck-captured attention baseline (median nominal
    // head pose over the agreed readiness frames) — copied from the signed
    // precheck-token summary; absent for older clients (fallback sessions).
    attentionBaseline: { type: mongoose.Schema.Types.Mixed },
  },
  surface: {
    type: String,
    enum: ['app-android', 'app-ios', 'web'],
  },
}, {
  timestamps: true,
});

// Idempotency keys, split by owner kind. Two PARTIAL unique indexes (each
// covering only rows that actually carry that owner) replace the legacy
// plain unique {quiz, student, policyVersion}: a plain unique index treats
// every guest row's student:null as a duplicate of every other guest row for
// the same quiz+policyVersion (the sparse-null trap — see the shareToken
// revoke incident). The $type filters keep null-keyed rows out of both
// indexes entirely, so user and guest consent rows never collide. Indexes
// carry EXPLICIT names so they cannot collide with the legacy default name
// ('quiz_1_student_1_policyVersion_1'), which server.js's startup migration
// drops on existing deployments.
proctoringConsentSchema.index(
  { quiz: 1, student: 1, policyVersion: 1 },
  { unique: true, name: 'consent_user_owner_unique_1', partialFilterExpression: { student: { $type: 'objectId' } } }
);
proctoringConsentSchema.index(
  { quiz: 1, guest: 1, policyVersion: 1 },
  { unique: true, name: 'consent_guest_owner_unique_1', partialFilterExpression: { guest: { $type: 'objectId' } } }
);

module.exports = mongoose.model('ProctoringConsent', proctoringConsentSchema);
