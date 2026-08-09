const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * Blocks requests that require a live database connection.
 * Returns 503 with a safe, user-facing message when DB is unavailable.
 */
const requireDatabase = (req, res, next) => {
  const state = mongoose.connection.readyState;

  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  if (state === 1) {
    return next();
  }

  logger.warn('Database unavailable for request', {
    requestId: req.requestId,
    path: req.path,
    method: req.method,
    dbState: state,
  });

  return res.status(503).json({
    message: 'Our servers are temporarily unavailable. Please try again in a few moments.',
    code: 'SERVICE_UNAVAILABLE',
    requestId: req.requestId,
  });
};

module.exports = requireDatabase;
