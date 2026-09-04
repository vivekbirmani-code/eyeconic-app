const express = require('express');
const { auth, authorize } = require('../middleware/auth');
const requireDatabase = require('../middleware/requireDatabase');
const logger = require('../utils/logger');
const { getAppSettings, setSignUpEnabled } = require('../utils/appSettings');

const router = express.Router();

/**
 * Public app settings (no auth — the login screen needs these before a
 * session exists). Only exposes flags that are safe to show pre-auth;
 * this is a UI hint, never an authorization decision: every gated action
 * (e.g. /api/auth/send-otp, /api/auth/signup) re-checks server-side.
 */
router.get('/public', requireDatabase, async (req, res) => {
  try {
    const settings = await getAppSettings();
    res.json({
      success: true,
      signUpEnabled: Boolean(settings?.signUpEnabled),
    });
  } catch (error) {
    logger.error('Failed to read public app settings', {
      requestId: req.requestId,
      errorMessage: error.message,
    });
    // Fail closed — clients treat any failure as "sign-up unavailable".
    res.status(500).json({
      success: false,
      signUpEnabled: false,
      message: "We're unable to process your request right now. Please try again shortly.",
      code: 'INTERNAL_ERROR',
      requestId: req.requestId,
    });
  }
});

// Admin-only routes below
router.use(auth);

// Full settings (admin) — includes who last changed the toggle
router.get('/', authorize('admin'), async (req, res) => {
  try {
    const settings = await getAppSettings();
    res.json({
      success: true,
      signUpEnabled: Boolean(settings?.signUpEnabled),
      updatedAt: settings?.updatedAt || null,
      updatedBy: settings?.updatedBy || null,
    });
  } catch (error) {
    logger.error('Failed to read app settings', {
      requestId: req.requestId,
      errorMessage: error.message,
    });
    res.status(500).json({
      success: false,
      message: 'Server error',
      code: 'INTERNAL_ERROR',
      requestId: req.requestId,
    });
  }
});

// Toggle public sign-up (admin only)
router.put('/signup-enabled', authorize('admin'), async (req, res) => {
  try {
    const { signUpEnabled } = req.body;

    if (typeof signUpEnabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'signUpEnabled must be true or false.',
        code: 'VALIDATION_ERROR',
        requestId: req.requestId,
      });
    }

    const settings = await setSignUpEnabled(signUpEnabled, req.user._id);

    logger.info('Public sign-up setting updated', {
      requestId: req.requestId,
      adminId: req.user._id,
      signUpEnabled: settings.signUpEnabled,
    });

    res.json({
      success: true,
      signUpEnabled: settings.signUpEnabled,
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedBy,
    });
  } catch (error) {
    logger.error('Failed to update sign-up setting', {
      requestId: req.requestId,
      adminId: req.user?._id,
      errorMessage: error.message,
    });
    res.status(500).json({
      success: false,
      message: 'Server error',
      code: 'INTERNAL_ERROR',
      requestId: req.requestId,
    });
  }
});

module.exports = router;
