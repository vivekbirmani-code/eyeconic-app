const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const User = require('../../models/User');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

describe('Public share links — always open the web app, never the app', () => {
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

  it('302-redirects legacy backend links to the dev web app in development (zero-config)', async () => {
    const res = await request(app).get('/api/public/share/redirect-test-token');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/public-quiz/redirect-test-token');
  });

  it('302-redirects legacy backend links to the production web origin when WEB_APP_URL is unset in PRODUCTION — no interstitial, ever', async () => {
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app).get('/api/public/share/redirect-test-token');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://eyeconicmentors.vercel.app/public-quiz/redirect-test-token');
      expect(res.text).not.toContain('Open App');
    } finally {
      process.env.NODE_ENV = 'development';
    }
  });

  it('honours an explicit WEB_APP_URL in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEB_APP_URL = 'https://custom-eyeconic-web.example.com/';
    try {
      const res = await request(app).get('/api/public/share/redirect-test-token');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://custom-eyeconic-web.example.com/public-quiz/redirect-test-token');
    } finally {
      process.env.NODE_ENV = 'development';
      delete process.env.WEB_APP_URL;
    }
  });

  it('serves a scheme-less WEB_APP_URL host over https (Render dashboard paste)', async () => {
    process.env.WEB_APP_URL = 'eyeconic-public-web.onrender.com';
    try {
      const res = await request(app).get('/api/public/share/redirect-test-token');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://eyeconic-public-web.onrender.com/public-quiz/redirect-test-token');
    } finally {
      delete process.env.WEB_APP_URL;
    }
  });

  it('redirects revoked/unknown tokens to the web error state (?invalid=1)', async () => {
    await Quiz.updateOne({ _id: quiz._id }, { $set: { isPublic: false } });
    const revoked = await request(app).get('/api/public/share/redirect-test-token');
    expect(revoked.status).toBe(302);
    expect(revoked.headers.location).toBe('http://localhost:5173/public-quiz/redirect-test-token?invalid=1');

    const unknown = await request(app).get('/api/public/share/no-such-token');
    expect(unknown.status).toBe(302);
    expect(unknown.headers.location).toBe('http://localhost:5173/public-quiz/no-such-token?invalid=1');
  });

  it('generate-share-link hands out a DIRECT web URL (no backend hop, no app scheme)', async () => {
    const res = await request(app)
      .post(`/api/quizzes/${quiz._id}/generate-share-link`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.shareUrl).toBe(`http://localhost:5173/public-quiz/${res.body.shareToken}`);
    expect(res.body.shareUrl).not.toContain('/api/public/share');
    expect(res.body.shareUrl).not.toContain('mentorship://');

    // share-status (existing-link copy path) returns the same direct URL.
    const status = await request(app)
      .get(`/api/quizzes/${quiz._id}/share-status`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(status.status).toBe(200);
    expect(status.body.shareUrl).toBe(`http://localhost:5173/public-quiz/${res.body.shareToken}`);
  });
});
