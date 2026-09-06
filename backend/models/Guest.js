const mongoose = require('mongoose');

// Public-quiz lead. Created ONLY after a successful email OTP verification —
// failed verifications never persist, so the collection holds verified
// contacts only. The normalized E.164 phone is THE dedupe key: the same
// person taking multiple public quizzes resolves to ONE document (the
// verified email is updated on each verify).
const guestSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  // Normalized lowercase — the address the OTP was delivered to (see
  // utils/otpHelpers.js). Indexed (not unique): the phone remains the
  // identity key, so two leads may legitimately share an email.
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
  // contact information — since the email-OTP switch it is NOT verified by
  // an OTP anymore.
  phone: {
    type: String,
    required: true,
    unique: true,
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

guestSchema.index({ email: 1 });

module.exports = mongoose.model('Guest', guestSchema);
