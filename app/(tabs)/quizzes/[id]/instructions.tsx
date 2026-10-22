import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import StatCardGrid from '@/components/StatCardGrid';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { BookOpen, Clock, FileText, Award } from 'lucide-react-native';
import { api } from '@/services/api';
import { useQuiz } from '@/context/QuizContext';
import { formatToIST, formatCountdown } from '@/utils/date';
import { colors } from '@/utils/theme';

interface Quiz {
  _id: string;
  title: string;
  subject: any;
  subjectNames?: string[]; // computed by backend
  duration: number;
  instructions: string[];
  totalMarks: number;
  questions: any[];
  attemptStatus?: any;
  scheduledDate?: string;
  expiryDate?: string;
  // Server-computed availability (same rule /start enforces) plus the
  // server's own clock — together with the local tick below the countdown
  // stays accurate even on a drifted device clock. /start remains the
  // authoritative gate either way.
  scheduleState?: 'scheduled' | 'open' | 'ended';
  serverNow?: string;
  sections?: {
    name: string;
    duration: number;
    selectionType: 'mixed' | 'manual';
    questions: any[];
  }[];
  // Missing on quizzes created before the feature — backend normalizes to
  // true; read with `!== false` everywhere.
  lockSectionsAfterSubmission?: boolean;
  // Server-computed (Phase 2): true only when proctoring is fully effective
  // right now — routes the student through precheck + consent before /start.
  proctoringRequired?: boolean;
}

const getQuestionId = (question: any): string => {
  if (!question) return '';
  if (typeof question === 'string') return question;
  return question._id || '';
};

export default function QuizInstructions() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { startQuiz, isLoading: quizLoading } = useQuiz();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchQuizDetails();
  }, [id]);

  // ===== Live scheduling state (display only — /start is the gate) =====
  // The server payload carries scheduleState + its own "now"; between
  // payloads a 1s tick recomputes the state from the stored dates with the
  // server-corrected clock, so the Start button flips on time in BOTH
  // directions (scheduled → open, open → ended) without a refetch, and a
  // wrong device clock cannot extend or shrink the truth.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!quiz) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [quiz]);

  const clockOffsetMs = useMemo(() => {
    const serverMs = quiz?.serverNow ? new Date(quiz.serverNow).getTime() : NaN;
    return Number.isFinite(serverMs) ? serverMs - Date.now() : 0;
  }, [quiz?.serverNow]);

  const liveSchedule = useMemo(() => {
    const serverNowMs = nowTick + clockOffsetMs;
    const startsAtMs = quiz?.scheduledDate ? new Date(quiz.scheduledDate).getTime() : NaN;
    const endsAtMs = quiz?.expiryDate ? new Date(quiz.expiryDate).getTime() : NaN;
    if (Number.isFinite(startsAtMs) && serverNowMs < startsAtMs) {
      return { state: 'scheduled' as const, msUntilOpen: startsAtMs - serverNowMs };
    }
    if (Number.isFinite(endsAtMs) && serverNowMs >= endsAtMs) {
      return { state: 'ended' as const, msUntilOpen: 0 };
    }
    return { state: 'open' as const, msUntilOpen: 0 };
  }, [nowTick, clockOffsetMs, quiz?.scheduledDate, quiz?.expiryDate]);

  const fetchQuizDetails = async () => {
    try {
      const response = await api.get(`/quizzes/${id}`);
      setQuiz(response.data);
    } catch (error: any) {
      const message = error.response?.data?.message || 'Failed to load quiz';
      Alert.alert('Error', message, [
        {
          text: 'OK',
          onPress: () => router.replace('/(tabs)/quizzes' as any)
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleStartQuiz = async () => {
    if (!quiz) return;

    // Scheduling guard (belt & braces — the button is disabled and /start
    // independently 403s outside the window, so a stale payload or a direct
    // tap can never start early or late).
    if (liveSchedule.state === 'scheduled') {
      Alert.alert(
        'Not Started Yet',
        `This test opens on ${formatToIST(quiz.scheduledDate)}. Please come back then.`
      );
      return;
    }
    if (liveSchedule.state === 'ended') {
      Alert.alert('Test Ended', 'The scheduled window for this test has closed.');
      return;
    }

    // Check if already attempted
    if (quiz.attemptStatus?.hasAttempted && !quiz.attemptStatus?.canRetake) {
      Alert.alert(
        'Already Attempted',
        'You have already attempted this quiz. Would you like to request a retest from admin?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Request Retest',
            onPress: () => router.push(`/quizzes/${id}/retest-request` as any)
          }
        ]
      );
      return;
    }

    Alert.alert(
      'Start Quiz',
      'Once started, the timer will begin. Are you ready?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: async () => {
            // Proctored quizzes: probe /start FIRST. An in_progress attempt
            // resumes WITHOUT re-gating (a returning student must not be
            // blocked by a camera that stopped working mid-quiz); only a 403
            // PROCTORING_* means no resumable attempt → route through the
            // readiness checks + consent, where the attempt actually begins.
            if (quiz.proctoringRequired) {
              try {
                const result = await startQuiz(quiz._id);
                if (result?.attemptFinalized) {
                  router.replace(`/quizzes/${id}/result/${result.attemptId}`);
                } else {
                  router.replace(`/quizzes/${id}/taking`);
                }
              } catch (error: any) {
                const errorCode = error?.response?.data?.errorCode;
                if (
                  errorCode === 'PROCTORING_CONSENT_REQUIRED' ||
                  errorCode === 'PROCTORING_PRECHECK_REQUIRED'
                ) {
                  // Expected on first entry: the gate codes stay silent in the
                  // context (they are steering, not failures) — this screen
                  // owns the routing into the readiness + consent flow.
                  router.push(`/quizzes/${id}/precheck` as any);
                }
                // Any other failure was surfaced by the context — stay here.
              }
              return;
            }
            try {
              const result = await startQuiz(quiz._id);
              if (result?.attemptFinalized) {
                // The attempt ended server-side while the student was away
                // (section timers kept running) — go straight to results.
                router.replace(`/quizzes/${id}/result/${result.attemptId}`);
                return;
              }
              router.replace(`/quizzes/${id}/taking`);
            } catch (error) {
              // Error handled in context
            }
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <ScreenContainer style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
      </ScreenContainer>
    );
  }

  if (!quiz) {
    return (
      <ScreenContainer style={styles.container}>
        <Text style={styles.errorText}>Quiz not found</Text>
      </ScreenContainer>
    );
  }

  // Get unique sections
  const sections = quiz.sections && quiz.sections.length > 0
    ? quiz.sections.map(s => s.name)
    : Array.from(new Set(quiz.questions.map(q => q.subject?.name || 'General')));

  const defaultInstructions = [
    'Read each question carefully before answering.',
    'You can navigate between questions using the navigation grid.',
    'Mark questions for review if you wish to revisit them later.',
    'The test will auto-submit when time expires.',
    'Ensure stable internet connection throughout the test.',
  ];

  const instructions = quiz.instructions && quiz.instructions.length > 0
    ? quiz.instructions
    : defaultInstructions;

  const sectionQuestionCounts = (() => {
    const counts: Record<string, number> = {};
    if (!quiz.sections || quiz.sections.length === 0) return counts;

    const allQuestionIds = (quiz.questions || []).map(q => getQuestionId(q)).filter(Boolean);
    const allQuestionIdSet = new Set(allQuestionIds);
    const mixedSectionNames: string[] = [];
    const assignedIds = new Set<string>();

    quiz.sections.forEach(section => {
      const ids = (section.questions || [])
        .map(q => getQuestionId(q))
        .filter(qid => qid && allQuestionIdSet.has(qid));
      counts[section.name] = [...new Set(ids)].length;
      ids.forEach(id => assignedIds.add(id));
      if (section.selectionType === 'mixed') mixedSectionNames.push(section.name);
    });

    const unassignedIds = allQuestionIds.filter(id => !assignedIds.has(id));
    if (mixedSectionNames.length > 0 && unassignedIds.length > 0) {
      unassignedIds.forEach((_, index) => {
        const sectionName = mixedSectionNames[index % mixedSectionNames.length];
        counts[sectionName] = (counts[sectionName] || 0) + 1;
      });
    }

    return counts;
  })();

  return (
    <ScreenContainer style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <BookOpen color={colors.primary} size={32} />
          </View>
          <Text style={styles.title}>{quiz.title}</Text>
          <Text style={styles.subject}>
            {(quiz.subjectNames && quiz.subjectNames.length > 1) || sections.length > 1
              ? 'MIXED'
              : (quiz.subjectNames?.[0] || (typeof quiz.subject === 'object' ? quiz.subject?.name : quiz.subject) || 'General').toUpperCase()}
          </Text>
        </View>

        <View style={styles.statsContainer}>
          <StatCardGrid
            items={[
              {
                value: quiz.questions.length,
                label: 'Questions',
                icon: FileText,
                iconColor: colors.primary,
                valueColor: '#1F2937',
              },
              {
                value: quiz.totalMarks,
                label: 'Total Marks',
                icon: Award,
                iconColor: '#10B981',
                valueColor: '#1F2937',
              },
              {
                value: quiz.duration,
                label: 'Minutes',
                icon: Clock,
                iconColor: '#F59E0B',
                valueColor: '#1F2937',
              },
            ]}
            gap={12}
            cardStyle={styles.statCardOverride}
          />
        </View>

        {/* Time Window (IST) */}
        {(quiz.scheduledDate || quiz.expiryDate) && (
          <View style={styles.section}>
            <View style={[styles.noteCard, styles.scheduleCard]}>
              <Text style={[styles.noteTitle, styles.scheduleTitle]}>📅 Schedule (IST)</Text>
              {quiz.scheduledDate && (
                <Text style={[styles.noteText, styles.scheduleText]}>
                  • Starts: {formatToIST(quiz.scheduledDate)}
                  {liveSchedule.state === 'scheduled' && (
                    <Text style={{ color: '#F59E0B', fontWeight: '600' }}>
                      {'  '}(in {formatCountdown(liveSchedule.msUntilOpen)})
                    </Text>
                  )}
                </Text>
              )}
              {quiz.expiryDate && (
                <Text style={[styles.noteText, styles.scheduleText]}>
                  • Ends: {formatToIST(quiz.expiryDate)}
                </Text>
              )}
              {liveSchedule.state === 'ended' && (
                <Text style={[styles.noteText, { color: '#EF4444', fontWeight: '600' }]}>
                  • This test has ended — it can no longer be attempted.
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Test Structure */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Test Structure</Text>
          <View style={styles.structureCard}>
            <Text style={styles.structureText}>
              📚 Number of Sections: <Text style={styles.bold}>{sections.length}</Text>
            </Text>
            {sections.map((section, index) => {
              let count = 0;
              let secDuration = 0;

              if (quiz.sections && quiz.sections.length > 0) {
                const sData = quiz.sections.find(s => s.name === section);
                count = sData ? (sectionQuestionCounts[section] ?? sData.questions.length) : 0;
                secDuration = sData ? sData.duration : 0;
              } else {
                count = quiz.questions.filter(q =>
                  (q.subject?.name || 'General') === section
                ).length;
              }

              return (
                <Text key={index} style={styles.structureText}>
                  • {section}: {count} questions {secDuration > 0 ? `(${secDuration} mins)` : ''}
                </Text>
              );
            })}
            {quiz.lockSectionsAfterSubmission !== false && sections.length > 0 && (
              <Text style={[styles.structureText, { color: '#B45309', marginTop: 8 }]}>
                🔒 Sections are sequential — once you submit a section (or its timer ends), you cannot return to it. Each section has its own timer.
              </Text>
            )}
          </View>
        </View>

        {/* General Instructions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>General Instructions</Text>
          <View style={styles.instructionsCard}>
            {instructions.map((instruction, index) => (
              <View key={index} style={styles.instructionItem}>
                <Text style={styles.bullet}>{index + 1}.</Text>
                <Text style={styles.instructionText}>{instruction}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Important Notes */}
        <View style={styles.section}>
          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>⚠️ Important</Text>
            <Text style={styles.noteText}>
              • This quiz can only be attempted once without admin approval{'\n'}
              • The quiz will auto-submit when the timer expires{'\n'}
              • Make sure you have a stable internet connection{'\n'}
              • Do not close the app during the quiz
            </Text>
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Start Button — disabled outside the scheduling window; the label
          itself communicates why (countdown to open, or closed). */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.startButton, liveSchedule.state !== 'open' && styles.startButtonDisabled]}
          onPress={handleStartQuiz}
          disabled={quizLoading || liveSchedule.state !== 'open'}
        >
          {quizLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : liveSchedule.state === 'scheduled' ? (
            <Text style={styles.startButtonText}>
              Opens in {formatCountdown(liveSchedule.msUntilOpen)}
            </Text>
          ) : liveSchedule.state === 'ended' ? (
            <Text style={styles.startButtonText}>Test Ended</Text>
          ) : (
            <Text style={styles.startButtonText}>Start Test</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: colors.primaryTint,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    textAlign: 'center',
    marginBottom: 8,
  },
  subject: {
    fontSize: 16,
    color: colors.primaryDark,
    fontWeight: '600',
  },
  statsContainer: {
    padding: 16,
  },
  // Matches the original stat card look on top of StatCardGrid's defaults.
  statCardOverride: {
    borderRadius: 12,
    borderWidth: 0,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 12,
  },
  structureCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  structureText: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
  },
  bold: {
    fontWeight: '600',
    color: '#1F2937',
  },
  instructionsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  instructionItem: {
    flexDirection: 'row',
    gap: 8,
  },
  bullet: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  instructionText: {
    flex: 1,
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
  },
  noteCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  // Schedule panel — teal info variant of the amber noteCard, matching the
  // primaryTint info boxes used across the migrated screens.
  scheduleCard: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primaryTintBorder,
  },
  scheduleTitle: {
    color: colors.primaryDark,
  },
  scheduleText: {
    color: colors.primaryText,
  },
  noteTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#92400E',
    marginBottom: 8,
  },
  noteText: {
    fontSize: 14,
    color: '#92400E',
    lineHeight: 20,
  },
  footer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  startButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  startButtonDisabled: {
    backgroundColor: '#9CA3AF',
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
  },
});
