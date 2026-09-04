const mongoose = require('mongoose');

// Public-quiz lead. Created ONLY after a successful OTP verification —
// failed verifications never persist, so the collection holds verified
// contacts only. The normalized E.164 phone is THE dedupe key: the same
// person taking multiple public quizzes resolves to ONE document.
const guestSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  // E.164 format, e.g. +919876543210 (see utils/phone.js)
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  phoneVerifiedAt: {
    type: Date,
    default: Date.now
  },
  // Explicit opt-in captured at verify time — entering a phone number
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

module.exports = mongoose.model('Guest', guestSchema);
