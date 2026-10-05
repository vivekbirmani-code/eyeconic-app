import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Switch, StyleSheet } from 'react-native';
import type { PredictResponse, PredictorExam, PredictorExamId } from '@/types/predictor';
import {
  predictorEndpoints,
  predictorErrorMessage,
  errorRowIndices,
  type PredictRequestBody,
} from '@/services/predictor';
import { useGtInput } from '@/hooks/useGtInput';
import GtInputSection from '@/components/predictor/GtInputSection';
import { CATEGORIES, DISCLAIMER_NOTE, EXAM_LABELS, maxCorrectsFor } from '@/utils/predictor/constants';
import * as Haptics from '@/utils/haptics';

/**
 * The forward predictor form — extracted from the predictor screen when the
 * Desired Branch mode (Phase 5) made the screen a two-mode orchestrator.
 * Behavior is unchanged: exam → REQUIRED Grand Tests → optional category/PwD
 * (never defaulted, §3.6) → POST /predict. The screen owns the exam list and
 * renders it above this form for both modes.
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
        subtitle={`Correct answers in full-length ${EXAM_LABELS[selectedExam] ?? selectedExam} pattern Grand Tests — one row per test.`}
      />

      {/* Category & quota (§3.6): optional for the rank, REQUIRED for
          branches, never defaulted. PwD appears only with a category. */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Category</Text>
        <View style={styles.categoryRow}>
          {CATEGORIES.map((c) => {
            const active = category === c;
            return (
              <TouchableOpacity
                key={c}
                style={[styles.categoryChip, active ? styles.categoryChipActive : null]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setCategory((prev) => (prev === c ? '' : c));
                }}
                activeOpacity={0.7}
                accessibilityLabel={CATEGORY_LABELS[c]}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    active ? styles.categoryChipTextActive : null,
                  ]}
                >
                  {CATEGORY_LABELS[c]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.categoryHint}>
          {category
            ? 'Needed to match counselling closing ranks.'
            : 'Optional for the rank range — needed to see possible branches.'}
        </Text>

        {category ? (
          <View style={styles.pwdRow}>
            <Text style={styles.pwdText}>PwD (person with benchmark disability)</Text>
            <Switch
              value={pwd}
              onValueChange={setPwd}
              trackColor={{ false: '#E5E7EB', true: 'rgba(1, 180, 174, 0.4)' }}
              thumbColor={pwd ? '#01b4ae' : '#9CA3AF'}
            />
          </View>
        ) : null}

        <View style={styles.quotaRow}>
          <Text style={styles.quotaText}>
            {isIniCet ? 'Single counselling pool (all INIs)' : 'Quota: All India Quota'}
          </Text>
        </View>
      </View>

      {formError ? (
        <View style={styles.formErrorBox}>
          <Text style={styles.formErrorText}>{formError}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.submitButton, (predicting || !gt.validation.valid) ? styles.submitDisabled : null]}
        onPress={handlePredict}
        disabled={predicting || !gt.validation.valid}
        activeOpacity={0.8}
      >
        {predicting ? (
          <>
            <ActivityIndicator color="#FFF" size="small" />
            <Text style={styles.submitText}>Predicting…</Text>
          </>
        ) : (
          <Text style={styles.submitText}>Predict my range</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.footerDisclaimer}>{DISCLAIMER_NOTE}</Text>
    </>
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
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  categoryChipActive: {
    borderColor: '#01b4ae',
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
  },
  categoryChipTextActive: {
    color: '#0d7a76',
    fontWeight: '700',
  },
  categoryHint: {
    fontSize: 12,
    color: '#6B7280',
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
    borderTopColor: '#F3F4F6',
  },
  pwdText: {
    fontSize: 13.5,
    color: '#374151',
    flex: 1,
  },
  quotaRow: {
    marginTop: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 10,
  },
  quotaText: {
    fontSize: 12.5,
    color: '#6B7280',
  },
  formErrorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.25)',
    borderRadius: 12,
    padding: 12,
  },
  formErrorText: {
    fontSize: 13,
    color: '#DC2626',
    textAlign: 'center',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#01b4ae',
    borderRadius: 14,
    paddingVertical: 15,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  submitDisabled: {
    opacity: 0.5,
    elevation: 0,
  },
  submitText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  footerDisclaimer: {
    fontSize: 11.5,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 2,
  },
});
