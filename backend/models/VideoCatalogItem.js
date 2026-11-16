const mongoose = require('mongoose');

/**
 * Intern Mode video catalog — one document per importable row of the
 * "_Main And RR SUBJECT durations" Excel (ALL tab). Seeded by
 * scripts/importInternVideos.js, read by the intern allocation engine.
 *
 * Identity & ordering contract:
 *  - `dedupKey` (seriesKey + normalized title) is the stable identity; the
 *    import upserts on it, so re-runs update/insert without duplicating.
 *  - `sheetRow` (the original Excel row number) is the stable SEQUENCE key:
 *    allocation walks the catalog in ascending sheetRow, and rows added in a
 *    later, corrected sheet keep their original position.
 *  - Rows without a usable whole-minute duration are never imported (boss
 *    decision 2026-11-17); when the management team supplies proper minutes,
 *    re-running the import on the corrected sheet picks them up here.
 */
const videoCatalogItemSchema = new mongoose.Schema(
  {
    seriesKey: {
      type: String,
      required: true,
      trim: true,
    }, // sheet UID = SUBJECT + TYPE + SOURCE (a series, not one video)
    source: {
      type: String,
      required: true,
      trim: true,
    }, // raw sheet spelling, for display (e.g. "MARROW6.5")
    sourceKey: {
      type: String,
      required: true,
    }, // case/whitespace-normalized (e.g. "marrow6.5") — selection & matching
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    durationMin: {
      type: Number,
      required: true,
      min: 1,
      max: 1440,
    }, // whole minutes (decimals rounded at import per boss decision)
    sheetRow: {
      type: Number,
      required: true,
    }, // original Excel row number — the intern watch order
    dedupKey: {
      type: String,
      required: true,
      unique: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Allocation walk: an intern's slice is sourceKey + subjects, walked in
// ascending sheetRow.
videoCatalogItemSchema.index({ sourceKey: 1, subject: 1, sheetRow: 1 });
videoCatalogItemSchema.index({ sheetRow: 1 });
videoCatalogItemSchema.index({ seriesKey: 1 });

module.exports = mongoose.model('VideoCatalogItem', videoCatalogItemSchema);
