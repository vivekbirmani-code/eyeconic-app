const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');

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

const validMcq = (overrides = {}) => ({
  subject: subject._id.toString(),
  topicName: 'Genetics',
  subtopicName: 'Mendelian Inheritance',
  system: 'Genetic Disorders',
  questionType: 'mcq_single',
  difficulty: 'medium',
  question: 'What is the powerhouse of the cell?',
  options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
  correctAnswer: 1,
  ...overrides,
});

describe('POST /api/question-bank — create', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/question-bank').send(validMcq());
    expect(res.status).toBe(401);
  });

  it('rejects a student (admin-only route)', async () => {
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${studentToken}`)
      .send(validMcq());
    expect(res.status).toBe(403);
  });

  it('creates a valid mcq_single question as admin', async () => {
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq());
    expect(res.status).toBe(201);
    expect(res.body.questionType).toBe('mcq_single');
    expect(res.body.difficulty).toBe('medium');
    expect(res.body.tags).toEqual([]);
  });

  it('rejects a payload missing a required metadata field with a 400 and field errors', async () => {
    const payload = validMcq();
    delete payload.subtopicName;
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.some((e) => /Subtopic/.test(e))).toBe(true);
  });

  it('rejects an invalid questionType', async () => {
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validMcq(), questionType: 'essay' });
    expect(res.status).toBe(400);
  });

  it('creates a numerical question with 0 as a valid answer', async () => {
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...validMcq(),
        questionType: 'numerical',
        options: undefined,
        correctAnswer: 0,
      });
    expect(res.status).toBe(201);
    expect(res.body.correctAnswer).toBe(0);
  });

  it('creates a match_the_following question with a valid mapping', async () => {
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...validMcq(),
        questionType: 'match_the_following',
        options: undefined,
        columnA: ['Item 1', 'Item 2'],
        columnB: ['Match A', 'Match B'],
        correctAnswer: { '0': '1', '1': '0' },
      });
    expect(res.status).toBe(201);
    expect(res.body.correctAnswer).toEqual({ '0': '1', '1': '0' });
  });

  it('rejects a placeholder image URL with a 400 naming the field', async () => {
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validMcq(), questionImage: 'https://example.com/dummy-image.png' });
    expect(res.status).toBe(400);
    expect(res.body.errors.some((e) => /Question image/.test(e) && /placeholder/.test(e))).toBe(true);
  });

  it('stores a Cloudinary image URL verbatim on an image_based question', async () => {
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...validMcq(),
        questionType: 'image_based',
        questionImage: 'https://res.cloudinary.com/vivek-bmpromo/image/upload/v1/eyeconic_questions/q.png',
      });
    expect(res.status).toBe(201);
    expect(res.body.questionImage).toBe('https://res.cloudinary.com/vivek-bmpromo/image/upload/v1/eyeconic_questions/q.png');
  });
});

describe('GET /api/question-bank — student answer-key stripping', () => {
  let questionId;

  beforeEach(async () => {
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq());
    questionId = res.body._id;
  });

  it('hides correctAnswer and explanation from students', async () => {
    const res = await request(app)
      .get(`/api/question-bank/${questionId}`)
      .set('Authorization', `Bearer ${studentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.correctAnswer).toBeUndefined();
    expect(res.body.explanation).toBeUndefined();
  });

  it('returns correctAnswer to admin', async () => {
    const res = await request(app)
      .get(`/api/question-bank/${questionId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.correctAnswer).toBe(1);
  });
});

describe('GET /api/question-bank — filters', () => {
  beforeEach(async () => {
    // Distinct question texts — same-subject duplicates are rejected now.
    await request(app).post('/api/question-bank').set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq({ difficulty: 'easy', system: 'Cardiovascular', subtopicName: 'Heart', question: 'Easy heart question?' }));
    await request(app).post('/api/question-bank').set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq({ difficulty: 'hard', system: 'Respiratory', subtopicName: 'Lungs', question: 'Hard lungs question?' }));
  });

  it('filters by difficulty', async () => {
    const res = await request(app)
      .get('/api/question-bank?difficulty=hard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.every((q) => q.difficulty === 'hard')).toBe(true);
    expect(res.body.length).toBe(1);
  });

  it('filters by system (case-insensitive partial match)', async () => {
    const res = await request(app)
      .get('/api/question-bank?system=cardio')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].system).toBe('Cardiovascular');
  });
});

describe('POST /api/question-bank — duplicate guard', () => {
  it('rejects an exact duplicate (same subject + same text) with the duplicate message', async () => {
    const first = await request(app).post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq());
    expect(first.status).toBe(201);

    const res = await request(app).post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq());
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('This question already exists in the question bank.');
    expect(res.body.errorType).toBe('DUPLICATE_QUESTION');
  });

  it('matches case and surrounding whitespace, and different options', async () => {
    await request(app).post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq());

    const res = await request(app).post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq({
        question: '   what IS the POWERHOUSE of the cell?  ',
        options: ['Different', 'Options', 'Entirely', 'Here'],
      }));
    expect(res.status).toBe(409);
  });

  it('allows the same text under a different subject', async () => {
    const other = await createSubject('Physiology');
    await request(app).post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq());

    const res = await request(app).post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq({ subject: other._id.toString() }));
    expect(res.status).toBe(201);
  });

  it('allows different text in the same subject', async () => {
    await request(app).post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq());

    const res = await request(app).post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq({ question: 'What is the control center of the cell?' }));
    expect(res.status).toBe(201);
  });
});

describe('PUT /api/question-bank/:id — duplicate guard', () => {
  it('rejects an edit that makes the question a duplicate of another', async () => {
    const first = await request(app).post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq({ question: 'First question?' }));
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq({ question: 'Second question?' }));
    expect(second.status).toBe(201);

    const res = await request(app)
      .put(`/api/question-bank/${second.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ question: 'First question?' });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('This question already exists in the question bank.');
  });

  it('allows saving a question with its own unchanged text (no self-match)', async () => {
    const created = await request(app).post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq());
    expect(created.status).toBe(201);

    const res = await request(app)
      .put(`/api/question-bank/${created.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ difficulty: 'hard' });

    expect(res.status).toBe(200);
  });
});

describe('PUT /api/question-bank/:id — update validation', () => {
  it('re-validates the full merged document on partial update', async () => {
    const created = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq());

    const res = await request(app)
      .put(`/api/question-bank/${created.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ difficulty: 'not-a-real-difficulty' });

    expect(res.status).toBe(400);
  });

  it('applies a valid partial update without clobbering other fields', async () => {
    const created = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq());

    const res = await request(app)
      .put(`/api/question-bank/${created.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ difficulty: 'hard' });

    expect(res.status).toBe(200);
    expect(res.body.difficulty).toBe('hard');
    expect(res.body.subtopicName).toBe('Mendelian Inheritance');
  });

  it('rejects an update that swaps in a placeholder image URL', async () => {
    const created = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq());

    const res = await request(app)
      .put(`/api/question-bank/${created.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ questionImage: 'https://example.com/new-image.png' });

    expect(res.status).toBe(400);
    expect(res.body.errors.some((e) => /Question image/.test(e))).toBe(true);
  });
});

describe('POST /api/question-bank/bulk-import — image URL validation', () => {
  const xlsx = require('xlsx');

  // Minimal two-row sheet: one clean mcq row, one image_based row carrying
  // the template's placeholder URL (the exact shape that reached production
  // and rendered as a broken image for guests).
  const buildWorkbook = (imageUrl) => {
    const rows = [
      {
        SUBJECT: 'Pathology', TOPIC: 'Genetics', SUBTOPIC: 'Mendelian Inheritance',
        SYSTEM: 'Genetic Disorders', QUESTION_TYPE: 'MCQ — Single Correct', DIFFICULTY: 'medium',
        QUESTION: 'Clean question?', OPTION1: 'A', OPTION2: 'B', CORRECT: 'A',
      },
      {
        SUBJECT: 'Pathology', TOPIC: 'Histology', SUBTOPIC: 'Epithelium',
        SYSTEM: 'Histology', QUESTION_TYPE: 'Image-Based', DIFFICULTY: 'medium',
        QUESTION: 'Identify the structure.', Q_IMAGE: imageUrl,
        OPTION1: 'A', OPTION2: 'B', CORRECT: 'A',
      },
    ];
    const sheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, sheet, 'Question Bank');
    return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  };

  it('reports the placeholder image row as an error and imports the clean row', async () => {
    const res = await request(app)
      .post('/api/question-bank/bulk-import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buildWorkbook('https://example.com/dummy-brachial-plexus.png'), 'import.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.errors.some((e) => /Row 3/.test(e) && /placeholder/.test(e))).toBe(true);
  });

  it('imports an image_based row whose image URL is real', async () => {
    const res = await request(app)
      .post('/api/question-bank/bulk-import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buildWorkbook('https://res.cloudinary.com/vivek-bmpromo/image/upload/v1/eyeconic_questions/q.png'), 'import.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.errors).toBeUndefined();
  });
});

describe('POST /api/question-bank/bulk-import — legacy tech-team sheet', () => {
  const xlsx = require('xlsx');

  // The exact column set of Q_BankTechTeamFinal.xlsx: no SUBTOPIC, SYSTEM,
  // QUESTION_TYPE or DIFFICULTY columns at all.
  const buildLegacyWorkbook = (rows) => {
    const sheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  };

  const legacyRow = (overrides = {}) => ({
    'QUESTION NO': 38,
    SUBJECT: 'OBSTETRICS & GYNAECOLOGY',
    TOPIC: 'Upper Limb',
    TAG: 'Injuries of Clavicle',
    QUESTION: 'The radiograph shows a displaced spiral fracture. What is it known as?',
    Q_IMAGE: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/view',
    OPTION1: 'Holdsworth fracture',
    OPTION2: 'Holstein-Lewis fracture',
    OPTION3: 'Jefferson fracture',
    OPTION4: 'Lisfranc fracture',
    CORRECT: '2',
    ...overrides,
  });

  it('imports legacy rows with defaulted metadata and a normalized image URL', async () => {
    // Reuse the same subjects the route resolves against.
    const OBGYN = await createSubject('OBGYN');
    // The import attempts a Drive -> Cloudinary transfer for the Q_IMAGE;
    // stub the download so the test is deterministic and offline. The
    // transfer then fails per-image and falls back to keeping the direct
    // (normalized) URL, surfacing a warning — the exact contract below.
    const axios = require('axios');
    const getSpy = jest.spyOn(axios, 'get').mockRejectedValue(new Error('offline test'));
    try {
      const res = await request(app)
        .post('/api/question-bank/bulk-import')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', buildLegacyWorkbook([legacyRow()]), 'legacy.xlsx');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.warnings?.some((w) => w.includes('Image transfer failed'))).toBe(true);

      const QuestionBank = require('../../models/QuestionBank');
      const saved = await QuestionBank.findOne({ qid: '38' });
      expect(saved).toBeTruthy();
      expect(saved.questionType).toBe('image_based');
      expect(saved.difficulty).toBe('medium');
      expect(saved.subtopicName).toBe('Upper Limb');
      expect(saved.subject.toString()).toBe(OBGYN._id.toString()); // alias resolved
      // Drive share link normalized to the direct delivery host (lh3), which
      // the import transfer then swaps for a Cloudinary URL in production.
      expect(saved.questionImage).toBe('https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    } finally {
      getSpy.mockRestore();
    }
  });
});

describe('POST /api/question-bank/bulk-import — duplicate guard', () => {
  const xlsx = require('xlsx');

  const mcqRow = (question, overrides = {}) => ({
    SUBJECT: 'Pathology', TOPIC: 'Genetics', SUBTOPIC: 'Mendelian Inheritance',
    SYSTEM: 'Genetic Disorders', QUESTION_TYPE: 'MCQ — Single Correct', DIFFICULTY: 'medium',
    QUESTION: question, OPTION1: 'A', OPTION2: 'B', OPTION3: 'C', OPTION4: 'D', CORRECT: 'A',
    ...overrides,
  });

  const buildWorkbook = (rows) => {
    const sheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, sheet, 'Question Bank');
    return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  };

  const importSheet = (rows) => request(app)
    .post('/api/question-bank/bulk-import')
    .set('Authorization', `Bearer ${adminToken}`)
    .attach('file', buildWorkbook(rows), 'import.xlsx');

  it('re-importing the same sheet inserts nothing and reports every row as a duplicate', async () => {
    const first = await importSheet([mcqRow('First question?'), mcqRow('Second question?')]);
    expect(first.status).toBe(200);
    expect(first.body.count).toBe(2);
    expect(first.body.duplicatesSkipped).toBe(0);

    const second = await importSheet([mcqRow('First question?'), mcqRow('Second question?')]);
    expect(second.status).toBe(200);
    expect(second.body.count).toBe(0);
    expect(second.body.duplicatesSkipped).toBe(2);
    expect(second.body.duplicates.every((d) => /Row \d+: skipped/.test(d))).toBe(true);

    const QuestionBank = require('../../models/QuestionBank');
    expect(await QuestionBank.countDocuments({})).toBe(2);
  });

  it('imports only the new rows from a mixed sheet', async () => {
    await importSheet([mcqRow('Existing question?')]);

    const res = await importSheet([mcqRow('Existing question?'), mcqRow('New question?')]);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.duplicatesSkipped).toBe(1);

    const QuestionBank = require('../../models/QuestionBank');
    expect(await QuestionBank.countDocuments({})).toBe(2);
  });

  it('matches question text case-insensitively', async () => {
    await importSheet([mcqRow('What is the powerhouse of the cell?')]);

    const res = await importSheet([mcqRow('WHAT IS THE POWERHOUSE OF THE CELL?')]);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.duplicatesSkipped).toBe(1);
  });

  it('skips the second occurrence of a question duplicated within the same file', async () => {
    const res = await importSheet([
      mcqRow('Repeated question?', { TOPIC: 'Topic A' }),
      mcqRow('Repeated question?', { TOPIC: 'Topic B' }),
    ]);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.duplicatesSkipped).toBe(1);

    const QuestionBank = require('../../models/QuestionBank');
    expect(await QuestionBank.countDocuments({})).toBe(1);
  });

  it('allows the same question text under a different subject', async () => {
    await createSubject('Physiology');
    const first = await importSheet([mcqRow('Shared question?')]);
    expect(first.body.count).toBe(1);

    const res = await importSheet([mcqRow('Shared question?', { SUBJECT: 'Physiology' })]);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.duplicatesSkipped).toBe(0);

    const QuestionBank = require('../../models/QuestionBank');
    expect(await QuestionBank.countDocuments({})).toBe(2);
  });

  it('returns 200 with count 0 when every row is a duplicate', async () => {
    await importSheet([mcqRow('Only question?')]);

    const res = await importSheet([mcqRow('Only question?')]);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.errors).toBeUndefined();
  });
});

describe('POST /api/question-bank — duplicate guard (strengthened normalization)', () => {
  it('treats internal double spaces as the same question', async () => {
    await request(app).post('/api/question-bank').set('Authorization', `Bearer ${adminToken}`).send(validMcq());
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq({ question: 'What is the  powerhouse of the cell?' }));
    expect(res.status).toBe(409);
    expect(res.body.errorType).toBe('DUPLICATE_QUESTION');
  });

  it('treats newlines and tabs inside the text as whitespace', async () => {
    await request(app).post('/api/question-bank').set('Authorization', `Bearer ${adminToken}`).send(validMcq());
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq({ question: 'What\tis\nthe powerhouse of the cell?' }));
    expect(res.status).toBe(409);
  });

  it('treats a unicode-space (NBSP) variant as the same question', async () => {
    await request(app).post('/api/question-bank').set('Authorization', `Bearer ${adminToken}`).send(validMcq());
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq({ question: 'What is the powerhouse of the cell?' }));
    expect(res.status).toBe(409);
  });

  it('does not dedupe across different punctuation', async () => {
    await request(app).post('/api/question-bank').set('Authorization', `Bearer ${adminToken}`).send(validMcq());
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq({ question: 'What is the powerhouse of the cell!' }));
    expect(res.status).toBe(201);
  });

  it('concurrent creates of the same text yield exactly one 201 and one 409', async () => {
    const QuestionBank = require('../../models/QuestionBank');
    // Force the unique partial index to exist before the race — mongoose
    // builds indexes in the background and does not block ops on the build.
    await QuestionBank.init();
    const [a, b] = await Promise.all([
      request(app).post('/api/question-bank').set('Authorization', `Bearer ${adminToken}`).send(validMcq()),
      request(app).post('/api/question-bank').set('Authorization', `Bearer ${adminToken}`).send(validMcq()),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await QuestionBank.countDocuments({})).toBe(1);
  });
});

describe('POST /api/question-bank/bulk-import — strengthened normalization & split counters', () => {
  const xlsx = require('xlsx');

  const mcqRow = (question, overrides = {}) => ({
    SUBJECT: 'Pathology', TOPIC: 'Genetics', SUBTOPIC: 'Mendelian Inheritance',
    SYSTEM: 'Genetic Disorders', QUESTION_TYPE: 'MCQ — Single Correct', DIFFICULTY: 'medium',
    QUESTION: question, OPTION1: 'A', OPTION2: 'B', OPTION3: 'C', OPTION4: 'D', CORRECT: 'A',
    ...overrides,
  });

  const buildWorkbook = (rows) => {
    const sheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, sheet, 'Question Bank');
    return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  };

  const importSheet = (rows) => request(app)
    .post('/api/question-bank/bulk-import')
    .set('Authorization', `Bearer ${adminToken}`)
    .attach('file', buildWorkbook(rows), 'import.xlsx');

  it('skips whitespace and case variants of an already-imported question', async () => {
    await importSheet([mcqRow('What is osmosis?')]);
    const res = await importSheet([
      mcqRow('WHAT   IS OSMOSIS?'),
      mcqRow('What\tis\nosmosis?'),
      mcqRow(' What is osmosis? '),
    ]);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.duplicatesSkipped).toBe(3);
    expect(res.body.duplicatesExisting).toBe(3);
  });

  it('reports duplicatesInFile and duplicatesExisting separately', async () => {
    await importSheet([mcqRow('Already banked question?')]);
    const res = await importSheet([
      mcqRow('Brand new question?'),
      mcqRow('Already banked question?'),
      mcqRow('Repeated in this file?'),
      mcqRow('Repeated in this file?'),
    ]);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.duplicatesInFile).toBe(1);
    expect(res.body.duplicatesExisting).toBe(1);
    expect(res.body.duplicatesSkipped).toBe(2);
    expect(res.body.duplicates.some((d) => /duplicate of an earlier row in this file/.test(d))).toBe(true);
    expect(res.body.duplicates.some((d) => /already exists in the question bank/.test(d))).toBe(true);
  });

  it('keeps the Row N: skipped pattern for existing-bank duplicates', async () => {
    await importSheet([mcqRow('Pattern question?')]);
    const res = await importSheet([mcqRow('Pattern question?')]);
    expect(res.body.duplicates[0]).toMatch(/^Row \d+: skipped — this question already exists in the question bank\.$/);
  });

  it('two identical sheets imported concurrently insert one set and never error', async () => {
    const QuestionBank = require('../../models/QuestionBank');
    // Force the unique partial index to exist before the race — mongoose
    // builds indexes in the background and does not block ops on the build.
    await QuestionBank.init();
    const rows = [mcqRow('Race question one?'), mcqRow('Race question two?'), mcqRow('Race question three?')];
    const [a, b] = await Promise.all([importSheet(rows), importSheet(rows)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.count + b.body.count).toBe(3);
    expect(a.body.duplicatesSkipped + b.body.duplicatesSkipped).toBe(3);
    expect(a.body.errors).toBeUndefined();
    expect(b.body.errors).toBeUndefined();
    expect(await QuestionBank.countDocuments({})).toBe(3);
  });

  const sixTypeRows = () => [
    mcqRow('Single correct question?'),
    mcqRow('Multi correct question?', { QUESTION_TYPE: 'Multiple Correct', CORRECT: 'A,B' }),
    mcqRow('Assertion reason question?', {
      QUESTION_TYPE: 'Assertion & Reason', OPTION1: '', OPTION2: '', OPTION3: '', OPTION4: '',
      CORRECT: '2', ASSERTION: 'The assertion text.', REASON: 'The reason text.',
    }),
    mcqRow('Match the following question?', {
      QUESTION_TYPE: 'Match the Following', OPTION1: '', OPTION2: '', OPTION3: '', OPTION4: '',
      CORRECT: '1-A,2-B', COLUMN_A: 'Item A;Item B', COLUMN_B: 'P;Q',
    }),
    mcqRow('Numerical question?', {
      QUESTION_TYPE: 'Numerical', OPTION1: '', OPTION2: '', OPTION3: '', OPTION4: '', CORRECT: '3.14',
    }),
    mcqRow('Image based question?', {
      QUESTION_TYPE: 'Image Based', CORRECT: 'B', Q_IMAGE: 'data:image/png;base64,iVBORw0KGgo=',
    }),
  ];

  it('skips duplicates across all six question types on re-import', async () => {
    const first = await importSheet(sixTypeRows());
    expect(first.status).toBe(200);
    expect(first.body.count).toBe(6);
    expect(first.body.errors).toBeUndefined();

    const second = await importSheet(sixTypeRows());
    expect(second.status).toBe(200);
    expect(second.body.count).toBe(0);
    expect(second.body.duplicatesSkipped).toBe(6);

    const QuestionBank = require('../../models/QuestionBank');
    expect(await QuestionBank.countDocuments({})).toBe(6);
  });

  it('imports 2500 rows with a single prefetch query (no per-row lookups)', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => mcqRow(`Scale question #${i}?`));
    const QuestionBank = require('../../models/QuestionBank');
    const findSpy = jest.spyOn(QuestionBank, 'find');
    const findOneSpy = jest.spyOn(QuestionBank, 'findOne');
    try {
      const res = await importSheet(rows);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2500);
      expect(res.body.duplicatesSkipped).toBe(0);
      expect(findSpy.mock.calls.length).toBeLessThanOrEqual(2); // the one dedup prefetch (+ slack)
      expect(findOneSpy.mock.calls.length).toBe(0);
      expect(await QuestionBank.countDocuments({})).toBe(2500);
    } finally {
      findSpy.mockRestore();
      findOneSpy.mockRestore();
    }
  });
});

describe('POST /api/question-bank/bulk-import — legacy docs without dedupKey', () => {
  const xlsx = require('xlsx');
  const QuestionBank = require('../../models/QuestionBank');

  const mcqRow = (question) => ({
    SUBJECT: 'Pathology', TOPIC: 'Genetics', SUBTOPIC: 'Mendelian Inheritance',
    SYSTEM: 'Genetic Disorders', QUESTION_TYPE: 'MCQ — Single Correct', DIFFICULTY: 'medium',
    QUESTION: question, OPTION1: 'A', OPTION2: 'B', OPTION3: 'C', OPTION4: 'D', CORRECT: 'A',
  });

  const importSheet = (rows) => {
    const sheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, sheet, 'Question Bank');
    return request(app)
      .post('/api/question-bank/bulk-import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }), 'import.xlsx');
  };

  // Native insert: no mongoose validation, no pre-save hook → no dedupKey,
  // exactly like a pre-backfill production row.
  const insertLegacyDoc = async (question) => {
    await QuestionBank.collection.insertOne({
      subject: subject._id, question, isActive: true, questionType: 'mcq_single', correctAnswer: 0,
    });
  };

  it('manual guard still blocks an exact-text legacy doc via the fallback branch', async () => {
    await insertLegacyDoc('Legacy question?');
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq({ question: 'Legacy question?' }));
    expect(res.status).toBe(409);
    expect(res.body.errorType).toBe('DUPLICATE_QUESTION');
  });

  it('documents the known window: a whitespace variant of an irregularly-spaced legacy doc is allowed', async () => {
    // Stored legacy text has internal double spaces and no dedupKey, so
    // neither the $expr fallback (raw comparison) nor the index sees the
    // single-spaced variant. Backfilling the key closes this window — see
    // scripts/backfillQuestionDedupKeys.js.
    await insertLegacyDoc('Legacy  question  with  spaces?');
    const res = await request(app)
      .post('/api/question-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validMcq({ question: 'Legacy question with spaces?' }));
    expect(res.status).toBe(201);
  });

  it('bulk import still catches the whitespace variant of a legacy doc (in-memory normalization)', async () => {
    await insertLegacyDoc('Legacy  question  with  spaces?');
    const res = await importSheet([mcqRow('Legacy question with spaces?')]);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.duplicatesSkipped).toBe(1);
    expect(res.body.duplicatesExisting).toBe(1);
  });
});

describe('POST /api/question-bank/bulk-import — CSV support', () => {
  const csvEscape = (value) => {
    const str = String(value ?? '');
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const buildCsv = (rows) => Buffer.from(rows.map((r) => r.map(csvEscape).join(',')).join('\r\n'), 'utf8');

  const HEADERS = ['SUBJECT', 'TOPIC', 'SUBTOPIC', 'SYSTEM', 'QUESTION_TYPE', 'DIFFICULTY', 'QUESTION',
    'OPTION1', 'OPTION2', 'OPTION3', 'OPTION4', 'CORRECT', 'SOLUTION'];

  const mcqCells = (question) => ['Pathology', 'Genetics', 'Mendelian Inheritance', 'Genetic Disorders',
    'MCQ — Single Correct', 'medium', question, 'A', 'B', 'C', 'D', 'A', 'Because A is correct.'];

  const importCsv = (buffer, filename = 'import.csv') => request(app)
    .post('/api/question-bank/bulk-import')
    .set('Authorization', `Bearer ${adminToken}`)
    .attach('file', buffer, { filename, contentType: 'text/csv' });

  it('imports a plain CSV buffer', async () => {
    const res = await importCsv(buildCsv([
      HEADERS,
      mcqCells('What is a CSV question?'),
      mcqCells('What is a second CSV question?'),
    ]));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.errors).toBeUndefined();
  });

  it('imports a UTF-8 BOM prefixed CSV', async () => {
    const csv = buildCsv([HEADERS, mcqCells('BOM prefixed question?')]);
    const res = await importCsv(Buffer.concat([Buffer.from('﻿', 'utf8'), csv]));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('handles a quoted multi-line question text in CSV', async () => {
    const res = await importCsv(buildCsv([
      HEADERS,
      mcqCells('A question\nspanning multiple lines?'),
    ]));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    const QuestionBank = require('../../models/QuestionBank');
    const doc = await QuestionBank.findOne({});
    expect(doc.question).toContain('multiple lines');
  });

  it('re-importing a CSV reports every row as an existing duplicate', async () => {
    const rows = [HEADERS, mcqCells('Re-import me?')];
    await importCsv(buildCsv(rows));
    const res = await importCsv(buildCsv(rows));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.duplicatesSkipped).toBe(1);
    expect(res.body.duplicatesExisting).toBe(1);
    expect(res.body.errors).toBeUndefined();
  });

  it('base64 route accepts a CSV payload too', async () => {
    const buffer = buildCsv([HEADERS, mcqCells('Base64 CSV question?')]);
    const res = await request(app)
      .post('/api/question-bank/bulk-import-base64')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ filename: 'import.csv', data: buffer.toString('base64') });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});
