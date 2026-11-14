const Quiz = require('../models/Quiz');
const { formatToIST } = require('./dateUtils');

// Shared eligibility check for every public-quiz route (guest quiz API,
// lead/OTP endpoints, share redirect).
//
// PUBLIC ACCESS SEMANTICS (owner decision 2026-11-15, "strictly always"):
// a public link obeys the quiz's internal Start/End Date & Time exactly like
// the registered-student routes. The link's OWN expiry (publicExpiryDate —
// the expiry-days the admin picks when generating the link) still applies
// and can only CLOSE the link sooner, never re-open a quiz whose internal
// window has not started or has already ended. Lead capture (send/verify
// OTP) remains governed by the link alone — only ATTEMPTS are window-gated.
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
    const deletedQuiz = await Quiz.findOne({ shareToken });
    if (deletedQuiz && (!deletedQuiz.isActive || deletedQuiz.isDeleted)) {
      return {
        error: {
          statusCode: 404,
          code: 'QUIZ_DELETED',
          message: 'This test was deleted by the administrator and is no longer available.',
        },
      };
    }
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

// The guest participation gate — the public mirror of the registered /start
// window check (routes/quizzes.js). Strict window semantics: guests may not
// START (or resume) before the quiz's scheduledDate or at/after the earlier
// of the link's expiry and the quiz's internal expiryDate.
//
// Returns null while the window is open, otherwise an error shape for
// sendPublicQuizError carrying the machine code + IST-formatted times the
// web landing page and old APKs can both render.
const getPublicScheduleGate = (quiz, now = new Date()) => {
  if (!quiz) return null;
  if (quiz.scheduledDate && now < quiz.scheduledDate) {
    return {
      statusCode: 403,
      code: 'QUIZ_NOT_STARTED',
      message: 'This test has not started yet. It opens on ' + formatToIST(quiz.scheduledDate),
      extra: { scheduledDate: quiz.scheduledDate.toISOString() },
    };
  }
  const linkEnd = quiz.publicExpiryDate ? new Date(quiz.publicExpiryDate) : null;
  const internalEnd = quiz.expiryDate ? new Date(quiz.expiryDate) : null;
  const ends = [linkEnd, internalEnd].filter((end) => end && !Number.isNaN(end.getTime()));
  if (ends.length > 0) {
    const closesAt = ends.reduce((earliest, current) => (current.getTime() < earliest.getTime() ? current : earliest));
    if (now >= closesAt) {
      return {
        statusCode: 403,
        code: 'QUIZ_WINDOW_CLOSED',
        message: 'This test has ended. It closed on ' + formatToIST(closesAt),
        extra: { closedAt: closesAt.toISOString() },
      };
    }
  }
  return null;
};

module.exports = {
  findActivePublicQuiz,
  getPublicScheduleGate,
  sendPublicQuizError,
};
