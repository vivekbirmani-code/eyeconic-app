// Rate limiting for the PUBLIC proctoring surface (public-quiz proctoring
// Phase 2). Mechanics copied from middleware/proctoringRateLimit.js —
// in-memory Map, pruned on access — but keyed by the PUBLIC owner identity:
// the verified lead id (req.guest) or, on the events route, the attempt
// owner key. Same caveat as every limiter here: per-process state, fine for
// the single Render instance.
//
// NOTE: pre-deployment attempts (legacy anonymous device-key flow) never
// reach the events limiter's anonymous branch in practice — proctored public
// attempts only start after OTP verification is mandatory — but the branch
// keeps the limiter total rather than trusting the caller kind.

const logger = require('../utils/logger');
const { EVENTS_RATE_LIMIT } = require('../utils/proctoring/defaults');

const PRECHECK_WINDOW_MS = 60 * 60 * 1000;
const PRECHECK_MAX_PER_WINDOW = 10;

// Identity for the precheck limiter: the verified lead, or (defensively)
// the device key from the body.
const precheckOwnerKey = (req) => {
  if (req.guest?._id) return `guest:${req.guest._id}`;
  const deviceKey = typeof req.body?.guestId === 'string' ? req.body.guestId : null;
  return deviceKey ? `dev:${deviceKey}` : null;
};

const precheckAttempts = new Map();

const prunePrecheck = () => {
  const cutoff = Date.now() - PRECHECK_WINDOW_MS;
  for (const [key, entry] of precheckAttempts.entries()) {
    if (entry.updatedAt < cutoff) precheckAttempts.delete(key);
  }
};

/**
 * Limits public precheck reports to 10/hour per owner per quiz — counted on
 * every attempt (the endpoint issues a credential; failures are not free).
 */
const publicPrecheckRateLimit = (req, res, next) => {
  const ownerKey = precheckOwnerKey(req);
  const quizKey = req.params?.shareToken ? `quiz:${req.params.shareToken}` : '';
  if (!ownerKey || !quizKey) return next();

  prunePrecheck();

  const key = `${ownerKey}:${quizKey}`;
  const entry = precheckAttempts.get(key) || { count: 0, updatedAt: Date.now() };

  if (entry.count >= PRECHECK_MAX_PER_WINDOW) {
    logger.warn('[PROCTORING] Public precheck report rate limited', {
      requestId: req.requestId,
      ownerKey,
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
  precheckAttempts.set(key, entry);
  return next();
};

// Events limiter: 60/min per owner (lead id, or attempt-scoped device key).
// Same bound as the registered events limiter — reuse of EVENTS_RATE_LIMIT,
// not a new threshold.
const eventBatches = new Map();

const pruneEvents = () => {
  const cutoff = Date.now() - EVENTS_RATE_LIMIT.windowMs;
  for (const [key, entry] of eventBatches.entries()) {
    if (entry.updatedAt < cutoff) eventBatches.delete(key);
  }
};

const eventsOwnerKey = (req) => {
  if (req.guest?._id) return `guest:${req.guest._id}`;
  const deviceKey = typeof req.body?.guestId === 'string' ? req.body.guestId : null;
  const attemptKey = req.params?.attemptId ? `attempt:${req.params.attemptId}` : '';
  return deviceKey && attemptKey ? `dev:${deviceKey}:${attemptKey}` : null;
};

const publicProctoringEventsRateLimit = (req, res, next) => {
  const ownerKey = eventsOwnerKey(req);
  if (!ownerKey) return next();

  pruneEvents();

  const entry = eventBatches.get(ownerKey) || { count: 0, updatedAt: Date.now() };

  if (entry.count >= EVENTS_RATE_LIMIT.maxPerWindow) {
    logger.warn('[PROCTORING] Public proctoring events rate limited', {
      requestId: req.requestId,
      ownerKey,
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
  eventBatches.set(ownerKey, entry);
  return next();
};

// Test-only hooks: clear the in-memory counters between suites.
const resetPublicPrecheckRateLimits = () => precheckAttempts.clear();
const resetPublicProctoringEventRateLimits = () => eventBatches.clear();

module.exports = {
  publicPrecheckRateLimit,
  resetPublicPrecheckRateLimits,
  publicProctoringEventsRateLimit,
  resetPublicProctoringEventRateLimits,
};
