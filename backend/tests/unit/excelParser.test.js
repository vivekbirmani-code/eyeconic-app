const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const {
  parseExcel,
  recoverMisplacedTypeFields,
  splitList,
  selectImportWorksheet,
} = require('../../utils/excelParser');
const { QUESTION_TYPES } = require('../../constants/question');
const { buildImportTemplateBuffer } = require('../../utils/excelTemplate');

const FIXTURE_PATH = path.join(__dirname, '../fixtures/Question_Bank_Import_Template.xlsx');

const toBuffer = (rows) => {
  const sheet = xlsx.utils.json_to_sheet(rows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, sheet, 'Questions');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const baseRow = (overrides = {}) => ({
  SUBJECT: 'Pathology',
  TOPIC: 'Genetics',
  SUBTOPIC: 'Mendelian Inheritance',
  SYSTEM: 'Genetic Disorders',
  QUESTION_TYPE: 'mcq_single',
  DIFFICULTY: 'medium',
  QUESTION: 'What is the powerhouse of the cell?',
  OPTION1: 'Nucleus',
  OPTION2: 'Mitochondria',
  OPTION3: 'Ribosome',
  OPTION4: 'Golgi',
  CORRECT: '2',
  ...overrides,
});

describe('parseExcel — valid rows', () => {
  it('parses a valid mcq_single row', async () => {
    const { questions, errors } = await parseExcel(toBuffer([baseRow()]));
    expect(errors).toHaveLength(0);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      subjectName: 'Pathology',
      topicName: 'Genetics',
      subtopicName: 'Mendelian Inheritance',
      system: 'Genetic Disorders',
      questionType: QUESTION_TYPES.MCQ_SINGLE,
      difficulty: 'medium',
      correctAnswer: 1, // OPTION2, 0-indexed
      tags: [],
    });
  });

  it('accepts a human-readable Question Type label and Title Case Difficulty', async () => {
    const { questions, errors } = await parseExcel(toBuffer([
      baseRow({ QUESTION_TYPE: 'MCQ Single Correct', DIFFICULTY: 'Easy' }),
    ]));
    expect(errors).toHaveLength(0);
    expect(questions[0].questionType).toBe(QUESTION_TYPES.MCQ_SINGLE);
    expect(questions[0].difficulty).toBe('easy');
  });

  it('parses multiple comma-separated tags', async () => {
    const { questions, errors } = await parseExcel(toBuffer([baseRow({ TAGS: 'high-yield, PYQ' })]));
    expect(errors).toHaveLength(0);
    expect(questions[0].tags).toEqual(['high-yield', 'PYQ']);
  });

  it('parses a multiple_correct row with comma-separated correct answers', async () => {
    const { questions, errors } = await parseExcel(toBuffer([
      baseRow({ QUESTION_TYPE: 'multiple_correct', CORRECT: 'A,C' }),
    ]));
    expect(errors).toHaveLength(0);
    expect(questions[0].correctAnswer.sort()).toEqual([0, 2]);
  });

  it('parses an assertion_reason row and defaults options when omitted', async () => {
    const { questions, errors } = await parseExcel(toBuffer([
      baseRow({
        QUESTION_TYPE: 'assertion_reason',
        ASSERTION: 'Mitochondria produce ATP.',
        REASON: 'Mitochondria have a double membrane.',
        OPTION1: '', OPTION2: '', OPTION3: '', OPTION4: '',
        CORRECT: '1',
      }),
    ]));
    expect(errors).toHaveLength(0);
    expect(questions[0].assertion).toBe('Mitochondria produce ATP.');
    expect(questions[0].correctAnswer).toBe(0);
  });

  it('parses a match_the_following row with a letter-based mapping', async () => {
    const { questions, errors } = await parseExcel(toBuffer([
      baseRow({
        QUESTION_TYPE: 'match_the_following',
        COLUMN_A: 'Item1;Item2',
        COLUMN_B: 'MatchA;MatchB',
        OPTION1: '', OPTION2: '', OPTION3: '', OPTION4: '',
        CORRECT: '1-B,2-A',
      }),
    ]));
    expect(errors).toHaveLength(0);
    expect(questions[0].correctAnswer).toEqual({ '0': '1', '1': '0' });
  });

  it('parses a numerical row', async () => {
    const { questions, errors } = await parseExcel(toBuffer([
      baseRow({ QUESTION_TYPE: 'numerical', OPTION1: '', OPTION2: '', OPTION3: '', OPTION4: '', CORRECT: '12.5' }),
    ]));
    expect(errors).toHaveLength(0);
    expect(questions[0].correctAnswer).toBe(12.5);
  });
});

describe('parseExcel — row-level errors', () => {
  it('reports a missing required field with a row number', async () => {
    const rowMissingSubtopic = baseRow({ SUBTOPIC: '' });
    const { questions, errors } = await parseExcel(toBuffer([rowMissingSubtopic]));
    expect(questions).toHaveLength(0);
    expect(errors.some((e) => e.startsWith('Row 2:') && /Subtopic/.test(e))).toBe(true);
  });

  it('rejects an invalid Question Type', async () => {
    const { errors } = await parseExcel(toBuffer([baseRow({ QUESTION_TYPE: 'essay' })]));
    expect(errors.some((e) => /Invalid Question Type/.test(e))).toBe(true);
  });

  it('rejects an invalid Difficulty', async () => {
    const { errors } = await parseExcel(toBuffer([baseRow({ DIFFICULTY: 'impossible' })]));
    expect(errors.some((e) => /Difficulty/.test(e))).toBe(true);
  });

  it('rejects an out-of-range CORRECT letter for the given option count', async () => {
    const { errors } = await parseExcel(toBuffer([baseRow({ CORRECT: 'Z' })]));
    expect(errors.some((e) => /Invalid correct answer/.test(e))).toBe(true);
  });

  it('imports valid rows and collects errors for invalid rows in the same batch', async () => {
    const good = baseRow();
    const bad = baseRow({ SYSTEM: '' });
    const { questions, errors } = await parseExcel(toBuffer([good, bad]));
    expect(questions).toHaveLength(1);
    expect(errors.some((e) => e.startsWith('Row 3:'))).toBe(true);
  });

  it('keeps sheet row numbers true across blank rows', async () => {
    // Header row 1, blank row 2, question in row 3, invalid row in row 4:
    // every surfaced row number must match what the admin sees in Excel.
    const sheet = xlsx.utils.aoa_to_sheet([
      ['SUBJECT', 'TOPIC', 'SUBTOPIC', 'SYSTEM', 'QUESTION_TYPE', 'DIFFICULTY', 'QUESTION', 'OPTION1', 'OPTION2', 'CORRECT'],
      [],
      ['Pathology', 'Genetics', 'Mendelian Inheritance', 'Genetic Disorders', 'mcq_single', 'medium', 'Blank row below me?', 'A', 'B', 'A'],
      ['Pathology', 'Genetics', 'Mendelian Inheritance', '', 'mcq_single', 'medium', 'Missing system here?', 'A', 'B', 'A'],
    ]);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, sheet, 'Questions');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const { questions, errors } = await parseExcel(buffer);
    expect(questions).toHaveLength(1);
    expect(questions[0].rowNumber).toBe(3);
    expect(questions[0].question).toBe('Blank row below me?');
    expect(errors.some((e) => e.startsWith('Row 4:') && /System/.test(e))).toBe(true);
  });
});

describe('splitList', () => {
  it('splits semicolon-separated letter-prefixed entries', () => {
    const items = splitList('A. SA node; B. AV node; C. Bundle of His; D. Purkinje fibres');
    expect(items).toHaveLength(4);
    expect(items[0]).toContain('SA node');
    expect(items[3]).toContain('Purkinje');
  });
});

describe('recoverMisplacedTypeFields', () => {
  it('recovers assertion/reason values shifted into O_IMAGE_6 and ASSERTION', () => {
    const rowData = {
      option6Image: 'Assertion text',
      assertion: 'Reason text',
      reason: '',
      correctRaw: '',
      qid: 'A',
      questionType: QUESTION_TYPES.ASSERTION_REASON,
    };
    recoverMisplacedTypeFields(QUESTION_TYPES.ASSERTION_REASON, rowData);
    expect(rowData.assertion).toBe('Assertion text');
    expect(rowData.reason).toBe('Reason text');
    expect(rowData.correctRaw).toBe('A');
    expect(rowData.qid).toBeUndefined();
  });

  it('recovers match-the-following values shifted into ASSERTION and REASON', () => {
    const rowData = {
      assertion: 'A. One; B. Two',
      reason: '1. Alpha; 2. Beta',
      columnA: '',
      columnB: '',
      correctRaw: '',
      qid: '1-A,2-B',
    };
    recoverMisplacedTypeFields(QUESTION_TYPES.MATCH_THE_FOLLOWING, rowData);
    expect(rowData.columnA).toContain('One');
    expect(rowData.columnB).toContain('Alpha');
    expect(rowData.correctRaw).toBe('1-A,2-B');
  });
});

describe('parseExcel — regression fixture (misplaced template columns)', () => {
  it('imports all six question types from the user template workbook', async () => {
    const buffer = fs.readFileSync(FIXTURE_PATH);
    const { questions, errors } = await parseExcel(buffer);

    expect(errors).toHaveLength(0);
    expect(questions).toHaveLength(6);

    const types = questions.map((q) => q.questionType);
    expect(types).toEqual([
      QUESTION_TYPES.MCQ_SINGLE,
      QUESTION_TYPES.MULTIPLE_CORRECT,
      QUESTION_TYPES.ASSERTION_REASON,
      QUESTION_TYPES.NUMERICAL,
      QUESTION_TYPES.MATCH_THE_FOLLOWING,
      QUESTION_TYPES.IMAGE_BASED,
    ]);
  });

  it('parses assertion/reason row with recovered columns', async () => {
    const buffer = fs.readFileSync(FIXTURE_PATH);
    const { questions } = await parseExcel(buffer);
    const ar = questions.find((q) => q.questionType === QUESTION_TYPES.ASSERTION_REASON);

    expect(ar.assertion).toContain('constant velocity');
    expect(ar.reason).toContain('acceleration');
    expect(ar.correctAnswer).toBe(0);
  });

  it('parses match-the-following row with semicolon-separated columns', async () => {
    const buffer = fs.readFileSync(FIXTURE_PATH);
    const { questions } = await parseExcel(buffer);
    const match = questions.find((q) => q.questionType === QUESTION_TYPES.MATCH_THE_FOLLOWING);

    expect(match.columnA).toHaveLength(4);
    expect(match.columnB).toHaveLength(4);
    expect(match.correctAnswer).toEqual({ '0': '0', '1': '1', '2': '2', '3': '3' });
  });

  it('selects the Question Bank sheet when a Format Guide sheet is present', async () => {
    const buffer = fs.readFileSync(FIXTURE_PATH);
    const { sheetName } = await parseExcel(buffer);
    expect(sheetName).toBe('Question Bank');
  });
});

// File-level failures must surface as a structured `fatal` result (mapped to
// a 400 by the routes), never as a thrown error — a throw lands in the route
// catch-all and the admin sees a generic "Server error" (production issue:
// a valid-looking .xlsx whose data sat on the second sheet).
describe('parseExcel — file-level failures (no throws)', () => {
  const emptySheet = (name) => {
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['SUBJECT', 'QUESTION']]), name);
    return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  };

  it('returns fatal (not a throw) when the workbook has no data rows anywhere', async () => {
    const result = await parseExcel(emptySheet('Sheet1'));
    expect(result.questions).toEqual([]);
    expect(result.fatal).toBeTruthy();
    expect(result.fatal.message).toMatch(/no question rows/i);
    expect(result.fatal.hint).toBeTruthy();
  });

  it('returns fatal when the only sheet carries blank rows and nothing else', async () => {
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([
      ['SUBJECT', 'QUESTION'],
      [],
      [],
    ]), 'Sheet1');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const result = await parseExcel(buffer);
    expect(result.fatal).toBeTruthy();
    expect(result.fatal.code).toBe('NO_QUESTION_ROWS');
  });

  it('returns fatal when the file is not a readable Excel workbook', async () => {
    const result = await parseExcel(Buffer.from('definitely not an excel file'));
    // SheetJS may either throw on read (UNREADABLE_WORKBOOK) or yield an
    // empty workbook (NO_QUESTION_ROWS) — both must be a structured fatal,
    // never a thrown error.
    expect(result.fatal).toBeTruthy();
    expect(['UNREADABLE_WORKBOOK', 'NO_WORKSHEETS', 'NO_QUESTION_ROWS']).toContain(result.fatal.code);
  });

  it('returns fatal for a zero-byte file', async () => {
    const result = await parseExcel(Buffer.alloc(0));
    expect(result.fatal).toBeTruthy();
  });

  it('falls back to a later sheet when the first/preferred sheet has no rows', async () => {
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['SUBJECT', 'QUESTION']]), 'Sheet1');
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([baseRow()]), 'Sheet2');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const result = await parseExcel(buffer);
    expect(result.fatal).toBeFalsy();
    expect(result.errors).toHaveLength(0);
    expect(result.questions).toHaveLength(1);
    expect(result.sheetName).toBe('Sheet2');
  });

  it('still prefers a named "Question Bank" sheet over a non-empty first sheet', async () => {
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([baseRow({ QUESTION: 'first sheet q?' })]), 'Notes');
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([baseRow()]), 'Question Bank');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const { sheetName, questions } = await parseExcel(buffer);
    expect(sheetName).toBe('Question Bank');
    expect(questions[0].question).toBe(baseRow().QUESTION);
  });
});

describe('excelTemplate', () => {
  it('generates a valid template that passes parseExcel', async () => {
    const buffer = buildImportTemplateBuffer();
    const workbook = xlsx.read(buffer);
    expect(workbook.SheetNames).toContain('Question Bank');
    expect(workbook.SheetNames).toContain('Format Guide');

    const { questions, errors } = await parseExcel(buffer);
    expect(errors).toHaveLength(0);
    expect(questions.length).toBeGreaterThanOrEqual(6);
  });
});

// Legacy tech-team sheets (e.g. Q_BankTechTeamFinal.xlsx) predate the
// canonical template: QUESTION NO / SUBJECT / TOPIC / TAG / QUESTION /
// Q_IMAGE / OPTION1-4 / CORRECT / SOLUTION. Missing canonical columns get
// deterministic defaults; a canonical sheet with blank cells stays strict.
describe('parseExcel — legacy sheet format (missing canonical columns)', () => {
  const legacyRow = (overrides = {}) => ({
    'QUESTION NO': 38,
    SUBJECT: 'Orthopaedics',
    TOPIC: 'Upper Limb',
    TAG: 'Injuries of Clavicle, Shoulder and Arm',
    QUESTION: 'The radiograph shows a displaced spiral fracture. What is it known as?',
    Q_IMAGE: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/view',
    OPTION1: 'Holdsworth fracture',
    OPTION2: 'Holstein-Lewis fracture',
    OPTION3: 'Jefferson fracture',
    OPTION4: 'Lisfranc fracture',
    CORRECT: '2',
    ...overrides,
  });

  it('defaults type/subtopic/system/difficulty when the columns are absent', async () => {
    const { questions, errors } = await parseExcel(toBuffer([legacyRow()]));
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(1);
    const q = questions[0];
    expect(q.qid).toBe('38'); // QUESTION NO maps to qid
    expect(q.questionType).toBe(QUESTION_TYPES.IMAGE_BASED); // Q_IMAGE present
    expect(q.subtopicName).toBe('Upper Limb'); // <- topic
    expect(q.system).toBe('Upper Limb'); // <- topic
    expect(q.difficulty).toBe('medium');
    expect(q.correctAnswer).toBe(1);
  });

  it('types a row without Q_IMAGE as mcq_single', async () => {
    const { questions, errors } = await parseExcel(toBuffer([legacyRow({
      'QUESTION NO': 39,
      Q_IMAGE: undefined,
    })]));
    expect(errors).toEqual([]);
    expect(questions[0].questionType).toBe(QUESTION_TYPES.MCQ_SINGLE);
  });

  it('still reports genuinely broken rows (no question text)', async () => {
    const { questions, errors } = await parseExcel(toBuffer([legacyRow({ QUESTION: undefined })]));
    expect(questions).toHaveLength(0);
    expect(errors.some((e) => /Question text is required/.test(e))).toBe(true);
  });

  it('keeps strict errors when the canonical columns exist but a cell is blank', async () => {
    // Canonical layout (has SUBTOPIC etc.) with a blank SUBTOPIC cell must
    // NOT silently inherit the topic — only fully-absent columns default.
    const { questions, errors } = await parseExcel(toBuffer([{
      SUBJECT: 'Pathology',
      TOPIC: 'Genetics',
      SUBTOPIC: '',
      SYSTEM: 'Genetic Disorders',
      QUESTION_TYPE: 'mcq_single',
      DIFFICULTY: 'medium',
      QUESTION: 'Valid question?',
      OPTION1: 'a',
      OPTION2: 'b',
      CORRECT: '1',
    }]));
    expect(questions).toHaveLength(0);
    expect(errors.some((e) => /Subtopic is required/.test(e))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION_TYPE alias normalization — every accepted alias must resolve to its
// canonical value. Tests cover:
//   • All new aliases added in this task (mcq_single + assertion_reason)
//   • All pre-existing aliases (regression)
//   • Leading/trailing whitespace handling
//   • Mixed-case inputs
//   • Invalid types still produce a useful error
// ─────────────────────────────────────────────────────────────────────────────
describe('QUESTION_TYPE alias normalization — mcq_single', () => {
  const mcqAliases = [
    // Canonical id
    'mcq_single',
    // Pre-existing aliases
    'mcq',
    'MCQ Single Correct',
    'single correct',
    // New aliases (this task)
    'mcq-single correct',
    'mcq-single_correct',
    'MCQ-Single Correct',
  ];

  mcqAliases.forEach((alias) => {
    it(`resolves "${alias}" → mcq_single`, async () => {
      const { questions, errors } = await parseExcel(toBuffer([baseRow({ QUESTION_TYPE: alias })]));
      expect(errors).toHaveLength(0);
      expect(questions).toHaveLength(1);
      expect(questions[0].questionType).toBe(QUESTION_TYPES.MCQ_SINGLE);
    });
  });

  it('resolves "MCQ — Single Correct" (em-dash label) → mcq_single', async () => {
    // QUESTION_TYPE_LABELS[mcq_single] = 'MCQ — Single Correct' — round-trip must work.
    const { questions, errors } = await parseExcel(toBuffer([baseRow({ QUESTION_TYPE: 'MCQ \u2014 Single Correct' })]));
    expect(errors).toHaveLength(0);
    expect(questions[0].questionType).toBe(QUESTION_TYPES.MCQ_SINGLE);
  });

  it('strips leading/trailing whitespace from QUESTION_TYPE before matching', async () => {
    const { questions, errors } = await parseExcel(toBuffer([baseRow({ QUESTION_TYPE: '  mcq_single  ' })]));
    expect(errors).toHaveLength(0);
    expect(questions[0].questionType).toBe(QUESTION_TYPES.MCQ_SINGLE);
  });
});

describe('QUESTION_TYPE alias normalization — assertion_reason', () => {
  const baseAR = () => baseRow({
    QUESTION_TYPE: 'assertion_reason',
    ASSERTION: 'Mitochondria produce ATP.',
    REASON: 'They have a double membrane.',
    OPTION1: '', OPTION2: '', OPTION3: '', OPTION4: '',
    CORRECT: '1',
  });

  const arAliases = [
    // Canonical id
    'assertion_reason',
    // Pre-existing aliases
    'assertion reason',
    'assertion / reason',
    'assertion-reason',
    // New aliases (this task)
    'Assertion & Reason',
    'Assertions/Reason',
    'Assertion and Reasoning',
  ];

  arAliases.forEach((alias) => {
    it(`resolves "${alias}" → assertion_reason`, async () => {
      const { questions, errors } = await parseExcel(toBuffer([{ ...baseAR(), QUESTION_TYPE: alias }]));
      expect(errors).toHaveLength(0);
      expect(questions).toHaveLength(1);
      expect(questions[0].questionType).toBe(QUESTION_TYPES.ASSERTION_REASON);
    });
  });
});

describe('QUESTION_TYPE alias normalization — other canonical types (regression)', () => {
  const cases = [
    { alias: 'match_the_following', expected: QUESTION_TYPES.MATCH_THE_FOLLOWING },
    { alias: 'Match the Following', expected: QUESTION_TYPES.MATCH_THE_FOLLOWING },
    { alias: 'Matching', expected: QUESTION_TYPES.MATCH_THE_FOLLOWING },
    { alias: 'multiple_correct', expected: QUESTION_TYPES.MULTIPLE_CORRECT },
    { alias: 'Multiple Correct', expected: QUESTION_TYPES.MULTIPLE_CORRECT },
    { alias: 'Multi Correct', expected: QUESTION_TYPES.MULTIPLE_CORRECT },
    { alias: 'numerical', expected: QUESTION_TYPES.NUMERICAL },
    { alias: 'Numeric', expected: QUESTION_TYPES.NUMERICAL },
    { alias: 'image_based', expected: QUESTION_TYPES.IMAGE_BASED },
    { alias: 'Image-Based', expected: QUESTION_TYPES.IMAGE_BASED },
  ];

  // Build a row appropriate for each type so the parser doesn't fail on
  // type-specific required fields before it can check the question type.
  const rowForType = (type) => {
    if (type === QUESTION_TYPES.MATCH_THE_FOLLOWING) {
      return baseRow({
        QUESTION_TYPE: undefined, // will be set per-alias
        COLUMN_A: 'Item1;Item2',
        COLUMN_B: 'MatchA;MatchB',
        OPTION1: '', OPTION2: '', OPTION3: '', OPTION4: '',
        CORRECT: '1-B,2-A',
      });
    }
    if (type === QUESTION_TYPES.MULTIPLE_CORRECT) {
      return baseRow({ QUESTION_TYPE: undefined, CORRECT: 'A,C' });
    }
    if (type === QUESTION_TYPES.NUMERICAL) {
      return baseRow({
        QUESTION_TYPE: undefined,
        OPTION1: '', OPTION2: '', OPTION3: '', OPTION4: '',
        CORRECT: '42',
      });
    }
    if (type === QUESTION_TYPES.IMAGE_BASED) {
      return baseRow({ QUESTION_TYPE: undefined, Q_IMAGE: 'https://picsum.photos/seed/test/320/200' });
    }
    return baseRow({ QUESTION_TYPE: undefined });
  };

  cases.forEach(({ alias, expected }) => {
    it(`resolves "${alias}" → ${expected}`, async () => {
      const row = { ...rowForType(expected), QUESTION_TYPE: alias };
      const { questions, errors } = await parseExcel(toBuffer([row]));
      expect(errors).toHaveLength(0);
      expect(questions[0].questionType).toBe(expected);
    });
  });
});

describe('QUESTION_TYPE alias normalization — invalid values', () => {
  it('rejects an unrecognised QUESTION_TYPE with a row-numbered error', async () => {
    const { questions, errors } = await parseExcel(toBuffer([baseRow({ QUESTION_TYPE: 'essay' })]));
    expect(questions).toHaveLength(0);
    expect(errors.some((e) => e.startsWith('Row 2:') && /Invalid Question Type/.test(e))).toBe(true);
  });

  it('rejects an empty QUESTION_TYPE with a "required" error', async () => {
    const { questions, errors } = await parseExcel(toBuffer([baseRow({ QUESTION_TYPE: '' })]));
    expect(questions).toHaveLength(0);
    expect(errors.some((e) => /Question Type is required/.test(e))).toBe(true);
  });

  it('rejects a whitespace-only QUESTION_TYPE with a "required" error', async () => {
    const { questions, errors } = await parseExcel(toBuffer([baseRow({ QUESTION_TYPE: '   ' })]));
    expect(questions).toHaveLength(0);
    expect(errors.some((e) => /Question Type is required/.test(e))).toBe(true);
  });
});

