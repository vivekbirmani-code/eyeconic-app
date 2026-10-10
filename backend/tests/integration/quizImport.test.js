const request = require('supertest');
const xlsx = require('xlsx');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const QuestionBank = require('../../models/QuestionBank');
const Quiz = require('../../models/Quiz');

let app;
let adminToken;
let studentToken;
let subject;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

beforeEach(async () => {
  await db.clearDatabase();
  const admin = await createUser({ role: 'admin' });
  const student = await createUser({ role: 'student' });
  adminToken = admin.token;
  studentToken = student.token;
  subject = await createSubject('Pathology');
});

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

const toBuffer = (rows, sheetName = 'Question Bank') => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), sheetName);
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const importFile = (token, buffer, fields = {}) =>
  request(app)
    .post('/api/quizzes/import-excel')
    .set('Authorization', `Bearer ${token}`)
    .field('quizTitle', fields.quizTitle || 'Imported Quiz')
    .field('testType', fields.testType || 'daily')
    .field('duration', fields.duration || '30')
    .field('positiveMarks', fields.positiveMarks || '4')
    .field('negativeMarks', fields.negativeMarks || '1')
    .attach('file', buffer, {
      filename: fields.filename || 'import.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

describe('POST /api/quizzes/import-excel — access control', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await importFile(null, toBuffer([baseRow()]));
    expect(res.status).toBe(401);
  });

  it('rejects a non-admin', async () => {
    const res = await importFile(studentToken, toBuffer([baseRow()]));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/quizzes/import-excel — valid imports', () => {
  it('creates the quiz and its questions', async () => {
    const res = await importFile(adminToken, toBuffer([baseRow()]));
    expect(res.status).toBe(201);
    expect(res.body.quiz.title).toBe('Imported Quiz');
    expect(res.body.stats.questionsCreated).toBe(1);

    const quiz = await Quiz.findOne({ title: 'Imported Quiz' });
    expect(quiz).toBeTruthy();
    expect(quiz.questions).toHaveLength(1);

    const question = await QuestionBank.findById(quiz.questions[0]);
    expect(question.question).toBe(baseRow().QUESTION);
    expect(question.correctAnswer).toBe(1);
  });

  it('imports questions found on a later sheet when the first sheet is empty', async () => {
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['SUBJECT', 'QUESTION']]), 'Sheet1');
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([baseRow()]), 'Sheet2');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const res = await importFile(adminToken, buffer);
    expect(res.status).toBe(201);
    expect(res.body.stats.total).toBe(1);
  });

  it('reuses existing questions on re-import instead of duplicating them', async () => {
    const first = await importFile(adminToken, toBuffer([baseRow()]), { quizTitle: 'Quiz One' });
    expect(first.status).toBe(201);

    const before = await QuestionBank.countDocuments({});
    const second = await importFile(adminToken, toBuffer([baseRow()]), { quizTitle: 'Quiz Two' });
    expect(second.status).toBe(201);
    expect(second.body.stats.questionsCreated).toBe(0);
    expect(second.body.stats.duplicatesSkipped).toBe(1);

    const after = await QuestionBank.countDocuments({});
    expect(after).toBe(before);
    expect(await Quiz.countDocuments({})).toBe(2);
  });

  it('updates an existing image-less duplicate when the re-imported row has an image', async () => {
    // Regression: this branch referenced an out-of-scope variable and 500'd.
    // https://picsum.photos returns a real image URL (no placeholder host).
    const first = await importFile(adminToken, toBuffer([baseRow()]), { quizTitle: 'Image Quiz One' });
    expect(first.status).toBe(201);

    const second = await importFile(adminToken, toBuffer([
      baseRow({ QUESTION_TYPE: 'image_based', Q_IMAGE: 'https://picsum.photos/seed/eyeconic/320/200' }),
    ]), { quizTitle: 'Image Quiz Two' });

    expect(second.status).toBe(201);
    expect(second.body.stats.duplicatesUpdated).toBe(1);
    expect(second.body.stats.questionsCreated).toBe(0);
    // One question total — the existing one was updated, not duplicated.
    expect(await QuestionBank.countDocuments({})).toBe(1);
  });

  it('reports every image detected in the file — reused rows count as skipped, not failed', async () => {
    // Already-Cloudinary URLs: no network, and no transfer needed — so the
    // first import reports them uploaded (stored as-is) and the re-import,
    // where every row is a reused duplicate, reports them skipped. This is
    // the Image Upload Summary popup data for the all-duplicates case.
    // Option images count per filled O_IMAGE_n slot.
    const CLOUD = 'https://res.cloudinary.com/demo/image/upload/v1/eyeconic_questions/q.png';
    const rows = [baseRow({
      QUESTION_TYPE: 'image_based',
      Q_IMAGE: CLOUD,
      O_IMAGE_1: CLOUD,
      SOLUTION_IMAGE: CLOUD,
    })];

    const first = await importFile(adminToken, toBuffer(rows), { quizTitle: 'Summary Quiz One' });
    expect(first.status).toBe(201);
    expect(first.body.imageSummary).toEqual({
      total: 3,
      uploaded: 3,
      failed: 0,
      skipped: 0,
      failures: [],
    });

    const second = await importFile(adminToken, toBuffer(rows), { quizTitle: 'Summary Quiz Two' });
    expect(second.status).toBe(201);
    expect(second.body.stats.duplicatesSkipped).toBe(1);
    expect(second.body.imageSummary).toEqual({
      total: 3,
      uploaded: 0,
      failed: 0,
      skipped: 3,
      failures: [],
    });
  });

  it('reports zero images for a text-only sheet — the popup data reconciles to 0', async () => {
    const res = await importFile(adminToken, toBuffer([baseRow()]), { quizTitle: 'Text Only Quiz' });
    expect(res.status).toBe(201);
    expect(res.body.imageSummary).toEqual({
      total: 0,
      uploaded: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    });
  });
});

describe('POST /api/quizzes/import-excel — file-level rejections (must be 400, never 500)', () => {
  it('rejects a workbook with no question rows with an actionable message', async () => {
    const buffer = toBuffer([], 'Sheet1');
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['SUBJECT', 'QUESTION']]), 'Sheet1');
    const headersOnly = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const res = await importFile(adminToken, headersOnly);
    expect(res.status).toBe(400);
    expect(res.body.message).not.toBe('Server error');
    expect(String(res.body.message || '') + String(res.body.errors || '')).toMatch(/no question rows|empty/i);
    // No partial state
    expect(await Quiz.countDocuments({})).toBe(0);
    expect(await QuestionBank.countDocuments({})).toBe(0);
  });

  it('rejects a corrupt file with a clear message and no internals leak', async () => {
    const res = await importFile(adminToken, Buffer.from('this is not an excel workbook at all'));
    expect(res.status).toBe(400);
    expect(res.body.message).not.toBe('Server error');
    expect(JSON.stringify(res.body)).not.toMatch(/Failed to parse|xlsx|Error:/i);
  });

  it('rejects a non-Excel file type', async () => {
    const res = await request(app)
      .post('/api/quizzes/import-excel')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('quizTitle', 'Bad Type Quiz')
      .field('testType', 'daily')
      .field('duration', '30')
      .attach('file', Buffer.from('hello world'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.message).not.toBe('Server error');
  });
});

describe('POST /api/quizzes/import-excel — atomicity', () => {
  it('rejects a duplicate quiz title before creating any questions', async () => {
    await Quiz.create({
      title: 'Imported Quiz',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      createdBy: (await require('../../models/User').findOne({}))?._id,
    });

    const res = await importFile(adminToken, toBuffer([baseRow()]));
    expect(res.status).toBe(400);
    expect(res.body.errorType).toBe('DUPLICATE_TITLE');
    // Fail-fast: no questions may be created for a quiz that never will exist.
    expect(await QuestionBank.countDocuments({})).toBe(0);
  });

  it('rolls back created questions when quiz creation fails mid-import', async () => {
    // Invalid testType passes field handling but fails Quiz schema validation
    // at save time — after questions were already inserted.
    const res = await importFile(adminToken, toBuffer([baseRow()]), { testType: 'bogus-type' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).not.toMatch(/CastError|ValidationError:|polluted/i);
    // Compensation: no orphaned questions left behind.
    expect(await QuestionBank.countDocuments({})).toBe(0);
    expect(await Quiz.countDocuments({})).toBe(0);
  });
});

describe('POST /api/quizzes/import-excel — row-level validation parity', () => {
  it('rejects a placeholder image URL with a row-level error (same rules as the question bank)', async () => {
    const res = await importFile(adminToken, toBuffer([
      baseRow({ QUESTION_TYPE: 'image_based', Q_IMAGE: 'https://example.com/fake.jpg' }),
    ]));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IMPORT_VALIDATION_ERROR');
    expect(String(res.body.errors)).toMatch(/placeholder/i);
    expect(await QuestionBank.countDocuments({})).toBe(0);
  });
});

describe('POST /api/quizzes/import-excel — unified dedup rule (subject + text)', () => {
  it('reuses a same-text question with DIFFERENT options instead of creating a variant', async () => {
    const first = await importFile(adminToken, toBuffer([baseRow()]), { quizTitle: 'Rule Quiz One' });
    expect(first.status).toBe(201);
    expect(first.body.stats.questionsCreated).toBe(1);

    const before = await QuestionBank.countDocuments({});
    const second = await importFile(adminToken, toBuffer([
      baseRow({ OPTION1: 'Different', OPTION2: 'Options', OPTION3: 'Entirely', OPTION4: 'Here' }),
    ]), { quizTitle: 'Rule Quiz Two' });
    expect(second.status).toBe(201);
    expect(second.body.stats.questionsCreated).toBe(0);
    expect(second.body.stats.duplicatesSkipped).toBe(1);
    expect(await QuestionBank.countDocuments({})).toBe(before);
  });

  it('reuses a same-text question of a different questionType', async () => {
    await importFile(adminToken, toBuffer([baseRow()]), { quizTitle: 'Type Quiz One' });

    const second = await importFile(adminToken, toBuffer([
      baseRow({ QUESTION_TYPE: 'Numerical', OPTION1: '', OPTION2: '', OPTION3: '', OPTION4: '', CORRECT: '3.14' }),
    ]), { quizTitle: 'Type Quiz Two' });
    expect(second.status).toBe(201);
    expect(second.body.stats.questionsCreated).toBe(0);
    expect(second.body.stats.duplicatesSkipped).toBe(1);
    expect(await QuestionBank.countDocuments({})).toBe(1);
  });

  it('first occurrence wins for duplicate rows inside one sheet', async () => {
    const res = await importFile(adminToken, toBuffer([
      baseRow({ OPTION1: 'First' }),
      baseRow({ OPTION1: 'Second' }),
    ]), { quizTitle: 'In-File Dup Quiz' });
    expect(res.status).toBe(201);
    expect(res.body.stats.questionsCreated).toBe(1);
    expect(res.body.stats.duplicatesSkipped).toBe(1);

    expect(await QuestionBank.countDocuments({})).toBe(1);
    const quiz = await Quiz.findOne({ title: 'In-File Dup Quiz' });
    expect(quiz.questions).toHaveLength(2);
    // Both quiz slots reference the first occurrence.
    expect(String(quiz.questions[0])).toBe(String(quiz.questions[1]));
    const stored = await QuestionBank.findById(quiz.questions[0]);
    expect(stored.options[0]).toBe('First');
  });

  it('loads existing questions with one batched find and zero findOne calls', async () => {
    await importFile(adminToken, toBuffer([
      baseRow(),
      baseRow({ QUESTION: 'Second unique question?' }),
    ]), { quizTitle: 'Prefetch Quiz One' });

    const findSpy = jest.spyOn(QuestionBank, 'find');
    const findOneSpy = jest.spyOn(QuestionBank, 'findOne');
    try {
      const res = await importFile(adminToken, toBuffer([
        baseRow({ QUESTION: 'A new question?' }),
        baseRow({ QUESTION: 'Another new question?' }),
        baseRow(), // duplicate of the bank
      ]), { quizTitle: 'Prefetch Quiz Two' });
      expect(res.status).toBe(201);
      expect(res.body.stats.questionsCreated).toBe(2);
      expect(res.body.stats.duplicatesSkipped).toBe(1);
      // One prefetch query, no per-row findOne (the old N+1 shape).
      expect(findSpy.mock.calls.length).toBe(1);
      expect(findOneSpy.mock.calls.length).toBe(0);
    } finally {
      findSpy.mockRestore();
      findOneSpy.mockRestore();
    }
  });

  it('two concurrent imports of the same sheet create one question set and share it', async () => {
    // Force the unique partial index to exist before the race — mongoose
    // builds indexes in the background and does not block ops on the build.
    await QuestionBank.init();
    const [a, b] = await Promise.all([
      importFile(adminToken, toBuffer([baseRow()]), { quizTitle: 'Race Quiz A' }),
      importFile(adminToken, toBuffer([baseRow()]), { quizTitle: 'Race Quiz B' }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.stats.questionsCreated + b.body.stats.questionsCreated).toBe(1);
    expect(a.body.stats.duplicatesSkipped + b.body.stats.duplicatesSkipped).toBe(1);
    expect(await QuestionBank.countDocuments({})).toBe(1);

    const quizA = await Quiz.findOne({ title: 'Race Quiz A' });
    const quizB = await Quiz.findOne({ title: 'Race Quiz B' });
    expect(String(quizA.questions[0])).toBe(String(quizB.questions[0]));
  });
});
