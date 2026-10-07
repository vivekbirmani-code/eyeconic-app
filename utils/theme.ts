/**
 * Shared color tokens for the app's current visual system.
 *
 * The palette is extracted from the Analytics module — the design reference
 * for the app's teal + neutral language. Screens migrated to this system
 * (Analytics, quiz-hub, question-bank, Past Tests, Import Quiz) render these
 * same values; importing from here keeps future screens consistent instead
 * of growing another set of hardcoded hex literals.
 *
 * Semantic colors (success / danger / warning / purple) stay semantic —
 * never force them into teal.
 */
export const colors = {
  // Primary (teal) — module headers, active tabs/chips, primary buttons, accents
  primary: '#01b4ae',
  /** Accent text on pale-teal surfaces (titles, bold keys, stat values). */
  primaryDark: '#0D9488',
  /** Body text on pale-teal surfaces (hints, callout copy). */
  primaryText: '#0F766E',
  /** Pale teal surface — highlights, tinted chips, info boxes. */
  primaryTint: '#E0FBF9',
  /** Subtle border for pale-teal surfaces. */
  primaryTintBorder: '#CCFBF1',

  // Neutrals — surfaces, borders, text hierarchy
  bg: '#F3F4F6',
  surface: '#FFFFFF',
  surfaceMuted: '#F9FAFB',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  text: '#1F2937',
  textBody: '#374151',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',

  // Semantic
  success: '#10B981',
  successDark: '#059669',
  successTint: '#D1FAE5',
  danger: '#EF4444',
  dangerDark: '#DC2626',
  dangerTint: '#FEE2E2',
  warning: '#F59E0B',
  warningDark: '#D97706',
  warningTint: '#FEF3C7',
  purple: '#9333EA',
  purpleTint: '#F3E8FF',
};

/**
 * Test-type badge tints — the pill treatment used by Analytics' test list
 * (TestDropdown). Text stays neutral (#374151) on each tint.
 */
export const testTypeTints = {
  daily: 'rgba(1, 180, 174, 0.1)',
  weekly: 'rgba(16, 185, 129, 0.1)',
  grand: 'rgba(139, 92, 246, 0.1)',
} as const;
