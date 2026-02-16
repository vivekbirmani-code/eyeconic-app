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

        // Find students who have this mentor in their mentors array
        const students = await User.find({ 
            mentors: mentorId,
            role: 'student'
        })
        .select('name email phone role isProfileComplete studentProfile mentors')
        .populate('mentors', 'name email phone');

        res.json(students);
    } catch (error) {
        console.error('Error fetching mentor students:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get mentors assigned to a student
router.get('/student/:studentId', auth, async (req, res) => {
    try {
        const studentId = req.params.studentId;

        // Verify access (students can only see their own mentor, admins and mentors can see all)
        if (req.user.role === 'student' && req.user._id.toString() !== studentId) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const student = await User.findById(studentId)
            .populate('mentors', 'name email phone role')
            .select('mentors');

        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }

        // Return object with mentors array to match expected structure or just the array?
        // Existing frontend expects single object with mentor field. 
        // We will return list of mentors now.
        res.json({ mentors: student.mentors || [] });
    } catch (error) {
        console.error('Error fetching student mentors:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Assign mentors to student (Admin only)
router.post('/', auth, authorize('admin'), async (req, res) => {
    try {
        const { mentorIds, studentId } = req.body;

        if (!Array.isArray(mentorIds) || !studentId) {
            return res.status(400).json({ message: 'Mentor IDs (array) and Student ID are required' });
        }

        // Verify student exists
        const student = await User.findById(studentId);
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }
        if (student.role !== 'student') {
            return res.status(400).json({ message: 'User is not a student' });
        }

        // Verify all mentors exist and are mentors
        const mentors = await User.find({ 
            _id: { $in: mentorIds },
            role: 'mentor'
        });

        if (mentors.length !== mentorIds.length) {
            return res.status(400).json({ message: 'One or more invalid mentor IDs provided' });
        }

        const oldMentorIds = student.mentors ? student.mentors.map(id => id.toString()) : [];
        
        // Update student's mentors list
        student.mentors = mentorIds;
        await student.save();

        // --- HISTORY TRACKING (Optional but good for audit) ---
        // 1. Deactivate assignments for mentors who were removed
        const removedMentorIds = oldMentorIds.filter(id => !mentorIds.includes(id));
        if (removedMentorIds.length > 0) {
             await MentorStudentAssignment.updateMany(
                { 
                    student: studentId, 
                    mentor: { $in: removedMentorIds },
                    isActive: true 
                },
                { isActive: false }
            );
        }

        // 2. Create/Activate assignments for new mentors
        const newMentorIds = mentorIds.filter(id => !oldMentorIds.includes(id));
        
        for (const mId of newMentorIds) {
             // Check if assignment record exists
             let assignment = await MentorStudentAssignment.findOne({
                mentor: mId,
                student: studentId
            });

            if (assignment) {
                if (!assignment.isActive) {
                    assignment.isActive = true;
                    assignment.assignedBy = req.user._id;
                    await assignment.save();
                }
            } else {
                await MentorStudentAssignment.create({
                    mentor: mId,
                    student: studentId,
                    assignedBy: req.user._id
                });
            }
        }
        // ----------------------------------------------------

        // Return updated student with populated mentors
        await student.populate('mentors', 'name email phone role');
        
        res.status(200).json({ 
            message: 'Mentors assigned successfully',
            mentors: student.mentors 
        });

    } catch (error) {
        console.error('Error assigning mentors:', error);
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// Remove mentor-student assignment (Admin only) - Legacy/Single removal helper
router.delete('/:id', auth, authorize('admin'), async (req, res) => {
    // This was removing by Assignment ID. 
    // We might need a route to remove by mentorId/studentId pair for the new clean UI,
    // OR just rely on the POST / (bulk update) which handles removals.
    // Keeping this for legacy support if needed, but it might break if we strictly transition.
    // Let's perform a "soft delete" by finding the assignment and then also pulling from User.mentors.
    
    try {
        const assignment = await MentorStudentAssignment.findById(req.params.id);
        
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        // Remove from User.mentors
        await User.findByIdAndUpdate(assignment.student, {
            $pull: { mentors: assignment.mentor }
        });

        // Deactivate assignment
        assignment.isActive = false;
        await assignment.save();

        res.json({ message: 'Mentor removed successfully' });
    } catch (error) {
        console.error('Error removing assignment:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
