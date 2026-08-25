const {
  generateOtp,
  isValidEmail,
  normalizeEmail,
  isOtpExpired,
  OTP_TTL_MS,
} = require('../../utils/otpHelpers');

describe('otpHelpers', () => {
  it('generates a 6-digit OTP', () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('validates email addresses', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail(' invalid ')).toBe(false);
    expect(isValidEmail('not-an-email')).toBe(false);
  });

  it('normalizes email addresses', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
  });

  it('detects expired OTP records', () => {
    const fresh = new Date();
    const expired = new Date(Date.now() - OTP_TTL_MS - 1000);
    expect(isOtpExpired(fresh)).toBe(false);
    expect(isOtpExpired(expired)).toBe(true);
    expect(isOtpExpired(null)).toBe(true);
  });
});
