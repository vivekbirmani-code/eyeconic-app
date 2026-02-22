const express = require('express');
const router = express.Router();
const QuizAttempt = require('../models/QuizAttempt');
const Quiz = require('../models/Quiz');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');

// Get student analytics summary
router.get('/summary/:studentId', auth, authorize('admin', 'mentor'), async (req, res) => {
    try {
        const { studentId } = req.params;

        // Get all completed attempts for this student
        const attempts = await QuizAttempt.find({
            student: studentId,
            status: { $in: ['completed', 'auto_submitted'] }
        })
            .populate('quiz', 'title testType subject duration')
            .sort({ endTime: -1 });

        if (attempts.length === 0) {
            return res.json({
                summary: {
                    totalTests: 0,
                    totalMarks: 0,
                    obtainedMarks: 0,
                    avgPercentage: 0
                },
                attempts: [],
                subjectWise: {}
            });
        }

        let totalMarks = 0;
        let obtainedMarks = 0;
        const totalTests = attempts.length;

        attempts.forEach(a => {
            totalMarks += a.totalMarks || 0;
            obtainedMarks += a.marksObtained || 0;
        });

        const avgPercentage = totalMarks > 0 ? (obtainedMarks / totalMarks) * 100 : 0;

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
            summary: {
                totalTests,
                totalMarks,
                obtainedMarks,
                avgPercentage
            },
            attempts: attempts.map(a => ({
                _id: a._id,
                quiz: a.quiz,
                score: a.score,
                marksObtained: a.marksObtained,
                totalMarks: a.totalMarks,
                percentage: a.totalMarks ? (a.marksObtained / a.totalMarks) * 100 : 0,
                endTime: a.endTime,
                testType: a.quiz?.testType || 'n/a'
            })),
            subjectWise
        });
    } catch (error) {
        console.error('Student analytics error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
