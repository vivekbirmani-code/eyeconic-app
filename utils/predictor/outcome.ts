/**
 * Pure outcome-capture helpers — ported from the eyeconic-main website
 * client (client/src/pages/predictor/OutcomeCard.tsx) so the app's card
 * validates exactly what the website's does, client-side, before the
 * server's own consent/range checks run (§15, §18 Phases 10a+10b).
 */

export const OUTCOME_CONSENT_NOTE =
  'I agree to share this result with Eyeconic to help calibrate the predictor. This is voluntary — I can edit or withdraw it anytime.';
export const OUTCOME_CONSENT_REASK = 'Consent is re-confirmed on every save, including edits.';

export const outcomeIntroNote = (exam: string): string =>
  exam === 'INI_CET'
    ? 'Your INI-CET result is out? Pairing your actual percentile or rank with this prediction helps make future ranges more accurate for everyone.'
    : 'Your NEET PG result is out? Pairing your actual score, percentile or rank with this prediction helps make future ranges more accurate for everyone.';

export const COUNSELLING_TEXT_MAX = 120;
export const COUNSELLING_ROUND_MAX = 40;

export interface OutcomeFieldErrors {
  score?: string;
  percentile?: string;
  rank?: string;
  counsellingStatus?: string;
  allottedInstitute?: string;
  allottedBranch?: string;
  round?: string;
}

/**
 * Live field validation, website-identical: empty fields are simply not
 * shared (at least ONE value is required at submit, checked separately);
 * filled fields must be whole-number score ≤ maxScore, percentile 0–100,
 * rank ≥ 1, and counselling text within its caps.
 */
export function outcomeFieldErrors(
  score: string,
  percentile: string,
  rank: string,
  counsellingStatus: string,
  allottedInstitute: string,
  allottedBranch: string,
  round: string,
  maxScore: number
): OutcomeFieldErrors {
  const errors: OutcomeFieldErrors = {};
  if (score !== '') {
    const n = Number(score);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > maxScore) {
      errors.score = `Whole number between 0 and ${maxScore}`;
    }
  }
  if (percentile !== '') {
    const n = Number(percentile);
    if (!Number.isFinite(n) || n < 0 || n > 100) errors.percentile = 'Between 0 and 100';
  }
  if (rank !== '') {
    const n = Number(rank);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) errors.rank = 'Whole number, 1 or more';
  }
  const hasAllotment = allottedInstitute !== '' || allottedBranch !== '' || round !== '';
  if (!counsellingStatus && hasAllotment) {
    errors.counsellingStatus = 'Pick allotted or not allotted first';
  }
  if (counsellingStatus === 'ALLOTTED') {
    if (allottedInstitute !== '' && allottedInstitute.trim().length > COUNSELLING_TEXT_MAX) {
      errors.allottedInstitute = `Up to ${COUNSELLING_TEXT_MAX} characters`;
    }
    if (allottedBranch !== '' && allottedBranch.trim().length > COUNSELLING_TEXT_MAX) {
      errors.allottedBranch = `Up to ${COUNSELLING_TEXT_MAX} characters`;
    }
    if (round !== '' && round.trim().length > COUNSELLING_ROUND_MAX) {
      errors.round = `Up to ${COUNSELLING_ROUND_MAX} characters`;
    }
  }
  return errors;
}
