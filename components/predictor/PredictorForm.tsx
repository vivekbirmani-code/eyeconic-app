import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Switch, StyleSheet } from 'react-native';
import { colors } from '@/utils/theme';
import type { PredictResponse, PredictorExam, PredictorExamId } from '@/types/predictor';
import {
  predictorEndpoints,
  predictorErrorMessage,
  errorRowIndices,
  type PredictRequestBody,
} from '@/services/predictor';
import { useGtInput } from '@/hooks/useGtInput';
import GtInputSection from '@/components/predictor/GtInputSection';
import shared from '@/components/predictor/shared';
import { CATEGORIES, DISCLAIMER_NOTE, EXAM_LABELS, maxCorrectsFor } from '@/utils/predictor/constants';
import * as Haptics from '@/utils/haptics';

/**
 * The forward predictor form — extracted from the predictor screen when the
 * Desired Branch mode (Phase 5) made the screen a two-mode orchestrator.
 * Behavior is unchanged: exam → REQUIRED Grand Tests → optional category/PwD
 * (never defaulted, §3.6) → POST /predict. The screen owns the exam list and
 * renders it above this form for both modes.
 *
 * Workflow reads top-to-bottom: Grand Tests → category → the single primary
 * action. One disclaimer line, at the bottom, once.
 */

const CATEGORY_LABELS: Record<string, string> = {
  UR: 'UR (General)',
  EWS: 'EWS',
  OBC: 'OBC',
  SC: 'SC',
  ST: 'ST',
};

interface Props {
  exams: PredictorExam[];
  selectedExam: PredictorExamId;
  onPredicted: (response: PredictResponse) => void;
}

export default function PredictorForm({ exams, selectedExam, onPredicted }: Props) {
  const [category, setCategory] = useState('');
  const [pwd, setPwd] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const gt = useGtInput({ maxCorrects: maxCorrectsFor(exams, selectedExam) });

  const handlePredict = async () => {
    if (predicting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFormError(null);
    if (!gt.markInvalidRows()) {
      setFormError('Fix the highlighted Grand Test scores first.');
      return;
    }
    setPredicting(true);
    try {
      const body: PredictRequestBody = {
        exam: selectedExam,
        gts: gt.buildGtsPayload(),
        ...(category ? { category, pwd } : {}),
      };
      const response = await predictorEndpoints.predict(body);
      onPredicted(response);
    } catch (err) {
      const rows = errorRowIndices(err);
      if (rows.size > 0) {
        gt.markRowErrors(rows);
        setFormError(predictorErrorMessage(err, 'Fix the highlighted Grand Test scores first.'));
      } else {
        setFormError(
          predictorErrorMessage(err, 'Could not run the prediction. Please try again in a moment.')
        );
      }
    } finally {
      setPredicting(false);
    }
  };

  const isIniCet = selectedExam === 'INI_CET';

  return (
    <>
      <GtInputSection
        gt={gt}
        title="Your Grand Test scores"
        subtitle={`Correct answers in full-length ${EXAM_LABELS[selectedExam] ?? selectedExam} Grand Tests — one row per test.`}
      />

      {/* Category & quota (§3.6): optional for the rank, REQUIRED for
          branches, never defaulted. PwD appears only with a category. */}
      <View style={shared.card}>
        <View style={styles.categoryHeader}>
          <Text style={shared.cardTitle}>Category</Text>
          <Text style={styles.categoryOptional}>optional</Text>
        </View>
        <View style={styles.categoryRow}>
          {CATEGORIES.map((c) => {
            const active = category === c;
            return (
              <TouchableOpacity
                key={c}
                style={[shared.chip, active ? shared.chipActive : null]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setCategory((prev) => (prev === c ? '' : c));
                }}
                activeOpacity={0.7}
                accessibilityLabel={CATEGORY_LABELS[c]}
                accessibilityState={{ selected: active }}
              >
                <Text style={[shared.chipText, active ? shared.chipTextActive : null]}>
                  {CATEGORY_LABELS[c]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.categoryHint}>
          {category
            ? 'Used to match counselling closing ranks.'
            : 'Optional for your rank range — needed to see possible branches.'}
        </Text>

        {category ? (
          <View style={styles.pwdRow}>
            <Text style={styles.pwdText}>PwD (benchmark disability)</Text>
            <Switch
              value={pwd}
              onValueChange={setPwd}
              trackColor={{ false: colors.border, true: 'rgba(1, 180, 174, 0.4)' }}
              thumbColor={pwd ? colors.primary : colors.textMuted}
            />
          </View>
        ) : null}

        <Text style={styles.quotaText}>
          {isIniCet ? 'Single counselling pool (all INIs)' : 'Quota: All India Quota'}
        </Text>
      </View>

      {formError ? (
        <View style={shared.formErrorBox}>
          <Text style={shared.formErrorText}>{formError}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[shared.primaryButton, (predicting || !gt.validation.valid) ? shared.primaryButtonDisabled : null]}
        onPress={handlePredict}
        disabled={predicting || !gt.validation.valid}
        activeOpacity={0.8}
      >
        {predicting ? (
          <>
            <ActivityIndicator color="#FFF" size="small" />
            <Text style={shared.primaryButtonText}>Predicting…</Text>
          </>
        ) : (
          <Text style={shared.primaryButtonText}>Predict my range</Text>
        )}
      </TouchableOpacity>

      <Text style={shared.footnote}>{DISCLAIMER_NOTE}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 12,
  },
  categoryOptional: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 10,
    lineHeight: 16,
  },
  pwdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.bg,
  },
  pwdText: {
    fontSize: 13.5,
    color: colors.textBody,
    flex: 1,
  },
  quotaText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 10,
  },
});
