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
});
