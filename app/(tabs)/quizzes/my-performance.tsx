import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  ChevronLeft,
  BookOpen,
  Clock,
  TrendingUp,
  CheckCircle,
  XCircle,
  MinusCircle,
} from 'lucide-react-native';
import { api } from '@/services/api';
import AnalyticsKpiGrid from '@/components/analytics/AnalyticsKpiGrid';
import PerformanceTrend from '@/components/analytics/PerformanceTrend';
import { FrequentlyMissedSection } from '@/components/quiz/FrequentlyMissedSection';
import {
  StudentPerformanceResponse,
  formatPercent,
} from '@/types/analytics';
import { FrequentlyMissedQuestion } from '@/types/quiz-result';

export default function MyPerformance() {
  const router = useRouter();
  const [data, setData] = useState<StudentPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);

  const fetchPerformance = useCallback(async (page = 1, isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      setError(null);
      const response = await api.get<StudentPerformanceResponse>('/quizzes/analytics/me', {
        params: { page, limit: 20 },
      });
      setData(response.data);
      setHistoryPage(page);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load performance data');
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchPerformance(historyPage);
    }, [fetchPerformance, historyPage])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchPerformance(1, true);
  };

  const handleOpenAttempt = (attempt: StudentPerformanceResponse['attempts'][0]) => {
    const quizId = attempt.quiz?._id;
    if (!quizId) return;
    router.push(`/quizzes/${quizId}/result/${attempt._id}`);
  };

  const missedQuestions: FrequentlyMissedQuestion[] = (data?.frequentlyMissedQuestions || []).map((item) => ({
    ...item,
    latestResult: item.latestResult === 'correct' ? 'correct' : 'incorrect',
  }));

  const hasHistory = (data?.summary.totalTests || 0) > 0;

  return (
    <ScreenContainer style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back">
          <ChevronLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Performance</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading && !data ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#01b4ae" size="large" />
          <Text style={styles.loadingText}>Loading your performance...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => fetchPerformance(1)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : !hasHistory ? (
        <View style={styles.centered}>
          <BookOpen color="#9CA3AF" size={56} />
          <Text style={styles.emptyTitle}>No completed quizzes yet</Text>
          <Text style={styles.emptyText}>
            Complete your first quiz to see performance insights, quiz history, and frequently missed questions.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#01b4ae" />
          }
        >
          <Text style={styles.sectionTitle}>Overview</Text>
          <AnalyticsKpiGrid
            items={[
              {
                icon: BookOpen,
                value: String(data?.summary.totalTests ?? 0),
                label: 'Quizzes Completed',
                color: '#01b4ae',
              },
              {
                icon: TrendingUp,
                value: formatPercent(data?.summary.avgScorePercentage ?? data?.summary.avgPercentage),
                label: 'Average Score',
                color: '#3B82F6',
              },
              {
                icon: CheckCircle,
                value: String(data?.summary.totalCorrect ?? 0),
                label: 'Correct',
                color: '#10B981',
              },
              {
                icon: XCircle,
                value: String(data?.summary.totalIncorrect ?? 0),
                label: 'Wrong',
                color: '#EF4444',
              },
              {
                icon: MinusCircle,
                value: String(data?.summary.totalSkipped ?? 0),
                label: 'Unattempted',
                color: '#6B7280',
              },
              {
                icon: TrendingUp,
                value: formatPercent(data?.summary.avgAccuracy),
                label: 'Overall Accuracy',
                color: '#8B5CF6',
              },
            ]}
          />

          {(data?.trend?.length || 0) > 1 ? (
            <>
              <Text style={styles.sectionTitle}>Score Trend</Text>
              <PerformanceTrend trend={data?.trend || []} />
            </>
          ) : null}

          <Text style={styles.sectionTitle}>Quiz History</Text>
          {data?.attempts.map((attempt) => (
            <TouchableOpacity
              key={attempt._id}
              style={styles.attemptCard}
              onPress={() => handleOpenAttempt(attempt)}
              accessibilityRole="button"
              accessibilityLabel={`Open results for ${attempt.quiz?.title || 'quiz'}`}
            >
              <View style={styles.attemptHeader}>
                <Text style={styles.attemptTitle} numberOfLines={2}>
                  {attempt.quiz?.title || 'Untitled Quiz'}
                </Text>
                <Text style={styles.scoreBadge}>
                  {formatPercent(attempt.scorePercentage ?? attempt.percentage)}
                </Text>
              </View>
              <View style={styles.attemptStats}>
                <Text style={styles.statText}>
                  Correct {attempt.correct ?? attempt.score}
                </Text>
                <Text style={styles.dot}>•</Text>
                <Text style={styles.statText}>Wrong {attempt.incorrect ?? '—'}</Text>
                <Text style={styles.dot}>•</Text>
                <Text style={styles.statText}>
                  Accuracy {formatPercent(attempt.accuracy, 'N/A')}
                </Text>
              </View>
              <View style={styles.attemptFooter}>
                <Clock color="#6B7280" size={14} />
                <Text style={styles.dateText}>
                  {attempt.endTime ? new Date(attempt.endTime).toLocaleDateString() : '—'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}

          {data?.pagination && data.pagination.totalPages > 1 ? (
            <View style={styles.paginationRow}>
              <TouchableOpacity
                style={[styles.pageButton, historyPage <= 1 && styles.pageButtonDisabled]}
                disabled={historyPage <= 1}
                onPress={() => fetchPerformance(historyPage - 1)}
              >
                <Text style={styles.pageButtonText}>Previous</Text>
              </TouchableOpacity>
              <Text style={styles.paginationText}>
                {data.pagination.showingFrom}–{data.pagination.showingTo} of {data.pagination.total}
              </Text>
              <TouchableOpacity
                style={[
                  styles.pageButton,
                  historyPage >= data.pagination.totalPages && styles.pageButtonDisabled,
                ]}
                disabled={historyPage >= data.pagination.totalPages}
                onPress={() => fetchPerformance(historyPage + 1)}
              >
                <Text style={styles.pageButtonText}>Next</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <FrequentlyMissedSection questions={missedQuestions} />

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
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
    backgroundColor: '#01b4ae',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
  },
  content: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 12,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
  },
  errorText: {
    fontSize: 15,
    color: '#DC2626',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#01b4ae',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#FFF',
    fontWeight: '600',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  attemptCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  attemptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  attemptTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
  },
  scoreBadge: {
    fontSize: 15,
    fontWeight: '700',
    color: '#01b4ae',
  },
  attemptStats: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  statText: {
    fontSize: 13,
    color: '#4B5563',
  },
  dot: {
    color: '#D1D5DB',
  },
  attemptFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateText: {
    fontSize: 12,
    color: '#6B7280',
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    marginBottom: 8,
    gap: 8,
  },
  pageButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#E0F2F1',
  },
  pageButtonDisabled: {
    opacity: 0.4,
  },
  pageButtonText: {
    color: '#00796B',
    fontWeight: '600',
    fontSize: 13,
  },
  paginationText: {
    fontSize: 12,
    color: '#6B7280',
    flex: 1,
    textAlign: 'center',
  },
});
