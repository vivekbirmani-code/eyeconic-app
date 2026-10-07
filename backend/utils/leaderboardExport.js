// Styled single-sheet Excel workbooks for the leaderboard exports, plus
// the column specs the CSV exports render from. One spec drives BOTH formats
// per cohort, so the .xlsx and .csv can never disagree about which fields
// they carry.
//
// Two cohorts share this module:
//  - Internal ("Leaderboard"): registered students. Data comes verbatim from
//    rankStudentAttempts — the same output GET /analytics/test/:testId/leaderboard
//    serves the live board — so the file always matches what the viewer sees.
//  - External ("External Leaderboard"): public-quiz guest leads
//    (fetchGuestParticipants rows), admin-only, ranked by the same
//    score-then-accuracy tie-break order in a separate file so guests never
//    mix into the student leaderboard.
//
// This module only owns presentation. Styling mirrors utils/testReportExcel.js
// (Analytics UI palette: teal primary #01B4AE, gray text/borders, restrained
// fills).
const Excel = require('exceljs');

const LEADERBOARD_SHEET_NAME = 'Leaderboard';
const GUEST_LEADERBOARD_SHEET_NAME = 'External Leaderboard';

// Analytics UI palette (see components/analytics/* + student-analytics.tsx).
const COLORS = {
  TEAL: 'FF01B4AE',
  DARK: 'FF1F2937',
  BODY: 'FF374151',
  MUTED: 'FF6B7280',
  FAINT: 'FF9CA3AF',
  BORDER: 'FFE5E7EB',
  BORDER_STRONG: 'FFD1D5DB',
  BAND: 'FFF9FAFB',
  WHITE: 'FFFFFFFF',
};

const FONT = 'Calibri';
const PERCENT_FORMAT = '0.0"%"';
const DATETIME_FORMAT = 'yyyy-mm-dd hh:mm';

const thinBorder = (color) => ({ style: 'thin', color: { argb: color } });

/**
 * Columns shared by the CSV and Excel leaderboard exports.
 *
 * `value` returns the CSV-safe primitive; `cell` (optional) overrides the
 * Excel cell value (e.g. real Dates so Excel can format/sort them). Ranks
 * are array positions (index + 1) — exactly what the leaderboard UI renders
 * — because rankStudentAttempts reports rank null for a single attempt.
 */
const LEADERBOARD_EXPORT_COLUMNS = [
  { header: 'Rank', width: 6, value: (r) => r.position, numFmt: '0', align: 'center' },
  { header: 'Student Name', width: 24, value: (r) => r.studentName, bold: true, color: COLORS.DARK },
  { header: 'Student Email', width: 28, value: (r) => r.studentEmail },
  { header: 'Score (%)', width: 10, value: (r) => r.scorePercentage, numFmt: PERCENT_FORMAT, bold: true, color: COLORS.TEAL },
  { header: 'Marks Obtained', width: 12, value: (r) => r.marksObtained },
  { header: 'Total Marks', width: 11, value: (r) => r.totalMarks },
  { header: 'Correct', width: 9, value: (r) => r.correct, numFmt: '0' },
  { header: 'Incorrect', width: 9, value: (r) => r.incorrect, numFmt: '0' },
  { header: 'Skipped', width: 8, value: (r) => r.skipped, numFmt: '0' },
  { header: 'Accuracy (%)', width: 10, value: (r) => r.accuracy, numFmt: PERCENT_FORMAT },
  { header: 'Time (min)', width: 9, value: (r) => r.timeSpent, numFmt: '0.00' },
  { header: 'Tab Switches', width: 9, value: (r) => r.tabSwitchCount, numFmt: '0' },
  {
    header: 'Completed At (UTC)',
    width: 17,
    value: (r) => (r.completedAt ? new Date(r.completedAt).toISOString() : ''),
    cell: (r) => (r.completedAt ? new Date(r.completedAt) : null),
    numFmt: DATETIME_FORMAT,
  },
  { header: 'Attempt ID', width: 26, value: (r) => r._id },
  { header: 'Student ID', width: 26, value: (r) => r.studentId },
];

/**
 * Columns for the external (public-quiz guest) leaderboard export — the
 * admin-only counterpart of LEADERBOARD_EXPORT_COLUMNS. Rows come from
 * toGuestExportRows(fetchGuestParticipants(..., { fullPhone: true })) so the
 * lead columns (raw phone, verified/consent flags) are admin-export-only by
 * construction. `phoneVerified` is deliberately omitted — phone is
 * unverified contact metadata since the email-OTP switch. `email` and
 * `accuracy` are nullable on legacy/all-skipped rows and render blank.
 */
const GUEST_LEADERBOARD_EXPORT_COLUMNS = [
  { header: 'Position', width: 9, value: (r) => r.position, numFmt: '0', align: 'center' },
  { header: 'Name', width: 24, value: (r) => r.name, bold: true, color: COLORS.DARK },
  { header: 'Email', width: 28, value: (r) => r.email ?? '' },
  { header: 'Phone', width: 16, value: (r) => r.phone || r.phoneMasked || '' },
  { header: 'Email Verified', width: 12, value: (r) => (r.emailVerified ? 'Yes' : 'No'), align: 'center' },
  { header: 'Marketing Consent', width: 14, value: (r) => (r.marketingConsent ? 'Yes' : 'No'), align: 'center' },
  { header: 'Score (%)', width: 10, value: (r) => r.scorePercentage, numFmt: PERCENT_FORMAT, bold: true, color: COLORS.TEAL },
  { header: 'Marks Obtained', width: 12, value: (r) => r.marksObtained },
  { header: 'Total Marks', width: 11, value: (r) => r.totalMarks },
  { header: 'Correct', width: 9, value: (r) => r.correct, numFmt: '0' },
  { header: 'Incorrect', width: 9, value: (r) => r.incorrect, numFmt: '0' },
  { header: 'Skipped', width: 8, value: (r) => r.skipped, numFmt: '0' },
  { header: 'Accuracy (%)', width: 10, value: (r) => r.accuracy, numFmt: PERCENT_FORMAT },
  { header: 'Time (min)', width: 9, value: (r) => r.timeSpent, numFmt: '0.00' },
  { header: 'Tab Switches', width: 9, value: (r) => r.tabSwitchCount, numFmt: '0' },
  {
    header: 'Completed At (UTC)',
    width: 17,
    value: (r) => (r.submittedAt ? new Date(r.submittedAt).toISOString() : ''),
    cell: (r) => (r.submittedAt ? new Date(r.submittedAt) : null),
    numFmt: DATETIME_FORMAT,
  },
  { header: 'Attempt ID', width: 26, value: (r) => r.attemptId },
];

/**
 * Adds the UI-equivalent rank to each ranked row. Callers pass the
 * leaderboard array exactly as returned by rankStudentAttempts; the spread
 * copy keeps the original response objects untouched.
 */
function toExportRows(leaderboard) {
  return (Array.isArray(leaderboard) ? leaderboard : []).map((entry, index) => ({
    ...entry,
    position: index + 1,
  }));
}

/**
 * Ranks guest participant rows for the external export: fetchGuestParticipants
 * returns them unranked (recency order) because guests never enter student
 * rankings — this file ranks them standalone, mirroring rankStudentAttempts'
 * tie-break order (score % desc → accuracy desc → marks desc → earlier
 * submission first), with attemptId as the deterministic final tie-break.
 * The sort runs on a copy, so the caller's array is never mutated.
 *
 * Also derives `timeSpent` (minutes, 2dp) from `timeTakenSeconds` so the
 * column spec stays uniform with the internal one.
 */
function toGuestExportRows(participants) {
  return (Array.isArray(participants) ? participants : [])
    .slice()
    .sort((a, b) => {
      const scoreA = a.scorePercentage ?? -1;
      const scoreB = b.scorePercentage ?? -1;
      if (scoreB !== scoreA) return scoreB - scoreA;
      const accA = a.accuracy ?? -1;
      const accB = b.accuracy ?? -1;
      if (accB !== accA) return accB - accA;
      const marksA = a.marksObtained ?? -1;
      const marksB = b.marksObtained ?? -1;
      if (marksB !== marksA) return marksB - marksA;
      const timeA = a.submittedAt ? new Date(a.submittedAt).getTime() : Infinity;
      const timeB = b.submittedAt ? new Date(b.submittedAt).getTime() : Infinity;
      if (timeA !== timeB) return timeA - timeB;
      return String(a.attemptId ?? '').localeCompare(String(b.attemptId ?? ''));
    })
    .map((participant, index) => ({
      ...participant,
      position: index + 1,
      timeSpent: Math.round(((participant.timeTakenSeconds || 0) / 60) * 100) / 100,
    }));
}

const TITLE_ROW = 1;
const META_ROW = 2;
const GENERATED_ROW = 3;
const HEADER_ROW = 5;

/**
 * Shared single-sheet builder for both cohorts. `spec` picks the surface:
 * { columns, sheetName, title, emptyNote } — everything else (header block,
 * teal band, zebra rows, freeze, autoFilter) is identical by construction.
 */
function buildSheet(workbook, data, spec) {
  const sheet = workbook.addWorksheet(spec.sheetName, {
    properties: { tabColor: { argb: COLORS.TEAL } },
  });

  spec.columns.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width;
  });

  // Report header block — plain overflow text, no fills, like the screen's
  // title area.
  const title = sheet.getCell(TITLE_ROW, 1);
  title.value = spec.title;
  title.font = { name: FONT, size: 14, bold: true, color: COLORS.DARK };
  sheet.getRow(TITLE_ROW).height = 22;

  const meta = sheet.getCell(META_ROW, 1);
  meta.value = [
    data.test.subjectName,
    data.test.testType ? `${data.test.testType} test` : null,
    `${data.test.totalQuestions} questions`,
    `${data.test.totalMarks} marks`,
    `${data.rows.length} participant${data.rows.length === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join('  ·  ');
  meta.font = { name: FONT, size: 9, color: COLORS.MUTED };

  const generated = sheet.getCell(GENERATED_ROW, 1);
  generated.value = `Exported ${data.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC  ·  Ranked by score %, then accuracy`;
  generated.font = { name: FONT, size: 9, color: COLORS.FAINT };

  // Table header — solid teal band with white bold labels.
  const headerRow = sheet.getRow(HEADER_ROW);
  headerRow.height = 30;
  spec.columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.TEAL } };
    cell.font = { name: FONT, size: 10, bold: true, color: COLORS.WHITE };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  data.rows.forEach((row, idx) => {
    const excelRow = sheet.getRow(HEADER_ROW + 1 + idx);
    const isLast = idx === data.rows.length - 1;

    spec.columns.forEach((col, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = col.cell ? col.cell(row) : col.value(row);
      cell.font = {
        name: FONT,
        size: 10,
        bold: Boolean(col.bold),
        color: col.color || COLORS.BODY,
      };
      if (col.numFmt) cell.numFmt = col.numFmt;
      cell.border = { bottom: thinBorder(isLast ? COLORS.BORDER_STRONG : COLORS.BORDER) };
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.BAND } };
      }
      cell.alignment = { horizontal: col.align || 'left', vertical: 'middle' };
    });
  });

  if (data.rows.length === 0) {
    const noteCell = sheet.getCell(HEADER_ROW + 1, 1);
    noteCell.value = spec.emptyNote;
    noteCell.font = { name: FONT, size: 10, italic: true, color: COLORS.MUTED };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle' };
    sheet.mergeCells(HEADER_ROW + 1, 1, HEADER_ROW + 1, 4);
  }

  const lastDataRow = HEADER_ROW + Math.max(data.rows.length, 1);
  sheet.views = [{
    state: 'frozen',
    xSplit: 0,
    ySplit: HEADER_ROW,
    topLeftCell: `A${HEADER_ROW + 1}`,
  }];
  sheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: lastDataRow, column: spec.columns.length },
  };

  return sheet;
}

/**
 * Builds the one-sheet leaderboard workbook (internal cohort — registered
 * students).
 *
 * @param {object} data
 *   { test: { title, subjectName, testType, totalQuestions, totalMarks },
 *     rows: toExportRows() output, generatedAt: Date }
 * @returns {Excel.Workbook} unserialized workbook — callers write it with
 *   workbook.xlsx.writeBuffer()
 */
function buildLeaderboardWorkbook(data) {
  const workbook = new Excel.Workbook();
  workbook.creator = 'Eyeconic';
  workbook.created = data.generatedAt instanceof Date ? data.generatedAt : new Date();

  buildSheet(workbook, data, {
    columns: LEADERBOARD_EXPORT_COLUMNS,
    sheetName: LEADERBOARD_SHEET_NAME,
    title: `Leaderboard — ${data.test.title || 'Test'}`,
    emptyNote: 'No submissions yet.',
  });

  return workbook;
}

/**
 * Builds the one-sheet external leaderboard workbook (public-quiz guest
 * leads, admin-only). Same data contract as buildLeaderboardWorkbook, but
 * rows come from toGuestExportRows(fetchGuestParticipants(...)).
 */
function buildGuestLeaderboardWorkbook(data) {
  const workbook = new Excel.Workbook();
  workbook.creator = 'Eyeconic';
  workbook.created = data.generatedAt instanceof Date ? data.generatedAt : new Date();

  buildSheet(workbook, data, {
    columns: GUEST_LEADERBOARD_EXPORT_COLUMNS,
    sheetName: GUEST_LEADERBOARD_SHEET_NAME,
    title: `External Leaderboard — ${data.test.title || 'Test'}`,
    emptyNote: 'No public participants yet.',
  });

  return workbook;
}

module.exports = {
  buildLeaderboardWorkbook,
  buildGuestLeaderboardWorkbook,
  toExportRows,
  toGuestExportRows,
  LEADERBOARD_EXPORT_COLUMNS,
  GUEST_LEADERBOARD_EXPORT_COLUMNS,
  LEADERBOARD_SHEET_NAME,
  GUEST_LEADERBOARD_SHEET_NAME,
};
