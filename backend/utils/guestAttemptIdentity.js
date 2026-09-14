const GuestAttempt = require('../models/GuestAttempt');

// One-attempt-per-person enforcement for PUBLIC quizzes.
//
// Identity model: a guest is recognised by their verified contact keys —
//   • the lead ref (`guest`) — the Guest document, deduped by its unique
//     E.164 phone, so "same phone" already means "same lead" app-wide;
//   • the OTP-verified email (matched case/whitespace-insensitively so
//     "John@Gmail.com " cannot dodge "john@gmail.com");
//   • the normalized E.164 phone.
// Matching ANY one of them means the same person for restriction purposes:
// the same student re-entering their details (even with a new phone number
// or a tweaked name) is still caught by the email, and a lead that merely
// changed its email is still caught by the phone / lead ref.
//
// The NAME is deliberately NOT a standalone match key: distinct students
// commonly share a name, so name-only matching would block legitimate
// first attempts (false positives). Wherever a name participates in a
// comparison it must be trimmed + case/collapse-whitespace normalized —
// a name difference never overrides a contact-key match.
//
// Legacy anonymous attempts (no lead ref, no name/email/phone snapshot)
// contribute no clauses and therefore never match — the device-keyed
// mobile flow keeps working exactly as before.

const FINALIZED_STATUSES = ['completed', 'auto_submitted'];

const ALREADY_ATTEMPTED_MESSAGE =
  'You have already attempted this quiz. Each public quiz can be attempted only once.';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Exact, case-insensitive matcher for stored snapshot fields. Historical
// rows may hold mixed-case emails or stray surrounding whitespace (the
// field predates strict normalization), so equality is regex-anchored with
// optional padding instead of exact. The query always carries the
// { quiz, status } prefix filter, so only that quiz's finalized attempts
// are ever scanned — no collection-wide regex.
const caseInsensitiveExact = (value) => new RegExp(`^\\s*${escapeRegex(value)}\\s*$`, 'i');

const identityFromLead = (lead) => ({
  guestId: lead ? lead._id : null,
  email: typeof lead?.email === 'string' ? lead.email.trim() : null,
  phone: typeof lead?.phone === 'string' ? lead.phone.trim() : null,
});

const identityFromAttempt = (attempt) => ({
  guestId: attempt?.guest || null,
  email: typeof attempt?.guestEmail === 'string' ? attempt.guestEmail.trim() : null,
  phone: typeof attempt?.guestPhone === 'string' ? attempt.guestPhone.trim() : null,
});

const buildIdentityClauses = (identity) => {
  const clauses = [];
  if (identity.guestId) clauses.push({ guest: identity.guestId });
  if (identity.email) clauses.push({ guestEmail: caseInsensitiveExact(identity.email) });
  if (identity.phone) clauses.push({ guestPhone: identity.phone });
  return clauses;
};

/**
 * Finds the most recent FINALIZED attempt of this quiz by the same person,
 * or null. `excludeAttemptId` keeps the guard from matching the attempt
 * currently being submitted (the submit-time defense).
 */
const findCompletedAttemptByIdentity = async (quizId, identity, excludeAttemptId = null) => {
  const clauses = buildIdentityClauses(identity);
  if (!clauses.length) return null;

  return GuestAttempt.findOne({
    quiz: quizId,
    status: { $in: FINALIZED_STATUSES },
    ...(excludeAttemptId ? { _id: { $ne: excludeAttemptId } } : {}),
    $or: clauses,
  }).sort({ endTime: -1, updatedAt: -1, _id: -1 });
};

/**
 * Shared 409 payload for every route that enforces the restriction. The
 * `attemptId` of the existing attempt is exposed ONLY when it belongs to
 * the requesting lead — the result route is lead-scoped, so a cross-lead
 * match (e.g. same email under a second phone) must not hand out an ID
 * the caller cannot view; those callers get the plain message instead.
 */
const buildAlreadyAttemptedPayload = (duplicate, requestingLead) => {
  const sameLead = !!(
    requestingLead &&
    duplicate.guest &&
    String(duplicate.guest) === String(requestingLead._id)
  );
  return {
    code: 'QUIZ_ALREADY_ATTEMPTED',
    message: ALREADY_ATTEMPTED_MESSAGE,
    ...(sameLead ? { attemptId: duplicate._id } : {}),
  };
};

module.exports = {
  ALREADY_ATTEMPTED_MESSAGE,
  FINALIZED_STATUSES,
  identityFromLead,
  identityFromAttempt,
  findCompletedAttemptByIdentity,
  buildAlreadyAttemptedPayload,
};
