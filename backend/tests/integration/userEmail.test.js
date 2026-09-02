const request = require('supertest');
const mongoose = require('mongoose');
const db = require('../helpers/db');
const { buildApp, createUser } = require('../helpers/testApp');
const User = require('../../models/User');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

beforeEach(async () => {
  await db.clearDatabase();
});

describe('Admin user email update API', () => {
  it('updates a user email for admins and normalizes it', async () => {
    const admin = await createUser({ role: 'admin' });
    const student = await createUser({ role: 'student', name: 'Rahul Kumar' });

    const response = await request(app)
      .put(`/api/users/${student.user._id}/email`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: '  Rahul.Kumar@Example.com  ' });

    expect(response.status).toBe(200);
    expect(response.body.email).toBe('rahul.kumar@example.com');
    expect(response.body.password).toBeUndefined();

    const updated = await User.findById(student.user._id);
    expect(updated.email).toBe('rahul.kumar@example.com');
  });

  it('rejects an invalid email address', async () => {
    const admin = await createUser({ role: 'admin' });
    const student = await createUser({ role: 'student' });

    const response = await request(app)
      .put(`/api/users/${student.user._id}/email`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'not-an-email' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Please enter a valid email address.');
  });

  it('rejects a missing email', async () => {
    const admin = await createUser({ role: 'admin' });
    const student = await createUser({ role: 'student' });

    const response = await request(app)
      .put(`/api/users/${student.user._id}/email`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Please enter a valid email address.');
  });

  it('rejects saving the same email', async () => {
    const admin = await createUser({ role: 'admin' });
    const student = await createUser({ role: 'student', email: 'same@example.com' });

    const response = await request(app)
      .put(`/api/users/${student.user._id}/email`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'same@example.com' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('New email is the same as the current email.');
  });

  it('rejects an email already used by another user', async () => {
    const admin = await createUser({ role: 'admin' });
    const student = await createUser({ role: 'student' });
    const other = await createUser({ role: 'mentor', email: 'taken@example.com' });

    const response = await request(app)
      .put(`/api/users/${student.user._id}/email`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'TAKEN@example.com' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('This email is already in use by another user.');

    // Target user keeps the old email
    const unchanged = await User.findById(student.user._id);
    expect(unchanged.email).toBe(student.user.email);
    expect(other).toBeDefined();
  });

  it('returns 404 when the target user does not exist', async () => {
    const admin = await createUser({ role: 'admin' });

    const response = await request(app)
      .put(`/api/users/${new mongoose.Types.ObjectId()}/email`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'fresh@example.com' });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('User not found');
  });

  it('rejects non-admin callers', async () => {
    const mentor = await createUser({ role: 'mentor' });
    const student = await createUser({ role: 'student' });

    const response = await request(app)
      .put(`/api/users/${student.user._id}/email`)
      .set('Authorization', `Bearer ${mentor.token}`)
      .send({ email: 'hijack@example.com' });

    expect(response.status).toBe(403);

    const unchanged = await User.findById(student.user._id);
    expect(unchanged.email).toBe(student.user.email);
  });

  it('rejects unauthenticated requests', async () => {
    const student = await createUser({ role: 'student' });

    const response = await request(app)
      .put(`/api/users/${student.user._id}/email`)
      .send({ email: 'anon@example.com' });

    expect(response.status).toBe(401);
  });
});
