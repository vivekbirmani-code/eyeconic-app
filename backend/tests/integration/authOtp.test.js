process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const request = require('supertest');
const express = require('express');
const db = require('../helpers/db');
const requestId = require('../../middleware/requestId');
const errorHandler = require('../../middleware/errorHandler');
const authRoutes = require('../../routes/auth');
const Otp = require('../../models/Otp');

jest.mock('../../utils/mailer', () => ({
  EmailDeliveryError: class EmailDeliveryError extends Error {
    constructor(message, code = 'EMAIL_DELIVERY_FAILED') {
      super(message);
      this.name = 'EmailDeliveryError';
      this.statusCode = 503;
      this.code = code;
      this.expose = true;
    }
  },
  EMAIL_DELIVERY_USER_MESSAGE:
    'Unable to send verification code right now. Please try again in a moment.',
  sendOtpMail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetMail: jest.fn().mockResolvedValue(undefined),
}));

const { sendOtpMail, sendPasswordResetMail, EmailDeliveryError } = require('../../utils/mailer');

function buildAuthApp() {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data.',
        code: 'INVALID_JSON',
        requestId: req.requestId,
      });
    }
    return next(err);
  });
  app.use('/api/auth', authRoutes);
  app.use(errorHandler);
  return app;
}

let app;

beforeAll(async () => {
  await db.connect();
  app = buildAuthApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

beforeEach(async () => {
  await db.clearDatabase();
  sendOtpMail.mockClear();
  sendPasswordResetMail.mockClear();
  sendOtpMail.mockResolvedValue(undefined);
  sendPasswordResetMail.mockResolvedValue(undefined);
});

describe('Auth OTP endpoints', () => {
  it('POST /api/auth/send-otp accepts valid JSON and stores OTP after email send', async () => {
    const response = await request(app)
      .post('/api/auth/send-otp')
      .set('Content-Type', 'application/json')
      .send({ email: 'newuser@example.com' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(sendOtpMail).toHaveBeenCalledTimes(1);

    const otpRecord = await Otp.findOne({ email: 'newuser@example.com' });
    expect(otpRecord).not.toBeNull();
    expect(otpRecord.otp).toMatch(/^\d{6}$/);
  });

  it('POST /api/auth/send-otp returns 400 for malformed JSON', async () => {
    const response = await request(app)
      .post('/api/auth/send-otp')
      .set('Content-Type', 'application/json')
      .send("{email: 'bad-json'}");

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Invalid request data.',
      code: 'INVALID_JSON',
    });
    expect(sendOtpMail).not.toHaveBeenCalled();
  });

  it('POST /api/auth/send-otp returns 400 when email is missing', async () => {
    const response = await request(app)
      .post('/api/auth/send-otp')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/email address is required/i);
  });

  it('POST /api/auth/send-otp returns 503 when email delivery fails', async () => {
    sendOtpMail.mockRejectedValueOnce(
      new EmailDeliveryError(
        'Unable to send verification code right now. Please try again in a moment.',
        'EMAIL_DELIVERY_FAILED'
      )
    );

    const response = await request(app)
      .post('/api/auth/send-otp')
      .send({ email: 'delivery-failure@example.com' });

    expect(response.status).toBe(503);
    expect(response.body.message).toMatch(/unable to send verification code/i);
    expect(await Otp.findOne({ email: 'delivery-failure@example.com' })).toBeNull();
  });

  it('POST /api/auth/signup verifies OTP and deletes it after success', async () => {
    await Otp.create({ email: 'signup@example.com', otp: '123456', createdAt: new Date() });

    const response = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Signup User',
        email: 'signup@example.com',
        password: 'password123',
        otp: '123456',
      });

    expect(response.status).toBe(201);
    expect(response.body.token).toBeDefined();
    expect(await Otp.findOne({ email: 'signup@example.com' })).toBeNull();
  });

  it('POST /api/auth/forgot-password-send-otp sends reset email for existing users', async () => {
    const User = require('../../models/User');
    await User.create({
      name: 'Existing User',
      email: 'existing@example.com',
      password: 'password123',
      role: 'student',
    });

    const response = await request(app)
      .post('/api/auth/forgot-password-send-otp')
      .send({ email: 'existing@example.com' });

    expect(response.status).toBe(200);
    expect(sendPasswordResetMail).toHaveBeenCalledTimes(1);
  });
});
