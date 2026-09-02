const express = require('express');
const multer = require('multer');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');
const { emitToAdmins } = require('../utils/socket-helpers');
const {
  validateProfilePictureFile,
  uploadProfilePicture,
  deleteProfilePictureAsset,
  toClientUser,
  MAX_FILE_SIZE_BYTES,
  CloudinaryConfigError,
} = require('../utils/profilePicture');
const { getCloudinaryHealthStatus } = require('../utils/cloudinary');
const { normalizeEmail, isValidEmail } = require('../utils/otpHelpers');

const router = express.Router();

const profilePictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

// Get all users (Admin only)
router.get('/', auth, authorize('admin'), async (req, res) => {
  try {
    const { role } = req.query;
    let query = {};
    if (role) {
      query.role = role;
    }
    const users = await User.find(query).select('-password -profilePicturePublicId');
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

    const users = await User.find(query).select('-password -profilePicturePublicId').limit(20);
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

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.isFreeUser) {
      const { year, issues, resources, isReadyToTransform } = req.body;

      // Validate required fields for free user persona
      if (!year || !issues || !resources) {
        return res.status(400).json({ message: 'Please fill in all required fields (Year, Issues, Resources)' });
      }

      // Update free user profile
      user.freeUserProfile = {
        year,
        issues,
        resources,
        isReadyToTransform: !!isReadyToTransform
      };
      user.isProfileComplete = true;

      await user.save();

      // Notify all admins that a user's profile was updated
      emitToAdmins('user_updated', { userId: user._id.toString() });

      return res.json({
        message: 'Profile updated successfully',
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isFreeUser: user.isFreeUser,
          freeUserProfile: user.freeUserProfile,
          isProfileComplete: user.isProfileComplete
        }
      });
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

    // Validate required fields for normal students
    if (!mbbsBatch || !collegeName || !batchType) {
      return res.status(400).json({ message: 'Please fill in all required fields' });
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

    // Notify all admins that a user's profile was updated
    emitToAdmins('user_updated', { userId: user._id.toString() });

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

// Upload or replace profile picture (authenticated user only — own account)
router.post('/profile-picture', auth, profilePictureUpload.single('image'), async (req, res) => {
  try {
    const cloudinaryStatus = getCloudinaryHealthStatus();
    if (!cloudinaryStatus.configured) {
      return res.status(503).json({
        success: false,
        message: 'Profile picture uploads are unavailable because Cloudinary is not configured on the server. Please contact support.',
        code: 'CLOUDINARY_NOT_CONFIGURED',
        requestId: req.requestId,
      });
    }

    const validation = validateProfilePictureFile(req.file);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
        code: 'VALIDATION_ERROR',
        requestId: req.requestId,
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const previousPublicId = user.profilePicturePublicId;
    const uploadResult = await uploadProfilePicture(
      req.file.buffer,
      validation.mimeType,
      user._id.toString()
    );

    user.profilePicture = uploadResult.url;
    user.profilePicturePublicId = uploadResult.publicId;
    await user.save();

    if (previousPublicId && previousPublicId !== uploadResult.publicId) {
      await deleteProfilePictureAsset(previousPublicId);
    }

    emitToAdmins('user_updated', { userId: user._id.toString() });

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      user: toClientUser(user),
    });
  } catch (error) {
    if (error instanceof CloudinaryConfigError) {
      console.error('Profile picture upload blocked — Cloudinary not configured:', error.missingVars);
      return res.status(error.statusCode).json({
        success: false,
        message: 'Profile picture uploads are temporarily unavailable. Please try again later or contact support.',
        code: error.code,
        requestId: req.requestId,
      });
    }

    console.error('Profile picture upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile picture. Please try again.',
      code: 'UPLOAD_FAILED',
      requestId: req.requestId,
    });
  }
});

// Remove profile picture (authenticated user only — own account)
router.delete('/profile-picture', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.profilePicture && !user.profilePicturePublicId) {
      return res.json({
        success: true,
        message: 'No profile picture to remove',
        user: toClientUser(user),
      });
    }

    const previousPublicId = user.profilePicturePublicId;
    user.profilePicture = null;
    user.profilePicturePublicId = null;
    await user.save();

    if (previousPublicId) {
      await deleteProfilePictureAsset(previousPublicId);
    }

    emitToAdmins('user_updated', { userId: user._id.toString() });

    res.json({
      success: true,
      message: 'Profile picture removed successfully',
      user: toClientUser(user),
    });
  } catch (error) {
    if (error instanceof CloudinaryConfigError) {
      return res.status(error.statusCode).json({
        success: false,
        message: 'Profile picture removal is temporarily unavailable. Please try again later.',
        code: error.code,
        requestId: req.requestId,
      });
    }

    console.error('Profile picture removal error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove profile picture',
      code: 'DELETE_FAILED',
      requestId: req.requestId,
    });
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

// Get users by role (Admin only) - MUST be before /:id
router.get('/role/:role', auth, authorize('admin'), async (req, res) => {
  try {
    const { role } = req.params;
    if (!['mentor', 'student', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    const users = await User.find({ role }).select('_id name email role').sort({ name: 1 });
    res.json(users);
  } catch (error) {
    console.error('Error fetching users by role:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password -profilePicturePublicId');
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
    const { name, email, role, isFreeUser } = req.body;

    // Check permissions
    if (req.user.role !== 'admin' && req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updateData = { name, email };
    if (req.user.role === 'admin') {
      updateData.role = role;
      if (isFreeUser !== undefined) {
        updateData.isFreeUser = isFreeUser;
      }
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).select('-password -profilePicturePublicId');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Notify all admins that a user was updated
    emitToAdmins('user_updated', { userId: user._id.toString() });

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user email (Admin only)
// Email is the login identity, but logins, password-reset OTPs and JWTs are
// resolved by the user id, so this single record is the only one to update.
router.put('/:id/email', auth, authorize('admin'), async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string' || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    const normalizedEmail = normalizeEmail(email);

    const user = await User.findById(req.params.id).select('email');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.email === normalizedEmail) {
      return res.status(400).json({ message: 'New email is the same as the current email.' });
    }

    const existingUser = await User.findOne({
      email: normalizedEmail,
      _id: { $ne: user._id },
    }).select('_id');
    if (existingUser) {
      return res.status(400).json({ message: 'This email is already in use by another user.' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { email: normalizedEmail },
      { new: true }
    ).select('-password -profilePicturePublicId');

    // Notify all admins that a user was updated
    emitToAdmins('user_updated', { userId: updatedUser._id.toString() });

    res.json(updatedUser);
  } catch (error) {
    // Another request can claim the email between the pre-check and the write
    if (error && error.code === 11000) {
      return res.status(400).json({ message: 'This email is already in use by another user.' });
    }
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

// Save Expo push token for user
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

// Save raw FCM device token for direct notification delivery
router.post('/fcm-token', auth, async (req, res) => {
  try {
    const { fcmToken } = req.body;

    if (!fcmToken) {
      return res.status(400).json({ message: 'FCM token is required' });
    }

    await User.findByIdAndUpdate(req.user._id, { fcmToken });
    console.log(`FCM token saved for user ${req.user._id}`);

    res.json({ message: 'FCM token saved successfully' });
  } catch (error) {
    console.error('Error saving FCM token:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;