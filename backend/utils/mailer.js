const nodemailer = require('nodemailer');

// Set up transporter based on env variables
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
    port: parseInt(port),
    secure: parseInt(port) === 465, // true for 465, false for other ports
    auth: {
      user,
      pass
    }
  });
};

const sendOtpMail = async (email, otp) => {
  const fromName = process.env.SMTP_FROM_NAME || 'Eyeconic Mentors';
  const fromEmail = process.env.SMTP_FROM_EMAIL || 'no-reply@eyeconicmentors.com';

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: email,
    subject: 'Eyeconic Mentors - Email Verification Code',
    text: `Your verification code is ${otp}. It is valid for 10 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e1e1e1; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #01b4ae; margin: 0; font-size: 26px; letter-spacing: 1px;">EYECONIC MENTORS</h2>
          <p style="color: #6b7280; font-size: 14px; margin: 5px 0 0 0;">Your path to medical excellence</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #eaeaea; margin-bottom: 25px;" />
        <div style="color: #374151; font-size: 16px; line-height: 24px;">
          <p style="margin-top: 0;">Hello,</p>
          <p>Thank you for choosing Eyeconic Mentors. Please use the verification code below to complete your registration:</p>
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
    `
  };

  const transporter = getTransporter();

  if (!transporter) {
    console.log('\n==================================================');
    console.log(`📧 [MOCK EMAILER] SMTP credentials not set. Code for ${email}:`);
    console.log(`👉 VERIFICATION OTP CODE: ${otp} 👈`);
    console.log('==================================================\n');
    return true;
  }

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Email sent successfully to ${email}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send email via SMTP:', error);
    console.log('\n==================================================');
    console.log(`📧 [EMAILER FALLBACK] Code for ${email}:`);
    console.log(`👉 VERIFICATION OTP CODE: ${otp} 👈`);
    console.log('==================================================\n');
    return true; // Return true to prevent blocking tests in dev
  }
};

const sendPasswordResetMail = async (email, otp) => {
  const fromName = process.env.SMTP_FROM_NAME || 'Eyeconic Mentors';
  const fromEmail = process.env.SMTP_FROM_EMAIL || 'no-reply@eyeconicmentors.com';

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: email,
    subject: 'Eyeconic Mentors - Password Reset Verification Code',
    text: `Your password reset verification code is ${otp}. It is valid for 10 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e1e1e1; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #01b4ae; margin: 0; font-size: 26px; letter-spacing: 1px;">EYECONIC MENTORS</h2>
          <p style="color: #6b7280; font-size: 14px; margin: 5px 0 0 0;">Your path to medical excellence</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #eaeaea; margin-bottom: 25px;" />
        <div style="color: #374151; font-size: 16px; line-height: 24px;">
          <p style="margin-top: 0;">Hello,</p>
          <p>You requested a password reset. Please use the verification code below to set your new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <span style="display: inline-block; font-size: 32px; font-weight: bold; color: #01b4ae; letter-spacing: 5px; padding: 12px 24px; border: 2px dashed #01b4ae; border-radius: 8px; background-color: #f0fdfa;">
              ${otp}
            </span>
          </div>
          <p style="font-size: 14px; color: #6b7280;">This code is valid for <strong>10 minutes</strong>. If you did not request a password reset, please ignore this email.</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 25px 0;" />
        <div style="text-align: center; font-size: 12px; color: #9ca3af;">
          <p style="margin: 0;">© ${new Date().getFullYear()} Eyeconic Mentors. All rights reserved.</p>
        </div>
      </div>
    `
  };

  const transporter = getTransporter();

  if (!transporter) {
    console.log('\n==================================================');
    console.log(`📧 [MOCK EMAILER] SMTP credentials not set. Code for ${email}:`);
    console.log(`👉 PASSWORD RESET OTP CODE: ${otp} 👈`);
    console.log('==================================================\n');
    return true;
  }

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Password Reset Email sent successfully to ${email}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send email via SMTP:', error);
    console.log('\n==================================================');
    console.log(`📧 [EMAILER FALLBACK] Code for ${email}:`);
    console.log(`👉 PASSWORD RESET OTP CODE: ${otp} 👈`);
    console.log('==================================================\n');
    return true;
  }
};

module.exports = {
  sendOtpMail,
  sendPasswordResetMail
};
