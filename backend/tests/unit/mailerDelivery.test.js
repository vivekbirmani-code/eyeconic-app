// Delivery mechanics for utils/mailer.js: pooled-transporter caching,
// transient-vs-permanent error classification, bounded retries, rejected-
// recipient detection, Resend fallback, and the EmailDeliveryLog audit trail.
//
// Provider boundaries are mocked (nodemailer, fetch, the audit model, and
// mongoose's connection state) so these tests exercise the retry policy
// itself, not real networks.

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
jest.mock('mongoose', () => ({ connection: { readyState: 1 } }));
jest.mock('../../models/EmailDeliveryLog', () => ({ create: jest.fn().mockResolvedValue({}) }));

const nodemailer = require('nodemailer');
const EmailDeliveryLog = require('../../models/EmailDeliveryLog');
const {
  sendOtpMail,
  sendGuestQuizOtpMail,
  EmailDeliveryError,
  closeEmailTransporter,
} = require('../../utils/mailer');

const { createTransport } = nodemailer;

const makeTransport = (sendMailImpl) => ({
  sendMail: jest.fn(sendMailImpl),
  close: jest.fn(),
});

const smtpError = (message, extra = {}) => Object.assign(new Error(message), extra);

const rejectedSendResult = () => ({ messageId: '<ok@localhost>', rejected: [], response: '250 Ok' });

describe('mailer delivery mechanics', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    closeEmailTransporter();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp.provider.test',
      SMTP_PORT: '587',
      SMTP_USER: 'mailer@provider.test',
      SMTP_PASS: 'secret-pass',
      SMTP_FROM_EMAIL: 'no-reply@eyeconicmentors.com',
    };
    delete process.env.RESEND_API_KEY;
    global.fetch = jest.fn();
    // Real mongoose mock exposes a mutable readyState — force "connected".
    require('mongoose').connection.readyState = 1;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  describe('transporter pooling', () => {
    it('creates ONE pooled transporter and reuses it across sends', async () => {
      const transport = makeTransport(async () => rejectedSendResult());
      createTransport.mockReturnValue(transport);

      await sendOtpMail('student@example.com', '123456');
      await sendOtpMail('other@example.com', '654321');

      expect(createTransport).toHaveBeenCalledTimes(1);
      expect(transport.sendMail).toHaveBeenCalledTimes(2);
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          pool: true,
          host: 'smtp.provider.test',
          port: 587,
          secure: false,
          maxConnections: 5,
          maxMessages: 200,
          disableFileAccess: true,
          disableUrlAccess: true,
        })
      );
    });

    it('rebuilds and closes the transporter when the SMTP configuration changes', async () => {
      const first = makeTransport(async () => rejectedSendResult());
      const second = makeTransport(async () => rejectedSendResult());
      createTransport.mockReturnValueOnce(first).mockReturnValueOnce(second);

      await sendOtpMail('student@example.com', '123456');
      process.env.SMTP_HOST = 'smtp.other-provider.test';
      await sendOtpMail('student@example.com', '123456');

      expect(createTransport).toHaveBeenCalledTimes(2);
      expect(first.close).toHaveBeenCalledTimes(1);
      expect(second.sendMail).toHaveBeenCalledTimes(1);
    });

    it('honors SMTP_POOL_* overrides for pool sizing', async () => {
      process.env.SMTP_POOL_MAX_CONNECTIONS = '2';
      process.env.SMTP_POOL_MAX_MESSAGES = '50';
      createTransport.mockReturnValue(makeTransport(async () => rejectedSendResult()));

      await sendOtpMail('student@example.com', '123456');

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ maxConnections: 2, maxMessages: 50 })
      );
    });
  });

  describe('SMTP retry policy', () => {
    it('retries a transient 421 failure and delivers on the next attempt', async () => {
      const outcomes = [
        () => Promise.reject(smtpError('421 Try again later', { responseCode: 421 })),
        () => Promise.resolve({ messageId: '<second@attempt>', rejected: [], response: '250 Ok' }),
      ];
      const transport = makeTransport(async () => outcomes.shift()());
      createTransport.mockReturnValue(transport);

      await sendGuestQuizOtpMail('student@example.com', '123456', 'Biology Test');

      expect(transport.sendMail).toHaveBeenCalledTimes(2);
      expect(EmailDeliveryLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          toEmail: 'student@example.com',
          purpose: 'guest-quiz',
          provider: 'smtp',
          status: 'sent',
          attempts: 2,
          messageId: '<second@attempt>',
        })
      );
    });

    it('does NOT retry a permanent 5xx rejection — one attempt, 503 to the client', async () => {
      const transport = makeTransport(async () => {
        throw smtpError('550 Mailbox unavailable', { responseCode: 550 });
      });
      createTransport.mockReturnValue(transport);

      await expect(sendGuestQuizOtpMail('student@example.com', '123456')).rejects.toMatchObject({
        name: 'EmailDeliveryError',
        code: 'EMAIL_DELIVERY_FAILED',
        statusCode: 503,
      });
      expect(transport.sendMail).toHaveBeenCalledTimes(1);
      expect(EmailDeliveryLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'smtp',
          status: 'failed',
          attempts: 1,
          errorCode: 'smtp-550',
        })
      );
    });

    it('retries network-level failures (ECONNRESET) up to the attempt cap', async () => {
      const transport = makeTransport(async () => {
        throw smtpError('Connection reset by peer', { code: 'ECONNRESET' });
      });
      createTransport.mockReturnValue(transport);

      await expect(sendOtpMail('student@example.com', '123456')).rejects.toBeInstanceOf(
        EmailDeliveryError
      );
      expect(transport.sendMail).toHaveBeenCalledTimes(3);
      expect(EmailDeliveryLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', attempts: 3, errorCode: 'econnreset' })
      );
    });
  });

  describe('rejected recipients (the silent "OTP never came" case)', () => {
    it('treats a resolved sendMail with rejected recipients as a 422 delivery failure', async () => {
      const transport = makeTransport(async () => ({
        messageId: '<partial@localhost>',
        rejected: ['student@gnmail.com'],
        response: '550 5.1.1 Mailbox does not exist',
      }));
      createTransport.mockReturnValue(transport);

      await expect(sendGuestQuizOtpMail('student@gnmail.com', '123456')).rejects.toMatchObject({
        name: 'EmailDeliveryError',
        code: 'EMAIL_RECIPIENT_REJECTED',
        statusCode: 422,
      });

      // No retry — a rejected mailbox is permanent.
      expect(transport.sendMail).toHaveBeenCalledTimes(1);
      expect(EmailDeliveryLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          errorCode: 'recipient-rejected',
        })
      );
    });
  });

  describe('Resend fallback', () => {
    it('falls back to Resend after SMTP exhausts its retries', async () => {
      const transport = makeTransport(async () => {
        throw smtpError('Connection timeout', { code: 'ETIMEDOUT' });
      });
      createTransport.mockReturnValue(transport);
      process.env.RESEND_API_KEY = 're_test_key';

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'resend-message-1' }),
      });

      await sendGuestQuizOtpMail('student@example.com', '123456', 'Biology Test');

      // SMTP retried its full budget before the fallback fired.
      expect(transport.sendMail).toHaveBeenCalledTimes(3);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(EmailDeliveryLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'smtp+resend-fallback',
          status: 'sent',
          messageId: 'resend-message-1',
        })
      );
    });

    it('does not use the fallback for rejected recipients (Resend would reject too)', async () => {
      const transport = makeTransport(async () => ({
        rejected: ['student@gnmail.com'],
        response: '550 no such domain',
      }));
      createTransport.mockReturnValue(transport);
      process.env.RESEND_API_KEY = 're_test_key';

      await expect(sendOtpMail('student@gnmail.com', '123456')).rejects.toMatchObject({
        code: 'EMAIL_RECIPIENT_REJECTED',
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('retries Resend on 429 rate limits before succeeding', async () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      process.env.RESEND_API_KEY = 're_test_key';

      global.fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => '{"message":"rate limit exceeded"}',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'resend-message-2' }),
        });

      await sendOtpMail('student@example.com', '123456');

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(EmailDeliveryLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'resend', status: 'sent', attempts: 2 })
      );
    });

    it('does not retry permanent Resend 4xx errors (invalid API key)', async () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      process.env.RESEND_API_KEY = 're_invalid_key';

      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => '{"message":"invalid api key"}',
      });

      await expect(sendOtpMail('student@example.com', '123456')).rejects.toMatchObject({
        code: 'EMAIL_DELIVERY_FAILED',
        statusCode: 503,
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('audit trail robustness', () => {
    it('skips audit persistence when the database is disconnected (never throws)', async () => {
      require('mongoose').connection.readyState = 0;
      createTransport.mockReturnValue(makeTransport(async () => rejectedSendResult()));

      await expect(sendOtpMail('student@example.com', '123456')).resolves.toBeUndefined();

      expect(EmailDeliveryLog.create).not.toHaveBeenCalled();
    });

    it('keeps provider secrets out of persisted error details', async () => {
      const transport = makeTransport(async () => {
        throw smtpError('Bearer re_super_secret_key rejected', { code: 'EAUTH' });
      });
      createTransport.mockReturnValue(transport);

      await expect(sendOtpMail('student@example.com', '123456')).rejects.toBeInstanceOf(
        EmailDeliveryError
      );

      const loggedEntry = EmailDeliveryLog.create.mock.calls[0][0];
      expect(loggedEntry.errorDetail).toContain('[REDACTED]');
      expect(loggedEntry.errorDetail).not.toContain('re_super_secret_key');
    });
  });
});
