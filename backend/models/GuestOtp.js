const mongoose = require('mongoose');

// OTP for the public-quiz guest flow. A row represents ONE verification
// challenge: "verify this phone for THIS public quiz link" — keyed by the
// (phone, shareToken) pair so a code obtained via one link can never verify
// on another. Resends replace the row for the same challenge; successful
// verification deletes it (single use). Only the HMAC-SHA256 hash of the
// code is stored (see utils/guestOtp.js).
const guestOtpSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    trim: true
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

// One live OTP per (phone, shareToken) challenge
guestOtpSchema.index({ phone: 1, shareToken: 1 }, { unique: true });

module.exports = mongoose.model('GuestOtp', guestOtpSchema);
