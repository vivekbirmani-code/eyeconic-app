const express = require('express');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const Group = require('../models/Group');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// Get all quizzes (role-based access)
router.get('/', auth, async (req, res) => {
  try {
    let quizzes;
    
    if (req.user.role === 'admin') {
      // Admin sees all quizzes
      quizzes = await Quiz.find({ isActive: true })
        .populate('createdBy', 'name')
        .populate('assignedGroups', 'name');
    } else if (req.user.role === 'mentor') {
      // Mentor sees quizzes assigned to their groups
      const userGroups = await Group.find({ members: req.user._id });
      const groupIds = userGroups.map(group => group._id);
      
      quizzes = await Quiz.find({
        isActive: true,
        assignedGroups: { $in: groupIds }
      })
        .populate('createdBy', 'name')
        .populate('assignedGroups', 'name');
    } else {
      // Student sees quizzes assigned to their groups
      const userGroups = await Group.find({ members: req.user._id });
      const groupIds = userGroups.map(group => group._id);
      
      quizzes = await Quiz.find({
        isActive: true,
        assignedGroups: { $in: groupIds }
      })
        .populate('createdBy', 'name')
        .populate('assignedGroups', 'name');
    }
    
    res.json(quizzes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create quiz (Admin only)
router.post('/', auth, authorize('admin'), async (req, res) => {
  try {
    const { title, subject, questions, assignedGroups } = req.body;

    const quiz = new Quiz({
      title,
      subject,
      questions,
      assignedGroups: assignedGroups || [],
      createdBy: req.user._id
    });

    await quiz.save();
    await quiz.populate('createdBy', 'name');
    await quiz.populate('assignedGroups', 'name');

    res.status(201).json(quiz);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get quiz by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id)
      .populate('createdBy', 'name')
      .populate('assignedGroups', 'name');
    
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Check access permissions
    if (req.user.role !== 'admin') {
      const userGroups = await Group.find({ members: req.user._id });
      const userGroupIds = userGroups.map(group => group._id.toString());
      const quizGroupIds = quiz.assignedGroups.map(group => group._id.toString());
      
      const hasAccess = quizGroupIds.some(groupId => userGroupIds.includes(groupId));
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    res.json(quiz);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Submit quiz attempt (Student only)
router.post('/:id/attempt', auth, authorize('student'), async (req, res) => {
  try {
    const { answers } = req.body;
    
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Check if student has access to this quiz
    const userGroups = await Group.find({ members: req.user._id });
    const userGroupIds = userGroups.map(group => group._id.toString());
    const quizGroupIds = quiz.assignedGroups.map(group => group._id.toString());
    
    const hasAccess = quizGroupIds.some(groupId => userGroupIds.includes(groupId));
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Calculate score
    let score = 0;
    answers.forEach((answer, index) => {
      if (quiz.questions[index] && answer.selectedAnswer === quiz.questions[index].correctAnswer) {
        score++;
      }
    });

    const attempt = new QuizAttempt({
      quiz: quiz._id,
      student: req.user._id,
      answers,
      score,
      totalQuestions: quiz.questions.length
    });

    await attempt.save();

    res.status(201).json({
      score,
      totalQuestions: quiz.questions.length,
      percentage: Math.round((score / quiz.questions.length) * 100)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get quiz attempts (Admin and Mentor)
router.get('/:id/attempts', auth, authorize('admin', 'mentor'), async (req, res) => {
  try {
    const attempts = await QuizAttempt.find({ quiz: req.params.id })
      .populate('student', 'name email')
      .sort({ createdAt: -1 });

    res.json(attempts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;