// Rate limiting for the public-quiz guest OTP flow. Mechanics copied from
// middleware/otpRateLimit.js (in-memory Maps, pruned on access, counted
// only on 2xx via res.on('finish')). Two dimensions for sends:
//   - per PHONE: 3 sends / 10 min + 60 s minimum interval (resend cooldown)
//   - per IP:    10 sends / 10 min (SMS-bombing / cost-abuse guard)
// Verify: 5 failed attempts / 15 min per phone -> 429 before the handler.
//
// NOTE: in-memory state is per-process. The backend currently runs as a
// single Render instance (same caveat as otpRateLimit.js); move to Redis
// if the service ever scales horizontally.
const logger = require('../utils/logger');
const { getClientIp } = require('./otpRateLimit');

const SEND_WINDOW_MS = 10 * 60 * 1000;
const SEND_MAX_PER_PHONE = 3;
const SEND_MAX_PER_IP = 10;
const SEND_MIN_INTERVAL_MS = 60 * 1000;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_MAX_ATTEMPTS = 5;

const sendAttemptsByPhone = new Map();
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

// Rate-limit key for a phone: the last 10 digits, so formatting variants
// (+91…, 0…, spaces/dashes) cannot shard one number into several buckets.
// (Storage/verification always use the full E.164 form from utils/phone.)
const phoneRateKey = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.slice(-10) || null;
};

/**
 * Limits guest OTP send/resend frequency per phone AND per IP.
 */
const guestOtpSendRateLimit = (req, res, next) => {
  const phone = phoneRateKey(req.body?.phone);
  const ip = getClientIp(req);
  if (!phone) {
    return next();
  }

  pruneOldEntries(sendAttemptsByPhone, SEND_WINDOW_MS);
  pruneOldEntries(sendAttemptsByIp, SEND_WINDOW_MS);

  const now = Date.now();
  const phoneEntry = sendAttemptsByPhone.get(phone) || { count: 0, lastSentAt: 0, updatedAt: now };
  const ipEntry = sendAttemptsByIp.get(ip) || { count: 0, lastSentAt: 0, updatedAt: now };

  if (phoneEntry.lastSentAt && now - phoneEntry.lastSentAt < SEND_MIN_INTERVAL_MS) {
    logger.warn('[GUEST OTP] Send rate limited — minimum interval', {
      requestId: req.requestId,
      phone,
    });
    return createRateLimitResponse(req, res);
  }

  if (phoneEntry.count >= SEND_MAX_PER_PHONE) {
    logger.warn('[GUEST OTP] Send rate limited — phone max attempts', {
      requestId: req.requestId,
      phone,
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
    recordSend(sendAttemptsByPhone, phone);
    recordSend(sendAttemptsByIp, ip);
  });

  return next();
};

/**
 * Limits guest OTP verification brute-force attempts per phone.
 */
const guestOtpVerifyRateLimit = (req, res, next) => {
  const phone = phoneRateKey(req.body?.phone);
  if (!phone) {
    return next();
  }

  pruneOldEntries(verifyAttempts, VERIFY_WINDOW_MS);
  const entry = verifyAttempts.get(phone);

  if (entry && entry.count >= VERIFY_MAX_ATTEMPTS) {
    logger.warn('[GUEST OTP] Verify rate limited', {
      requestId: req.requestId,
      phone,
    });
    return createRateLimitResponse(req, res);
  }

  return next();
};

const recordGuestVerifyFailure = (rawPhone) => {
  const phone = phoneRateKey(rawPhone);
  if (!phone) return;
  const now = Date.now();
  const entry = verifyAttempts.get(phone) || { count: 0, updatedAt: now };
  entry.count += 1;
  entry.updatedAt = now;
  verifyAttempts.set(phone, entry);
};

const clearGuestVerifyAttempts = (rawPhone) => {
  const phone = phoneRateKey(rawPhone);
  if (!phone) return;
  verifyAttempts.delete(phone);
};

// Test helper — resets the in-memory limiter state between suites.
const resetGuestOtpRateLimits = () => {
  sendAttemptsByPhone.clear();
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
