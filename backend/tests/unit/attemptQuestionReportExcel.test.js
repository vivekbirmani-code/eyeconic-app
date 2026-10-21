const Excel = require('exceljs');
const {
  buildAttemptQuestionReportWorkbook,
  SHEET_NAME,
} = require('../../utils/attemptQuestionReportExcel');

// Mirrors the payload returned by collectAttemptQuestionReport().
function buildReport(questions) {
  return {
    generatedAt: new Date('2026-10-20T08:00:00Z'),
    student: { name: 'Student One', email: 'one@example.com' },
    participantType: 'registered',
    quiz: { title: 'Unit Quiz', testType: 'daily', subjectNames: ['Pathology'] },
    marking: { positiveMarks: 4, negativeMarks: 1 },
    attempt: {
      _id: 'att1',
      status: 'completed',
      score: 1,
      marksObtained: 3,
      totalMarks: 8,
      scorePercentage: 37.5,
      accuracy: 50,
      correct: 1,
      incorrect: 1,
      skipped: 0,
      attempted: 2,
      totalQuestions: 2,
      timeTakenSeconds: 120,
      tabSwitchCount: 0,
      endTime: new Date('2026-10-20T07:58:00Z'),
    },
    questions,
    missingQuestionCount: 0,
  };
}

const HEADER_ROW = 18;

const headerNames = (sheet) => {
  const headers = [];
  for (let col = 1; col <= 20; col += 1) {
    const value = sheet.getCell(HEADER_ROW, col).value;
    if (value === null || value === undefined || value === '') break;
    headers.push(String(value));
  }
  return headers;
};

const colOf = (sheet, header) => headerNames(sheet).indexOf(header) + 1;

describe('buildAttemptQuestionReportWorkbook — student responses are preserved as text cells', () => {
  // Representation classes the export must carry verbatim (leading zeros,
  // date-like, percent-like, trailing zeros, scientific notation, negatives,
  // formula-like injection attempts, unicode, separators/newlines).
  const TRICKY = [
    '00123',
    '12/10/2026',
    '25%',
    '0.2500',
    '1E10',
    '-05',
    '=1+1',
    '@cmd|/c calc!A0',
    'a,b"c\nd',
    'हिन्दी ✓',
  ];

  const rows = TRICKY.map((value, i) => ({
    questionNumber: i + 1,
    section: '',
    subjectName: 'Pathology',
    topicName: 'Genetics',
    questionType: 'numerical',
    questionTypeLabel: 'Numerical',
    question: `Tricky Q${i + 1}`,
    questionUnavailable: false,
    // label === text (the numerical formatter's shape)
    studentResponseLabel: value,
    studentResponseText: value,
    correctAnswerLabel: '42',
    correctAnswerText: '42',
    result: i === 0 ? 'correct' : 'incorrect',
    resultLabel: i === 0 ? 'Correct' : 'Incorrect',
    marks: i === 0 ? 4 : -1,
    timeSpent: 15,
  }));

  const reloadSheet = async (questions) => {
    const workbook = buildAttemptQuestionReportWorkbook(buildReport(questions));
    const buffer = await workbook.xlsx.writeBuffer();
    const reloaded = await new Excel.Workbook().xlsx.load(buffer);
    return reloaded.getWorksheet(SHEET_NAME);
  };

  it('writes every response representation as an exact string cell with the Text format', async () => {
    const sheet = await reloadSheet(rows);
    const col = colOf(sheet, 'Student Response');

    TRICKY.forEach((expected, i) => {
      const cell = sheet.getCell(HEADER_ROW + 1 + i, col);
      expect(cell.type).toBe(Excel.ValueType.String);
      expect(cell.value).toBe(expected);
      expect(cell.numFmt).toBe('@');
    });
  });

  it('renders the label — text join ("B — Mitochondria") as text too', async () => {
    const sheet = await reloadSheet([{
      ...rows[0],
      studentResponseLabel: 'B',
      studentResponseText: 'Mitochondria',
    }]);
    const cell = sheet.getCell(HEADER_ROW + 1, colOf(sheet, 'Student Response'));
    expect(cell.type).toBe(Excel.ValueType.String);
    expect(cell.value).toBe('B — Mitochondria');
    expect(cell.numFmt).toBe('@');
  });

  it('coerces a non-string response that leaks through upstream data into a text cell', async () => {
    const sheet = await reloadSheet([{
      ...rows[0],
      // Legacy documents could carry raw numeric option values through the
      // formatter contract — the workbook layer must still emit text.
      studentResponseLabel: 206,
      studentResponseText: 0.25,
    }]);
    const cell = sheet.getCell(HEADER_ROW + 1, colOf(sheet, 'Student Response'));
    expect(cell.type).toBe(Excel.ValueType.String);
    expect(cell.value).toBe('206 — 0.25');
  });

  it('keeps Q No, Marks and Time (s) numeric with their formats', async () => {
    const sheet = await reloadSheet(rows);
    const qNo = sheet.getCell(HEADER_ROW + 1, colOf(sheet, 'Q No'));
    const marks = sheet.getCell(HEADER_ROW + 1, colOf(sheet, 'Marks'));
    const marksNeg = sheet.getCell(HEADER_ROW + 2, colOf(sheet, 'Marks'));
    const time = sheet.getCell(HEADER_ROW + 1, colOf(sheet, 'Time (s)'));

    expect(qNo.type).toBe(Excel.ValueType.Number);
    expect(qNo.value).toBe(1);
    expect(marks.type).toBe(Excel.ValueType.Number);
    expect(marks.value).toBe(4);
    expect(marks.numFmt).toBe('+0;-0;0');
    expect(marksNeg.value).toBe(-1);
    expect(time.type).toBe(Excel.ValueType.Number);
    expect(time.value).toBe(15);
  });

  it('never emits a formula cell', async () => {
    const sheet = await reloadSheet(rows);
    const headers = headerNames(sheet);
    for (let row = HEADER_ROW + 1; row <= HEADER_ROW + rows.length; row += 1) {
      for (let col = 1; col <= headers.length; col += 1) {
        expect(sheet.getCell(row, col).type).not.toBe(Excel.ValueType.Formula);
      }
    }
  });
});
