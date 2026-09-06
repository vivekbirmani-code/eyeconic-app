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
