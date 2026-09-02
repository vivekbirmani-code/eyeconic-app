const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser } = require('../helpers/testApp');
const Subject = require('../../models/Subject');
const Group = require('../../models/Group');

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

const createSubjects = async (names) =>
  Promise.all(
    names.map((name, index) =>
      Subject.create({ name, year: '1st', displayOrder: index + 1 })
    )
  );

const ids = (subjects) => subjects.map((s) => s._id.toString());

const namesOf = (subjects) => subjects.map((s) => s.name).sort();

const assignSubjects = (app, token, studentId, subjectIds) =>
  request(app)
    .post(`/api/student-subjects/${studentId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ subjectIds });

const fetchGroupSubjects = (app, token, groupId) =>
  request(app)
    .get(`/api/groups/${groupId}/student-subjects`)
    .set('Authorization', `Bearer ${token}`);

/**
 * Creates a group with an admin (creator), a mentor and two students.
 */
async function createGroupWithStudents() {
  const admin = await createUser({ role: 'admin', name: 'Admin User' });
  const mentor = await createUser({ role: 'mentor', name: 'Dr. Sharma' });
  const studentA = await createUser({ role: 'student', name: 'Student A' });
  const studentB = await createUser({ role: 'student', name: 'Student B' });
  const outsider = await createUser({ role: 'mentor', name: 'Outsider Mentor' });

  const group = await Group.create({
    name: 'Batch A',
    type: 'general',
    members: [admin.user._id, mentor.user._id, studentA.user._id, studentB.user._id],
    createdBy: admin.user._id,
  });

  return { admin, mentor, studentA, studentB, outsider, group };
}

describe('GET /api/groups/:id/student-subjects', () => {
  it('returns each student member subjects keyed by student id', async () => {
    const { admin, studentA, studentB, group } = await createGroupWithStudents();
    const subjectsA = await createSubjects(['ANATOMY', 'PHYSIOLOGY']);
    const subjectsB = await createSubjects(['SURGERY', 'MEDICINE']);

    await assignSubjects(app, admin.token, studentA.user._id, ids(subjectsA));
    await assignSubjects(app, admin.token, studentB.user._id, ids(subjectsB));

    const response = await fetchGroupSubjects(app, admin.token, group._id);

    expect(response.status).toBe(200);
    const { subjectsByStudent } = response.body;
    expect(Object.keys(subjectsByStudent).sort()).toEqual(
      [studentA.user._id.toString(), studentB.user._id.toString()].sort()
    );
    // Per-student isolation: no cross-contamination between students.
    expect(namesOf(subjectsByStudent[studentA.user._id])).toEqual(['ANATOMY', 'PHYSIOLOGY']);
    expect(namesOf(subjectsByStudent[studentB.user._id])).toEqual(['MEDICINE', 'SURGERY']);
  });

  it('returns all subjects when a student is assigned every subject', async () => {
    const { admin, studentA, group } = await createGroupWithStudents();
    const allSubjects = await createSubjects([
      'ANATOMY', 'PHYSIOLOGY', 'BIOCHEMISTRY', 'PATHOLOGY', 'PHARMACOLOGY',
      'MICROBIOLOGY', 'PSM', 'OPHTHALMOLOGY', 'ENT', 'FMT', 'MEDICINE',
      'SURGERY', 'ORTHOPAEDICS', 'ANAESTHESIA', 'PAEDIATRICS', 'PSYCHIATRY',
      'RADIOLOGY', 'OBGYN', 'DERMATOLOGY',
    ]);

    await assignSubjects(app, admin.token, studentA.user._id, ids(allSubjects));

    const response = await fetchGroupSubjects(app, admin.token, group._id);

    expect(response.status).toBe(200);
    expect(response.body.subjectsByStudent[studentA.user._id]).toHaveLength(19);
  });

  it('omits students with no assigned subjects', async () => {
    const { admin, studentA, studentB, group } = await createGroupWithStudents();
    const subjects = await createSubjects(['ANATOMY']);

    await assignSubjects(app, admin.token, studentA.user._id, ids(subjects));

    const response = await fetchGroupSubjects(app, admin.token, group._id);

    expect(response.status).toBe(200);
    expect(response.body.subjectsByStudent[studentA.user._id]).toHaveLength(1);
    expect(response.body.subjectsByStudent[studentB.user._id]).toBeUndefined();
  });

  it('reflects subject removal and re-addition immediately', async () => {
    const { admin, studentA, group } = await createGroupWithStudents();
    const subjects = await createSubjects(['ANATOMY', 'PHYSIOLOGY', 'MEDICINE']);

    await assignSubjects(app, admin.token, studentA.user._id, ids(subjects));

    // Remove one subject (keep two).
    const remaining = subjects.slice(0, 2);
    await assignSubjects(app, admin.token, studentA.user._id, ids(remaining));
    let response = await fetchGroupSubjects(app, admin.token, group._id);
    expect(namesOf(response.body.subjectsByStudent[studentA.user._id]))
      .toEqual(['ANATOMY', 'PHYSIOLOGY']);

    // Re-add the removed subject.
    await assignSubjects(app, admin.token, studentA.user._id, ids(subjects));
    response = await fetchGroupSubjects(app, admin.token, group._id);
    expect(namesOf(response.body.subjectsByStudent[studentA.user._id]))
      .toEqual(['ANATOMY', 'MEDICINE', 'PHYSIOLOGY']);
  });

  it('allows group members (mentor and student) to read subjects', async () => {
    const { admin, mentor, studentA, studentB, group } = await createGroupWithStudents();
    const subjects = await createSubjects(['ANATOMY']);

    await assignSubjects(app, admin.token, studentA.user._id, ids(subjects));

    const asMentor = await fetchGroupSubjects(app, mentor.token, group._id);
    expect(asMentor.status).toBe(200);
    expect(asMentor.body.subjectsByStudent[studentA.user._id]).toHaveLength(1);

    const asStudent = await fetchGroupSubjects(app, studentB.token, group._id);
    expect(asStudent.status).toBe(200);
    expect(asStudent.body.subjectsByStudent[studentA.user._id]).toHaveLength(1);
  });

  it('denies access to non-members who are not admins', async () => {
    const { admin, studentA, outsider, group } = await createGroupWithStudents();
    const subjects = await createSubjects(['ANATOMY']);

    await assignSubjects(app, admin.token, studentA.user._id, ids(subjects));

    const response = await fetchGroupSubjects(app, outsider.token, group._id);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Access denied');
  });

  it('returns 404 for an unknown group', async () => {
    const admin = await createUser({ role: 'admin' });

    const response = await fetchGroupSubjects(
      app,
      admin.token,
      '507f1f77bcf86cd799439011'
    );

    expect(response.status).toBe(404);
  });

  it('does not alter the existing GET /api/groups/:id behavior', async () => {
    const { admin, group } = await createGroupWithStudents();

    const response = await request(app)
      .get(`/api/groups/${group._id}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Batch A');
    expect(response.body.members).toHaveLength(4);
  });
});
