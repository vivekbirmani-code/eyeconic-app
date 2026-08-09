const logger = require('../utils/logger');

/**
 * Global Express error handler.
 * Ensures internal errors never leak stack traces or raw DB messages to clients.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const requestId = req.requestId || 'unknown';

  logger.error('Unhandled request error', {
    requestId,
    path: req.path,
    method: req.method,
    errorName: err.name,
    errorMessage: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });

  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.statusCode || err.status || 500;
  const safeStatus = statusCode >= 400 && statusCode < 600 ? statusCode : 500;

  const userMessages = {
    400: 'The request could not be processed. Please check your input and try again.',
    401: 'Your session has expired. Please sign in again.',
    403: 'You do not have permission to perform this action.',
    404: 'The requested resource was not found.',
    408: 'The request timed out. Please try again.',
    409: 'This action conflicts with existing data. Please refresh and try again.',
    422: 'Some of the information provided is invalid. Please review and try again.',
    429: 'Too many requests. Please wait a moment and try again.',
    500: "We're unable to process your request right now. Please try again shortly.",
    502: 'Our servers are temporarily unavailable. Please try again in a few moments.',
    503: 'Our servers are temporarily unavailable. Please try again in a few moments.',
    504: 'The server took too long to respond. Please try again.',
  };

  const message =
    err.expose && err.message
      ? err.message
      : userMessages[safeStatus] || userMessages[500];

  res.status(safeStatus).json({
    message,
    code: err.code || 'INTERNAL_ERROR',
    requestId,
  });
};

module.exports = errorHandler;
