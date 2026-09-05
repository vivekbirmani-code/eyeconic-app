process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const request = require('supertest');
const express = require('express');
const requestId = require('../../middleware/requestId');
const healthRoutes = require('../../routes/health');

const originalEnv = { ...process.env };

const buildHealthApp = () => {
  const app = express();
  app.use(requestId);
  app.use('/health', healthRoutes);
  return app;
};

/**
 * GET /health must surface the SMS provider state so a misconfigured
 * production deployment (missing TWO_FACTOR_API_KEY — every guest OTP send
 * fails with 503 SMS_NOT_CONFIGURED) is visible without dashboard access.
 */
describe('health endpoint SMS dependency', () => {
  let app;

  beforeEach(() => {
    delete process.env.TWO_FACTOR_API_KEY;
    delete process.env.TWO_FACTOR_OTP_TEMPLATE;
    process.env.NODE_ENV = 'development';
    app = buildHealthApp();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reports the dev console mock as healthy when no provider is configured', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.dependencies.sms).toEqual({
      status: 'healthy',
      provider: 'console',
      configured: false,
    });
  });

  it('reports 2factor as configured and healthy when the API key is set', async () => {
    process.env.TWO_FACTOR_API_KEY = 'test-key';
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.dependencies.sms).toEqual({
      status: 'healthy',
      provider: '2factor',
      configured: true,
    });
  });

  it('reports unconfigured SMS in production, marking the service degraded', async () => {
    process.env.NODE_ENV = 'production';
    const response = await request(app).get('/health');

    // HTTP stays 200 (Render health checks must pass) — the payload says so.
    expect(response.status).toBe(200);
    expect(response.body.dependencies.sms).toEqual({
      status: 'unconfigured',
      provider: null,
      configured: false,
    });
    expect(response.body.ready).toBe(false);
    expect(response.body.status).toBe('degraded');
  });

  it('reports configured SMS in production without degrading for SMS', async () => {
    process.env.NODE_ENV = 'production';
    process.env.TWO_FACTOR_API_KEY = 'test-key';
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.dependencies.sms).toEqual({
      status: 'healthy',
      provider: '2factor',
      configured: true,
    });
  });
});
