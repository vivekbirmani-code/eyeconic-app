// Styled two-sheet Excel workbook for the test report export. Built from the
// exact rows collectTestReportData() feeds the CSV export, so both formats
// always carry identical data — this module only owns presentation.
//
// Design mirrors the app's Analytics screens (student-analytics.tsx): teal
// primary #01b4AE, gray text/borders, green/red/amber/blue accents — kept
// deliberately restrained (fills on headers and the KPI band only).
const Excel = require('exceljs');

const STUDENT_SHEET_NAME = 'Student Performance';
const QUESTION_SHEET_NAME = 'Question-wise Analytics';

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
  CHIP_BG: 'FFF3F4F6',
  WHITE: 'FFFFFFFF',
  GREEN: 'FF059669',
  AMBER: 'FFD97706',
  RED: 'FFDC2626',
  BLUE: 'FF2563EB',
};

const FONT = 'Calibri';
const PERCENT_FORMAT = '0.0"%"';
const DATETIME_FORMAT = 'yyyy-mm-dd hh:mm';

const thinBorder = (color) => ({ style: 'thin', color: { argb: color } });

const wrapLines = (text, charsPerLine) => {
  if (text === null || text === undefined || text === '') return 1;
  return Math.max(1, Math.ceil(String(text).length / charsPerLine));
};

const boundedRowHeight = (lines) => Math.min(16 + (lines - 1) * 12.5, 56);

// ---------------------------------------------------------------------------
// Student Performance sheet
// ---------------------------------------------------------------------------

const STUDENT_COLUMNS = [
  { header: 'Rank', width: 6, value: (r) => r.rank, numFmt: '0', align: 'center' },
  { header: 'Student Name', width: 24, value: (r) => r.studentName, bold: true, color: COLORS.DARK },
  { header: 'Email', width: 28, value: (r) => r.studentEmail },
  { header: 'Participant Type', width: 15, value: (r) => r.participantType, align: 'center', adminOnly: true },
  { header: 'Score (%)', width: 10, value: (r) => r.scorePercentage, numFmt: PERCENT_FORMAT, bold: true, color: COLORS.TEAL },
  { header: 'Score', width: 8, value: (r) => r.score, numFmt: '0' },
  { header: 'Marks Obtained', width: 12, value: (r) => r.marksObtained },
  { header: 'Total Marks', width: 11, value: (r) => r.totalMarks },
  { header: 'Correct', width: 9, value: (r) => r.correct, numFmt: '0' },
  { header: 'Incorrect', width: 9, value: (r) => r.incorrect, numFmt: '0' },
  { header: 'Skipped', width: 8, value: (r) => r.skipped, numFmt: '0' },
  { header: 'Answered', width: 9, value: (r) => r.answered, numFmt: '0' },
  { header: 'Total Questions', width: 10, value: (r) => r.totalQuestions, numFmt: '0' },
  { header: 'Accuracy (%)', width: 10, value: (r) => r.accuracy, numFmt: PERCENT_FORMAT },
  { header: 'Percentile', width: 10, value: (r) => r.percentile, numFmt: '0.0' },
  { header: 'Time (min)', width: 9, value: (r) => r.timeSpentMinutes, numFmt: '0.00' },
  { header: 'Tab Switches', width: 9, value: (r) => r.tabSwitchCount, numFmt: '0' },
  // Phase 7 (§25.2) proctoring columns — identical values in the app's
  // analytics block and the CSV export (shared collector). Empty for
  // non-proctored attempts and guests.
  { header: 'Risk Category', width: 12, value: (r) => r.riskCategory, align: 'center' },
  { header: 'Total Violations', width: 10, value: (r) => r.totalViolations, numFmt: '0', align: 'center' },
  { header: 'Focus-loss Exits', width: 10, value: (r) => r.focusLossExits, numFmt: '0', align: 'center' },
  { header: 'Multiple-Face Events', width: 11, value: (r) => r.multipleFaceEvents, numFmt: '0', align: 'center' },
  { header: 'Face-Absent Total', width: 10, value: (r) => r.faceAbsentTotal, numFmt: '0', align: 'center' },
  { header: 'Camera Incidents', width: 10, value: (r) => r.cameraIncidents, numFmt: '0', align: 'center' },
  { header: 'Heartbeat Gaps', width: 10, value: (r) => r.heartbeatGaps, numFmt: '0', align: 'center' },
  { header: 'Status', width: 13, value: (r) => r.status },
  { header: 'Started At', width: 17, value: (r) => r.startedAt, numFmt: DATETIME_FORMAT },
  { header: 'Completed At', width: 17, value: (r) => r.completedAt, numFmt: DATETIME_FORMAT },
  { header: 'Section Breakdown', width: 44, value: (r) => r.sectionBreakdown, wrap: true },
  { header: 'Phone', width: 15, value: (r) => r.phone, adminOnly: true },
  { header: 'Phone Verified', width: 10, value: (r) => r.phoneVerified, align: 'center', adminOnly: true },
  { header: 'Email Verified', width: 10, value: (r) => r.emailVerified, align: 'center', adminOnly: true },
  { header: 'Marketing Consent', width: 11, value: (r) => r.marketingConsent, align: 'center', adminOnly: true },
  { header: 'Attempt ID', width: 26, value: (r) => r.attemptId },
  { header: 'Student ID', width: 26, value: (r) => r.studentId },
];

// Overview strip above the table — the CSV's Overview + Performance Metrics
// sections, one label/value pair per merged column pair. Value colors follow
// the app's KPI card accents.
const kpiBand = (data) => [
  { label: 'Total Assigned', value: data.overview.totalAssigned, color: COLORS.DARK, numFmt: '0' },
  { label: 'Total Attempted', value: data.overview.totalAttempted, color: COLORS.DARK, numFmt: '0' },
  { label: 'Completion', value: data.overview.completionRate, color: COLORS.TEAL, numFmt: '0"%"' },
  { label: 'Avg Score', value: data.overview.avgScore, color: COLORS.TEAL },
  { label: 'Highest Score', value: data.overview.highestScore, color: COLORS.GREEN },
  { label: 'Lowest Score', value: data.overview.lowestScore, color: COLORS.RED },
  { label: 'Avg Correct', value: data.metrics.avgCorrect, color: COLORS.GREEN },
  { label: 'Avg Wrong', value: data.metrics.avgWrong, color: COLORS.RED },
  { label: 'Avg Skipped', value: data.metrics.avgSkipped, color: COLORS.MUTED },
  { label: 'Avg Time (min)', value: data.metrics.avgTime, color: COLORS.BLUE },
];

const TITLE_ROW = 1;
const META_ROW = 2;
const GENERATED_ROW = 3;
const KPI_LABEL_ROW = 5;
const KPI_VALUE_ROW = 6;
const SECTION_ROW = 8;
const STUDENT_HEADER_ROW = 9;

function buildStudentSheet(workbook, data) {
  const sheet = workbook.addWorksheet(STUDENT_SHEET_NAME, {
    properties: { tabColor: { argb: COLORS.TEAL } },
  });

  const columns = STUDENT_COLUMNS.filter(
    (col) => !col.adminOnly || data.includeLeadColumns
  );
  columns.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width;
  });

  // Report header block — plain overflow text, no fills, so it reads like the
  // screen's title area.
  const title = sheet.getCell(TITLE_ROW, 1);
  title.value = data.test.title || 'Test Report';
  title.font = { name: FONT, size: 14, bold: true, color: COLORS.DARK };
  sheet.getRow(TITLE_ROW).height = 22;

  const meta = sheet.getCell(META_ROW, 1);
  meta.value = [
    data.test.subject,
    data.test.testType ? `${data.test.testType} test` : null,
    `${data.test.totalQuestions} questions`,
    `${data.test.totalMarks} marks`,
  ]
    .filter(Boolean)
    .join('  ·  ');
  meta.font = { name: FONT, size: 9, color: COLORS.MUTED };

  const generated = sheet.getCell(GENERATED_ROW, 1);
  generated.value = `Generated ${data.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  generated.font = { name: FONT, size: 9, color: COLORS.FAINT };

  // KPI band: one merged column pair per metric, chip background under the
  // labels and a single hairline closing the strip.
  kpiBand(data).forEach((kpi, i) => {
    const startCol = i * 2 + 1;
    sheet.mergeCells(KPI_LABEL_ROW, startCol, KPI_LABEL_ROW, startCol + 1);
    sheet.mergeCells(KPI_VALUE_ROW, startCol, KPI_VALUE_ROW, startCol + 1);

    const labelCell = sheet.getCell(KPI_LABEL_ROW, startCol);
    labelCell.value = kpi.label.toUpperCase();
    labelCell.font = { name: FONT, size: 8, bold: true, color: COLORS.MUTED };
    labelCell.fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.CHIP_BG },
    };
    labelCell.alignment = { horizontal: 'left', vertical: 'bottom' };

    const valueCell = sheet.getCell(KPI_VALUE_ROW, startCol);
    valueCell.value = kpi.value;
    valueCell.font = { name: FONT, size: 11, bold: true, color: kpi.color };
    valueCell.numFmt = kpi.numFmt;
    valueCell.border = { bottom: thinBorder(COLORS.BORDER) };
    valueCell.alignment = { horizontal: 'left', vertical: 'middle' };
  });
  sheet.getRow(KPI_LABEL_ROW).height = 14;
  sheet.getRow(KPI_VALUE_ROW).height = 18;

  const section = sheet.getCell(SECTION_ROW, 1);
  section.value = 'STUDENT PERFORMANCE';
  section.font = { name: FONT, size: 10, bold: true, color: COLORS.BODY };

  // Table header — solid teal band with white bold labels.
  const headerRow = sheet.getRow(STUDENT_HEADER_ROW);
  headerRow.height = 30;
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.TEAL } };
    cell.font = { name: FONT, size: 10, bold: true, color: COLORS.WHITE };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  // Data rows: ranked registered students first, then unranked guests
  // (admin-only lead data; mentors never receive guest rows).
  const rows = [...data.students, ...(data.includeLeadColumns ? data.guests : [])];

  rows.forEach((row, idx) => {
    const excelRow = sheet.getRow(STUDENT_HEADER_ROW + 1 + idx);
    const isLast = idx === rows.length - 1;

    columns.forEach((col, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = col.value(row);
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
      cell.alignment = col.wrap
        ? { horizontal: 'left', vertical: 'top', wrapText: true }
        : { horizontal: col.align || 'left', vertical: 'middle' };
    });

    excelRow.height = boundedRowHeight(wrapLines(row.sectionBreakdown, 42));
  });

  if (rows.length === 0) {
    const noteCell = sheet.getCell(STUDENT_HEADER_ROW + 1, 1);
    noteCell.value = 'No student has attempted this test yet.';
    noteCell.font = { name: FONT, size: 10, italic: true, color: COLORS.MUTED };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle' };
    sheet.mergeCells(
      STUDENT_HEADER_ROW + 1, 1,
      STUDENT_HEADER_ROW + 1, Math.min(columns.length, 6)
    );
  }

  const lastDataRow = STUDENT_HEADER_ROW + Math.max(rows.length, 1);
  sheet.views = [{
    state: 'frozen',
    xSplit: 0,
    ySplit: STUDENT_HEADER_ROW,
    topLeftCell: `A${STUDENT_HEADER_ROW + 1}`,
  }];
  sheet.autoFilter = {
    from: { row: STUDENT_HEADER_ROW, column: 1 },
    to: { row: lastDataRow, column: columns.length },
  };

  return sheet;
}

// ---------------------------------------------------------------------------
// Question-wise Analytics sheet
// ---------------------------------------------------------------------------

const QUESTION_COLUMNS = [
  { header: 'Q No', width: 6, value: (q) => q.questionNumber, numFmt: '0', align: 'center' },
  { header: 'Subject', width: 14, value: (q) => q.subjectName },
  { header: 'Topic', width: 18, value: (q) => q.topicName },
  { header: 'Question Text', width: 60, value: (q) => q.questionText, wrap: true, wrapChars: 58 },
  { header: 'Option A', width: 22, value: (q) => q.optionA, wrap: true, wrapChars: 20 },
  { header: 'Option B', width: 22, value: (q) => q.optionB, wrap: true, wrapChars: 20 },
  { header: 'Option C', width: 22, value: (q) => q.optionC, wrap: true, wrapChars: 20 },
  { header: 'Option D', width: 22, value: (q) => q.optionD, wrap: true, wrapChars: 20 },
  { header: 'Correct Option', width: 9, value: (q) => q.correctOptionLabel, align: 'center' },
  { header: 'Correct Answer Text', width: 22, value: (q) => q.correctOptionText, wrap: true, wrapChars: 20 },
  { header: 'Correct', width: 9, value: (q) => q.correctCount, numFmt: '0' },
  { header: 'Wrong', width: 9, value: (q) => q.wrongCount, numFmt: '0' },
  { header: 'Skipped', width: 9, value: (q) => q.skippedCount, numFmt: '0' },
  { header: 'Correct (%)', width: 10, value: (q) => q.percentCorrect, numFmt: PERCENT_FORMAT, difficulty: true },
  { header: 'Wrong (%)', width: 10, value: (q) => q.percentWrong, numFmt: PERCENT_FORMAT },
  { header: 'Skipped (%)', width: 10, value: (q) => q.percentSkipped, numFmt: PERCENT_FORMAT },
];

const QUESTION_HEADER_ROW = 4;

// Difficulty signal on the correct-rate column, matching the app's
// green/amber/red accent usage (ScoreLegend buckets).
const difficultyColor = (percentCorrect) => {
  if (percentCorrect === null || percentCorrect === undefined) return COLORS.BODY;
  if (percentCorrect >= 75) return COLORS.GREEN;
  if (percentCorrect >= 40) return COLORS.AMBER;
  return COLORS.RED;
};

function buildQuestionSheet(workbook, data) {
  const sheet = workbook.addWorksheet(QUESTION_SHEET_NAME, {
    properties: { tabColor: { argb: COLORS.TEAL } },
  });

  QUESTION_COLUMNS.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width;
  });

  const title = sheet.getCell(1, 1);
  title.value = `Question-wise Analytics — ${data.test.title || 'Test Report'}`;
  title.font = { name: FONT, size: 14, bold: true, color: COLORS.DARK };
  sheet.getRow(1).height = 22;

  const attempts = data.overview.totalAttempted;
  const meta = sheet.getCell(2, 1);
  meta.value = `Percentages based on ${attempts} completed attempt${attempts === 1 ? '' : 's'}`;
  meta.font = { name: FONT, size: 9, color: COLORS.MUTED };

  const headerRow = sheet.getRow(QUESTION_HEADER_ROW);
  headerRow.height = 30;
  QUESTION_COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.TEAL } };
    cell.font = { name: FONT, size: 10, bold: true, color: COLORS.WHITE };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  data.questions.forEach((question, idx) => {
    const excelRow = sheet.getRow(QUESTION_HEADER_ROW + 1 + idx);
    const isLast = idx === data.questions.length - 1;
    const wrapNeeded = Math.max(
      ...QUESTION_COLUMNS.map((col) => wrapLines(col.value(question), col.wrapChars || 80))
    );

    QUESTION_COLUMNS.forEach((col, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = col.value(question);
      cell.font = {
        name: FONT,
        size: 10,
        bold: Boolean(col.difficulty),
        color: col.difficulty ? difficultyColor(question.percentCorrect) : COLORS.BODY,
      };
      if (col.numFmt) cell.numFmt = col.numFmt;
      cell.border = { bottom: thinBorder(isLast ? COLORS.BORDER_STRONG : COLORS.BORDER) };
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.BAND } };
      }
      cell.alignment = col.wrap
        ? { horizontal: 'left', vertical: 'top', wrapText: true }
        : { horizontal: col.align || 'left', vertical: 'middle' };
    });

    excelRow.height = boundedRowHeight(wrapNeeded);
  });

  if (data.questions.length === 0) {
    const noteCell = sheet.getCell(QUESTION_HEADER_ROW + 1, 1);
    noteCell.value = 'No questions on this test.';
    noteCell.font = { name: FONT, size: 10, italic: true, color: COLORS.MUTED };
    sheet.mergeCells(QUESTION_HEADER_ROW + 1, 1, QUESTION_HEADER_ROW + 1, 4);
  }

  const lastDataRow = QUESTION_HEADER_ROW + Math.max(data.questions.length, 1);
  sheet.views = [{
    state: 'frozen',
    xSplit: 0,
    ySplit: QUESTION_HEADER_ROW,
    topLeftCell: `A${QUESTION_HEADER_ROW + 1}`,
  }];
  sheet.autoFilter = {
    from: { row: QUESTION_HEADER_ROW, column: 1 },
    to: { row: lastDataRow, column: QUESTION_COLUMNS.length },
  };

  return sheet;
}

/**
 * Builds the two-sheet test report workbook.
 *
 * @param {object} data the payload returned by collectTestReportData()
 *   ({ test, overview, metrics, students, guests, questions,
 *   includeLeadColumns, generatedAt })
 * @returns {Excel.Workbook} unserialized workbook — callers write it with
 *   workbook.xlsx.writeBuffer()
 */
function buildTestReportWorkbook(data) {
  const workbook = new Excel.Workbook();
  workbook.creator = 'Eyeconic';
  workbook.created = data.generatedAt instanceof Date ? data.generatedAt : new Date();

  buildStudentSheet(workbook, data);
  buildQuestionSheet(workbook, data);

  return workbook;
}

module.exports = {
  buildTestReportWorkbook,
  STUDENT_SHEET_NAME,
  QUESTION_SHEET_NAME,
};
