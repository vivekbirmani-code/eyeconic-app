const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const GuestAttempt = require('../models/GuestAttempt');
const QuizAttempt = require('../models/QuizAttempt');
const Otp = require('../models/Otp');
const { sendOtpMail, sendPasswordResetMail } = require('../utils/mailer');
const { auth } = require('../middleware/auth');
const requireDatabase = require('../middleware/requireDatabase');
const logger = require('../utils/logger');

const router = express.Router();

// Login
router.post('/login', requireDatabase, async (req, res) => {
  const loginStart = Date.now();
  try {
    const { email, password, guestId } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: 'Email and password are required.',
        code: 'VALIDATION_ERROR',
        requestId: req.requestId,
      });
    }

    if (!process.env.JWT_SECRET) {
      logger.error('Login blocked — JWT_SECRET not configured', { requestId: req.requestId });
      return res.status(503).json({
        message: 'Our servers are temporarily unavailable. Please try again in a few moments.',
        code: 'SERVICE_UNAVAILABLE',
        requestId: req.requestId,
      });
    }

    // Find user
    const user = await User.findOne({ email: email.trim().toLowerCase() });
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

    logger.info('Login successful', {
      requestId: req.requestId,
      userId: user._id,
      durationMs: Date.now() - loginStart,
    });

    res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isFreeUser: user.isFreeUser,
        freeUserProfile: user.freeUserProfile,
        isProfileComplete: user.isProfileComplete,
        studentProfile: user.studentProfile,
        unseenQuizzes: user.unseenQuizzes
      },
      linkedAttempts
    });
  } catch (error) {
    logger.error('Login failed', {
      requestId: req.requestId,
      errorMessage: error.message,
      durationMs: Date.now() - loginStart,
    });
    res.status(500).json({
      message: "We're unable to process your request right now. Please try again shortly.",
      code: 'INTERNAL_ERROR',
      requestId: req.requestId,
    });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    // Fetch fresh user data from database to ensure latest changes (e.g., isProfileComplete)
    const user = await User.findById(req.user._id).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Send verification email OTP
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email address is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: 'This email is already registered.' });
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP in database (overwrite any existing OTP for this email)
    await Otp.findOneAndUpdate(
      { email: normalizedEmail },
      { otp, createdAt: new Date() },
      { upsert: true, new: true }
    );

    // Send email
    await sendOtpMail(normalizedEmail, otp);

    res.json({ message: 'Verification code sent to email.' });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Verify OTP and complete signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, phone, password, otp } = req.body;

    if (!name || !email || !password || !otp) {
      return res.status(400).json({ message: 'Please fill in all required fields (Name, Email, Password, OTP)' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Find OTP record
    const otpRecord = await Otp.findOne({ email: normalizedEmail });
    if (!otpRecord || otpRecord.otp !== otp.trim()) {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }

    // Create user
    const user = new User({
      name: name.trim(),
      email: normalizedEmail,
      phone: phone ? phone.trim() : undefined,
      password,
      role: 'student',
      isFreeUser: true,
      isProfileComplete: false
    });

    await user.save();

    // Generate JWT
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Delete OTP record
    await Otp.deleteOne({ _id: otpRecord._id });

    res.status(201).json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isFreeUser: user.isFreeUser,
        isProfileComplete: user.isProfileComplete,
        unseenQuizzes: user.unseenQuizzes
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Send password reset OTP
router.post('/forgot-password-send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email address is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user exists
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ message: 'No account found with this email address.' });
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP in database
    await Otp.findOneAndUpdate(
      { email: normalizedEmail },
      { otp, createdAt: new Date() },
      { upsert: true, new: true }
    );

    // Send email
    await sendPasswordResetMail(normalizedEmail, otp);

    res.json({ message: 'Password reset verification code sent to email.' });
  } catch (error) {
    console.error('Error sending reset OTP:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reset password using OTP
router.post('/forgot-password-reset', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: 'Please provide email, verification code, and new password.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Find OTP record
    const otpRecord = await Otp.findOne({ email: normalizedEmail });
    if (!otpRecord || otpRecord.otp !== otp.trim()) {
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    // Find user
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Update password
    user.password = newPassword.trim();
    await user.save();

    // Delete OTP record
    await Otp.deleteOne({ _id: otpRecord._id });

    res.json({ message: 'Password reset successful! You can now log in with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;