const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser } = require('../helpers/testApp');
const Subject = require('../../models/Subject');
const StudentSubjectAssignment = require('../../models/StudentSubjectAssignment');

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

describe('Student subject assignment API', () => {
  it('returns an empty list for a student with no assignment', async () => {
    const admin = await createUser({ role: 'admin' });
    const student = await createUser({ role: 'student' });

    const response = await request(app)
      .get(`/api/student-subjects/${student.user._id}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
    expect(response.body.subjects).toEqual([]);
  });

  it('lets a student read their own subjects but blocks reading another student\'s', async () => {
    const admin = await createUser({ role: 'admin' });
    const studentA = await createUser({ role: 'student', name: 'Student A' });
    const studentB = await createUser({ role: 'student', name: 'Student B' });
    const subjects = await createSubjects(['ANATOMY']);

    await request(app)
      .post(`/api/student-subjects/${studentB.user._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ subjectIds: ids(subjects) });

    // Own record: allowed
    const own = await request(app)
      .get(`/api/student-subjects/${studentA.user._id}`)
      .set('Authorization', `Bearer ${studentA.token}`);
    expect(own.status).toBe(200);

    // Another student's record: 403 even though the id is well-formed
    const cross = await request(app)
      .get(`/api/student-subjects/${studentB.user._id}`)
      .set('Authorization', `Bearer ${studentA.token}`);
    expect(cross.status).toBe(403);

    // Mentors (whose students' subjects these are) and admins still may read
    const mentor = await createUser({ role: 'mentor' });
    const mentorView = await request(app)
      .get(`/api/student-subjects/${studentB.user._id}`)
      .set('Authorization', `Bearer ${mentor.token}`);
    expect(mentorView.status).toBe(200);
    expect(mentorView.body.subjects.map((s) => s.name)).toEqual(['ANATOMY']);
  });

  it('persists assigning all subjects and returns them on subsequent fetch', async () => {
    const admin = await createUser({ role: 'admin' });
    const student = await createUser({ role: 'student' });
    const subjects = await createSubjects([
      'ANATOMY', 'PHYSIOLOGY', 'BIOCHEMISTRY', 'PATHOLOGY', 'MEDICINE',
    ]);

    const assign = await request(app)
      .post(`/api/student-subjects/${student.user._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ subjectIds: ids(subjects) });

    expect(assign.status).toBe(200);
    expect(assign.body.subjects).toHaveLength(5);

    // Subsequent GET (what the app does after saving) must reflect the save
    const fetched = await request(app)
      .get(`/api/student-subjects/${student.user._id}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(fetched.status).toBe(200);
    expect(fetched.body.subjects.map((s) => s.name).sort()).toEqual(
      ['ANATOMY', 'BIOCHEMISTRY', 'MEDICINE', 'PATHOLOGY', 'PHYSIOLOGY']
    );

    // Direct DB verification
    const assignment = await StudentSubjectAssignment.findOne({
      student: student.user._id,
    });
    expect(assignment).not.toBeNull();
    expect(assignment.subjects).toHaveLength(5);
  });

  it('updates the assignment when subjects are removed and re-added', async () => {
    const admin = await createUser({ role: 'admin' });
    const student = await createUser({ role: 'student' });
    const subjects = await createSubjects(['ANATOMY', 'PHYSIOLOGY', 'MEDICINE']);
    const studentTokenless = student.user._id;

    // Assign all three
    await request(app)
      .post(`/api/student-subjects/${studentTokenless}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ subjectIds: ids(subjects) });

    // Remove one subject (save remaining two)
    const remaining = subjects.slice(0, 2);
    await request(app)
      .post(`/api/student-subjects/${studentTokenless}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ subjectIds: ids(remaining) });

    let fetched = await request(app)
      .get(`/api/student-subjects/${studentTokenless}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(fetched.body.subjects).toHaveLength(2);
    expect(fetched.body.subjects.map((s) => s.name)).not.toContain('MEDICINE');

    // Re-add the removed subject
    await request(app)
      .post(`/api/student-subjects/${studentTokenless}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ subjectIds: ids(subjects) });

    fetched = await request(app)
      .get(`/api/student-subjects/${studentTokenless}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(fetched.body.subjects).toHaveLength(3);

    // Exactly one assignment document should exist (no duplicates)
    const count = await StudentSubjectAssignment.countDocuments({
      student: studentTokenless,
    });
    expect(count).toBe(1);
  });

  it('clears subjects when an empty array is saved', async () => {
    const admin = await createUser({ role: 'admin' });
    const student = await createUser({ role: 'student' });
    const subjects = await createSubjects(['ANATOMY', 'PHYSIOLOGY']);

    await request(app)
      .post(`/api/student-subjects/${student.user._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ subjectIds: ids(subjects) });

    await request(app)
      .post(`/api/student-subjects/${student.user._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ subjectIds: [] });

    const fetched = await request(app)
      .get(`/api/student-subjects/${student.user._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.subjects).toEqual([]);
  });

  it('rejects assignment for non-admin users', async () => {
    const mentor = await createUser({ role: 'mentor' });
    const student = await createUser({ role: 'student' });
    const subjects = await createSubjects(['ANATOMY']);

    const response = await request(app)
      .post(`/api/student-subjects/${student.user._id}`)
      .set('Authorization', `Bearer ${mentor.token}`)
      .send({ subjectIds: ids(subjects) });

    expect(response.status).toBe(403);
  });

  it('rejects assignment for a non-student user', async () => {
    const admin = await createUser({ role: 'admin' });
    const mentor = await createUser({ role: 'mentor' });
    const subjects = await createSubjects(['ANATOMY']);

    const response = await request(app)
      .post(`/api/student-subjects/${mentor.user._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ subjectIds: ids(subjects) });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('User is not a student');
  });
});
