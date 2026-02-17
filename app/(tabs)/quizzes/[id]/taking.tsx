import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  StatusBar,
  BackHandler,
  Animated,
  Dimensions,
  AccessibilityInfo,
  Image
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, Flag, AlertCircle } from 'lucide-react-native';
import { api } from '@/services/api';
import { useQuiz } from '@/context/QuizContext';
import { QuizTimer } from '@/components/QuizTimer';
import { QuestionNavigationGrid } from '@/components/QuestionNavigationGrid';
import { SectionTabs } from '@/components/SectionTabs';
import { QuestionSkeleton } from '@/components/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { getSocketURL } from '@/services/config';
import { formatToIST } from '@/utils/date';

interface Question {
  _id: string;
  question: string;
  questionImage?: string;
  options: string[];
  optionImages?: string[];
  marks: number;
  subject?: {
    _id: string;
    name: string;
  };
}

interface Quiz {
  _id: string;
  title: string;
  subject: string;
  duration: number;
  totalMarks: number;
  questions: Question[];
  expiryDate?: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function QuizTakingContent() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { currentAttempt, saveAnswer, submitQuiz, isLoading: quizLoading } = useQuiz();

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number>(-1);
  const [markedForReview, setMarkedForReview] = useState(false);
  const [currentSection, setCurrentSection] = useState<string>('All');
  const [questionStartTime, setQuestionStartTime] = useState(Date.now());
  const [showNavigationGrid, setShowNavigationGrid] = useState(SCREEN_WIDTH > 768);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const buttonScaleAnim = useRef(new Animated.Value(1)).current;

  const scrollViewRef = useRef<ScrollView>(null);

  // Helper to resolve image URLs (handles relative paths from backend)
  const getImageUrl = useCallback((path?: string) => {
    if (!path) return undefined;
    if (path.startsWith('http') || path.startsWith('https') || path.startsWith('file://') || path.startsWith('data:')) {
      return { uri: path };
    }

    // Prepend base URL for relative paths
    const baseUrl = getSocketURL();
    // Ensure we don't have double slashes if path starts with /
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return { uri: `${baseUrl}${cleanPath}` };
  }, []);

  // Handle image load errors gracefully
  const handleImageError = useCallback((url: string) => {
    setFailedImages(prev => new Set(prev).add(url));
  }, []);

  // Helper to safely get subject name with fallback
  const getSubjectName = useCallback((question: Question): string => {
    return question.subject?.name || 'Uncategorized';
  }, []);

  // Memoize filtered questions for performance
  const filteredQuestions = useMemo(() => {
    if (!quiz) return [];
    return currentSection === 'All'
      ? quiz.questions
      : quiz.questions.filter(q => getSubjectName(q) === currentSection);
  }, [quiz, currentSection, getSubjectName]);

  // Memoize sections to avoid recalculation
  const sections = useMemo(() => {
    if (!quiz) return [];
    const subjects = quiz.questions.map(q => getSubjectName(q));
    return ['All', ...Array.from(new Set(subjects))];
  }, [quiz, getSubjectName]);

  // Memoize question statuses
  const questionStatuses = useMemo(() => {
    if (!quiz || !currentAttempt) return [];
    return quiz.questions.map((_, index) => {
      const answer = currentAttempt.answers.find(a => a.questionIndex === index);
      return {
        answered: answer?.selectedAnswer !== -1 && answer?.selectedAnswer !== undefined,
        markedForReview: answer?.markedForReview || false,
        visited: index <= currentQuestionIndex
      };
    });
  }, [quiz, currentAttempt, currentQuestionIndex]);

  // Memoize question counts
  const questionCounts = useMemo(() => {
    if (!quiz) return {};
    return sections.reduce((acc, section) => {
      if (section === 'All') {
        acc[section] = quiz.questions.length;
      } else {
        acc[section] = quiz.questions.filter(q => getSubjectName(q) === section).length;
      }
      return acc;
    }, {} as { [key: string]: number });
  }, [quiz, sections, getSubjectName]);



  useEffect(() => {
    // Animate in on mount
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useEffect(() => {
    if (currentAttempt && currentAttempt.answers) {
      const answer = currentAttempt.answers.find(a => a.questionIndex === currentQuestionIndex);
      if (answer) {
        setSelectedAnswer(answer.selectedAnswer);
        setMarkedForReview(answer.markedForReview);
      } else {
        setSelectedAnswer(-1);
        setMarkedForReview(false);
      }
    }
    setQuestionStartTime(Date.now());
    setSaveError(false);

    // Animate question change
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [currentQuestionIndex, currentAttempt]);

  const fetchQuizDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get(`/quizzes/${id}`);
      setQuiz(response.data);
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Failed to load quiz';
      setError(errorMessage);
      Alert.alert('Error', errorMessage, [
        { text: 'Retry', onPress: fetchQuizDetails },
        { text: 'Go Back', onPress: () => router.back() }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleBackPress = useCallback(() => {
    Alert.alert(
      'Exit Quiz?',
      'Your progress has been saved. Are you sure you want to exit?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => router.back() }
      ]
    );
  }, [router]);

  const handleAnswerSelect = useCallback(async (answerIndex: number) => {
    // Button press animation
    Animated.sequence([
      Animated.timing(buttonScaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(buttonScaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    setSelectedAnswer(answerIndex);
    setSaving(true);
    setSaveError(false);

    const timeSpent = Math.floor((Date.now() - questionStartTime) / 1000);

    try {
      await saveAnswer(currentQuestionIndex, answerIndex, markedForReview, timeSpent);
      // Announce to screen reader
      AccessibilityInfo.announceForAccessibility(`Option ${String.fromCharCode(65 + answerIndex)} selected`);
    } catch (error) {
      setSaveError(true);
      console.error('Save error:', error);
    } finally {
      setSaving(false);
    }
  }, [currentQuestionIndex, markedForReview, questionStartTime, saveAnswer]);

  const handleMarkForReview = useCallback(async () => {
    const newMarkedState = !markedForReview;
    setMarkedForReview(newMarkedState);

    const timeSpent = Math.floor((Date.now() - questionStartTime) / 1000);

    try {
      await saveAnswer(currentQuestionIndex, selectedAnswer, newMarkedState, timeSpent);
      AccessibilityInfo.announceForAccessibility(
        newMarkedState ? 'Question marked for review' : 'Question unmarked'
      );
    } catch (error) {
      console.error('Mark error:', error);
    }
  }, [markedForReview, currentQuestionIndex, selectedAnswer, questionStartTime, saveAnswer]);

  const handleNextQuestion = useCallback(() => {
    if (quiz && currentQuestionIndex < quiz.questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [quiz, currentQuestionIndex]);

  const handlePreviousQuestion = useCallback(() => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [currentQuestionIndex]);

  const handleQuestionSelect = useCallback((index: number) => {
    setCurrentQuestionIndex(index);
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  const handleSubmitQuiz = useCallback(() => {
    Alert.alert(
      'Submit Quiz',
      'Are you sure you want to submit? You cannot change your answers after submission.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await submitQuiz(false);
              router.replace(`/quizzes/${id}/result/${result.attemptId || currentAttempt?.attemptId}`);
            } catch (error) {
              Alert.alert('Error', 'Failed to submit quiz. Please try again.');
            }
          }
        }
      ]
    );
  }, [submitQuiz, id, currentAttempt, router]);

  const handleTimeUp = useCallback(async () => {
    try {
      const result = await submitQuiz(true);
      
      // Handle case where quiz was already submitted
      if (result.isAlreadySubmitted) {
        Alert.alert(
          'Already Submitted',
          'This quiz has already been submitted.',
          [{ 
            text: 'View Results', 
            onPress: () => router.replace(`/quizzes/${id}/result/${result.attemptId || currentAttempt?.attemptId}`)
          }]
        );
        return;
      }

      // Successful auto-submit
      Alert.alert(
        'Time Up!',
        'The test duration has ended. Your answers have been submitted.',
        [{ 
          text: 'View Results',
          onPress: () => router.replace(`/quizzes/${id}/result/${result.attemptId || currentAttempt?.attemptId}`)
        }]
      );
    } catch (error: any) {
      console.error('Auto-submit error:', error);
      
      // Show specific error message from backend if available
      const errorMessage = error.response?.data?.message || 'Failed to auto-submit. Please submit manually.';
      const errorCode = error.response?.data?.errorCode;
      
      // Handle specific error cases
      if (errorCode === 'ATTEMPT_NOT_FOUND') {
        Alert.alert(
          'Error',
          'Your quiz attempt could not be found. Your progress may have been lost.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      } else if (errorCode === 'QUIZ_NOT_FOUND') {
        Alert.alert(
          'Error',
          'This quiz no longer exists. Your attempt could not be submitted.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      } else {
        // Generic error - allow manual submission
        Alert.alert(
          'Auto-Submit Failed',
          errorMessage + '\n\nPlease try submitting manually using the Submit button.',
          [{ text: 'OK' }]
        );
      }
    }
  }, [submitQuiz, id, currentAttempt, router]);

  const handleSectionChange = useCallback((section: string) => {
    setCurrentSection(section);

    if (section !== 'All' && quiz) {
      const firstQuestionInSection = quiz.questions.findIndex(
        q => getSubjectName(q) === section
      );
      if (firstQuestionInSection !== -1) {
        setCurrentQuestionIndex(firstQuestionInSection);
      }
    }
  }, [quiz, getSubjectName]);

  useEffect(() => {
    // Fetch quiz details only on mount/id change
    fetchQuizDetails();
  }, [id]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBackPress();
      return true;
    });

    // Announce screen to screen readers
    AccessibilityInfo.announceForAccessibility('Quiz taking screen loaded');

    // Tab switch detection (Web only)
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        // Log tab switch to backend
        if (currentAttempt?.attemptId) {
          api.post(`/quizzes/${id}/attempt/${currentAttempt.attemptId}/tab-switch`)
            .catch(console.error);
        }

        // Show warning
        Alert.alert(
          '⚠️ Warning',
          'Tab switching is not allowed during the test! This activity has been logged.',
          [{ text: 'OK' }]
        );
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      backHandler.remove();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [currentAttempt, handleBackPress, id]);

  // Loading state
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.loadingText}>Loading quiz...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error || !quiz || !currentAttempt) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <AlertCircle color="#EF4444" size={64} />
          <Text style={styles.errorText}>{error || 'Failed to load quiz'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchQuizDetails}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const currentQuestion = quiz.questions[currentQuestionIndex];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text
            style={styles.quizTitle}
            numberOfLines={1}
            accessible={true}
            accessibilityLabel={`Quiz: ${quiz.title}`}
          >
            {quiz.title}
          </Text>
          {quiz.expiryDate && (
            <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
              Ends: {formatToIST(quiz.expiryDate)}
            </Text>
          )}
        </View>
        <View style={styles.headerRight}>
          {currentAttempt && (
            <QuizTimer
              duration={quiz.duration}
              startTime={currentAttempt.startTime}
              onTimeUp={handleTimeUp}
            />
          )}
        </View>
      </View>

      {/* Save Status Indicator */}
      {saving && (
        <View style={styles.savingIndicator}>
          <ActivityIndicator size="small" color="#2563EB" />
          <Text style={styles.savingText}>Saving...</Text>
        </View>
      )}
      {saveError && (
        <View style={styles.errorIndicator}>
          <AlertCircle color="#EF4444" size={16} />
          <Text style={styles.errorIndicatorText}>Save failed - will retry</Text>
        </View>
      )}

      {/* Section Tabs */}
      <SectionTabs
        sections={sections}
        currentSection={currentSection}
        onSectionChange={handleSectionChange}
        questionCounts={questionCounts}
      />

      <View style={styles.mainContent}>
        {/* Question Area */}
        <View style={styles.questionAreaWrapper}>
          <ScrollView
            ref={scrollViewRef}
            style={styles.questionArea}
            contentContainerStyle={styles.questionContentContainer}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.questionContainer}>
              {/* Question Header */}
              <View style={styles.questionHeader}>
                <Text style={styles.questionNumber}>
                  Question {currentQuestionIndex + 1} of {quiz.questions.length}
                </Text>
                <View style={styles.badges}>
                  <View style={styles.sectionBadge}>
                    <Text style={styles.badgeText}>{getSubjectName(currentQuestion)}</Text>
                  </View>
                  <View style={styles.marksBadge}>
                    <Text style={styles.badgeText}>{currentQuestion.marks} marks</Text>
                  </View>
                </View>
              </View>

              {/* Question Text */}
              <Text style={styles.questionText}>
                {currentQuestion.question}
              </Text>

              {/* Question Image */}
              {currentQuestion.questionImage && !failedImages.has(currentQuestion.questionImage) && (
                <Image
                  source={getImageUrl(currentQuestion.questionImage)}
                  style={styles.questionImage}
                  resizeMode="contain"
                  onError={() => handleImageError(currentQuestion.questionImage!)}
                />
              )}

              {/* Options */}
              <View style={styles.optionsContainer}>
                {currentQuestion.options.map((option, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.optionButton,
                      selectedAnswer === index && styles.selectedOption
                    ]}
                    onPress={() => handleAnswerSelect(index)}
                    activeOpacity={0.7}
                  >
                    <View style={[
                      styles.optionRadio,
                      selectedAnswer === index && styles.selectedRadio
                    ]}>
                      {selectedAnswer === index && <View style={styles.radioInner} />}
                    </View>
                    <View style={styles.optionContent}>
                      <Text style={styles.optionLabel}>
                        {String.fromCharCode(65 + index)}.
                      </Text>
                      <View style={{ flex: 1 }}>
                        {option ? (
                          <Text style={[
                            styles.optionText,
                            selectedAnswer === index && styles.selectedOptionText
                          ]}>
                            {option}
                          </Text>
                        ) : null}

                        {currentQuestion.optionImages?.[index] && !failedImages.has(currentQuestion.optionImages[index]) && (
                          <Image
                            source={getImageUrl(currentQuestion.optionImages[index])}
                            style={styles.optionImage}
                            resizeMode="contain"
                            onError={() => handleImageError(currentQuestion.optionImages![index])}
                          />
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Clear Response */}
              {selectedAnswer !== -1 && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={() => handleAnswerSelect(-1)}
                >
                  <Text style={styles.clearButtonText}>Clear Response</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Spacer for bottom nav */}
            <View style={{ height: 100 }} />
          </ScrollView>
        </View>

        {/* Navigation Grid (Right Sidebar on tablet) */}
        {showNavigationGrid && SCREEN_WIDTH > 768 && (
          <View style={styles.navigationGridContainer}>
            <QuestionNavigationGrid
              totalQuestions={quiz.questions.length}
              currentQuestion={currentQuestionIndex}
              questionStatuses={questionStatuses}
              onQuestionSelect={handleQuestionSelect}
            />
          </View>
        )}
      </View>

      {/* Bottom Navigation */}
      <View style={styles.bottomNavWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.bottomNavScroll}
        >
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
                color={markedForReview ? '#FFFFFF' : '#A855F7'}
                size={20}
                fill={markedForReview ? '#FFFFFF' : 'none'}
              />
              <Text style={[
                styles.navButtonText,
                markedForReview && styles.markedButtonText
              ]}>
                {markedForReview ? 'Marked' : 'Mark Review'}
              </Text>
            </TouchableOpacity>

            <View style={styles.navButtonGroup}>
              <TouchableOpacity
                style={[styles.navButton, styles.prevButton]}
                onPress={handlePreviousQuestion}
                disabled={currentQuestionIndex === 0}
              >
                <ChevronLeft color={currentQuestionIndex === 0 ? '#9CA3AF' : '#2563EB'} size={20} />
                <Text style={[
                  styles.navButtonText,
                  currentQuestionIndex === 0 && styles.disabledText
                ]}>
                  Prev
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.navButton, styles.nextButton]}
                onPress={handleNextQuestion}
                disabled={currentQuestionIndex === quiz.questions.length - 1}
              >
                <Text style={[
                  styles.navButtonText,
                  currentQuestionIndex === quiz.questions.length - 1 && styles.disabledText
                ]}>
                  Next
                </Text>
                <ChevronRight
                  color={currentQuestionIndex === quiz.questions.length - 1 ? '#9CA3AF' : '#2563EB'}
                  size={20}
                />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.navButton, styles.submitButton]}
              onPress={handleSubmitQuiz}
              disabled={quizLoading}
            >
              <Text style={styles.submitButtonText}>Submit</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// Wrap with error boundary
export default function QuizTaking() {
  return (
    <ErrorBoundary>
      <QuizTakingContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerLeft: {
    flex: 1,
    marginRight: 16,
  },
  quizTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  headerRight: {
    flexShrink: 0,
  },
  savingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EBF5FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#2563EB',
  },
  savingText: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '500',
  },
  errorIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#EF4444',
  },
  errorIndicatorText: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '500',
  },
  mainContent: {
    flex: 1,
    flexDirection: 'row',
  },
  questionAreaWrapper: {
    flex: 1,
  },
  questionArea: {
    flex: 1,
  },
  questionContainer: {
    padding: 20,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  questionNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
  },
  badges: {
    flexDirection: 'row',
    gap: 8,
  },
  sectionBadge: {
    backgroundColor: '#EBF5FF',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  marksBadge: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    color: '#1F2937',
    fontWeight: '500',
  },
  questionText: {
    fontSize: 16,
    color: '#1F2937',
    lineHeight: 24,
    marginBottom: 24,
  },
  optionsContainer: {
    gap: 12,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    minHeight: 56, // Accessibility: minimum touch target
  },
  selectedOption: {
    borderColor: '#2563EB',
    backgroundColor: '#EBF5FF',
  },
  optionRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  selectedRadio: {
    borderColor: '#2563EB',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#2563EB',
  },
  optionContent: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  optionText: {
    flex: 1,
    fontSize: 16,
    color: '#4B5563',
    lineHeight: 22,
  },
  selectedOptionText: {
    color: '#1F2937',
    fontWeight: '500',
  },
  clearButton: {
    marginTop: 16,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 8,
    minHeight: 48, // Accessibility
  },
  clearButtonText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },
  navigationGridContainer: {
    width: 280,
    backgroundColor: '#FFFFFF',
    borderLeftWidth: 1,
    borderLeftColor: '#E5E7EB',
  },
  questionContentContainer: {
    paddingBottom: 20,
  },
  bottomNavWrapper: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  bottomNavScroll: {
    paddingHorizontal: 12,
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
    minHeight: 72,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
    minHeight: 44,
  },
  navButtonGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  markButton: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#A855F7',
  },
  markedButton: {
    backgroundColor: '#A855F7',
    borderColor: '#A855F7',
  },
  prevButton: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  nextButton: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  submitButton: {
    backgroundColor: '#10B981',
  },
  navButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
  },
  markedButtonText: {
    color: '#FFFFFF',
  },
  submitButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  disabledText: {
    color: '#9CA3AF',
  },
  questionImage: {
    width: '100%',
    height: 200,
    marginBottom: 20,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  optionImage: {
    width: '100%',
    height: 150,
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
});
