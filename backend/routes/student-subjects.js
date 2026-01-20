const express = require('express');
const StudentSubjectAssignment = require('../models/StudentSubjectAssignment');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// Get subjects assigned to a student
router.get('/:studentId', auth, async (req, res) => {
    try {
        const assignment = await StudentSubjectAssignment.findOne({
            student: req.params.studentId
        }).populate('subjects').populate('assignedBy', 'name email');

        if (!assignment) {
            return res.json({ subjects: [] });
        }

        res.json(assignment);
    } catch (error) {
        console.error('Error fetching student subjects:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Assign subjects to student (Admin only)
router.post('/:studentId', auth, authorize('admin'), async (req, res) => {
    try {
        const { subjectIds } = req.body;
        const studentId = req.params.studentId;

        // Verify student exists and has student role
        const student = await User.findById(studentId);
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }
        if (student.role !== 'student') {
            return res.status(400).json({ message: 'User is not a student' });
        }

        // Find or create assignment
        let assignment = await StudentSubjectAssignment.findOne({ student: studentId });

        if (assignment) {
            // Update existing
            assignment.subjects = subjectIds;
            assignment.assignedBy = req.user._id;
            await assignment.save();
        } else {
            // Create new
            assignment = new StudentSubjectAssignment({
                student: studentId,
                subjects: subjectIds,
                assignedBy: req.user._id
            });
            await assignment.save();
        }

        // Populate before returning
        await assignment.populate('subjects');
        await assignment.populate('assignedBy', 'name email');

        res.json(assignment);
    } catch (error) {
        console.error('Error assigning subjects:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update student's subjects (Admin only)
router.put('/:studentId', auth, authorize('admin'), async (req, res) => {
    try {
        const { subjectIds } = req.body;
        const studentId = req.params.studentId;

        const assignment = await StudentSubjectAssignment.findOneAndUpdate(
            { student: studentId },
            {
                subjects: subjectIds,
                assignedBy: req.user._id
            },
            { new: true }
        ).populate('subjects').populate('assignedBy', 'name email');

        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        res.json(assignment);
    } catch (error) {
        console.error('Error updating student subjects:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
