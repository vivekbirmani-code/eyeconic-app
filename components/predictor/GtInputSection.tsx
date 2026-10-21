import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Zap, User, Trash2, Plus, Info, Sparkles } from 'lucide-react-native';
import { colors } from '@/utils/theme';
import type { GtInputApi } from '@/hooks/useGtInput';
import { LOW_GT_NOTE, NO_SKIP_NOTE } from '@/utils/predictor/constants';
import shared from './shared';

/**
 * The Grand Test input card — native port of the website's GtInputSection
 * (dynamic rows, auto-fill with provenance, suggestion chips, live per-row
 * validation). Behavior is byte-identical to the forward/desired website
 * forms; only the styling is the app's (Analytics teal system).
 */

interface Props {
  gt: GtInputApi;
  title: string;
  subtitle: string;
}

export default function GtInputSection({ gt, title, subtitle }: Props) {
  const { rows, suggestions, autoFilling, hasAutoGts, lowGtCount, validation, maxCorrects } = gt;

  return (
    <View style={shared.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={shared.cardTitle}>{title}</Text>
          <Text style={[shared.cardSubtitle, { marginTop: 3 }]}>{subtitle}</Text>
        </View>
      </View>

      {autoFilling ? (
        <View style={[styles.row, { marginBottom: 12, marginTop: 2 }]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.autoFillText}>Checking your Eyeconic Grand Tests…</Text>
        </View>
      ) : null}

      <View style={{ gap: 10, marginTop: 14 }}>
        {rows.map((row, index) => {
          const error = validation.errors[index] ?? null;
          // Live feedback: a row that HAS content shows its error as you
          // type; untouched empty rows only flag after a submit attempt.
          const highlighted = gt.isHighlighted(index);
          const isAuto = row.origin === 'auto' && !row.edited;
          return (
            <View key={row.key}>
              <View
                style={[
                  styles.gtRow,
                  highlighted ? styles.gtRowError : undefined,
                ]}
              >
                <View style={[styles.provenancePill, isAuto ? styles.provenanceAuto : styles.provenanceManual]}>
                  {isAuto ? <Zap size={10} color={colors.primary} /> : <User size={10} color={colors.textSecondary} />}
                  <Text style={[styles.provenanceText, { color: isAuto ? colors.primary : colors.textSecondary }]}>
                    {isAuto ? 'Auto-captured' : 'Self-reported'}
                  </Text>
                </View>
                <TextInput
                  style={styles.gtInput}
                  keyboardType="number-pad"
                  value={row.value}
                  onChangeText={(value) => gt.updateRow(row.key, value)}
                  placeholder={`e.g. ${Math.round(maxCorrects * 0.6)}`}
                  placeholderTextColor={colors.textMuted}
                  maxLength={3}
                  accessibilityLabel={`Grand Test ${index + 1} correct answers`}
                />
                <View style={styles.gtMeta}>
                  {row.title ? <Text style={styles.gtMetaStrong} numberOfLines={1}>{row.title}</Text> : null}
                  {row.dateLabel ? <Text style={styles.gtMetaText} numberOfLines={1}> · {row.dateLabel}</Text> : null}
                  {row.attemptsNote ? <Text style={styles.gtMetaText} numberOfLines={1}> · {row.attemptsNote}</Text> : null}
                  {row.origin === 'auto' && row.edited ? (
                    <Text style={styles.gtMetaEdited} numberOfLines={1}> · edited → self-reported</Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  onPress={() => gt.removeRow(row.key)}
                  disabled={rows.length === 1}
                  style={styles.trashButton}
                  accessibilityLabel="Remove this Grand Test"
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                >
                  <Trash2 size={16} color={rows.length === 1 ? colors.borderStrong : colors.textSecondary} />
                </TouchableOpacity>
              </View>
              {highlighted && error ? (
                <Text style={styles.rowErrorText}>{error}</Text>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={styles.addRowRow}>
        <TouchableOpacity style={styles.addButton} onPress={() => gt.addRow()} activeOpacity={0.7}>
          <Plus size={14} color={colors.primaryDark} />
          <Text style={styles.addButtonText}>Add another GT</Text>
        </TouchableOpacity>
        {suggestions.map((value, i) => (
          <TouchableOpacity
            key={`sug-${i}`}
            style={styles.suggestionChip}
            onPress={() => gt.addRow(value)}
            activeOpacity={0.7}
            accessibilityLabel={`Add ${value} corrects from your last prediction`}
          >
            <Text style={styles.suggestionText}>+ {value} corrects (last time)</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* assumption note — ALWAYS visible with the input (§3.4/§13) */}
      <View style={styles.assumptionBox}>
        <Info size={14} color={colors.primary} />
        <Text style={styles.assumptionText}>{NO_SKIP_NOTE}</Text>
      </View>

      {lowGtCount ? (
        <View style={styles.lowGtBox}>
          <Sparkles size={14} color={colors.warning} />
          <Text style={styles.lowGtText}>{LOW_GT_NOTE}</Text>
        </View>
      ) : null}

      {hasAutoGts && !autoFilling ? (
        <Text style={styles.autoExplainer}>
          Filled from your Eyeconic Grand Tests — the latest completed attempt per test. Tap any
          score to edit it.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  autoFillText: {
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  gtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
    minHeight: 48,
  },
  gtRowError: {
    borderColor: colors.dangerDark,
    backgroundColor: '#FEF2F2',
  },
  provenancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 99,
    borderWidth: 1,
    paddingVertical: 2,
    paddingHorizontal: 7,
    backgroundColor: colors.bg,
    borderColor: colors.border,
  },
  provenanceAuto: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primaryTintBorder,
  },
  provenanceManual: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
  },
  provenanceText: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  gtInput: {
    width: 64,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    paddingVertical: 2,
  },
  gtMeta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  gtMetaStrong: {
    fontSize: 11.5,
    color: colors.textBody,
    fontWeight: '600',
  },
  gtMetaText: {
    fontSize: 11.5,
    color: colors.textSecondary,
  },
  gtMetaEdited: {
    fontSize: 11.5,
    color: colors.warning,
  },
  trashButton: {
    padding: 4,
  },
  rowErrorText: {
    fontSize: 12,
    color: colors.dangerDark,
    marginTop: 4,
    marginLeft: 6,
  },
  addRowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primaryTintBorder,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.primaryTint,
  },
  addButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  suggestionChip: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  suggestionText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  assumptionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 11,
    marginTop: 14,
  },
  assumptionText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  lowGtBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 10,
    padding: 11,
    marginTop: 10,
  },
  lowGtText: {
    flex: 1,
    fontSize: 12,
    color: '#92400E',
    lineHeight: 16,
  },
  autoExplainer: {
    fontSize: 11.5,
    color: colors.textSecondary,
    marginTop: 10,
  },
});
