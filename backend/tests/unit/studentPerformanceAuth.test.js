jest.mock('../../models/MentorStudentAssignment', () => ({
  findOne: jest.fn(),
}));

const MentorStudentAssignment = require('../../models/MentorStudentAssignment');
const { assertStudentPerformanceAccess } = require('../../utils/studentPerformanceAuth');

describe('studentPerformanceAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows students to access only their own analytics', async () => {
    const req = { user: { _id: 'student1', role: 'student' } };
    const own = await assertStudentPerformanceAccess(req, 'student1');
    const other = await assertStudentPerformanceAccess(req, 'student2');

    expect(own.authorized).toBe(true);
    expect(other.authorized).toBe(false);
    expect(other.statusCode).toBe(403);
  });

  it('allows mentors only for assigned students', async () => {
    MentorStudentAssignment.findOne.mockResolvedValueOnce({ _id: 'assignment1' });
    const req = { user: { _id: 'mentor1', role: 'mentor' } };

    const allowed = await assertStudentPerformanceAccess(req, 'student1');
    expect(allowed.authorized).toBe(true);

    MentorStudentAssignment.findOne.mockResolvedValueOnce(null);
    const denied = await assertStudentPerformanceAccess(req, 'student2');
    expect(denied.authorized).toBe(false);
    expect(denied.statusCode).toBe(403);
  });

  it('allows admins for any student', async () => {
    const req = { user: { _id: 'admin1', role: 'admin' } };
    const result = await assertStudentPerformanceAccess(req, 'student99');
    expect(result.authorized).toBe(true);
  });
});
