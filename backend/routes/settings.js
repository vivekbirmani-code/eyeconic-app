const express = require('express');
const { auth, authorize } = require('../middleware/auth');
const requireDatabase = require('../middleware/requireDatabase');
const logger = require('../utils/logger');
const { getAppSettings, setSignUpEnabled, setProctoringEnabled, setProctoringStrictCvEnabled } = require('../utils/appSettings');

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

// Full settings (admin) — includes who last changed the toggles
router.get('/', authorize('admin'), async (req, res) => {
  try {
    const settings = await getAppSettings();
    res.json({
      success: true,
      signUpEnabled: Boolean(settings?.signUpEnabled),
      // AI proctoring rollout gates (plan §21.3/§31, decisions D8/D15).
      proctoringEnabled: Boolean(settings?.proctoringEnabled),
      proctoringStrictCv: Boolean(settings?.proctoringStrictCv),
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

// Toggle the AI proctoring global kill switch (admin only). This is the
// highest-precedence rollout gate: kill switch > aiProctoring feature flag >
// per-quiz opt-in. Flipping it off never touches in-flight attempts — their
// frozen policy snapshots ride to the end of the attempt (plan §31).
router.put('/proctoring-enabled', authorize('admin'), async (req, res) => {
  try {
    const { proctoringEnabled } = req.body;

    if (typeof proctoringEnabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'proctoringEnabled must be true or false.',
        code: 'VALIDATION_ERROR',
        requestId: req.requestId,
      });
    }

    const settings = await setProctoringEnabled(proctoringEnabled, req.user._id);

    logger.info('Proctoring kill switch updated', {
      requestId: req.requestId,
      adminId: req.user._id,
      proctoringEnabled: settings.proctoringEnabled,
    });

    res.json({
      success: true,
      proctoringEnabled: settings.proctoringEnabled,
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedBy,
    });
  } catch (error) {
    logger.error('Failed to update proctoring setting', {
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

// Toggle the restricted strict-CV enforcement gate (admin only, decision D8).
// NOT a per-quiz setting; stays false for the entire V1 rollout — enabling it
// is a recorded post-V1.1 rollout decision.
router.put('/proctoring-strict-cv', authorize('admin'), async (req, res) => {
  try {
    const { proctoringStrictCv } = req.body;

    if (typeof proctoringStrictCv !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'proctoringStrictCv must be true or false.',
        code: 'VALIDATION_ERROR',
        requestId: req.requestId,
      });
    }

    const settings = await setProctoringStrictCvEnabled(proctoringStrictCv, req.user._id);

    logger.info('Proctoring strict-CV gate updated', {
      requestId: req.requestId,
      adminId: req.user._id,
      proctoringStrictCv: settings.proctoringStrictCv,
    });

    res.json({
      success: true,
      proctoringStrictCv: settings.proctoringStrictCv,
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedBy,
    });
  } catch (error) {
    logger.error('Failed to update proctoring strict-CV setting', {
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
