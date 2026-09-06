// Rate limiting for the public-quiz guest OTP flow. Mechanics copied from
// middleware/otpRateLimit.js (in-memory Maps, pruned on access, counted
// only on 2xx via res.on('finish')). Two dimensions for sends:
//   - per EMAIL: 3 sends / 10 min + 60 s minimum interval (resend cooldown)
//   - per IP:    10 sends / 10 min (mail-bombing / cost-abuse guard)
// Verify: 5 failed attempts / 15 min per email -> 429 before the handler.
//
// NOTE: in-memory state is per-process. The backend currently runs as a
// single Render instance (same caveat as otpRateLimit.js); move to Redis
// if the service ever scales horizontally.
const logger = require('../utils/logger');
const { getClientIp } = require('./otpRateLimit');

const SEND_WINDOW_MS = 10 * 60 * 1000;
const SEND_MAX_PER_EMAIL = 3;
const SEND_MAX_PER_IP = 10;
const SEND_MIN_INTERVAL_MS = 60 * 1000;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_MAX_ATTEMPTS = 5;

const sendAttemptsByEmail = new Map();
const sendAttemptsByIp = new Map();
const verifyAttempts = new Map();

const pruneOldEntries = (store, windowMs) => {
  const cutoff = Date.now() - windowMs;
  for (const [key, entry] of store.entries()) {
    if (entry.updatedAt < cutoff) {
      store.delete(key);
    }
  }
};

const recordSend = (store, key) => {
  const now = Date.now();
  const current = store.get(key) || { count: 0, lastSentAt: 0, updatedAt: now };
  current.count += 1;
  current.lastSentAt = Date.now();
  current.updatedAt = Date.now();
  store.set(key, current);
};

const createRateLimitResponse = (req, res) =>
  res.status(429).json({
    success: false,
    message: 'Too many requests. Please wait a moment and try again.',
    code: 'RATE_LIMITED',
    requestId: req.requestId,
  });

// Rate-limit key for an email: trimmed + lowercased, so casing/whitespace
// variants of one address cannot shard it into several buckets. (Storage/
// verification always use the same normalized form from otpHelpers.)
const emailRateKey = (raw) => {
  const key = String(raw || '').trim().toLowerCase();
  return key || null;
};

/**
 * Limits guest OTP send/resend frequency per email AND per IP.
 */
const guestOtpSendRateLimit = (req, res, next) => {
  const email = emailRateKey(req.body?.email);
  const ip = getClientIp(req);
  if (!email) {
    return next();
  }

  pruneOldEntries(sendAttemptsByEmail, SEND_WINDOW_MS);
  pruneOldEntries(sendAttemptsByIp, SEND_WINDOW_MS);

  const now = Date.now();
  const emailEntry = sendAttemptsByEmail.get(email) || { count: 0, lastSentAt: 0, updatedAt: now };
  const ipEntry = sendAttemptsByIp.get(ip) || { count: 0, lastSentAt: 0, updatedAt: now };

  if (emailEntry.lastSentAt && now - emailEntry.lastSentAt < SEND_MIN_INTERVAL_MS) {
    logger.warn('[GUEST OTP] Send rate limited — minimum interval', {
      requestId: req.requestId,
      email,
    });
    return createRateLimitResponse(req, res);
  }

  if (emailEntry.count >= SEND_MAX_PER_EMAIL) {
    logger.warn('[GUEST OTP] Send rate limited — email max attempts', {
      requestId: req.requestId,
      email,
    });
    return createRateLimitResponse(req, res);
  }

  if (ipEntry.count >= SEND_MAX_PER_IP) {
    logger.warn('[GUEST OTP] Send rate limited — IP max attempts', {
      requestId: req.requestId,
      ip,
    });
    return createRateLimitResponse(req, res);
  }

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return;
    }
    recordSend(sendAttemptsByEmail, email);
    recordSend(sendAttemptsByIp, ip);
  });

  return next();
};

/**
 * Limits guest OTP verification brute-force attempts per email.
 */
const guestOtpVerifyRateLimit = (req, res, next) => {
  const email = emailRateKey(req.body?.email);
  if (!email) {
    return next();
  }

  pruneOldEntries(verifyAttempts, VERIFY_WINDOW_MS);
  const entry = verifyAttempts.get(email);

  if (entry && entry.count >= VERIFY_MAX_ATTEMPTS) {
    logger.warn('[GUEST OTP] Verify rate limited', {
      requestId: req.requestId,
      email,
    });
    return createRateLimitResponse(req, res);
  }

  return next();
};

const recordGuestVerifyFailure = (rawEmail) => {
  const email = emailRateKey(rawEmail);
  if (!email) return;
  const now = Date.now();
  const entry = verifyAttempts.get(email) || { count: 0, updatedAt: now };
  entry.count += 1;
  entry.updatedAt = now;
  verifyAttempts.set(email, entry);
};

const clearGuestVerifyAttempts = (rawEmail) => {
  const email = emailRateKey(rawEmail);
  if (!email) return;
  verifyAttempts.delete(email);
};

// Test helper — resets the in-memory limiter state between suites.
const resetGuestOtpRateLimits = () => {
  sendAttemptsByEmail.clear();
  sendAttemptsByIp.clear();
  verifyAttempts.clear();
};

module.exports = {
  guestOtpSendRateLimit,
  guestOtpVerifyRateLimit,
  recordGuestVerifyFailure,
  clearGuestVerifyAttempts,
  resetGuestOtpRateLimits,
};
