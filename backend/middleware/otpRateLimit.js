const logger = require('../utils/logger');

const SEND_WINDOW_MS = 10 * 60 * 1000;
const SEND_MAX_PER_EMAIL = 3;
const SEND_MIN_INTERVAL_MS = 60 * 1000;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_MAX_ATTEMPTS = 5;

const sendAttempts = new Map();
const verifyAttempts = new Map();

const pruneOldEntries = (store, windowMs) => {
  const cutoff = Date.now() - windowMs;
  for (const [key, entry] of store.entries()) {
    if (entry.updatedAt < cutoff) {
      store.delete(key);
    }
  }
};

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
};

const createRateLimitResponse = (req, res) =>
  res.status(429).json({
    success: false,
    message: 'Too many requests. Please wait a moment and try again.',
    code: 'RATE_LIMITED',
    requestId: req.requestId,
  });

/**
 * Limits OTP send/resend frequency per email address.
 */
const otpSendRateLimit = (req, res, next) => {
  const email = req.body?.email?.trim().toLowerCase();
  if (!email) {
    return next();
  }

  pruneOldEntries(sendAttempts, SEND_WINDOW_MS);
  const key = email;
  const now = Date.now();
  const entry = sendAttempts.get(key) || { count: 0, lastSentAt: 0, updatedAt: now };

  if (entry.lastSentAt && now - entry.lastSentAt < SEND_MIN_INTERVAL_MS) {
    logger.warn('[OTP] Send rate limited — minimum interval', {
      requestId: req.requestId,
      email,
    });
    return createRateLimitResponse(req, res);
  }

  if (entry.count >= SEND_MAX_PER_EMAIL) {
    logger.warn('[OTP] Send rate limited — max attempts', {
      requestId: req.requestId,
      email,
    });
    return createRateLimitResponse(req, res);
  }

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return;
    }

    const current = sendAttempts.get(key) || { count: 0, lastSentAt: 0, updatedAt: now };
    current.count += 1;
    current.lastSentAt = Date.now();
    current.updatedAt = Date.now();
    sendAttempts.set(key, current);
  });

  return next();
};

/**
 * Limits OTP verification brute-force attempts per email address.
 */
const otpVerifyRateLimit = (req, res, next) => {
  const email = req.body?.email?.trim().toLowerCase();
  if (!email) {
    return next();
  }

  pruneOldEntries(verifyAttempts, VERIFY_WINDOW_MS);
  const entry = verifyAttempts.get(email);

  if (entry && entry.count >= VERIFY_MAX_ATTEMPTS) {
    logger.warn('[OTP] Verify rate limited', {
      requestId: req.requestId,
      email,
    });
    return createRateLimitResponse(req, res);
  }

  return next();
};

const recordVerifyFailure = (email) => {
  if (!email) return;
  const normalized = email.trim().toLowerCase();
  const now = Date.now();
  const entry = verifyAttempts.get(normalized) || { count: 0, updatedAt: now };
  entry.count += 1;
  entry.updatedAt = now;
  verifyAttempts.set(normalized, entry);
};

const clearVerifyAttempts = (email) => {
  if (!email) return;
  verifyAttempts.delete(email.trim().toLowerCase());
};

module.exports = {
  otpSendRateLimit,
  otpVerifyRateLimit,
  recordVerifyFailure,
  clearVerifyAttempts,
  getClientIp,
};
