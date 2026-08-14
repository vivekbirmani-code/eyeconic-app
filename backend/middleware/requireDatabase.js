const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { waitForDatabase } = require('../utils/database');

const DB_STATE_LABELS = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

/**
 * Blocks requests that require a live database connection.
 * Waits briefly during reconnects before returning 503.
 */
const requireDatabase = async (req, res, next) => {
  const state = mongoose.connection.readyState;

  if (state === 1) {
    return next();
  }

  if (state === 2 || state === 0) {
    const connected = await waitForDatabase(8000);
    if (connected) {
      return next();
    }
  }

  const currentState = mongoose.connection.readyState;

  logger.warn('Database unavailable for request', {
    requestId: req.requestId,
    path: req.path,
    method: req.method,
    dbState: currentState,
    dbStateLabel: DB_STATE_LABELS[currentState] || 'unknown',
  });

  return res.status(503).json({
    message: 'Our servers are temporarily unavailable. Please try again in a few moments.',
    code: 'DATABASE_UNAVAILABLE',
    requestId: req.requestId,
  });
};

module.exports = requireDatabase;
