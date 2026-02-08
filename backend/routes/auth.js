const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const GuestAttempt = require('../models/GuestAttempt');
const QuizAttempt = require('../models/QuizAttempt');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password, guestId } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Link guest attempts to user if guestId is provided
    let linkedAttempts = 0;
    if (guestId) {
      try {
        const guestAttempts = await GuestAttempt.find({
          guestId,
          status: 'completed',
          linkedUser: null
        });

        for (const guestAttempt of guestAttempts) {
          // Check if user already has an attempt for this quiz
          const existingAttempt = await QuizAttempt.findOne({
            quiz: guestAttempt.quiz,
            student: user._id
          });

          if (!existingAttempt) {
            // Create a new QuizAttempt from guest attempt
            const newAttempt = new QuizAttempt({
              quiz: guestAttempt.quiz,
              student: user._id,
              answers: guestAttempt.answers,
              startTime: guestAttempt.startTime,
              endTime: guestAttempt.endTime,
              status: guestAttempt.status,
              score: guestAttempt.score,
              totalQuestions: guestAttempt.totalQuestions,
              marksObtained: guestAttempt.marksObtained,
              totalMarks: guestAttempt.totalMarks,
              tabSwitchCount: guestAttempt.tabSwitchCount,
              tabSwitchLog: guestAttempt.tabSwitchLog
            });

            await newAttempt.save();
            linkedAttempts++;
          }

          // Mark guest attempt as linked
          guestAttempt.linkedUser = user._id;
          await guestAttempt.save();
        }

        if (linkedAttempts > 0) {
          console.log(`Linked ${linkedAttempts} guest attempts to user ${user.email}`);
        }
      } catch (linkError) {
        console.error('Error linking guest attempts:', linkError);
        // Don't fail login if linking fails
      }
    }

    res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isProfileComplete: user.isProfileComplete,
        studentProfile: user.studentProfile
      },
      linkedAttempts
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    res.json(req.user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;