const express = require('express');
const MentorStudentAssignment = require('../models/MentorStudentAssignment');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// Get all students assigned to a mentor
router.get('/mentor/:mentorId', auth, async (req, res) => {
    try {
        const mentorId = req.params.mentorId;

        // Verify access (mentors can only see their own students, admins can see all)
        if (req.user.role !== 'admin' && req.user._id.toString() !== mentorId) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const assignments = await MentorStudentAssignment.find({
            mentor: mentorId,
            isActive: true
        })
            .populate('student', 'name email phone role isProfileComplete')
            .populate('assignedBy', 'name email')
            .sort({ createdAt: -1 });

        res.json(assignments);
    } catch (error) {
        console.error('Error fetching mentor students:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get mentor assigned to a student
router.get('/student/:studentId', auth, async (req, res) => {
    try {
        const studentId = req.params.studentId;

        // Verify access (students can only see their own mentor, admins and mentors can see all)
        if (req.user.role === 'student' && req.user._id.toString() !== studentId) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const assignment = await MentorStudentAssignment.findOne({
            student: studentId,
            isActive: true
        })
            .populate('mentor', 'name email phone role')
            .populate('assignedBy', 'name email');

        if (!assignment) {
            return res.json(null);
        }

        res.json(assignment);
    } catch (error) {
        console.error('Error fetching student mentor:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Assign mentor to student (Admin only)
router.post('/', auth, authorize('admin'), async (req, res) => {
    try {
        const { mentorId, studentId } = req.body;

        if (!mentorId || !studentId) {
            return res.status(400).json({ message: 'Mentor ID and Student ID are required' });
        }

        // Verify mentor exists and has mentor role
        const mentor = await User.findById(mentorId);
        if (!mentor) {
            return res.status(404).json({ message: 'Mentor not found' });
        }
        if (mentor.role !== 'mentor') {
            return res.status(400).json({ message: 'User is not a mentor' });
        }

        // Verify student exists and has student role
        const student = await User.findById(studentId);
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }
        if (student.role !== 'student') {
            return res.status(400).json({ message: 'User is not a student' });
        }

        // Deactivate any existing active assignments for this student
        await MentorStudentAssignment.updateMany(
            { student: studentId, isActive: true },
            { isActive: false }
        );

        // Check if assignment already exists
        let assignment = await MentorStudentAssignment.findOne({
            mentor: mentorId,
            student: studentId
        });

        if (assignment) {
            // Reactivate if it was deactivated
            assignment.isActive = true;
            assignment.assignedBy = req.user._id;
            await assignment.save();
        } else {
            // Create new assignment
            assignment = new MentorStudentAssignment({
                mentor: mentorId,
                student: studentId,
                assignedBy: req.user._id
            });
            await assignment.save();
        }

        // Populate before returning
        await assignment.populate('mentor', 'name email phone role');
        await assignment.populate('student', 'name email phone role');
        await assignment.populate('assignedBy', 'name email');

        res.status(201).json(assignment);
    } catch (error) {
        console.error('Error assigning mentor to student:', error);
        if (error.code === 11000) {
            return res.status(400).json({ message: 'This mentor-student assignment already exists' });
        }
        res.status(500).json({ message: 'Server error' });
    }
});

// Remove mentor-student assignment (Admin only)
router.delete('/:id', auth, authorize('admin'), async (req, res) => {
    try {
        const assignment = await MentorStudentAssignment.findByIdAndUpdate(
            req.params.id,
            { isActive: false },
            { new: true }
        );

        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        res.json({ message: 'Mentor-student assignment removed successfully' });
    } catch (error) {
        console.error('Error removing assignment:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
