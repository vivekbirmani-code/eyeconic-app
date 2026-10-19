// Public-quiz participants for admin analytics. Guests NEVER enter student
// rankings/leaderboards — these rows are a separate, unranked participant
// list surfaced alongside (never inside) the registered-student performance
// data. Only ever included in responses when the caller is an admin
// (enforced by the routes, not here — this module just builds rows).
const GuestAttempt = require('../models/GuestAttempt');
const Guest = require('../models/Guest');
const { maskPhone } = require('./phone');
const { computeAttemptStats, computeScorePercentage } = require('./analytics');

const DONE_STATUSES = ['completed', 'auto_submitted'];

// Count of lead-attempted (non-anonymous) guest attempts for a quiz.
const countGuestAttempts = (quizId) =>
  GuestAttempt.countDocuments({
    quiz: quizId,
    status: { $in: DONE_STATUSES },
    guest: { $ne: null },
  });

// Lean guest-attempt documents for the shared test-analytics aggregates
// (computeTestAnalytics). Same cohort rule as fetchGuestParticipants —
// completed/auto_submitted lead attempts only; legacy anonymous device-keyed
// attempts stay out. The projection carries exactly the fields the analytics
// helpers read on a QuizAttempt (graded answers, marks, timing) plus the
// lead-ref and identity snapshots the test report's User Responses sheet
// joins on (inert for the analytics consumers).
const fetchGuestAttemptDocs = (quizId) =>
  GuestAttempt.find({
    quiz: quizId,
    status: { $in: DONE_STATUSES },
    guest: { $ne: null },
  })
    .select(
      'answers totalQuestions score marksObtained totalMarks startTime endTime status sectionPerformance guest guestName guestEmail guestPhone'
    )
    .lean();

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
 * used by admin-only surfaces (the CSV export and the admin analytics
 * responses) that follow up on raw leads. `phoneMasked` is still included
 * on every row for consumers that prefer the masked form.
 */
const fetchGuestParticipants = async (quizId, { fullPhone = false } = {}) => {
  const attempts = await GuestAttempt.find({
    quiz: quizId,
    status: { $in: DONE_STATUSES },
    guest: { $ne: null },
  })
    .select('guest guestName guestEmail guestPhone score marksObtained totalMarks totalQuestions answers sectionPerformance status endTime startTime tabSwitchCount')
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
    // C/W/S comes from the SAME shared classification the test-level
    // aggregates use (type-aware isAnswered + the stored server-side
    // isCorrect), so a participant row always sums to the numbers the KPIs
    // were computed from — and non-MCQ types (numerical 0, empty multi-select)
    // classify correctly instead of falling through MCQ-only semantics.
    const stats = computeAttemptStats(attempt);
    const totalMarks = attempt.totalMarks || 0;
    const timeTakenSeconds = attempt.startTime && attempt.endTime
      ? Math.max(0, Math.floor((new Date(attempt.endTime) - new Date(attempt.startTime)) / 1000))
      : 0;

    return {
      attemptId: attempt._id,
      guestId: attempt.guest,
      name: attempt.guestName || lead?.name || 'Guest',
      // The verified email from the OTP flow (snapshot first, live lead as
      // fallback). Null for legacy pre-email leads — render as "—".
      email: attempt.guestEmail || lead?.email || null,
      // Masked phone stays on every row; the raw E.164 number rides along
      // only for admin-only callers that pass fullPhone (CSV export +
      // admin analytics responses).
      phoneMasked: maskPhone(attempt.guestPhone || lead?.phone || ''),
      ...(fullPhone ? { phone: attempt.guestPhone || lead?.phone || '' } : {}),
      score: attempt.score || stats.correct,
      totalQuestions: stats.totalQuestions,
      marksObtained: roundTo2(attempt.marksObtained),
      totalMarks,
      scorePercentage: computeScorePercentage(attempt.marksObtained, totalMarks) ?? 0,
      correct: stats.correct,
      incorrect: stats.incorrect,
      skipped: stats.skipped,
      attempted: stats.attempted,
      accuracy: stats.accuracy,
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
  fetchGuestAttemptDocs,
  countGuestAttempts,
};
