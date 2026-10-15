const mongoose = require('mongoose');

// Reuse the same answer schema structure as QuizAttempt for consistency
const guestAnswerSchema = new mongoose.Schema({
    questionIndex: {
        type: Number,
        required: true
    },
    questionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'QuestionBank'
    },
    // Shape depends on the question's questionType (see QuizAttempt.answerSchema).
    selectedAnswer: {
        type: mongoose.Schema.Types.Mixed,
        default: -1
    },
    isCorrect: {
        type: Boolean
    },
    markedForReview: {
        type: Boolean,
        default: false
    },
    timeSpent: {
        type: Number,
        default: 0
    }
});

const guestAttemptSchema = new mongoose.Schema({
    quiz: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Quiz',
        required: true
    },
    // Unique guest identifier stored on device
    guestId: {
        type: String,
        required: true,
        index: true
    },
    answers: [guestAnswerSchema],
    startTime: {
        type: Date,
        default: Date.now
    },
    endTime: {
        type: Date
    },
    status: {
        type: String,
        enum: ['in_progress', 'completed', 'auto_submitted'],
        default: 'in_progress'
    },
    score: {
        type: Number,
        default: 0
    },
    totalQuestions: {
        type: Number,
        default: 0
    },
    marksObtained: {
        type: Number,
        default: 0
    },
    totalMarks: {
        type: Number,
        default: 0
    },
    // Grouped performance computed at finalize time — same shape and
    // semantics as QuizAttempt.sectionPerformance (subject-name grouped),
    // stored since guests now see their result and admins see guest rows.
    sectionPerformance: [{
        _id: false,
        sectionName: { type: String },
        correct: { type: Number, default: 0 },
        incorrect: { type: Number, default: 0 },
        skipped: { type: Number, default: 0 },
        timeSpent: { type: Number, default: 0 },
        accuracy: { type: Number, default: 0 }
    }],
    // Tab switch tracking
    tabSwitchCount: {
        type: Number,
        default: 0
    },
    tabSwitchLog: [{
        type: Date
    }],
    // Link to user account if they sign up later
    linkedUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    // Verified lead this attempt belongs to (OTP flow). Null for legacy
    // anonymous device-keyed attempts, which keep working unchanged.
    guest: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Guest',
        default: null
    },
    // Name/email/phone snapshots copied from the lead at /start — attempts stay
    // self-contained for admin display even if the lead record is later
    // updated by another quiz.
    guestName: {
        type: String,
        default: null
    },
    guestEmail: {
        type: String,
        default: null,
        trim: true
    },
    guestPhone: {
        type: String,
        default: null
    },
    // Device info for analytics
    deviceInfo: {
        type: String
    },

    // ===== Server-authoritative duration (flat attempts) =====
    // Mirrors QuizAttempt.durationDeadline (plan §7.5, D12): computed at
    // /start as startTime + quiz duration, stored PURE (never pre-capped).
    // Section-locked attempts never set it — their authority stays the
    // sectionStates[].endsAt cascade. The effective participation deadline is
    // recomputed at enforcement time as min(this, quiz.publicExpiryDate) by
    // utils/proctoring/durationEnforcement.js.
    durationDeadline: {
        type: Date
    },

    // Machine-readable reason recorded when the server finalized the attempt
    // itself: {kind:'duration'|'quiz_window', deadline, detectedAt}. Absent
    // for manual submits and in-window client-timer auto-submits.
    autoSubmitReason: {
        type: mongoose.Schema.Types.Mixed
    },

    // ===== Section locking (snapshot copied from the quiz at /start) =====
    // Same semantics as QuizAttempt: defaults false so pre-feature attempts
    // and section-less quizzes never enforce.
    sectionLockEnabled: {
        type: Boolean,
        default: false
    },
    sectionDefinitions: [{
        _id: false,
        index: { type: Number, required: true },
        name: { type: String },
        duration: { type: Number }, // minutes
        questionIds: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QuestionBank'
        }]
    }],
    sectionStates: [{
        _id: false,
        index: { type: Number, required: true },
        status: {
            type: String,
            enum: ['in_progress', 'submitted', 'auto_submitted'],
            default: 'in_progress'
        },
        startedAt: { type: Date },
        endsAt: { type: Date },
        submittedAt: { type: Date }
    }]
}, {
    timestamps: true
});

// Indexes for efficient queries
guestAttemptSchema.index({ quiz: 1, guestId: 1 });
guestAttemptSchema.index({ guestId: 1, status: 1 });
guestAttemptSchema.index({ linkedUser: 1 });
guestAttemptSchema.index({ guest: 1 });
guestAttemptSchema.index({ quiz: 1, status: 1, guest: 1 });

// One LIVE attempt per owner — enforced atomically at the DB layer.
// The /start route's check-then-create raced under load (double-tap, two
// tabs, StrictMode double-mount): parallel starts all passed the resume
// findOne before any save committed, leaving one person with several
// in_progress attempts whose resumes bounced between them. Partial unique
// indexes scope the constraint to in-progress rows only, so history
// (completed / auto_submitted attempts) never blocks a fresh start:
//   - verified-lead flow: one live attempt per (quiz, guest) on ANY device
//   - legacy anonymous flow: one live attempt per (quiz, guestId) device key
// Anonymous and lead attempts may still coexist on one device (the lead's
// resume lookup adopts the anonymous row), so the keys are independent.
// New key patterns are named so they never collide with the legacy
// non-unique quiz_1_guestId_1 index still present on older deployments;
// server.js migrateGuestAttemptIndexes() dedupes legacy live duplicates
// before these build.
guestAttemptSchema.index(
    { quiz: 1, guest: 1 },
    {
        unique: true,
        name: 'guest_attempt_live_lead_unique_1',
        partialFilterExpression: { status: 'in_progress', guest: { $type: 'objectId' } },
    }
);
guestAttemptSchema.index(
    { quiz: 1, guestId: 1 },
    {
        unique: true,
        name: 'guest_attempt_live_anon_unique_1',
        partialFilterExpression: { status: 'in_progress', guest: null },
    }
);

module.exports = mongoose.model('GuestAttempt', guestAttemptSchema);
