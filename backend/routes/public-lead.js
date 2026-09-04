const express = require('express');
const Guest = require('../models/Guest');
const { generateOtp, OTP_TTL_MS } = require('../utils/otpHelpers');
const { normalizeIndianPhone } = require('../utils/phone');
const { issueGuestOtp, verifyGuestOtp } = require('../utils/guestOtp');
const { sendGuestOtpSms, SmsDeliveryError } = require('../utils/sms');
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

const isValidName = (name) =>
  typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 100;

const isValidOtp = (otp) => typeof otp === 'string' && /^\d{6}$/.test(otp.trim());

// Lead fields are validated identically on send and verify — nothing is
// persisted at send time, so verify re-receives and re-validates everything.
const parseLeadPayload = (body) => {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const phoneResult = normalizeIndianPhone(body?.phone);
  const marketingConsent = body?.marketingConsent === true;
  const source = body?.source === 'mobile' ? 'mobile' : 'web';

  if (!isValidName(name)) {
    return { error: { statusCode: 400, code: 'VALIDATION_ERROR', message: 'Please enter your full name (2-100 characters).' } };
  }
  if (phoneResult.error) {
    return { error: { statusCode: 400, code: 'PHONE_INVALID', message: 'Please enter a valid 10-digit Indian mobile number.' } };
  }

  return { name, phone: phoneResult.phone, marketingConsent, source };
};

/**
 * POST /api/public/quiz/:shareToken/lead/send-otp
 * Step 1 of the guest lead flow — sends an OTP for the (phone, link)
 * challenge. Quiz eligibility is validated BEFORE any SMS goes out. Only
 * the OTP hash row is persisted; the lead itself is created at verify time.
 */
router.post('/quiz/:shareToken/lead/send-otp', guestOtpSendRateLimit, async (req, res) => {
  try {
    const { shareToken } = req.params;

    const payload = parseLeadPayload(req.body);
    if (payload.error) {
      return sendPublicQuizError(res, payload.error);
    }
    const { name, phone } = payload;
    void name; // validated now, recorded at verify time

    const access = await findActivePublicQuiz(shareToken, '_id title publicExpiryDate');
    if (access.error) {
      return sendPublicQuizError(res, access.error);
    }

    const otp = generateOtp();
    try {
      await sendGuestOtpSms(phone, otp);
    } catch (error) {
      if (error instanceof SmsDeliveryError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
          requestId: req.requestId,
        });
      }
      throw error;
    }

    await issueGuestOtp(phone, shareToken, otp);

    return res.json({
      success: true,
      message: 'Verification code sent to your phone.',
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
 * Step 2 — verifies the code against the SAME (phone, link) challenge it
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
    const { name, phone, marketingConsent, source } = payload;

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

    const verification = await verifyGuestOtp(phone, shareToken, String(req.body.otp).trim());
    if (!verification.ok) {
      recordGuestVerifyFailure(phone);
      return sendPublicQuizError(res, {
        statusCode: 400,
        code: verification.reason,
        message:
          verification.reason === 'OTP_EXPIRED'
            ? 'This verification code has expired. Please request a new one.'
            : 'Invalid verification code.',
      });
    }
    clearGuestVerifyAttempts(phone);

    // Upsert the lead keyed by the verified phone — the same person on a
    // new quiz resolves to the same document.
    const leadUpdate = {
      $set: {
        name,
        phoneVerifiedAt: new Date(),
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
      message: 'Phone verified.',
      guestToken,
      guest: {
        _id: guest._id,
        name: guest.name,
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
