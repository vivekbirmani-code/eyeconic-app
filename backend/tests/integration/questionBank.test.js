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

const validMcq = () => ({
  subject: subject._id.toString(),
  topicName: 'Genetics',
  subtopicName: 'Mendelian Inheritance',
  system: 'Genetic Disorders',
  questionType: 'mcq_single',
  difficulty: 'medium',
  question: 'What is the powerhouse of the cell?',
  options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
  correctAnswer: 1,
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
    await request(app).post('/api/question-bank').set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validMcq(), difficulty: 'easy', system: 'Cardiovascular', subtopicName: 'Heart' });
    await request(app).post('/api/question-bank').set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validMcq(), difficulty: 'hard', system: 'Respiratory', subtopicName: 'Lungs' });
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
