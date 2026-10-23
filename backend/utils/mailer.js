const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const logger = require('./logger');
const EmailDeliveryLog = require('../models/EmailDeliveryLog');

// Email delivery for OTP flows (signup, password reset, public-quiz guest).
//
// Delivery strategy, in order:
//   1. SMTP (nodemailer) with a CACHED POOLED transporter and bounded retries
//      for transient provider failures (4xx "try later", greylisting,
//      connection throttling, network blips). Permanent failures (5xx, auth,
//      rejected recipient) fail fast without burning retries.
//   2. Resend HTTP API fallback when SMTP stays failed and RESEND_API_KEY is
//      configured — retried on 429/5xx with the same budget.
//
// Everything is bounded by DELIVERY_DEADLINE_MS so the whole chain (retries +
// fallback) answers well inside the clients' request timeouts (web: 30s/60s,
// mobile: 30s + client-side retry).
//
// Every real provider attempt is recorded in the EmailDeliveryLog collection
// (best-effort, never blocks the send path) so delivery complaints can be
// diagnosed after the fact.

const SMTP_CONNECTION_TIMEOUT_MS = 8000;
const SMTP_GREETING_TIMEOUT_MS = 8000;
const SMTP_SOCKET_TIMEOUT_MS = 12000;
const RESEND_TIMEOUT_MS = 10000;
// No NEW attempt is started past this deadline (an in-flight attempt still
// runs to its own timeout). Realistic failure+retry chains finish in a few
// seconds; only pathological provider hangs approach the ceiling.
const DELIVERY_DEADLINE_MS = 20000;
const SMTP_MAX_ATTEMPTS = 3;
const RESEND_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_BACKOFF_FACTOR = 3; // 500ms -> 1500ms
const RETRY_JITTER_MS = 250;

const EMAIL_DELIVERY_USER_MESSAGE =
  'Unable to send verification code right now. Please try again in a moment.';
const EMAIL_RECIPIENT_REJECTED_MESSAGE =
  'We could not deliver the code to this email address. Please double-check the spelling and try again.';

class EmailDeliveryError extends Error {
  constructor(
    message = EMAIL_DELIVERY_USER_MESSAGE,
    code = 'EMAIL_DELIVERY_FAILED',
    statusCode = 503
  ) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.statusCode = statusCode;
    this.code = code;
    this.expose = true;
  }
}

// Internal per-attempt failure. `retryable` drives the retry loop;
// `publicCode` maps to the client-facing EmailDeliveryError.
class ProviderSendError extends Error {
  constructor(message, { retryable = false, kind = 'unknown', publicCode = 'EMAIL_DELIVERY_FAILED' } = {}) {
    super(message);
    this.name = 'ProviderSendError';
    this.retryable = retryable;
    this.kind = kind;
    this.publicCode = publicCode;
  }
}

const isProduction = () => process.env.NODE_ENV === 'production';

const isSmtpConfigured = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const isResendConfigured = () => Boolean(process.env.RESEND_API_KEY?.trim());

const isEmailConfigured = () => isResendConfigured() || isSmtpConfigured();

const getFromAddress = () => {
  const fromName = process.env.SMTP_FROM_NAME || 'Eyeconic Mentors';

  let fromEmail;
  if (isSmtpConfigured()) {
    fromEmail =
      process.env.SMTP_FROM_EMAIL?.trim() ||
      process.env.SMTP_USER?.trim() ||
      process.env.RESEND_FROM_EMAIL?.trim() ||
      'no-reply@eyeconicmentors.com';
  } else if (isResendConfigured()) {
    fromEmail =
      process.env.RESEND_FROM_EMAIL?.trim() ||
      process.env.SMTP_FROM_EMAIL?.trim() ||
      'onboarding@resend.dev';
  } else {
    fromEmail =
      process.env.SMTP_FROM_EMAIL?.trim() ||
      process.env.RESEND_FROM_EMAIL?.trim() ||
      'no-reply@eyeconicmentors.com';
  }

  return {
    fromName,
    fromEmail,
    from: `${fromName} <${fromEmail}>`,
  };
};

const getEmailStatus = () => {
  if (isSmtpConfigured()) {
    return {
      status: 'configured',
      provider: 'smtp',
      configured: true,
      fallback: isResendConfigured() ? 'resend' : null,
    };
  }
  if (isResendConfigured()) {
    return { status: 'configured', provider: 'resend', configured: true };
  }
  if (!isProduction()) {
    return { status: 'mock', provider: 'console', configured: false };
  }
  return { status: 'unconfigured', provider: null, configured: false };
};

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const buildOtpHtml = (otp, purpose, quizTitle) => {
  let heading;
  if (purpose === 'reset') {
    heading = 'You requested a password reset. Please use the verification code below to set your new password:';
  } else if (purpose === 'guest-quiz') {
    heading = 'Please use the verification code below to verify your email and start your quiz:';
  } else {
    heading = 'Thank you for choosing Eyeconic Mentors. Please use the verification code below to complete your registration:';
  }
  const quizLine = purpose === 'guest-quiz' && quizTitle
    ? `<p style="margin: 0 0 15px 0; font-size: 15px; font-weight: bold; color: #111827;">Quiz: ${escapeHtml(quizTitle)}</p>`
    : '';

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e1e1e1; border-radius: 12px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #01b4ae; margin: 0; font-size: 26px; letter-spacing: 1px;">EYECONIC MENTORS</h2>
        <p style="color: #6b7280; font-size: 14px; margin: 5px 0 0 0;">Your path to medical excellence</p>
      </div>
      <hr style="border: 0; border-top: 1px solid #eaeaea; margin-bottom: 25px;" />
      <div style="color: #374151; font-size: 16px; line-height: 24px;">
        <p style="margin-top: 0;">Hello,</p>
        ${quizLine}
        <p>${heading}</p>
        <div style="text-align: center; margin: 30px 0;">
          <span style="display: inline-block; font-size: 32px; font-weight: bold; color: #01b4ae; letter-spacing: 5px; padding: 12px 24px; border: 2px dashed #01b4ae; border-radius: 8px; background-color: #f0fdfa;">
            ${otp}
          </span>
        </div>
        <p style="font-size: 14px; color: #6b7280;">This code is valid for <strong>10 minutes</strong>. If you did not request this code, please ignore this email.</p>
      </div>
      <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 25px 0;" />
      <div style="text-align: center; font-size: 12px; color: #9ca3af;">
        <p style="margin: 0;">© ${new Date().getFullYear()} Eyeconic Mentors. All rights reserved.</p>
      </div>
    </div>
  `;
};

// ---- pooled SMTP transporter (cached per configuration) -------------------
//
// A pooled transporter reuses authenticated connections instead of performing
// a fresh TCP+TLS+AUTH handshake per message. Handshake-per-message is what
// trips provider connection-rate limits when many students request a code at
// once (a teacher sharing the link with a whole class) — the classic source
// of "sometimes the OTP just doesn't come".

const parsePositiveInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getSmtpPoolConfig = () => ({
  pool: true,
  maxConnections: parsePositiveInt(process.env.SMTP_POOL_MAX_CONNECTIONS, 5),
  maxMessages: parsePositiveInt(process.env.SMTP_POOL_MAX_MESSAGES, 200),
});

let cachedTransporter = null;
let cachedTransporterSignature = null;

const closeEmailTransporter = () => {
  if (cachedTransporter) {
    try {
      cachedTransporter.close();
    } catch {
      /* pool already gone — nothing to do */
    }
  }
  cachedTransporter = null;
  cachedTransporterSignature = null;
};

const getTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  const pool = getSmtpPoolConfig();
  const portNumber = parseInt(port, 10);
  const signature = [
    host,
    portNumber,
    portNumber === 465,
    user,
    pass,
    pool.maxConnections,
    pool.maxMessages,
  ].join('|');

  if (cachedTransporter && cachedTransporterSignature === signature) {
    return cachedTransporter;
  }

  if (cachedTransporter) {
    closeEmailTransporter();
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port: portNumber,
    secure: portNumber === 465,
    auth: { user, pass },
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    disableFileAccess: true,
    disableUrlAccess: true,
    ...pool,
  });
  cachedTransporterSignature = signature;

  return cachedTransporter;
};

// ---- provider error classification -----------------------------------------

const sanitizeProviderError = (message) => {
  if (!message) return 'Unknown provider error';
  return String(message).replace(/Bearer\s+\S+/gi, '[REDACTED]').slice(0, 300);
};

// 4xx SMTP statuses are transient by design (RFC 5321) — greylisting,
// throttling, temporary unavailability. Unknown 4xx codes retry as well.
const isTransientResponseCode = (code) => code >= 400 && code < 500;

const RETRYABLE_NETWORK_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPROTO',
  'ECONNABORTED',
  'ECONNECTION',
  'ESTREAM',
  'EDNS',
]);

const RETRYABLE_MESSAGE_PATTERNS = [
  /greylist/i,
  /try again/i,
  /temporar/i,
  /throttl/i,
  /too many connections/i,
  /too many concurrent/i,
  /unavailable/i,
  /timed? ?out/i,
  /connection (was )?closed/i,
  /connection reset/i,
  /unexpectedly disconnected/i,
];

// Nodemailer protocol/envelope-level failures that retrying will not fix.
const PERMANENT_NODEMAILER_CODES = new Set(['EAUTH', 'EENVELOPE', 'EMESSAGE', 'ECOMMAND']);

const classifySmtpError = (error) => {
  const responseCode = Number(error?.responseCode);
  if (Number.isFinite(responseCode) && responseCode > 0) {
    return {
      retryable: isTransientResponseCode(responseCode),
      kind: `smtp-${responseCode}`,
    };
  }

  const code = String(error?.code || '').toUpperCase();
  if (code === 'EAUTH') {
    return { retryable: false, kind: 'smtp-auth' };
  }
  if (RETRYABLE_NETWORK_CODES.has(code)) {
    return { retryable: true, kind: code.toLowerCase() };
  }
  if (PERMANENT_NODEMAILER_CODES.has(code)) {
    return { retryable: false, kind: code.toLowerCase() };
  }

  const message = String(error?.message || '');
  if (RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return { retryable: true, kind: 'smtp-transient-message' };
  }

  return { retryable: false, kind: 'smtp-unknown' };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const retryDelayMs = (attempt) =>
  RETRY_BASE_DELAY_MS * RETRY_BACKOFF_FACTOR ** (attempt - 1) +
  Math.floor(Math.random() * RETRY_JITTER_MS);

// Runs `sender(attempt)` up to maxAttempts times while the delivery deadline
// allows, retrying only errors flagged `retryable`. Returns the sender's
// result plus the attempt count it took; on failure the thrown error carries
// `.attempts` so the audit log records the real number.
const runWithRetry = async (sender, providerLabel, deadlineAt, maxAttempts) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (Date.now() >= deadlineAt) {
      if (lastError) {
        lastError.attempts = attempt - 1;
      }
      break; // no budget left to start another attempt
    }
    try {
      const result = await sender(attempt);
      return { ...result, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (!error?.retryable || attempt === maxAttempts) {
        error.attempts = attempt;
        throw error;
      }
      logger.warn(`[EMAIL] ${providerLabel} transient failure, retrying`, {
        attempt: `${attempt}/${maxAttempts}`,
        kind: error.kind,
        errorMessage: sanitizeProviderError(error.message),
      });
      await sleep(retryDelayMs(attempt));
    }
  }
  throw (
    lastError ||
    new ProviderSendError(`${providerLabel} delivery deadline exceeded before attempting`, {
      kind: 'deadline',
    })
  );
};

// ---- Resend (HTTPS fallback) -----------------------------------------------

const sendViaResendOnce = async (email, subject, html, text, attempt) => {
  const { from } = getFromAddress();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);

  if (attempt === 1) {
    logger.info('[EMAIL] Provider: resend');
    logger.info('[EMAIL] Sending verification email', { to: email, subject });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        html,
        text,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      // 429 (rate limited) and 5xx (provider incident) are transient; other
      // 4xx (bad API key, invalid payload) are permanent.
      throw new ProviderSendError(
        `Resend API error ${response.status}: ${sanitizeProviderError(body)}`,
        { retryable: response.status === 429 || response.status >= 500, kind: `resend-${response.status}` }
      );
    }

    const payload = await response.json().catch(() => ({}));

    logger.info('[EMAIL] Email provider request completed successfully', {
      provider: 'resend',
      to: email,
      attempt,
    });

    return { messageId: typeof payload?.id === 'string' ? payload.id : null };
  } catch (error) {
    if (error instanceof ProviderSendError) {
      throw error;
    }
    const message = error.name === 'AbortError' ? 'Resend API timed out' : error.message;
    logger.error('[EMAIL] Resend request failed', {
      to: email,
      attempt,
      errorMessage: sanitizeProviderError(message),
    });
    // Network-level failures (DNS, TLS, reset) are transient.
    throw new ProviderSendError(`Resend request failed: ${sanitizeProviderError(message)}`, {
      retryable: true,
      kind: 'resend-network',
    });
  } finally {
    clearTimeout(timeout);
  }
};

// ---- SMTP (primary) ---------------------------------------------------------

const formatRejected = (rejected) =>
  (Array.isArray(rejected) ? rejected : [])
    .map((entry) => (typeof entry === 'string' ? entry : entry?.address))
    .filter(Boolean)
    .join(', ');

const sendViaSmtpOnce = async (mailOptions, attempt) => {
  const transporter = getTransporter();
  if (!transporter) {
    throw new ProviderSendError('SMTP provider is not configured', {
      kind: 'not-configured',
      publicCode: 'EMAIL_NOT_CONFIGURED',
    });
  }

  if (attempt === 1) {
    logger.info('[EMAIL] Provider: smtp');
    logger.info('[EMAIL] Sending verification email', {
      to: mailOptions.to,
      subject: mailOptions.subject,
    });
  }

  let info;
  try {
    info = await transporter.sendMail(mailOptions);
  } catch (error) {
    const classified = classifySmtpError(error);
    if (attempt > 1 || classified.retryable) {
      // Full detail for every failed attempt — this is the line support
      // greps when a code "never arrived".
      logger.error('[EMAIL] SMTP attempt failed', {
        to: mailOptions.to,
        attempt,
        kind: classified.kind,
        retryable: classified.retryable,
        errorMessage: sanitizeProviderError(error.message),
      });
    }
    throw new ProviderSendError(`SMTP send failed: ${sanitizeProviderError(error.message)}`, {
      retryable: classified.retryable,
      kind: classified.kind,
    });
  }

  // sendMail resolving is NOT proof of delivery: when the relay rejects a
  // recipient at the SMTP envelope stage (typo'd domain, blocked mailbox)
  // nodemailer resolves with the address in info.rejected. Treating that as
  // success made the API answer "code sent" while no email could ever
  // arrive — the primary "OTP never came" bug.
  const rejected = formatRejected(info?.rejected);
  if (rejected) {
    logger.error('[EMAIL] SMTP accepted message but rejected recipient', {
      to: mailOptions.to,
      rejected,
      response: sanitizeProviderError(info?.response),
    });
    throw new ProviderSendError(
      `SMTP recipient rejected: ${rejected} (response: ${sanitizeProviderError(info.response)})`,
      { retryable: false, kind: 'recipient-rejected', publicCode: 'EMAIL_RECIPIENT_REJECTED' }
    );
  }

  logger.info('[EMAIL] Email provider request completed successfully', {
    provider: 'smtp',
    to: mailOptions.to,
    attempt,
  });

  return { messageId: typeof info?.messageId === 'string' ? info.messageId : null };
};

// ---- delivery audit trail ---------------------------------------------------

// Best-effort persistence of every real provider outcome. NEVER throws into
// the delivery path, and is skipped entirely when the DB is not connected
// (dev without Mongo, startup races).
const recordDeliveryOutcome = (entry) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return;
    }
    EmailDeliveryLog.create(entry).catch((error) => {
      logger.warn('[EMAIL] Failed to persist delivery log', {
        errorMessage: error.message,
      });
    });
  } catch (error) {
    logger.warn('[EMAIL] Failed to persist delivery log', {
      errorMessage: error.message,
    });
  }
};

const toPublicDeliveryError = (error) => {
  if (error instanceof EmailDeliveryError) {
    return error;
  }
  if (error?.publicCode === 'EMAIL_RECIPIENT_REJECTED') {
    return new EmailDeliveryError(
      EMAIL_RECIPIENT_REJECTED_MESSAGE,
      'EMAIL_RECIPIENT_REJECTED',
      422
    );
  }
  if (error?.publicCode === 'EMAIL_NOT_CONFIGURED') {
    return new EmailDeliveryError(EMAIL_DELIVERY_USER_MESSAGE, 'EMAIL_NOT_CONFIGURED');
  }
  return new EmailDeliveryError(EMAIL_DELIVERY_USER_MESSAGE, 'EMAIL_DELIVERY_FAILED');
};

// Dev-only OTP echo. Reached ONLY when no provider is configured AND
// NODE_ENV !== 'production' (see deliverEmail) — the documented dev
// behavior ("in dev with no provider configured, OTPs print to the
// console instead of sending", BACKEND_GUIDE §24). Production can never
// print a code: Render sets NODE_ENV=production and logDevOtp no-ops.
const logDevOtp = (email, label, otp) => {
  if (isProduction()) {
    return;
  }

  console.log('\n==================================================');
  console.log(`📧 [DEV EMAILER] ${label} requested for ${email}`);
  console.log(`👉 OTP (dev console delivery): ${otp}`);
  console.log('==================================================\n');
};

const deliverEmail = async (email, subject, html, text, devLabel, purpose, context = {}, otpForDevLog = null) => {
  const startedAt = Date.now();
  const deadlineAt = startedAt + DELIVERY_DEADLINE_MS;
  const { fromName, fromEmail } = getFromAddress();
  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: email,
    subject,
    text,
    html,
  };

  const audit = (fields) =>
    recordDeliveryOutcome({
      toEmail: email,
      purpose,
      durationMs: Date.now() - startedAt,
      requestId: context?.requestId,
      ...fields,
    });

  if (isSmtpConfigured()) {
    try {
      const sent = await runWithRetry(
        (attempt) => sendViaSmtpOnce(mailOptions, attempt),
        'SMTP',
        deadlineAt,
        SMTP_MAX_ATTEMPTS
      );
      audit({ provider: 'smtp', status: 'sent', attempts: sent.attempts, messageId: sent.messageId });
      return;
    } catch (smtpError) {
      // A recipient rejection is the RELAY authoritatively stating the
      // mailbox does not exist (typo'd domain, blocked address). Retrying or
      // re-routing through the fallback provider cannot fix the address —
      // fail fast so the student gets the actionable "check the spelling"
      // error instead of a generic retry-later one.
      const recipientRejected = smtpError.publicCode === 'EMAIL_RECIPIENT_REJECTED';
      if (!isResendConfigured() || recipientRejected) {
        audit({
          provider: 'smtp',
          status: 'failed',
          attempts: smtpError.attempts || SMTP_MAX_ATTEMPTS,
          errorCode: smtpError.kind || 'EMAIL_DELIVERY_FAILED',
          errorDetail: sanitizeProviderError(smtpError.message),
        });
        throw toPublicDeliveryError(smtpError);
      }

      logger.warn('[EMAIL] SMTP failed, attempting Resend fallback', {
        to: email,
        errorMessage: sanitizeProviderError(smtpError.message),
      });

      try {
        const sent = await runWithRetry(
          (attempt) => sendViaResendOnce(email, subject, html, text, attempt),
          'Resend',
          deadlineAt,
          RESEND_MAX_ATTEMPTS
        );
        audit({
          provider: 'smtp+resend-fallback',
          status: 'sent',
          attempts: sent.attempts,
          messageId: sent.messageId,
        });
        return;
      } catch (fallbackError) {
        audit({
          provider: 'smtp+resend-fallback',
          status: 'failed',
          attempts: (smtpError.attempts || SMTP_MAX_ATTEMPTS) + (fallbackError.attempts || 1),
          errorCode: fallbackError.kind || 'EMAIL_DELIVERY_FAILED',
          errorDetail: sanitizeProviderError(
            `smtp: ${smtpError.message} | resend: ${fallbackError.message}`
          ),
        });
        throw toPublicDeliveryError(fallbackError);
      }
    }
  }

  if (isResendConfigured()) {
    try {
      const sent = await runWithRetry(
        (attempt) => sendViaResendOnce(email, subject, html, text, attempt),
        'Resend',
        deadlineAt,
        RESEND_MAX_ATTEMPTS
      );
      audit({ provider: 'resend', status: 'sent', attempts: sent.attempts, messageId: sent.messageId });
      return;
    } catch (resendError) {
      audit({
        provider: 'resend',
        status: 'failed',
        attempts: resendError.attempts || RESEND_MAX_ATTEMPTS,
        errorCode: resendError.kind || 'EMAIL_DELIVERY_FAILED',
        errorDetail: sanitizeProviderError(resendError.message),
      });
      throw toPublicDeliveryError(resendError);
    }
  }

  if (!isProduction()) {
    logDevOtp(email, devLabel, otpForDevLog);
    return;
  }

  logger.error('[EMAIL] No email provider configured in production');
  throw new EmailDeliveryError(EMAIL_DELIVERY_USER_MESSAGE, 'EMAIL_NOT_CONFIGURED');
};

const sendOtpMail = async (email, otp, context = {}) => {
  const subject = 'Eyeconic Mentors - Email Verification Code';
  const text = `Your verification code is ${otp}. It is valid for 10 minutes.`;
  const html = buildOtpHtml(otp, 'signup');

  await deliverEmail(email, subject, html, text, 'SIGNUP OTP', 'signup', context, otp);
};

const sendPasswordResetMail = async (email, otp, context = {}) => {
  const subject = 'Eyeconic Mentors - Password Reset Verification Code';
  const text = `Your password reset verification code is ${otp}. It is valid for 10 minutes.`;
  const html = buildOtpHtml(otp, 'reset');

  await deliverEmail(email, subject, html, text, 'PASSWORD RESET OTP', 'password-reset', context, otp);
};

// Public-quiz guest flow — the code verifies the lead's email before their
// attempt/lead is finalized. quizTitle (optional) helps the recipient
// recognize why they received the code.
const sendGuestQuizOtpMail = async (email, otp, quizTitle = null, context = {}) => {
  const subject = quizTitle
    ? `Eyeconic Mentors - Verification Code for "${quizTitle}"`
    : 'Eyeconic Mentors - Quiz Verification Code';
  const text = `Your verification code to start the quiz${quizTitle ? ` "${quizTitle}"` : ''} is ${otp}. It is valid for 10 minutes. If you did not request this code, please ignore this email.`;
  const html = buildOtpHtml(otp, 'guest-quiz', quizTitle);

  await deliverEmail(email, subject, html, text, 'GUEST QUIZ OTP', 'guest-quiz', context, otp);
};

module.exports = {
  EmailDeliveryError,
  EMAIL_DELIVERY_USER_MESSAGE,
  sendOtpMail,
  sendPasswordResetMail,
  sendGuestQuizOtpMail,
  isEmailConfigured,
  getEmailStatus,
  isResendConfigured,
  isSmtpConfigured,
  closeEmailTransporter,
};
