const MentorStudentAssignment = require('../models/MentorStudentAssignment');

/**
 * Verify the requesting user may access analytics for the given student.
 * - Students may only access their own data.
 * - Mentors may only access assigned students.
 * - Admins may access any student.
 *
 * @returns {{ authorized: boolean, statusCode?: number, message?: string }}
 */
async function assertStudentPerformanceAccess(req, studentId) {
  const requesterId = String(req.user._id);
  const targetId = String(studentId);

  if (req.user.role === 'student') {
    if (requesterId !== targetId) {
      return {
        authorized: false,
        statusCode: 403,
        message: 'Access denied',
      };
    }
    return { authorized: true };
  }

  if (req.user.role === 'mentor') {
    const assignment = await MentorStudentAssignment.findOne({
      mentor: req.user._id,
      student: studentId,
      isActive: true,
    });

    if (!assignment) {
      return {
        authorized: false,
        statusCode: 403,
        message: 'Not authorized to view this student\'s analytics',
      };
    }
    return { authorized: true };
  }

  if (req.user.role === 'admin') {
    return { authorized: true };
  }

  return {
    authorized: false,
    statusCode: 403,
    message: 'Access denied',
  };
}

module.exports = {
  assertStudentPerformanceAccess,
};
