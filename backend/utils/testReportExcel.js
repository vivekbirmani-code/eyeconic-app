// Styled three-sheet Excel workbook for the test report export. Built from the
// exact rows collectTestReportData() feeds the CSV export, so both formats
// always carry identical data — this module only owns presentation.
//
// Design mirrors the app's Analytics screens (student-analytics.tsx): teal
// primary #01b4AE, gray text/borders, green/red/amber/blue accents — kept
// deliberately restrained (fills on headers and the KPI band only).
const Excel = require('exceljs');

const STUDENT_SHEET_NAME = 'Student Performance';
const QUESTION_SHEET_NAME = 'Question-wise Analytics';
const RESPONSES_SHEET_NAME = 'User Responses';

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
// Excel's built-in Text format. Applied to student-response cells so the
// value stays text end to end: ExcelJS stores JS strings as shared-string
// cells Excel never reinterprets on open, and the '@' format keeps any
// later cell edit text-typed too.
const TEXT_FORMAT = '@';

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
  { header: 'Look-away Events', width: 10, value: (r) => r.lookAwayEvents, numFmt: '0', align: 'center' },
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
// User Responses sheet
// ---------------------------------------------------------------------------

// Wide "answer sheet" layout: ONE ROW PER ATTEMPT. Identity and attempt
// totals render once, followed by a Response/Status column pair per question
// slot (Q1, Q2, …). Slots align across every participant through the shared
// row builder's questionNumber (the quiz's current question-list order), so
// a response can never drift into a neighbouring question's column —
// participants who saw fewer questions simply leave the trailing cells
// empty. A merged question-text band sits ABOVE the filter header (so
// filtering can never hide it), and the identity block is frozen together
// with both header rows so wide question columns scroll under a pinned
// participant block.
const RESPONSE_IDENTITY_COLUMNS = [
  { header: 'Student Name', width: 22, value: (b) => b.studentName, bold: true, color: COLORS.DARK, wrapChars: 21 },
  { header: 'Email', width: 26, value: (b) => b.studentEmail, wrapChars: 25 },
  // Phone/Participant Type are lead-adjacent data: hidden for mentors exactly
  // like the Student Performance lead columns (guests never reach mentor
  // exports at all).
  { header: 'Phone', width: 15, value: (b) => b.studentPhone || '', adminOnly: true },
  { header: 'Participant Type', width: 13, value: (b) => b.participantType, align: 'center', adminOnly: true },
  { header: 'Rank', width: 6, value: (b) => b.rank, numFmt: '0', align: 'center' },
  { header: 'Attempt No', width: 8, value: (b) => b.attemptNumber, numFmt: '0', align: 'center' },
  { header: 'Attempt ID', width: 26, value: (b) => b.attemptId, identity: true },
  // Attempt-level totals mirror the Student Performance sheet by
  // construction (joined from the same collector rows).
  { header: 'Score (%)', width: 9, value: (b) => b.scorePercentage, numFmt: PERCENT_FORMAT, bold: true, color: COLORS.TEAL },
  { header: 'Marks Obtained', width: 12, value: (b) => b.marksObtained },
  { header: 'Total Marks', width: 10, value: (b) => b.totalMarks },
  { header: 'Correct', width: 7, value: (b) => b.correct, numFmt: '0', align: 'center' },
  { header: 'Wrong', width: 7, value: (b) => b.incorrect, numFmt: '0', align: 'center' },
  { header: 'Skipped', width: 7, value: (b) => b.skipped, numFmt: '0', align: 'center' },
  { header: 'Submitted At', width: 17, value: (b) => b.submittedAt, numFmt: DATETIME_FORMAT },
];

const RESPONSE_VALUE_WIDTH = 26;
const RESPONSE_STATUS_WIDTH = 10;

// Lead columns ride only in admin exports (mentors never receive guest data).
const identityColumnsOf = (data) => RESPONSE_IDENTITY_COLUMNS.filter(
  (col) => !col.adminOnly || data.includeLeadColumns
);

// Student responses are exported as TEXT cells — never numeric/date. The
// row builder's label/text contract is already string-typed; this coercion
// is the guarantee at the workbook layer, so no upstream data shape (legacy
// option values, raw stored answers) can ever land as a numeric or date
// cell that Excel would reformat (00123 → 123, 12/10/2026 → a date serial,
// 25% → 0.25).
const asResponseText = (value) => (value === null || value === undefined ? '' : String(value));

// Compact option-letter keys ("B", "A, C") prefix the fuller response text
// so a question column stays scannable at a glance; types whose label
// already carries the full content (numerical values, match-the-following
// pairs, raw stored strings) render the text alone. Skipped questions keep
// the app's established "Not answered" wording, while an answered question
// whose stored response legitimately formats to '' stays '' — the Status
// column carries the explicit verdict either way, so an empty cell is never
// mistaken for missing data.
const OPTION_LETTER_KEY = /^[A-Z](?:,\s*[A-Z])*$/;

const responseCellOf = (q) => {
  if (!q) return '';
  if (q.result === 'skipped') return 'Not answered';
  const label = q.studentResponseLabel;
  const text = q.studentResponseText;
  if (label && text && label !== text && OPTION_LETTER_KEY.test(label)) {
    return `${label} — ${text}`;
  }
  return asResponseText(text || label || '');
};

// Band label for one question group: type label + question text, or the
// honest placeholder when no attempt can still resolve the question doc.
const questionBandTextOf = (row) => {
  if (!row) return '';
  if (row.questionUnavailable || !row.question) {
    return 'Question no longer available (removed from question bank)';
  }
  return row.questionTypeLabel
    ? `${row.questionTypeLabel} · ${row.question}`
    : row.question;
};

const RESPONSES_TITLE_ROW = 1;
const RESPONSES_META_ROW = 2;
const RESPONSES_GENERATED_ROW = 3;
// Merged question-text band, then the filterable header below it.
const RESPONSES_QUESTION_ROW = 5;
const RESPONSES_HEADER_ROW = 6;

function buildUserResponsesSheet(workbook, data) {
  const sheet = workbook.addWorksheet(RESPONSES_SHEET_NAME, {
    properties: { tabColor: { argb: COLORS.TEAL } },
  });

  const responses = data.userResponses;
  const identityColumns = identityColumnsOf(data);

  // Attempt blocks in report order (ranked registered students first, then
  // admin-only guest leads). Guests are lead data — never rendered in mentor
  // exports even if rows leaked into the payload (the collector already
  // leaves guests out for mentors; same guard as the Student Performance
  // sheet).
  const blocks = (responses?.attempts || []).filter(
    (block) => block.participantType !== 'Guest' || data.includeLeadColumns
  );

  // Map each attempt's question rows onto shared slot columns. The shared
  // row builder numbers main slots contiguously (1..stored totalQuestions)
  // and appends any legacy unpaired answers AFTER them, so first-wins keys
  // main slots; an appended row whose number no main slot claimed still
  // lands on its quiz-slot column (aligned with every other participant),
  // and a true duplicate number becomes a per-attempt extra column instead
  // of silently overwriting the slot it collides with.
  const entries = blocks.map((block) => {
    const bySlot = new Map();
    const extras = [];
    if (!block.attemptUnavailable && Array.isArray(block.rows)) {
      block.rows.forEach((row) => {
        const slot = Number(row?.questionNumber);
        if (Number.isInteger(slot) && slot >= 1 && !bySlot.has(slot)) {
          bySlot.set(slot, row);
        } else {
          extras.push(row);
        }
      });
    }
    return { block, bySlot, extras };
  });

  // Question column groups: Q1..Qmax shared slots, then per-attempt extras.
  const groups = [];
  const maxSlot = entries.reduce(
    (max, entry) => Math.max(max, ...entry.bySlot.keys()),
    0
  );
  for (let slot = 1; slot <= maxSlot; slot += 1) {
    groups.push({ label: `Q${slot}`, slot });
  }
  const usedLabels = new Set(groups.map((group) => group.label));
  entries.forEach((entry, entryIndex) => {
    entry.extras.forEach((row, extraIndex) => {
      const base = `Q${Number(row?.questionNumber) || '?'} (extra)`;
      const label = usedLabels.has(base)
        ? `${base} — ${entry.block.studentName}, Attempt ${entry.block.attemptNumber}`
        : base;
      usedLabels.add(label);
      groups.push({ label, entryIndex, extraIndex });
    });
  });

  // The band label prefers a live question doc — deleted-question rows are
  // placeholders, so the header shows a real question whenever any attempt
  // still resolves one.
  const slotRowFor = (slot) => {
    let fallback = null;
    for (const entry of entries) {
      const row = entry.bySlot.get(slot);
      if (!row) continue;
      if (!row.questionUnavailable) return row;
      if (!fallback) fallback = row;
    }
    return fallback;
  };
  groups.forEach((group) => {
    group.row = group.slot !== undefined
      ? slotRowFor(group.slot)
      : entries[group.entryIndex].extras[group.extraIndex];
  });

  // Dynamic columns: one Response + one Status column per question group.
  const questionColumns = groups.map((group, groupIndex) => ([
    {
      header: `${group.label} Response`,
      width: RESPONSE_VALUE_WIDTH,
      groupIndex,
      kind: 'response',
      wrap: true,
      wrapChars: RESPONSE_VALUE_WIDTH - 1,
      numFmt: TEXT_FORMAT,
    },
    {
      header: `${group.label} Status`,
      width: RESPONSE_STATUS_WIDTH,
      groupIndex,
      kind: 'status',
      align: 'center',
      statusColor: true,
    },
  ])).flat();

  const columns = [...identityColumns, ...questionColumns];
  columns.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width;
  });

  // Per-attempt cell payload, resolved once up front — the render loop only
  // reads arrays, keeping the wide sheet (participants × questions) to one
  // map lookup per cell instead of re-pairing rows during styling.
  const payloadByBlock = new Map();
  entries.forEach((entry, entryIndex) => {
    payloadByBlock.set(entry.block, groups.map((group) => {
      const row = group.slot !== undefined
        ? entry.bySlot.get(group.slot)
        : (group.entryIndex === entryIndex ? entry.extras[group.extraIndex] : null);
      return {
        response: asResponseText(responseCellOf(row)),
        result: row?.result || null,
        resultLabel: row?.resultLabel || '',
      };
    }));
  });
  questionColumns.forEach((col) => {
    const { groupIndex, kind } = col;
    col.value = (block) => {
      const cells = payloadByBlock.get(block);
      if (!cells) return '';
      return kind === 'response' ? cells[groupIndex].response : cells[groupIndex].resultLabel;
    };
  });

  const title = sheet.getCell(RESPONSES_TITLE_ROW, 1);
  title.value = `User Responses — ${data.test.title || 'Test Report'}`;
  title.font = { name: FONT, size: 14, bold: true, color: COLORS.DARK };
  sheet.getRow(RESPONSES_TITLE_ROW).height = 22;

  const meta = sheet.getCell(RESPONSES_META_ROW, 1);
  meta.value = responses
    ? `Question-level responses from ${responses.attemptCount} completed attempt${responses.attemptCount === 1 ? '' : 's'} by ${responses.participantCount} participant${responses.participantCount === 1 ? '' : 's'}  ·  +${responses.marking.positiveMarks} / -${responses.marking.negativeMarks} marking`
    : 'Question-level responses for every completed attempt';
  meta.font = { name: FONT, size: 9, color: COLORS.MUTED };

  const generated = sheet.getCell(RESPONSES_GENERATED_ROW, 1);
  generated.value = `Generated ${data.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  generated.font = { name: FONT, size: 9, color: COLORS.FAINT };

  // Question-text band, merged across each group's column pair. It rides
  // ABOVE the filter header so autofilter dropdowns live on the real header
  // row and filtering can never hide the band.
  if (groups.length > 0) {
    let bandLines = 1;
    groups.forEach((group, groupIndex) => {
      const startCol = identityColumns.length + groupIndex * 2 + 1;
      const bandCell = sheet.getCell(RESPONSES_QUESTION_ROW, startCol);
      bandCell.value = questionBandTextOf(group.row);
      bandCell.font = { name: FONT, size: 8, italic: true, color: COLORS.MUTED };
      bandCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.CHIP_BG } };
      bandCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
      sheet.mergeCells(RESPONSES_QUESTION_ROW, startCol, RESPONSES_QUESTION_ROW, startCol + 1);
      bandLines = Math.max(bandLines, wrapLines(bandCell.value, 34));
    });
    sheet.getRow(RESPONSES_QUESTION_ROW).height = Math.min(16 + (bandLines - 1) * 12.5, 110);
  }

  // Table header — solid teal band with white bold labels.
  const headerRow = sheet.getRow(RESPONSES_HEADER_ROW);
  headerRow.height = 30;
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.TEAL } };
    cell.font = { name: FONT, size: 10, bold: true, color: COLORS.WHITE };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  // Prebuilt shared style objects (column × banding × verdict): this sheet
  // can carry a participant × question matrix, and per-cell property
  // assignment (cell.font = …, cell.border = …) is several times slower than
  // one wholesale cell.style reference the Cell constructor itself uses.
  const styleFor = (col, { band = false, font = null }) => {
    const style = {
      font: font || {
        name: FONT,
        size: 10,
        bold: Boolean(col.bold),
        // Wholesale cell.style assignment skips ExcelJS's per-property color
        // normalization, so colors must already be {argb} objects — a bare
        // ARGB string here writes fine in memory but silently drops from the
        // serialized file.
        color: { argb: col.color || COLORS.BODY },
      },
      alignment: col.wrap
        ? { horizontal: 'left', vertical: 'top', wrapText: true }
        : { horizontal: col.align || 'left', vertical: 'middle' },
      border: { bottom: thinBorder(COLORS.BORDER) },
    };
    if (col.numFmt) style.numFmt = col.numFmt;
    if (band) {
      style.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.BAND } };
    }
    return style;
  };

  const verdictFont = (argb) => ({ name: FONT, size: 10, bold: true, color: { argb } });

  // One base style per column per banding state…
  const plainStyles = columns.map((col) => styleFor(col, {}));
  const bandStyles = columns.map((col) => styleFor(col, { band: true }));
  // …plus the verdict variants the Status columns pick row by row.
  const statusStyles = {};
  columns.forEach((col, i) => {
    if (!col.statusColor) return;
    statusStyles[i] = {
      plain: {
        correct: styleFor(col, { font: verdictFont(COLORS.GREEN) }),
        incorrect: styleFor(col, { font: verdictFont(COLORS.RED) }),
        skipped: styleFor(col, { font: verdictFont(COLORS.AMBER) }),
      },
      band: {
        correct: styleFor(col, { band: true, font: verdictFont(COLORS.GREEN) }),
        incorrect: styleFor(col, { band: true, font: verdictFont(COLORS.RED) }),
        skipped: styleFor(col, { band: true, font: verdictFont(COLORS.AMBER) }),
      },
    };
  });

  const wrapColumns = columns
    .map((col, i) => ({ col, i }))
    .filter(({ col }) => col.wrapChars || col.wrap);

  // One data row per attempt (banding simply alternates rows now).
  blocks.forEach((block, idx) => {
    const excelRow = sheet.getRow(RESPONSES_HEADER_ROW + 1 + idx);
    const isLast = idx === blocks.length - 1;
    const band = idx % 2 === 1;
    const cells = payloadByBlock.get(block);

    columns.forEach((col, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = col.value(block);

      let style;
      if (col.statusColor) {
        const result = cells?.[col.groupIndex]?.result;
        const variants = statusStyles[i][band ? 'band' : 'plain'];
        style = result ? (variants[result] || variants.skipped) : (band ? bandStyles : plainStyles)[i];
      } else {
        style = (band ? bandStyles : plainStyles)[i];
      }
      // Strong hairline closes the table.
      if (isLast) {
        style = { ...style, border: { bottom: thinBorder(COLORS.BORDER_STRONG) } };
      }
      cell.style = style;
    });

    const wrapNeeded = Math.max(
      1,
      ...wrapColumns.map(({ col }) => wrapLines(col.value(block), col.wrapChars || 80))
    );
    excelRow.height = boundedRowHeight(wrapNeeded);
  });

  if (blocks.length === 0) {
    const noteCell = sheet.getCell(RESPONSES_HEADER_ROW + 1, 1);
    noteCell.value = 'No responses available for this test yet.';
    noteCell.font = { name: FONT, size: 10, italic: true, color: COLORS.MUTED };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle' };
    sheet.mergeCells(
      RESPONSES_HEADER_ROW + 1, 1,
      RESPONSES_HEADER_ROW + 1, Math.min(columns.length, 6)
    );
  }

  // Honesty notes ride after the table: deleted questions, then attempts
  // whose response details could not be loaded at all.
  let noteRowNumber = RESPONSES_HEADER_ROW + blocks.length + 2;
  const addNote = (text) => {
    const noteCell = sheet.getCell(noteRowNumber, 1);
    noteCell.value = text;
    noteCell.font = { name: FONT, size: 9, italic: true, color: COLORS.MUTED };
    sheet.mergeCells(noteRowNumber, 1, noteRowNumber, 8);
    noteRowNumber += 1;
  };
  const missingQuestionCount = responses?.missingQuestionCount || 0;
  if (missingQuestionCount > 0) {
    addNote(`${missingQuestionCount} response${missingQuestionCount === 1 ? '' : 's'} could not show the question (removed from the question bank after the attempt).`);
  }
  const unavailableAttempts = entries.filter((entry) => entry.block.attemptUnavailable).length;
  if (unavailableAttempts > 0) {
    addNote(`Response details for ${unavailableAttempts} attempt${unavailableAttempts === 1 ? '' : 's'} could not be loaded (attempt data no longer available).`);
  }

  const lastDataRow = RESPONSES_HEADER_ROW + Math.max(blocks.length, 1);
  // Freeze the identity block (through Attempt ID) together with both header
  // rows — column counts differ between admin and mentor exports.
  const identitySplit = columns.filter((col) => col.identity).length
    ? columns.findIndex((col) => col.identity) + 1
    : 0;
  sheet.views = [{
    state: 'frozen',
    xSplit: identitySplit,
    ySplit: RESPONSES_HEADER_ROW,
    topLeftCell: sheet.getCell(RESPONSES_HEADER_ROW + 1, identitySplit + 1).address,
  }];
  sheet.autoFilter = {
    from: { row: RESPONSES_HEADER_ROW, column: 1 },
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
 * Builds the three-sheet test report workbook.
 *
 * @param {object} data the payload returned by collectTestReportData()
 *   ({ test, overview, metrics, students, guests, questions,
 *   includeLeadColumns, generatedAt, userResponses? }) — the User Responses
 *   sheet renders an explicit empty state when userResponses is absent
 *   (collectors only populate it for the Excel route)
 * @returns {Excel.Workbook} unserialized workbook — callers write it with
 *   workbook.xlsx.writeBuffer()
 */
function buildTestReportWorkbook(data) {
  const workbook = new Excel.Workbook();
  workbook.creator = 'Eyeconic';
  workbook.created = data.generatedAt instanceof Date ? data.generatedAt : new Date();

  buildStudentSheet(workbook, data);
  buildQuestionSheet(workbook, data);
  buildUserResponsesSheet(workbook, data);

  return workbook;
}

module.exports = {
  buildTestReportWorkbook,
  STUDENT_SHEET_NAME,
  QUESTION_SHEET_NAME,
  RESPONSES_SHEET_NAME,
};
