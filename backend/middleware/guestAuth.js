const jwt = require('jsonwebtoken');
const Guest = require('../models/Guest');

// Guest session tokens are JWTs signed with JWT_SECRET but carry
// { kind: 'guest', guestId } — deliberately NOT interchangeable with user
// tokens (middleware/auth.js rejects kind === 'guest', and this middleware
// rejects everything that is not a guest token). Query-string tokens are
// NOT accepted — guest tokens only travel via the Authorization header.

const GUEST_TOKEN_EXPIRES_IN = () => process.env.GUEST_JWT_EXPIRES_IN || '4h';

const signGuestToken = (guestId) =>
  jwt.sign({ kind: 'guest', guestId: String(guestId) }, process.env.JWT_SECRET, {
    expiresIn: GUEST_TOKEN_EXPIRES_IN(),
  });

const verifyGuestToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

const respondUnauthorized = (res, code) =>
  res.status(401).json({
    success: false,
    message:
      code === 'GUEST_SESSION_EXPIRED'
        ? 'Your session has expired. Please verify your email again.'
        : 'Guest session is not valid.',
    code,
  });

const extractBearerToken = (req) => {
  const header = req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length).trim() || null;
};

// Required guest authentication — 401 when the token is missing/invalid.
const guestAuth = async (req, res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return respondUnauthorized(res, 'GUEST_SESSION_INVALID');
    }

    let decoded;
    try {
      decoded = verifyGuestToken(token);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return respondUnauthorized(res, 'GUEST_SESSION_EXPIRED');
      }
      return respondUnauthorized(res, 'GUEST_SESSION_INVALID');
    }

    if (decoded.kind !== 'guest' || !decoded.guestId) {
      return respondUnauthorized(res, 'GUEST_SESSION_INVALID');
    }

    const guest = await Guest.findById(decoded.guestId);
    if (!guest) {
      return respondUnauthorized(res, 'GUEST_SESSION_INVALID');
    }

    req.guest = guest;
    return next();
  } catch (error) {
    return respondUnauthorized(res, 'GUEST_SESSION_INVALID');
  }
};

// Optional guest authentication — anonymous requests continue with
// req.guest = null (used by POST /quiz/:shareToken/start so the legacy
// device-guestId flow keeps working alongside the OTP flow).
const optionalGuestAuth = async (req, res, next) => {
  const token = extractBearerToken(req);
  if (!token) {
    req.guest = null;
    return next();
  }

  try {
    const decoded = verifyGuestToken(token);
    if (decoded.kind !== 'guest' || !decoded.guestId) {
      req.guest = null;
      return next();
    }
    const guest = await Guest.findById(decoded.guestId);
    req.guest = guest || null;
    return next();
  } catch {
    // Expired/invalid guest tokens degrade to anonymous on optional routes;
    // required routes (guestAuth) still reject them explicitly.
    req.guest = null;
    return next();
  }
};

module.exports = {
  guestAuth,
  optionalGuestAuth,
  signGuestToken,
};
