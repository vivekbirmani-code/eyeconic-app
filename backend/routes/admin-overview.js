const express = require('express');
const Assignment = require('../models/Assignment');
const MentorStudentAssignment = require('../models/MentorStudentAssignment');
const StudentSubjectAssignment = require('../models/StudentSubjectAssignment');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// Get student assignment completion stats (Admin only)
router.get('/students', auth, authorize('admin'), async (req, res) => {
    try {
        const students = await User.find({ role: 'student' })
            .select('name email phone isProfileComplete')
            .sort({ name: 1 });

        const studentStats = [];

        for (const student of students) {
            const totalAssignments = await Assignment.countDocuments({
                student: student._id
            });

            const completedAssignments = await Assignment.countDocuments({
                student: student._id,
                status: { $in: ['completed', 'verified'] }
            });

            const verifiedAssignments = await Assignment.countDocuments({
                student: student._id,
                status: 'verified'
            });

            const pendingAssignments = await Assignment.countDocuments({
                student: student._id,
                status: 'pending'
            });

            const redoAssignments = await Assignment.countDocuments({
                student: student._id,
                status: 'redo'
            });

            // Get last activity (most recent assignment update)
            const lastAssignment = await Assignment.findOne({
                student: student._id
            }).sort({ updatedAt: -1 }).select('updatedAt');

            // Get assigned mentor
            const mentorAssignment = await MentorStudentAssignment.findOne({
                student: student._id,
                isActive: true
            }).populate('mentor', 'name email');

            studentStats.push({
                _id: student._id,
                name: student.name,
                email: student.email,
                phone: student.phone,
                isProfileComplete: student.isProfileComplete,
                mentor: mentorAssignment ? mentorAssignment.mentor : null,
                stats: {
                    total: totalAssignments,
                    pending: pendingAssignments,
                    completed: completedAssignments,
                    verified: verifiedAssignments,
                    redo: redoAssignments,
                    completionPercentage: totalAssignments > 0
                        ? Math.round((completedAssignments / totalAssignments) * 100)
                        : 0,
                    verificationRate: completedAssignments > 0
                        ? Math.round((verifiedAssignments / completedAssignments) * 100)
                        : 0
                },
                lastActivity: lastAssignment ? lastAssignment.updatedAt : null
            });
        }

        res.json(studentStats);
    } catch (error) {
        console.error('Error fetching student stats:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get mentor activity stats (Admin only)
router.get('/mentors', auth, authorize('admin'), async (req, res) => {
    try {
        const mentors = await User.find({ role: 'mentor' })
            .select('name email phone')
            .sort({ name: 1 });

        const mentorStats = [];

        for (const mentor of mentors) {
            // Get assigned students count
            const assignedStudents = await MentorStudentAssignment.countDocuments({
                mentor: mentor._id,
                isActive: true
            });

            // Get total assignments created
            const totalAssignments = await Assignment.countDocuments({
                mentor: mentor._id
            });

            // Get assignments verified this week
            const weekStart = new Date();
            weekStart.setDate(weekStart.getDate() - 7);
            const verifiedThisWeek = await Assignment.countDocuments({
                mentor: mentor._id,
                status: 'verified',
                verifiedAt: { $gte: weekStart }
            });

            // Calculate average student completion rate
            const students = await MentorStudentAssignment.find({
                mentor: mentor._id,
                isActive: true
            }).select('student');

            let totalCompletionRate = 0;
            for (const studentAssignment of students) {
                const total = await Assignment.countDocuments({
                    mentor: mentor._id,
                    student: studentAssignment.student
                });
                const completed = await Assignment.countDocuments({
                    mentor: mentor._id,
                    student: studentAssignment.student,
                    status: { $in: ['completed', 'verified'] }
                });
                if (total > 0) {
                    totalCompletionRate += (completed / total) * 100;
                }
            }

            const avgCompletionRate = students.length > 0
                ? Math.round(totalCompletionRate / students.length)
                : 0;

            mentorStats.push({
                _id: mentor._id,
                name: mentor.name,
                email: mentor.email,
                phone: mentor.phone,
                stats: {
                    assignedStudents,
                    totalAssignments,
                    verifiedThisWeek,
                    avgStudentCompletionRate: avgCompletionRate
                }
            });
        }

        res.json(mentorStats);
    } catch (error) {
        console.error('Error fetching mentor stats:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get detailed mentor view with all students and assignments (Admin only)
router.get('/mentor/:mentorId/details', auth, authorize('admin'), async (req, res) => {
    try {
        const mentorId = req.params.mentorId;

        // Get mentor info
        const mentor = await User.findById(mentorId).select('name email phone role');
        if (!mentor || mentor.role !== 'mentor') {
            return res.status(404).json({ message: 'Mentor not found' });
        }

        // Get all students assigned to this mentor
        const studentAssignments = await MentorStudentAssignment.find({
            mentor: mentorId,
            isActive: true
        }).populate('student', 'name email phone');

        const studentDetails = [];

        for (const assignment of studentAssignments) {
            const student = assignment.student;

            // Get student's subjects
            const subjectAssignment = await StudentSubjectAssignment.findOne({
                student: student._id
            }).populate('subjects', 'name year');

            // Get all assignments for this student from this mentor
            const assignments = await Assignment.find({
                mentor: mentorId,
                student: student._id
            })
                .populate('subject', 'name year')
                .sort({ scheduledDate: -1 });

            // Calculate stats
            const stats = {
                total: assignments.length,
                pending: assignments.filter(a => a.status === 'pending').length,
                completed: assignments.filter(a => a.status === 'completed').length,
                verified: assignments.filter(a => a.status === 'verified').length,
                redo: assignments.filter(a => a.status === 'redo').length
            };

            studentDetails.push({
                student: {
                    _id: student._id,
                    name: student.name,
                    email: student.email,
                    phone: student.phone
                },
                subjects: subjectAssignment ? subjectAssignment.subjects : [],
                assignments,
                stats
            });
        }

        res.json({
            mentor,
            students: studentDetails
        });
    } catch (error) {
        console.error('Error fetching mentor details:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
