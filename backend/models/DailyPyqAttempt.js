const mongoose = require('mongoose');

/**
 * Daily PYQ — one completed attempt per student per day.
 *
 * Each answer carries a display snapshot (question text, options, correct
 * answer, explanation) captured at submit time, so a student's history stays
 * stable even if the underlying bank question is later edited, deactivated,
 * or deleted. The `question` ref is kept for traceability only.
 */
const dailyPyqAnswerSchema = new mongoose.Schema({
    question: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'QuestionBank'
    },
    questionType: { type: String },
    questionText: { type: String, default: '' },
    questionImage: { type: String },
    options: { type: [String] },
    optionImages: { type: [String] },
    assertion: { type: String },
    reason: { type: String },
    selectedAnswer: { type: mongoose.Schema.Types.Mixed },
    correctAnswer: { type: mongoose.Schema.Types.Mixed },
    answered: { type: Boolean, default: false },
    isCorrect: { type: Boolean, default: false },
    explanation: { type: String, default: '' },
    explanationImage: { type: String }
}, { _id: false });

const dailyPyqAttemptSchema = new mongoose.Schema({
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // IST calendar date this attempt belongs to ('YYYY-MM-DD').
    date: {
        type: String,
        required: true
    },
    // The exact DailyPyqSet question ids this attempt was graded against.
    questionIds: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: 'QuestionBank'
    },
    answers: {
        type: [dailyPyqAnswerSchema],
        default: []
    },
    correctCount: { type: Number, default: 0 },
    incorrectCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    totalQuestions: { type: Number, default: 0 },
    // NEET PG marking, mirroring quiz defaults: +4 correct, -1 incorrect,
    // skipped questions are never penalised.
    score: { type: Number, default: 0 },
    maxScore: { type: Number, default: 0 },
    timeTakenSeconds: { type: Number, default: 0 },
    submittedAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

// Database-level guarantee behind the one-attempt-per-day rule: concurrent or
// duplicate submissions hit this unique index (E11000) and are resolved
// idempotently by the route, never producing a second record.
dailyPyqAttemptSchema.index({ student: 1, date: 1 }, { unique: true });
dailyPyqAttemptSchema.index({ student: 1, submittedAt: -1 });

module.exports = mongoose.model('DailyPyqAttempt', dailyPyqAttemptSchema);
