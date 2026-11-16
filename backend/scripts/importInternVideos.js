/**
 * Intern Mode — import the video catalog from the owner's Excel sheet
 * ("_Main And RR SUBJECT durations .xlsx", ALL tab) into VideoCatalogItem.
 *
 * Usage:
 *   node scripts/importInternVideos.js [--file <path>] [--sheet ALL] [--dry-run]
 *
 * Cleaning rules (boss decisions, 2026-11-17):
 *  - Only rows with a usable duration are imported. DURATION is used first,
 *    Duration_2 as fallback.
 *  - Decimals are rounded to the nearest whole minute (14.08 -> 14, 12.62 -> 13).
 *  - Rows whose duration is a DAY label ("DAY 1 OF 2"), a date, junk text, or
 *    blank are SKIPPED — proper minutes for the DAY/date rows will arrive in a
 *    corrected sheet later; re-running this script on it picks them up.
 *  - Duplicate (series + topic) rows keep the first occurrence.
 *  - Rows missing source/subject/topic/series are skipped as broken.
 *
 * The import is idempotent: it upserts by dedupKey (seriesKey + normalized
 * title), so re-runs update existing rows and insert new ones without creating
 * duplicates. sheetRow (the original Excel row) preserves the watch order
 * across re-imports.
 *
 * Writes to the MONGODB_URI from backend/.env (the shared Atlas "test" db in
 * dev) — use --dry-run to validate without writing.
 */
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const DEFAULT_FILE = 'C:/Users/vivek/Desktop/_Main And RR SUBJECT durations .xlsx';
const file = path.resolve(argValue('--file', DEFAULT_FILE));
const sheetName = argValue('--sheet', 'ALL');
const dryRun = hasFlag('--dry-run');

const MAX_MINUTES = 1440; // a day — anything above is an Excel date serial or junk

/** Parse one duration cell into whole minutes, or null when unusable. */
function parseDurationMinutes(value) {
  let v = value;
  if (typeof v === 'string') {
    v = v.trim();
    if (!/^-?\d+(\.\d+)?$/.test(v)) return null; // DAY labels, dates, junk
    v = parseFloat(v);
  }
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v <= 0 || v > MAX_MINUTES) return null;
  return Math.round(v); // boss rule: decimals round to nearest whole minute
}

const normalizeTitle = (t) => String(t).trim().toUpperCase().replace(/\s+/g, ' ');
const sourceKeyOf = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

(async () => {
  console.log(`file:  ${file}`);
  console.log(`sheet: ${sheetName}${dryRun ? '  (DRY RUN — no writes)' : ''}`);

  const wb = XLSX.readFile(file, { cellDates: true, dense: true });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found. Available: ${wb.SheetNames.join(', ')}`);

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  // rows[i] is Excel row i+1; row 1 is the header (UID, SOURCE, SUBJECT, TOPIC,
  // TYPE, DURATION, Duration_2). sheetRow must be the REAL Excel row number so
  // later corrected sheets keep a stable order.

  const skipped = { noDuration: 0, blankDuration: 0, dayOrDateOrJunk: 0, broken: 0 };
  const bySource = new Map(); // source display -> { videos, minutes }
  const seenDedup = new Set(); // dedupKeys already kept (first occurrence wins)
  const ops = [];
  let duplicates = 0;
  let totalMin = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r) || r.every((c) => c === null || c === undefined || c === '')) continue;

    const uid = typeof r[0] === 'string' ? r[0].trim() : r[0];
    const source = typeof r[1] === 'string' ? r[1].trim() : r[1];
    const subject = typeof r[2] === 'string' ? r[2].trim() : r[2];
    const topic = typeof r[3] === 'string' ? r[3].trim() : r[3];
    const type = typeof r[4] === 'string' ? r[4].trim() : r[4];

    if (!uid || !source || !subject || !topic || !type) {
      skipped.broken++;
      continue;
    }

    const d1Raw = r[5];
    const d2Raw = r[6];
    const minutes = parseDurationMinutes(d1Raw) ?? parseDurationMinutes(d2Raw);
    if (minutes === null) {
      const blank = (v) => v === null || v === undefined || String(v).trim() === '';
      if (blank(d1Raw) && blank(d2Raw)) skipped.blankDuration++;
      else if (typeof d1Raw === 'string' || typeof d2Raw === 'string') skipped.dayOrDateOrJunk++;
      else skipped.noDuration++;
      continue;
    }

    const dedupKey = `${uid}|${normalizeTitle(topic)}`;
    if (seenDedup.has(dedupKey)) {
      duplicates++; // duplicate series+topic — keep first occurrence
      continue;
    }
    seenDedup.add(dedupKey);

    const sourceDisplay = source;
    if (!bySource.has(sourceDisplay)) bySource.set(sourceDisplay, { videos: 0, minutes: 0, key: sourceKeyOf(source) });
    bySource.get(sourceDisplay).videos++;
    bySource.get(sourceDisplay).minutes += minutes;
    totalMin += minutes;

    ops.push({
      updateOne: {
        filter: { dedupKey },
        update: {
          $set: {
            seriesKey: uid,
            source: sourceDisplay,
            sourceKey: sourceKeyOf(source),
            subject,
            type,
            title: topic,
            durationMin: minutes,
            sheetRow: i + 1,
            isActive: true,
          },
        },
        upsert: true,
      },
    });
  }

  // ---- report ----
  console.log('\n== IMPORT REPORT ==');
  console.log(`importable videos: ${ops.length} (${(totalMin / 60).toFixed(0)} hours)`);
  console.log(
    `skipped: ${Object.entries(skipped)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')} | duplicates dropped: ${duplicates}`
  );
  console.log('\nby source:');
  [...bySource.entries()]
    .sort((a, b) => b[1].minutes - a[1].minutes)
    .forEach(([s, d]) => console.log(`  ${String(s).padEnd(18)} videos=${String(d.videos).padStart(6)}  hours=${String(Math.round(d.minutes / 60)).padStart(5)}`));

  if (dryRun) {
    console.log('\nDRY RUN — nothing written.');
    return;
  }

  // ---- write ----
  await mongoose.connect(process.env.MONGODB_URI);
  const VideoCatalogItem = require('../models/VideoCatalogItem');
  const before = await VideoCatalogItem.countDocuments({});

  let inserted = 0;
  let matched = 0;
  const BATCH = 500;
  for (let i = 0; i < ops.length; i += BATCH) {
    const res = await VideoCatalogItem.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
    inserted += res.upsertedCount || 0;
    matched += res.matchedCount || 0;
    process.stdout.write(`\rwriting... ${Math.min(i + BATCH, ops.length)}/${ops.length}`);
  }
  console.log('');
  const after = await VideoCatalogItem.countDocuments({});
  console.log(`db: ${before} -> ${after} documents (upserted ${inserted}, updated ${matched})`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error('IMPORT FAILED:', err.message);
  process.exit(1);
});
