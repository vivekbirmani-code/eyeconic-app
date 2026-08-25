const nodemailer = require('nodemailer');
const logger = require('./logger');

const SMTP_TIMEOUT_MS = 15000;
const RESEND_TIMEOUT_MS = 15000;

class EmailDeliveryError extends Error {
  constructor(message, code = 'EMAIL_DELIVERY_FAILED') {
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
  const fromEmail =
    process.env.SMTP_FROM_EMAIL ||
    process.env.RESEND_FROM_EMAIL ||
    (isResendConfigured() ? 'onboarding@resend.dev' : 'no-reply@eyeconicmentors.com');

  return {
    fromName,
    fromEmail,
    from: `${fromName} <${fromEmail}>`,
  };
};

const getEmailStatus = () => {
  if (isResendConfigured()) {
    return { status: 'configured', provider: 'resend', configured: true };
  }
  if (isSmtpConfigured()) {
    return { status: 'configured', provider: 'smtp', configured: true };
  }
  if (!isProduction()) {
    return { status: 'mock', provider: 'console', configured: false };
  }
  return { status: 'unconfigured', provider: null, configured: false };
};

const buildOtpHtml = (otp, purpose) => {
  const heading =
    purpose === 'reset'
      ? 'You requested a password reset. Please use the verification code below to set your new password:'
      : 'Thank you for choosing Eyeconic Mentors. Please use the verification code below to complete your registration:';

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e1e1e1; border-radius: 12px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #01b4ae; margin: 0; font-size: 26px; letter-spacing: 1px;">EYECONIC MENTORS</h2>
        <p style="color: #6b7280; font-size: 14px; margin: 5px 0 0 0;">Your path to medical excellence</p>
      </div>
      <hr style="border: 0; border-top: 1px solid #eaeaea; margin-bottom: 25px;" />
      <div style="color: #374151; font-size: 16px; line-height: 24px;">
        <p style="margin-top: 0;">Hello,</p>
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

const sendViaResend = async (email, subject, html, text) => {
  const { from } = getFromAddress();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);

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
      throw new Error(`Resend API error ${response.status}: ${body}`);
    }

    logger.info('Verification email sent via Resend', { to: email, subject });
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Resend API timed out' : error.message;
    logger.error('Resend email delivery failed', { to: email, errorMessage: message });
    throw new EmailDeliveryError(
      'Unable to send verification email right now. Please try again in a few moments.',
      'EMAIL_DELIVERY_FAILED'
    );
  } finally {
    clearTimeout(timeout);
  }
};

const sendViaSmtp = async (mailOptions) => {
  const transporter = getTransporter();
  if (!transporter) {
    throw new EmailDeliveryError(
      'Email service is not configured on the server.',
      'EMAIL_NOT_CONFIGURED'
    );
  }

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Verification email sent via SMTP', { to: mailOptions.to, subject: mailOptions.subject });
  } catch (error) {
    logger.error('SMTP email delivery failed', {
      to: mailOptions.to,
      errorMessage: error.message,
    });
    throw new EmailDeliveryError(
      'Unable to send verification email right now. Please try again in a few moments.',
      'EMAIL_DELIVERY_FAILED'
    );
  }
};

const logDevOtp = (email, otp, label) => {
  console.log('\n==================================================');
  console.log(`📧 [DEV EMAILER] ${label} for ${email}:`);
  console.log(`👉 OTP CODE: ${otp} 👈`);
  console.log('==================================================\n');
};

const deliverEmail = async (email, subject, html, text, devLabel) => {
  if (isResendConfigured()) {
    await sendViaResend(email, subject, html, text);
    return;
  }

  if (isSmtpConfigured()) {
    const { fromName, fromEmail } = getFromAddress();
    await sendViaSmtp({
      from: `"${fromName}" <${fromEmail}>`,
      to: email,
      subject,
      text,
      html,
    });
    return;
  }

  if (!isProduction()) {
    logDevOtp(email, text.match(/\d{6}/)?.[0] || 'unknown', devLabel);
    return;
  }

  throw new EmailDeliveryError(
    'Email verification is temporarily unavailable. Please contact support.',
    'EMAIL_NOT_CONFIGURED'
  );
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

module.exports = {
  EmailDeliveryError,
  sendOtpMail,
  sendPasswordResetMail,
  isEmailConfigured,
  getEmailStatus,
};
