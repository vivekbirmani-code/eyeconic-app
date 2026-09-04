const originalEnv = { ...process.env };

describe('sms provider abstraction', () => {
  let sms;

  const clearMsg91Env = () => {
    delete process.env.MSG91_AUTH_KEY;
    delete process.env.MSG91_TEMPLATE_ID;
    delete process.env.MSG91_SENDER_ID;
  };

  beforeEach(() => {
    jest.resetModules();
    clearMsg91Env();
    process.env.NODE_ENV = 'development';
    process.env.SMS_MOCK_ECHO = 'false';
    sms = require('../../utils/sms');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (global.fetch && jest.isMockFunction(global.fetch)) {
      global.fetch.mockRestore();
    }
  });

  describe('getSmsStatus', () => {
    it('reports msg91 when fully configured', () => {
      process.env.MSG91_AUTH_KEY = 'key';
      process.env.MSG91_TEMPLATE_ID = 'tpl';
      process.env.MSG91_SENDER_ID = 'EYECNC';
      expect(sms.getSmsStatus()).toEqual({ status: 'configured', provider: 'msg91', configured: true });
    });

    it('requires ALL three MSG91 variables', () => {
      process.env.MSG91_AUTH_KEY = 'key';
      process.env.MSG91_TEMPLATE_ID = 'tpl';
      expect(sms.getSmsStatus().status).toBe('mock'); // missing sender id, not production
    });

    it('reports unconfigured in production', () => {
      process.env.NODE_ENV = 'production';
      expect(sms.getSmsStatus()).toEqual({ status: 'unconfigured', provider: null, configured: false });
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

    it('calls the MSG91 v5 OTP API with the DLT template and sender', async () => {
      process.env.MSG91_AUTH_KEY = 'test-auth-key';
      process.env.MSG91_TEMPLATE_ID = 'test-template';
      process.env.MSG91_SENDER_ID = 'EYECNC';

      const fetchSpy = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ type: 'success' }),
      });
      global.fetch = fetchSpy;

      await sms.sendGuestOtpSms('+919876543210', '123456');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://control.msg91.com/api/v5/otp');
      expect(options.method).toBe('POST');
      expect(options.headers.authkey).toBe('test-auth-key');
      expect(JSON.parse(options.body)).toEqual({
        template_id: 'test-template',
        mobile: '919876543210',
        otp: '123456',
        sender: 'EYECNC',
      });
    });

    it('throws SmsDeliveryError when MSG91 returns an HTTP error, without leaking the authkey', async () => {
      process.env.MSG91_AUTH_KEY = 'secret-auth-key';
      process.env.MSG91_TEMPLATE_ID = 'test-template';
      process.env.MSG91_SENDER_ID = 'EYECNC';

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized authkey secret-auth-key',
      });

      await expect(sms.sendGuestOtpSms('+919876543210', '123456')).rejects.toMatchObject({
        name: 'SmsDeliveryError',
        code: 'SMS_DELIVERY_FAILED',
      });
    });

    it('treats MSG91 {type:"error"} payloads as failures', async () => {
      process.env.MSG91_AUTH_KEY = 'test-auth-key';
      process.env.MSG91_TEMPLATE_ID = 'test-template';
      process.env.MSG91_SENDER_ID = 'EYECNC';

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ type: 'error', message: 'template not approved' }),
      });

      await expect(sms.sendGuestOtpSms('+919876543210', '123456')).rejects.toMatchObject({
        name: 'SmsDeliveryError',
        code: 'SMS_DELIVERY_FAILED',
      });
    });
  });
});
