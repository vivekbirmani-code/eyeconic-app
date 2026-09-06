// Public-quiz participants for admin analytics. Guests NEVER enter student
// rankings/leaderboards — these rows are a separate, unranked participant
// list surfaced alongside (never inside) the registered-student performance
// data. Only ever included in responses when the caller is an admin
// (enforced by the routes, not here — this module just builds rows).
const GuestAttempt = require('../models/GuestAttempt');
const Guest = require('../models/Guest');
const { maskPhone } = require('./phone');

const DONE_STATUSES = ['completed', 'auto_submitted'];

// Count of lead-attempted (non-anonymous) guest attempts for a quiz.
const countGuestAttempts = (quizId) =>
  GuestAttempt.countDocuments({
    quiz: quizId,
    status: { $in: DONE_STATUSES },
    guest: { $ne: null },
  });

const roundTo2 = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

/**
 * Unranked participant rows for a quiz's public guests.
 * Each row is self-contained from the attempt's lead snapshots, with the
 * live lead looked up for consent/verified status (leads only exist after
 * OTP verification, so the verified contact is true by construction — but
 * it is resolved from the lead so a missing/deleted lead degrades visibly).
 * Legacy leads (pre email-OTP switch) carry a verified phone and no email;
 * `email` is null for them and `emailVerified` false — consumers must
 * render that gracefully.
 *
 * { fullPhone: true } additionally includes the raw E.164 `phone` field —
 * reserved for the admin CSV export, which is the raw-lead follow-up
 * channel. All list/analytics surfaces use the masked form only.
 */
const fetchGuestParticipants = async (quizId, { fullPhone = false } = {}) => {
  const attempts = await GuestAttempt.find({
    quiz: quizId,
    status: { $in: DONE_STATUSES },
    guest: { $ne: null },
  })
    .select('guest guestName guestEmail guestPhone score marksObtained totalMarks answers sectionPerformance status endTime startTime tabSwitchCount')
    .sort({ endTime: -1 })
    .lean();

  if (attempts.length === 0) {
    return [];
  }

  const leadIds = [...new Set(attempts.map((a) => String(a.guest)))];
  const leads = await Guest.find({ _id: { $in: leadIds } })
    .select('name email emailVerifiedAt phone phoneVerifiedAt marketingConsent')
    .lean();
  const leadById = new Map(leads.map((l) => [String(l._id), l]));

  return attempts.map((attempt) => {
    const lead = leadById.get(String(attempt.guest));
    const totalMarks = attempt.totalMarks || 0;
    const scorePercentage = totalMarks > 0
      ? Math.round((attempt.marksObtained / totalMarks) * 100)
      : 0;
    const correct = attempt.score || 0;
    const totalQuestions = attempt.answers?.length || 0;
    const attemptedCount = (attempt.answers || []).filter(
      (a) => a && a.selectedAnswer !== -1 && a.selectedAnswer !== null && a.selectedAnswer !== undefined
    ).length;
    const incorrect = Math.max(0, attemptedCount - correct);
    const skipped = Math.max(0, totalQuestions - attemptedCount);
    const timeTakenSeconds = attempt.startTime && attempt.endTime
      ? Math.max(0, Math.floor((new Date(attempt.endTime) - new Date(attempt.startTime)) / 1000))
      : 0;

    const attemptedCountFinal = correct + incorrect;
    return {
      attemptId: attempt._id,
      guestId: attempt.guest,
      name: attempt.guestName || lead?.name || 'Guest',
      // The verified email from the OTP flow (snapshot first, live lead as
      // fallback). Null for legacy pre-email leads — render as "—".
      email: attempt.guestEmail || lead?.email || null,
      // Admin-only analytics surfaces always get the MASKED phone; the full
      // number is reserved for the admin attempt-detail view and CSV export.
      phoneMasked: maskPhone(attempt.guestPhone || lead?.phone || ''),
      ...(fullPhone ? { phone: attempt.guestPhone || lead?.phone || '' } : {}),
      score: correct,
      totalQuestions,
      marksObtained: roundTo2(attempt.marksObtained),
      totalMarks,
      scorePercentage,
      correct,
      incorrect,
      skipped,
      attempted: attemptedCountFinal,
      accuracy: attemptedCountFinal > 0 ? Math.round((correct / attemptedCountFinal) * 100) : 0,
      timeTakenSeconds,
      tabSwitchCount: attempt.tabSwitchCount || 0,
      status: attempt.status,
      startedAt: attempt.startTime,
      submittedAt: attempt.endTime,
      sectionPerformance: attempt.sectionPerformance || [],
      emailVerified: Boolean(lead?.emailVerifiedAt),
      phoneVerified: Boolean(lead?.phoneVerifiedAt),
      marketingConsent: lead?.marketingConsent?.granted === true,
    };
  });
};

module.exports = {
  fetchGuestParticipants,
  countGuestAttempts,
};
