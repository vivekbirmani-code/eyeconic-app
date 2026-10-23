/**
 * Shared payload for the admin "Enable AI Proctoring" toggle on the Create
 * Quiz / Edit Quiz screens (Phase 9 §D, docs/ai-proctoring-phase-9-rollout-plan.md;
 * warn modes per the owner's global rollout order, 2026-10-21).
 *
 * The ON payload is deliberately COMPLETE: a bare `{ enabled: true }` would
 * inherit the backend's focusEvents/attention defaults instead of pinning
 * them here. Since the global rollout it arms Warning Mode everywhere the
 * toggle is used — focusEvents warn-only (app-away banner, never auto-submit)
 * + attention 'warn' (head-turn banner on the 3rd look-away) — while
 * multipleFaces/facePresence stay silent record. Camera is REQUIRED since
 * the public-quiz proctoring decision (owner, 2026-10-23): a proctored quiz
 * that cannot use its camera is not proctored — precheck hard-fails camera
 * checks and blocks start. The quizzes armed before this decision keep their
 * stored 'optional' config until re-armed. Keep in sync with WARN_PAYLOAD in
 * scripts/prod-proctoring-ops.js;
 * the backend re-validates (parseProctoringConfig) and stays authoritative.
 */
export const PROCTORING_ON_PAYLOAD = Object.freeze({
  enabled: true,
  camera: 'required',
  focusEvents: { mode: 'warn-only' },
  multipleFaces: { mode: 'record' },
  facePresence: { mode: 'record' },
  attention: { mode: 'warn' },
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
