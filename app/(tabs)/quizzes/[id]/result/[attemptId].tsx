import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  CheckCircle,
  XCircle,
  Clock,
  Award,
  BarChart3,
  FileText,
  AlertTriangle,
} from 'lucide-react-native';
import { api } from '@/services/api';
import { QuizResultData, SectionPerformance } from '@/types/quiz-result';
import { formatDuration, formatMarks, formatPercentage, pluralize } from '@/utils/quizFormat';
import { buildPerformanceChartData, mapQuizResultsResponse } from '@/utils/quizResult';
import { DataTable, DataTableColumn } from '@/components/DataTable';
import { PerformanceMetricGrid } from '@/components/quiz/PerformanceMetricGrid';
import { PerformanceChart } from '@/components/quiz/PerformanceChart';
import { WrongQuestionSection } from '@/components/quiz/WrongQuestionSection';
import { FrequentlyMissedSection } from '@/components/quiz/FrequentlyMissedSection';
import { QuestionPerformanceList } from '@/components/quiz/QuestionPerformanceList';

export default function QuizResult() {
  const { id, attemptId } = useLocalSearchParams<{ id: string; attemptId: string }>();
  const router = useRouter();
  const [result, setResult] = useState<QuizResultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchResults = useCallback(async (isRefresh = false) => {
    if (!isRefresh) {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await api.get(`/quizzes/${id}/attempt/${attemptId}/results?groupBy=section`);
      setResult(mapQuizResultsResponse(response.data));
    } catch (fetchError: any) {
      console.error('Error fetching results:', fetchError);
      const message = fetchError.response?.data?.message || 'Failed to load quiz results.';
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, attemptId]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const handleRequestRetest = async () => {
    Alert.alert(
      'Request Retest',
      'Are you sure you want to request admin approval for a retest?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request',
          onPress: async () => {
            try {
              await api.post(`/quizzes/${id}/attempt/${attemptId}/request-retest`);
              Alert.alert('Success', 'Retest request submitted to admin');
              fetchResults(true);
            } catch (requestError: any) {
              Alert.alert('Error', requestError.response?.data?.message || 'Failed to request retest');
            }
          },
        },
      ]
    );
  };

  const handleViewSolutions = () => {
    router.push(`/quizzes/${id}/review/${attemptId}`);
  };

  const handleBackToQuizzes = () => {
    router.replace('/(tabs)/quizzes');
  };

  if (loading) {
    return (
      <ScreenContainer style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.loadingText}>Loading your results...</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (error || !result) {
    return (
      <ScreenContainer style={styles.container}>
        <View style={styles.centered}>
          <AlertTriangle color="#EF4444" size={40} />
          <Text style={styles.errorTitle}>Unable to load results</Text>
          <Text style={styles.errorText}>{error || 'Results not found'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => fetchResults()}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleBackToQuizzes}>
            <Text style={styles.secondaryButtonText}>Back to Quizzes</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  const { summary } = result;
  const scorePercentage = summary.scorePercentage ?? 0;
  const accuracyDisplay = formatPercentage(summary.accuracy);
  const isPassing = scorePercentage >= 50;
  const questionLabel = pluralize(summary.correct, 'Question');

  const metricRows = [
    {
      key: 'correct',
      label: 'Correct',
      value: summary.correct,
      icon: CheckCircle,
      iconColor: '#10B981',
    },
    {
      key: 'incorrect',
      label: 'Incorrect',
      value: summary.incorrect,
      icon: XCircle,
      iconColor: '#EF4444',
    },
    {
      key: 'skipped',
      label: 'Unattempted',
      value: summary.skipped,
      icon: Clock,
      iconColor: '#F59E0B',
    },
    {
      key: 'marked',
      label: 'Marked for Review',
      value: summary.markedForReviewCount,
      icon: BarChart3,
      iconColor: '#6B7280',
    },
    {
      key: 'accuracy',
      label: 'Accuracy',
      value: accuracyDisplay,
      icon: Award,
      iconColor: '#8B5CF6',
    },
    {
      key: 'time',
      label: 'Time Taken',
      value: formatDuration(summary.timeTakenSeconds),
      icon: Clock,
      iconColor: '#3B82F6',
    },
  ];

  const chartData = buildPerformanceChartData(summary);

  // Shared responsive table: stat columns have guaranteed minimum widths (so
  // headers never wrap mid-word), the Section column flexes to fill wide
  // viewports, and the card scrolls horizontally on narrow phones.
  const sectionColumns: Array<DataTableColumn<SectionPerformance>> = [
    {
      key: 'section',
      header: 'Section',
      width: 104,
      grow: true,
      headerStyle: styles.tableHeaderText,
      renderCell: (section) => (
        <Text style={styles.tableCell} numberOfLines={1}>
          {section.sectionName}
        </Text>
      ),
    },
    {
      key: 'correct',
      header: 'Correct',
      width: 58,
      align: 'center',
      headerStyle: styles.tableHeaderText,
      renderCell: (section) => (
        <Text style={[styles.tableCell, styles.correctText]} numberOfLines={1}>
          {section.correct}
        </Text>
      ),
    },
    {
      key: 'wrong',
      header: 'Wrong',
      width: 50,
      align: 'center',
      headerStyle: styles.tableHeaderText,
      renderCell: (section) => (
        <Text style={[styles.tableCell, styles.incorrectText]} numberOfLines={1}>
          {section.incorrect}
        </Text>
      ),
    },
    {
      key: 'skip',
      header: 'Skip',
      width: 44,
      align: 'center',
      headerStyle: styles.tableHeaderText,
      renderCell: (section) => (
        <Text style={[styles.tableCell, styles.skippedText]} numberOfLines={1}>
          {section.skipped}
        </Text>
      ),
    },
    {
      key: 'acc',
      header: 'Acc%',
      width: 46,
      align: 'center',
      headerStyle: styles.tableHeaderText,
      renderCell: (section) => (
        <Text style={styles.tableCell} numberOfLines={1}>
          {section.accuracy}%
        </Text>
      ),
    },
    {
      key: 'time',
      header: 'Time',
      width: 72,
      align: 'right',
      headerStyle: styles.tableHeaderText,
      renderCell: (section) => (
        <Text style={styles.tableCell} numberOfLines={1}>
          {formatDuration(section.timeSpent)}
        </Text>
      ),
    },
  ];

  return (
    <ScreenContainer style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchResults(true); }} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.headerBadge}>Quiz Completed</Text>
          <Text style={styles.title}>{result.quiz.title}</Text>
          <Text style={styles.subtitle}>
            {new Date(result.endTime).toLocaleDateString()} • {new Date(result.endTime).toLocaleTimeString()}
            {result.status === 'auto_submitted' ? ' • Auto-submitted' : ''}
          </Text>

          <View style={styles.actionButtons}>
            {result.canRequestRetest && !result.retestRequested && (
              <TouchableOpacity style={styles.retestButton} onPress={handleRequestRetest}>
                <Text style={styles.retestButtonText}>Request Retest</Text>
              </TouchableOpacity>
            )}
            {result.retestRequested && !result.retestApproved && (
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingText}>Retest Pending</Text>
              </View>
            )}
            {result.quiz.shareSolution && (
              <TouchableOpacity style={styles.solutionsButton} onPress={handleViewSolutions}>
                <FileText color="#2563EB" size={20} />
                <Text style={styles.solutionsButtonText}>View Solutions</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.scoreCard}>
          <View style={styles.scoreIconContainer}>
            {isPassing ? (
              <CheckCircle color="#10B981" size={64} />
            ) : (
              <XCircle color="#EF4444" size={64} />
            )}
          </View>
          <Text style={styles.scoreText}>
            {summary.correct}/{summary.totalQuestions}
          </Text>
          <Text style={styles.scoreSubtext}>{questionLabel} Correct</Text>

          <View style={styles.marksScoreContainer}>
            <Award color="#8B5CF6" size={18} />
            <Text style={styles.marksScoreText}>
              Score: <Text style={styles.marksScoreValue}>{formatMarks(summary.marksObtained)}</Text>
              <Text style={styles.marksScoreTotal}>/{formatMarks(summary.totalMarks)} marks</Text>
            </Text>
          </View>

          <View style={styles.percentageContainer}>
            <Text style={[styles.percentageText, isPassing ? styles.passPercentage : styles.failPercentage]}>
              {formatPercentage(summary.scorePercentage, '0%')}
            </Text>
            <Text style={styles.percentageLabel}>Overall Score</Text>
          </View>
        </View>

        <PerformanceMetricGrid metrics={metricRows} columns={3} />
        <PerformanceChart data={chartData} />

        {result.hasSectionData && result.sectionPerformance.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Section Performance</Text>
            <DataTable
              columns={sectionColumns}
              data={result.sectionPerformance}
              keyExtractor={(section, index) => `${section.sectionName}-${index}`}
              onRowPress={
                result.quiz.shareSolution
                  ? (section) =>
                      router.push(
                        `/quizzes/${id}/review/${attemptId}?section=${encodeURIComponent(section.sectionName)}`
                      )
                  : undefined
              }
              rowAccessibilityLabel={(section) =>
                `Section ${section.sectionName}: ${section.correct} correct, ${section.incorrect} wrong, ${section.skipped} skipped, ${section.accuracy} percent accuracy`
              }
              style={styles.tableContainer}
            />
          </View>
        )}

        <WrongQuestionSection
          questions={result.wrongQuestions}
          shareSolution={result.quiz.shareSolution}
        />

        <FrequentlyMissedSection questions={result.frequentlyMissedQuestions} />

        <QuestionPerformanceList
          items={result.questionPerformance}
          wrongQuestionDetails={result.wrongQuestions}
          shareSolution={result.quiz.shareSolution}
          onViewSolutions={handleViewSolutions}
        />

        <View style={{ height: 24 }} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.backButton} onPress={handleBackToQuizzes}>
          <Text style={styles.backButtonText}>Back to Quizzes</Text>
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 8,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginTop: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 8,
    backgroundColor: '#2563EB',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  secondaryButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: '#2563EB',
    fontWeight: '600',
  },
  header: {
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  retestButton: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retestButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  pendingBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  pendingText: {
    color: '#92400E',
    fontSize: 14,
    fontWeight: '600',
  },
  solutionsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EBF5FF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  solutionsButtonText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  scoreCard: {
    margin: 20,
    padding: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  scoreIconContainer: {
    marginBottom: 16,
  },
  scoreText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  scoreSubtext: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
  },
  marksScoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    backgroundColor: '#F5F3FF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  marksScoreText: {
    fontSize: 16,
    color: '#374151',
  },
  marksScoreValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  marksScoreTotal: {
    fontSize: 14,
    color: '#6B7280',
  },
  percentageContainer: {
    marginTop: 16,
    alignItems: 'center',
  },
  percentageText: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  percentageLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
  },
  passPercentage: {
    color: '#10B981',
  },
  failPercentage: {
    color: '#EF4444',
  },
  section: {
    marginHorizontal: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 12,
  },
  // Card chrome for the shared DataTable (background/radius come from the
  // component itself).
  tableContainer: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  tableHeaderText: {
    color: '#1F2937',
  },
  tableCell: {
    fontSize: 13,
    color: '#4B5563',
  },
  correctText: {
    color: '#10B981',
    fontWeight: '600',
  },
  incorrectText: {
    color: '#EF4444',
    fontWeight: '600',
  },
  skippedText: {
    color: '#F59E0B',
    fontWeight: '600',
  },
  footer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  backButton: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});
