const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const WebHandoffCode = require('../models/WebHandoffCode');
const User = require('../models/User');
const serviceAuth = require('../middleware/serviceAuth');
const requireDatabase = require('../middleware/requireDatabase');
const logger = require('../utils/logger');
const { toClientUser } = require('../utils/profilePicture');
const { isValidEmail, normalizeEmail } = require('../utils/otpHelpers');

/**
 * Website-integration endpoints (versioned, service-authenticated).
 *
 * Caller: the Eyeconic marketing website's server only (server-to-server,
 * no browser CORS surface). Every route requires the shared service token
 * (middleware/serviceAuth.js) — which by itself grants no data access; each
 * route also needs proof created by a real signed-in user.
 *
 * Mounted at /api/integration/v1 in server.js and gated by its own
 * `integration` flag in config/featureAvailability.js so the quiz-only
 * feature freeze can never touch it.
 */

const router = express.Router();

// Handoff codes are base64url(32 bytes) when we generate them; be lenient in
// what we accept so the format can evolve, but keep a hard upper bound.
const CODE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const HANDOFF_TTL_MS = Number(process.env.WEB_HANDOFF_TTL_SECONDS || 120) * 1000;

// Simple per-IP abuse brake for failed consumes (in-memory; this API has a
// single process on Render today, same trade-off as middleware/otpRateLimit).
const CONSUME_FAIL_LIMIT = 20;
const CONSUME_FAIL_WINDOW_MS = 10 * 60 * 1000;
const consumeFailures = new Map();

const tooManyConsumeFailures = (ip) => {
  const now = Date.now();
  const entry = consumeFailures.get(ip);
  if (!entry) return false;
  const recent = entry.filter((ts) => now - ts < CONSUME_FAIL_WINDOW_MS);
  if (recent.length === 0) {
    consumeFailures.delete(ip);
    return false;
  }
  return recent.length >= CONSUME_FAIL_LIMIT;
};

const recordConsumeFailure = (ip) => {
  const now = Date.now();
  const entry = (consumeFailures.get(ip) || []).filter((ts) => now - ts < CONSUME_FAIL_WINDOW_MS);
  entry.push(now);
  consumeFailures.set(ip, entry);
};

// Periodically drop stale entries so the map cannot grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, stamps] of consumeFailures) {
    const recent = stamps.filter((ts) => now - ts < CONSUME_FAIL_WINDOW_MS);
    if (recent.length === 0) consumeFailures.delete(ip);
    else consumeFailures.set(ip, recent);
  }
}, CONSUME_FAIL_WINDOW_MS).unref();

const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex');

const invalidHandoffResponse = (req, res, message) =>
  res.status(400).json({
    success: false,
    message,
    code: 'HANDOFF_INVALID',
    requestId: req.requestId,
  });

/**
 * POST /api/integration/v1/handoff/consume
 * Body: { code }
 *
 * Exchanges a single-use handoff code (created by POST /api/auth/web-handoff
 * on behalf of a signed-in user) for a fresh 7-day user JWT + public profile.
 * The response is only ever delivered to the authenticated website server,
 * which keeps the token in an HttpOnly session — the browser never sees it.
 */
router.post('/handoff/consume', requireDatabase, serviceAuth, async (req, res) => {
  try {
    if (tooManyConsumeFailures(req.ip)) {
      return res.status(429).json({
        success: false,
        message: 'Too many invalid handoff attempts. Please try again later.',
        code: 'RATE_LIMITED',
        requestId: req.requestId,
      });
    }

    const code = String((req.body || {}).code || '').trim();
    if (!CODE_PATTERN.test(code)) {
      recordConsumeFailure(req.ip);
      return invalidHandoffResponse(
        req,
        res,
        'This link is invalid or has expired. Please reopen the website from the Eyeconic app.'
      );
    }

    // Atomic single-use: only the request that flips usedAt wins. This is
    // what makes a copied/replayed URL worthless even under a race.
    const claimed = await WebHandoffCode.findOneAndUpdate(
      { codeHash: hashCode(code), usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true }
    );

    if (!claimed) {
      recordConsumeFailure(req.ip);
      return invalidHandoffResponse(
        req,
        res,
        'This link is invalid or has expired. Please reopen the website from the Eyeconic app.'
      );
    }

    const user = await User.findById(claimed.user).select('-password -profilePicturePublicId');
    if (!user || user.isActive === false) {
      logger.warn('Handoff code consumed for a missing/inactive user', {
        requestId: req.requestId,
        userId: String(claimed.user),
      });
      return invalidHandoffResponse(
        req,
        res,
        'This account is no longer available. Please log in on the website directly.'
      );
    }

    if (!process.env.JWT_SECRET) {
      logger.error('Handoff consume blocked — JWT_SECRET not configured', {
        requestId: req.requestId,
      });
      return res.status(503).json({
        success: false,
        message: 'Our servers are temporarily unavailable. Please try again in a few moments.',
        code: 'SERVICE_UNAVAILABLE',
        requestId: req.requestId,
      });
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    logger.info('Website handoff consumed', {
      requestId: req.requestId,
      userId: String(user._id),
    });

    return res.json({
      success: true,
      token,
      user: toClientUser(user),
    });
  } catch (error) {
    logger.error('Handoff consume failed', {
      requestId: req.requestId,
      errorMessage: error.message,
      errorName: error.name,
    });
    return res.status(500).json({
      success: false,
      message: 'Server error while validating this link.',
      code: 'INTERNAL_ERROR',
      requestId: req.requestId,
    });
  }
});

/**
 * POST /api/integration/v1/free-user/signup
 * Body: { name, email, phone, password }
 *
 * Creates a free visitor account for the marketing website's "GT Score
 * Predictor" funnel. The website server calls this service-to-server right
 * after its own validation + IP rate limit; the account lands in the SAME
 * User collection that /api/auth/login authenticates against, so a user
 * created here can immediately sign in on the website (via the website's
 * /api/app-auth/login proxy) or in the mobile app.
 *
 * Shape mirrors the app's own OTP signup (role 'student', isFreeUser true)
 * except that no email OTP is required — the website funnel has never had
 * one and the caller is the trusted website server, not a browser. This
 * endpoint is therefore NOT gated by the admin public-signup toggle
 * (isSignUpEnabled governs the app's own OTP funnel only).
 *
 * Deliberately returns no token: on the website, sign-up is a separate step
 * from sign-in (the UI shows a success notice, then the user logs in
 * explicitly through the normal login route).
 */
router.post('/free-user/signup', requireDatabase, serviceAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const email = normalizeEmail(String(body.email || ''));
    const phone = body.phone === undefined || body.phone === null
      ? ''
      : String(body.phone).replace(/[\s\-()]/g, '');
    const password = typeof body.password === 'string' ? body.password : '';

    const invalid = (message) =>
      res.status(400).json({
        success: false,
        message,
        code: 'VALIDATION_ERROR',
        requestId: req.requestId,
      });

    if (name.length < 2 || name.length > 80) {
      return invalid('Name must be 2-80 characters.');
    }
    if (!isValidEmail(email)) {
      return invalid('A valid email is required.');
    }
    // Phone is optional at this layer (the website's public form requires it
    // and validates before proxying); if present it must be digits, 8-15.
    if (phone && !/^\+?[0-9]{8,15}$/.test(phone)) {
      return invalid('A valid phone number is required.');
    }
    // Matches the model's minlength 6 and bcrypt's 72-byte input cap.
    if (password.length < 6 || password.length > 72) {
      return invalid('Password must be 6-72 characters.');
    }

    const emailTaken = (statusCode) =>
      res.status(statusCode).json({
        success: false,
        message: 'An account with this email already exists.',
        code: 'EMAIL_TAKEN',
        requestId: req.requestId,
      });

    const existingUser = await User.findOne({ email }).lean();
    if (existingUser) {
      return emailTaken(400);
    }

    // The pre-save hook hashes the password with bcrypt.
    const user = new User({
      name,
      email,
      phone: phone || undefined,
      password,
      role: 'student',
      isFreeUser: true,
      isProfileComplete: false,
    });
    await user.save();

    logger.info('Website free-user signup', {
      requestId: req.requestId,
      userId: String(user._id),
    });

    return res.status(201).json({
      success: true,
      user: toClientUser(user),
    });
  } catch (error) {
    // Unique-index race between the findOne and the save.
    if (error && error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists.',
        code: 'EMAIL_TAKEN',
        requestId: req.requestId,
      });
    }
    logger.error('Website free-user signup failed', {
      requestId: req.requestId,
      errorMessage: error.message,
      errorName: error.name,
    });
    return res.status(500).json({
      success: false,
      message: 'Could not create the account. Please try again.',
      code: 'INTERNAL_ERROR',
      requestId: req.requestId,
    });
  }
});

module.exports = router;
