const originalEnv = { ...process.env };

describe('sms provider abstraction (2Factor)', () => {
  let sms;
  let logger;

  const clearTwoFactorEnv = () => {
    delete process.env.TWO_FACTOR_API_KEY;
    delete process.env.TWO_FACTOR_OTP_TEMPLATE;
  };

  beforeEach(() => {
    jest.resetModules();
    clearTwoFactorEnv();
    process.env.NODE_ENV = 'development';
    process.env.SMS_MOCK_ECHO = 'false';
    sms = require('../../utils/sms');
    logger = require('../../utils/logger');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (global.fetch && jest.isMockFunction(global.fetch)) {
      global.fetch.mockRestore();
    }
    jest.restoreAllMocks();
  });

  describe('getSmsStatus', () => {
    it('reports 2factor when the API key is configured', () => {
      process.env.TWO_FACTOR_API_KEY = '11111111-2222-3333-4444-555555555555';
      expect(sms.getSmsStatus()).toEqual({
        status: 'configured',
        provider: '2factor',
        configured: true,
      });
    });

    it('reports unconfigured in production without the key', () => {
      process.env.NODE_ENV = 'production';
      expect(sms.getSmsStatus()).toEqual({
        status: 'unconfigured',
        provider: null,
        configured: false,
      });
    });
  });

  describe('sendGuestOtpSms', () => {
    it('hard-fails in production when no provider is configured (mock can never run in prod)', async () => {
      process.env.NODE_ENV = 'production';
      await expect(sms.sendGuestOtpSms('+919876543210', '123456')).rejects.toMatchObject({
        name: 'SmsDeliveryError',
        code: 'SMS_NOT_CONFIGURED',
        statusCode: 503,
      });
    });

    it('uses the console mock outside production', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      await expect(sms.sendGuestOtpSms('+919876543210', '123456')).resolves.toBeUndefined();
      // The OTP value is hidden unless SMS_MOCK_ECHO=true
      expect(logSpy).toHaveBeenCalled();
      const logged = logSpy.mock.calls.flat().join(' ');
      expect(logged).not.toContain('123456');
      logSpy.mockRestore();
    });

    it('echoes the OTP value in the mock only when SMS_MOCK_ECHO=true', async () => {
      process.env.SMS_MOCK_ECHO = 'true';
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      await sms.sendGuestOtpSms('+919876543210', '654321');
      const logged = logSpy.mock.calls.flat().join(' ');
      expect(logged).toContain('654321');
      logSpy.mockRestore();
    });

    it('calls the 2Factor Manual Generation OTP endpoint with key, phone and OTP', async () => {
      process.env.TWO_FACTOR_API_KEY = 'test-api-key-1234';

      const fetchSpy = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ Status: 'Success', Details: 'ab88279e-0105-415f-912e-2f24162b8cbb' }),
      });
      global.fetch = fetchSpy;

      await sms.sendGuestOtpSms('+919876543210', '123456');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://2factor.in/API/V1/test-api-key-1234/SMS/+919876543210/123456');
      expect(options.method).toBe('GET');
      expect(options.signal).toBeTruthy(); // 15s abort timeout armed
    });

    it('appends the optional DLT template segment when TWO_FACTOR_OTP_TEMPLATE is set', async () => {
      process.env.TWO_FACTOR_API_KEY = 'test-api-key-1234';
      process.env.TWO_FACTOR_OTP_TEMPLATE = 'OTP1';

      const fetchSpy = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ Status: 'Success', Details: 'session-id' }),
      });
      global.fetch = fetchSpy;

      await sms.sendGuestOtpSms('+919876543210', '123456');

      expect(fetchSpy.mock.calls[0][0]).toBe(
        'https://2factor.in/API/V1/test-api-key-1234/SMS/+919876543210/123456/OTP1'
      );
    });

    it('throws SmsDeliveryError on an invalid API key (plain-text 400), never leaking key or OTP', async () => {
      process.env.TWO_FACTOR_API_KEY = 'secret-api-key-9999';
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Invalid API Key — request was secret-api-key-9999/SMS/+919876543210/123456',
      });

      await expect(sms.sendGuestOtpSms('+919876543210', '123456')).rejects.toMatchObject({
        name: 'SmsDeliveryError',
        code: 'SMS_DELIVERY_FAILED',
        statusCode: 503,
      });

      const errorText = errorSpy.mock.calls.map((c) => JSON.stringify(c)).join(' ');
      const allLogs = `${errorText} ${infoSpy.mock.calls.map((c) => JSON.stringify(c)).join(' ')}`;
      expect(allLogs).not.toContain('secret-api-key-9999');
      expect(allLogs).not.toContain('/123456');
      expect(allLogs).not.toContain('+919876543210'); // masked in logs
    });

    it('treats 200 {"Status":"Error"} payloads as failures', async () => {
      process.env.TWO_FACTOR_API_KEY = 'test-api-key-1234';
      jest.spyOn(logger, 'error').mockImplementation(() => {});

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ Status: 'Error', Details: 'Insufficient credits' }),
      });

      await expect(sms.sendGuestOtpSms('+919876543210', '123456')).rejects.toMatchObject({
        name: 'SmsDeliveryError',
        code: 'SMS_DELIVERY_FAILED',
      });
    });

    it('throws SmsDeliveryError on provider HTTP 500', async () => {
      process.env.TWO_FACTOR_API_KEY = 'test-api-key-1234';
      jest.spyOn(logger, 'error').mockImplementation(() => {});

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(sms.sendGuestOtpSms('+919876543210', '123456')).rejects.toMatchObject({
        name: 'SmsDeliveryError',
        code: 'SMS_DELIVERY_FAILED',
      });
    });

    it('throws SmsDeliveryError on timeout (abort)', async () => {
      process.env.TWO_FACTOR_API_KEY = 'test-api-key-1234';
      jest.spyOn(logger, 'error').mockImplementation(() => {});

      const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
      global.fetch = jest.fn().mockRejectedValue(abortError);

      await expect(sms.sendGuestOtpSms('+919876543210', '123456')).rejects.toMatchObject({
        name: 'SmsDeliveryError',
        code: 'SMS_DELIVERY_FAILED',
      });
    });

    it('throws SmsDeliveryError on a malformed (non-JSON) 200 response', async () => {
      process.env.TWO_FACTOR_API_KEY = 'test-api-key-1234';
      jest.spyOn(logger, 'error').mockImplementation(() => {});

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '<html>gateway error</html>',
      });

      await expect(sms.sendGuestOtpSms('+919876543210', '123456')).rejects.toMatchObject({
        name: 'SmsDeliveryError',
        code: 'SMS_DELIVERY_FAILED',
      });
    });

    it('exposes only the generic user message — never provider detail, key, or OTP', async () => {
      process.env.TWO_FACTOR_API_KEY = 'secret-api-key-9999';
      jest.spyOn(logger, 'error').mockImplementation(() => {});

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Invalid Phone Number - Length Mismatch(Expected: 10)',
      });

      const error = await sms.sendGuestOtpSms('+919876543210', '123456').catch((e) => e);
      expect(error.message).toBe(sms.SMS_DELIVERY_USER_MESSAGE);
      expect(error.message).not.toContain('Phone Number');
      expect(error.message).not.toContain('secret-api-key-9999');
      expect(error.message).not.toContain('123456');
    });
  });
});
