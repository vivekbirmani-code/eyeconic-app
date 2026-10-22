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

// Availability state for student-facing payloads — the SAME window rule
// /start enforces (start <= now < end), so a badge can never disagree with
// the gate. Window-less quizzes are 'open' (always startable, like /start).
const computeScheduleState = (quiz, now = new Date()) => {
  if (quiz.scheduledDate && now < quiz.scheduledDate) return 'scheduled';
  if (quiz.expiryDate && now >= quiz.expiryDate) return 'ended';
  return 'open';
};

// Validates + normalizes the optional quiz time window. Accepts ISO strings
// (what the apps send) and rejects unparseable values with a clear message
// instead of letting them become Invalid Dates that crash save() with a 500.
// Enforces the shared business rule: when both ends are set, end > start.
const parseQuizTimeWindow = ({ scheduledDate, expiryDate }) => {
  const value = {};
  if (scheduledDate !== undefined && scheduledDate !== null && scheduledDate !== '') {
    const start = parseInstant(scheduledDate);
    if (isNaN(start.getTime())) {
      return { error: 'Start date & time is invalid — please re-select it and try again.' };
    }
    value.scheduledDate = start;
  }
  if (expiryDate !== undefined && expiryDate !== null && expiryDate !== '') {
    const end = parseInstant(expiryDate);
    if (isNaN(end.getTime())) {
      return { error: 'End date & time is invalid — please re-select it and try again.' };
    }
    value.expiryDate = end;
  }
  if (value.scheduledDate && value.expiryDate && value.expiryDate <= value.scheduledDate) {
    return { error: 'End date must be after start date' };
  }
  return { value };
};

module.exports = {
  OFFSET_LESS_ISO,
  parseInstant,
  computeScheduleState,
  parseQuizTimeWindow,
};
