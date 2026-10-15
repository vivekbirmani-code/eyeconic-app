const mongoose = require('mongoose');

// Proctoring consent — recorded PRE-start (a later phase adds the consent
// route + gating; the model ships in Phase 1 per plan §26.3). Keyed
// {quiz, student, policyVersion} so replays/retries upsert idempotently and
// re-consent is required when a quiz's policy version changes (plan §9.3).
// Deliberately NOT attempt-bound: consent survives precheck retries and
// failed start requests.

const proctoringConsentSchema = new mongoose.Schema({
  quiz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
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

proctoringConsentSchema.index({ quiz: 1, student: 1, policyVersion: 1 }, { unique: true });

module.exports = mongoose.model('ProctoringConsent', proctoringConsentSchema);
