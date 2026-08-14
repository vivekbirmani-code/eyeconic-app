const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser } = require('../helpers/testApp');
const User = require('../../models/User');
const MentorStudentAssignment = require('../../models/MentorStudentAssignment');

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

describe('Mentor-student assignment API', () => {
  it('returns mentors assigned to a student for admins', async () => {
    const admin = await createUser({ role: 'admin' });
    const mentor = await createUser({ role: 'mentor', name: 'Dr. Sharma' });
    const student = await createUser({ role: 'student', name: 'Rahul Kumar' });

    await User.findByIdAndUpdate(student.user._id, { mentors: [mentor.user._id] });
    await MentorStudentAssignment.create({
      mentor: mentor.user._id,
      student: student.user._id,
      assignedBy: admin.user._id,
      isActive: true,
    });

    const response = await request(app)
      .get(`/api/mentor-students/student/${student.user._id}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
    expect(response.body.mentors).toHaveLength(1);
    expect(response.body.mentors[0]).toMatchObject({
      _id: mentor.user._id.toString(),
      name: 'Dr. Sharma',
    });
  });

  it('assigns mentors to a student and creates active assignment records', async () => {
    const admin = await createUser({ role: 'admin' });
    const mentor = await createUser({ role: 'mentor', name: 'Dr. Sharma' });
    const student = await createUser({ role: 'student', name: 'Priya Singh' });

    const response = await request(app)
      .post('/api/mentor-students')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        studentId: student.user._id.toString(),
        mentorIds: [mentor.user._id.toString()],
      });

    expect(response.status).toBe(200);
    expect(response.body.mentors).toHaveLength(1);
    expect(response.body.mentors[0].email).toBe(mentor.user.email);

    const updatedStudent = await User.findById(student.user._id);
    expect(updatedStudent.mentors.map((id) => id.toString())).toEqual([mentor.user._id.toString()]);

    const assignment = await MentorStudentAssignment.findOne({
      mentor: mentor.user._id,
      student: student.user._id,
    });
    expect(assignment).not.toBeNull();
    expect(assignment.isActive).toBe(true);
  });

  it('replaces mentor assignments without creating duplicate assignment records', async () => {
    const admin = await createUser({ role: 'admin' });
    const mentorA = await createUser({ role: 'mentor', name: 'Mentor A' });
    const mentorB = await createUser({ role: 'mentor', name: 'Mentor B' });
    const student = await createUser({ role: 'student', name: 'Student A' });

    await request(app)
      .post('/api/mentor-students')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        studentId: student.user._id.toString(),
        mentorIds: [mentorA.user._id.toString()],
      });

    const replaceResponse = await request(app)
      .post('/api/mentor-students')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        studentId: student.user._id.toString(),
        mentorIds: [mentorB.user._id.toString()],
      });

    expect(replaceResponse.status).toBe(200);
    expect(replaceResponse.body.mentors).toHaveLength(1);
    expect(replaceResponse.body.mentors[0]._id).toBe(mentorB.user._id.toString());

    const assignments = await MentorStudentAssignment.find({ student: student.user._id });
    expect(assignments).toHaveLength(2);

    const activeAssignments = assignments.filter((assignment) => assignment.isActive);
    expect(activeAssignments).toHaveLength(1);
    expect(activeAssignments[0].mentor.toString()).toBe(mentorB.user._id.toString());
  });

  it('rejects assignment from non-admin users', async () => {
    const mentor = await createUser({ role: 'mentor' });
    const student = await createUser({ role: 'student' });

    const response = await request(app)
      .post('/api/mentor-students')
      .set('Authorization', `Bearer ${mentor.token}`)
      .send({
        studentId: student.user._id.toString(),
        mentorIds: [mentor.user._id.toString()],
      });

    expect(response.status).toBe(403);
  });

  it('rejects invalid mentor IDs', async () => {
    const admin = await createUser({ role: 'admin' });
    const student = await createUser({ role: 'student' });

    const response = await request(app)
      .post('/api/mentor-students')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        studentId: student.user._id.toString(),
        mentorIds: ['507f1f77bcf86cd799439011'],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/invalid mentor/i);
  });

  it('rejects assigning mentors to non-student users', async () => {
    const admin = await createUser({ role: 'admin' });
    const mentor = await createUser({ role: 'mentor' });
    const otherMentor = await createUser({ role: 'mentor' });

    const response = await request(app)
      .post('/api/mentor-students')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        studentId: mentor.user._id.toString(),
        mentorIds: [otherMentor.user._id.toString()],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/not a student/i);
  });

  it('allows admins to search mentors for assignment UI', async () => {
    const admin = await createUser({ role: 'admin' });
    await createUser({ role: 'mentor', name: 'Visible Mentor', email: 'mentor-visible@example.com' });
    await createUser({ role: 'student', name: 'Hidden Student', email: 'student-hidden@example.com' });

    const response = await request(app)
      .get('/api/users/search?role=mentor')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].name).toBe('Visible Mentor');
  });
});
