const Quiz = require('../models/Quiz');

// Shared eligibility check for every public-quiz route (guest quiz API,
// lead/OTP endpoints, share redirect). Extracted from the previously
// triplicated blocks in routes/public-quiz.js — messages stay identical so
// existing clients (mobile guest flow) render the same errors.
//
// Returns { quiz } on success or { error: { statusCode, code, message, extra } }.

const findActivePublicQuiz = async (shareToken, options = null) => {
  // `options` is either a select string (back-compat) or
  // { select, populate } where populate is a mongoose populate spec.
  const select = typeof options === 'string' ? options : options?.select || null;
  const populate = options && typeof options === 'object' ? options.populate : null;

  const query = Quiz.findOne({ shareToken, isPublic: true, isActive: true });
  if (select) {
    query.select(select);
  }
  if (populate) {
    query.populate(populate);
  }
  const quiz = await query;

  if (!quiz) {
    return {
      error: {
        statusCode: 404,
        code: 'QUIZ_NOT_FOUND',
        message: 'Quiz not found or link has expired',
      },
    };
  }

  const now = new Date();
  if (quiz.scheduledDate && now < quiz.scheduledDate) {
    return {
      error: {
        statusCode: 403,
        code: 'QUIZ_NOT_STARTED',
        message: 'This quiz has not started yet. It opens on ' + quiz.scheduledDate.toLocaleString(),
        extra: { scheduledDate: quiz.scheduledDate },
      },
    };
  }
  if (quiz.expiryDate && now > quiz.expiryDate) {
    return {
      error: {
        statusCode: 403,
        code: 'QUIZ_EXPIRED',
        message: 'This quiz has expired. It closed on ' + quiz.expiryDate.toLocaleString(),
        extra: { expiryDate: quiz.expiryDate },
      },
    };
  }
  if (quiz.publicExpiryDate && now > quiz.publicExpiryDate) {
    return {
      error: {
        statusCode: 410,
        code: 'SHARE_LINK_EXPIRED',
        message: 'This quiz link has expired',
      },
    };
  }

  return { quiz };
};

// Responds with the error shape used by the public routes. The `code` field
// is additive — existing clients read `message` only.
const sendPublicQuizError = (res, error) =>
  res.status(error.statusCode).json({
    success: false,
    message: error.message,
    code: error.code,
    ...(error.extra || {}),
  });

module.exports = {
  findActivePublicQuiz,
  sendPublicQuizError,
};
