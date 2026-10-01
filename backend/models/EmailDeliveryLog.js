const mongoose = require('mongoose');

// Delivery audit trail for OTP emails (signup, password reset, public-quiz
// guest flow). Written best-effort by utils/mailer.js on every real provider
// attempt so support can answer "the student says the code never arrived"
// with data: which provider ran, how many attempts, what the provider said.
// PII posture: the recipient address is already stored in plaintext on the
// User/Guest it belongs to, so storing it here adds no new exposure; rows
// self-purge after 30 days via the TTL index.
//
// These rows are an operational log, NOT a delivery guarantee — "sent" means
// the provider ACCEPTED the message (250 / 2xx), which is the last observable
// state from inside this process.
const emailDeliveryLogSchema = new mongoose.Schema({
  toEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  purpose: {
    type: String,
    required: true,
    enum: ['signup', 'password-reset', 'guest-quiz']
  },
  provider: {
    // 'smtp' | 'resend' | 'smtp+resend-fallback'
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    required: true,
    enum: ['sent', 'failed']
  },
  attempts: {
    type: Number,
    default: 1
  },
  messageId: {
    type: String,
    trim: true
  },
  errorCode: {
    type: String,
    trim: true
  },
  // Sanitized provider error text (secrets redacted, capped at 300 chars).
  errorDetail: {
    type: String,
    trim: true
  },
  durationMs: {
    type: Number
  },
  requestId: {
    type: String,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 30 * 24 * 60 * 60 // auto-purge after 30 days
  }
});

// Support lookup: "what happened to this address recently?"
emailDeliveryLogSchema.index({ toEmail: 1, createdAt: -1 });
// Outage triage: "show me every failure in the last hour"
emailDeliveryLogSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('EmailDeliveryLog', emailDeliveryLogSchema);
