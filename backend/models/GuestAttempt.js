const mongoose = require('mongoose');

// Reuse the same answer schema structure as QuizAttempt for consistency
const guestAnswerSchema = new mongoose.Schema({
    questionIndex: {
        type: Number,
        required: true
    },
    selectedAnswer: {
        type: Number,
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
    // Device info for analytics
    deviceInfo: {
        type: String
    }
}, {
    timestamps: true
});

// Indexes for efficient queries
guestAttemptSchema.index({ quiz: 1, guestId: 1 });
guestAttemptSchema.index({ guestId: 1, status: 1 });
guestAttemptSchema.index({ linkedUser: 1 });

module.exports = mongoose.model('GuestAttempt', guestAttemptSchema);
