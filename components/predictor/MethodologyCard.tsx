import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '@/utils/theme';
import { ChevronDown, Layers, Info } from 'lucide-react-native';
import type { PredictionResult } from '@/types/predictor';
import { EXAM_LABELS, isBranchSummary } from '@/utils/predictor/constants';
import {
  dedupedMethodologyNotes,
  methodologyAssumptions,
} from '@/utils/predictor/summary';
import { yearFilterLabel } from '@/utils/predictor/format';

/**
 * One collapsible "How this estimate works" home for the methodology —
 * native port of the website's MethodologySection. The spec-mandated bits
 * (disclaimer, coverage) stay visible outside this section; engine notes
 * gather here once, de-duplicated, in plain language. Internal vocabulary
 * (tier ids, snapshot ids) never renders.
 */
export default function MethodologyCard({ result }: { result: PredictionResult }) {
  const [open, setOpen] = useState(false);
  const isIniCet = result.exam === 'INI_CET';
  const { rank } = result;

  const branchSummary = isBranchSummary(result.branches) ? result.branches : null;
  const counsellingYears = branchSummary
    ? branchSummary.dataCoverage.years.map(yearFilterLabel).join(' · ')
    : null;

  const notes = dedupedMethodologyNotes(result);
  const assumptions = methodologyAssumptions(result);

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.headerButton}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
        accessibilityLabel="How this estimate works"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.headerRow}>
          <Layers size={15} color={colors.primary} />
          <Text style={styles.headerText}>How this estimate works</Text>
        </View>
        <ChevronDown
          size={16}
          color={colors.textSecondary}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>

      {open ? (
        <View style={styles.body}>
          {assumptions.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>ASSUMPTIONS</Text>
              {assumptions.map((text) => (
                <View key={text} style={styles.bulletRow}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.sectionText}>{text}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>DATA THIS RAN AGAINST</Text>
              <View style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.sectionText}>
                  Rank mapping: official {isIniCet ? 'AIIMS' : 'NBEMS'}{' '}
                  {isIniCet && rank.session ? rank.session.replace('-', ' ') : rank.examYear}{' '}
                  result data.
                </Text>
            </View>
            <View style={styles.bulletRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.sectionText}>
                {counsellingYears
                  ? `Branch matching: ${isIniCet ? 'AIIMS' : 'MCC'} counselling, final-state closing ranks (${counsellingYears}).`
                  : 'Branch matching: not run — no category was selected.'}
              </Text>
            </View>
            <View style={styles.bulletRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.sectionText}>
                Aggregation: mean of your Grand Test scores, one value per test (latest completed
                attempt).
              </Text>
            </View>
          </View>

          {notes.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>NOTES &amp; LIMITATIONS</Text>
              {notes.map((note) => (
                <View key={note} style={styles.bulletRow}>
                  <Info size={12} color={colors.primary} />
                  <Text style={styles.sectionText}>{note}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.footerText}>
            {EXAM_LABELS[result.exam] ?? result.exam} · every prediction is saved to your history
            so its accuracy can be measured once real outcomes are shared.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  headerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    gap: 10,
    minHeight: 52,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textBody,
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 14,
  },
  section: {
    gap: 7,
  },
  sectionLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  bullet: {
    fontSize: 12,
    color: colors.primary,
    lineHeight: 16,
  },
  sectionText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  footerText: {
    fontSize: 11,
    color: colors.textMuted,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    lineHeight: 15,
  },
});
