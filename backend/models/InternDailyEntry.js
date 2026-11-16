const mongoose = require('mongoose');

/**
 * Intern Mode — the student's time-slicer choice for ONE day: how many minutes
 * they committed today and which videos the allocator planned for them.
 * One entry per (student, IST calendar day); re-choosing the time the same day
 * replaces the plan (watched tasks are never touched — they live in
 * InternVideoTask).
 */
const internDailyEntrySchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/ // YYYY-MM-DD in Asia/Kolkata
    },
    minutes: {
      type: Number,
      required: true,
      min: 30,
      max: 720
    },
    videoIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'VideoCatalogItem' }
    ],
    totalMinutes: { type: Number, required: true, default: 0 } // plan sum, <= minutes
  },
  { timestamps: true }
);

internDailyEntrySchema.index({ student: 1, date: 1 }, { unique: true });
internDailyEntrySchema.index({ date: 1 });

module.exports = mongoose.model('InternDailyEntry', internDailyEntrySchema);
