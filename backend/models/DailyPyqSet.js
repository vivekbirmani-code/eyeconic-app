const mongoose = require('mongoose');

/**
 * Daily PYQ — the frozen question set for one calendar date (IST 'YYYY-MM-DD').
 *
 * One document per date, created atomically on the first request of the day
 * and shared by every student, so the daily set is deterministic and stable:
 * refreshing, re-opening the browser, or switching devices can never produce
 * a different set. Persisting the set (instead of deriving it from the date
 * on the fly) also keeps it immune to mid-day edits of the question bank.
 */
const dailyPyqSetSchema = new mongoose.Schema({
    // IST calendar date, e.g. '2026-09-24'. Unique: exactly one set per date;
    // concurrent first-requests converge via $setOnInsert upsert.
    date: {
        type: String,
        required: true,
        unique: true
    },
    questionIds: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: 'QuestionBank',
        required: true
    },
    questionCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('DailyPyqSet', dailyPyqSetSchema);
