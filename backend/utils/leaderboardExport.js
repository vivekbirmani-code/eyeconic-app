// Styled single-sheet Excel workbook for the live leaderboard export, plus
// the column spec the CSV export renders from. One spec drives BOTH formats,
// so the .xlsx and .csv can never disagree about which leaderboard fields
// they carry.
//
// Data comes verbatim from rankStudentAttempts — the same output
// GET /analytics/test/:testId/leaderboard serves the live board — so the
// file always matches what the viewer sees. This module only owns
// presentation. Styling mirrors utils/testReportExcel.js (Analytics UI
// palette: teal primary #01B4AE, gray text/borders, restrained fills).
const Excel = require('exceljs');

const LEADERBOARD_SHEET_NAME = 'Leaderboard';

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

const TITLE_ROW = 1;
const META_ROW = 2;
const GENERATED_ROW = 3;
const HEADER_ROW = 5;

function buildLeaderboardSheet(workbook, data) {
  const sheet = workbook.addWorksheet(LEADERBOARD_SHEET_NAME, {
    properties: { tabColor: { argb: COLORS.TEAL } },
  });

  LEADERBOARD_EXPORT_COLUMNS.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width;
  });

  // Report header block — plain overflow text, no fills, like the screen's
  // title area.
  const title = sheet.getCell(TITLE_ROW, 1);
  title.value = `Leaderboard — ${data.test.title || 'Test'}`;
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
  LEADERBOARD_EXPORT_COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.TEAL } };
    cell.font = { name: FONT, size: 10, bold: true, color: COLORS.WHITE };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  data.rows.forEach((row, idx) => {
    const excelRow = sheet.getRow(HEADER_ROW + 1 + idx);
    const isLast = idx === data.rows.length - 1;

    LEADERBOARD_EXPORT_COLUMNS.forEach((col, i) => {
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
    noteCell.value = 'No submissions yet.';
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
    to: { row: lastDataRow, column: LEADERBOARD_EXPORT_COLUMNS.length },
  };

  return sheet;
}

/**
 * Builds the one-sheet leaderboard workbook.
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

  buildLeaderboardSheet(workbook, data);

  return workbook;
}

module.exports = {
  buildLeaderboardWorkbook,
  toExportRows,
  LEADERBOARD_EXPORT_COLUMNS,
  LEADERBOARD_SHEET_NAME,
};
