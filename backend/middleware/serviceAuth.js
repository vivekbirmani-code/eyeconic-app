const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Service-to-service authentication for the website-integration endpoints
 * (POST /api/integration/v1/...).
 *
 * The Eyeconic marketing website's server (eyeconic-server.vercel.app) is the
 * only intended caller and proves itself with a shared high-entropy token
 * configured in the environment on both sides:
 *
 *   Authorization: Bearer <INTEGRATION_SERVICE_TOKEN>
 *
 * Notes:
 *  - A service token alone grants no data access: the only integration route
 *    today (handoff/consume) additionally requires a valid single-use code
 *    that a real, signed-in user created moments earlier.
 *  - Comparison is timing-safe; the token is never logged.
 *  - When INTEGRATION_SERVICE_TOKEN is not configured the routes answer 503
 *    instead of silently accepting requests.
 */
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Compare against self to keep constant time, then report mismatch.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Local-development-only shared secret. MUST be identical to the website
// server's dev default (eyeconic-main/server/config/appApi.js). Production
// must set INTEGRATION_SERVICE_TOKEN explicitly — the dev value is never
// accepted there.
const DEV_INTEGRATION_TOKEN = 'dev-integration-service-token-local-only-000';

function resolveServiceToken() {
  const configured = (process.env.INTEGRATION_SERVICE_TOKEN || '').trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') return '';
  return DEV_INTEGRATION_TOKEN;
}

let devTokenWarned = false;

function serviceAuth(req, res, next) {
  const expected = resolveServiceToken();

  if (!expected || expected.length < 32) {
    logger.warn('Integration endpoint called while INTEGRATION_SERVICE_TOKEN is not configured', {
      requestId: req.requestId,
      path: req.originalUrl,
    });
    return res.status(503).json({
      success: false,
      message: 'Website integration is not configured on this server.',
      code: 'SERVICE_UNAVAILABLE',
      requestId: req.requestId,
    });
  }

  if (expected === DEV_INTEGRATION_TOKEN && !devTokenWarned) {
    devTokenWarned = true;
    logger.warn(
      'INTEGRATION_SERVICE_TOKEN is not set — accepting the LOCAL-ONLY development token. Configure a real value before deploying.',
      { requestId: req.requestId }
    );
  }

  const header = req.header('Authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token || !timingSafeEqual(token, expected)) {
    logger.warn('Integration endpoint rejected a bad service token', {
      requestId: req.requestId,
      ip: req.ip,
    });
    return res.status(401).json({
      success: false,
      message: 'Invalid service credentials.',
      code: 'SERVICE_UNAUTHORIZED',
      requestId: req.requestId,
    });
  }

  next();
}

module.exports = serviceAuth;
