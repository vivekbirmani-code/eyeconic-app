const express = require('express');
const Guest = require('../models/Guest');
const { generateOtp, OTP_TTL_MS, isValidEmail, normalizeEmail } = require('../utils/otpHelpers');
const { normalizeIndianPhone } = require('../utils/phone');
const { issueGuestOtp, verifyGuestOtp } = require('../utils/guestOtp');
const { sendGuestQuizOtpMail, EmailDeliveryError } = require('../utils/mailer');
const { findActivePublicQuiz, sendPublicQuizError } = require('../utils/publicQuizAccess');
const { signGuestToken } = require('../middleware/guestAuth');
const {
  guestOtpSendRateLimit,
  guestOtpVerifyRateLimit,
  recordGuestVerifyFailure,
  clearGuestVerifyAttempts,
} = require('../middleware/guestOtpRateLimit');

const router = express.Router();

const RESEND_COOLDOWN_SECONDS = 60;
const EMAIL_MAX_LENGTH = 254;

const isValidName = (name) =>
  typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 100;

const parseLeadEmail = (input) => {
  if (typeof input !== 'string' || input.trim().length > EMAIL_MAX_LENGTH || !isValidEmail(input)) {
    return { error: true };
  }
  return { email: normalizeEmail(input) };
};

const isValidOtp = (otp) => typeof otp === 'string' && /^\d{6}$/.test(otp.trim());

// Lead fields are validated identically on send and verify — nothing is
// persisted at send time, so verify re-receives and re-validates everything.
const parseLeadPayload = (body) => {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const emailResult = parseLeadEmail(body?.email);
  const phoneResult = normalizeIndianPhone(body?.phone);
  const marketingConsent = body?.marketingConsent === true;
  const source = body?.source === 'mobile' ? 'mobile' : 'web';

  if (!isValidName(name)) {
    return { error: { statusCode: 400, code: 'VALIDATION_ERROR', message: 'Please enter your full name (2-100 characters).' } };
  }
  if (emailResult.error) {
    return { error: { statusCode: 400, code: 'EMAIL_INVALID', message: 'Please enter a valid email address.' } };
  }
  if (phoneResult.error) {
    return { error: { statusCode: 400, code: 'PHONE_INVALID', message: 'Please enter a valid 10-digit Indian mobile number.' } };
  }

  return { name, email: emailResult.email, phone: phoneResult.phone, marketingConsent, source };
};

/**
 * POST /api/public/quiz/:shareToken/lead/send-otp
 * Step 1 of the guest lead flow — sends an OTP for the (email, link)
 * challenge. Quiz eligibility is validated BEFORE any email goes out. Only
 * the OTP hash row is persisted; the lead itself is created at verify time.
 */
router.post('/quiz/:shareToken/lead/send-otp', guestOtpSendRateLimit, async (req, res) => {
  try {
    const { shareToken } = req.params;

    const payload = parseLeadPayload(req.body);
    if (payload.error) {
      return sendPublicQuizError(res, payload.error);
    }
    const { email, phone } = payload;
    void phone; // collected contact info, recorded at verify time

    const access = await findActivePublicQuiz(shareToken, '_id title publicExpiryDate');
    if (access.error) {
      return sendPublicQuizError(res, access.error);
    }

    const otp = generateOtp();
    try {
      await sendGuestQuizOtpMail(email, otp, access.quiz.title);
    } catch (error) {
      if (error instanceof EmailDeliveryError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
          requestId: req.requestId,
        });
      }
      throw error;
    }

    await issueGuestOtp(email, shareToken, otp);

    return res.json({
      success: true,
      message: 'Verification code sent to your email.',
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
    });
  } catch (error) {
    console.error('Error sending guest lead OTP:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/public/quiz/:shareToken/lead/verify-otp
 * Step 2 — verifies the code against the SAME (email, link) challenge it
 * was issued for, then upserts the lead keyed by phone and issues a guest
 * session token. Failed verifications never create a lead.
 */
router.post('/quiz/:shareToken/lead/verify-otp', guestOtpVerifyRateLimit, async (req, res) => {
  try {
    const { shareToken } = req.params;

    const payload = parseLeadPayload(req.body);
    if (payload.error) {
      return sendPublicQuizError(res, payload.error);
    }
    const { name, email, phone, marketingConsent, source } = payload;

    if (!isValidOtp(req.body?.otp)) {
      return sendPublicQuizError(res, {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Please enter the 6-digit verification code.',
      });
    }

    const access = await findActivePublicQuiz(shareToken, '_id title publicExpiryDate');
    if (access.error) {
      return sendPublicQuizError(res, access.error);
    }
    const quiz = access.quiz;

    const verification = await verifyGuestOtp(email, shareToken, String(req.body.otp).trim());
    if (!verification.ok) {
      recordGuestVerifyFailure(email);
      return sendPublicQuizError(res, {
        statusCode: 400,
        code: verification.reason,
        message:
          verification.reason === 'OTP_EXPIRED'
            ? 'This verification code has expired. Please request a new one.'
            : 'Invalid verification code.',
      });
    }
    clearGuestVerifyAttempts(email);

    // Upsert the lead keyed by the verified contact's phone — the same
    // person on a new quiz resolves to the same document, with the latest
    // verified email recorded on it.
    const leadUpdate = {
      $set: {
        name,
        email,
        emailVerifiedAt: new Date(),
        lastActiveAt: new Date(),
        'marketingConsent.granted': marketingConsent,
        'marketingConsent.updatedAt': new Date(),
      },
      $setOnInsert: { source, firstQuiz: quiz._id },
      $addToSet: { quizzesTaken: quiz._id },
    };

    let guest;
    try {
      guest = await Guest.findOneAndUpdate({ phone }, leadUpdate, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      });
    } catch (upsertError) {
      // Two concurrent first-time verifies can race the unique phone index.
      if (upsertError?.code === 11000 || upsertError?.message?.includes('duplicate key')) {
        guest = await Guest.findOneAndUpdate({ phone }, leadUpdate, { new: true });
      } else {
        throw upsertError;
      }
    }

    if (!guest) {
      return res.status(500).json({ success: false, message: 'Server error' });
    }

    const guestToken = signGuestToken(guest._id);

    return res.json({
      success: true,
      message: 'Email verified.',
      guestToken,
      guest: {
        _id: guest._id,
        name: guest.name,
        email: guest.email,
        phone: guest.phone,
        marketingConsent: guest.marketingConsent?.granted === true,
      },
    });
  } catch (error) {
    console.error('Error verifying guest lead OTP:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
