const mongoose = require('mongoose');

// Proctoring accommodation override — admin tooling for accessibility
// accommodations (plan §26.5, §29.4): e.g. attention observations disabled
// or thresholds relaxed for a student. CRUD wiring arrives in a later phase;
// the collection ships in Phase 1 so the schema contract is stable.

const proctoringOverrideSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // Optional: scope the override to one quiz; absent = all quizzes.
  quiz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
  },
  // e.g. 'attention_disabled', 'relaxed_thresholds'
  reasonCode: {
    type: String,
    required: true,
  },
  grantedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  expiresAt: {
    type: Date,
  },
  // Free-form override payload interpreted by the policy layer.
  overrides: { type: mongoose.Schema.Types.Mixed },
}, {
  timestamps: true,
});

proctoringOverrideSchema.index({ student: 1, quiz: 1 });

module.exports = mongoose.model('ProctoringOverride', proctoringOverrideSchema);
