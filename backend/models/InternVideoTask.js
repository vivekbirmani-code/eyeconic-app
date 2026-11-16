const mongoose = require('mongoose');

/**
 * Intern Mode — one task row per (student, video). Created the first time a
 * video lands in a student's daily plan; kept until watched, so unfinished
 * videos carry over automatically: the allocator always starts at the first
 * unwatched video of the student's scope.
 *
 * Display fields are snapshotted at allot time so task lists never depend on
 * later catalog edits. One task per (student, video) ever — re-choosing the
 * day's time or carrying over across days reuses the same row.
 */
const internVideoTaskSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VideoCatalogItem',
      required: true
    },
    // denormalized snapshot for display + ordering
    title: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    source: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    durationMin: { type: Number, required: true, min: 1 },
    sheetRow: { type: Number, required: true }, // catalog watch order
    status: {
      type: String,
      enum: ['pending', 'watched'],
      default: 'pending',
      required: true
    },
    firstAllottedAt: { type: Date, required: true, default: Date.now },
    watchedAt: { type: Date }
  },
  { timestamps: true }
);

internVideoTaskSchema.index({ student: 1, video: 1 }, { unique: true });
// Playlist-order listing for the My Tasks screen
internVideoTaskSchema.index({ student: 1, status: 1, sheetRow: 1 });

module.exports = mongoose.model('InternVideoTask', internVideoTaskSchema);
