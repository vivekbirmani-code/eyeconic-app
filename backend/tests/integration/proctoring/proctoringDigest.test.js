// Integration tests for the Phase 8 §30.2 observability digest endpoint
// (WS-A / AC-5): admin-only access, day-window scoping, and spot checks that
// each computed dimension reads the data it claims to read. Seeded directly
// through the models (the digest is a read surface — no /start needed).

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('../../helpers/db');
const { buildApp, createUser } = require('../../helpers/testApp');
const ProctoringSession = require('../../../models/ProctoringSession');
const ProctoringEvent = require('../../../models/ProctoringEvent');
const ProctoringViolation = require('../../../models/ProctoringViolation');
const { DIGEST_DIMENSIONS } = require('../../../utils/proctoring/metricsDigest');

let app;
let admin;
let mentor;
let student;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

const oid = () => new mongoose.Types.ObjectId();

const seedSession = (overrides = {}) => {
  const { startedAt = new Date(), ...rest } = overrides;
  return ProctoringSession.create({
    quiz: oid(),
    attempt: oid(),
    student: oid(),
    startedAt,
    ...rest,
  });
};

const seedEvent = (session, type, overrides = {}) => {
  const { serverAt = new Date(), ...rest } = overrides;
  const category = type === 'AUTO_SUBMITTED' ? 'system_action' : 'cv_observation';
  const source = type === 'AUTO_SUBMITTED' ? 'system' : 'cv';
  return ProctoringEvent.create({
    session: session._id,
    attempt: session.attempt,
    quiz: session.quiz,
    type,
    category,
    source,
    openedAt: serverAt,
    closedAt: serverAt,
    serverAt,
    ...rest,
  });
};

const getDigest = (user, query = '') =>
  request(app)
    .get(`/api/quizzes/proctoring-metrics/digest${query}`)
    .set('Authorization', `Bearer ${user.token}`)
    .send();

describe('Phase 8 WS-A — proctoring metrics digest endpoint', () => {
  beforeEach(async () => {
    await db.clearDatabase();
    admin = await createUser({ role: 'admin' });
    mentor = await createUser({ role: 'mentor' });
    student = await createUser({ role: 'student' });
  });

  it('serves an admin the digest with all nine §30.2 dimensions in order', async () => {
    const res = await getDigest(admin);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.digest).toBeDefined();
    expect(Object.keys(res.body.digest.dimensions)).toEqual(DIGEST_DIMENSIONS);
    expect(res.body.digest.totals).toEqual({ sessions: 0, events: 0, violations: 0, autoSubmits: 0 });
  });

  it('refuses non-admins and unauthenticated callers', async () => {
    const mentorRes = await getDigest(mentor);
    expect(mentorRes.status).toBe(403);
    const studentRes = await getDigest(student);
    expect(studentRes.status).toBe(403);

    const guestToken = jwt.sign({ kind: 'guest', guestId: 'g-digest' }, process.env.JWT_SECRET);
    const guestRes = await request(app)
      .get('/api/quizzes/proctoring-metrics/digest')
      .set('Authorization', `Bearer ${guestToken}`)
      .send();
    expect(guestRes.status).toBe(401);

    const anonRes = await request(app).get('/api/quizzes/proctoring-metrics/digest').send();
    expect(anonRes.status).toBe(401);
  });

  it('scopes by day window: days=1 sees only today, days=3 sees the older session too', async () => {
    // 36 h ago is always outside a days=1 window (today 00:00) and always
    // inside days=3 (today 00:00 − 2 days) — robust at any time of day.
    await seedSession({ startedAt: new Date(Date.now() - 36 * 60 * 60 * 1000) });
    await seedSession({ startedAt: new Date() });

    const today = await getDigest(admin, '?days=1');
    expect(today.status).toBe(200);
    expect(today.body.digest.totals.sessions).toBe(1);

    const threeDays = await getDigest(admin, '?days=3');
    expect(threeDays.status).toBe(200);
    expect(threeDays.body.digest.totals.sessions).toBe(2);
  });

  it('computes every spot-check dimension from seeded data', async () => {
    // Fallback calibration → detectorReliability fallbackRate > 0.
    await seedSession({ baseline: { calibration: 'fallback' } });

    // Flood-flagged session → eventAccuracy.floodFlaggedSessions 1.
    await seedSession({ integrity: { floodFlagged: true, batchesRejected: 2 } });

    // Dismissed violation on a FACE_NOT_DETECTED event → per-type FP rate 1.0.
    const dismissedSession = await seedSession();
    const faceEvent = await seedEvent(dismissedSession, 'FACE_NOT_DETECTED');
    await ProctoringViolation.create({
      session: dismissedSession._id,
      attempt: dismissedSession.attempt,
      quiz: dismissedSession.quiz,
      ruleId: 'facePresence.absent',
      reliability: 'probabilistic',
      eventRefs: [faceEvent._id],
      countedAt: new Date(),
      review: { status: 'dismissed' },
    });

    // Auto-submitted + reviewed-confirmed session → upheldRate 1.0.
    const autoSession = await seedSession({ review: { status: 'confirmed' } });
    await seedEvent(autoSession, 'AUTO_SUBMITTED');

    const res = await getDigest(admin, '?days=1');
    expect(res.status).toBe(200);
    const { dimensions, totals } = res.body.digest;

    expect(totals).toMatchObject({ sessions: 4, events: 2, violations: 1, autoSubmits: 1 });
    expect(dimensions.falsePositiveRate.value.perType.FACE_NOT_DETECTED).toMatchObject({
      total: 1, dismissed: 1, rate: 1,
    });
    expect(dimensions.detectorReliability.value.fallbackRate).toBeGreaterThan(0);
    expect(dimensions.cameraFailureRate.value.cameraIncidentEvents).toBe(0);
    expect(dimensions.eventAccuracy.value.floodFlaggedSessions).toBe(1);
    expect(dimensions.eventAccuracy.value.batchesRejectedPer1000Events).toBe(1000);
    expect(dimensions.autoSubmitCorrectness.value.upheldRate).toBe(1);
    expect(dimensions.autoSubmitCorrectness.value.reviewStatusDistribution).toEqual({ confirmed: 1 });
  });
});
