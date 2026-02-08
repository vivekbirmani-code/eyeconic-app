const express = require('express');
const crypto = require('crypto');
const Quiz = require('../models/Quiz');
const QuestionBank = require('../models/QuestionBank');
const GuestAttempt = require('../models/GuestAttempt');

const router = express.Router();

// ============ PUBLIC ROUTES (No Authentication Required) ============

/**
 * GET /api/public/share/:shareToken
 * HTML Redirect page for deep linking (clickable in WhatsApp etc.)
 */
router.get('/share/:shareToken', async (req, res) => {
    try {
        const { shareToken } = req.params;
        const deepLink = `mentorship://quiz/${shareToken}`;

        // Simple HTML to handle redirect
        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Opening Quiz...</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f7f7f7; text-align: center; padding: 20px; }
        .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 400px; width: 100%; }
        h1 { font-size: 20px; margin-bottom: 10px; color: #1f2937; }
        p { color: #6b7280; margin-bottom: 24px; line-height: 1.5; }
        .btn { display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; transition: background-color 0.2s; }
        .btn:hover { background-color: #1d4ed8; }
    </style>
    <script>
        window.onload = function() {
            window.location.href = "${deepLink}";
            setTimeout(function() {
                document.getElementById('manual-link').style.display = 'block';
            }, 1000);
        }
    </script>
</head>
<body>
    <div class="card">
        <h1>Opening Eyeconic Quiz</h1>
        <p>Attempting to open the quiz in the Eyeconic app...</p>
        <a href="${deepLink}" class="btn">Open App</a>
        <p id="manual-link" style="display:none; margin-top: 16px; font-size: 14px;">If the app doesn't open, please ensure it is installed.</p>
    </div>
</body>
</html>
        `;

        res.send(html);
    } catch (error) {
        console.error('Error serving redirect:', error);
        res.status(500).send('Server error');
    }
});

/**
 * GET /api/public/quiz/:shareToken
 * Get quiz details by share token for guest users
 */
router.get('/quiz/:shareToken', async (req, res) => {
    try {
        const { shareToken } = req.params;

        const quiz = await Quiz.findOne({
            shareToken,
            isPublic: true,
            isActive: true
        })
            .populate('subject', 'name')
            .select('title subject duration instructions totalMarks questions publicExpiryDate');

        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: 'Quiz not found or link has expired'
            });
        }

        // Check if public link has expired
        if (quiz.publicExpiryDate && new Date() > quiz.publicExpiryDate) {
            return res.status(410).json({
                success: false,
                message: 'This quiz link has expired'
            });
        }

        res.json({
            success: true,
            quiz: {
                _id: quiz._id,
                title: quiz.title,
                subject: quiz.subject,
                duration: quiz.duration,
                instructions: quiz.instructions,
                totalMarks: quiz.totalMarks,
                questionCount: quiz.questions.length
            }
        });
    } catch (error) {
        console.error('Error fetching public quiz:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/public/quiz/:shareToken/start
 * Start a guest quiz attempt
 */
router.post('/quiz/:shareToken/start', async (req, res) => {
    try {
        const { shareToken } = req.params;
        const { guestId, deviceInfo } = req.body;

        if (!guestId) {
            return res.status(400).json({
                success: false,
                message: 'Guest ID is required'
            });
        }

        const quiz = await Quiz.findOne({
            shareToken,
            isPublic: true,
            isActive: true
        }).populate({
            path: 'questions',
            select: 'question options questionImage optionImages marks'
        });

        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: 'Quiz not found or link has expired'
            });
        }

        // Check if public link has expired
        if (quiz.publicExpiryDate && new Date() > quiz.publicExpiryDate) {
            return res.status(410).json({
                success: false,
                message: 'This quiz link has expired'
            });
        }

        // Check for existing in-progress attempt
        let attempt = await GuestAttempt.findOne({
            quiz: quiz._id,
            guestId,
            status: 'in_progress'
        });

        if (attempt) {
            // Resume existing attempt
            return res.json({
                success: true,
                message: 'Resuming existing attempt',
                attempt: {
                    _id: attempt._id,
                    startTime: attempt.startTime,
                    answers: attempt.answers
                },
                quiz: {
                    _id: quiz._id,
                    title: quiz.title,
                    duration: quiz.duration,
                    questions: quiz.questions.map(q => ({
                        _id: q._id,
                        questionText: q.question,
                        options: q.options,
                        questionImage: q.questionImage,
                        optionImages: q.optionImages,
                        marks: q.marks || 1
                    })),
                    totalMarks: quiz.totalMarks
                }
            });
        }

        // Create new attempt
        attempt = new GuestAttempt({
            quiz: quiz._id,
            guestId,
            deviceInfo,
            totalQuestions: quiz.questions.length,
            totalMarks: quiz.totalMarks,
            answers: quiz.questions.map((_, index) => ({
                questionIndex: index,
                selectedAnswer: -1,
                isCorrect: false,
                markedForReview: false,
                timeSpent: 0
            }))
        });

        await attempt.save();

        res.status(201).json({
            success: true,
            message: 'Quiz started',
            attempt: {
                _id: attempt._id,
                startTime: attempt.startTime,
                answers: attempt.answers
            },
            quiz: {
                _id: quiz._id,
                title: quiz.title,
                duration: quiz.duration,
                questions: quiz.questions.map(q => ({
                    _id: q._id,
                    questionText: q.question,
                    options: q.options,
                    questionImage: q.questionImage,
                    optionImages: q.optionImages,
                    marks: q.marks || 1
                })),
                totalMarks: quiz.totalMarks
            }
        });
    } catch (error) {
        console.error('Error starting guest quiz:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/public/quiz/:shareToken/submit
 * Submit a guest quiz attempt
 */
router.post('/quiz/:shareToken/submit', async (req, res) => {
    try {
        const { shareToken } = req.params;
        const { guestId, attemptId, answers, tabSwitchCount, tabSwitchLog } = req.body;

        if (!guestId || !attemptId) {
            return res.status(400).json({
                success: false,
                message: 'Guest ID and attempt ID are required'
            });
        }

        const quiz = await Quiz.findOne({
            shareToken,
            isPublic: true
        }).populate({
            path: 'questions',
            select: 'correctAnswer marks'
        });

        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: 'Quiz not found'
            });
        }

        const attempt = await GuestAttempt.findOne({
            _id: attemptId,
            quiz: quiz._id,
            guestId
        });

        if (!attempt) {
            return res.status(404).json({
                success: false,
                message: 'Attempt not found'
            });
        }

        if (attempt.status !== 'in_progress') {
            return res.status(400).json({
                success: false,
                message: 'This attempt has already been submitted'
            });
        }

        // Calculate score
        let score = 0;
        let marksObtained = 0;

        const gradedAnswers = answers.map((answer, index) => {
            const question = quiz.questions[index];
            const isCorrect = answer.selectedAnswer === question?.correctAnswer;
            const marks = question?.marks || 1;

            if (isCorrect) {
                score++;
                marksObtained += marks;
            }

            return {
                ...answer,
                isCorrect
            };
        });

        // Update attempt
        attempt.answers = gradedAnswers;
        attempt.score = score;
        attempt.marksObtained = marksObtained;
        attempt.status = 'completed';
        attempt.endTime = new Date();
        attempt.tabSwitchCount = tabSwitchCount || 0;
        attempt.tabSwitchLog = tabSwitchLog || [];

        await attempt.save();

        // Return success but NOT the actual results (guest must sign in to see results)
        res.json({
            success: true,
            message: 'Quiz submitted successfully',
            attemptId: attempt._id,
            // We don't return score/results to guests
            submitted: true
        });
    } catch (error) {
        console.error('Error submitting guest quiz:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/public/quiz/:shareToken/save-progress
 * Save quiz progress for guest (auto-save)
 */
router.post('/quiz/:shareToken/save-progress', async (req, res) => {
    try {
        const { shareToken } = req.params;
        const { guestId, attemptId, answers, tabSwitchCount, tabSwitchLog } = req.body;

        if (!guestId || !attemptId) {
            return res.status(400).json({
                success: false,
                message: 'Guest ID and attempt ID are required'
            });
        }

        const attempt = await GuestAttempt.findOne({
            _id: attemptId,
            guestId,
            status: 'in_progress'
        });

        if (!attempt) {
            return res.status(404).json({
                success: false,
                message: 'Attempt not found or already submitted'
            });
        }

        // Update progress
        attempt.answers = answers;
        attempt.tabSwitchCount = tabSwitchCount || attempt.tabSwitchCount;
        attempt.tabSwitchLog = tabSwitchLog || attempt.tabSwitchLog;

        await attempt.save();

        res.json({
            success: true,
            message: 'Progress saved'
        });
    } catch (error) {
        console.error('Error saving guest progress:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
