const express = require('express');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// Get all users (Admin only)
router.get('/', auth, authorize('admin'), async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Search users by name or email (Admin only)
router.get('/search', auth, authorize('admin'), async (req, res) => {
  try {
    const { q, role } = req.query;

    let query = {};

    // Search by name, email, or phone
    if (q) {
      query.$or = [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } }
      ];
    }

    // Filter by role
    if (role && ['mentor', 'student', 'admin'].includes(role)) {
      query.role = role;
    }

    const users = await User.find(query).select('-password').limit(20);
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update student profile (Students only - for their own profile)
// IMPORTANT: This route MUST come before /:id routes
router.put('/profile', auth, async (req, res) => {
  try {
    // Only students can update their profile
    if (req.user.role !== 'student') {
      return res.status(403).json({ message: 'Only students can update their profile' });
    }

    const {
      mbbsBatch,
      collegeName,
      attemptNo,
      batchType,
      grandTestsGiven,
      averageCorrects,
      averageScore,
      weakestSubjects,
      targetBranch,
      subscriptions
    } = req.body;

    // Validate required fields
    if (!mbbsBatch || !collegeName || !batchType) {
      return res.status(400).json({ message: 'Please fill in all required fields' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update student profile
    user.studentProfile = {
      mbbsBatch,
      collegeName,
      attemptNo: attemptNo || 1,
      batchType,
      grandTestsGiven,
      averageCorrects,
      averageScore,
      weakestSubjects,
      targetBranch,
      subscriptions
    };
    user.isProfileComplete = true;

    await user.save();

    res.json({
      message: 'Profile updated successfully',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        studentProfile: user.studentProfile,
        isProfileComplete: user.isProfileComplete
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create user (Admin only)
router.post('/', auth, authorize('admin'), async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create user
    const user = new User({
      name,
      email,
      password,
      role,
      phone
    });

    await user.save();

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user (Admin only or own profile)
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, email, role } = req.body;

    // Check permissions
    if (req.user.role !== 'admin' && req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updateData = { name, email };
    if (req.user.role === 'admin') {
      updateData.role = role;
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reset password (Admin only)
router.post('/:id/reset-password', auth, authorize('admin'), async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update password (will be hashed by pre-save hook)
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Save push token for user
router.post('/push-token', auth, async (req, res) => {
  try {
    const { pushToken } = req.body;

    if (!pushToken) {
      return res.status(400).json({ message: 'Push token is required' });
    }

    await User.findByIdAndUpdate(req.user._id, { pushToken });

    res.json({ message: 'Push token saved successfully' });
  } catch (error) {
    console.error('Error saving push token:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;