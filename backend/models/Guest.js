const mongoose = require('mongoose');

// Public-quiz lead. Created ONLY after a successful email OTP verification —
// failed verifications never persist, so the collection holds verified
// contacts only. The OTP-VERIFIED email is THE dedupe key: the same person
// taking multiple public quizzes resolves to ONE document (the latest
// verified phone/name are updated on each verify). Two DIFFERENT people may
// legitimately share a phone (household number) — the phone is unverified
// contact metadata since the email-OTP switch, never identity.
const guestSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  // Normalized lowercase — the address the OTP was delivered to (see
  // utils/otpHelpers.js). Unique per verified mailbox; the unique index is
  // declared below with an explicit name.
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 254
  },
  emailVerifiedAt: {
    type: Date,
    default: null
  },
  // E.164 format, e.g. +919876543210 (see utils/phone.js). Collected as
  // contact information — NOT verified by an OTP and NOT an identity key;
  // multiple leads may share one (family/household) number.
  phone: {
    type: String,
    required: true,
    trim: true
  },
  // Legacy field: set while the flow verified phones via SMS OTP (pre
  // email-OTP switch). Kept for historical records; new leads leave it null.
  phoneVerifiedAt: {
    type: Date,
    default: null
  },
  // Explicit opt-in captured at verify time — entering contact details
  // never implies marketing consent. `false` is accepted and stored;
  // it does not block the quiz.
  marketingConsent: {
    granted: {
      type: Boolean,
      default: false
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  source: {
    type: String,
    enum: ['web', 'mobile'],
    default: 'web'
  },
  firstQuiz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    default: null
  },
  quizzesTaken: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz'
  }],
  lastActiveAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Identity + lookup indexes. BOTH are explicitly named so mongoose's
// auto-build never collides with the legacy indexes on existing deployments
// (the pre-email-identity `email_1` non-unique and `phone_1` UNIQUE indexes
// — see migrateGuestIdentityIndexes in server.js, which drops them once):
// Mongo rejects same-name indexes with different options, but happily holds
// two differently-named indexes on the same key pattern during the swap.
guestSchema.index({ email: 1 }, { unique: true, name: 'guest_email_unique_1' });
guestSchema.index({ phone: 1 }, { name: 'guest_phone_lookup_1' });

module.exports = mongoose.model('Guest', guestSchema);
