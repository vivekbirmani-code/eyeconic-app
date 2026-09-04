const Quiz = require('../models/Quiz');

// Shared eligibility check for every public-quiz route (guest quiz API,
// lead/OTP endpoints, share redirect).
//
// PUBLIC ACCESS SEMANTICS: a public link is governed by the link's OWN
// expiry (publicExpiryDate — the expiry-days the admin picks when
// generating the link), NOT by the quiz's internal student attempt window
// (scheduledDate/expiryDate). Admins share public links precisely so
// outsiders can attempt the quiz NOW — including past tests whose student
// window has closed. The internal window still applies to registered
// students through the authenticated routes.
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

  if (quiz.publicExpiryDate && new Date() > quiz.publicExpiryDate) {
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
