const { hashOtp } = require('../../utils/guestOtp');

describe('guestOtp hashing', () => {
  const originalSecret = process.env.OTP_HASH_SECRET;
  const originalJwtSecret = process.env.JWT_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.OTP_HASH_SECRET;
    } else {
      process.env.OTP_HASH_SECRET = originalSecret;
    }
    process.env.JWT_SECRET = originalJwtSecret;
    jest.resetModules();
  });

  it('produces a deterministic hex digest for the same code + secret', () => {
    process.env.OTP_HASH_SECRET = 'unit-test-secret';
    const { hashOtp: hashWithSecret } = require('../../utils/guestOtp');
    const a = hashWithSecret('123456');
    const b = hashWithSecret('123456');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it('changes when the code changes (no collisions across digits)', () => {
    process.env.OTP_HASH_SECRET = 'unit-test-secret';
    const { hashOtp: hashWithSecret } = require('../../utils/guestOtp');
    expect(hashWithSecret('123456')).not.toBe(hashWithSecret('123457'));
    expect(hashWithSecret('123456')).not.toBe(hashWithSecret('234561'));
  });

  it('changes when the secret changes', () => {
    process.env.OTP_HASH_SECRET = 'secret-a';
    const { hashOtp: hashA } = require('../../utils/guestOtp');
    const digestA = hashA('123456');

    process.env.OTP_HASH_SECRET = 'secret-b';
    const { hashOtp: hashB } = require('../../utils/guestOtp');
    expect(hashB('123456')).not.toBe(digestA);
  });

  it('falls back to JWT_SECRET when OTP_HASH_SECRET is unset', () => {
    delete process.env.OTP_HASH_SECRET;
    process.env.JWT_SECRET = 'jwt-fallback-secret';
    const { hashOtp: hashFallback } = require('../../utils/guestOtp');
    const digest = hashFallback('123456');

    process.env.JWT_SECRET = 'different-jwt-secret';
    const { hashOtp: hashDifferent } = require('../../utils/guestOtp');
    expect(hashDifferent('123456')).not.toBe(digest);
  });

  it('uses a domain label so OTP digests differ from a plain HMAC of the code', () => {
    const crypto = require('crypto');
    process.env.OTP_HASH_SECRET = 'unit-test-secret';
    const { hashOtp: hashWithSecret } = require('../../utils/guestOtp');
    const plain = crypto.createHmac('sha256', 'unit-test-secret').update('123456').digest('hex');
    expect(hashWithSecret('123456')).not.toBe(plain);
  });
});
