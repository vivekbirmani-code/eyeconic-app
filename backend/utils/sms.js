// SMS provider abstraction for the public-quiz guest OTP flow — mirrors
// the provider chain in utils/mailer.js:
//
//   1. 2Factor configured (TWO_FACTOR_API_KEY) -> real SMS via the 2Factor
//      "Send OTP (Manual Generation)" API. Eyeconic generates the OTP value
//      and verifies it (HMAC, expiry, single-use — see utils/guestOtp);
//      2Factor is ONLY the delivery channel.
//   2. not configured + not production -> console mock (dev/test only;
//      the OTP value is hidden unless SMS_MOCK_ECHO=true)
//   3. not configured + production      -> hard error (SMS_NOT_CONFIGURED)
//
// The mock can never run in production, and there are no hardcoded OTPs
// anywhere — the code value only ever exists as generateOtp()'s return,
// the provider request URL, and an HMAC digest in Mongo.
const logger = require('./logger');
const { maskPhone } = require('./phone');

// https://2factor.in API — key passed as a path segment, per their docs:
//   GET /API/V1/{api_key}/SMS/{phone}/{otp}[/{template}]
const TWO_FACTOR_BASE_URL = 'https://2factor.in/API/V1';
const TWO_FACTOR_TIMEOUT_MS = 15000;

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

// Internal only — carries a safe category for logs; the provider detail is
// sanitized before it is ever logged and never reaches the client.
class ProviderCallError extends Error {
  constructor(category, detail) {
    super(typeof detail === 'string' && detail ? detail : 'provider call failed');
    this.name = 'ProviderCallError';
    this.category = category;
  }
}

const isProduction = () => process.env.NODE_ENV === 'production';

const isTwoFactorConfigured = () => Boolean(process.env.TWO_FACTOR_API_KEY?.trim());

const isSmsConfigured = () => isTwoFactorConfigured();

const getSmsStatus = () => {
  if (isTwoFactorConfigured()) {
    return { status: 'configured', provider: '2factor', configured: true };
  }
  if (!isProduction()) {
    return { status: 'mock', provider: 'console', configured: false };
  }
  return { status: 'unconfigured', provider: null, configured: false };
};

// The API key, the OTP value, AND the phone are all URL path segments, so
// any provider echo of the request URL must be scrubbed before logging. The
// client never sees provider text at all — only the generic user message.
const sanitizeProviderError = (message, { apiKey, otp, phone } = {}) => {
  if (!message) return 'Unknown provider error';
  let text = String(message);
  if (apiKey) text = text.split(apiKey).join('[REDACTED]');
  if (otp) text = text.split(String(otp)).join('[OTP]');
  if (phone) {
    const national = phone.replace(/^\+?91/, '');
    text = text.split(phone).join('[PHONE]').split(national).join('[PHONE]');
  }
  return text.slice(0, 300);
};

// phone is E.164 (+91XXXXXXXXXX) — exactly the format in 2Factor's endpoint
// examples, sent as-is ('+' is a literal path character). otp is 6 digits
// from generateOtp(). Both are strictly [0-9+] by construction upstream, so
// they need no URL encoding; the key/template are user-entered and are
// encoded. The full URL is NEVER logged.
const sendViaTwoFactor = async (phone, otp) => {
  const apiKey = process.env.TWO_FACTOR_API_KEY.trim();
  const template = process.env.TWO_FACTOR_OTP_TEMPLATE?.trim();
  const sendUrl = template
    ? `${TWO_FACTOR_BASE_URL}/${encodeURIComponent(apiKey)}/SMS/${phone}/${otp}/${encodeURIComponent(template)}`
    : `${TWO_FACTOR_BASE_URL}/${encodeURIComponent(apiKey)}/SMS/${phone}/${otp}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TWO_FACTOR_TIMEOUT_MS);

  logger.info('[SMS] Provider: 2factor');
  logger.info('[SMS] Sending guest OTP SMS', { to: maskPhone(phone) });

  try {
    const response = await fetch(sendUrl, { method: 'GET', signal: controller.signal });
    const body = await response.text();

    // 2Factor rejects with HTTP 4xx AND plain-text bodies ("Invalid API
    // Key", "Invalid Phone Number - Length Mismatch(Expected: 10)")...
    if (!response.ok) {
      throw new ProviderCallError(`http_${response.status}`, body);
    }

    // ...but also reports account-level failures inside a 200 body as
    // {"Status": "Error", "Details": ...}. A 2xx alone is NOT success.
    let payload = null;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = null;
    }
    if (!payload || payload.Status !== 'Success') {
      const detail =
        (payload && (payload.Details || payload.Error)) || body || 'unparseable provider response';
      throw new ProviderCallError(
        payload ? 'provider_rejected' : 'malformed_response',
        detail
      );
    }

    logger.info('[SMS] Provider request completed successfully', {
      provider: '2factor',
      to: maskPhone(phone),
    });
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    const category = aborted ? 'timeout' : error?.category || 'unexpected';
    const detail = aborted ? '2Factor API timed out' : error?.message;
    logger.error('[SMS] 2Factor request failed', {
      to: maskPhone(phone),
      errorCategory: category,
      errorMessage: sanitizeProviderError(detail, { apiKey, otp, phone }),
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
  if (isTwoFactorConfigured()) {
    await sendViaTwoFactor(phone, otp);
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
