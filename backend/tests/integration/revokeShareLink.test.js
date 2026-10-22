const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');

let app;
let admin;
let subject;

const createQuizWithLink = async (title, token) => {
  const quiz = await Quiz.create({
    title,
    subject: subject._id,
    testType: 'daily',
    duration: 10,
    questions: [],
    createdBy: admin.user._id,
    isPublic: true,
    shareToken: token,
    publicExpiryDate: null,
  });
  return quiz;
};

const generateLink = (quizId) =>
  request(app)
    .post(`/api/quizzes/${quizId}/generate-share-link`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({});

const revokeLink = (quizId, token = admin.token) =>
  request(app)
    .post(`/api/quizzes/${quizId}/revoke-share-link`)
    .set('Authorization', `Bearer ${token}`)
    .send({});

beforeAll(async () => {
  await db.connect();
  // Build the schema indexes (incl. the unique sparse shareToken_1) before
  // any write, mirroring the production database where they already exist.
  await Quiz.init();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

beforeEach(async () => {
  await db.clearDatabase();
  admin = await createUser({ role: 'admin' });
  subject = await createSubject('Pathology');
});

describe('POST /api/quizzes/:id/revoke-share-link', () => {
  it('revokes links on MULTIPLE quizzes — the unique sparse shareToken index must not reject a second explicit null (production bug 2026-10-22)', async () => {
    const quizA = await createQuizWithLink('Quiz A', 'token-aaaaaaaaaaaaaaaaaaaaaaaaaaa1');
    const quizB = await createQuizWithLink('Quiz B', 'token-bbbbbbbbbbbbbbbbbbbbbbbbbbb2');

    const first = await revokeLink(quizA._id);
    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);

    // The bug: quiz A's revoke stored shareToken: null (field present), the
    // unique SPARSE index still indexes explicit nulls, so quiz B's null
    // collides with E11000 and the route answers 500 "Server error".
    const second = await revokeLink(quizB._id);
    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);

    // Neither doc may carry an explicit null shareToken — unsetting the field
    // keeps it out of the sparse index entirely.
    const rawA = await Quiz.collection.findOne({ _id: quizA._id });
    const rawB = await Quiz.collection.findOne({ _id: quizB._id });
    expect(rawA.shareToken).toBeUndefined();
    expect(rawB.shareToken).toBeUndefined();
    expect(rawA.isPublic).toBe(false);
    expect(rawB.isPublic).toBe(false);
  });

  it('revocation invalidates the token on every public access path', async () => {
    const quiz = await createQuizWithLink('Public Quiz', 'token-public-access-check-00001');
    const revoke = await revokeLink(quiz._id);
    expect(revoke.status).toBe(200);

    // Legacy backend-hosted link → 302 with ?invalid=1
    const redirect = await request(app).get('/api/public/share/token-public-access-check-00001');
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toContain('?invalid=1');

    // Web landing metadata → 404 QUIZ_NOT_FOUND
    const meta = await request(app).get('/api/public/quiz/token-public-access-check-00001');
    expect(meta.status).toBe(404);

    // Guest attempt start → 404, no new attempt is created (guestId passes
    // the body validation so the revoked-token lookup is what rejects)
    const start = await request(app)
      .post('/api/public/quiz/token-public-access-check-00001/start')
      .send({ guestId: 'device-key-revoked-token-check' });
    expect(start.status).toBe(404);
  });

  it('revoking an already-revoked link is an idempotent no-op', async () => {
    const quiz = await createQuizWithLink('Once Only', 'token-repeat-revoke-check-00000001');

    const first = await revokeLink(quiz._id);
    const second = await revokeLink(quiz._id);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
  });

  it('revoking a quiz that never had a public link succeeds without side effects', async () => {
    const quiz = await Quiz.create({
      title: 'Internal Only',
      subject: subject._id,
      testType: 'daily',
      duration: 10,
      questions: [],
      createdBy: admin.user._id,
    });

    const res = await revokeLink(quiz._id);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const raw = await Quiz.collection.findOne({ _id: quiz._id });
    expect(raw.isPublic).toBe(false);
    expect(raw.shareToken).toBeUndefined();
  });

  it('returns 404 for an unknown quiz id and 400 for a malformed id', async () => {
    const unknown = await revokeLink('507f1f77bcf86cd799439011');
    expect(unknown.status).toBe(404);

    const malformed = await revokeLink('not-an-object-id');
    expect(malformed.status).toBe(400);
  });

  it('enforces admin-only authorization', async () => {
    const quiz = await createQuizWithLink('Guarded Quiz', 'token-auth-guard-check-0000000001');

    const noToken = await request(app).post(`/api/quizzes/${quiz._id}/revoke-share-link`);
    expect(noToken.status).toBe(401);

    const student = await createUser({ role: 'student' });
    const asStudent = await revokeLink(quiz._id, student.token);
    expect(asStudent.status).toBe(403);

    const mentor = await createUser({ role: 'mentor' });
    const asMentor = await revokeLink(quiz._id, mentor.token);
    expect(asMentor.status).toBe(403);

    // Nothing was revoked by the rejected attempts.
    const untouched = await Quiz.findById(quiz._id);
    expect(untouched.isPublic).toBe(true);
    expect(untouched.shareToken).toBe('token-auth-guard-check-0000000001');
  });

  it('preserves quiz data and allows generating a fresh link after revocation', async () => {
    const quiz = await createQuizWithLink('Recycle Link', 'token-regen-check-000000000000001');
    const questionsBefore = (await Quiz.findById(quiz._id)).questions.map(q => String(q));

    const revoke = await revokeLink(quiz._id);
    expect(revoke.status).toBe(200);

    const regenerated = await generateLink(quiz._id);
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.shareToken).toBeTruthy();
    expect(regenerated.body.shareToken).not.toBe('token-regen-check-000000000000001');
    expect(regenerated.body.shareUrl).toContain(regenerated.body.shareToken);

    // Old token dead, new token live.
    const oldMeta = await request(app).get('/api/public/quiz/token-regen-check-000000000000001');
    expect(oldMeta.status).toBe(404);
    const newMeta = await request(app).get(`/api/public/quiz/${regenerated.body.shareToken}`);
    expect(newMeta.status).toBe(200);

    // Quiz content untouched by revoke/regenerate.
    const questionsAfter = (await Quiz.findById(quiz._id)).questions.map(q => String(q));
    expect(questionsAfter).toEqual(questionsBefore);
  });

  it('share-status reflects the revoked state after reopening the Share sheet', async () => {
    const quiz = await createQuizWithLink('Status Quiz', 'token-status-check-000000000000001');

    await revokeLink(quiz._id);

    const status = await request(app)
      .get(`/api/quizzes/${quiz._id}/share-status`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(status.status).toBe(200);
    expect(status.body.isPublic).toBe(false);
    expect(status.body.shareUrl).toBeNull();
    expect(status.body.shareToken).toBeFalsy();
  });
});
