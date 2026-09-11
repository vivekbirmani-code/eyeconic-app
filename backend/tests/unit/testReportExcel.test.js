const Excel = require('exceljs');
const {
  buildTestReportWorkbook,
  STUDENT_SHEET_NAME,
  QUESTION_SHEET_NAME,
} = require('../../utils/testReportExcel');

// Mirrors the shape returned by collectTestReportData() (utils/testReportData).
function buildData(overrides = {}) {
  return {
    test: {
      title: 'NEET Grand Test 01',
      subject: 'Pathology',
      testType: 'daily',
      totalQuestions: 2,
      totalMarks: 8,
    },
    overview: {
      totalAssigned: 3,
      totalAttempted: 2,
      completionRate: 67,
      avgScore: 2.5,
      highestScore: 4,
      lowestScore: 1,
    },
    metrics: { avgCorrect: 1, avgWrong: 1, avgSkipped: 0, avgTime: 12.5 },
    students: [
      {
        rank: 1,
        attemptId: 'att1',
        studentId: 'stu1',
        studentName: 'Student One',
        studentEmail: 'one@example.com',
        correct: 1,
        incorrect: 1,
        skipped: 0,
        answered: 2,
        totalQuestions: 2,
        accuracy: 50,
        scorePercentage: 50,
        score: 1,
        marksObtained: 4,
        totalMarks: 8,
        percentile: 50,
        timeSpentMinutes: 10,
        tabSwitchCount: 2,
        status: 'completed',
        startedAt: new Date('2026-09-01T10:00:00Z'),
        completedAt: new Date('2026-09-01T10:10:00Z'),
        sectionBreakdown: 'Section A (C:1, W:1, S:0, Acc:50%)',
        participantType: 'Registered',
        phone: '',
        phoneVerified: '',
        emailVerified: '',
        marketingConsent: '',
      },
    ],
    guests: [
      {
        rank: null,
        attemptId: 'gatt1',
        studentId: 'guest1',
        studentName: 'Rahul Sharma',
        studentEmail: 'rahul.sharma@example.com',
        correct: 2,
        incorrect: 0,
        skipped: 0,
        answered: 2,
        totalQuestions: 2,
        accuracy: 100,
        scorePercentage: 100,
        score: 2,
        marksObtained: 8,
        totalMarks: 8,
        percentile: null,
        timeSpentMinutes: 5,
        tabSwitchCount: 0,
        status: 'completed',
        startedAt: new Date('2026-09-02T09:00:00Z'),
        completedAt: new Date('2026-09-02T09:05:00Z'),
        sectionBreakdown: '',
        participantType: 'Guest',
        phone: '+919876543210',
        phoneVerified: 'No',
        emailVerified: 'Yes',
        marketingConsent: 'Yes',
      },
    ],
    questions: [
      {
        questionNumber: 1,
        subjectName: 'Pathology',
        topicName: 'Genetics',
        questionText: 'Which organelle is the powerhouse of the cell?',
        optionA: 'Nucleus',
        optionB: 'Mitochondria',
        optionC: 'Ribosome',
        optionD: 'Golgi',
        correctOptionLabel: 'B',
        correctOptionText: 'Mitochondria',
        correctCount: 2,
        wrongCount: 0,
        skippedCount: 1,
        percentCorrect: 66.67,
        percentWrong: 0,
        percentSkipped: 33.33,
      },
    ],
    includeLeadColumns: true,
    generatedAt: new Date('2026-09-11T12:00:00Z'),
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

// First data row (headerRow + 1) whose Student Name column matches.
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

// ExcelJS normalizes colors to either { argb } or the bare ARGB string
// depending on the assignment path — the serialized file is identical.
const argbOf = (color) => (typeof color === 'string' ? color : color && color.argb);

describe('buildTestReportWorkbook', () => {
  it('creates exactly two professionally named worksheets', () => {
    const workbook = buildTestReportWorkbook(buildData());

    expect(workbook.worksheets).toHaveLength(2);
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual([
      STUDENT_SHEET_NAME,
      QUESTION_SHEET_NAME,
    ]);
    expect(STUDENT_SHEET_NAME).toBe('Student Performance');
    expect(QUESTION_SHEET_NAME).toBe('Question-wise Analytics');
  });

  it('styles, freezes and filters the student table header', () => {
    const workbook = buildTestReportWorkbook(buildData());
    const sheet = workbook.getWorksheet(STUDENT_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Rank');

    const headerCell = sheet.getCell(headerRow, 1);
    expect(argbOf(headerCell.style.fill.fgColor).toUpperCase()).toBe('FF01B4AE');
    expect(argbOf(headerCell.style.font.color).toUpperCase()).toBe('FFFFFFFF');
    expect(headerCell.style.font.bold).toBe(true);

    const view = sheet.views[0];
    expect(view.state).toBe('frozen');
    // ySplit = number of frozen rows; it must include the header row itself
    // so the header stays pinned while data scrolls.
    expect(view.ySplit).toBe(headerRow);

    expect(sheet.autoFilter).toBeDefined();
  });

  it('writes student rows with typed values, then unranked guest rows', () => {
    const workbook = buildTestReportWorkbook(buildData());
    const sheet = workbook.getWorksheet(STUDENT_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Rank');

    const studentRow = rowOf(sheet, headerRow, 'Student One');
    expect(cellValue(sheet, headerRow, studentRow, 'Rank')).toBe(1);
    expect(cellValue(sheet, headerRow, studentRow, 'Email')).toBe('one@example.com');
    expect(cellValue(sheet, headerRow, studentRow, 'Score (%)')).toBe(50);
    expect(cellValue(sheet, headerRow, studentRow, 'Marks Obtained')).toBe(4);
    expect(cellValue(sheet, headerRow, studentRow, 'Participant Type')).toBe('Registered');

    const guestRow = rowOf(sheet, headerRow, 'Rahul Sharma');
    expect(guestRow).toBeGreaterThan(studentRow);
    expect(cellValue(sheet, headerRow, guestRow, 'Rank')).toBeNull();
    expect(cellValue(sheet, headerRow, guestRow, 'Participant Type')).toBe('Guest');
    expect(cellValue(sheet, headerRow, guestRow, 'Phone')).toBe('+919876543210');
  });

  it('formats percentage and date columns', () => {
    const workbook = buildTestReportWorkbook(buildData());
    const sheet = workbook.getWorksheet(STUDENT_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Rank');
    const studentRow = rowOf(sheet, headerRow, 'Student One');

    const scorePctCol = headersOf(sheet, headerRow).indexOf('Score (%)') + 1;
    expect(sheet.getCell(studentRow, scorePctCol).numFmt).toBe('0.0"%"');

    const startedCol = headersOf(sheet, headerRow).indexOf('Started At') + 1;
    expect(sheet.getCell(studentRow, startedCol).value).toBeInstanceOf(Date);
    expect(sheet.getCell(studentRow, startedCol).numFmt).toBe('yyyy-mm-dd hh:mm');
  });

  it('omits lead columns and guest rows for mentor exports', () => {
    const workbook = buildTestReportWorkbook(buildData({ includeLeadColumns: false }));
    const sheet = workbook.getWorksheet(STUDENT_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Rank');
    const headers = headersOf(sheet, headerRow);

    expect(headers).not.toContain('Participant Type');
    expect(headers).not.toContain('Phone');
    // Guest participants are admin-only lead data — never in mentor exports,
    // even if rows leak into the payload.
    expect(() => rowOf(sheet, headerRow, 'Rahul Sharma')).toThrow(/not found/);
  });

  it('renders a blank Completion cell for public tests with no assignments', () => {
    // Public quiz: nobody assigned, guests attempted — completion is null
    // (rendered empty), while the guest-inclusive totals stay real numbers.
    const data = buildData({
      overview: {
        totalAssigned: 0,
        totalAttempted: 21,
        completionRate: null,
        avgScore: 175.24,
        highestScore: 310,
        lowestScore: 40,
      },
    });
    const workbook = buildTestReportWorkbook(data);
    const sheet = workbook.getWorksheet(STUDENT_SHEET_NAME);

    // Locate the KPI band (labels sit in a gap-ridden merged row), then the
    // value row directly beneath it.
    let kpiLabelRow = 0;
    for (let row = 1; row <= 12; row += 1) {
      if (sheet.getCell(row, 1).value === 'TOTAL ASSIGNED') {
        kpiLabelRow = row;
        break;
      }
    }
    expect(kpiLabelRow).toBeGreaterThan(0);
    const kpiValueRow = kpiLabelRow + 1;

    const kpiColOf = (label) => {
      for (let col = 1; col <= 40; col += 1) {
        if (sheet.getCell(kpiLabelRow, col).value === label) return col;
      }
      throw new Error(`KPI "${label}" not found`);
    };

    expect(sheet.getCell(kpiValueRow, kpiColOf('COMPLETION')).value).toBeNull();
    expect(sheet.getCell(kpiValueRow, kpiColOf('TOTAL ATTEMPTED')).value).toBe(21);

    return expect(workbook.xlsx.writeBuffer()).resolves.toBeDefined();
  });

  it('handles zero-attempt tests gracefully', () => {
    const workbook = buildTestReportWorkbook(
      buildData({ students: [], guests: [] })
    );
    const sheet = workbook.getWorksheet(STUDENT_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Rank');

    // Header still exists, and an explicit empty-state note replaces data rows.
    const noteCell = sheet.getCell(headerRow + 1, 1);
    expect(String(noteCell.value)).toBe('No student has attempted this test yet.');

    // The workbook still serializes cleanly.
    return expect(workbook.xlsx.writeBuffer()).resolves.toBeDefined();
  });

  it('styles, freezes and filters the question sheet with wrapped question text', () => {
    const workbook = buildTestReportWorkbook(buildData());
    const sheet = workbook.getWorksheet(QUESTION_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Q No');

    const headers = headersOf(sheet, headerRow);
    expect(headers).toContain('Question Text');
    expect(headers).toContain('Correct Option');
    expect(headers).toContain('Correct (%)');

    const questionCol = headers.indexOf('Question Text') + 1;
    const questionCell = sheet.getCell(headerRow + 1, questionCol);
    expect(questionCell.value).toBe('Which organelle is the powerhouse of the cell?');
    expect(questionCell.style.alignment.wrapText).toBe(true);

    const view = sheet.views[0];
    expect(view.state).toBe('frozen');
    expect(view.ySplit).toBe(headerRow);
    expect(sheet.autoFilter).toBeDefined();

    const headerCell = sheet.getCell(headerRow, 1);
    expect(argbOf(headerCell.style.fill.fgColor).toUpperCase()).toBe('FF01B4AE');
  });

  it('keeps question analytics counts numeric', () => {
    const workbook = buildTestReportWorkbook(buildData());
    const sheet = workbook.getWorksheet(QUESTION_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Q No');
    const headers = headersOf(sheet, headerRow);

    const row = headerRow + 1;
    const correctCol = headers.indexOf('Correct') + 1;
    const pctCol = headers.indexOf('Correct (%)') + 1;
    expect(sheet.getCell(row, correctCol).value).toBe(2);
    expect(sheet.getCell(row, pctCol).value).toBe(66.67);
    expect(sheet.getCell(row, pctCol).numFmt).toBe('0.0"%"');
  });

  it('preserves styling, freeze panes and filters through serialization', async () => {
    // What Excel sees is the serialized file, not the in-memory workbook —
    // guard against ExcelJS silently dropping any of it on write.
    const workbook = buildTestReportWorkbook(buildData());
    const buffer = await workbook.xlsx.writeBuffer();
    const reloaded = await new Excel.Workbook().xlsx.load(buffer);

    const sheet = reloaded.getWorksheet(STUDENT_SHEET_NAME);
    const headerRow = headerRowOf(sheet, 'Rank');

    expect(argbOf(sheet.getCell(headerRow, 1).fill.fgColor).toUpperCase()).toBe('FF01B4AE');
    expect(sheet.views[0].state).toBe('frozen');
    expect(sheet.views[0].ySplit).toBe(headerRow);
    expect(sheet.autoFilter).toBeDefined();

    const studentRow = rowOf(sheet, headerRow, 'Student One');
    const scorePctCol = headersOf(sheet, headerRow).indexOf('Score (%)') + 1;
    expect(sheet.getCell(studentRow, scorePctCol).numFmt).toBe('0.0"%"');
  });
});
