import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { useRouter } from 'expo-router';
import { ChevronLeft, History, RefreshCw, CircleCheck, Sparkles, Target } from 'lucide-react-native';
import { colors } from '@/utils/theme';
import { withFeatureGate } from '@/components/withFeatureGate';
import { predictorEndpoints, predictorErrorMessage } from '@/services/predictor';
import type {
  DesiredBranchResponse,
  PredictResponse,
  PredictorExam,
  PredictorExamId,
} from '@/types/predictor';
import PredictorForm from '@/components/predictor/PredictorForm';
import DesiredBranchForm from '@/components/predictor/DesiredBranchForm';
import PredictResult from '@/components/predictor/PredictResult';
import DesiredBranchResult from '@/components/predictor/DesiredBranchResult';
import { EXAM_LABELS, EXAM_PATTERN_LABELS } from '@/utils/predictor/constants';
import * as Haptics from '@/utils/haptics';

/**
 * Rank & Branch Predictor — student-facing predictor under the Tests tab.
 *
 * Same engine, data and history as eyeconicneetpg.com/predictor (served by
 * the website server's /api/predictor; services/predictor.ts), with a native
 * UI. One screen, two modes (decision D3 — a mode toggle, not a new route):
 *
 *   "Predict my outcome" — forward: exam → Grand Tests (auto-filled from
 *   Eyeconic attempts, provenance-tagged) → optional category/PwD → predicted
 *   percentile + AIR ranges → possible branches & colleges. Category is NEVER
 *   defaulted — it gates branch matching (spec §3.6).
 *
 *   "Plan for a branch"  — reverse (Feature 02): exam → desired branch →
 *   REQUIRED category → optional current GTs → the rank the branch
 *   historically took, the corrects to aim for, and the gap.
 *
 * Thin orchestrator (mirrors the website's Predictor page): the exam list is
 * loaded once and shared by both modes; the input forms and result views are
 * components; switching modes resets whichever result was showing.
 *
 * Visual system: the Analytics teal language (utils/theme.ts tokens) — teal
 * module header, Analytics-style segmented mode control, compact exam
 * selector card.
 */

type PredictorMode = 'predict' | 'desired';

function RankPredictorScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const [mode, setMode] = useState<PredictorMode>('predict');
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [desired, setDesired] = useState<DesiredBranchResponse | null>(null);

  const [exams, setExams] = useState<PredictorExam[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedExam, setSelectedExam] = useState<PredictorExamId>('NEET_PG');

  const loadExams = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await predictorEndpoints.exams();
      setExams(list);
    } catch (err) {
      setError(predictorErrorMessage(err, 'Could not load the predictor right now.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExams();
  }, [loadExams]);

  // Leaving a result view resets it — each mode starts from its own form.
  const switchMode = (next: PredictorMode) => {
    if (next === mode) return;
    Haptics.selectionAsync();
    setMode(next);
    setResult(null);
    setDesired(null);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const handlePredicted = (response: PredictResponse) => {
    setResult(response);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const handleDesired = (response: DesiredBranchResponse) => {
    setDesired(response);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const patternLine = (exam: PredictorExam): string => {
    if (exam.pattern) {
      const { totalQuestions, positive, negative, maxMarks } = exam.pattern;
      const neg = negative === Math.round(negative) ? `−${Math.round(negative)}` : '−⅓';
      return `${totalQuestions} questions · +${positive} / ${neg} marking · max ${maxMarks}`;
    }
    return EXAM_PATTERN_LABELS[exam.id] ?? '';
  };

  const tabs: { key: PredictorMode; label: string; icon: typeof Sparkles }[] = [
    { key: 'predict', label: 'Predict outcome', icon: Sparkles },
    { key: 'desired', label: 'Plan a branch', icon: Target },
  ];

  return (
    <ScreenContainer style={styles.container}>
      {/* Header — the Analytics module-header treatment (teal, white 20/700) */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Go back"
        >
          <ChevronLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Rank Predictor</Text>
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/quizzes/rank-predictor-history')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Prediction history"
        >
          <History color="#FFF" size={22} />
        </TouchableOpacity>
      </View>

      {/* Mode toggle (D3) — the Analytics segmented-control treatment. The two
          directions of the same counselling data; tab labels carry the
          explanation, so no intro paragraph is needed above the form. */}
      <View style={styles.modeToggle}>
        {tabs.map(({ key, label, icon: Icon }) => {
          const active = mode === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.modeButton, active ? styles.modeButtonActive : null]}
              onPress={() => switchMode(key)}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Icon size={15} color={active ? '#FFF' : colors.textSecondary} />
              <Text style={[styles.modeButtonText, active ? styles.modeButtonTextActive : null]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {mode === 'predict' && result ? (
          <PredictResult
            result={result.prediction}
            predictionId={result.predictionId}
            onBack={() => setResult(null)}
          />
        ) : mode === 'desired' && desired ? (
          <DesiredBranchResult response={desired} onBack={() => setDesired(null)} />
        ) : (
          <>
            {loading && exams === null && (
              <View style={styles.stateCard}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.stateText}>Loading exams…</Text>
              </View>
            )}

            {error !== null && (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={loadExams}>
                  <RefreshCw color="#FFF" size={16} />
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}

            {exams !== null && error === null && (
              <View style={styles.examCard}>
                <Text style={styles.examCardTitle}>Exam</Text>
                <View style={styles.examRows}>
                  {exams.map((exam) => {
                    const selected = selectedExam === exam.id;
                    const label = exam.label ?? EXAM_LABELS[exam.id] ?? exam.id;
                    return (
                      <TouchableOpacity
                        key={exam.id}
                        style={[
                          styles.examRow,
                          selected && exam.available ? styles.examRowSelected : null,
                          !exam.available ? styles.examRowDisabled : null,
                        ]}
                        disabled={!exam.available}
                        activeOpacity={0.8}
                        onPress={() => setSelectedExam(exam.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected, disabled: !exam.available }}
                      >
                        <View style={styles.examRowText}>
                          <Text style={[styles.examLabel, !exam.available && styles.textDisabled]} numberOfLines={1}>
                            {label}
                          </Text>
                          {patternLine(exam) ? (
                            <Text
                              style={[styles.examPattern, !exam.available && styles.textDisabled]}
                              numberOfLines={1}
                            >
                              {patternLine(exam)}
                            </Text>
                          ) : null}
                        </View>
                        {selected && exam.available ? (
                          <CircleCheck color={colors.primary} size={22} />
                        ) : !exam.available ? (
                          <View style={styles.chipOff}>
                            <Text style={styles.chipOffText}>Coming soon</Text>
                          </View>
                        ) : (
                          <View style={styles.radioRing} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {mode === 'predict' ? (
              <PredictorForm
                exams={exams ?? []}
                selectedExam={selectedExam}
                onPredicted={handlePredicted}
              />
            ) : (
              <DesiredBranchForm
                exams={exams ?? []}
                selectedExam={selectedExam}
                onResult={handleDesired}
              />
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.primary,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
  },
  // Segmented control — same geometry as Analytics' TabSwitcher.
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 4,
    marginHorizontal: 16,
    marginVertical: 12,
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  modeButtonActive: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  modeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modeButtonTextActive: {
    color: '#FFFFFF',
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 12,
  },
  stateCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 28,
    alignItems: 'center',
    gap: 10,
  },
  stateText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  errorCard: {
    backgroundColor: colors.dangerTint,
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.2)',
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    fontSize: 14,
    color: colors.dangerDark,
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.dangerDark,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  retryText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  // Exam selector — one card, radio-style rows (replaces the old heading +
  // stacked exam cards: same choices and availability logic, less chrome).
  examCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  examCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  examRows: {
    gap: 8,
  },
  examRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
  },
  examRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  examRowDisabled: {
    opacity: 0.55,
  },
  examRowText: {
    flex: 1,
    gap: 2,
  },
  examLabel: {
    fontSize: 15.5,
    fontWeight: '700',
    color: colors.text,
  },
  examPattern: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  textDisabled: {
    color: colors.textSecondary,
  },
  radioRing: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  chipOff: {
    borderRadius: 99,
    backgroundColor: colors.bg,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  chipOffText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});

export default withFeatureGate('rankPredictor')(RankPredictorScreen);
