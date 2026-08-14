const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const MentorStudentAssignment = require('../../models/MentorStudentAssignment');
const Assignment = require('../../models/Assignment');

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

describe('Admin overview mentor details', () => {
  it('returns mentor stats with empty students for mentors without assignments', async () => {
    const admin = await createUser({ role: 'admin', name: 'Admin User' });
    const mentor = await createUser({
      role: 'mentor',
      name: 'Dr. Sharma',
      email: 'mentor@neet.com',
    });

    const response = await request(app)
      .get(`/api/admin-overview/mentor/${mentor.user._id}/details`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
    expect(response.body.mentor).toMatchObject({
      name: 'Dr. Sharma',
      email: 'mentor@neet.com',
    });
    expect(response.body.stats).toEqual({
      assignedStudents: 0,
      totalAssignments: 0,
      verifiedThisWeek: 0,
      avgStudentCompletionRate: 0,
    });
    expect(response.body.students).toEqual([]);
  });

  it('returns assigned students and assignment stats for mentors with active students', async () => {
    const admin = await createUser({ role: 'admin', name: 'Admin User' });
    const mentor = await createUser({ role: 'mentor', name: 'Mentor One' });
    const student = await createUser({ role: 'student', name: 'Student One' });
    const subject = await createSubject('Anatomy');

    await MentorStudentAssignment.create({
      mentor: mentor.user._id,
      student: student.user._id,
      assignedBy: admin.user._id,
      isActive: true,
    });

    await Assignment.create({
      title: 'Cell Biology Review',
      subject: subject._id,
      student: student.user._id,
      mentor: mentor.user._id,
      taskType: 'Main Video',
      duration: 60,
      scheduledDate: new Date(),
      status: 'verified',
      verifiedAt: new Date(),
    });

    const response = await request(app)
      .get(`/api/admin-overview/mentor/${mentor.user._id}/details`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
    expect(response.body.stats.assignedStudents).toBe(1);
    expect(response.body.stats.totalAssignments).toBe(1);
    expect(response.body.stats.verifiedThisWeek).toBe(1);
    expect(response.body.students).toHaveLength(1);
    expect(response.body.students[0].student).toMatchObject({
      name: 'Student One',
    });
    expect(response.body.students[0].stats).toMatchObject({
      total: 1,
      verified: 1,
      pending: 0,
    });
  });

  it('rejects non-admin access', async () => {
    const mentor = await createUser({ role: 'mentor', name: 'Mentor One' });
    const student = await createUser({ role: 'student', name: 'Student One' });

    const response = await request(app)
      .get(`/api/admin-overview/mentor/${mentor.user._id}/details`)
      .set('Authorization', `Bearer ${student.token}`);

    expect(response.status).toBe(403);
  });
});
