import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StatusBar,
  BackHandler,
  Image,
} from 'react-native';
import { FullScreenContainer } from '@/components/layout';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, Flag, Clock, AlertCircle } from 'lucide-react-native';
import { useGuestQuiz } from '@/context/GuestQuizContext';
import { getSocketURL } from '@/services/config';
import { SectionTabs } from '@/components/SectionTabs';
import QuestionPrompt from '@/components/quiz/QuestionPrompt';
import { QuestionType, StudentResponse, isResponseAnswered } from '@/types/question';

interface Question {
  _id: string;
  questionText: string;
  questionImage?: string;
  questionType?: QuestionType;
  options?: string[];
  optionImages?: string[];
  assertion?: string;
  reason?: string;
  columnA?: string[];
  columnB?: string[];
  marks: number;
}

const defaultResponseFor = (type?: QuestionType): StudentResponse => {
  switch (type) {
    case 'multiple_correct': return [];
    case 'match_the_following': return {};
    case 'numerical': return null;
    default: return -1;
  }
};

export default function GuestQuizTaking() {
  const router = useRouter();
  const { shareToken } = useLocalSearchParams<{ shareToken: string }>();
  const {
    currentAttempt,
    quizData,
    saveGuestAnswer,
    submitGuestQuiz,
    submitGuestSection,
    resyncGuestProgress,
    isLoading
  } = useGuestQuiz();

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<StudentResponse>(-1);
  const [markedForReview, setMarkedForReview] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [currentSection, setCurrentSection] = useState('All');
  const [questionStartTime, setQuestionStartTime] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  // ===== Section locking (the attempt snapshot is the single truth) =====
  const lockOn =
    currentAttempt?.sectionLockEnabled === true &&
    (currentAttempt?.sectionDefinitions?.length ?? 0) > 0;
  const activeSectionState = lockOn
    ? currentAttempt?.sectionStates?.find(s => s.status === 'in_progress') ?? null
    : null;
  const activeSectionIndex = activeSectionState?.index ?? -1;
  const activeSectionDef = lockOn
    ? currentAttempt?.sectionDefinitions?.find(d => d.index === activeSectionIndex) ?? null
    : null;
  const isLastSection =
    lockOn && activeSectionIndex === (currentAttempt?.sectionDefinitions?.length ?? 0) - 1;

  // Definition question ids -> global question indexes (guest questions are
  // addressed by position in quizData.questions).
  const sectionQuestionIndexesMap = useMemo(() => {
    const map: Record<string, number[]> = {};
    if (!lockOn || !currentAttempt?.sectionDefinitions || !quizData) return map;
    const idToGlobalIndex: Record<string, number> = {};
    quizData.questions.forEach((q, index) => {
      if (q?._id) idToGlobalIndex[String(q._id)] = index;
    });
    currentAttempt.sectionDefinitions.forEach(d => {
      map[d.name] = (d.questionIds || [])
        .map(qid => idToGlobalIndex[String(qid)])
        .filter(idx => idx !== undefined);
    });
    return map;
  }, [lockOn, currentAttempt, quizData]);

  const activeQuestionIndexes = useMemo(() => {
    if (!lockOn || !activeSectionDef) return null;
    return sectionQuestionIndexesMap[activeSectionDef.name] || [];
  }, [lockOn, activeSectionDef, sectionQuestionIndexesMap]);

  const currentQuestionPosition = useMemo(() => {
    if (lockOn) {
      return activeQuestionIndexes ? activeQuestionIndexes.indexOf(currentQuestionIndex) : -1;
    }
    return currentQuestionIndex;
  }, [lockOn, activeQuestionIndexes, currentQuestionIndex]);

  const sectionStatuses = useMemo(() => {
    if (!lockOn || !currentAttempt?.sectionDefinitions?.length) return undefined;
    const map: { [name: string]: 'locked' | 'active' | 'upcoming' } = {};
    currentAttempt.sectionDefinitions.forEach(d => {
      if (activeSectionIndex >= 0 && d.index < activeSectionIndex) map[d.name] = 'locked';
      else if (d.index === activeSectionIndex) map[d.name] = 'active';
      else map[d.name] = 'upcoming';
    });
    return map;
  }, [lockOn, currentAttempt, activeSectionIndex]);

  const sections = useMemo(() => {
    if (lockOn && currentAttempt?.sectionDefinitions?.length) {
      return currentAttempt.sectionDefinitions.map(d => d.name);
    }
    return ['All', ...new Set((quizData?.questions || [])
      .map(q => q.subjectName || 'Uncategorized')
      .filter(s => s !== 'Uncategorized'))].sort();
  }, [lockOn, currentAttempt, quizData]);

  const questionCounts = useMemo(() => {
    if (lockOn && currentAttempt?.sectionDefinitions?.length) {
      const counts: Record<string, number> = {};
      currentAttempt.sectionDefinitions.forEach(d => {
        counts[d.name] = sectionQuestionIndexesMap[d.name]?.length || 0;
      });
      return counts;
    }
    if (!quizData) return {};
    const counts: Record<string, number> = { All: quizData.questions.length };
    quizData.questions.forEach(q => {
      const s = q.subjectName || 'Uncategorized';
      counts[s] = (counts[s] || 0) + 1;
    });
    return counts;
  }, [lockOn, currentAttempt, sectionQuestionIndexesMap, quizData]);

  const handleImageError = useCallback((url: string) => {
    setFailedImages(prev => new Set(prev).add(url));
  }, []);

  const scrollViewRef = useRef<ScrollView>(null);
  const timerRef = useRef<any>(null);
  const timeUpFiredRef = useRef(false);

  // Helper to resolve image URLs (handles relative paths from backend)
  const getImageUrl = useCallback((path?: string) => {
    if (!path) return undefined;
    if (path.startsWith('http') || path.startsWith('https') || path.startsWith('file://') || path.startsWith('data:')) {
      return { uri: path };
    }

    // Prepend base URL for relative paths
    // getSocketURL return the root URL e.g. http://192.168.x.x:3000
    const baseUrl = getSocketURL();
    // Ensure we don't have double slashes if path starts with /
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return { uri: `${baseUrl}${cleanPath}` };
  }, []);

  useEffect(() => {
    if (!currentAttempt || !quizData) {
      router.replace(`/guest-quiz/${shareToken}` as any);
      return;
    }

    // Section locking: the deadline is the server-issued per-section endsAt
    // (wall-clock, refresh-safe). Re-arms whenever the active section changes.
    const deadlineFor = (): number => {
      if (lockOn && activeSectionState?.endsAt) {
        return new Date(activeSectionState.endsAt).getTime();
      }
      const startTime = new Date(currentAttempt.startTime).getTime();
      return startTime + (quizData.duration * 60 * 1000);
    };

    timeUpFiredRef.current = false;
    const endTime = deadlineFor();
    setTimeRemaining(Math.max(0, Math.floor((endTime - Date.now()) / 1000)));

    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          if (!timeUpFiredRef.current) {
            timeUpFiredRef.current = true;
            handleTimeUp();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBackPress();
      return true;
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      backHandler.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAttempt, quizData, activeSectionIndex, lockOn]);

  // Keep the current question inside the active section (section submit,
  // timer expiry while away, re-sync).
  useEffect(() => {
    if (!lockOn || !activeQuestionIndexes || activeQuestionIndexes.length === 0) return;
    if (!activeQuestionIndexes.includes(currentQuestionIndex)) {
      setCurrentQuestionIndex(activeQuestionIndexes[0]);
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [lockOn, activeQuestionIndexes, currentQuestionIndex]);

  useEffect(() => {
    if (lockOn && activeSectionDef && currentSection !== activeSectionDef.name) {
      setCurrentSection(activeSectionDef.name);
    }
  }, [lockOn, activeSectionDef, currentSection]);

  // Section locking: re-sync once per attempt on mount (refresh / app
  // restart / tampered local state adopt the server's progress).
  const syncedAttemptRef = useRef<string | null>(null);
  useEffect(() => {
    const attemptId = currentAttempt?.attemptId;
    if (!attemptId || syncedAttemptRef.current === attemptId) return;
    syncedAttemptRef.current = attemptId;

    let cancelled = false;
    (async () => {
      const result = await resyncGuestProgress();
      if (cancelled || !result.finalized) return;
      router.replace(`/guest-quiz/${shareToken}/result` as any);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAttempt?.attemptId, shareToken]);

  useEffect(() => {
    if (currentAttempt?.answers) {
      const answer = currentAttempt.answers.find(a => a.questionIndex === currentQuestionIndex);
      const questionType = quizData?.questions[currentQuestionIndex]?.questionType;
      if (answer && isResponseAnswered(questionType || 'mcq_single', answer.selectedAnswer as StudentResponse)) {
        setSelectedAnswer(answer.selectedAnswer as StudentResponse);
        setMarkedForReview(answer.markedForReview);
      } else {
        setSelectedAnswer(defaultResponseFor(questionType));
        setMarkedForReview(answer?.markedForReview || false);
      }
    }
    setQuestionStartTime(Date.now());

    // Auto-update section tab based on current question (non-locking path)
    if (!lockOn && quizData) {
      const question = quizData.questions[currentQuestionIndex];
      const subject = question.subjectName || 'Uncategorized';
      if (subject !== 'Uncategorized' && subject !== currentSection) {
        setCurrentSection(subject);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestionIndex, currentAttempt, quizData]);

  const handleBackPress = () => {
    Alert.alert(
      'Exit Quiz?',
      lockOn
        ? 'Your progress is saved, but section timers keep running. Are you sure you want to exit?'
        : 'Your progress is saved. Are you sure you want to exit?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => router.back() }
      ]
    );
  };

  const handleTimeUp = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);

    // Section locking: submit the active section; the server's response
    // either advances to the next section or finalizes the whole attempt.
    if (lockOn && activeSectionIndex >= 0) {
      try {
        const result = await submitGuestSection(activeSectionIndex, true);
        const finalized = result?.attemptFinalized === true || result?.submitted === true;
        if (finalized) {
          Alert.alert('Time Up!', 'The test time has ended. Your answers have been submitted.', [
            { text: 'View Results', onPress: () => router.replace(`/guest-quiz/${shareToken}/result` as any) }
          ]);
        } else {
          Alert.alert(
            'Section Time Up',
            `"${result?.nextSection?.name ?? 'The next section'}" has started. The previous section has been submitted and locked.`
          );
        }
      } catch (error) {
        console.error('Guest section auto-submit error:', error);
        Alert.alert('Section Time Up', 'The section time has ended. Your answers are being submitted.');
      }
      return;
    }

    Alert.alert('Time Up!', 'Submitting your answers...');
    await handleSubmit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockOn, activeSectionIndex, submitGuestSection, shareToken]);

  const handleResponseChange = async (response: StudentResponse) => {
    setSelectedAnswer(response);
    const timeSpent = Math.floor((Date.now() - questionStartTime) / 1000);
    const questionId = quizData?.questions[currentQuestionIndex]?._id;
    await saveGuestAnswer(currentQuestionIndex, response, markedForReview, timeSpent, questionId);
  };

  const handleMarkForReview = async () => {
    const newState = !markedForReview;
    setMarkedForReview(newState);
    const timeSpent = Math.floor((Date.now() - questionStartTime) / 1000);
    const questionId = quizData?.questions[currentQuestionIndex]?._id;
    await saveGuestAnswer(currentQuestionIndex, selectedAnswer, newState, timeSpent, questionId);
  };

  const handleNextQuestion = async () => {
    const canAdvance = lockOn
      ? currentQuestionPosition >= 0 && currentQuestionPosition < (activeQuestionIndexes?.length ?? 0) - 1
      : !!quizData && currentQuestionIndex < quizData.questions.length - 1;

    if (canAdvance) {
      // Save current progress/time before moving
      const timeSpent = Math.floor((Date.now() - questionStartTime) / 1000);
      const questionId = quizData?.questions[currentQuestionIndex]?._id;
      try {
        await saveGuestAnswer(currentQuestionIndex, selectedAnswer, markedForReview, timeSpent, questionId);
      } catch (err) {
        console.error('Save failed on guest skip:', err);
      }

      setCurrentQuestionIndex(prev =>
        lockOn && activeQuestionIndexes
          ? activeQuestionIndexes[currentQuestionPosition + 1]
          : prev + 1
      );
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }
  };

  const handlePreviousQuestion = async () => {
    if (currentQuestionPosition <= 0) return;

    // Save current progress/time before moving
    const timeSpent = Math.floor((Date.now() - questionStartTime) / 1000);
    const questionId = quizData?.questions[currentQuestionIndex]?._id;
    try {
      await saveGuestAnswer(currentQuestionIndex, selectedAnswer, markedForReview, timeSpent, questionId);
    } catch (err) {
      console.error('Save failed on guest skip back:', err);
    }

    setCurrentQuestionIndex(prev =>
      lockOn && activeQuestionIndexes
        ? activeQuestionIndexes[currentQuestionPosition - 1]
        : prev - 1
    );
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
  };

  const handleSectionChange = useCallback((section: string) => {
    // Section locking: only the active section is navigable.
    if (lockOn && activeSectionDef && section !== activeSectionDef.name) return;

    setCurrentSection(section);

    if (lockOn && activeSectionDef) {
      const indexes = sectionQuestionIndexesMap[activeSectionDef.name] || [];
      if (indexes.length > 0) {
        setCurrentQuestionIndex(indexes[0]);
        scrollViewRef.current?.scrollTo({ y: 0, animated: false });
      }
      return;
    }

    if (section !== 'All' && quizData) {
      const firstQuestionInSection = quizData.questions.findIndex(
        q => (q.subjectName || 'Uncategorized') === section
      );
      if (firstQuestionInSection !== -1) {
        setCurrentQuestionIndex(firstQuestionInSection);
      }
    }
  }, [lockOn, activeSectionDef, sectionQuestionIndexesMap, quizData]);

  const handleSubmit = async (isAutoSubmit: boolean = false) => {
    // Section locking: submitting the active section (the final section
    // submits the whole quiz through the same server path). There is
    // deliberately no "end entire quiz early" action when locking is on.
    if (lockOn && activeSectionIndex >= 0) {
      Alert.alert(
        isLastSection ? 'Submit Quiz?' : 'Submit Section?',
        isLastSection
          ? 'Are you sure you want to submit? You cannot change answers after submission.'
          : `Submit "${activeSectionDef?.name ?? 'this section'}"? You cannot return to this section after submitting.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: isLastSection ? 'Submit' : 'Submit Section',
            style: 'destructive',
            onPress: async () => {
              setSubmitting(true);
              try {
                const result = await submitGuestSection(activeSectionIndex, false);
                if (result?.attemptFinalized === true || result?.submitted === true) {
                  router.replace(`/guest-quiz/${shareToken}/result` as any);
                }
                // Otherwise the context adopted the next section's state; the
                // effects above re-center the UI on it.
              } catch (error) {
                // Context already surfaced manual-submit errors via Alert.
              } finally {
                setSubmitting(false);
              }
            }
          }
        ]
      );
      return;
    }

    if (!isAutoSubmit) {
      Alert.alert(
        'Submit Quiz?',
        'Are you sure you want to submit? You cannot change answers after submission.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit', style: 'destructive', onPress: () => performSubmit() }
        ]
      );
    } else {
      await performSubmit();
    }
  };

  const performSubmit = async () => {
    setSubmitting(true);
    try {
      if (timerRef.current) clearInterval(timerRef.current);
      await submitGuestQuiz();
      router.replace(`/guest-quiz/${shareToken}/result` as any);
    } catch (error) {
      Alert.alert('Error', 'Failed to submit quiz. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!quizData || !currentAttempt) {
    return (
      <FullScreenContainer style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      </FullScreenContainer>
    );
  }

  const currentQuestion = quizData.questions[currentQuestionIndex];
  const totalInScope = lockOn ? (activeQuestionIndexes?.length ?? 0) : quizData.questions.length;

  return (
    <FullScreenContainer style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.guestBadge}>
            <Text style={styles.guestBadgeText}>Guest</Text>
          </View>
          <Text style={styles.quizTitle} numberOfLines={1}>{quizData.title}</Text>
        </View>
        <View style={[
          styles.timerBadge,
          timeRemaining < 300 && styles.timerWarning
        ]}>
          <Clock size={16} color={timeRemaining < 300 ? '#ef4444' : '#6366f1'} />
          <Text style={[
            styles.timerText,
            timeRemaining < 300 && styles.timerTextWarning
          ]}>
            {formatTime(timeRemaining)}
          </Text>
        </View>
      </View>

      {/* Section Tabs */}
      <SectionTabs
        sections={sections}
        currentSection={currentSection}
        onSectionChange={handleSectionChange}
        questionCounts={questionCounts}
        sectionStatuses={sectionStatuses}
      />

      {/* Question Content */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        {/* Question Header */}
        <View style={styles.questionHeader}>
          <Text style={styles.questionNumber}>
            Question {Math.max(currentQuestionPosition, 0) + 1} of {totalInScope || quizData.questions.length}
          </Text>
          <View style={styles.marksBadge}>
            <Text style={styles.marksText}>{currentQuestion.marks || 1} marks</Text>
          </View>
        </View>

        {/* Question Text */}
        <Text style={styles.questionText}>
          {currentQuestion.questionText}
        </Text>

        {/* Question Image */}
        {currentQuestion.questionImage && (
          <Image
            source={getImageUrl(currentQuestion.questionImage)}
            style={styles.questionImage}
            resizeMode="contain"
          />
        )}

        {/* Answer Input (adapts to question type) */}
        <QuestionPrompt
          question={currentQuestion}
          response={selectedAnswer}
          onChange={handleResponseChange}
          getImageUrl={getImageUrl}
          failedImages={failedImages}
          onImageError={handleImageError}
        />

        {/* Clear Response */}
        {isResponseAnswered(currentQuestion.questionType || 'mcq_single', selectedAnswer) && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={() => handleResponseChange(defaultResponseFor(currentQuestion.questionType))}
          >
            <Text style={styles.clearButtonText}>Clear Response</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={[
            styles.navButton,
            styles.markButton,
            markedForReview && styles.markedButton
          ]}
          onPress={handleMarkForReview}
        >
          <Flag
            size={18}
            color={markedForReview ? '#ffffff' : '#a855f7'}
            fill={markedForReview ? '#ffffff' : 'none'}
          />
        </TouchableOpacity>

        <View style={styles.navButtonGroup}>
          <TouchableOpacity
            style={[styles.navButton, styles.prevButton]}
            onPress={handlePreviousQuestion}
            disabled={currentQuestionPosition <= 0}
          >
            <ChevronLeft
              size={20}
              color={currentQuestionPosition <= 0 ? '#9ca3af' : '#6366f1'}
            />
            <Text style={[
              styles.navButtonText,
              currentQuestionPosition <= 0 && styles.disabledText
            ]}>Prev</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navButton, styles.nextButton]}
            onPress={handleNextQuestion}
            disabled={currentQuestionPosition === -1 || currentQuestionPosition >= totalInScope - 1}
          >
            <Text style={[
              styles.navButtonText,
              (currentQuestionPosition === -1 || currentQuestionPosition >= totalInScope - 1) && styles.disabledText
            ]}>Next</Text>
            <ChevronRight
              size={20}
              color={(currentQuestionPosition === -1 || currentQuestionPosition >= totalInScope - 1) ? '#9ca3af' : '#6366f1'}
            />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.navButton, styles.submitButton]}
          onPress={() => handleSubmit(false)}
          disabled={submitting || isLoading}
        >
          {submitting || isLoading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.submitButtonText}>
              {lockOn && !isLastSection ? 'Submit Section' : 'Submit'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </FullScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 12,
  },
  guestBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  guestBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#92400e',
  },
  quizTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#eef2ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  timerWarning: {
    backgroundColor: '#fef2f2',
  },
  timerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#6366f1',
    fontVariant: ['tabular-nums'],
  },
  timerTextWarning: {
    color: '#ef4444',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  questionNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
  },
  marksBadge: {
    backgroundColor: '#d1fae5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  marksText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#065f46',
  },
  questionText: {
    fontSize: 16,
    color: '#111827',
    lineHeight: 24,
    marginBottom: 20,
  },
  questionImage: {
    width: '100%',
    height: 200,
    marginBottom: 20,
    borderRadius: 8,
  },
  optionsContainer: {
    gap: 12,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e5e7eb',
  },
  selectedOption: {
    borderColor: '#6366f1',
    backgroundColor: '#eef2ff',
  },
  optionRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#d1d5db',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  selectedRadio: {
    borderColor: '#6366f1',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#6366f1',
  },
  optionContent: {
    flex: 1,
    flexDirection: 'row',
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
    marginRight: 8,
  },
  optionText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  selectedOptionText: {
    color: '#111827',
    fontWeight: '500',
  },
  optionImage: {
    width: '100%',
    height: 120,
    marginTop: 8,
    borderRadius: 8,
  },
  clearButton: {
    marginTop: 16,
    alignSelf: 'flex-start',
  },
  clearButtonText: {
    fontSize: 14,
    color: '#6b7280',
    textDecorationLine: 'underline',
  },
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    gap: 8,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 4,
  },
  markButton: {
    backgroundColor: '#faf5ff',
    borderWidth: 1,
    borderColor: '#e9d5ff',
  },
  markedButton: {
    backgroundColor: '#a855f7',
    borderColor: '#a855f7',
  },
  navButtonGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  prevButton: {
    backgroundColor: '#f3f4f6',
  },
  nextButton: {
    backgroundColor: '#f3f4f6',
  },
  navButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6366f1',
  },
  disabledText: {
    color: '#9ca3af',
  },
  submitButton: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 16,
  },
  submitButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
});
