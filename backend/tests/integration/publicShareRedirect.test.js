const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

describe('GET /api/public/share/:shareToken redirect', () => {
  let admin;
  let subject;
  let quiz;
  const originalWebAppUrl = process.env.WEB_APP_URL;

  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    subject = await createSubject('Pathology');
    quiz = await Quiz.create({
      title: 'Redirect Test Quiz',
      subject: subject._id,
      testType: 'daily',
      duration: 10,
      questions: [],
      createdBy: admin.user._id,
      isPublic: true,
      shareToken: 'redirect-test-token',
    });
    delete process.env.WEB_APP_URL;
  });

  afterAll(() => {
    if (originalWebAppUrl === undefined) {
      delete process.env.WEB_APP_URL;
    } else {
      process.env.WEB_APP_URL = originalWebAppUrl;
    }
  });

  it('falls back to the client dev server when WEB_APP_URL is unset in development (zero-config local)', async () => {
    const res = await request(app).get('/api/public/share/redirect-test-token');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/public-quiz/redirect-test-token');
  });

  it('serves the legacy app-redirect interstitial when WEB_APP_URL is unset in PRODUCTION (rollback switch)', async () => {
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app).get('/api/public/share/redirect-test-token');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Opening Eyeconic Quiz');
      expect(res.text).toContain('mentorship://quiz/redirect-test-token');
    } finally {
      process.env.NODE_ENV = 'development';
    }
  });

  it('302-redirects to the web quiz when WEB_APP_URL is set', async () => {
    process.env.WEB_APP_URL = 'https://eyeconicmentors.vercel.app/';
    const res = await request(app).get('/api/public/share/redirect-test-token');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://eyeconicmentors.vercel.app/public-quiz/redirect-test-token');
  });

  it('redirects revoked/unknown tokens to the web error state (?invalid=1)', async () => {
    process.env.WEB_APP_URL = 'https://eyeconicmentors.vercel.app';

    const revoked = await request(app).get('/api/public/share/redirect-test-token');
    expect(revoked.status).toBe(302);
    expect(revoked.headers.location).toBe('https://eyeconicmentors.vercel.app/public-quiz/redirect-test-token');

    await Quiz.updateOne({ _id: quiz._id }, { $set: { isPublic: false } });
    const afterRevoke = await request(app).get('/api/public/share/redirect-test-token');
    expect(afterRevoke.status).toBe(302);
    expect(afterRevoke.headers.location).toBe('https://eyeconicmentors.vercel.app/public-quiz/redirect-test-token?invalid=1');

    const unknown = await request(app).get('/api/public/share/no-such-token');
    expect(unknown.status).toBe(302);
    expect(unknown.headers.location).toBe('https://eyeconicmentors.vercel.app/public-quiz/no-such-token?invalid=1');
  });
});
