process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.INTEGRATION_SERVICE_TOKEN = 'a'.repeat(43); // >= 32 chars

const request = require('supertest');
const express = require('express');
const { connect, closeDatabase, clearDatabase } = require('../helpers/db');
const requestId = require('../../middleware/requestId');
const User = require('../../models/User');

const SERVICE_TOKEN = process.env.INTEGRATION_SERVICE_TOKEN;

// Mounted lazily (module-level timers in routes/integration are unref'd).
let integrationRoutes, authRoutes;

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

const serviceAuthHeader = { Authorization: `Bearer ${SERVICE_TOKEN}` };

const SIGNUP_BODY = {
  name: 'Free Visitor',
  email: 'free-visitor@example.com',
  phone: '9876543210',
  password: 'secret123',
};

describe('POST /api/integration/v1/free-user/signup (website funnel)', () => {
  let app;

  beforeAll(async () => {
    await connect();
    integrationRoutes = require('../../routes/integration');
    authRoutes = require('../../routes/auth');
    app = buildApp();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('requires the service token', async () => {
    const response = await request(app)
      .post('/api/integration/v1/free-user/signup')
      .send(SIGNUP_BODY);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('SERVICE_UNAUTHORIZED');
  });

  it('rejects a wrong service token', async () => {
    const response = await request(app)
      .post('/api/integration/v1/free-user/signup')
      .set('Authorization', 'Bearer definitely-not-the-service-token')
      .send(SIGNUP_BODY);

    expect(response.status).toBe(401);
  });

  it('creates a free student account the normal login accepts', async () => {
    const response = await request(app)
      .post('/api/integration/v1/free-user/signup')
      .set(serviceAuthHeader)
      .send(SIGNUP_BODY);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.user.email).toBe(SIGNUP_BODY.email);
    expect(response.body.user.isFreeUser).toBe(true);
    expect(response.body.user.role).toBe('student');
    // Never leak the password (even hashed) to the caller.
    expect(response.body.user.password).toBeUndefined();
    // Sign-up is a separate step from sign-in on the website: no token.
    expect(response.body.token).toBeUndefined();

    // THE regression this endpoint exists for: the created account must be
    // usable by the app's own /api/auth/login with the same credentials.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: SIGNUP_BODY.email, password: SIGNUP_BODY.password });

    expect(login.status).toBe(200);
    expect(login.body.token).toEqual(expect.any(String));
    expect(login.body.user.isFreeUser).toBe(true);

    // Password stored hashed, not plaintext.
    const stored = await User.findOne({ email: SIGNUP_BODY.email }).select('+password');
    expect(stored.password).not.toBe(SIGNUP_BODY.password);
    await expect(stored.comparePassword(SIGNUP_BODY.password)).resolves.toBe(true);
  });

  it('normalizes the email address', async () => {
    const response = await request(app)
      .post('/api/integration/v1/free-user/signup')
      .set(serviceAuthHeader)
      .send({ ...SIGNUP_BODY, email: '  Free.Visitor@Example.COM  ' });

    expect(response.status).toBe(201);
    const stored = await User.findOne({ email: 'free.visitor@example.com' });
    expect(stored).toBeTruthy();
  });

  it('rejects an email that already exists (any account type)', async () => {
    await User.create({
      name: 'Existing Mentor Student',
      email: SIGNUP_BODY.email,
      password: 'password123',
      role: 'student',
    });

    const response = await request(app)
      .post('/api/integration/v1/free-user/signup')
      .set(serviceAuthHeader)
      .send(SIGNUP_BODY);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('EMAIL_TAKEN');
  });

  it('rejects invalid payloads with user-safe validation errors', async () => {
    const cases = [
      [{ ...SIGNUP_BODY, name: 'x' }, 'Name'],
      [{ ...SIGNUP_BODY, name: '' }, 'Name'],
      [{ ...SIGNUP_BODY, email: 'not-an-email' }, 'email'],
      [{ ...SIGNUP_BODY, password: '12345' }, 'Password'],
      [{ ...SIGNUP_BODY, password: '' }, 'Password'],
      [{ ...SIGNUP_BODY, phone: 'abc' }, 'phone'],
      [{ name: 'No Email', password: 'secret123' }, 'email'],
    ];
    for (const [body, label] of cases) {
      const response = await request(app)
        .post('/api/integration/v1/free-user/signup')
        .set(serviceAuthHeader)
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.message.toLowerCase()).toContain(label.toLowerCase());
    }
    // Nothing was created by any of the invalid attempts.
    const count = await User.countDocuments({});
    expect(count).toBe(0);
  });

  it('treats phone as optional', async () => {
    const { phone, ...withoutPhone } = SIGNUP_BODY;
    const response = await request(app)
      .post('/api/integration/v1/free-user/signup')
      .set(serviceAuthHeader)
      .send(withoutPhone);

    expect(response.status).toBe(201);
    const stored = await User.findOne({ email: SIGNUP_BODY.email });
    expect(stored.phone).toBeUndefined();
  });

  it('never creates privileged roles', async () => {
    const response = await request(app)
      .post('/api/integration/v1/free-user/signup')
      .set(serviceAuthHeader)
      .send({ ...SIGNUP_BODY, role: 'admin' });

    // role is ignored entirely (not read from the body) — account is student.
    expect(response.status).toBe(201);
    expect(response.body.user.role).toBe('student');
  });
});
