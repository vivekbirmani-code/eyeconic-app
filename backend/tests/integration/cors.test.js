process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const request = require('supertest');
const express = require('express');
const cors = require('cors');
const {
  PRODUCTION_WEB_ORIGIN,
  createCorsOptions,
} = require('../../config/cors');

const buildCorsApp = () => {
  const app = express();
  app.use(cors(createCorsOptions()));
  app.post('/api/auth/login', (req, res) => {
    res.json({ ok: true });
  });
  return app;
};

describe('CORS configuration', () => {
  const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalAllowedOrigins === undefined) {
      delete process.env.ALLOWED_ORIGINS;
    } else {
      process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('allows OPTIONS preflight from the production web origin', async () => {
    process.env.ALLOWED_ORIGINS = PRODUCTION_WEB_ORIGIN;
    const app = buildCorsApp();

    const response = await request(app)
      .options('/api/auth/login')
      .set('Origin', PRODUCTION_WEB_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set(
        'Access-Control-Request-Headers',
        'content-type,authorization,x-request-id'
      );

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(
      PRODUCTION_WEB_ORIGIN
    );
    expect(response.headers['access-control-allow-methods']).toMatch(/POST/);
    expect(response.headers['access-control-allow-headers']).toMatch(
      /authorization/i
    );
  });

  it('allows POST responses for the production web origin', async () => {
    process.env.ALLOWED_ORIGINS = PRODUCTION_WEB_ORIGIN;
    const app = buildCorsApp();

    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', PRODUCTION_WEB_ORIGIN)
      .send({ email: 'test@example.com', password: 'secret' });

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(
      PRODUCTION_WEB_ORIGIN
    );
  });

  it('rejects disallowed browser origins', async () => {
    process.env.ALLOWED_ORIGINS = PRODUCTION_WEB_ORIGIN;
    const app = buildCorsApp();

    const response = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'https://malicious.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(response.status).toBe(500);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('includes localhost origins in non-production defaults', async () => {
    delete process.env.ALLOWED_ORIGINS;
    process.env.NODE_ENV = 'development';
    const app = buildCorsApp();

    const response = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173'
    );
  });
});
