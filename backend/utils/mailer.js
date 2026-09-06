const nodemailer = require('nodemailer');
const logger = require('./logger');

const SMTP_TIMEOUT_MS = 10000;
const RESEND_TIMEOUT_MS = 15000;

const EMAIL_DELIVERY_USER_MESSAGE =
  'Unable to send verification code right now. Please try again in a moment.';

class EmailDeliveryError extends Error {
  constructor(message = EMAIL_DELIVERY_USER_MESSAGE, code = 'EMAIL_DELIVERY_FAILED') {
    super(message);
    this.name = 'EmailDeliveryError';
    this.statusCode = 503;
    this.code = code;
    this.expose = true;
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

const getTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(port, 10),
    secure: parseInt(port, 10) === 465,
    auth: { user, pass },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
};

const sanitizeProviderError = (message) => {
  if (!message) return 'Unknown provider error';
  return message.replace(/Bearer\s+\S+/gi, '[REDACTED]').slice(0, 300);
};

const sendViaResend = async (email, subject, html, text) => {
  const { from } = getFromAddress();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);

  logger.info('[EMAIL] Provider: resend');
  logger.info('[EMAIL] Sending verification email', { to: email, subject });

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
      throw new Error(`Resend API error ${response.status}: ${sanitizeProviderError(body)}`);
    }

    logger.info('[EMAIL] Email provider request completed successfully', {
      provider: 'resend',
      to: email,
    });
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Resend API timed out' : error.message;
    logger.error('[EMAIL] Resend request failed', {
      to: email,
      errorMessage: sanitizeProviderError(message),
    });
    throw new EmailDeliveryError(EMAIL_DELIVERY_USER_MESSAGE, 'EMAIL_DELIVERY_FAILED');
  } finally {
    clearTimeout(timeout);
  }
};

const sendViaSmtp = async (mailOptions) => {
  const transporter = getTransporter();
  if (!transporter) {
    throw new EmailDeliveryError(
      EMAIL_DELIVERY_USER_MESSAGE,
      'EMAIL_NOT_CONFIGURED'
    );
  }

  logger.info('[EMAIL] Provider: smtp');
  logger.info('[EMAIL] Sending verification email', {
    to: mailOptions.to,
    subject: mailOptions.subject,
  });

  try {
    await transporter.sendMail(mailOptions);
    logger.info('[EMAIL] Email provider request completed successfully', {
      provider: 'smtp',
      to: mailOptions.to,
    });
  } catch (error) {
    logger.error('[EMAIL] SMTP request failed', {
      to: mailOptions.to,
      errorMessage: sanitizeProviderError(error.message),
    });
    throw new EmailDeliveryError(EMAIL_DELIVERY_USER_MESSAGE, 'EMAIL_DELIVERY_FAILED');
  }
};

const logDevOtp = (email, label) => {
  if (isProduction()) {
    return;
  }

  console.log('\n==================================================');
  console.log(`📧 [DEV EMAILER] ${label} requested for ${email}`);
  console.log('👉 OTP was generated (value hidden — check email provider or database in dev)');
  console.log('==================================================\n');
};

const deliverEmail = async (email, subject, html, text, devLabel) => {
  const { fromName, fromEmail } = getFromAddress();
  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: email,
    subject,
    text,
    html,
  };

  if (isSmtpConfigured()) {
    try {
      await sendViaSmtp(mailOptions);
      return;
    } catch (smtpError) {
      if (isResendConfigured()) {
        logger.warn('[EMAIL] SMTP failed, attempting Resend fallback', {
          to: email,
          errorMessage: sanitizeProviderError(smtpError.message),
        });
        await sendViaResend(email, subject, html, text);
        return;
      }
      throw smtpError;
    }
  }

  if (isResendConfigured()) {
    await sendViaResend(email, subject, html, text);
    return;
  }

  if (!isProduction()) {
    logDevOtp(email, devLabel);
    return;
  }

  logger.error('[EMAIL] No email provider configured in production');
  throw new EmailDeliveryError(EMAIL_DELIVERY_USER_MESSAGE, 'EMAIL_NOT_CONFIGURED');
};

const sendOtpMail = async (email, otp) => {
  const subject = 'Eyeconic Mentors - Email Verification Code';
  const text = `Your verification code is ${otp}. It is valid for 10 minutes.`;
  const html = buildOtpHtml(otp, 'signup');

  await deliverEmail(email, subject, html, text, 'SIGNUP OTP');
};

const sendPasswordResetMail = async (email, otp) => {
  const subject = 'Eyeconic Mentors - Password Reset Verification Code';
  const text = `Your password reset verification code is ${otp}. It is valid for 10 minutes.`;
  const html = buildOtpHtml(otp, 'reset');

  await deliverEmail(email, subject, html, text, 'PASSWORD RESET OTP');
};

// Public-quiz guest flow — the code verifies the lead's email before their
// attempt/lead is finalized. quizTitle (optional) helps the recipient
// recognize why they received the code.
const sendGuestQuizOtpMail = async (email, otp, quizTitle = null) => {
  const subject = quizTitle
    ? `Eyeconic Mentors - Verification Code for "${quizTitle}"`
    : 'Eyeconic Mentors - Quiz Verification Code';
  const text = `Your verification code to start the quiz${quizTitle ? ` "${quizTitle}"` : ''} is ${otp}. It is valid for 10 minutes. If you did not request this code, please ignore this email.`;
  const html = buildOtpHtml(otp, 'guest-quiz', quizTitle);

  await deliverEmail(email, subject, html, text, 'GUEST QUIZ OTP');
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
};
