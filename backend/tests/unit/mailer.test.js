const {
  getEmailStatus,
  isResendConfigured,
  isSmtpConfigured,
  EmailDeliveryError,
  EMAIL_DELIVERY_USER_MESSAGE,
} = require('../../utils/mailer');

describe('mailer configuration', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('prefers SMTP when both SMTP and Resend are configured', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASS = 'pass';

    expect(isResendConfigured()).toBe(true);
    expect(isSmtpConfigured()).toBe(true);
    expect(getEmailStatus()).toEqual({
      status: 'configured',
      provider: 'smtp',
      configured: true,
      fallback: 'resend',
    });
  });

  it('uses Resend when SMTP is not configured', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    expect(isResendConfigured()).toBe(true);
    expect(isSmtpConfigured()).toBe(false);
    expect(getEmailStatus()).toEqual({
      status: 'configured',
      provider: 'resend',
      configured: true,
    });
  });

  it('uses SMTP when Resend is not configured', () => {
    delete process.env.RESEND_API_KEY;
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASS = 'pass';

    expect(isResendConfigured()).toBe(false);
    expect(isSmtpConfigured()).toBe(true);
    expect(getEmailStatus()).toEqual({
      status: 'configured',
      provider: 'smtp',
      configured: true,
      fallback: null,
    });
  });

  it('reports mock provider in non-production without email config', () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    process.env.NODE_ENV = 'development';

    expect(getEmailStatus()).toEqual({
      status: 'mock',
      provider: 'console',
      configured: false,
    });
  });

  it('reports unconfigured in production without email config', () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    process.env.NODE_ENV = 'production';

    expect(getEmailStatus()).toEqual({
      status: 'unconfigured',
      provider: null,
      configured: false,
    });
  });

  it('uses a safe user-facing delivery error message', () => {
    const error = new EmailDeliveryError();
    expect(error.message).toBe(EMAIL_DELIVERY_USER_MESSAGE);
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('EMAIL_DELIVERY_FAILED');
  });
});
