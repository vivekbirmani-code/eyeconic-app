process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');
const requestId = require('../../middleware/requestId');
const errorHandler = require('../../middleware/errorHandler');
const featureGate = require('../../middleware/featureGate');
const {
  FEATURE_AVAILABILITY,
  getQuizWorkflowAllowlist,
} = require('../../config/featureAvailability');

/**
 * The freeze is hand-mirrored across backend/mobile/web flag files. This
 * drift alarm fails when a feature key shared by two files is flipped in
 * only one of them — the exact mistake the re-enable step invites.
 */
const parseFlagFile = (relativePath) => {
  // Walk up from this test file to the repo root (the directory containing
  // the mobile utils/ flag file) — cwd and jest's __dirname mapping vary.
  let root = __dirname;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(root, 'utils', 'featureAvailability.ts'))) break;
    root = path.dirname(root);
  }
  const src = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const flags = {};
  const re = /^[ \t]+(\w+):[ \t]*(true|false)\b/gm;
  let match;
  while ((match = re.exec(src))) {
    flags[match[1]] = match[2] === 'true';
  }
  return flags;
};

/**
 * Mirrors how server.js mounts frozen routers: featureGate in front of an
 * express router, with Quiz-workflow dependencies allowlisted per router in
 * config/featureAvailability.js.
 */
function buildGatedApp() {
  const app = express();
  app.use(requestId);

  // Stand-in routers shaped like the real frozen ones.
  const groupsRouter = express.Router();
  groupsRouter.get('/', (req, res) => res.json([{ _id: 'group-1' }]));
  groupsRouter.get('/:id', (req, res) => res.json({ _id: req.params.id }));
  groupsRouter.post('/', (req, res) => res.status(201).json({ created: true }));

  const usersRouter = express.Router();
  usersRouter.get('/', (req, res) => res.json([{ _id: 'user-1' }]));
  usersRouter.get('/role/:role', (req, res) => res.json([req.params.role]));
  usersRouter.put('/profile', (req, res) => res.json({ updated: true }));
  usersRouter.post('/', (req, res) => res.status(201).json({ created: true }));
  usersRouter.put('/:id', (req, res) => res.json({ updated: req.params.id }));
  usersRouter.post('/:id/reset-password', (req, res) => res.json({ reset: true }));

  const messagesRouter = express.Router();
  messagesRouter.get('/group/:groupId', (req, res) => res.json([]));

  app.use('/api/groups', featureGate('chat', 'groups'), groupsRouter);
  app.use('/api/users', featureGate('userManagement', 'users'), usersRouter);
  app.use('/api/messages', featureGate('chat'), messagesRouter);
  app.use(errorHandler);
  return app;
}

describe('Temporary feature freeze gate', () => {
  const app = buildGatedApp();

  describe('config invariants', () => {
    it('keeps the quiz ecosystem enabled', () => {
      expect(FEATURE_AVAILABILITY.quizzes).toBe(true);
    });

    it('has an allowlist entry for every frozen router it applies to', () => {
      // Routers mounted with a router-name allowlist in server.js must exist
      // in the config so their Quiz dependencies stay reachable.
      ['users', 'groups', 'assignments', 'upload', 'settings'].forEach(
        (routerName) => {
          expect(Array.isArray(getQuizWorkflowAllowlist(routerName))).toBe(true);
        }
      );
    });

    it('mirrors the same flags in the mobile and web clients (drift alarm)', () => {
      const mobile = parseFlagFile('utils/featureAvailability.ts');
      const web = parseFlagFile(path.join('client', 'src', 'config', 'features.ts'));

      expect(mobile.quizzes).toBe(true);
      expect(web.quizzes).toBe(true);

      [mobile, web].forEach((client) => {
        Object.keys(FEATURE_AVAILABILITY).forEach((key) => {
          if (key in client) {
            expect({ file: client === mobile ? 'mobile' : 'web', key, value: client[key] })
              .toEqual({ file: client === mobile ? 'mobile' : 'web', key, value: FEATURE_AVAILABILITY[key] });
          }
        });
      });
    });
  });

  describe('quiz-workflow dependencies stay reachable', () => {
    it('GET /api/groups (quiz assignment + share pickers) is allowed', async () => {
      const response = await request(app).get('/api/groups');
      expect(response.status).toBe(200);
    });

    it('GET /api/users?role=student (quiz pickers + analytics) is allowed', async () => {
      const response = await request(app).get('/api/users?role=student');
      expect(response.status).toBe(200);
    });

    it('GET /api/users/role/:role (mobile create-quiz picker) is allowed', async () => {
      const response = await request(app).get('/api/users/role/mentor');
      expect(response.status).toBe(200);
    });

    it('PUT /api/users/profile (student profile completion) is allowed', async () => {
      const response = await request(app).put('/api/users/profile').send({});
      expect(response.status).toBe(200);
    });
  });

  describe('frozen endpoints answer 503 FEATURE_DISABLED', () => {
    const expectDisabled = (response, feature) => {
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        code: 'FEATURE_DISABLED',
        feature,
      });
      expect(response.body.message).toMatch(/temporarily unavailable/i);
      expect(response.body.requestId).toBeDefined();
    };

    it('POST /api/groups (create group) is blocked', async () => {
      const response = await request(app).post('/api/groups').send({});
      expectDisabled(response, 'chat');
    });

    it('GET /api/groups/:id (group detail) is blocked', async () => {
      const response = await request(app).get('/api/groups/group-1');
      expectDisabled(response, 'chat');
    });

    it('chat messages are blocked entirely (no quiz dependencies)', async () => {
      const response = await request(app).get('/api/messages/group/group-1');
      expectDisabled(response, 'chat');
    });

    it('POST /api/users (create user) is blocked', async () => {
      const response = await request(app).post('/api/users').send({});
      expectDisabled(response, 'userManagement');
    });

    it('PUT /api/users/:id (edit user) is blocked', async () => {
      const response = await request(app).put('/api/users/user-1').send({});
      expectDisabled(response, 'userManagement');
    });

    it('POST /api/users/:id/reset-password is blocked', async () => {
      const response = await request(app).post('/api/users/user-1/reset-password');
      expectDisabled(response, 'userManagement');
    });
  });

  describe('path matching', () => {
    it('does not treat /api/users/<id> as the allowlisted GET /api/users', async () => {
      const response = await request(app).get('/api/users/user-1');
      expect(response.status).toBe(503);
    });

    it('tolerates trailing slashes on allowlisted paths', async () => {
      const response = await request(app).get('/api/users/role/mentor/');
      expect(response.status).toBe(200);
    });
  });
});
