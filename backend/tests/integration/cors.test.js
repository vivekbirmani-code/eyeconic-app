process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const request = require('supertest');
const express = require('express');
const cors = require('cors');
const {
  PRODUCTION_WEB_ORIGIN,
  createCorsOptions,
  getAllowedOrigins,
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
  const originalWebAppUrl = process.env.WEB_APP_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalAllowedOrigins === undefined) {
      delete process.env.ALLOWED_ORIGINS;
    } else {
      process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
    }
    if (originalWebAppUrl === undefined) {
      delete process.env.WEB_APP_URL;
    } else {
      process.env.WEB_APP_URL = originalWebAppUrl;
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

  it('derives an extra allowed origin from WEB_APP_URL alongside ALLOWED_ORIGINS', () => {
    // Production shape: ALLOWED_ORIGINS pinned to the admin origin, the
    // public quiz web app living on a Render static site.
    process.env.ALLOWED_ORIGINS = PRODUCTION_WEB_ORIGIN;
    process.env.WEB_APP_URL = 'https://eyeconic-public-web.onrender.com';

    expect(getAllowedOrigins()).toEqual([
      PRODUCTION_WEB_ORIGIN,
      'https://eyeconic-public-web.onrender.com',
    ]);
  });

  it('accepts a scheme-less WEB_APP_URL host (as pasted from the Render dashboard)', () => {
    process.env.ALLOWED_ORIGINS = PRODUCTION_WEB_ORIGIN;
    process.env.WEB_APP_URL = 'eyeconic-public-web.onrender.com';

    expect(getAllowedOrigins()).toContain('https://eyeconic-public-web.onrender.com');
  });

  it('serves preflights from the WEB_APP_URL origin (Render-hosted public quiz)', async () => {
    process.env.ALLOWED_ORIGINS = PRODUCTION_WEB_ORIGIN;
    process.env.WEB_APP_URL = 'https://eyeconic-public-web.onrender.com';
    const app = buildCorsApp();

    const response = await request(app)
      .options('/api/public/quiz/some-token/lead/send-otp')
      .set('Origin', 'https://eyeconic-public-web.onrender.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(
      'https://eyeconic-public-web.onrender.com'
    );
  });

  it('ignores an unparseable WEB_APP_URL instead of breaking the origin list', () => {
    process.env.ALLOWED_ORIGINS = PRODUCTION_WEB_ORIGIN;
    process.env.WEB_APP_URL = 'not a valid url %%';

    expect(getAllowedOrigins()).toEqual([PRODUCTION_WEB_ORIGIN]);
  });
});
