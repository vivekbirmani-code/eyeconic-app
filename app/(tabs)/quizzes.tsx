import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
  StatusBar,
  RefreshControl,
  Animated
} from 'react-native';
import { useRouter } from 'expo-router';
import { BookOpen, Clock, CheckCircle, AlertCircle, RotateCcw, ChevronRight } from 'lucide-react-native';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { QuizCardSkeleton } from '@/components/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';

interface Quiz {
  _id: string;
  title: string;
  subject: { _id: string; name: string };
  testType: 'daily' | 'weekly' | 'grand';
  duration: number;
  totalMarks: number;
  questions: string[];
  attemptStatus?: {
    hasAttempted: boolean;
    status?: string;
    score?: number;
    marksObtained?: number;
    canRetake?: boolean;
    retestRequested?: boolean;
  };
}

function QuizzesContent() {
  const { user } = useAuth();
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'available' | 'completed'>('available');

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fetchQuizzes();
    
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, []);

  const fetchQuizzes = async () => {
    try {
      setError(null);
      const response = await api.get('/quizzes');
      setQuizzes(response.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load quizzes');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchQuizzes();
  }, []);

  const handleQuizPress = async (quiz: Quiz) => {
    if (quiz.attemptStatus?.hasAttempted && !quiz.attemptStatus?.canRetake) {
      // Already completed - go to results
      Alert.alert(
        'Quiz Completed',
        'Would you like to view your results?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'View Results',
            onPress: async () => {
              try {
                // Fetch the attempt ID for this quiz
                // We can use the start endpoint which returns existing attempt details if completed
                // But it's safer to get it from a dedicated endpoint or the start endpoint's error response
                
                // Try to start/resume to get the attempt ID or error with ID
                try {
                  const response = await api.post(`/quizzes/${quiz._id}/start`);
                  // If successful (resuming), use returned ID
                  if (response.data.attemptId) {
                    router.push(`/quiz/${quiz._id}/review/${response.data.attemptId}`);
                  }
                } catch (err: any) {
                  // If error (already completed), get ID from error response
                  if (err.response?.status === 400 && err.response?.data?.attemptId) {
                    router.push(`/quiz/${quiz._id}/review/${err.response.data.attemptId}`);
                  } else {
                    Alert.alert('Error', 'Could not retrieve quiz results');
                  }
                }
              } catch (error) {
                console.error('Error viewing results:', error);
                Alert.alert('Error', 'Failed to open results');
              }
            }
          }
        ]
      );
    } else {
      router.push(`/quiz/${quiz._id}/instructions`);
    }
  };

  const getStatusBadge = (quiz: Quiz) => {
    if (!quiz.attemptStatus?.hasAttempted) {
      return { label: 'New', color: '#2563EB', bgColor: '#EBF5FF' };
    }
    if (quiz.attemptStatus?.canRetake) {
      return { label: 'Retest Available', color: '#10B981', bgColor: '#D1FAE5' };
    }
    if (quiz.attemptStatus?.retestRequested) {
      return { label: 'Retest Pending', color: '#F59E0B', bgColor: '#FEF3C7' };
    }
    return { label: 'Completed', color: '#6B7280', bgColor: '#F3F4F6' };
  };

  const getTestTypeColor = (type: string) => {
    switch (type) {
      case 'daily': return { bg: '#DBEAFE', text: '#1E40AF' };
      case 'weekly': return { bg: '#D1FAE5', text: '#065F46' };
      case 'grand': return { bg: '#FEF3C7', text: '#92400E' };
      default: return { bg: '#F3F4F6', text: '#374151' };
    }
  };

  // Filter quizzes based on active tab
  const availableQuizzes = quizzes.filter(q => !q.attemptStatus?.hasAttempted || q.attemptStatus?.canRetake);
  const completedQuizzes = quizzes.filter(q => q.attemptStatus?.hasAttempted && !q.attemptStatus?.canRetake);

  const displayQuizzes = activeTab === 'available' ? availableQuizzes : completedQuizzes;

  const renderQuizCard = ({ item, index }: { item: Quiz; index: number }) => {
    const status = getStatusBadge(item);
    const typeColor = getTestTypeColor(item.testType);

    return (
      <Animated.View
        style={[
          styles.cardWrapper,
          {
            opacity: fadeAnim,
            transform: [{
              translateY: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0]
              })
            }]
          }
        ]}
      >
        <TouchableOpacity
          style={styles.quizCard}
          onPress={() => handleQuizPress(item)}
          activeOpacity={0.7}
          accessible={true}
          accessibilityLabel={`${item.title}, ${item.testType} test, ${item.questions?.length || 0} questions`}
          accessibilityRole="button"
        >
          <View style={styles.cardHeader}>
            <View style={[styles.testTypeBadge, { backgroundColor: typeColor.bg }]}>
              <Text style={[styles.testTypeText, { color: typeColor.text }]}>
                {item.testType.charAt(0).toUpperCase() + item.testType.slice(1)}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: status.bgColor }]}>
              <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
            </View>
          </View>

          <Text style={styles.quizTitle} numberOfLines={2}>{item.title}</Text>

          <View style={styles.quizMeta}>
            <View style={styles.metaItem}>
              <BookOpen color="#6B7280" size={14} />
              <Text style={styles.metaText}>{item.subject?.name}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaText}>{item.questions?.length || 0} Questions</Text>
            </View>
            <View style={styles.metaItem}>
              <Clock color="#6B7280" size={14} />
              <Text style={styles.metaText}>{item.duration} min</Text>
            </View>
          </View>

          {item.attemptStatus?.hasAttempted && (
            <View style={styles.scoreContainer}>
              <Text style={styles.scoreLabel}>Your Score:</Text>
              <Text style={styles.scoreValue}>
                {item.attemptStatus.marksObtained}/{item.totalMarks} 
                ({item.totalMarks ? Math.round((item.attemptStatus.marksObtained! / item.totalMarks) * 100) : 0}%)
              </Text>
            </View>
          )}

          <View style={styles.cardFooter}>
            <Text style={styles.startText}>
              {item.attemptStatus?.hasAttempted 
                ? (item.attemptStatus.canRetake ? 'Retake Test' : 'View Results')
                : 'Start Test'}
            </Text>
            <ChevronRight color="#2563EB" size={20} />
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  // Admin view
  if (user?.role === 'admin') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.adminHeader}>
          <Text style={styles.adminTitle}>Quiz Management</Text>
          <Text style={styles.adminSubtitle}>Manage your quiz system</Text>
        </View>
        
        <TouchableOpacity
          style={styles.adminButton}
          onPress={() => router.push('/admin/quiz-hub' as any)}
        >
          <View style={styles.adminButtonContent}>
            <BookOpen color="#2563EB" size={24} />
            <View style={styles.adminButtonText}>
              <Text style={styles.adminButtonTitle}>Open Quiz Hub</Text>
              <Text style={styles.adminButtonSubtitle}>Manage questions, create tests, view analytics</Text>
            </View>
            <ChevronRight color="#2563EB" size={24} />
          </View>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Student view
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Quizzes</Text>
        <Text style={styles.headerSubtitle}>
          {availableQuizzes.length} available, {completedQuizzes.length} completed
        </Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'available' && styles.activeTab]}
          onPress={() => setActiveTab('available')}
        >
          <Text style={[styles.tabText, activeTab === 'available' && styles.activeTabText]}>
            Available ({availableQuizzes.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'completed' && styles.activeTab]}
          onPress={() => setActiveTab('completed')}
        >
          <Text style={[styles.tabText, activeTab === 'completed' && styles.activeTabText]}>
            Completed ({completedQuizzes.length})
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.skeletonContainer}>
          {[1, 2, 3].map(i => (
            <QuizCardSkeleton key={i} />
          ))}
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <AlertCircle color="#EF4444" size={48} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchQuizzes}>
            <RotateCcw color="#FFF" size={16} />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={displayQuizzes}
          renderItem={renderQuizCard}
          keyExtractor={item => item._id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <BookOpen color="#9CA3AF" size={64} />
              <Text style={styles.emptyTitle}>
                {activeTab === 'available' ? 'No Quizzes Available' : 'No Completed Quizzes'}
              </Text>
              <Text style={styles.emptySubtext}>
                {activeTab === 'available' 
                  ? 'New quizzes assigned to you will appear here'
                  : 'Quizzes you complete will appear here'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

export default function Quizzes() {
  return (
    <ErrorBoundary>
      <QuizzesContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  header: {
    padding: 20,
    backgroundColor: '#2563EB',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFF',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#BFDBFE',
    marginTop: 4,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    padding: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  activeTab: {
    backgroundColor: '#2563EB',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  activeTabText: {
    color: '#FFF',
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  cardWrapper: {
    marginBottom: 16,
  },
  quizCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  testTypeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  testTypeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  quizTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
  },
  quizMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 13,
    color: '#6B7280',
  },
  scoreContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  scoreLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  scoreValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  startText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
  },
  skeletonContainer: {
    padding: 16,
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
    marginBottom: 16,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2563EB',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 8,
  },
  adminHeader: {
    padding: 20,
    backgroundColor: '#2563EB',
  },
  adminTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFF',
  },
  adminSubtitle: {
    fontSize: 14,
    color: '#BFDBFE',
    marginTop: 4,
  },
  adminButton: {
    margin: 16,
    backgroundColor: '#FFF',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  adminButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    gap: 16,
  },
  adminButtonText: {
    flex: 1,
  },
  adminButtonTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  adminButtonSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
});