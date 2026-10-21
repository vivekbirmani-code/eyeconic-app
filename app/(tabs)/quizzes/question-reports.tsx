import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { MessageSquareWarning, CheckCircle, XCircle, Clock } from 'lucide-react-native';
import { api } from '@/services/api';
import TabSwitcher from '@/components/analytics/TabSwitcher';
import { useAuth } from '@/context/AuthContext';

interface QuestionReport {
  _id: string;
  comment: string;
  questionIndex: number;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  resolvedAt?: string;
  resolutionNote?: string;
  student?: { _id: string; name: string; email: string } | null;
  quiz?: { _id: string; title: string; testType?: string } | null;
  attempt?: { _id: string; status?: string; endTime?: string; score?: number; totalQuestions?: number } | null;
  question?: { _id: string; question: string; questionType?: string; isActive?: boolean } | null;
  questionSnapshot?: { question: string; questionType: string; available: boolean };
}

type StatusFilter = 'open' | 'resolved' | 'dismissed';

const STATUS_TABS = [
  { key: 'open', label: 'Pending' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'dismissed', label: 'Dismissed' },
];

const QUESTION_TYPE_LABELS: Record<string, string> = {
  mcq_single: 'MCQ — Single Correct',
  assertion_reason: 'Assertion / Reason',
  match_the_following: 'Match the Following',
  image_based: 'Image-Based',
  multiple_correct: 'Multiple Correct',
  numerical: 'Numerical',
};

/**
 * Admin review surface for question reports students file from inside quiz
 * attempts (Report Question in the taking screen). Mirrors the retest
 * requests screen's shape: fetch, decide, refresh. Pending reports can be
 * marked resolved or dismissed; terminal reports stay browsable.
 */
export default function QuestionReports() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [reports, setReports] = useState<QuestionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchReports = useCallback(async (status: StatusFilter) => {
    setLoading(true);
    try {
      const response = await api.get('/quizzes/question-reports', { params: { status } });
      setReports(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      Alert.alert('Error', 'Failed to load question reports');
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports(statusFilter);
  }, [statusFilter, fetchReports]);

  const handleDecision = async (reportId: string, status: 'resolved' | 'dismissed') => {
    setProcessingId(reportId);
    try {
      await api.put(`/quizzes/question-reports/${reportId}/resolve`, { status });
      setReports((prev) => prev.filter((r) => r._id !== reportId));
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to process report');
    } finally {
      setProcessingId(null);
    }
  };

  const renderReport = ({ item }: { item: QuestionReport }) => {
    const isProcessing = processingId === item._id;
    // Live bank text first; the snapshot is the fallback when the question
    // was edited or removed after the report was filed.
    const questionText = item.question?.question || item.questionSnapshot?.question || '';
    const questionType = item.question?.questionType || item.questionSnapshot?.questionType || '';
    const typeLabel = QUESTION_TYPE_LABELS[questionType] || questionType;
    const questionDeleted = !item.question || item.question?.isActive === false;
    // Reports are filed with the quiz's global question index; Q numbers are
    // 1-based in every other surface.
    const qLabel = `Q${item.questionIndex + 1}`;

    return (
      <View style={styles.reportCard}>
        <View style={styles.reportHeader}>
          <View style={styles.studentInfo}>
            <Text style={styles.studentName}>{item.student?.name || 'Unknown student'}</Text>
            <Text style={styles.studentEmail} numberOfLines={1} ellipsizeMode="tail">
              {item.student?.email || ''}
            </Text>
          </View>
          <View style={styles.qBadge}>
            <Text style={styles.qBadgeText}>{qLabel}</Text>
          </View>
        </View>

        <View style={styles.quizInfo}>
          <Text style={styles.quizTitle} numberOfLines={1} ellipsizeMode="tail">
            {item.quiz?.title || 'Deleted test'}
          </Text>
          <Text style={styles.quizMeta}>
            {typeLabel ? `${typeLabel} · ` : ''}
            {new Date(item.createdAt).toLocaleString()}
          </Text>
        </View>

        {(questionText || questionDeleted) && (
          <View style={styles.questionBlock}>
            <Text style={styles.questionText} numberOfLines={3}>
              {questionDeleted ? 'Question no longer available (removed from question bank)' : questionText}
            </Text>
          </View>
        )}

        <View style={styles.commentBlock}>
          <Text style={styles.commentLabel}>STUDENT COMMENT</Text>
          <Text style={styles.commentText}>{item.comment}</Text>
        </View>

        {statusFilter === 'open' ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.dismissButton]}
              onPress={() => handleDecision(item._id, 'dismissed')}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <XCircle color="#FFFFFF" size={18} />
                  <Text style={styles.actionButtonText}>Dismiss</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.resolveButton]}
              onPress={() => handleDecision(item._id, 'resolved')}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <CheckCircle color="#FFFFFF" size={18} />
                  <Text style={styles.actionButtonText}>Resolve</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          item.resolutionNote ? (
            <View style={styles.noteBlock}>
              <Text style={styles.noteLabel}>RESOLUTION NOTE</Text>
              <Text style={styles.noteText}>{item.resolutionNote}</Text>
            </View>
          ) : null
        )}
      </View>
    );
  };

  if (user?.role !== 'admin') {
    return (
      <ScreenContainer style={styles.container}>
        <Text style={styles.errorText}>Admin access required</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <MessageSquareWarning color="#F59E0B" size={22} />
          <Text style={styles.title}>Question Reports</Text>
        </View>
        <Text style={styles.subtitle}>
          Reports students file while attempting a test
        </Text>
      </View>

      <View style={styles.tabWrap}>
        <TabSwitcher
          tabs={STATUS_TABS}
          activeTab={statusFilter}
          onTabChange={(key) => setStatusFilter(key as StatusFilter)}
        />
      </View>

      <FlatList
        data={reports}
        renderItem={renderReport}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => fetchReports(statusFilter)} />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyContainer}>
              <Clock color="#9CA3AF" size={64} />
              <Text style={styles.emptyText}>
                {statusFilter === 'open' ? 'No pending reports' : 'No reports in this state'}
              </Text>
            </View>
          ) : null
        }
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 50,
  },
  header: {
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  tabWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#F3F4F6',
  },
  list: {
    padding: 20,
    paddingTop: 12,
    gap: 16,
  },
  reportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  studentInfo: {
    flex: 1,
    marginRight: 12,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
  },
  studentEmail: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  qBadge: {
    backgroundColor: '#EBF5FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  qBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563EB',
  },
  quizInfo: {
    marginBottom: 10,
  },
  quizTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
  },
  quizMeta: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  questionBlock: {
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  questionText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
  },
  commentBlock: {
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  commentLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  commentText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  noteBlock: {
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 8,
  },
  noteLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  noteText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
    minHeight: 44,
  },
  dismissButton: {
    backgroundColor: '#6B7280',
  },
  resolveButton: {
    backgroundColor: '#10B981',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 16,
  },
});
