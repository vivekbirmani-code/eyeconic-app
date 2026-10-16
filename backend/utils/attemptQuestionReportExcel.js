// Styled single-sheet Excel workbook for the student question-level report
// export. Built from the exact payload collectAttemptQuestionReport() feeds
// the JSON and CSV surfaces, so all three formats always carry identical
// data — this module only owns presentation.
//
// Design mirrors utils/testReportExcel.js (the app's Analytics palette):
// teal primary #01B4AE, gray text/borders, green/red/amber accents — kept
// deliberately restrained (fills on the header band and KPI strip only).
const Excel = require('exceljs');

const SHEET_NAME = 'Question Report';

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
// Signed marks: +4 / -1 / 0 (matches finalizeQuizAttempt's award scheme).
const SIGNED_MARKS_FORMAT = '+0;-0;0';

const thinBorder = (color) => ({ style: 'thin', color: { argb: color } });

const wrapLines = (text, charsPerLine) => {
  if (text === null || text === undefined || text === '') return 1;
  return Math.max(1, Math.ceil(String(text).length / charsPerLine));
};

const boundedRowHeight = (lines) => Math.min(16 + (lines - 1) * 12.5, 56);

const resultColor = (result) => {
  if (result === 'correct') return COLORS.GREEN;
  if (result === 'incorrect') return COLORS.RED;
  return COLORS.AMBER;
};

const QUESTION_COLUMNS = [
  { header: 'Q No', width: 6, value: (q) => q.questionNumber, numFmt: '0', align: 'center' },
  { header: 'Section', width: 16, value: (q) => q.section || '', wrapChars: 15 },
  { header: 'Subject', width: 14, value: (q) => q.subjectName || '', wrapChars: 13 },
  { header: 'Topic', width: 16, value: (q) => q.topicName || '', wrapChars: 15 },
  { header: 'Type', width: 15, value: (q) => q.questionTypeLabel || '', wrapChars: 14 },
  { header: 'Question', width: 52, value: (q) => (q.questionUnavailable ? 'Question no longer available (removed from question bank)' : q.question), wrap: true, wrapChars: 50 },
  { header: 'Student Response', width: 30, value: (q) => responseCellText(q), wrap: true, wrapChars: 29 },
  { header: 'Result', width: 11, value: (q) => q.resultLabel, align: 'center', resultColor: true },
  { header: 'Correct Answer', width: 30, value: (q) => (q.correctAnswerText || q.correctAnswerLabel || ''), wrap: true, wrapChars: 29 },
  { header: 'Marks', width: 8, value: (q) => q.marks, numFmt: SIGNED_MARKS_FORMAT, align: 'center' },
  { header: 'Time (s)', width: 8, value: (q) => q.timeSpent, numFmt: '0', align: 'center' },
];

// Response cell: "B — Mitochondria" (label + text) when both exist, else
// whichever is present. "Not answered" already comes formatted from the
// collector for skipped questions.
const responseCellText = (q) => {
  if (q.studentResponseLabel && q.studentResponseText
    && q.studentResponseLabel !== q.studentResponseText) {
    return `${q.studentResponseLabel} — ${q.studentResponseText}`;
  }
  return q.studentResponseText || q.studentResponseLabel || '';
};

const TITLE_ROW = 1;
const META_ROW = 2;
const GENERATED_ROW = 3;
const DETAILS_SECTION_ROW = 5;
const DETAILS_FIRST_ROW = 6;
const KPI_LABEL_ROW = 14;
const KPI_VALUE_ROW = 15;
const TABLE_SECTION_ROW = 17;
const HEADER_ROW = 18;

// Attempt summary KPI strip — same merged-pair layout as the test report's
// overview band, with value colors following the app's KPI card accents.
const kpiBand = (report) => [
  { label: 'Score %', value: report.attempt.scorePercentage ?? 0, color: COLORS.TEAL, numFmt: PERCENT_FORMAT },
  { label: 'Marks', value: report.attempt.marksObtained, color: COLORS.DARK },
  { label: 'Out of', value: report.attempt.totalMarks, color: COLORS.MUTED },
  { label: 'Correct', value: report.attempt.correct, color: COLORS.GREEN, numFmt: '0' },
  { label: 'Wrong', value: report.attempt.incorrect, color: COLORS.RED, numFmt: '0' },
  { label: 'Skipped', value: report.attempt.skipped, color: COLORS.AMBER, numFmt: '0' },
  { label: 'Accuracy', value: report.attempt.accuracy ?? 'N/A', color: COLORS.BLUE, numFmt: PERCENT_FORMAT },
  { label: 'Time (min)', value: roundMinutes(report.attempt.timeTakenSeconds), color: COLORS.BLUE, numFmt: '0.0' },
];

const roundMinutes = (seconds) => {
  const num = Number(seconds);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round((num / 60) * 10) / 10;
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().replace('T', ' ').slice(0, 16);
};

function buildQuestionSheet(workbook, report) {
  const sheet = workbook.addWorksheet(SHEET_NAME, {
    properties: { tabColor: { argb: COLORS.TEAL } },
  });

  QUESTION_COLUMNS.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width;
  });

  // Report header block — plain overflow text, no fills, so it reads like the
  // screen's title area.
  const title = sheet.getCell(TITLE_ROW, 1);
  title.value = `${report.student.name} — ${report.quiz.title || 'Test'}`;
  title.font = { name: FONT, size: 14, bold: true, color: COLORS.DARK };
  sheet.getRow(TITLE_ROW).height = 22;

  const meta = sheet.getCell(META_ROW, 1);
  meta.value = [
    report.quiz.testType ? `${report.quiz.testType} test` : null,
    report.quiz.subjectNames.length > 0 ? report.quiz.subjectNames.join(', ') : null,
    `${report.attempt.totalQuestions} questions`,
    `+${report.marking.positiveMarks} / -${report.marking.negativeMarks} marking`,
  ]
    .filter(Boolean)
    .join('  ·  ');
  meta.font = { name: FONT, size: 9, color: COLORS.MUTED };

  const generated = sheet.getCell(GENERATED_ROW, 1);
  generated.value = `Attempted ${formatDateTime(report.attempt.endTime)} UTC  ·  Generated ${formatDateTime(report.generatedAt)} UTC`;
  generated.font = { name: FONT, size: 9, color: COLORS.FAINT };

  // Student & test details — label/value pairs, labels chip-muted.
  const section = sheet.getCell(DETAILS_SECTION_ROW, 1);
  section.value = 'STUDENT & TEST';
  section.font = { name: FONT, size: 10, bold: true, color: COLORS.BODY };

  const details = [
    ['Student', report.student.name],
    ['Email', report.student.email || '—'],
    ['Participant Type', report.participantType === 'guest' ? 'Public quiz guest' : 'Registered'],
    ['Test', report.quiz.title || '—'],
    ['Attempt Status', report.attempt.status === 'auto_submitted' ? 'Auto-submitted' : 'Completed'],
    ['Attempt ID', report.attempt._id],
  ];
  details.forEach(([label, value], i) => {
    const row = DETAILS_FIRST_ROW + i;
    const labelCell = sheet.getCell(row, 1);
    labelCell.value = label.toUpperCase();
    labelCell.font = { name: FONT, size: 8, bold: true, color: COLORS.MUTED };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.CHIP_BG } };
    labelCell.alignment = { horizontal: 'left', vertical: 'middle' };

    const valueCell = sheet.getCell(row, 2);
    valueCell.value = value;
    valueCell.font = { name: FONT, size: 11, color: COLORS.DARK };
    valueCell.border = { bottom: thinBorder(COLORS.BORDER) };
    valueCell.alignment = { horizontal: 'left', vertical: 'middle' };
    sheet.mergeCells(row, 2, row, 4);
    sheet.getRow(row).height = 16;
  });

  // KPI band: one merged column pair per metric, chip background under the
  // labels and a single hairline closing the strip.
  kpiBand(report).forEach((kpi, i) => {
    const startCol = i * 2 + 1;
    sheet.mergeCells(KPI_LABEL_ROW, startCol, KPI_LABEL_ROW, startCol + 1);
    sheet.mergeCells(KPI_VALUE_ROW, startCol, KPI_VALUE_ROW, startCol + 1);

    const labelCell = sheet.getCell(KPI_LABEL_ROW, startCol);
    labelCell.value = kpi.label.toUpperCase();
    labelCell.font = { name: FONT, size: 8, bold: true, color: COLORS.MUTED };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.CHIP_BG } };
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

  const tableSection = sheet.getCell(TABLE_SECTION_ROW, 1);
  tableSection.value = 'QUESTION-LEVEL REPORT';
  tableSection.font = { name: FONT, size: 10, bold: true, color: COLORS.BODY };

  // Table header — solid teal band with white bold labels.
  const headerRow = sheet.getRow(HEADER_ROW);
  headerRow.height = 30;
  QUESTION_COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.TEAL } };
    cell.font = { name: FONT, size: 10, bold: true, color: COLORS.WHITE };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  report.questions.forEach((question, idx) => {
    const excelRow = sheet.getRow(HEADER_ROW + 1 + idx);
    const isLast = idx === report.questions.length - 1;
    const wrapNeeded = Math.max(
      ...QUESTION_COLUMNS.map((col) => wrapLines(col.value(question), col.wrapChars || 80))
    );

    QUESTION_COLUMNS.forEach((col, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = col.value(question);
      cell.font = {
        name: FONT,
        size: 10,
        bold: Boolean(col.resultColor),
        color: col.resultColor ? resultColor(question.result) : COLORS.BODY,
      };
      if (question.questionUnavailable && col.header === 'Question') {
        cell.font = { name: FONT, size: 10, italic: true, color: COLORS.MUTED };
      }
      if (col.numFmt && Number.isFinite(Number(cell.value))) cell.numFmt = col.numFmt;
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

  if (report.questions.length === 0) {
    const noteCell = sheet.getCell(HEADER_ROW + 1, 1);
    noteCell.value = 'No questions on this attempt.';
    noteCell.font = { name: FONT, size: 10, italic: true, color: COLORS.MUTED };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle' };
    sheet.mergeCells(HEADER_ROW + 1, 1, HEADER_ROW + 1, 4);
  }

  // Deleted-question honesty note rides after the table.
  if (report.missingQuestionCount > 0) {
    const noteRow = sheet.getRow(HEADER_ROW + report.questions.length + 2);
    const noteCell = noteRow.getCell(1);
    noteCell.value = `${report.missingQuestionCount} question${report.missingQuestionCount === 1 ? '' : 's'} could not be shown (removed from the question bank after this attempt).`;
    noteCell.font = { name: FONT, size: 9, italic: true, color: COLORS.MUTED };
    sheet.mergeCells(noteRow.number, 1, noteRow.number, 6);
  }

  const lastDataRow = HEADER_ROW + Math.max(report.questions.length, 1);
  sheet.views = [{
    state: 'frozen',
    xSplit: 0,
    ySplit: HEADER_ROW,
    topLeftCell: `A${HEADER_ROW + 1}`,
  }];
  sheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: lastDataRow, column: QUESTION_COLUMNS.length },
  };

  return sheet;
}

/**
 * Builds the single-sheet question report workbook.
 *
 * @param {object} report the payload returned by collectAttemptQuestionReport()
 * @returns {Excel.Workbook} unserialized workbook — callers write it with
 *   workbook.xlsx.writeBuffer()
 */
function buildAttemptQuestionReportWorkbook(report) {
  const workbook = new Excel.Workbook();
  workbook.creator = 'Eyeconic';
  workbook.created = report.generatedAt instanceof Date ? report.generatedAt : new Date();

  buildQuestionSheet(workbook, report);

  return workbook;
}

module.exports = {
  buildAttemptQuestionReportWorkbook,
  SHEET_NAME,
};
