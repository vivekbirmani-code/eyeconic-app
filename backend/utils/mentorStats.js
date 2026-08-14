const Assignment = require('../models/Assignment');
const MentorStudentAssignment = require('../models/MentorStudentAssignment');

/**
 * Compute aggregate mentor performance stats used by admin overview list and details.
 */
async function computeMentorStats(mentorId) {
    const assignedStudents = await MentorStudentAssignment.countDocuments({
        mentor: mentorId,
        isActive: true
    });

    const totalAssignments = await Assignment.countDocuments({
        mentor: mentorId
    });

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    const verifiedThisWeek = await Assignment.countDocuments({
        mentor: mentorId,
        status: 'verified',
        verifiedAt: { $gte: weekStart }
    });

    const studentAssignments = await MentorStudentAssignment.find({
        mentor: mentorId,
        isActive: true
    }).select('student');

    let totalCompletionRate = 0;
    for (const studentAssignment of studentAssignments) {
        const total = await Assignment.countDocuments({
            mentor: mentorId,
            student: studentAssignment.student
        });
        const completed = await Assignment.countDocuments({
            mentor: mentorId,
            student: studentAssignment.student,
            status: { $in: ['completed', 'verified'] }
        });
        if (total > 0) {
            totalCompletionRate += (completed / total) * 100;
        }
    }

    const avgStudentCompletionRate = studentAssignments.length > 0
        ? Math.round(totalCompletionRate / studentAssignments.length)
        : 0;

    return {
        assignedStudents,
        totalAssignments,
        verifiedThisWeek,
        avgStudentCompletionRate
    };
}

module.exports = { computeMentorStats };
