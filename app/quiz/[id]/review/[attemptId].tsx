import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  StatusBar
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CheckCircle, XCircle, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { api } from '@/services/api';
import { SectionTabs } from '@/components/SectionTabs';

interface QuestionResult {
  questionIndex: number;
  question: string;
  options: string[];
  selectedAnswer: number;
  correctAnswer: number;
  isCorrect: boolean;
  markedForReview: boolean;
  timeSpent: number;
  explanation: string;
  marks: number;
  section: string;
}

interface ReviewData {
  attemptId: string;
  quiz: {
    title: string;
    subject: string;
    totalQuestions: number;
    totalMarks: number;
  };
  score: number;
  marksObtained: number;
  percentage: number;
  detailedResults: QuestionResult[];
}

export default function QuizReview() {
  const { id, attemptId } = useLocalSearchParams();
  const router = useRouter();
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [currentSection, setCurrentSection] = useState<string>('All');

  useEffect(() => {
    fetchReviewData();
  }, []);

  const fetchReviewData = async () => {
    try {
      const response = await api.get(`/quizzes/${id}/attempt/${attemptId}/results`);
      setReviewData(response.data);
    } catch (error: any) {
      Alert.alert('Error', 'Failed to load review data');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#2563EB" />
      </SafeAreaView>
    );
  }

  if (!reviewData) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Review data not found</Text>
      </SafeAreaView>
    );
  }

  const sections = Array.from(new Set(reviewData.detailedResults.map(q => q.section)));
  const filteredQuestions = currentSection === 'All'
    ? reviewData.detailedResults
    : reviewData.detailedResults.filter(q => q.section === currentSection);

  const currentQuestion = filteredQuestions[currentQuestionIndex];
  
  const questionCounts = sections.reduce((acc, section) => {
    acc[section] = reviewData.detailedResults.filter(q => q.section === section).length;
    return acc;
  }, {} as { [key: string]: number });

  const handleNext = () => {
    if (currentQuestionIndex < filteredQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  const handleSectionChange = (section: string) => {
    setCurrentSection(section);
    setCurrentQuestionIndex(0);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>{reviewData.quiz.title}</Text>
          <Text style={styles.subtitle}>Solutions & Explanations</Text>
        </View>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>{reviewData.score}/{reviewData.quiz.totalQuestions}</Text>
          <Text style={styles.scoreLabel}>Score</Text>
        </View>
      </View>

      {/* Section Tabs */}
      <SectionTabs
        sections={sections}
        currentSection={currentSection}
        onSectionChange={handleSectionChange}
        questionCounts={questionCounts}
      />

      {/* Question Review */}
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.questionContainer}>
          {/* Question Header */}
          <View style={styles.questionHeader}>
            <View style={styles.questionMeta}>
              <Text style={styles.questionNumber}>
                Question {currentQuestion.questionIndex + 1}
              </Text>
              <View style={styles.badges}>
                <View style={styles.sectionBadge}>
                  <Text style={styles.badgeText}>{currentQuestion.section}</Text>
                </View>
                <View style={styles.marksBadge}>
                  <Text style={styles.badgeText}>{currentQuestion.marks} marks</Text>
                </View>
              </View>
            </View>
            
            {/* Result Icon */}
            <View style={[
              styles.resultIcon,
              currentQuestion.isCorrect ? styles.correctIcon : styles.incorrectIcon
            ]}>
              {currentQuestion.isCorrect ? (
                <CheckCircle color="#10B981" size={32} />
              ) : (
                <XCircle color="#EF4444" size={32} />
              )}
            </View>
          </View>

          {/* Question Text */}
          <Text style={styles.questionText}>{currentQuestion.question}</Text>

          {/* Options */}
          <View style={styles.optionsContainer}>
            {currentQuestion.options.map((option, index) => {
              const isSelected = currentQuestion.selectedAnswer === index;
              const isCorrect = currentQuestion.correctAnswer === index;
              const isWrongSelection = isSelected && !isCorrect;

              return (
                <View
                  key={index}
                  style={[
                    styles.optionContainer,
                    isCorrect && styles.correctOption,
                    isWrongSelection && styles.wrongOption
                  ]}
                >
                  <View style={styles.optionLeft}>
                    <View style={[
                      styles.optionIndicator,
                      isCorrect && styles.correctIndicator,
                      isWrongSelection && styles.wrongIndicator
                    ]}>
                      {isCorrect && <CheckCircle color="#10B981" size={20} />}
                      {isWrongSelection && <XCircle color="#EF4444" size={20} />}
                      {!isCorrect && !isWrongSelection && (
                        <Text style={styles.optionLabel}>
                          {String.fromCharCode(65 + index)}
                        </Text>
                      )}
                    </View>
                    <Text style={[
                      styles.optionText,
                      (isCorrect || isWrongSelection) && styles.highlightedText
                    ]}>
                      {option}
                    </Text>
                  </View>

                  {isCorrect && (
                    <View style={styles.correctBadge}>
                      <Text style={styles.correctBadgeText}>Correct Answer</Text>
                    </View>
                  )}
                  {isWrongSelection && (
                    <View style={styles.wrongBadge}>
                      <Text style={styles.wrongBadgeText}>Your Answer</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Not Answered */}
          {currentQuestion.selectedAnswer === -1 && (
            <View style={styles.notAnsweredCard}>
              <Text style={styles.notAnsweredText}>
                ⚠️ You did not answer this question
              </Text>
            </View>
          )}

          {/* Explanation */}
          {currentQuestion.explanation && (
            <View style={styles.explanationContainer}>
              <Text style={styles.explanationTitle}>💡 Explanation</Text>
              <View style={styles.explanationBox}>
                <Text style={styles.explanationText}>{currentQuestion.explanation}</Text>
              </View>
            </View>
          )}

          {/* Stats */}
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Time Spent</Text>
              <Text style={styles.statValue}>
                {Math.floor(currentQuestion.timeSpent / 60)}m {currentQuestion.timeSpent % 60}s
              </Text>
            </View>
            {currentQuestion.markedForReview && (
              <View style={styles.statItem}>
                <Text style={[styles.statLabel, styles.markedLabel]}>
                  🏴 Marked for Review
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={[styles.navButton, currentQuestionIndex === 0 && styles.disabledButton]}
          onPress={handlePrevious}
          disabled={currentQuestionIndex === 0}
        >
          <ChevronLeft 
            color={currentQuestionIndex === 0 ? '#9CA3AF' : '#2563EB'} 
            size={20} 
          />
          <Text style={[
            styles.navButtonText,
            currentQuestionIndex === 0 && styles.disabledText
          ]}>
            Previous
          </Text>
        </TouchableOpacity>

        <Text style={styles.progressText}>
          {currentQuestionIndex + 1} / {filteredQuestions.length}
        </Text>

        <TouchableOpacity
          style={[
            styles.navButton,
            currentQuestionIndex === filteredQuestions.length - 1 && styles.disabledButton
          ]}
          onPress={handleNext}
          disabled={currentQuestionIndex === filteredQuestions.length - 1}
        >
          <Text style={[
            styles.navButtonText,
            currentQuestionIndex === filteredQuestions.length - 1 && styles.disabledText
          ]}>
            Next
          </Text>
          <ChevronRight 
            color={currentQuestionIndex === filteredQuestions.length - 1 ? '#9CA3AF' : '#2563EB'} 
            size={20} 
          />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
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
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  subtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  scoreContainer: {
    alignItems: 'center',
    backgroundColor: '#EBF5FF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2563EB',
  },
  scoreLabel: {
    fontSize: 11,
    color: '#6B7280',
  },
  scrollView: {
    flex: 1,
  },
  questionContainer: {
    padding: 20,
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  questionMeta: {
    flex: 1,
  },
  questionNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
    marginBottom: 8,
  },
  badges: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
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
  resultIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  correctIcon: {
    backgroundColor: '#D1FAE5',
  },
  incorrectIcon: {
    backgroundColor: '#FEE2E2',
  },
  questionText: {
    fontSize: 16,
    color: '#1F2937',
    lineHeight: 24,
    marginBottom: 20,
  },
  optionsContainer: {
    gap: 12,
    marginBottom: 20,
  },
  optionContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  correctOption: {
    borderColor: '#10B981',
    backgroundColor: '#ECFDF5',
  },
  wrongOption: {
    borderColor: '#EF4444',
    backgroundColor: '#FEF2F2',
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  optionIndicator: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  correctIndicator: {
    backgroundColor: '#D1FAE5',
  },
  wrongIndicator: {
    backgroundColor: '#FEE2E2',
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  optionText: {
    flex: 1,
    fontSize: 15,
    color: '#4B5563',
    lineHeight: 22,
  },
  highlightedText: {
    color: '#1F2937',
    fontWeight: '500',
  },
  correctBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  correctBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  wrongBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  wrongBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  notAnsweredCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  notAnsweredText: {
    color: '#92400E',
    fontSize: 14,
    fontWeight: '600',
  },
  explanationContainer: {
    marginBottom: 20,
  },
  explanationTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 12,
  },
  explanationBox: {
    backgroundColor: '#EBF5FF',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#2563EB',
  },
  explanationText: {
    fontSize: 14,
    color: '#1F2937',
    lineHeight: 22,
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
  },
  statItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  markedLabel: {
    color: '#A855F7',
    fontWeight: '600',
  },
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  disabledButton: {
    borderColor: '#E5E7EB',
  },
  navButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
  },
  disabledText: {
    color: '#9CA3AF',
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
  },
});
