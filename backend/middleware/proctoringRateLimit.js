// Rate limiting for proctoring precheck reports (plan §27.2: ~10/h/quiz).
// Mechanics copied from middleware/guestOtpRateLimit.js — in-memory Map,
// pruned on access. Keyed per STUDENT+QUIZ so one student's retries cannot be
// exhausted by another.
//
// NOTE: in-memory state is per-process; the backend runs as a single Render
// instance (same caveat as otpRateLimit.js). Move to Redis if it scales.
const logger = require('../utils/logger');

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 10;

const attempts = new Map();

const pruneOldEntries = () => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, entry] of attempts.entries()) {
    if (entry.updatedAt < cutoff) attempts.delete(key);
  }
};

/**
 * Limits precheck-report submissions to MAX_PER_WINDOW per student per quiz
 * per hour. Counted on every attempt (successful or not) — the endpoint
 * issues a credential, so failures must not be free.
 */
const precheckReportRateLimit = (req, res, next) => {
  const studentId = req.user?._id ? String(req.user._id) : null;
  const quizId = req.params?.id ? String(req.params.id) : null;
  if (!studentId || !quizId) return next();

  pruneOldEntries();

  const key = `${studentId}:${quizId}`;
  const entry = attempts.get(key) || { count: 0, updatedAt: Date.now() };

  if (entry.count >= MAX_PER_WINDOW) {
    logger.warn('[PROCTORING] Precheck report rate limited', {
      requestId: req.requestId,
      studentId,
      quizId,
    });
    return res.status(429).json({
      success: false,
      message: 'Too many readiness checks. Please wait a while and try again.',
      code: 'RATE_LIMITED',
      requestId: req.requestId,
    });
  }

  entry.count += 1;
  entry.updatedAt = Date.now();
  attempts.set(key, entry);
  return next();
};

// Test-only hook: clears the in-memory counters between suites.
const resetPrecheckRateLimits = () => attempts.clear();

// ===== Phase 3 — event-batch ingest limiting (plan §27.2: ~60/min) =====
// Keyed per STUDENT (batches belong to the student's own active session);
// counted on every attempt so floods are bounded regardless of outcome.
const { EVENTS_RATE_LIMIT } = require('../utils/proctoring/defaults');

const eventBatches = new Map();

const pruneOldEventEntries = () => {
  const cutoff = Date.now() - EVENTS_RATE_LIMIT.windowMs;
  for (const [key, entry] of eventBatches.entries()) {
    if (entry.updatedAt < cutoff) eventBatches.delete(key);
  }
};

const proctoringEventsRateLimit = (req, res, next) => {
  const studentId = req.user?._id ? String(req.user._id) : null;
  if (!studentId) return next();

  pruneOldEventEntries();

  const key = studentId;
  const entry = eventBatches.get(key) || { count: 0, updatedAt: Date.now() };

  if (entry.count >= EVENTS_RATE_LIMIT.maxPerWindow) {
    logger.warn('[PROCTORING] Events rate limited', {
      requestId: req.requestId,
      studentId,
    });
    return res.status(429).json({
      success: false,
      message: 'Too many monitoring updates. They will retry automatically.',
      code: 'RATE_LIMITED',
      requestId: req.requestId,
    });
  }

  entry.count += 1;
  entry.updatedAt = Date.now();
  eventBatches.set(key, entry);
  return next();
};

// Test-only hook for the events limiter.
const resetProctoringEventRateLimits = () => eventBatches.clear();

// ===== Phase 4 — legacy tab-switch post limiting (plan §27.5) =====
// The legacy telemetry route gains the rate limit it was missing. Same
// in-memory pattern and the SAME bound as the events limiter (reuse of
// EVENTS_RATE_LIMIT — not a new threshold): one post per visibility change,
// keyed per STUDENT.
const tabSwitchPosts = new Map();

const pruneOldTabSwitchEntries = () => {
  const cutoff = Date.now() - EVENTS_RATE_LIMIT.windowMs;
  for (const [key, entry] of tabSwitchPosts.entries()) {
    if (entry.updatedAt < cutoff) tabSwitchPosts.delete(key);
  }
};

const tabSwitchRateLimit = (req, res, next) => {
  const studentId = req.user?._id ? String(req.user._id) : null;
  if (!studentId) return next();

  pruneOldTabSwitchEntries();

  const key = studentId;
  const entry = tabSwitchPosts.get(key) || { count: 0, updatedAt: Date.now() };

  if (entry.count >= EVENTS_RATE_LIMIT.maxPerWindow) {
    logger.warn('[PROCTORING] Tab-switch posts rate limited', {
      requestId: req.requestId,
      studentId,
    });
    return res.status(429).json({
      success: false,
      message: 'Too many tab-switch updates.',
      code: 'RATE_LIMITED',
      requestId: req.requestId,
    });
  }

  entry.count += 1;
  entry.updatedAt = Date.now();
  tabSwitchPosts.set(key, entry);
  return next();
};

// Test-only hook for the tab-switch limiter.
const resetTabSwitchRateLimits = () => tabSwitchPosts.clear();

module.exports = {
  precheckReportRateLimit,
  resetPrecheckRateLimits,
  proctoringEventsRateLimit,
  resetProctoringEventRateLimits,
  tabSwitchRateLimit,
  resetTabSwitchRateLimits,
};
