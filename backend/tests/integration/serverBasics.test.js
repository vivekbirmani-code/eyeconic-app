process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const request = require('supertest');
const express = require('express');
const requestId = require('../../middleware/requestId');
const errorHandler = require('../../middleware/errorHandler');
const healthRoutes = require('../../routes/health');

/**
 * Mirrors the public routing layer from server.js (root, health, 404)
 * without sockets, database startup, or full API mounts.
 */
function buildBasicsApp() {
  const app = express();
  app.use(requestId);
  app.use('/health', healthRoutes);
  app.use('/api/health', healthRoutes);

  app.get('/', (req, res) => {
    res.json({
      status: 'ok',
      service: 'eyeconic-api',
    });
  });

  const notFoundResponse = (req, res) => {
    res.status(404).json({
      message: 'The requested resource was not found.',
      code: 'NOT_FOUND',
      requestId: req.requestId,
    });
  };

  app.use('/api', notFoundResponse);
  app.use(notFoundResponse);
  app.use(errorHandler);

  return app;
}

describe('Server public routes', () => {
  const app = buildBasicsApp();

  it('GET / returns service identity JSON', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      service: 'eyeconic-api',
    });
    expect(response.headers['content-type']).toMatch(/json/);
  });

  it('GET /health returns health payload', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.body.service).toBe('eyeconic-api');
    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('dependencies');
  });

  it('GET /api/health mirrors /health', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.body.service).toBe('eyeconic-api');
  });

  it('GET /api/unknown returns JSON 404', async () => {
    const response = await request(app).get('/api/unknown-route');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      message: 'The requested resource was not found.',
      code: 'NOT_FOUND',
    });
    expect(response.body.requestId).toBeDefined();
  });

  it('GET /unknown returns JSON 404 instead of HTML', async () => {
    const response = await request(app).get('/unknown-route');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      message: 'The requested resource was not found.',
      code: 'NOT_FOUND',
    });
    expect(response.headers['content-type']).toMatch(/json/);
  });
});
