const crypto = require('crypto');
const GuestOtp = require('../models/GuestOtp');
const { isOtpExpired } = require('./otpHelpers');

// OTP persistence for the public-quiz guest flow. Codes are stored as
// HMAC-SHA256 digests (never plaintext) because an email-verified lead is a
// permanent PII identity key — a database leak of plaintext codes would be
// a materially worse liability than the codes themselves.

const OTP_HASH_DOMAIN = 'guest-otp:v1:';

const getOtpHashSecret = () =>
  process.env.OTP_HASH_SECRET?.trim() || process.env.JWT_SECRET || '';

const hashOtp = (otp) =>
  crypto
    .createHmac('sha256', getOtpHashSecret())
    .update(OTP_HASH_DOMAIN + String(otp))
    .digest('hex');

const safeEqualHex = (a, b) => {
  const bufferA = Buffer.from(String(a), 'hex');
  const bufferB = Buffer.from(String(b), 'hex');
  if (bufferA.length !== bufferB.length || bufferA.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(bufferA, bufferB);
};

// Upserts the single live OTP for the (email, shareToken) challenge.
// A resend replaces the previous code — only one live code per challenge.
const issueGuestOtp = async (email, shareToken, otp) => {
  await GuestOtp.findOneAndUpdate(
    { email, shareToken },
    { otpHash: hashOtp(otp), createdAt: new Date() },
    { upsert: true, new: true }
  );
};

// Verifies a code against the SAME challenge it was issued for.
// Returns { ok, reason } — reason is 'OTP_INVALID' (no row / wrong code /
// wrong link) or 'OTP_EXPIRED'. Deletes the row on success (single use).
const verifyGuestOtp = async (email, shareToken, otp) => {
  const record = await GuestOtp.findOne({ email, shareToken });

  if (!record) {
    return { ok: false, reason: 'OTP_INVALID' };
  }

  if (!safeEqualHex(record.otpHash, hashOtp(otp))) {
    return { ok: false, reason: 'OTP_INVALID' };
  }

  if (isOtpExpired(record.createdAt)) {
    await GuestOtp.deleteOne({ _id: record._id });
    return { ok: false, reason: 'OTP_EXPIRED' };
  }

  await GuestOtp.deleteOne({ _id: record._id });
  return { ok: true };
};

module.exports = {
  hashOtp,
  issueGuestOtp,
  verifyGuestOtp,
};
