process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../helpers/db');
const requestId = require('../../middleware/requestId');
const errorHandler = require('../../middleware/errorHandler');
const featureGate = require('../../middleware/featureGate');
const settingsRoutes = require('../../routes/settings');
const User = require('../../models/User');
const { isProctoringEnabled } = require('../../utils/appSettings');

/**
 * Phase 9 kill-switch operator surface (plan §31): while the quiz-only
 * feature freeze stands, the admin API for the AI-proctoring emergency kill
 * switch (PUT /api/settings/proctoring-enabled) must stay reachable —
 * allowlisted narrowly in config/featureAvailability.js. This suite mounts
 * the settings router EXACTLY like server.js does (behind the real
 * featureGate) and proves: admin-only authorization, strict validation,
 * per-field isolation, fail-closed reads, and that every other settings
 * toggle stays frozen. The §31 SEMANTICS of flipping the switch (new-session
 * surfaces 503, in-flight attempts immune) are covered by
 * proctoringSecurity.test.js and proctoringFoundation.test.js.
 */

function buildFrozenSettingsApp() {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  // Mirror of server.js:
  // app.use('/api/settings', featureGate('userManagement', 'settings'), settingsRoutes)
  app.use(
    '/api/settings',
    featureGate('userManagement', 'settings'),
    settingsRoutes
  );
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
  app = buildFrozenSettingsApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

beforeEach(async () => {
  await db.clearDatabase();
});

describe('Kill-switch operator surface under the feature freeze', () => {
  it('reads fail-closed: no settings document means the switch is OFF', async () => {
    const { token } = await createUserWithToken('admin');
    const response = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      proctoringEnabled: false,
    });
  });

  it('unauthenticated calls reach auth (401), not the freeze (503)', async () => {
    const put = await request(app)
      .put('/api/settings/proctoring-enabled')
      .send({ proctoringEnabled: true });
    const get = await request(app).get('/api/settings');

    expect(put.status).toBe(401);
    expect(get.status).toBe(401);
    expect(await isProctoringEnabled()).toBe(false);
  });

  it('is admin-only: students and mentors are rejected 403 and change nothing', async () => {
    for (const role of ['student', 'mentor']) {
      const { token } = await createUserWithToken(role);
      const response = await request(app)
        .put('/api/settings/proctoring-enabled')
        .set('Authorization', `Bearer ${token}`)
        .send({ proctoringEnabled: true });

      expect(response.status).toBe(403);
      expect(await isProctoringEnabled()).toBe(false);
    }
  });

  it('an admin toggles the kill switch on and back off; state and echo agree', async () => {
    const { user, token } = await createUserWithToken('admin');

    const on = await request(app)
      .put('/api/settings/proctoring-enabled')
      .set('Authorization', `Bearer ${token}`)
      .send({ proctoringEnabled: true });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ success: true, proctoringEnabled: true });
    expect(await isProctoringEnabled()).toBe(true);
    expect(on.body.updatedBy).toBe(user._id.toString());

    const off = await request(app)
      .put('/api/settings/proctoring-enabled')
      .set('Authorization', `Bearer ${token}`)
      .send({ proctoringEnabled: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ success: true, proctoringEnabled: false });
    expect(await isProctoringEnabled()).toBe(false);
  });

  it('rejects non-boolean payloads with 400 VALIDATION_ERROR and changes nothing', async () => {
    const { token } = await createUserWithToken('admin');

    for (const body of [
      {},
      { proctoringEnabled: 'true' },
      { proctoringEnabled: 1 },
    ]) {
      const response = await request(app)
        .put('/api/settings/proctoring-enabled')
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(await isProctoringEnabled()).toBe(false);
  });

  it('is isolated to its own field: a smuggled signUpEnabled in the body is ignored', async () => {
    const { token } = await createUserWithToken('admin');

    const response = await request(app)
      .put('/api/settings/proctoring-enabled')
      .set('Authorization', `Bearer ${token}`)
      .send({ proctoringEnabled: true, signUpEnabled: true });
    expect(response.status).toBe(200);

    const state = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(state.body.proctoringEnabled).toBe(true);
    expect(state.body.signUpEnabled).toBe(false); // untouched by the proctoring toggle
  });

  it('keeps every other settings toggle frozen (503 FEATURE_DISABLED)', async () => {
    const { token } = await createUserWithToken('admin');

    const signUp = await request(app)
      .put('/api/settings/signup-enabled')
      .set('Authorization', `Bearer ${token}`)
      .send({ signUpEnabled: true });
    const strictCv = await request(app)
      .put('/api/settings/proctoring-strict-cv')
      .set('Authorization', `Bearer ${token}`)
      .send({ proctoringStrictCv: true });

    expect(signUp.status).toBe(503);
    expect(signUp.body).toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(strictCv.status).toBe(503);
    expect(strictCv.body).toMatchObject({ code: 'FEATURE_DISABLED' });
  });
});
