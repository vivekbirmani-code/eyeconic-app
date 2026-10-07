const Excel = require('exceljs');
const {
  buildLeaderboardWorkbook,
  toExportRows,
  LEADERBOARD_EXPORT_COLUMNS,
  LEADERBOARD_SHEET_NAME,
} = require('../../utils/leaderboardExport');

// Mirrors the shape rankStudentAttempts returns (utils/analytics) plus the
// `position` field toExportRows adds.
function buildLeaderboard() {
  return [
    {
      _id: 'att1',
      studentId: 'stu1',
      studentName: 'Carol Topper',
      studentEmail: 'carol@example.com',
      score: 4,
      totalQuestions: 4,
      marksObtained: 16,
      totalMarks: 16,
      scorePercentage: 100,
      accuracy: 100,
      correct: 4,
      incorrect: 0,
      skipped: 0,
      attempted: 4,
      percentage: 100,
      timeSpent: 12.5,
      completedAt: new Date('2026-10-01T09:12:30Z'),
      endTime: new Date('2026-10-01T09:12:30Z'),
      tabSwitchCount: 0,
      rank: 1,
    },
    {
      _id: 'att2',
      studentId: 'stu2',
      studentName: 'Alice Ranker',
      studentEmail: 'alice@example.com',
      score: 3,
      totalQuestions: 4,
      marksObtained: 11,
      totalMarks: 16,
      scorePercentage: 68.75,
      accuracy: 75,
      correct: 3,
      incorrect: 1,
      skipped: 0,
      attempted: 4,
      percentage: 68.75,
      timeSpent: 18.25,
      completedAt: new Date('2026-10-01T09:20:00Z'),
      endTime: new Date('2026-10-01T09:20:00Z'),
      tabSwitchCount: 2,
      rank: 2,
    },
  ];
}

function buildData(overrides = {}) {
  return {
    test: {
      title: 'NEET Grand Test 04',
      subjectName: 'Pathology',
      testType: 'grand',
      totalQuestions: 4,
      totalMarks: 16,
    },
    rows: toExportRows(buildLeaderboard()),
    generatedAt: new Date('2026-10-06T12:00:00Z'),
    ...overrides,
  };
}

// Excel row access works over the live workbook object (not the serialized
// file) so style assertions are possible.
const headerRowOf = (sheet, firstHeader) => {
  for (let row = 1; row <= 25; row += 1) {
    if (sheet.getCell(row, 1).value === firstHeader) return row;
  }
  throw new Error(`Header row starting with "${firstHeader}" not found`);
};

const headersOf = (sheet, headerRow) => {
  const headers = [];
  for (let col = 1; col <= 40; col += 1) {
    const value = sheet.getCell(headerRow, col).value;
    if (value === null || value === undefined || value === '') break;
    headers.push(String(value));
  }
  return headers;
};

const rowOf = (sheet, headerRow, name) => {
  const nameCol = headersOf(sheet, headerRow).indexOf('Student Name') + 1;
  for (let row = headerRow + 1; row <= headerRow + 200; row += 1) {
    if (sheet.getCell(row, nameCol).value === name) return row;
  }
  throw new Error(`Row for "${name}" not found`);
};

const cellValue = (sheet, headerRow, row, header) => {
  const col = headersOf(sheet, headerRow).indexOf(header) + 1;
  return sheet.getCell(row, col).value;
};

const argbOf = (color) => (typeof color === 'string' ? color : color && color.argb);

describe('toExportRows', () => {
  it('adds 1-based positions matching the UI without mutating the input', () => {
    const leaderboard = buildLeaderboard();
    const rows = toExportRows(leaderboard);

    expect(rows.map((r) => r.position)).toEqual([1, 2]);
    expect(leaderboard[0].position).toBeUndefined();

    expect(toExportRows(undefined)).toEqual([]);
    expect(toExportRows(null)).toEqual([]);
  });
});

describe('buildLeaderboardWorkbook', () => {
  it('creates a single professionally named worksheet', () => {
    const workbook = buildLeaderboardWorkbook(buildData());

    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.worksheets[0].name).toBe(LEADERBOARD_SHEET_NAME);
    expect(LEADERBOARD_SHEET_NAME).toBe('Leaderboard');
  });

  it('carries the report title, quiz name and export timestamp', () => {
    const workbook = buildLeaderboardWorkbook(buildData());
    const sheet = workbook.getWorksheet(LEADERBOARD_SHEET_NAME);

    expect(sheet.getCell(1, 1).value).toBe('Leaderboard — NEET Grand Test 04');
    expect(String(sheet.getCell(2, 1).value)).toContain('Pathology');
    expect(String(sheet.getCell(2, 1).value)).toContain('2 participants');
    expect(String(sheet.getCell(3, 1).value)).toContain('2026-10-06 12:00');
  });

  it('renders the column spec as the table header', () => {
    const workbook = buildLeaderboardWorkbook(buildData());
    const sheet = workbook.getWorksheet(LEADERBOARD_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Rank');

    expect(headersOf(sheet, headerRow)).toEqual(LEADERBOARD_EXPORT_COLUMNS.map((c) => c.header));
    expect(headersOf(sheet, headerRow)).toContain('Score (%)');
    expect(headersOf(sheet, headerRow)).toContain('Accuracy (%)');
    expect(headersOf(sheet, headerRow)).toContain('Completed At (UTC)');
  });

  it('styles, freezes and filters the header row', () => {
    const workbook = buildLeaderboardWorkbook(buildData());
    const sheet = workbook.getWorksheet(LEADERBOARD_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Rank');

    const headerCell = sheet.getCell(headerRow, 1);
    expect(argbOf(headerCell.style.fill.fgColor).toUpperCase()).toBe('FF01B4AE');
    expect(argbOf(headerCell.style.font.color).toUpperCase()).toBe('FFFFFFFF');
    expect(headerCell.style.font.bold).toBe(true);

    const view = sheet.views[0];
    expect(view.state).toBe('frozen');
    // ySplit must include the header row itself so it stays pinned.
    expect(view.ySplit).toBe(headerRow);

    expect(sheet.autoFilter).toBeDefined();
  });

  it('writes typed, formatted participant rows in ranked order', () => {
    const workbook = buildLeaderboardWorkbook(buildData());
    const sheet = workbook.getWorksheet(LEADERBOARD_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Rank');

    const firstRow = headerRow + 1;
    const secondRow = headerRow + 2;
    expect(cellValue(sheet, headerRow, firstRow, 'Student Name')).toBe('Carol Topper');
    expect(cellValue(sheet, headerRow, secondRow, 'Student Name')).toBe('Alice Ranker');

    expect(cellValue(sheet, headerRow, firstRow, 'Rank')).toBe(1);
    expect(cellValue(sheet, headerRow, secondRow, 'Rank')).toBe(2);
    expect(cellValue(sheet, headerRow, firstRow, 'Score (%)')).toBe(100);
    expect(cellValue(sheet, headerRow, secondRow, 'Marks Obtained')).toBe(11);
    expect(cellValue(sheet, headerRow, secondRow, 'Total Marks')).toBe(16);
    expect(cellValue(sheet, headerRow, secondRow, 'Correct')).toBe(3);
    expect(cellValue(sheet, headerRow, secondRow, 'Incorrect')).toBe(1);
    expect(cellValue(sheet, headerRow, secondRow, 'Skipped')).toBe(0);
    expect(cellValue(sheet, headerRow, secondRow, 'Accuracy (%)')).toBe(75);
    expect(cellValue(sheet, headerRow, secondRow, 'Time (min)')).toBe(18.25);
    expect(cellValue(sheet, headerRow, secondRow, 'Tab Switches')).toBe(2);
    expect(cellValue(sheet, headerRow, secondRow, 'Attempt ID')).toBe('att2');
    expect(cellValue(sheet, headerRow, secondRow, 'Student ID')).toBe('stu2');

    const scorePctCol = headersOf(sheet, headerRow).indexOf('Score (%)') + 1;
    expect(sheet.getCell(secondRow, scorePctCol).numFmt).toBe('0.0"%"');

    const completedCol = headersOf(sheet, headerRow).indexOf('Completed At (UTC)') + 1;
    expect(sheet.getCell(secondRow, completedCol).value).toBeInstanceOf(Date);
    expect(sheet.getCell(secondRow, completedCol).numFmt).toBe('yyyy-mm-dd hh:mm');
  });

  it('uses the array position as Rank even for a single participant', () => {
    // rankStudentAttempts reports rank null for a single attempt — the UI
    // still shows position 1, and so must the export.
    const leaderboard = buildLeaderboard().slice(0, 1);
    leaderboard[0].rank = null;
    const workbook = buildLeaderboardWorkbook(buildData({ rows: toExportRows(leaderboard) }));
    const sheet = workbook.getWorksheet(LEADERBOARD_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Rank');

    expect(cellValue(sheet, headerRow, headerRow + 1, 'Rank')).toBe(1);
    expect(String(sheet.getCell(2, 1).value)).toContain('1 participant');
  });

  it('leaves nullable metrics blank instead of coercing them', () => {
    const leaderboard = buildLeaderboard().slice(0, 1);
    leaderboard[0].scorePercentage = null;
    leaderboard[0].accuracy = null;
    leaderboard[0].completedAt = null;
    const workbook = buildLeaderboardWorkbook(buildData({ rows: toExportRows(leaderboard) }));
    const sheet = workbook.getWorksheet(LEADERBOARD_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Rank');

    expect(cellValue(sheet, headerRow, headerRow + 1, 'Score (%)')).toBeNull();
    expect(cellValue(sheet, headerRow, headerRow + 1, 'Accuracy (%)')).toBeNull();
    expect(cellValue(sheet, headerRow, headerRow + 1, 'Completed At (UTC)')).toBeNull();
  });

  it('handles an empty leaderboard gracefully', () => {
    const workbook = buildLeaderboardWorkbook(buildData({ rows: [] }));
    const sheet = workbook.getWorksheet(LEADERBOARD_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Rank');

    const noteCell = sheet.getCell(headerRow + 1, 1);
    expect(String(noteCell.value)).toBe('No submissions yet.');
    expect(String(sheet.getCell(2, 1).value)).toContain('0 participants');

    // The workbook still serializes cleanly.
    return expect(workbook.xlsx.writeBuffer()).resolves.toBeDefined();
  });

  it('preserves styling, freeze panes and filters through serialization', async () => {
    // What Excel sees is the serialized file, not the in-memory workbook —
    // guard against ExcelJS silently dropping any of it on write.
    const workbook = buildLeaderboardWorkbook(buildData());
    const buffer = await workbook.xlsx.writeBuffer();
    const reloaded = await new Excel.Workbook().xlsx.load(buffer);

    const sheet = reloaded.getWorksheet(LEADERBOARD_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Rank');

    expect(argbOf(sheet.getCell(headerRow, 1).fill.fgColor).toUpperCase()).toBe('FF01B4AE');
    expect(sheet.views[0].state).toBe('frozen');
    expect(sheet.views[0].ySplit).toBe(headerRow);
    expect(sheet.autoFilter).toBeDefined();

    const scorePctCol = headersOf(sheet, headerRow).indexOf('Score (%)') + 1;
    expect(sheet.getCell(headerRow + 1, scorePctCol).numFmt).toBe('0.0"%"');
  });
});
