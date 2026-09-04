process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../helpers/db');
const requestId = require('../../middleware/requestId');
const errorHandler = require('../../middleware/errorHandler');
const authRoutes = require('../../routes/auth');
const settingsRoutes = require('../../routes/settings');
const User = require('../../models/User');
const Otp = require('../../models/Otp');

jest.mock('../../utils/mailer', () => ({
  EmailDeliveryError: class EmailDeliveryError extends Error {},
  EMAIL_DELIVERY_USER_MESSAGE:
    'Unable to send verification code right now. Please try again in a moment.',
  sendOtpMail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetMail: jest.fn().mockResolvedValue(undefined),
}));

const { sendOtpMail } = require('../../utils/mailer');

function buildToggleApp() {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use(errorHandler);
  return app;
}

let app;

const createUserWithToken = async (role) => {
  const user = await User.create({
    name: `${role} User`,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'password123',
    role,
  });
  const token = jwt.sign(
    { userId: user._id.toString(), role: user.role },
    process.env.JWT_SECRET
  );
  return { user, token };
};

beforeAll(async () => {
  await db.connect();
  app = buildToggleApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

beforeEach(async () => {
  await db.clearDatabase();
  sendOtpMail.mockClear();
  sendOtpMail.mockResolvedValue(undefined);
});

describe('Sign-up toggle — default state', () => {
  it('GET /api/settings/public reports signUpEnabled false with no settings document', async () => {
    const response = await request(app).get('/api/settings/public');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, signUpEnabled: false });
  });

  it('POST /api/auth/send-otp is blocked with 403 SIGNUP_DISABLED by default', async () => {
    const response = await request(app)
      .post('/api/auth/send-otp')
      .send({ email: 'someone@example.com' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'SIGNUP_DISABLED' });
    expect(sendOtpMail).not.toHaveBeenCalled();
    expect(await Otp.findOne({ email: 'someone@example.com' })).toBeNull();
  });

  it('POST /api/auth/signup is blocked even when a valid OTP already exists', async () => {
    // An OTP could have been issued before the admin turned sign-up off —
    // the second gate on /signup must still reject the registration.
    await Otp.create({ email: 'stale-otp@example.com', otp: '123456', createdAt: new Date() });

    const response = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Stale Otp',
        email: 'stale-otp@example.com',
        password: 'password123',
        otp: '123456',
      });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'SIGNUP_DISABLED' });
    expect(await User.findOne({ email: 'stale-otp@example.com' })).toBeNull();
  });

  it('POST /api/auth/login still works for existing users while sign-up is off', async () => {
    await User.create({
      name: 'Existing Student',
      email: 'existing@example.com',
      password: 'password123',
      role: 'student',
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'existing@example.com', password: 'password123' });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
  });

  it('POST /api/auth/forgot-password-send-otp still works while sign-up is off', async () => {
    await User.create({
      name: 'Reset Student',
      email: 'reset@example.com',
      password: 'password123',
      role: 'student',
    });

    const response = await request(app)
      .post('/api/auth/forgot-password-send-otp')
      .send({ email: 'reset@example.com' });

    expect(response.status).toBe(200);
  });
});

describe('Sign-up toggle — permissions', () => {
  it('PUT /api/settings/signup-enabled requires authentication', async () => {
    const response = await request(app)
      .put('/api/settings/signup-enabled')
      .send({ signUpEnabled: true });

    expect(response.status).toBe(401);
  });

  it.each(['student', 'mentor'])(
    'PUT /api/settings/signup-enabled rejects %s role with 403',
    async (role) => {
      const { token } = await createUserWithToken(role);

      const response = await request(app)
        .put('/api/settings/signup-enabled')
        .set('Authorization', `Bearer ${token}`)
        .send({ signUpEnabled: true });

      expect(response.status).toBe(403);
      expect(response.body.signUpEnabled).toBeUndefined();
    }
  );

  it('PUT /api/settings/signup-enabled rejects non-boolean values', async () => {
    const { token } = await createUserWithToken('admin');

    const response = await request(app)
      .put('/api/settings/signup-enabled')
      .set('Authorization', `Bearer ${token}`)
      .send({ signUpEnabled: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('GET /api/settings (full) requires admin', async () => {
    const { token } = await createUserWithToken('student');

    const response = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });
});

describe('Sign-up toggle — admin lifecycle', () => {
  it('admin can enable sign-up, users can sign up, admin can disable again', async () => {
    const { token: adminToken } = await createUserWithToken('admin');

    // Enable
    const enableResponse = await request(app)
      .put('/api/settings/signup-enabled')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ signUpEnabled: true });

    expect(enableResponse.status).toBe(200);
    expect(enableResponse.body).toMatchObject({ success: true, signUpEnabled: true });
    expect(enableResponse.body.updatedAt).toBeDefined();

    // Public endpoint reflects it
    const publicResponse = await request(app).get('/api/settings/public');
    expect(publicResponse.body).toMatchObject({ signUpEnabled: true });

    // Signup flow works end to end
    const otpResponse = await request(app)
      .post('/api/auth/send-otp')
      .send({ email: 'newstudent@example.com' });
    expect(otpResponse.status).toBe(200);
    expect(sendOtpMail).toHaveBeenCalledTimes(1);

    const otpRecord = await Otp.findOne({ email: 'newstudent@example.com' });
    expect(otpRecord).not.toBeNull();

    const signupResponse = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'New Student',
        email: 'newstudent@example.com',
        password: 'password123',
        otp: otpRecord.otp,
      });

    expect(signupResponse.status).toBe(201);
    expect(signupResponse.body.user).toMatchObject({
      email: 'newstudent@example.com',
      role: 'student',
      isFreeUser: true,
    });

    // Disable
    const disableResponse = await request(app)
      .put('/api/settings/signup-enabled')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ signUpEnabled: false });

    expect(disableResponse.status).toBe(200);
    expect(disableResponse.body).toMatchObject({ signUpEnabled: false });

    // Sign-up blocked again, but the just-created user can still log in
    const blockedResponse = await request(app)
      .post('/api/auth/send-otp')
      .send({ email: 'another@example.com' });
    expect(blockedResponse.status).toBe(403);
    expect(blockedResponse.body).toMatchObject({ code: 'SIGNUP_DISABLED' });

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: 'newstudent@example.com', password: 'password123' });
    expect(loginResponse.status).toBe(200);
  });

  it('admin GET /api/settings returns the full settings document', async () => {
    const { user, token } = await createUserWithToken('admin');

    await request(app)
      .put('/api/settings/signup-enabled')
      .set('Authorization', `Bearer ${token}`)
      .send({ signUpEnabled: true });

    const response = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, signUpEnabled: true });
    expect(response.body.updatedBy).toBe(String(user._id));
  });
});
