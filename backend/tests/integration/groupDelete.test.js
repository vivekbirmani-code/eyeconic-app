const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser } = require('../helpers/testApp');
const Group = require('../../models/Group');
const User = require('../../models/User');
const Message = require('../../models/Message');
const MessageReadStatus = require('../../models/MessageReadStatus');
const ReadStatus = require('../../models/ReadStatus');
const Call = require('../../models/Call');

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

const deleteGroup = (token, groupId) =>
  request(app)
    .delete(`/api/groups/${groupId}`)
    .set('Authorization', `Bearer ${token}`);

/**
 * Creates a group with an admin (creator), a mentor and a student, plus
 * messages, read receipts, a group read status, a call record and the group
 * referenced on every member's User.groups array.
 */
async function createGroupWithChatData() {
  const admin = await createUser({ role: 'admin', name: 'Admin User' });
  const mentor = await createUser({ role: 'mentor', name: 'Dr. Sharma' });
  const student = await createUser({ role: 'student', name: 'Student A' });

  const group = await Group.create({
    name: 'Batch A',
    type: 'general',
    members: [admin.user._id, mentor.user._id, student.user._id],
    mentors: [mentor.user._id],
    createdBy: admin.user._id,
  });

  await User.updateMany(
    { _id: { $in: [admin.user._id, mentor.user._id, student.user._id] } },
    { $addToSet: { groups: group._id } }
  );

  const messageFromMentor = await Message.create({
    content: 'Welcome to the group',
    sender: mentor.user._id,
    group: group._id,
  });
  const messageFromAdmin = await Message.create({
    content: 'Hello everyone',
    sender: admin.user._id,
    group: group._id,
  });

  await MessageReadStatus.create({
    messageId: messageFromMentor._id,
    userId: student.user._id,
  });

  await ReadStatus.create({
    userId: student.user._id,
    groupId: group._id,
  });

  await Call.create({
    groupId: group._id,
    initiator: mentor.user._id,
    participants: [{ userId: mentor.user._id }],
    status: 'ended',
  });

  // A second group the student also belongs to — it must survive untouched.
  const otherGroup = await Group.create({
    name: 'Batch B',
    type: 'general',
    members: [admin.user._id, student.user._id],
    createdBy: admin.user._id,
  });
  await User.updateMany(
    { _id: { $in: [admin.user._id, student.user._id] } },
    { $addToSet: { groups: otherGroup._id } }
  );
  await Message.create({
    content: 'Keep me',
    sender: admin.user._id,
    group: otherGroup._id,
  });

  return { admin, mentor, student, group, otherGroup, messageFromMentor, messageFromAdmin };
}

describe('DELETE /api/groups/:id', () => {
  it('deletes the group and all of its dependent data', async () => {
    const { admin, group, messageFromMentor, messageFromAdmin } = await createGroupWithChatData();

    const response = await deleteGroup(admin.token, group._id);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Group deleted successfully');

    expect(await Group.findById(group._id)).toBeNull();
    expect(await Message.findById(messageFromMentor._id)).toBeNull();
    expect(await Message.findById(messageFromAdmin._id)).toBeNull();
    expect(await Message.countDocuments({ group: group._id })).toBe(0);
    expect(await MessageReadStatus.countDocuments({ messageId: messageFromMentor._id })).toBe(0);
    expect(await ReadStatus.countDocuments({ groupId: group._id })).toBe(0);
    expect(await Call.countDocuments({ groupId: group._id })).toBe(0);
  });

  it('removes the group from every member’s User.groups array', async () => {
    const { admin, mentor, student, group, otherGroup } = await createGroupWithChatData();

    const response = await deleteGroup(admin.token, group._id);
    expect(response.status).toBe(200);

    const [adminAfter, mentorAfter, studentAfter] = await Promise.all([
      User.findById(admin.user._id),
      User.findById(mentor.user._id),
      User.findById(student.user._id),
    ]);

    const deletedId = group._id.toString();
    expect(adminAfter.groups.map(g => g.toString())).not.toContain(deletedId);
    expect(mentorAfter.groups.map(g => g.toString())).not.toContain(deletedId);
    expect(studentAfter.groups.map(g => g.toString())).not.toContain(deletedId);

    // Other groups the members belong to are untouched.
    expect(studentAfter.groups.map(g => g.toString())).toContain(otherGroup._id.toString());
  });

  it('leaves other groups and their messages intact', async () => {
    const { admin, group, otherGroup } = await createGroupWithChatData();

    await deleteGroup(admin.token, group._id);

    expect(await Group.findById(otherGroup._id)).not.toBeNull();
    expect(await Message.countDocuments({ group: otherGroup._id })).toBe(1);
  });

  it('returns 404 for an unknown group', async () => {
    const admin = await createUser({ role: 'admin' });

    const response = await deleteGroup(admin.token, '507f1f77bcf86cd799439011');

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Group not found');
  });

  it('denies deletion to non-admins', async () => {
    const { mentor, student, group } = await createGroupWithChatData();

    const asMentor = await deleteGroup(mentor.token, group._id);
    expect(asMentor.status).toBe(403);
    expect(await Group.findById(group._id)).not.toBeNull();

    const asStudent = await deleteGroup(student.token, group._id);
    expect(asStudent.status).toBe(403);
    expect(await Group.findById(group._id)).not.toBeNull();
  });

  it('requires authentication', async () => {
    const { group } = await createGroupWithChatData();

    const response = await request(app).delete(`/api/groups/${group._id}`);

    expect(response.status).toBe(401);
    expect(await Group.findById(group._id)).not.toBeNull();
  });

  it('deletes an empty group without dependent data', async () => {
    const admin = await createUser({ role: 'admin' });
    const group = await Group.create({
      name: 'Empty Group',
      type: 'general',
      members: [admin.user._id],
      createdBy: admin.user._id,
    });

    const response = await deleteGroup(admin.token, group._id);

    expect(response.status).toBe(200);
    expect(await Group.findById(group._id)).toBeNull();
  });

  it('keeps the mentors array cleanup covered for mentor-only references', async () => {
    const admin = await createUser({ role: 'admin' });
    const mentor = await createUser({ role: 'mentor', name: 'Only Mentors Array' });

    const group = await Group.create({
      name: 'Mentors Batch',
      type: 'general',
      members: [admin.user._id],
      mentors: [mentor.user._id],
      createdBy: admin.user._id,
    });
    await User.findByIdAndUpdate(mentor.user._id, { $addToSet: { groups: group._id } });

    const response = await deleteGroup(admin.token, group._id);
    expect(response.status).toBe(200);

    const mentorAfter = await User.findById(mentor.user._id);
    expect(mentorAfter.groups.map(g => g.toString())).not.toContain(group._id.toString());
  });
});
