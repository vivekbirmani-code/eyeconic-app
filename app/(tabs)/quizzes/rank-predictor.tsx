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
import { DISCLAIMER_NOTE, EXAM_LABELS, EXAM_PATTERN_LABELS } from '@/utils/predictor/constants';
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

  return (
    <ScreenContainer style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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

      {/* mode toggle (D3): the two directions of the same counselling data */}
      <View style={styles.modeToggle}>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'predict' ? styles.modeButtonActive : null]}
          onPress={() => switchMode('predict')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === 'predict' }}
        >
          <Sparkles size={15} color={mode === 'predict' ? '#0d7a76' : '#6B7280'} />
          <Text style={[styles.modeButtonText, mode === 'predict' ? styles.modeButtonTextActive : null]}>
            Predict my outcome
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'desired' ? styles.modeButtonActive : null]}
          onPress={() => switchMode('desired')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === 'desired' }}
        >
          <Target size={15} color={mode === 'desired' ? '#0d7a76' : '#6B7280'} />
          <Text style={[styles.modeButtonText, mode === 'desired' ? styles.modeButtonTextActive : null]}>
            Plan for a branch
          </Text>
        </TouchableOpacity>
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
            <View style={styles.introCard}>
              {mode === 'predict' ? (
                <>
                  <Text style={styles.introTitle}>Predict my outcome</Text>
                  <Text style={styles.introBody}>
                    Enter your Grand Test scores to estimate your exam percentile and All India Rank
                    range, plus the branches they have historically corresponded to.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.introTitle}>Plan for a branch</Text>
                  <Text style={styles.introBody}>
                    Name the branch you want — see the rank it historically took and roughly how
                    many corrects that means. A planning target, not a promise.
                  </Text>
                </>
              )}
              <Text style={styles.introDisclaimer}>{DISCLAIMER_NOTE}</Text>
            </View>

            <Text style={styles.sectionTitle}>Choose your exam</Text>

            {loading && exams === null && (
              <View style={styles.skeletonCard}>
                <ActivityIndicator color="#2563EB" />
                <Text style={styles.skeletonText}>Loading exams…</Text>
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

            {exams !== null &&
              error === null &&
              exams.map((exam) => {
                const selected = selectedExam === exam.id;
                return (
                  <TouchableOpacity
                    key={exam.id}
                    style={[
                      styles.examCard,
                      selected && styles.examCardSelected,
                      !exam.available && styles.examCardDisabled,
                    ]}
                    disabled={!exam.available}
                    activeOpacity={0.8}
                    onPress={() => setSelectedExam(exam.id)}
                  >
                    <View style={styles.examCardTop}>
                      <Text style={[styles.examLabel, !exam.available && styles.textDisabled]}>
                        {exam.label ?? EXAM_LABELS[exam.id] ?? exam.id}
                      </Text>
                      {selected && exam.available ? (
                        <CircleCheck color="#01b4ae" size={22} />
                      ) : (
                        <Text
                          style={[
                            styles.availabilityChip,
                            exam.available ? styles.chipOn : styles.chipOff,
                          ]}
                        >
                          {exam.available ? 'Available' : 'Coming soon'}
                        </Text>
                      )}
                    </View>
                    {patternLine(exam) ? (
                      <Text style={[styles.examPattern, !exam.available && styles.textDisabled]}>
                        {patternLine(exam)}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}

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
    backgroundColor: '#F3F4F6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#2563EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
  },
  modeToggle: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  modeButtonActive: {
    backgroundColor: 'rgba(1, 180, 174, 0.12)',
  },
  modeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  modeButtonTextActive: {
    color: '#0d7a76',
    fontWeight: '700',
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 12,
  },
  introCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.15)',
  },
  introTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#01b4ae',
    marginBottom: 6,
  },
  introBody: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  introDisclaimer: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginTop: 6,
    marginBottom: 2,
  },
  skeletonCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    gap: 10,
  },
  skeletonText: {
    fontSize: 13,
    color: '#6B7280',
  },
  errorCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.2)',
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#DC2626',
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DC2626',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  retryText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  examCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  examCardSelected: {
    borderColor: '#01b4ae',
    backgroundColor: '#F0FBFA',
  },
  examCardDisabled: {
    opacity: 0.55,
  },
  examCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  examLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  textDisabled: {
    color: '#6B7280',
  },
  examPattern: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 6,
  },
  availabilityChip: {
    fontSize: 11.5,
    fontWeight: '600',
    borderRadius: 99,
    paddingVertical: 3,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  chipOn: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    color: '#10B981',
  },
  chipOff: {
    backgroundColor: '#F3F4F6',
    color: '#6B7280',
  },
});

export default withFeatureGate('rankPredictor')(RankPredictorScreen);
