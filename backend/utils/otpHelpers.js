const crypto = require('crypto');

const OTP_TTL_MS = 10 * 60 * 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

const normalizeEmail = (email) => email.trim().toLowerCase();

const isValidEmail = (email) => typeof email === 'string' && EMAIL_REGEX.test(normalizeEmail(email));

const isOtpExpired = (createdAt) => {
  if (!createdAt) return true;
  return Date.now() - new Date(createdAt).getTime() > OTP_TTL_MS;
};

module.exports = {
  OTP_TTL_MS,
  generateOtp,
  normalizeEmail,
  isValidEmail,
  isOtpExpired,
};
