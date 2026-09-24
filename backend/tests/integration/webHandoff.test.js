process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.INTEGRATION_SERVICE_TOKEN = 'a'.repeat(43); // >= 32 chars

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { connect, closeDatabase, clearDatabase } = require('../helpers/db');
const { createUser } = require('../helpers/testApp');
const requestId = require('../../middleware/requestId');

const SERVICE_TOKEN = process.env.INTEGRATION_SERVICE_TOKEN;

// Mounted lazily (module-level timers in routes/integration are unref'd).
let authRoutes, integrationRoutes, WebHandoffCode;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.use('/api/auth', authRoutes);
  app.use('/api/integration/v1', integrationRoutes);
  app.use('/api/integration/v1', (req, res) =>
    res.status(404).json({ message: 'The requested resource was not found.', code: 'NOT_FOUND', requestId: req.requestId })
  );
  return app;
}

describe('App -> Website session handoff', () => {
  let app;
  let student;

  beforeAll(async () => {
    await connect();
    authRoutes = require('../../routes/auth');
    integrationRoutes = require('../../routes/integration');
    WebHandoffCode = require('../../models/WebHandoffCode');
    app = buildApp();
  });

  beforeEach(async () => {
    await clearDatabase();
    student = await createUser({ role: 'student', name: 'Handoff Student' });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('POST /api/auth/web-handoff', () => {
    it('requires a user JWT', async () => {
      const response = await request(app).post('/api/auth/web-handoff').send({});

      expect(response.status).toBe(401);
    });

    it('creates a single-use code and a full handoff URL', async () => {
      const response = await request(app)
        .post('/api/auth/web-handoff')
        .set('Authorization', `Bearer ${student.token}`)
        .send({ dest: '/dashboard' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(response.body.url).toContain('/app-link?code=');
      expect(response.body.url).toContain('dest=%2Fdashboard');
      expect(response.body.expiresAt).toBeDefined();

      // Only a hash is stored.
      const stored = await WebHandoffCode.findOne({ user: student.user._id });
      expect(stored).toBeTruthy();
      expect(stored.codeHash).not.toBe(response.body.code);
      expect(stored.codeHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('rejects non-relative destinations (no open redirects)', async () => {
      for (const dest of ['https://evil.example.com', '//evil.example.com', 'javascript:alert(1)', '\\/\\/evil']) {
        const response = await request(app)
          .post('/api/auth/web-handoff')
          .set('Authorization', `Bearer ${student.token}`)
          .send({ dest });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
      }
    });

    it('supersedes previous unused codes', async () => {
      const first = await request(app)
        .post('/api/auth/web-handoff')
        .set('Authorization', `Bearer ${student.token}`)
        .send({});
      expect(first.status).toBe(200);

      const second = await request(app)
        .post('/api/auth/web-handoff')
        .set('Authorization', `Bearer ${student.token}`)
        .send({});
      expect(second.status).toBe(200);

      const remaining = await WebHandoffCode.find({ user: student.user._id, usedAt: null });
      expect(remaining).toHaveLength(1);
    });

    it('rate limits bursts from one user', async () => {
      const limit = Number(process.env.WEB_HANDOFF_MAX_PER_USER || 10);
      let last;
      for (let i = 0; i <= limit; i += 1) {
        last = await request(app)
          .post('/api/auth/web-handoff')
          .set('Authorization', `Bearer ${student.token}`)
          .send({});
      }
      expect(last.status).toBe(429);
    });

    it('rejects guest session tokens', async () => {
      const guestToken = jwt.sign({ kind: 'guest', guestId: 'g123' }, process.env.JWT_SECRET);
      const response = await request(app)
        .post('/api/auth/web-handoff')
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/integration/v1/handoff/consume', () => {
    const createCode = async (dest = '') => {
      const response = await request(app)
        .post('/api/auth/web-handoff')
        .set('Authorization', `Bearer ${student.token}`)
        .send({ dest });
      return response.body;
    };

    it('exchanges a valid code for a token + user profile', async () => {
      const handoff = await createCode('/tests');

      const response = await request(app)
        .post('/api/integration/v1/handoff/consume')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
        .send({ code: handoff.code });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.token).toBeDefined();
      expect(response.body.user._id).toBe(String(student.user._id));
      expect(response.body.user.password).toBeUndefined();

      // The minted token is a valid user JWT for this student.
      const decoded = jwt.verify(response.body.token, process.env.JWT_SECRET);
      expect(String(decoded.userId)).toBe(String(student.user._id));
      expect(decoded.kind).toBeUndefined();
    });

    it('works only once (single-use, atomic)', async () => {
      const handoff = await createCode();

      const first = await request(app)
        .post('/api/integration/v1/handoff/consume')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
        .send({ code: handoff.code });
      expect(first.status).toBe(200);

      const second = await request(app)
        .post('/api/integration/v1/handoff/consume')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
        .send({ code: handoff.code });
      expect(second.status).toBe(400);
      expect(second.body.code).toBe('HANDOFF_INVALID');
    });

    it('rejects expired codes', async () => {
      const handoff = await createCode();
      await WebHandoffCode.updateOne(
        { codeHash: require('crypto').createHash('sha256').update(handoff.code).digest('hex') },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
      );

      const response = await request(app)
        .post('/api/integration/v1/handoff/consume')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
        .send({ code: handoff.code });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('HANDOFF_INVALID');
    });

    it('rejects malformed / unknown codes without leaking which', async () => {
      for (const code of ['', 'short', 'x'.repeat(200), 'has spaces in it']) {
        const response = await request(app)
          .post('/api/integration/v1/handoff/consume')
          .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
          .send({ code });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('HANDOFF_INVALID');
      }

      const unknown = await request(app)
        .post('/api/integration/v1/handoff/consume')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
        .send({ code: 'A'.repeat(43) });
      expect(unknown.status).toBe(400);
    });

    it('requires the service token', async () => {
      const handoff = await createCode();

      const noToken = await request(app)
        .post('/api/integration/v1/handoff/consume')
        .send({ code: handoff.code });
      expect(noToken.status).toBe(401);

      const badToken = await request(app)
        .post('/api/integration/v1/handoff/consume')
        .set('Authorization', `Bearer ${'b'.repeat(43)}`)
        .send({ code: handoff.code });
      expect(badToken.status).toBe(401);

      // A user JWT is NOT a service token.
      const userJwt = await request(app)
        .post('/api/integration/v1/handoff/consume')
        .set('Authorization', `Bearer ${student.token}`)
        .send({ code: handoff.code });
      expect(userJwt.status).toBe(401);

      // Code must still be consumable after the failed attempts.
      const valid = await request(app)
        .post('/api/integration/v1/handoff/consume')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
        .send({ code: handoff.code });
      expect(valid.status).toBe(200);
    });

    it('stays closed (503) in production when the service token is not configured', async () => {
      const previous = process.env.INTEGRATION_SERVICE_TOKEN;
      const nodeEnv = process.env.NODE_ENV;
      delete process.env.INTEGRATION_SERVICE_TOKEN;
      process.env.NODE_ENV = 'production';

      const response = await request(app)
        .post('/api/integration/v1/handoff/consume')
        .set('Authorization', `Bearer ${previous}`)
        .send({ code: 'A'.repeat(43) });

      expect(response.status).toBe(503);
      process.env.INTEGRATION_SERVICE_TOKEN = previous;
      process.env.NODE_ENV = nodeEnv;
    });

    it('outside production, falls back to the shared dev token (local-only)', async () => {
      const previous = process.env.INTEGRATION_SERVICE_TOKEN;
      const nodeEnv = process.env.NODE_ENV;
      delete process.env.INTEGRATION_SERVICE_TOKEN;
      process.env.NODE_ENV = 'development';

      const handoff = await request(app)
        .post('/api/auth/web-handoff')
        .set('Authorization', `Bearer ${student.token}`)
        .send({});
      expect(handoff.status).toBe(200);

      const consumed = await request(app)
        .post('/api/integration/v1/handoff/consume')
        .set('Authorization', 'Bearer dev-integration-service-token-local-only-000')
        .send({ code: handoff.body.code });
      expect(consumed.status).toBe(200);
      expect(consumed.body.success).toBe(true);

      // A non-dev token is still rejected while the dev default is active.
      const rejected = await request(app)
        .post('/api/integration/v1/handoff/consume')
        .set('Authorization', `Bearer ${previous}`)
        .send({ code: 'B'.repeat(43) });
      expect(rejected.status).toBe(401);

      process.env.INTEGRATION_SERVICE_TOKEN = previous;
      process.env.NODE_ENV = nodeEnv;
    });
  });
});
