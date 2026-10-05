import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Share, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ArrowLeft, Award, Copy, Check, Info, AlertTriangle, Sparkles, Zap, User } from 'lucide-react-native';
import type { PredictionResult } from '@/types/predictor';
import RangeCards from './RangeCards';
import MethodologyCard from './MethodologyCard';
import BranchResults from './BranchResults';
import { DISCLAIMER_NOTE, WARNING_SHORT, isBranchSummary } from '@/utils/predictor/constants';
import { buildShareText, type NonCategoryBranchSummary } from '@/utils/predictor/summary';

/**
 * The prediction result experience — native port of the website's ResultView.
 * Order follows the site: ranges → disclaimer → warnings → what went in →
 * methodology → branches (or the category invite). Branch browsing fetches
 * its own data via the stored predictionId, so this view renders fresh
 * predictions AND stored history records identically.
 */

interface Props {
  result: PredictionResult;
  predictionId?: string;
  onBack: () => void;
  backLabel?: string;
  /** History records: hash mismatch banner (Phase 6 reuses this view). */
  integrityWarning?: boolean;
  /** History records are stored snapshots — "predict again with a category" advice doesn't apply. */
  readonly?: boolean;
}

export default function PredictResult({
  result,
  predictionId,
  onBack,
  backLabel = 'Edit GTs & predict again',
  integrityWarning = false,
  readonly = false,
}: Props) {
  const { estimate, aggregation } = result;
  const [copied, setCopied] = useState(false);

  const skippedWarning = estimate.warnings.find((w) => w.code === 'NO_SKIP_ASSUMPTION_WEAKENED');
  const inlineWarnings = estimate.warnings.filter(
    (w) => w.code !== 'NO_SKIP_ASSUMPTION_WEAKENED' && w.code !== 'LOW_GT_COUNT'
  );

  const branchSummary: NonCategoryBranchSummary | null = isBranchSummary(result.branches)
    ? result.branches
    : null;

  const share = async () => {
    const text = buildShareText(result);
    setCopied(false);
    try {
      await Share.share({ title: 'My predicted rank range', message: text });
      return;
    } catch {
      // Share sheet unavailable/dismissed with an error — fall through to copy.
    }
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard denied — silent by design (same as the website).
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.topButton} onPress={onBack} activeOpacity={0.7}>
          <ArrowLeft size={14} color="#374151" />
          <Text style={styles.topButtonText}>{backLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.topButton} onPress={share} activeOpacity={0.7}>
          {copied ? (
            <>
              <Check size={14} color="#01b4ae" />
              <Text style={styles.topButtonText}>Copied</Text>
            </>
          ) : (
            <>
              <Copy size={14} color="#374151" />
              <Text style={styles.topButtonText}>Share result</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.heading}>Your predicted range</Text>

      <RangeCards result={result} />

      {/* §14: the disclaimer, visible with the results — exactly once */}
      <View style={styles.disclaimerRow}>
        <Info size={13} color="#01b4ae" />
        <Text style={styles.disclaimerText}>{DISCLAIMER_NOTE}</Text>
      </View>

      {integrityWarning ? (
        <View style={styles.warningBox}>
          <AlertTriangle size={14} color="#F59E0B" />
          <Text style={styles.warningTextAmber}>
            This stored prediction failed its integrity check — the numbers below are what was
            served, but the record has changed since. Please treat it with caution.
          </Text>
        </View>
      ) : null}

      {skippedWarning ? (
        <View style={styles.warningBox}>
          <AlertTriangle size={14} color="#F59E0B" />
          <Text style={styles.warningTextAmber}>{skippedWarning.note}</Text>
        </View>
      ) : null}

      {/* short, in-context cautions (full text lives in Methodology) */}
      {inlineWarnings.map((w) => (
        <View key={w.code} style={styles.inlineWarningBox}>
          <Sparkles size={13} color="#01b4ae" />
          <Text style={styles.inlineWarningText}>{WARNING_SHORT[w.code] ?? w.note}</Text>
        </View>
      ))}

      {/* §13 aggregation summary: the individual GTs, provenance-tagged */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>What went in</Text>
        <View style={styles.gtChips}>
          {result.input.gts.map((gt, i) => {
            const isAuto = gt.provenance === 'auto-captured';
            return (
              <View
                key={i}
                style={[styles.gtChip, isAuto ? styles.gtChipAuto : styles.gtChipManual]}
              >
                {isAuto ? <Zap size={11} color="#01b4ae" /> : <User size={11} color="#6B7280" />}
                <Text style={[styles.gtChipText, { color: isAuto ? '#0d7a76' : '#374151' }]}>
                  GT {i + 1}: <Text style={styles.gtChipStrong}>{gt.selected?.corrects ?? '—'}</Text>{' '}
                  corrects
                  {gt.excluded.length ? (
                    <Text style={styles.gtChipMuted}> ({gt.excluded.length} older skipped)</Text>
                  ) : null}
                </Text>
              </View>
            );
          })}
        </View>
        <Text style={styles.averageText}>
          Average used: <Text style={styles.averageStrong}>{aggregation.mean}</Text> corrects
          across {aggregation.n} Grand Test{aggregation.n === 1 ? '' : 's'}.
        </Text>
      </View>

      <MethodologyCard result={result} />

      {branchSummary ? (
        predictionId ? (
          <BranchResults predictionId={predictionId} summary={branchSummary} result={result} />
        ) : (
          <View style={styles.card}>
            <Text style={styles.unavailableText}>
              Branch results for this stored prediction are not available.
            </Text>
          </View>
        )
      ) : (
        <View style={styles.card}>
          <Award size={22} color="#01b4ae" style={styles.inviteIcon} />
          <Text style={styles.inviteTitle}>Want possible branches too?</Text>
          {readonly ? (
            <Text style={styles.inviteBody}>
              This prediction was made without a category, so it covers rank only — exactly as it
              was served.
            </Text>
          ) : (
            <>
              <Text style={styles.inviteBody}>
                Category is needed to match counselling cutoffs — it is never assumed. Tap
                “{backLabel}” above, pick your category, and run the prediction once more.
              </Text>
              <TouchableOpacity style={styles.inviteButton} onPress={onBack} activeOpacity={0.7}>
                <ArrowLeft size={14} color="#374151" />
                <Text style={styles.topButtonText}>Back to inputs</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  topButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  topButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 12,
    padding: 12,
  },
  warningTextAmber: {
    flex: 1,
    fontSize: 12,
    color: '#92600A',
    lineHeight: 16,
  },
  inlineWarningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
  },
  inlineWarningText: {
    flex: 1,
    fontSize: 12,
    color: '#374151',
    lineHeight: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 18,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  gtChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  gtChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 99,
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  gtChipAuto: {
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    borderColor: 'rgba(1, 180, 174, 0.35)',
  },
  gtChipManual: {
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
  },
  gtChipText: {
    fontSize: 12,
  },
  gtChipStrong: {
    fontWeight: '700',
  },
  gtChipMuted: {
    color: '#6B7280',
  },
  averageText: {
    fontSize: 12,
    color: '#6B7280',
  },
  averageStrong: {
    fontWeight: '700',
    color: '#374151',
  },
  unavailableText: {
    fontSize: 13.5,
    color: '#6B7280',
    textAlign: 'center',
  },
  inviteIcon: {
    alignSelf: 'center',
    marginBottom: 10,
  },
  inviteTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 6,
  },
  inviteBody: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
});
