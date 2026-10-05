import {
  COUNSELLING_ROUND_MAX,
  COUNSELLING_TEXT_MAX,
  outcomeFieldErrors,
  outcomeIntroNote,
} from '../outcome';

/**
 * Phase 6 (outcome capture) — the client-side validation must match the
 * website's OutcomeCard rule for rule: empty fields are simply unshared,
 * filled fields are range-checked, counselling text is capped, and an
 * allotment without a status is the one structural error.
 */

describe('outcomeFieldErrors', () => {
  it('accepts all-empty fields (nothing shared is a valid intermediate state)', () => {
    expect(outcomeFieldErrors('', '', '', '', '', '', '', 720)).toEqual({});
  });

  it('accepts in-range values', () => {
    expect(outcomeFieldErrors('480', '90.5', '42000', 'ALLOTTED', 'AIIMS Delhi', 'Radiodiagnosis', 'R2', 720)).toEqual({});
    expect(outcomeFieldErrors('118', '', '', 'NOT_ALLOTTED', '', '', '', 200)).toEqual({});
  });

  it('bounds the score to whole numbers within the exam pattern max', () => {
    expect(outcomeFieldErrors('480.5', '', '', '', '', '', '', 720).score).toBe(
      'Whole number between 0 and 720'
    );
    expect(outcomeFieldErrors('-1', '', '', '', '', '', '', 720).score).toBe(
      'Whole number between 0 and 720'
    );
    expect(outcomeFieldErrors('721', '', '', '', '', '', '', 720).score).toBe(
      'Whole number between 0 and 720'
    );
    // INI-CET's own maximum (200), not NEET PG's 720
    expect(outcomeFieldErrors('201', '', '', '', '', '', '', 200).score).toBe(
      'Whole number between 0 and 200'
    );
  });

  it('bounds the percentile to 0–100 (decimals allowed)', () => {
    expect(outcomeFieldErrors('', '81.2', '', '', '', '', '', 720)).toEqual({});
    expect(outcomeFieldErrors('', '100.01', '', '', '', '', '', 720).percentile).toBe('Between 0 and 100');
    expect(outcomeFieldErrors('', '-1', '', '', '', '', '', 720).percentile).toBe('Between 0 and 100');
  });

  it('requires the rank to be a whole number ≥ 1', () => {
    expect(outcomeFieldErrors('', '', '42000', '', '', '', '', 720)).toEqual({});
    expect(outcomeFieldErrors('', '', '0', '', '', '', '', 720).rank).toBe('Whole number, 1 or more');
    expect(outcomeFieldErrors('', '', '4200.5', '', '', '', '', 720).rank).toBe(
      'Whole number, 1 or more'
    );
  });

  it('demands a counselling status when allotment details were typed', () => {
    expect(
      outcomeFieldErrors('', '', '', '', 'AIIMS Delhi', '', '', 720).counsellingStatus
    ).toBe('Pick allotted or not allotted first');
    // NOT_ALLOTTED never validates the text fields — they are not shared
    expect(outcomeFieldErrors('', '', '', 'NOT_ALLOTTED', 'x'.repeat(200), '', '', 720)).toEqual({});
  });

  it('caps the counselling text fields only when ALLOTTED', () => {
    const long = 'x'.repeat(COUNSELLING_TEXT_MAX + 1);
    const errors = outcomeFieldErrors('', '', '', 'ALLOTTED', long, long, 'y'.repeat(COUNSELLING_ROUND_MAX + 1), 720);
    expect(errors.allottedInstitute).toBe(`Up to ${COUNSELLING_TEXT_MAX} characters`);
    expect(errors.allottedBranch).toBe(`Up to ${COUNSELLING_TEXT_MAX} characters`);
    expect(errors.round).toBe(`Up to ${COUNSELLING_ROUND_MAX} characters`);
    // at the cap itself: fine
    expect(
      outcomeFieldErrors('', '', '', 'ALLOTTED', 'x'.repeat(COUNSELLING_TEXT_MAX), '', 'y'.repeat(COUNSELLING_ROUND_MAX), 720)
    ).toEqual({});
  });
});

describe('outcomeIntroNote', () => {
  it('names the exam-specific values each exam actually publishes', () => {
    expect(outcomeIntroNote('NEET_PG')).toContain('actual score, percentile or rank');
    expect(outcomeIntroNote('INI_CET')).toContain('actual percentile or rank');
    expect(outcomeIntroNote('INI_CET')).not.toContain('score,');
  });
});
