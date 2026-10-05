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
import type { GtInputApi } from '@/hooks/useGtInput';
import { LOW_GT_NOTE, NO_SKIP_NOTE } from '@/utils/predictor/constants';

/**
 * The Grand Test input card — native port of the website's GtInputSection
 * (dynamic rows, auto-fill with provenance, suggestion chips, live per-row
 * validation). Behavior is byte-identical to the forward/desired website
 * forms; only the styling is the app's.
 */

interface Props {
  gt: GtInputApi;
  title: string;
  subtitle: string;
}

export default function GtInputSection({ gt, title, subtitle }: Props) {
  const { rows, suggestions, autoFilling, hasAutoGts, lowGtCount, validation, maxCorrects } = gt;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>

      {autoFilling ? (
        <View style={[styles.row, { marginBottom: 12 }]}>
          <ActivityIndicator size="small" color="#2563EB" />
          <Text style={styles.autoFillText}>Checking your Eyeconic Grand Tests…</Text>
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
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
                  {isAuto ? <Zap size={10} color="#01b4ae" /> : <User size={10} color="#6B7280" />}
                  <Text style={[styles.provenanceText, { color: isAuto ? '#01b4ae' : '#6B7280' }]}>
                    {isAuto ? 'Auto-captured' : 'Self-reported'}
                  </Text>
                </View>
                <TextInput
                  style={styles.gtInput}
                  keyboardType="number-pad"
                  value={row.value}
                  onChangeText={(value) => gt.updateRow(row.key, value)}
                  placeholder={`e.g. ${Math.round(maxCorrects * 0.6)}`}
                  placeholderTextColor="#9CA3AF"
                  maxLength={3}
                  accessibilityLabel={`Grand Test ${index + 1} correct answers`}
                />
                <View style={styles.gtMeta}>
                  {row.title ? <Text style={styles.gtMetaStrong} numberOfLines={1}>{row.title}</Text> : null}
                  {row.dateLabel ? <Text style={styles.gtMetaText}> · {row.dateLabel}</Text> : null}
                  {row.attemptsNote ? <Text style={styles.gtMetaText}> · {row.attemptsNote}</Text> : null}
                  {row.origin === 'auto' && row.edited ? (
                    <Text style={styles.gtMetaEdited}> · edited → self-reported</Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  onPress={() => gt.removeRow(row.key)}
                  disabled={rows.length === 1}
                  style={styles.trashButton}
                  accessibilityLabel="Remove this Grand Test"
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                >
                  <Trash2 size={16} color={rows.length === 1 ? '#D1D5DB' : '#6B7280'} />
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
        <TouchableOpacity style={styles.addbutton} onPress={() => gt.addRow()} activeOpacity={0.7}>
          <Plus size={14} color="#2563EB" />
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
        <Info size={14} color="#01b4ae" />
        <Text style={styles.assumptionText}>{NO_SKIP_NOTE}</Text>
      </View>

      {lowGtCount ? (
        <View style={styles.lowGtBox}>
          <Sparkles size={14} color="#F59E0B" />
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
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 12.5,
    color: '#6B7280',
    marginTop: 3,
    lineHeight: 17,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  autoFillText: {
    fontSize: 12.5,
    color: '#6B7280',
  },
  gtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },
  gtRowError: {
    borderColor: '#DC2626',
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
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
  },
  provenanceAuto: {
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    borderColor: 'rgba(1, 180, 174, 0.35)',
  },
  provenanceManual: {
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
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
    color: '#111827',
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
    color: '#374151',
    fontWeight: '600',
  },
  gtMetaText: {
    fontSize: 11.5,
    color: '#6B7280',
  },
  gtMetaEdited: {
    fontSize: 11.5,
    color: '#F59E0B',
  },
  trashButton: {
    padding: 4,
  },
  rowErrorText: {
    fontSize: 12,
    color: '#DC2626',
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
  addbutton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2563EB',
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(37, 99, 235, 0.05)',
  },
  addButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB',
  },
  suggestionChip: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 7,
    paddingHorizontal: 11,
    backgroundColor: '#FFFFFF',
  },
  suggestionText: {
    fontSize: 12,
    color: '#6B7280',
  },
  assumptionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 11,
    marginTop: 14,
  },
  assumptionText: {
    flex: 1,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  lowGtBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 12,
    padding: 11,
    marginTop: 10,
  },
  lowGtText: {
    flex: 1,
    fontSize: 12,
    color: '#92600A',
    lineHeight: 16,
  },
  autoExplainer: {
    fontSize: 11.5,
    color: '#6B7280',
    marginTop: 10,
  },
});
