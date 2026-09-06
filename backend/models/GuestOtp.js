const mongoose = require('mongoose');

// OTP for the public-quiz guest flow. A row represents ONE verification
// challenge: "verify this email for THIS public quiz link" — keyed by the
// (email, shareToken) pair so a code obtained via one link can never verify
// on another. Resends replace the row for the same challenge; successful
// verification deletes it (single use). Only the HMAC-SHA256 hash of the
// code is stored (see utils/guestOtp.js).
//
// MIGRATION NOTE: challenges were keyed by (phone, shareToken) while OTPs
// were delivered over SMS. The collection is ephemeral (10-minute TTL), so
// no data migration is needed — server.js drops the obsolete unique
// phone_1_shareToken_1 index at startup; stale rows expire on their own.
const guestOtpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  shareToken: {
    type: String,
    required: true,
    trim: true
  },
  otpHash: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 600 // Auto-expires in 10 minutes (Mongo TTL index)
  }
});

// One live OTP per (email, shareToken) challenge
guestOtpSchema.index({ email: 1, shareToken: 1 }, { unique: true });

module.exports = mongoose.model('GuestOtp', guestOtpSchema);
