const express = require('express');
const router = express.Router();
const QuizAttempt = require('../models/QuizAttempt');
const Quiz = require('../models/Quiz');
const User = require('../models/User');
const MentorStudentAssignment = require('../models/MentorStudentAssignment');
const { auth, authorize } = require('../middleware/auth');
const {
    aggregateStudentSummary,
    computeAttemptStats,
} = require('../utils/analytics');

// Get student analytics summary
router.get('/summary/:studentId', auth, authorize('admin', 'mentor'), async (req, res) => {
    try {
        const { studentId } = req.params;

        // SECURITY: a mentor may only view analytics for students assigned to them.
        if (req.user.role === 'mentor') {
            const assignment = await MentorStudentAssignment.findOne({
                mentor: req.user._id,
                student: studentId,
                isActive: true
            });
            if (!assignment) {
                return res.status(403).json({ message: 'Not authorized to view this student\'s analytics' });
            }
        }

        // Get all completed attempts for this student
        const attempts = await QuizAttempt.find({
            student: studentId,
            status: { $in: ['completed', 'auto_submitted'] }
        })
            .populate('quiz', 'title testType subject duration')
            .sort({ endTime: -1 });

        if (attempts.length === 0) {
            return res.json({
                summary: aggregateStudentSummary([]),
                attempts: [],
                subjectWise: {}
            });
        }

        const summary = aggregateStudentSummary(attempts);

        // Subject-wise breakdown
        const subjectWise = {};
        attempts.forEach(a => {
            const subjectId = a.quiz?.subject?.toString() || 'unknown';
            if (!subjectWise[subjectId]) {
                subjectWise[subjectId] = {
                    tests: 0,
                    totalMarks: 0,
                    obtainedMarks: 0
                };
            }
            subjectWise[subjectId].tests++;
            subjectWise[subjectId].totalMarks += a.totalMarks || 0;
            subjectWise[subjectId].obtainedMarks += a.marksObtained || 0;
        });

        res.json({
            summary,
            attempts: attempts.map(a => {
                const stats = computeAttemptStats(a);
                return {
                    _id: a._id,
                    quiz: a.quiz,
                    score: a.score,
                    marksObtained: stats.marksObtained,
                    totalMarks: stats.totalMarks,
                    scorePercentage: stats.scorePercentage,
                    accuracy: stats.accuracy,
                    percentage: stats.percentage,
                    endTime: a.endTime,
                    testType: a.quiz?.testType || 'n/a'
                };
            }),
            subjectWise
        });
    } catch (error) {
        console.error('Student analytics error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
