import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CheckCircle, XCircle, ChevronLeft, ChevronRight, Clock, Award, BarChart2 } from 'lucide-react-native';
import Svg, { Circle, G, Text as SvgText, Rect } from 'react-native-svg';
import { api } from '@/services/api';
import { SectionTabs } from '@/components/SectionTabs';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface QuestionResult {
  _id: string;
  question: string;
  questionImage?: string;
  questionType?: string;
  options: string[];
  optionImages?: string[];
  assertion?: string;
  reason?: string;
  columnA?: string[];
  columnB?: string[];
  selectedAnswer: any;
  correctAnswer: any;
  isCorrect: boolean;
  markedForReview?: boolean;
  timeSpent?: number;
  explanation?: string;
  explanationImage?: string;
  marks: number;
  section: string;
  questionIndex: number; // Global index
  sectionQuestionIndex?: number; // Index within its section
}

const formatResponseForDisplay = (
  questionType: string | undefined,
  response: any,
  columnA?: string[],
  columnB?: string[]
): string => {
  if (response === undefined || response === null || response === -1) return 'Not answered';
  switch (questionType) {
    case 'multiple_correct':
      return Array.isArray(response) && response.length > 0
        ? response.map((i: number) => String.fromCharCode(65 + i)).join(', ')
        : 'Not answered';
    case 'match_the_following': {
      if (!response || typeof response !== 'object') return 'Not answered';
      const entries = Object.entries(response);
      if (entries.length === 0) return 'Not answered';
      return entries
        .map(([a, b]) => `${Number(a) + 1} → ${String.fromCharCode(65 + Number(b))}`)
        .join(', ');
    }
    case 'numerical':
      return String(response);
    default:
      return typeof response === 'number' ? String.fromCharCode(65 + response) : 'Not answered';
  }
};

interface ReviewData {
  attemptId: string;
  quiz: {
    title: string;
    subject: string;
    totalQuestions: number;
    totalMarks: number;
    shareSolution: boolean;
  };
  score: number;
  marksObtained: number;
  percentage: number;
  detailedResults: QuestionResult[];
}

export default function QuizReview() {
  const { id, attemptId, section: initialSection } = useLocalSearchParams<{ id: string; attemptId: string; section?: string }>();
  const router = useRouter();
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentSection, setCurrentSection] = useState<string>('Overview');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [groupBy, setGroupBy] = useState<'subject' | 'tag' | 'topic'>('subject');
  const [showGroupByDropdown, setShowGroupByDropdown] = useState(false);

  const formatMarks = (value: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return Number(num.toFixed(2)).toString();
  };

  useEffect(() => {
    fetchReviewData();
  }, [groupBy]);

  const fetchReviewData = async () => {
    try {
      const response = await api.get(`/quizzes/${id}/attempt/${attemptId}/results?groupBy=${groupBy}`);
      const data = response.data;

      const formattedReviewData: ReviewData = {
        attemptId: data.attempt._id,
        quiz: {
          title: data.quiz.title,
          subject: typeof data.quiz.subject === 'object' ? data.quiz.subject.name : data.quiz.subject,
          totalQuestions: data.attempt.totalQuestions,
          totalMarks: data.attempt.totalMarks,
          shareSolution: data.quiz.shareSolution !== undefined ? data.quiz.shareSolution : true
        },
        score: data.attempt.score,
        marksObtained: data.attempt.marksObtained,
        percentage: data.attempt.totalMarks > 0
          ? Math.round((data.attempt.marksObtained / data.attempt.totalMarks) * 100)
          : 0,
        detailedResults: data.questions.map((q: any) => {
          let section = 'General';
          if (groupBy === 'subject') {
            section = q.subject?.name || 'General';
          } else if (groupBy === 'tag') {
            section = (q.tags && q.tags.length > 0) ? q.tags[0] : 'Untagged';
          } else {
            section = q.topicName || 'General';
          }

          return {
            ...q,
            questionIndex: q.globalIndex !== undefined ? q.globalIndex : data.questions.indexOf(q),
            section: q.section || section,
            sectionQuestionIndex: q.sectionQuestionIndex,
            selectedAnswer: q.userAnswer,
            options: Array.isArray(q.options) ? q.options : [],
            optionImages: Array.isArray(q.optionImages) ? q.optionImages : []
          };
        })
      };

      setReviewData(formattedReviewData);
        
      if (initialSection) {
        const availableSections = ['Overview', ...Array.from(new Set(formattedReviewData.detailedResults.map(q => q.section)))];
        if (availableSections.includes(initialSection)) {
          setCurrentSection(initialSection);
        }
      }
    } catch (error: any) {
      console.error('Fetch review error:', error);
      Alert.alert('Error', 'Failed to load review data');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <ScreenContainer style={styles.container}>
        <ActivityIndicator size="large" color="#2563EB" />
      </ScreenContainer>
    );
  }

  if (!reviewData) {
    return (
      <ScreenContainer style={styles.container}>
        <Text style={styles.errorText}>Review data not found</Text>
      </ScreenContainer>
    );
  }

  const sections = ['Overview', ...Array.from(new Set(reviewData.detailedResults.map(q => q.section)))];

  const filteredQuestions = currentSection === 'Overview'
    ? reviewData.detailedResults
    : reviewData.detailedResults.filter(q => q.section === currentSection);

  const currentQuestion = filteredQuestions[currentQuestionIndex];

  const questionCounts = sections.reduce((acc, section) => {
    if (section === 'Overview') return acc;
    acc[section] = reviewData.detailedResults.filter(q => q.section === section).length;
    return acc;
  }, {} as { [key: string]: number });

  const correctCount = reviewData.detailedResults.filter(q => q.isCorrect).length;
  const wrongCount = reviewData.detailedResults.filter(q => !q.isCorrect && q.selectedAnswer != null && q.selectedAnswer !== -1).length;
  const skippedCount = reviewData.detailedResults.filter(q => q.selectedAnswer == null || q.selectedAnswer === -1).length;
  const accuracy = reviewData.quiz.totalMarks > 0 ? Math.round((reviewData.marksObtained / reviewData.quiz.totalMarks) * 100) : 0;

  const sectionPerformance = Array.from(new Set(reviewData.detailedResults.map(q => q.section))).map(section => {
    const sectionQs = reviewData.detailedResults.filter(q => q.section === section);
    const correct = sectionQs.filter(q => q.isCorrect).length;
    return {
      name: section,
      total: sectionQs.length,
      correct,
      percentage: (correct / sectionQs.length) * 100
    };
  });

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

  const renderOverview = () => {
    const pieData = [
      { key: 'correct', count: correctCount, color: '#10B981', label: 'Correct' },
      { key: 'wrong', count: wrongCount, color: '#EF4444', label: 'Wrong' },
      { key: 'skipped', count: skippedCount, color: '#F59E0B', label: 'Skipped' }
    ];

    const total = pieData.reduce((acc, item) => acc + item.count, 0);
    let startAngle = 0;

    return (
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.overviewContainer}>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Award color="#2563EB" size={24} />
                <View>
                  <Text style={styles.summaryLabel}>Score</Text>
                  <Text style={styles.summaryValue}>
                    {formatMarks(reviewData.marksObtained)}/{formatMarks(reviewData.quiz.totalMarks)}
                  </Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.summaryItem}>
                <BarChart2 color="#10B981" size={24} />
                <View>
                  <Text style={styles.summaryLabel}>Accuracy</Text>
                  <Text style={styles.summaryValue}>{accuracy}%</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>Overall Performance</Text>
            <View style={styles.pieContainer}>
              <Svg height="200" width="200" viewBox="0 0 200 200">
                <G rotation="-90" origin="100, 100">
                  {pieData.map((slice, index) => {
                    const percentage = total === 0 ? 0 : slice.count / total;
                    const strokeDasharray = 2 * Math.PI * 90;
                    const strokeDashoffset = strokeDasharray * (1 - percentage);
                    const angle = startAngle;
                    startAngle += percentage * 360;

                    if (percentage === 0) return null;

                    return (
                      <Circle
                        key={slice.key}
                        cx="100"
                        cy="100"
                        r="90"
                        stroke={slice.color}
                        strokeWidth="20"
                        fill="transparent"
                        strokeDasharray={strokeDasharray}
                        strokeDashoffset={strokeDashoffset}
                        rotation={angle}
                        origin="100, 100"
                      />
                    );
                  })}
                  {total === 0 && (
                    <Circle cx="100" cy="100" r="90" stroke="#E5E7EB" strokeWidth="20" fill="transparent" />
                  )}
                  <Circle cx="100" cy="100" r="70" fill="white" />
                </G>
                <SvgText x="100" y="95" fill="#1F2937" textAnchor="middle" fontWeight="bold" fontSize="24">
                  {formatMarks(reviewData.marksObtained)}
                </SvgText>
                <SvgText x="100" y="120" fill="#6B7280" textAnchor="middle" fontSize="14">
                  Marks
                </SvgText>
              </Svg>

              <View style={styles.legendContainer}>
                {pieData.map(item => (
                  <View key={item.key} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                    <Text style={styles.legendText}>{item.label} ({item.count})</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.chartCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={styles.chartTitle}>Section Analysis</Text>
              <TouchableOpacity style={styles.filterButton} onPress={() => setShowGroupByDropdown(!showGroupByDropdown)}>
                <Text style={styles.filterButtonText}>
                  {groupBy === 'subject' ? 'By Subject' : groupBy === 'tag' ? 'By Tag' : 'By Topic'}
                </Text>
                <Text style={styles.filterButtonArrow}>▾</Text>
              </TouchableOpacity>
            </View>

            {showGroupByDropdown && (
              <View style={styles.dropdownContainer}>
                <TouchableOpacity style={styles.dropdownItem} onPress={() => { setGroupBy('subject'); setShowGroupByDropdown(false); }}>
                  <Text style={[styles.dropdownText, groupBy === 'subject' && styles.dropdownTextActive]}>By Subject</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.dropdownItem} onPress={() => { setGroupBy('tag'); setShowGroupByDropdown(false); }}>
                  <Text style={[styles.dropdownText, groupBy === 'tag' && styles.dropdownTextActive]}>By Tag</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.dropdownItem} onPress={() => { setGroupBy('topic'); setShowGroupByDropdown(false); }}>
                  <Text style={[styles.dropdownText, groupBy === 'topic' && styles.dropdownTextActive]}>By Topic</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.barChartContainer}>
              {sectionPerformance.map((section, index) => (
                <View key={index} style={styles.barRow}>
                  <View style={styles.barLabelContainer}>
                    <Text style={styles.barLabel} numberOfLines={1}>{section.name}</Text>
                    <Text style={styles.barSubLabel}>{section.correct}/{section.total}</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${section.percentage}%`, backgroundColor: section.percentage > 70 ? '#10B981' : section.percentage > 40 ? '#F59E0B' : '#EF4444' }]} />
                  </View>
                  <Text style={styles.barValue}>{Math.round(section.percentage)}%</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={{ height: 20 }} />
        </View>
      </ScrollView>
    );
  };

  const renderQuestionReview = () => (
    <>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.questionContainer}>
          <View style={styles.questionHeader}>
            <View style={styles.questionMeta}>
              <Text style={styles.questionNumber}>
                Question {currentQuestion.sectionQuestionIndex !== undefined ? currentQuestion.sectionQuestionIndex + 1 : currentQuestionIndex + 1}
                {currentSection !== 'Overview' && (
                  <Text style={{ fontSize: 12, color: '#6B7280' }}> (Section {currentSection})</Text>
                )}
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

            <View style={[styles.resultIcon, currentQuestion.isCorrect ? styles.correctIcon : styles.incorrectIcon ]}>
              {currentQuestion.isCorrect ? (
                <CheckCircle color="#10B981" size={32} />
              ) : (
                <XCircle color="#EF4444" size={32} />
              )}
            </View>
          </View>

          <Text style={styles.questionText}>{currentQuestion.question}</Text>

          {currentQuestion.questionImage ? (
            <Image source={{ uri: currentQuestion.questionImage }} style={styles.questionImage} resizeMode="contain" />
          ) : null}

          {currentQuestion.questionType === 'assertion_reason' && (
            <View style={{ marginBottom: 16 }}>
              <View style={styles.notAnsweredCard}>
                <Text style={styles.notAnsweredText}>Assertion: {currentQuestion.assertion}</Text>
              </View>
              <View style={[styles.notAnsweredCard, { marginTop: 8 }]}>
                <Text style={styles.notAnsweredText}>Reason: {currentQuestion.reason}</Text>
              </View>
            </View>
          )}

          {(currentQuestion.questionType === 'multiple_correct'
            || currentQuestion.questionType === 'match_the_following'
            || currentQuestion.questionType === 'numerical') ? (
            <View style={styles.optionsContainer}>
              <View style={styles.optionContainer}>
                <Text style={styles.optionText}>
                  Your answer: {formatResponseForDisplay(currentQuestion.questionType, currentQuestion.selectedAnswer, currentQuestion.columnA, currentQuestion.columnB)}
                </Text>
              </View>
              {reviewData.quiz.shareSolution && (
                <View style={[styles.optionContainer, styles.correctOption]}>
                  <Text style={styles.optionText}>
                    Correct answer: {formatResponseForDisplay(currentQuestion.questionType, currentQuestion.correctAnswer, currentQuestion.columnA, currentQuestion.columnB)}
                  </Text>
                </View>
              )}
              {currentQuestion.questionType === 'match_the_following' && (
                <View style={styles.optionContainer}>
                  {(currentQuestion.columnA || []).map((a, i) => (
                    <Text key={i} style={styles.optionText}>{i + 1}. {a}</Text>
                  ))}
                  {(currentQuestion.columnB || []).map((b, i) => (
                    <Text key={i} style={styles.optionText}>{String.fromCharCode(65 + i)}. {b}</Text>
                  ))}
                </View>
              )}
            </View>
          ) : (
          <View style={styles.optionsContainer}>
            {(currentQuestion.options || []).map((option, index) => {
              const isSelected = currentQuestion.selectedAnswer === index;
              const isCorrect = reviewData.quiz.shareSolution ? (currentQuestion.correctAnswer === index) : false;
              const isWrongSelection = reviewData.quiz.shareSolution ? (isSelected && !isCorrect) : false;

              return (
                <View key={index} style={[styles.optionContainer, isCorrect && reviewData.quiz.shareSolution && styles.correctOption, isWrongSelection && styles.wrongOption, isSelected && !reviewData.quiz.shareSolution && styles.selectedOption ]}>
                  <View style={styles.optionLeft}>
                    <View style={[ styles.optionIndicator, isCorrect && reviewData.quiz.shareSolution && styles.correctIndicator, isWrongSelection && styles.wrongIndicator ]}>
                      {isCorrect && reviewData.quiz.shareSolution && <CheckCircle color="#10B981" size={20} />}
                      {isWrongSelection && <XCircle color="#EF4444" size={20} />}
                      {!isCorrect && !isWrongSelection && (
                        <Text style={styles.optionLabel}>{String.fromCharCode(65 + index)}</Text>
                      )}
                      {isSelected && !reviewData.quiz.shareSolution && (
                        <Text style={styles.optionLabel}>✓</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionText, (isCorrect || isWrongSelection || isSelected) && styles.highlightedText]}>
                        {option}
                      </Text>
                      {currentQuestion.optionImages?.[index] ? (
                        <Image source={{ uri: currentQuestion.optionImages[index] }} style={styles.optionImage} resizeMode="contain" />
                      ) : null}
                    </View>
                  </View>

                  {isCorrect && reviewData.quiz.shareSolution && (
                    <View style={styles.correctBadge}><Text style={styles.correctBadgeText}>Correct Answer</Text></View>
                  )}
                  {isWrongSelection && (
                    <View style={styles.wrongBadge}><Text style={styles.wrongBadgeText}>Your Answer</Text></View>
                  )}
                  {isSelected && !reviewData.quiz.shareSolution && (
                    <View style={styles.selectedBadge}><Text style={styles.selectedBadgeText}>Your Selection</Text></View>
                  )}
                </View>
              );
            })}
          </View>
          )}

          {currentQuestion.selectedAnswer === -1 && (
            <View style={styles.notAnsweredCard}>
              <Text style={styles.notAnsweredText}>⚠️ You did not answer this question</Text>
            </View>
          )}

          {!reviewData.quiz.shareSolution && (
            <View style={styles.noSolutionCard}>
              <Text style={styles.noSolutionTitle}>📚 Solutions Not Available</Text>
              <Text style={styles.noSolutionText}>
                The instructor has not enabled solution sharing for this quiz.
              </Text>
            </View>
          )}

          {reviewData.quiz.shareSolution && currentQuestion.explanation && (
            <View style={styles.explanationContainer}>
              <Text style={styles.explanationTitle}>💡 Explanation</Text>
              <View style={styles.explanationBox}>
                <Text style={styles.explanationText}>{currentQuestion.explanation}</Text>
              </View>
            </View>
          )}

          {reviewData.quiz.shareSolution && currentQuestion.explanationImage && (
            <Image source={{ uri: currentQuestion.explanationImage }} style={styles.explanationImage} resizeMode="contain" />
          )}

          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Time Spent</Text>
              <Text style={styles.statValue}>
                {Math.floor((currentQuestion.timeSpent || 0) / 60)}m {(currentQuestion.timeSpent || 0) % 60}s
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.bottomNav}>
        <TouchableOpacity style={[styles.navButton, currentQuestionIndex === 0 && styles.disabledButton]} onPress={handlePrevious} disabled={currentQuestionIndex === 0}>
          <ChevronLeft color={currentQuestionIndex === 0 ? '#9CA3AF' : '#2563EB'} size={20} />
          <Text style={[styles.navButtonText, currentQuestionIndex === 0 && styles.disabledText]}>Previous</Text>
        </TouchableOpacity>
        <Text style={styles.progressText}>{currentQuestionIndex + 1} / {filteredQuestions.length}</Text>
        <TouchableOpacity style={[styles.navButton, currentQuestionIndex === filteredQuestions.length - 1 && styles.disabledButton]} onPress={handleNext} disabled={currentQuestionIndex === filteredQuestions.length - 1}>
          <Text style={[styles.navButtonText, currentQuestionIndex === filteredQuestions.length - 1 && styles.disabledText]}>Next</Text>
          <ChevronRight color={currentQuestionIndex === filteredQuestions.length - 1 ? '#9CA3AF' : '#2563EB'} size={20} />
        </TouchableOpacity>
      </View>
    </>
  );

  return (
    <ScreenContainer style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>{reviewData.quiz.title}</Text>
          <Text style={styles.subtitle}>Solutions & Explanations</Text>
        </View>
      </View>

      <SectionTabs
        sections={sections}
        currentSection={currentSection}
        onSectionChange={handleSectionChange}
        questionCounts={questionCounts}
      />

      {currentSection === 'Overview' ? renderOverview() : renderQuestionReview()}
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
  scrollView: {
    flex: 1,
  },
  overviewContainer: {
    padding: 16,
    gap: 16,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  divider: {
    width: 1,
    height: 40,
    backgroundColor: '#E5E7EB',
  },
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 16,
  },
  pieContainer: {
    alignItems: 'center',
    marginTop: 10,
  },
  legendContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
    marginTop: 20,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 14,
    color: '#4B5563',
  },
  barChartContainer: {
    gap: 12,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  barLabelContainer: {
    width: 80,
  },
  barLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
  },
  barSubLabel: {
    fontSize: 11,
    color: '#6B7280',
  },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  barValue: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
    width: 40,
    textAlign: 'right',
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
  selectedOption: {
    borderColor: '#6366f1',
    backgroundColor: '#F5F3FF',
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
  selectedBadge: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  selectedBadgeText: {
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
  explanationImage: {
    width: '100%',
    height: 200,
    marginTop: 16,
    borderRadius: 12,
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
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#EBF5FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  filterButtonText: {
    fontSize: 13,
    color: '#2563EB',
    fontWeight: '600',
  },
  filterButtonArrow: {
    fontSize: 14,
    color: '#2563EB',
  },
  dropdownContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 12,
    elevation: 3,
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  dropdownText: {
    fontSize: 14,
    color: '#374151',
  },
  dropdownTextActive: {
    color: '#2563EB',
    fontWeight: '600',
  },
  noSolutionCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  noSolutionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#92400E',
    marginBottom: 8,
  },
  noSolutionText: {
    fontSize: 14,
    color: '#78350F',
    lineHeight: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#DC2626',
    textAlign: 'center',
    marginTop: 20,
  },
});
