import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Image
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, Flag, Clock, AlertCircle } from 'lucide-react-native';
import { useGuestQuiz } from '@/context/GuestQuizContext';
import { getSocketURL } from '@/services/config';

interface Question {
  _id: string;
  questionText: string;
  questionImage?: string;
  options: string[];
  optionImages?: string[];
  marks: number;
}

export default function GuestQuizTaking() {
  const router = useRouter();
  const { shareToken } = useLocalSearchParams<{ shareToken: string }>();
  const { 
    currentAttempt, 
    quizData, 
    saveGuestAnswer, 
    submitGuestQuiz, 
    isLoading 
  } = useGuestQuiz();

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number>(-1);
  const [markedForReview, setMarkedForReview] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  const timerRef = useRef<any>(null);

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

    // Calculate remaining time
    const startTime = new Date(currentAttempt.startTime).getTime();
    const endTime = startTime + (quizData.duration * 60 * 1000);
    const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
    setTimeRemaining(remaining);

    // Start timer
    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          handleTimeUp();
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
  }, [currentAttempt, quizData]);

  useEffect(() => {
    if (currentAttempt?.answers) {
      const answer = currentAttempt.answers.find(a => a.questionIndex === currentQuestionIndex);
      if (answer) {
        setSelectedAnswer(answer.selectedAnswer);
        setMarkedForReview(answer.markedForReview);
      } else {
        setSelectedAnswer(-1);
        setMarkedForReview(false);
      }
    }
  }, [currentQuestionIndex, currentAttempt]);

  const handleBackPress = () => {
    Alert.alert(
      'Exit Quiz?',
      'Your progress is saved. Are you sure you want to exit?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => router.back() }
      ]
    );
  };

  const handleTimeUp = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    Alert.alert('Time Up!', 'Submitting your answers...');
    await handleSubmit(true);
  }, []);

  const handleAnswerSelect = async (answerIndex: number) => {
    setSelectedAnswer(answerIndex);
    await saveGuestAnswer(currentQuestionIndex, answerIndex, markedForReview, 0);
  };

  const handleMarkForReview = async () => {
    const newState = !markedForReview;
    setMarkedForReview(newState);
    await saveGuestAnswer(currentQuestionIndex, selectedAnswer, newState, 0);
  };

  const handleNextQuestion = () => {
    if (quizData && currentQuestionIndex < quizData.questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }
  };

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }
  };

  const handleSubmit = async (isAutoSubmit: boolean = false) => {
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
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      </SafeAreaView>
    );
  }

  const currentQuestion = quizData.questions[currentQuestionIndex];

  return (
    <SafeAreaView style={styles.container}>
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

      {/* Question Content */}
      <ScrollView 
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        {/* Question Header */}
        <View style={styles.questionHeader}>
          <Text style={styles.questionNumber}>
            Question {currentQuestionIndex + 1} of {quizData.questions.length}
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

        {/* Options */}
        <View style={styles.optionsContainer}>
          {currentQuestion.options.map((option: string, index: number) => (
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
                  {option && (
                    <Text style={[
                      styles.optionText,
                      selectedAnswer === index && styles.selectedOptionText
                    ]}>
                      {option}
                    </Text>
                  )}
                  {currentQuestion.optionImages?.[index] && (
                    <Image
                      source={getImageUrl(currentQuestion.optionImages[index])}
                      style={styles.optionImage}
                      resizeMode="contain"
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
            disabled={currentQuestionIndex === 0}
          >
            <ChevronLeft 
              size={20} 
              color={currentQuestionIndex === 0 ? '#9ca3af' : '#6366f1'} 
            />
            <Text style={[
              styles.navButtonText,
              currentQuestionIndex === 0 && styles.disabledText
            ]}>Prev</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navButton, styles.nextButton]}
            onPress={handleNextQuestion}
            disabled={currentQuestionIndex === quizData.questions.length - 1}
          >
            <Text style={[
              styles.navButtonText,
              currentQuestionIndex === quizData.questions.length - 1 && styles.disabledText
            ]}>Next</Text>
            <ChevronRight 
              size={20} 
              color={currentQuestionIndex === quizData.questions.length - 1 ? '#9ca3af' : '#6366f1'} 
            />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.navButton, styles.submitButton]}
          onPress={() => handleSubmit(false)}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.submitButtonText}>Submit</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
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
    padding: 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    gap: 12,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
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
    paddingHorizontal: 20,
  },
  submitButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
});
