/**
 * Shared payload for the admin "Enable AI Proctoring" toggle on the Create
 * Quiz / Edit Quiz screens (Phase 9 §D, docs/ai-proctoring-phase-9-rollout-plan.md).
 *
 * The ON payload is deliberately COMPLETE: a bare `{ enabled: true }` would
 * inherit the schema's focusEvents default 'warn-then-submit' — a quiz that
 * can WARN and AUTO-SUBMIT. Every policy here is silent record-mode and the
 * camera is optional (Stage-2 shadow authoring), so an admin flipping the
 * toggle can never arm consequences by accident. The backend re-validates
 * (parseProctoringConfig) and stays authoritative regardless.
 */
export const PROCTORING_ON_PAYLOAD = Object.freeze({
  enabled: true,
  camera: 'optional',
  focusEvents: { mode: 'record' },
  multipleFaces: { mode: 'record' },
  facePresence: { mode: 'record' },
});

/** Explicit OFF for edits (create with OFF omits the field entirely). */
export const PROCTORING_DISABLED_PAYLOAD = Object.freeze({ enabled: false });

/** Server-computed live state (admin GET /quizzes/:id → proctoringEligibility). */
export interface ProctoringEligibility {
  enabled: boolean;
  blockers: string[];
}

/** Admin-facing copy for the "requested but temporarily unavailable" hint. */
export const proctoringBlockerCopy: Record<string, string> = {
  global_kill_switch_off: 'the emergency switch is off',
  feature_flag_off: 'the proctoring feature flag is off',
  quiz_config_disabled: 'proctoring is off for this quiz',
};

/**
 * Renders the hint line shown under the toggle when ON but not currently
 * effective (Phase 9 fix: two distinct truths, never mixed).
 *
 * - `quiz_config_disabled` present = the STORED opt-in is still off (the
 *   local toggle is on but not saved). While the quiz opt-in is off the
 *   server's eligibility resolver deliberately cannot see the real kill
 *   switch (it short-circuits the AppSettings read for every non-proctored
 *   quiz) — so this branch must NEVER claim kill-switch state. Only the
 *   feature-flag blocker is real data here.
 * - Otherwise the blockers are the live global gates — name them.
 */
export const proctoringUnavailableHint = (eligibility: ProctoringEligibility): string => {
  if (eligibility.blockers.includes('quiz_config_disabled')) {
    return eligibility.blockers.includes('feature_flag_off')
      ? 'Monitoring will be requested for this quiz when you save it. Note: the proctoring feature flag is currently off, so it will stay unavailable until the backend flag is enabled.'
      : 'Monitoring will be requested for this quiz when you save it. It runs only while the global proctoring switches allow it.';
  }
  return `Requested for this quiz, but monitoring is temporarily unavailable: ${eligibility.blockers
    .map((b) => proctoringBlockerCopy[b] ?? b)
    .join('; ')}. The quiz runs without monitoring until that changes.`;
};
