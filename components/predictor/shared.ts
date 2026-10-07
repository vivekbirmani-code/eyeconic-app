import { StyleSheet } from 'react-native';
import { colors } from '@/utils/theme';

/**
 * Shared Analytics-system styles for the Rank Predictor module.
 *
 * The predictor is part of the teal Analytics design language (utils/theme.ts
 * is the token source; Analytics' screens are the reference). These atoms are
 * the pieces every predictor surface needs — card, title, chips, primary
 * button, error box — so the module keeps one treatment instead of per-file
 * copies drifting apart again (the blue era this file replaces).
 */

const shared = StyleSheet.create({
  /** Analytics card: white surface, r12, p16, hairline border. */
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  cardSubtitle: {
    fontSize: 12.5,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  /** Small uppercase section label inside a card (mirrors Analytics KPI labels). */
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  /** Teal primary action — the Analytics download-button treatment. */
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
    elevation: 0,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  /** Selectable chip (category / status / filter) — teal when active. */
  chip: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textBody,
  },
  chipTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },

  /** Form-level error box (danger tint, per the semantic-color rule). */
  formErrorBox: {
    backgroundColor: colors.dangerTint,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.25)',
    borderRadius: 12,
    padding: 12,
  },
  formErrorText: {
    fontSize: 13,
    color: colors.dangerDark,
    textAlign: 'center',
    lineHeight: 17,
  },

  /** Quiet one-line footnote (disclaimers under a CTA). */
  footnote: {
    fontSize: 11.5,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 15,
  },
});

export default shared;
