const express = require('express');
const Assignment = require('../models/Assignment');
const MentorStudentAssignment = require('../models/MentorStudentAssignment');
const StudentSubjectAssignment = require('../models/StudentSubjectAssignment');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get all assignments for a student
router.get('/student/:studentId', auth, async (req, res) => {
    try {
        const studentId = req.params.studentId;

        // Verify access
        if (req.user.role === 'student' && req.user._id.toString() !== studentId) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const assignments = await Assignment.find({ student: studentId })
            .populate('subject', 'name year')
            .populate('mentor', 'name email profilePicture')
            .sort({ scheduledDate: -1 });

        res.json(assignments);
    } catch (error) {
        console.error('Error fetching student assignments:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get this week's assignments for a student
router.get('/week/:studentId', auth, async (req, res) => {
    try {
        const studentId = req.params.studentId;

        // Verify access
        if (req.user.role === 'student' && req.user._id.toString() !== studentId) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Calculate this week's date range (Monday to Sunday)
        const now = new Date();
        const dayOfWeek = now.getDay();
        const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() + diffToMonday);
        weekStart.setHours(0, 0, 0, 0);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

        const assignments = await Assignment.find({
            student: studentId,
            scheduledDate: { $gte: weekStart, $lte: weekEnd }
        })
            .populate('subject', 'name year')
            .populate('mentor', 'name email profilePicture')
            .sort({ scheduledDate: 1 });

        res.json({
            weekStart,
            weekEnd,
            assignments
        });
    } catch (error) {
        console.error('Error fetching week assignments:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get all assignments created by a mentor
router.get('/mentor/:mentorId', auth, async (req, res) => {
    try {
        const mentorId = req.params.mentorId;

        // Verify access
        if (req.user.role === 'mentor' && req.user._id.toString() !== mentorId) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const assignments = await Assignment.find({ mentor: mentorId })
            .populate('subject', 'name year')
            .populate('student', 'name email profilePicture')
            .sort({ scheduledDate: -1 });

        res.json(assignments);
    } catch (error) {
        console.error('Error fetching mentor assignments:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get student list with assignment stats for a mentor
router.get('/mentor/:mentorId/students', auth, async (req, res) => {
    try {
        const mentorId = req.params.mentorId;

        // Verify access
        if (req.user.role === 'mentor' && req.user._id.toString() !== mentorId) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Get all students assigned to this mentor
        const mentorAssignments = await MentorStudentAssignment.find({
            mentor: mentorId,
            isActive: true
        }).populate('student', 'name email phone profilePicture');

        const students = [];

        for (const assignment of mentorAssignments) {
            const student = assignment.student;

            // Get subject assignments for this student
            const subjectAssignment = await StudentSubjectAssignment.findOne({
                student: student._id
            }).populate('subjects', 'name year');

            // Get assignment statistics
            const totalAssignments = await Assignment.countDocuments({
                student: student._id,
                mentor: mentorId
            });

            const completedAssignments = await Assignment.countDocuments({
                student: student._id,
                mentor: mentorId,
                status: { $in: ['completed', 'verified'] }
            });

            const verifiedAssignments = await Assignment.countDocuments({
                student: student._id,
                mentor: mentorId,
                status: 'verified'
            });

            const pendingAssignments = await Assignment.countDocuments({
                student: student._id,
                mentor: mentorId,
                status: 'pending'
            });

            const redoAssignments = await Assignment.countDocuments({
                student: student._id,
                mentor: mentorId,
                status: 'redo'
            });

            students.push({
                _id: student._id,
                name: student.name,
                email: student.email,
                phone: student.phone,
                profilePicture: student.profilePicture,
                subjects: subjectAssignment ? subjectAssignment.subjects : [],
                stats: {
                    total: totalAssignments,
                    pending: pendingAssignments,
                    completed: completedAssignments,
                    verified: verifiedAssignments,
                    redo: redoAssignments,
                    completionPercentage: totalAssignments > 0
                        ? Math.round((completedAssignments / totalAssignments) * 100)
                        : 0
                }
            });
        }

        res.json(students);
    } catch (error) {
        console.error('Error fetching mentor students:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create new assignment (Mentor only)
router.post('/', auth, async (req, res) => {
    try {
        // Only mentors can create assignments
        if (req.user.role !== 'mentor') {
            return res.status(403).json({ message: 'Only mentors can create assignments' });
        }

        const { title, description, subjectId, studentId, taskType, duration, scheduledDate } = req.body;

        if (!title || !subjectId || !studentId || !taskType || !duration || !scheduledDate) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // Verify that the student is assigned to this mentor
        const mentorAssignment = await MentorStudentAssignment.findOne({
            mentor: req.user._id,
            student: studentId,
            isActive: true
        });

        if (!mentorAssignment) {
            return res.status(403).json({ message: 'Student not assigned to you' });
        }

        // Create assignment
        const assignment = new Assignment({
            title,
            description,
            subject: subjectId,
            student: studentId,
            mentor: req.user._id,
            taskType,
            duration,
            scheduledDate: new Date(scheduledDate)
        });

        await assignment.save();

        // Populate before returning
        await assignment.populate('subject', 'name year');
        await assignment.populate('student', 'name email profilePicture');
        await assignment.populate('mentor', 'name email profilePicture');

        res.status(201).json(assignment);
    } catch (error) {
        console.error('Error creating assignment:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update assignment (Mentor only)
router.put('/:id', auth, async (req, res) => {
    try {
        const assignment = await Assignment.findById(req.params.id);

        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        // Verify ownership
        if (req.user.role !== 'admin' && assignment.mentor.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const { title, description, subjectId, taskType, duration, scheduledDate } = req.body;

        if (title) assignment.title = title;
        if (description !== undefined) assignment.description = description;
        if (subjectId) assignment.subject = subjectId;
        if (taskType) assignment.taskType = taskType;
        if (duration) assignment.duration = duration;
        if (scheduledDate) assignment.scheduledDate = new Date(scheduledDate);

        await assignment.save();

        await assignment.populate('subject', 'name year');
        await assignment.populate('student', 'name email profilePicture');
        await assignment.populate('mentor', 'name email profilePicture');

        res.json(assignment);
    } catch (error) {
        console.error('Error updating assignment:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Mark assignment as completed (Student only)
router.put('/:id/complete', auth, async (req, res) => {
    try {
        const assignment = await Assignment.findById(req.params.id);

        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        // Verify it's the student's assignment
        if (req.user.role !== 'student' || assignment.student.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Can only complete if status is pending or redo
        if (!['pending', 'redo'].includes(assignment.status)) {
            return res.status(400).json({ message: 'Assignment cannot be completed in current status' });
        }

        assignment.status = 'completed';
        assignment.completedAt = new Date();
        await assignment.save();

        await assignment.populate('subject', 'name year');
        await assignment.populate('mentor', 'name email profilePicture');

        res.json(assignment);
    } catch (error) {
        console.error('Error completing assignment:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Verify assignment or request redo (Mentor only)
router.put('/:id/verify', auth, async (req, res) => {
    try {
        const assignment = await Assignment.findById(req.params.id);

        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        // Verify ownership
        if (req.user.role !== 'mentor' || assignment.mentor.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Can only verify if status is completed
        if (assignment.status !== 'completed') {
            return res.status(400).json({ message: 'Assignment must be completed first' });
        }

        const { action, comment } = req.body; // action: 'done' or 'redo'

        if (!action || !['done', 'redo'].includes(action)) {
            return res.status(400).json({ message: 'Invalid action. Must be "done" or "redo"' });
        }

        if (action === 'done') {
            assignment.status = 'verified';
            assignment.verifiedAt = new Date();
            assignment.mentorComment = comment || '';
        } else if (action === 'redo') {
            assignment.status = 'redo';
            assignment.redoRequestedAt = new Date();
            assignment.redoReason = comment || '';
            // Clear completion timestamp when requesting redo
            assignment.completedAt = null;
        }

        await assignment.save();

        await assignment.populate('subject', 'name year');
        await assignment.populate('student', 'name email profilePicture');

        res.json(assignment);
    } catch (error) {
        console.error('Error verifying assignment:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete assignment (Mentor or Admin only)
router.delete('/:id', auth, async (req, res) => {
    try {
        const assignment = await Assignment.findById(req.params.id);

        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        // Verify ownership
        if (req.user.role !== 'admin' && assignment.mentor.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Access denied' });
        }

        await Assignment.findByIdAndDelete(req.params.id);

        res.json({ message: 'Assignment deleted successfully' });
    } catch (error) {
        console.error('Error deleting assignment:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
