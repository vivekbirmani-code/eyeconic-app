const Excel = require('exceljs');
const {
  buildTestReportWorkbook,
  STUDENT_SHEET_NAME,
  QUESTION_SHEET_NAME,
  RESPONSES_SHEET_NAME,
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
    // Mirrors the userResponses block collectUserResponses() attaches for
    // the Excel route. One registered attempt (mixed verdicts) + one guest
    // attempt (all correct) — the same attempts as the sheets above.
    userResponses: {
      attempts: [
        {
          attemptId: 'att1',
          participantType: 'Registered',
          studentName: 'Student One',
          studentEmail: 'one@example.com',
          studentPhone: '+919800000001',
          rank: 1,
          attemptNumber: 1,
          score: 1,
          marksObtained: 4,
          totalMarks: 8,
          scorePercentage: 50,
          correct: 1,
          incorrect: 1,
          skipped: 0,
          submittedAt: new Date('2026-09-01T10:10:00Z'),
          status: 'completed',
          rows: [
            {
              questionNumber: 1,
              section: 'Pathology',
              subjectName: 'Pathology',
              topicName: 'Genetics',
              questionType: 'mcq_single',
              questionTypeLabel: 'MCQ — Single Correct',
              question: 'Which organelle is the powerhouse of the cell?',
              questionUnavailable: false,
              studentResponseLabel: 'B',
              studentResponseText: 'Mitochondria',
              correctAnswerLabel: 'B',
              correctAnswerText: 'Mitochondria',
              result: 'correct',
              resultLabel: 'Correct',
              marks: 4,
              timeSpent: 30,
            },
            {
              questionNumber: 2,
              section: 'Pathology',
              subjectName: 'Pathology',
              topicName: 'Genetics',
              questionType: 'numerical',
              questionTypeLabel: 'Numerical',
              question: 'How many chambers does the heart have?',
              questionUnavailable: false,
              studentResponseLabel: '5',
              studentResponseText: '5',
              correctAnswerLabel: '4',
              correctAnswerText: '4',
              result: 'incorrect',
              resultLabel: 'Incorrect',
              marks: -1,
              timeSpent: 20,
            },
          ],
          missingQuestionCount: 0,
        },
        {
          attemptId: 'gatt1',
          participantType: 'Guest',
          studentName: 'Rahul Sharma',
          studentEmail: 'rahul.sharma@example.com',
          studentPhone: '+919876543210',
          rank: null,
          attemptNumber: 1,
          score: 2,
          marksObtained: 8,
          totalMarks: 8,
          scorePercentage: 100,
          correct: 2,
          incorrect: 0,
          skipped: 0,
          submittedAt: new Date('2026-09-02T09:05:00Z'),
          status: 'completed',
          rows: [
            {
              questionNumber: 1,
              section: 'Pathology',
              subjectName: 'Pathology',
              topicName: 'Genetics',
              questionType: 'mcq_single',
              questionTypeLabel: 'MCQ — Single Correct',
              question: 'Which organelle is the powerhouse of the cell?',
              questionUnavailable: false,
              studentResponseLabel: 'B',
              studentResponseText: 'Mitochondria',
              correctAnswerLabel: 'B',
              correctAnswerText: 'Mitochondria',
              result: 'correct',
              resultLabel: 'Correct',
              marks: 4,
              timeSpent: 25,
            },
            {
              questionNumber: 2,
              section: 'Pathology',
              subjectName: 'Pathology',
              topicName: 'Genetics',
              questionType: 'numerical',
              questionTypeLabel: 'Numerical',
              question: 'How many chambers does the heart have?',
              questionUnavailable: false,
              studentResponseLabel: '',
              studentResponseText: 'Not answered',
              correctAnswerLabel: '4',
              correctAnswerText: '4',
              result: 'skipped',
              resultLabel: 'Skipped',
              marks: 0,
              timeSpent: 0,
            },
          ],
          missingQuestionCount: 0,
        },
      ],
      attemptCount: 2,
      participantCount: 2,
      responseRowCount: 4,
      missingQuestionCount: 0,
      marking: { positiveMarks: 4, negativeMarks: 1 },
    },
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
  it('creates exactly three professionally named worksheets in order', () => {
    const workbook = buildTestReportWorkbook(buildData());

    expect(workbook.worksheets).toHaveLength(3);
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual([
      STUDENT_SHEET_NAME,
      QUESTION_SHEET_NAME,
      RESPONSES_SHEET_NAME,
    ]);
    expect(STUDENT_SHEET_NAME).toBe('Student Performance');
    expect(QUESTION_SHEET_NAME).toBe('Question-wise Analytics');
    expect(RESPONSES_SHEET_NAME).toBe('User Responses');
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

  describe('User Responses sheet', () => {
    const responsesSheetOf = (workbook) => workbook.getWorksheet(RESPONSES_SHEET_NAME);
    const responsesHeaderRowOf = (sheet) => headerRowOf(sheet, 'Student Name');

    // Data row lookup by Student Name (+ attempt number for retakes — the
    // sheet keeps one row per attempt).
    const responseRowOf = (sheet, headerRow, name, attemptNumber = 1) => {
      const headers = headersOf(sheet, headerRow);
      const nameCol = headers.indexOf('Student Name') + 1;
      const attemptCol = headers.indexOf('Attempt No') + 1;
      for (let row = headerRow + 1; row <= headerRow + 500; row += 1) {
        if (sheet.getCell(row, nameCol).value === name
          && sheet.getCell(row, attemptCol).value === attemptNumber) {
          return row;
        }
      }
      throw new Error(`Response row for "${name}" (attempt ${attemptNumber}) not found`);
    };

    // Number of data rows (non-empty Student Name cells below the header).
    const dataRowCount = (sheet, headerRow) => {
      const nameCol = 1;
      let count = 0;
      for (let row = headerRow + 1; row <= headerRow + 500; row += 1) {
        const value = sheet.getCell(row, nameCol).value;
        if (value === null || value === undefined || value === '') break;
        count += 1;
      }
      return count;
    };

    // Compact fixture builders for layout-level tests (slot alignment,
    // extras, unavailable attempts).
    const questionRow = (number, response, result, extra = {}) => ({
      questionNumber: number,
      section: '',
      subjectName: 'Pathology',
      topicName: '',
      questionType: 'mcq_single',
      questionTypeLabel: 'MCQ — Single Correct',
      question: `Fixture Q${number}`,
      questionUnavailable: false,
      studentResponseLabel: response,
      studentResponseText: response,
      correctAnswerLabel: 'A',
      correctAnswerText: 'Alpha',
      result,
      resultLabel: { correct: 'Correct', incorrect: 'Incorrect', skipped: 'Skipped' }[result],
      marks: 0,
      timeSpent: 0,
      ...extra,
    });

    const attemptBlock = (attemptId, name, rows, extra = {}) => ({
      attemptId,
      participantType: 'Registered',
      studentName: name,
      studentEmail: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      studentPhone: '',
      rank: 1,
      attemptNumber: 1,
      score: 1,
      marksObtained: 4,
      totalMarks: 12,
      scorePercentage: 33.33,
      correct: 1,
      incorrect: 1,
      skipped: 0,
      submittedAt: new Date('2026-09-01T10:10:00Z'),
      status: 'completed',
      rows,
      missingQuestionCount: 0,
      ...extra,
    });

    const responsesPayload = (attempts) => ({
      attempts,
      attemptCount: attempts.length,
      participantCount: attempts.length,
      responseRowCount: attempts.reduce((n, a) => n + (a.rows?.length || 0), 0),
      missingQuestionCount: 0,
      marking: { positiveMarks: 4, negativeMarks: 1 },
    });

    it('styles, freezes identity columns and filters the response table', () => {
      const workbook = buildTestReportWorkbook(buildData());
      const sheet = responsesSheetOf(workbook);
      const headerRow = responsesHeaderRowOf(sheet);

      const headers = headersOf(sheet, headerRow);
      // Column contract: identity block once, then a Response/Status pair per
      // question slot.
      ['Student Name', 'Email', 'Phone', 'Participant Type', 'Rank',
        'Attempt No', 'Attempt ID', 'Score (%)', 'Marks Obtained', 'Total Marks',
        'Correct', 'Wrong', 'Skipped', 'Submitted At',
        'Q1 Response', 'Q1 Status', 'Q2 Response', 'Q2 Status'].forEach((header) => {
        expect(headers).toContain(header);
      });

      const headerCell = sheet.getCell(headerRow, 1);
      expect(argbOf(headerCell.style.fill.fgColor).toUpperCase()).toBe('FF01B4AE');
      expect(argbOf(headerCell.style.font.color).toUpperCase()).toBe('FFFFFFFF');
      expect(headerCell.style.font.bold).toBe(true);

      const view = sheet.views[0];
      expect(view.state).toBe('frozen');
      // Both the question-text band and the header row stay pinned.
      expect(view.ySplit).toBe(headerRow);
      // The identity block (through Attempt ID) is frozen left of the split.
      const identityCols = headers.indexOf('Attempt ID') + 1;
      expect(view.xSplit).toBe(identityCols);

      expect(sheet.autoFilter).toBeDefined();
    });

    it('labels each question pair with a merged question-text band above the header', () => {
      const workbook = buildTestReportWorkbook(buildData());
      const sheet = responsesSheetOf(workbook);
      const headerRow = responsesHeaderRowOf(sheet);
      const headers = headersOf(sheet, headerRow);

      // The band rides one row above the filter header, merged across each
      // question's column pair (value lives in the pair's first cell).
      const bandRow = headerRow - 1;
      const q1Col = headers.indexOf('Q1 Response') + 1;
      const q2Col = headers.indexOf('Q2 Response') + 1;
      expect(String(sheet.getCell(bandRow, q1Col).value))
        .toBe('MCQ — Single Correct · Which organelle is the powerhouse of the cell?');
      expect(String(sheet.getCell(bandRow, q2Col).value))
        .toBe('Numerical · How many chambers does the heart have?');
      // Deleted-question honesty rides in the band too — once NO attempt can
      // resolve the doc (the band prefers a live question whenever any can).
      const deletedData = buildData();
      deletedData.userResponses.attempts.forEach((attempt) => {
        attempt.rows[1] = {
          ...attempt.rows[1],
          questionUnavailable: true,
          question: null,
        };
      });
      const deletedSheet = responsesSheetOf(buildTestReportWorkbook(deletedData));
      const deletedHeaderRow = responsesHeaderRowOf(deletedSheet);
      const deletedHeaders = headersOf(deletedSheet, deletedHeaderRow);
      const q2BandCol = deletedHeaders.indexOf('Q2 Response') + 1;
      expect(String(deletedSheet.getCell(deletedHeaderRow - 1, q2BandCol).value))
        .toBe('Question no longer available (removed from question bank)');
    });

    it('writes one row per attempt with responses mapped to question columns', () => {
      const workbook = buildTestReportWorkbook(buildData());
      const sheet = responsesSheetOf(workbook);
      const headerRow = responsesHeaderRowOf(sheet);
      const headers = headersOf(sheet, headerRow);

      // One data row per participant — not per response.
      expect(dataRowCount(sheet, headerRow)).toBe(2);

      const studentRow = responseRowOf(sheet, headerRow, 'Student One');
      // Correct MCQ: option letter AND text in one cell.
      expect(cellValue(sheet, headerRow, studentRow, 'Q1 Response')).toBe('B — Mitochondria');
      expect(cellValue(sheet, headerRow, studentRow, 'Q1 Status')).toBe('Correct');
      // Incorrect numerical answer stays the exact string.
      expect(cellValue(sheet, headerRow, studentRow, 'Q2 Response')).toBe('5');
      expect(cellValue(sheet, headerRow, studentRow, 'Q2 Status')).toBe('Incorrect');

      // Guest attempt: answered Q1, skipped Q2 (explicit "Not answered").
      const guestRow = responseRowOf(sheet, headerRow, 'Rahul Sharma');
      expect(cellValue(sheet, headerRow, guestRow, 'Q1 Response')).toBe('B — Mitochondria');
      expect(cellValue(sheet, headerRow, guestRow, 'Q1 Status')).toBe('Correct');
      expect(cellValue(sheet, headerRow, guestRow, 'Q2 Response')).toBe('Not answered');
      expect(cellValue(sheet, headerRow, guestRow, 'Q2 Status')).toBe('Skipped');

      // Identity/totals match the attempt block — including the guest's
      // phone as TEXT (never a number).
      expect(cellValue(sheet, headerRow, guestRow, 'Phone')).toBe('+919876543210');
      expect(cellValue(sheet, headerRow, guestRow, 'Participant Type')).toBe('Guest');
      expect(cellValue(sheet, headerRow, guestRow, 'Marks Obtained')).toBe(8);
      expect(cellValue(sheet, headerRow, guestRow, 'Score (%)')).toBe(100);
      expect(cellValue(sheet, headerRow, guestRow, 'Attempt No')).toBe(1);

      const phoneCol = headers.indexOf('Phone') + 1;
      expect(sheet.getCell(guestRow, phoneCol).type).toBe(Excel.ValueType.String);

      // Response cells are text-typed end to end.
      const responseCol = headers.indexOf('Q1 Response') + 1;
      expect(sheet.getCell(studentRow, responseCol).type).toBe(Excel.ValueType.String);
      expect(sheet.getCell(studentRow, responseCol).numFmt).toBe('@');
    });

    it('colors each question Status cell by verdict', () => {
      const workbook = buildTestReportWorkbook(buildData());
      const sheet = responsesSheetOf(workbook);
      const headerRow = responsesHeaderRowOf(sheet);
      const headers = headersOf(sheet, headerRow);

      const studentRow = responseRowOf(sheet, headerRow, 'Student One');
      const correctCol = headers.indexOf('Q1 Status') + 1;
      expect(argbOf(sheet.getCell(studentRow, correctCol).font.color).toUpperCase()).toBe('FF059669');
      const wrongCol = headers.indexOf('Q2 Status') + 1;
      expect(argbOf(sheet.getCell(studentRow, wrongCol).font.color).toUpperCase()).toBe('FFDC2626');

      const guestRow = responseRowOf(sheet, headerRow, 'Rahul Sharma');
      const skippedCol = headers.indexOf('Q2 Status') + 1;
      expect(argbOf(sheet.getCell(guestRow, skippedCol).font.color).toUpperCase()).toBe('FFD97706');
    });

    it('keeps responses in stable columns when attempts saw different question counts', () => {
      const data = buildData({
        userResponses: responsesPayload([
          attemptBlock('att-full', 'Ann Full', [
            questionRow(1, 'A', 'correct'),
            questionRow(2, 'B', 'incorrect'),
            questionRow(3, 'C', 'correct'),
          ]),
          attemptBlock('att-part', 'Ben Part', [
            questionRow(1, 'A', 'correct'),
            questionRow(2, 'B', 'skipped'),
          ]),
        ]),
      });
      const workbook = buildTestReportWorkbook(data);
      const sheet = responsesSheetOf(workbook);
      const headerRow = responsesHeaderRowOf(sheet);
      const headers = headersOf(sheet, headerRow);

      // The column set is the union of slots across attempts.
      expect(headers).toContain('Q3 Response');
      expect(dataRowCount(sheet, headerRow)).toBe(2);

      // The same question maps to the same column for every student; the
      // shorter attempt leaves Q3 empty instead of shifting responses left.
      const fullRow = responseRowOf(sheet, headerRow, 'Ann Full');
      const partRow = responseRowOf(sheet, headerRow, 'Ben Part');
      expect(cellValue(sheet, headerRow, fullRow, 'Q1 Response')).toBe('A');
      expect(cellValue(sheet, headerRow, partRow, 'Q1 Response')).toBe('A');
      expect(cellValue(sheet, headerRow, fullRow, 'Q3 Response')).toBe('C');
      expect(cellValue(sheet, headerRow, partRow, 'Q2 Response')).toBe('Not answered');
      expect(cellValue(sheet, headerRow, partRow, 'Q2 Status')).toBe('Skipped');
      expect(cellValue(sheet, headerRow, partRow, 'Q3 Response')).toBe('');
      expect(cellValue(sheet, headerRow, partRow, 'Q3 Status')).toBe('');
    });

    it('gives duplicate-numbered legacy rows a dedicated extra column instead of overwriting the slot', () => {
      const data = buildData({
        userResponses: responsesPayload([
          attemptBlock('att-extra', 'Ann Extra', [
            questionRow(1, 'A', 'correct'),
            questionRow(2, 'B', 'incorrect'),
            // Legacy unpaired answer whose number collides with slot 2.
            questionRow(2, 'D', 'incorrect'),
          ]),
        ]),
      });
      const workbook = buildTestReportWorkbook(data);
      const sheet = responsesSheetOf(workbook);
      const headerRow = responsesHeaderRowOf(sheet);
      const headers = headersOf(sheet, headerRow);

      expect(headers).toContain('Q2 (extra) Response');
      const row = responseRowOf(sheet, headerRow, 'Ann Extra');
      // The main slot keeps its own response; the duplicate never overwrites.
      expect(cellValue(sheet, headerRow, row, 'Q2 Response')).toBe('B');
      expect(cellValue(sheet, headerRow, row, 'Q2 Status')).toBe('Incorrect');
      expect(cellValue(sheet, headerRow, row, 'Q2 (extra) Response')).toBe('D');
      expect(cellValue(sheet, headerRow, row, 'Q2 (extra) Status')).toBe('Incorrect');
    });

    it('keeps an honest row and footnote for attempts whose data could not be loaded', () => {
      const data = buildData({
        userResponses: responsesPayload([
          attemptBlock('att-gone', 'Ann Gone', [], { attemptUnavailable: true }),
          attemptBlock('att-live', 'Ben Live', [questionRow(1, 'A', 'correct')]),
        ]),
      });
      const workbook = buildTestReportWorkbook(data);
      const sheet = responsesSheetOf(workbook);
      const headerRow = responsesHeaderRowOf(sheet);

      // The vanished attempt keeps its identity row with empty responses.
      const goneRow = responseRowOf(sheet, headerRow, 'Ann Gone');
      expect(cellValue(sheet, headerRow, goneRow, 'Q1 Response')).toBe('');
      expect(cellValue(sheet, headerRow, goneRow, 'Q1 Status')).toBe('');
      // The healthy attempt is unaffected.
      const liveRow = responseRowOf(sheet, headerRow, 'Ben Live');
      expect(cellValue(sheet, headerRow, liveRow, 'Q1 Response')).toBe('A');

      // Honesty note after the table.
      let noted = false;
      for (let row = headerRow + 1; row <= sheet.rowCount; row += 1) {
        const value = sheet.getCell(row, 1).value;
        if (String(value).includes('attempt data no longer available')) noted = true;
      }
      expect(noted).toBe(true);

      return expect(workbook.xlsx.writeBuffer()).resolves.toBeDefined();
    });

    it('renders every question type faithfully in its response cell', () => {
      const data = buildData({
        userResponses: responsesPayload([
          attemptBlock('att-types', 'Ann Types', [
            // assertion_reason formats through the default branch: option
            // letter + option text, like mcq_single.
            { ...questionRow(1, 'A', 'correct'), questionType: 'assertion_reason', questionTypeLabel: 'Assertion / Reason', studentResponseText: 'Both Assertion and Reason are true, and Reason is the correct explanation of Assertion' },
            // match_the_following: label and text are the same pairs with
            // different separators — the cell carries the text alone rather
            // than a redundant "label — text" duplication.
            {
              ...questionRow(2, 'ignored-label', 'incorrect'),
              questionType: 'match_the_following',
              questionTypeLabel: 'Match the Following',
              studentResponseLabel: 'Item 1 → A, Item 2 → C',
              studentResponseText: 'Item 1 → A; Item 2 → C',
            },
            // multiple_correct: compact letter key + joined option texts.
            {
              ...questionRow(3, 'ignored-label', 'incorrect'),
              questionType: 'multiple_correct',
              questionTypeLabel: 'Multiple Correct',
              studentResponseLabel: 'A, C',
              studentResponseText: 'Alpha; Gamma',
            },
            // Answered with a legitimately empty formatted response: empty
            // cell, distinct from the explicit "Not answered" of a skip.
            { ...questionRow(4, '', 'incorrect'), studentResponseText: '' },
          ]),
        ]),
      });
      const workbook = buildTestReportWorkbook(data);
      const sheet = responsesSheetOf(workbook);
      const headerRow = responsesHeaderRowOf(sheet);
      const row = responseRowOf(sheet, headerRow, 'Ann Types');

      expect(cellValue(sheet, headerRow, row, 'Q1 Response'))
        .toBe('A — Both Assertion and Reason are true, and Reason is the correct explanation of Assertion');
      expect(cellValue(sheet, headerRow, row, 'Q2 Response')).toBe('Item 1 → A; Item 2 → C');
      expect(cellValue(sheet, headerRow, row, 'Q3 Response')).toBe('A, C — Alpha; Gamma');
      expect(cellValue(sheet, headerRow, row, 'Q4 Response')).toBe('');
      expect(cellValue(sheet, headerRow, row, 'Q4 Status')).toBe('Incorrect');
    });

    it('omits lead columns and guest rows for mentor exports', () => {
      const workbook = buildTestReportWorkbook(buildData({ includeLeadColumns: false }));
      const sheet = responsesSheetOf(workbook);
      const headerRow = responsesHeaderRowOf(sheet);
      const headers = headersOf(sheet, headerRow);

      expect(headers).not.toContain('Participant Type');
      expect(headers).not.toContain('Phone');
      expect(() => responseRowOf(sheet, headerRow, 'Rahul Sharma')).toThrow(/not found/);

      // The frozen identity block shrinks with the column set.
      expect(sheet.views[0].xSplit).toBe(headers.indexOf('Attempt ID') + 1);
    });

    it('renders an explicit empty state when no responses exist', () => {
      const workbook = buildTestReportWorkbook(
        buildData({ userResponses: undefined })
      );
      const sheet = responsesSheetOf(workbook);
      const headerRow = responsesHeaderRowOf(sheet);

      const noteCell = sheet.getCell(headerRow + 1, 1);
      expect(String(noteCell.value)).toBe('No responses available for this test yet.');
      expect(sheet.views[0].state).toBe('frozen');

      return expect(workbook.xlsx.writeBuffer()).resolves.toBeDefined();
    });

    it('survives serialization with freeze, filters, wraps and banding intact', async () => {
      const workbook = buildTestReportWorkbook(buildData());
      const buffer = await workbook.xlsx.writeBuffer();
      const reloaded = await new Excel.Workbook().xlsx.load(buffer);

      const sheet = reloaded.getWorksheet(RESPONSES_SHEET_NAME);
      const headerRow = responsesHeaderRowOf(sheet);
      const headers = headersOf(sheet, headerRow);

      expect(argbOf(sheet.getCell(headerRow, 1).fill.fgColor).toUpperCase()).toBe('FF01B4AE');
      expect(sheet.views[0].state).toBe('frozen');
      expect(sheet.views[0].ySplit).toBe(headerRow);
      expect(sheet.views[0].xSplit).toBe(headers.indexOf('Attempt ID') + 1);
      expect(sheet.autoFilter).toBeDefined();

      const studentRow = responseRowOf(sheet, headerRow, 'Student One');
      const responseCol = headers.indexOf('Q1 Response') + 1;
      expect(sheet.getCell(studentRow, responseCol).alignment.wrapText).toBe(true);
      expect(sheet.getCell(studentRow, responseCol).numFmt).toBe('@');
      const statusCol = headers.indexOf('Q1 Status') + 1;
      expect(argbOf(sheet.getCell(studentRow, statusCol).font.color).toUpperCase()).toBe('FF059669');
    });
  });
});

// ---------------------------------------------------------------------------
// Student responses stay TEXT through serialization — Excel must never
// reinterpret them as numbers, dates, percentages or formulas.
// ---------------------------------------------------------------------------
describe('User Responses sheet — student responses are preserved as text cells', () => {
  // Every representation class the export must carry verbatim: leading
  // zeros, date-like, percent-like, trailing zeros, scientific notation,
  // negative-with-leading-zero, formula-like (injection), unicode,
  // separators/newlines, whitespace and a long string.
  const TRICKY = [
    '00123',
    '12/10/2026',
    '25%',
    '0.2500',
    '1E10',
    '-05',
    '=1+1',
    '+55',
    '@SUM(A1:A9)',
    'a,b"c\nd',
    'हिन्दी ✓',
    '  spaced  ',
    'L'.repeat(1200),
  ];

  const dataWithTrickyRow = () => buildData({
    includeLeadColumns: false,
    userResponses: {
      attempts: [
        {
          attemptId: 'att-tricky',
          participantType: 'Registered',
          studentName: 'Student One',
          studentEmail: 'one@example.com',
          studentPhone: '',
          rank: 1,
          attemptNumber: 1,
          score: 1,
          marksObtained: 4,
          totalMarks: 52,
          scorePercentage: 8,
          correct: 1,
          incorrect: TRICKY.length - 1,
          skipped: 0,
          submittedAt: new Date('2026-09-01T10:10:00Z'),
          status: 'completed',
          // One attempt answering every question: the wide layout carries
          // them all in a single row, one Qn Response column each.
          rows: TRICKY.map((value, i) => ({
            questionNumber: i + 1,
            section: '',
            subjectName: 'Pathology',
            topicName: 'Genetics',
            questionType: 'numerical',
            questionTypeLabel: 'Numerical',
            question: `Tricky Q${i + 1}`,
            questionUnavailable: false,
            studentResponseLabel: value,
            studentResponseText: value,
            correctAnswerLabel: '1',
            correctAnswerText: '1',
            result: i === 0 ? 'correct' : 'incorrect',
            resultLabel: i === 0 ? 'Correct' : 'Incorrect',
            marks: i === 0 ? 4 : -1,
            timeSpent: 10,
          })),
          missingQuestionCount: 0,
        },
      ],
      attemptCount: 1,
      participantCount: 1,
      responseRowCount: TRICKY.length,
      missingQuestionCount: 0,
      marking: { positiveMarks: 4, negativeMarks: 1 },
    },
  });

  // Round-trip through the serialized .xlsx (what the user actually opens),
  // not just the in-memory objects.
  // headerRowOf/hdrsOf live at module scope; the responses sheet's header row starts with 'Student Name'.
  const trickyResponsesHeaderRowOf = (sheet) => headerRowOf(sheet, 'Student Name');

  const reloadResponsesSheet = async () => {
    const workbook = buildTestReportWorkbook(dataWithTrickyRow());
    const buffer = await workbook.xlsx.writeBuffer();
    const reloaded = await new Excel.Workbook().xlsx.load(buffer);
    const sheet = reloaded.getWorksheet(RESPONSES_SHEET_NAME);
    const headerRow = trickyResponsesHeaderRowOf(sheet);
    return { sheet, headerRow, headers: headersOf(sheet, headerRow) };
  };

  it('writes every response as an exact string cell with the Text format, one row per student', async () => {
    const { sheet, headerRow, headers } = await reloadResponsesSheet();

    // A single data row carries all TRICKY.length responses.
    TRICKY.forEach((expected, i) => {
      const cell = sheet.getCell(headerRow + 1, headers.indexOf(`Q${i + 1} Response`) + 1);

      expect(cell.type).toBe(Excel.ValueType.String);
      expect(cell.value).toBe(expected);
      // '@' = Excel's Text number format: the cell stays text even if the
      // recipient later edits or re-enters it.
      expect(cell.numFmt).toBe('@');
    });

    // The row below the data row stays empty — nothing wrapped to a second
    // student row.
    expect(sheet.getCell(headerRow + 2, 1).value).toBeNull();
  });

  it('never emits a formula cell on the responses sheet', async () => {
    const { sheet, headerRow, headers } = await reloadResponsesSheet();
    // Band row, header row and the single data row.
    for (let row = headerRow - 1; row <= headerRow + 1; row += 1) {
      for (let col = 1; col <= headers.length; col += 1) {
        expect(sheet.getCell(row, col).type).not.toBe(Excel.ValueType.Formula);
      }
    }
  });

  it('keeps analytics metric cells numeric (Score %, Correct, Wrong)', async () => {
    const { sheet, headerRow, headers } = await reloadResponsesSheet();
    const scoreCell = sheet.getCell(headerRow + 1, headers.indexOf('Score (%)') + 1);
    const correctCell = sheet.getCell(headerRow + 1, headers.indexOf('Correct') + 1);
    const wrongCell = sheet.getCell(headerRow + 1, headers.indexOf('Wrong') + 1);

    expect(scoreCell.type).toBe(Excel.ValueType.Number);
    expect(correctCell.type).toBe(Excel.ValueType.Number);
    expect(correctCell.value).toBe(1);
    expect(wrongCell.type).toBe(Excel.ValueType.Number);
    expect(wrongCell.value).toBe(TRICKY.length - 1);
  });

  it('coerces a non-string response that leaks through upstream data into a text cell', async () => {
    const data = dataWithTrickyRow();
    // Simulate a legacy document where the formatter contract was violated
    // (numeric option / raw numeric answer stored in the bank or attempt).
    data.userResponses.attempts[0].rows[0].studentResponseLabel = 206;
    data.userResponses.attempts[0].rows[0].studentResponseText = 0.25;

    const workbook = buildTestReportWorkbook(data);
    const buffer = await workbook.xlsx.writeBuffer();
    const reloaded = await new Excel.Workbook().xlsx.load(buffer);
    const sheet = reloaded.getWorksheet(RESPONSES_SHEET_NAME);
    const headerRow = trickyResponsesHeaderRowOf(sheet);
    const headers = headersOf(sheet, headerRow);

    const cell = sheet.getCell(headerRow + 1, headers.indexOf('Q1 Response') + 1);
    expect(cell.type).toBe(Excel.ValueType.String);
    expect(cell.value).toBe('0.25');
    expect(cell.numFmt).toBe('@');
  });
});
