// SMS provider abstraction for the public-quiz guest OTP flow — mirrors
// the provider chain in utils/mailer.js:
//
//   1. MSG91 configured (MSG91_AUTH_KEY + MSG91_TEMPLATE_ID +
//      MSG91_SENDER_ID)  -> real SMS via the MSG91 v5 OTP API
//   2. not configured + not production -> console mock (dev/test only;
//      the OTP value is hidden unless SMS_MOCK_ECHO=true)
//   3. not configured + production      -> hard error (SMS_NOT_CONFIGURED)
//
// The mock can never run in production, and there are no hardcoded OTPs
// anywhere — the code value only ever exists as generateOtp()'s return,
// the provider payload, and an HMAC digest in Mongo.
const logger = require('./logger');

const MSG91_OTP_ENDPOINT = 'https://control.msg91.com/api/v5/otp';
const MSG91_TIMEOUT_MS = 15000;

const SMS_DELIVERY_USER_MESSAGE =
  'Unable to send verification code right now. Please try again in a moment.';

class SmsDeliveryError extends Error {
  constructor(message = SMS_DELIVERY_USER_MESSAGE, code = 'SMS_DELIVERY_FAILED') {
    super(message);
    this.name = 'SmsDeliveryError';
    this.statusCode = 503;
    this.code = code;
    this.expose = true;
  }
}

const isProduction = () => process.env.NODE_ENV === 'production';

const isMsg91Configured = () =>
  Boolean(
    process.env.MSG91_AUTH_KEY?.trim() &&
      process.env.MSG91_TEMPLATE_ID?.trim() &&
      process.env.MSG91_SENDER_ID?.trim()
  );

const isSmsConfigured = () => isMsg91Configured();

const getSmsStatus = () => {
  if (isMsg91Configured()) {
    return { status: 'configured', provider: 'msg91', configured: true };
  }
  if (!isProduction()) {
    return { status: 'mock', provider: 'console', configured: false };
  }
  return { status: 'unconfigured', provider: null, configured: false };
};

const sanitizeProviderError = (message) => {
  if (!message) return 'Unknown provider error';
  return message
    .replace(/authkey['":\s]+[^,'"}\s]+/gi, 'authkey: [REDACTED]')
    .slice(0, 300);
};

// phone is E.164 (+91XXXXXXXXXX); MSG91 expects the bare 91XXXXXXXXXX form.
const sendViaMsg91 = async (phone, otp) => {
  const mobile = phone.replace(/^\+/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MSG91_TIMEOUT_MS);

  logger.info('[SMS] Provider: msg91');
  logger.info('[SMS] Sending guest OTP SMS', { to: phone });

  try {
    const response = await fetch(MSG91_OTP_ENDPOINT, {
      method: 'POST',
      headers: {
        authkey: process.env.MSG91_AUTH_KEY.trim(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template_id: process.env.MSG91_TEMPLATE_ID.trim(),
        mobile,
        otp,
        sender: process.env.MSG91_SENDER_ID.trim(),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MSG91 API error ${response.status}: ${sanitizeProviderError(body)}`);
    }

    // MSG91 returns {type: 'success', ...} with HTTP 200 on failure cases
    // (invalid template, DLT mismatch) — inspect the payload too.
    const payload = await response.json().catch(() => null);
    if (payload && payload.type === 'error') {
      throw new Error(
        `MSG91 API rejected request: ${sanitizeProviderError(payload.message || JSON.stringify(payload))}`
      );
    }

    logger.info('[SMS] Provider request completed successfully', {
      provider: 'msg91',
      to: phone,
    });
  } catch (error) {
    const message = error.name === 'AbortError' ? 'MSG91 API timed out' : error.message;
    logger.error('[SMS] MSG91 request failed', {
      to: phone,
      errorMessage: sanitizeProviderError(message),
    });
    throw new SmsDeliveryError(SMS_DELIVERY_USER_MESSAGE, 'SMS_DELIVERY_FAILED');
  } finally {
    clearTimeout(timeout);
  }
};

const logDevOtpSms = (phone, otp) => {
  console.log('\n==================================================');
  console.log(`📱 [DEV SMS] Guest quiz OTP requested for ${phone}`);
  if (process.env.SMS_MOCK_ECHO === 'true') {
    console.log(`👉 OTP: ${otp}`);
  } else {
    console.log('👉 OTP was generated (value hidden — set SMS_MOCK_ECHO=true to show it, or read the GuestOtp flow in tests)');
  }
  console.log('==================================================\n');
};

const sendGuestOtpSms = async (phone, otp) => {
  if (isMsg91Configured()) {
    await sendViaMsg91(phone, otp);
    return;
  }

  if (!isProduction()) {
    logDevOtpSms(phone, otp);
    return;
  }

  logger.error('[SMS] No SMS provider configured in production');
  throw new SmsDeliveryError(SMS_DELIVERY_USER_MESSAGE, 'SMS_NOT_CONFIGURED');
};

module.exports = {
  SmsDeliveryError,
  SMS_DELIVERY_USER_MESSAGE,
  sendGuestOtpSms,
  isSmsConfigured,
  getSmsStatus,
};
