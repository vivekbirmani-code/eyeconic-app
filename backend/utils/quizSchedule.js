// Shared quiz-scheduling helpers — the ONE implementation every quiz
// authoring path (quizzes.create-from-bank, quizzes.import-excel,
// quizzes.PUT /:id, mini-gt.generate) and every student-facing payload
// (quizzes list/detail) runs through, so no workflow can drift.

// A datetime string without a UTC offset ("2026-10-22T10:00") is ambiguous —
// JS parses it in the SERVER's local zone, so the same payload means different
// instants in dev (IST) and production (UTC). Every first-party client sends
// toISOString() (Z-suffixed); anything else is pinned to UTC here so the
// stored instant is deterministic regardless of the server's timezone.
const OFFSET_LESS_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const parseInstant = (value) =>
  new Date(typeof value === 'string' && OFFSET_LESS_ISO.test(value) ? `${value}Z` : value);

// The EARLIER of two optional window ends (either may be missing/invalid).
// Used for public links, whose participation cutoff is the first of the
// link's own expiry and the quiz's internal end (strict window semantics,
// owner decision 2026-11-15).
const earliestEnd = (a, b) => {
  const ends = [a, b]
    .filter(Boolean)
    .map((raw) => new Date(raw))
    .filter((end) => !Number.isNaN(end.getTime()));
  if (ends.length === 0) return null;
  return ends.reduce((earliest, current) => (current.getTime() < earliest.getTime() ? current : earliest));
};

// Availability state for student/guest-facing payloads — the SAME window rule
// /start enforces (start <= now < end), so a badge can never disagree with
// the gate. Window-less quizzes are 'open' (always startable, like /start).
//
// publicMode (guest/public links): the effective end is the EARLIER of the
// link's own expiry (publicExpiryDate) and the quiz's internal expiryDate —
// guests obey the quiz's Start/End exactly like registered students.
const computeScheduleState = (quiz, now = new Date(), { publicMode = false } = {}) => {
  if (quiz.scheduledDate && now < quiz.scheduledDate) return 'scheduled';
  const end = publicMode ? earliestEnd(quiz.expiryDate, quiz.publicExpiryDate) : quiz.expiryDate;
  if (end && now >= end) return 'ended';
  return 'open';
};

// Validates + normalizes the optional quiz time window. Accepts ISO strings
// (what the apps send) and rejects unparseable values with a clear message
// instead of letting them become Invalid Dates that crash save() with a 500.
// Enforces the shared business rule: when both ends are set, end > start.
//
// TR-STATE for update callers: an EXPLICIT null/'' marks the date as CLEARED
// (returned in `cleared`) so PUT /:id can remove a previously stored window
// end — "make this quiz open-ended / immediately available again". A key the
// client simply omitted (undefined) is absent: neither set nor cleared, the
// stored value is preserved. Create paths are unaffected: a cleared date
// simply never reaches the document (value.scheduledDate stays undefined —
// the same outcome as before this distinction existed).
const parseQuizTimeWindow = ({ scheduledDate, expiryDate }) => {
  const value = {};
  const cleared = {};
  if (scheduledDate === null || scheduledDate === '') {
    cleared.scheduledDate = true;
  } else if (scheduledDate !== undefined) {
    const start = parseInstant(scheduledDate);
    if (isNaN(start.getTime())) {
      return { error: 'Start date & time is invalid — please re-select it and try again.' };
    }
    value.scheduledDate = start;
  }
  if (expiryDate === null || expiryDate === '') {
    cleared.expiryDate = true;
  } else if (expiryDate !== undefined) {
    const end = parseInstant(expiryDate);
    if (isNaN(end.getTime())) {
      return { error: 'End date & time is invalid — please re-select it and try again.' };
    }
    value.expiryDate = end;
  }
  if (value.scheduledDate && value.expiryDate && value.expiryDate <= value.scheduledDate) {
    return { error: 'End date must be after start date' };
  }
  return { value, cleared };
};

// Applies a PUT payload's window fields to a quiz document under the
// tri-state contract above (absent → keep; explicit null/'' → clear; value →
// set) and validates the EFFECTIVE final state (end > start when both set),
// so a new expiry cannot land before the quiz's existing scheduled start.
// Mutates `quiz` in place; returns { error } on validation failure.
const applyQuizTimeWindowUpdate = (quiz, { scheduledDate, expiryDate }) => {
  const result = parseQuizTimeWindow({ scheduledDate, expiryDate });
  if (result.error) return { error: result.error };

  const effectiveStart = result.value.scheduledDate !== undefined
    ? result.value.scheduledDate
    : (result.cleared.scheduledDate ? null : quiz.scheduledDate);
  const effectiveEnd = result.value.expiryDate !== undefined
    ? result.value.expiryDate
    : (result.cleared.expiryDate ? null : quiz.expiryDate);
  if (effectiveStart && effectiveEnd && effectiveEnd <= effectiveStart) {
    return { error: 'End date must be after start date' };
  }

  if (result.value.scheduledDate !== undefined) quiz.scheduledDate = result.value.scheduledDate;
  else if (result.cleared.scheduledDate) quiz.scheduledDate = undefined;
  if (result.value.expiryDate !== undefined) quiz.expiryDate = result.value.expiryDate;
  else if (result.cleared.expiryDate) quiz.expiryDate = undefined;
  return {};
};

module.exports = {
  OFFSET_LESS_ISO,
  parseInstant,
  computeScheduleState,
  parseQuizTimeWindow,
  applyQuizTimeWindowUpdate,
};
