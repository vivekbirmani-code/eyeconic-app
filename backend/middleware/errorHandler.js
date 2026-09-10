const logger = require('../utils/logger');

// multer upload failures (bad multipart body, oversized file) are client
// problems — without this mapping they surfaced as 500 INTERNAL_ERROR.
const MULTER_ERROR_RESPONSES = {
  LIMIT_FILE_SIZE: { status: 413, message: 'The uploaded file is too large.' },
  LIMIT_FILE_COUNT: { status: 400, message: 'Too many files were uploaded.' },
  LIMIT_FIELD_COUNT: { status: 400, message: 'Too many form fields were submitted.' },
  LIMIT_FIELD_VALUE: { status: 400, message: 'A form field value is too large.' },
  LIMIT_UNEXPECTED_FILE: { status: 400, message: 'Unexpected file field in the upload.' },
};

/**
 * Global Express error handler.
 * Ensures internal errors never leak stack traces or raw DB messages to clients.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const requestId = req.requestId || 'unknown';

  if (res.headersSent) {
    logger.warn('Error after response started', { requestId, path: req.path, errorName: err.name });
    return next(err);
  }

  if (err.name === 'MulterError' && MULTER_ERROR_RESPONSES[err.code]) {
    const mapped = MULTER_ERROR_RESPONSES[err.code];
    logger.warn('Upload rejected by multer', { requestId, path: req.path, multerCode: err.code });
    return res.status(mapped.status).json({
      message: mapped.message,
      code: err.code,
      requestId,
    });
  }

  logger.error('Unhandled request error', {
    requestId,
    path: req.path,
    method: req.method,
    errorName: err.name,
    errorMessage: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });

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
