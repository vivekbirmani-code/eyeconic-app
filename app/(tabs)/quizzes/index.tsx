import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Animated,
  Pressable,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { useRouter, useFocusEffect } from 'expo-router';
import { BookOpen, Clock, CheckCircle, AlertCircle, RotateCcw, ChevronRight, PlayCircle, TrendingUp } from 'lucide-react-native';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { QuizCardSkeleton } from '@/components/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from '@/utils/haptics';
import { formatToIST, formatCountdown } from '@/utils/date';

interface Quiz {
  _id: string;
  title: string;
  subject: { _id: string; name: string };
  subjectNames?: string[];  // computed by backend: unique subject names from questions
  testType: 'daily' | 'weekly' | 'grand';
  duration: number;
  totalMarks: number;
  questions: string[];
  attemptStatus?: {
    hasAttempted: boolean;
    status?: string;
    score?: number;
    marksObtained?: number;
    attemptId?: string;
    canRetake?: boolean;
    retestRequested?: boolean;
  };
  scheduledDate?: string;
  expiryDate?: string;
  // Server-computed availability (same rule /start enforces) — the badge must
  // never depend on the device clock.
  scheduleState?: 'scheduled' | 'open' | 'ended';
}

const getStatusBadge = (quiz: Quiz) => {
  if (!quiz.attemptStatus?.hasAttempted) {
    // Scheduling beats "New": a test that hasn't opened (or has closed) is
    // not startable, and the card must say so.
    if (quiz.scheduleState === 'scheduled') {
      return { label: 'Scheduled', color: '#FFFFFF', bgColor: '#F59E0B' }; // Amber
    }
    if (quiz.scheduleState === 'ended') {
      return { label: 'Ended', color: '#FFFFFF', bgColor: '#6B7280' }; // Gray
    }
    return { label: 'New', color: '#FFFFFF', bgColor: '#10B981' }; // Green
  }
  if (quiz.attemptStatus?.canRetake) {
    return { label: 'Retake', color: '#FFFFFF', bgColor: '#3B82F6' }; // Blue
  }
  if (quiz.attemptStatus?.retestRequested) {
    return { label: 'Pending', color: '#FFFFFF', bgColor: '#F59E0B' }; // Orange
  }
  return { label: 'Done', color: '#FFFFFF', bgColor: '#6B7280' }; // Gray
};

const QuizCard = ({ item, index, onPress, now }: { item: Quiz; index: number; onPress: (quiz: Quiz) => void; now: number }) => {
  const status = getStatusBadge(item);
  const translateY = useRef(new Animated.Value(50)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 500,
        delay: index * 100,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      })
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <Pressable
        style={({ pressed }) => [
          styles.card,
          pressed && styles.cardPressed
        ]}
        onPress={() => onPress(item)}
      >
        <View style={styles.cardHeader}>
          <View style={styles.subjectBadge}>
            <BookOpen size={12} color="#01b4ae" />
            <Text style={styles.subjectText} numberOfLines={1}>
              {item.subjectNames && item.subjectNames.length > 1
                ? 'MIXED'
                : (item.subjectNames?.[0] || item.subject?.name || 'General').toUpperCase()}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: status.bgColor }]}>
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
        </View>

        <Text style={styles.quizTitle} numberOfLines={2}>{item.title}</Text>

        {/* Schedule Display (IST) */}
        {(item.scheduledDate || item.expiryDate) && (
          <View style={{ marginBottom: 12 }}>
            {item.scheduledDate && (
              <Text style={{ fontSize: 11, color: '#64748B', fontWeight: '500' }}>
                Starts: {formatToIST(item.scheduledDate)}
                {item.scheduleState === 'scheduled' && (
                  <Text style={{ color: '#F59E0B', fontWeight: '600' }}>
                    {'  '}(in {formatCountdown(new Date(item.scheduledDate).getTime() - now)})
                  </Text>
                )}
              </Text>
            )}
            {item.expiryDate && (
              <Text style={{ fontSize: 11, color: '#64748B', fontWeight: '500' }}>
                Ends: {formatToIST(item.expiryDate)}
              </Text>
            )}
          </View>
        )}

        <View style={styles.cardStats}>
          <View style={styles.statItem}>
            <Clock size={14} color="#6B7280" />
            <Text style={styles.statText}>{item.duration} mins</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.dot}>•</Text>
            <Text style={styles.statText}>{item.questions?.length || 0} Questions</Text>
          </View>
        </View>

        {item.attemptStatus?.hasAttempted && (
          <View style={styles.scoreContainer}>
            <Text style={styles.scoreLabel}>Score</Text>
            <Text style={styles.scoreValue}>
              {item.attemptStatus.score ?? item.attemptStatus.marksObtained}
              <Text style={styles.scoreTotal}>/{item.questions?.length || 0} Questions</Text>
            </Text>
          </View>
        )}

        <View style={styles.cardFooter}>
          <View style={styles.testTypeContainer}>
            <Text style={styles.testTypeLabel}>Type</Text>
            <Text style={styles.testTypeValue}>
              {item.testType.charAt(0).toUpperCase() + item.testType.slice(1)}
            </Text>
          </View>
          <View style={styles.actionButton}>
            <Text style={styles.actionButtonText}>
              {item.attemptStatus?.hasAttempted && !item.attemptStatus.canRetake
                ? 'Check Results'
                : item.scheduleState === 'scheduled'
                  ? 'View Details'
                  : item.scheduleState === 'ended'
                    ? 'Closed'
                    : 'Start Quiz'}
            </Text>
            <ChevronRight size={16} color="#01b4ae" />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
};

function QuizzesContent() {
  const { user } = useAuth();
  const { markQuizzesAsSeen } = useNotifications();
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'available' | 'completed'>('available');
  // Shared clock for the scheduled-quiz countdowns — one interval for the
  // whole list, not one per card. Only runs while a scheduled quiz is
  // visible; the badge itself comes from the server's scheduleState, so a
  // wrong device clock can mislabel nothing worse than the "in Xm" hint.
  const [now, setNow] = useState(() => Date.now());
  const hasScheduled = quizzes.some(q => q.scheduleState === 'scheduled');
  useEffect(() => {
    if (!hasScheduled) return;
    const timer = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(timer);
  }, [hasScheduled]);

  // Animation refs
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fetchQuizzes();

    // Entry animations
    Animated.parallel([
      Animated.timing(headerOpacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      })
    ]).start();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (user?.role === 'student') {
        markQuizzesAsSeen();
        // Availability transitions (scheduled → open → ended) are
        // server-computed; re-fetching on focus keeps badges current without
        // a manual pull-to-refresh.
        fetchQuizzes();
      }
    }, [user, markQuizzesAsSeen])
  );

  const { socket } = useNotifications();

  // Listen to socket events for real-time quiz updates
  useEffect(() => {
    if (!socket) return;

    const handleQuizUpdate = () => {
      console.log('Real-time quiz update received. Fetching new data...');
      fetchQuizzes();
    };

    socket.on('new_quiz_assigned', handleQuizUpdate);
    socket.on('quiz_submitted', handleQuizUpdate);
    socket.on('quiz_deleted', handleQuizUpdate);

    return () => {
      socket.off('new_quiz_assigned', handleQuizUpdate);
      socket.off('quiz_submitted', handleQuizUpdate);
      socket.off('quiz_deleted', handleQuizUpdate);
    };
  }, [socket]);

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchQuizzes();
  }, []);

  const handleQuizPress = async (quiz: Quiz) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
              // Route via the attemptId from the list payload — probing
              // /start stopped working for closed quizzes (it 403s on the
              // window before the "already completed" branch can answer).
              if (quiz.attemptStatus?.attemptId) {
                router.push(`/quizzes/${quiz._id}/result/${quiz.attemptStatus.attemptId}`);
                return;
              }
              try {
                const response = await api.post(`/quizzes/${quiz._id}/start`);
                if (response.data.attemptId) {
                  router.push(`/quizzes/${quiz._id}/result/${response.data.attemptId}`);
                }
              } catch (err: any) {
                if (err.response?.status === 400 && err.response?.data?.attemptId) {
                  router.push(`/quizzes/${quiz._id}/result/${err.response.data.attemptId}`);
                } else {
                  Alert.alert('Error', 'Could not retrieve quiz results');
                }
              }
            }
          }
        ]
      );
    } else {
      router.push(`/quizzes/${quiz._id}/instructions`);
    }
  };

  // Filter quizzes based on active tab
  const availableQuizzes = quizzes.filter(q => !q.attemptStatus?.hasAttempted || q.attemptStatus?.canRetake);
  const completedQuizzes = quizzes.filter(q => q.attemptStatus?.hasAttempted && !q.attemptStatus?.canRetake);

  const displayQuizzes = activeTab === 'available' ? availableQuizzes : completedQuizzes;

  // Admin view
  if (user?.role === 'admin') {
    return (
      <ScreenContainer style={styles.container}>
        <LinearGradient
          colors={['rgba(1, 180, 174, 0.18)', 'rgba(1, 180, 174, 0.05)', 'rgba(255, 255, 255, 0)']}
          locations={[0, 0.5, 1]}
          style={styles.topGlow}
        />

        {/* Admin Header */}
        <Animated.View style={{ opacity: headerOpacity }}>
          <LinearGradient
            colors={['#01b4ae', '#009d99', '#01b4ae']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.headerGradient}
          >
            <View style={styles.headerContent}>
              <View>
                <Text style={styles.title}>Quiz Management</Text>
                <Text style={styles.subtitle}>Manage your quiz system</Text>
              </View>

            </View>
          </LinearGradient>
        </Animated.View>

        <Animated.View style={[styles.content, { opacity: contentOpacity }]}>
          <Pressable
            style={({ pressed }) => [
              styles.adminCard,
              pressed && styles.cardPressed
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push('/quizzes/quiz-hub' as any);
            }}
          >
            <View style={styles.adminIconContainer}>
              <BookOpen color="#01b4ae" size={32} />
            </View>
            <View style={styles.adminTextContainer}>
              <Text style={styles.adminCardTitle}>Open Quiz Hub</Text>
              <Text style={styles.adminCardDescription}>
                Manage questions, create tests, view analytics
              </Text>
            </View>
            <View style={styles.arrowContainer}>
              <ChevronRight color="#C0C0C0" size={24} />
            </View>
          </Pressable>
        </Animated.View>
      </ScreenContainer>
    );
  }

  // Student view
  return (
    <ScreenContainer style={styles.container}>
      <LinearGradient
        colors={['rgba(1, 180, 174, 0.18)', 'rgba(1, 180, 174, 0.05)', 'rgba(255, 255, 255, 0)']}
        locations={[0, 0.5, 1]}
        style={styles.topGlow}
      />

      {/* Student Header */}
      <Animated.View style={{ opacity: headerOpacity }}>
        <LinearGradient
          colors={['#01b4ae', '#009d99', '#01b4ae']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.headerGradient}
        >
          <Text style={styles.title}>My Tests</Text>
          <Text style={styles.subtitle}>
            {availableQuizzes.length} available • {completedQuizzes.length} completed
          </Text>
        </LinearGradient>
      </Animated.View>

      <View style={styles.mainContent}>
        <Pressable
          style={({ pressed }) => [styles.performanceCard, pressed && styles.cardPressed]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push('/quizzes/my-performance' as any);
          }}
          accessibilityRole="button"
          accessibilityLabel="View my performance analytics"
        >
          <View style={styles.performanceIcon}>
            <TrendingUp color="#01b4ae" size={22} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.performanceTitle}>My Performance</Text>
            <Text style={styles.performanceSubtitle}>
              Quiz history, accuracy, and frequently missed questions
            </Text>
          </View>
          <ChevronRight color="#94A3B8" size={20} />
        </Pressable>

        {/* Custom Tabs */}
        <View style={styles.tabContainer}>
          {/* PHASE 0 SPIKE ENTRY — development builds only. Dead-code eliminated
              in production bundles (__DEV__ === false). Remove with the spike. */}
          {__DEV__ && (
            <Pressable
              style={styles.spikeChip}
              onPress={() => router.push('/quizzes/proctoring-spike' as any)}
              accessibilityRole="button"
              accessibilityLabel="Open Phase 0 CV spike screen"
            >
              <Text style={styles.spikeChipText}>Phase 0 CV Spike</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.tab, activeTab === 'available' && styles.activeTab]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveTab('available');
            }}
          >
            <Text style={[styles.tabText, activeTab === 'available' && styles.activeTabText]}>Available</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, activeTab === 'completed' && styles.activeTab]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveTab('completed');
            }}
          >
            <Text style={[styles.tabText, activeTab === 'completed' && styles.activeTabText]}>Completed</Text>
          </Pressable>
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
            renderItem={({ item, index }) => (
              <QuizCard
                item={item}
                index={index}
                onPress={handleQuizPress}
                now={now}
              />
            )}
            keyExtractor={item => item._id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#01b4ae"
                colors={['#01b4ae']}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconData}>
                  <BookOpen color="#CBD5E1" size={50} />
                </View>
                <Text style={styles.emptyTitle}>
                  {activeTab === 'available' ? 'No Tests Yet' : 'No Completed Tests'}
                </Text>
                <Text style={styles.emptySubtext}>
                  {activeTab === 'available'
                    ? 'Check back later for new tests.'
                    : 'You haven\'t completed any tests yet.'}
                </Text>
              </View>
            }
          />
        )}
      </View>
    </ScreenContainer>
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
    backgroundColor: '#FFFFFF', // Clean white background
  },
  spikeChip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#94A3B8',
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
    backgroundColor: '#F8FAFC',
  },
  spikeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  topGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 300,
    zIndex: 0,
  },
  headerGradient: {
    paddingTop: 20,
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 10,
    marginBottom: 10,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    fontWeight: '500',
  },
  mainContent: {
    flex: 1,
    paddingHorizontal: 20,
  },
  performanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.2)',
    gap: 12,
  },
  performanceIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F0FDFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  performanceTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  performanceSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 16,
  },
  content: {
    padding: 20,
  },
  // Tab Styling
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 4,
    marginTop: 10,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  activeTab: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  activeTabText: {
    color: '#01b4ae',
    fontWeight: '700',
  },

  // Card Styling
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(229, 231, 235, 0.5)',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    shadowOpacity: 0.04,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  subjectBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 6,
    // Long uppercase subject names ellipsize inside the pill instead of
    // pushing the status badge off the card.
    flexShrink: 1,
  },
  subjectText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#01b4ae',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    // The subject pill yields first; the badge keeps its size.
    flexShrink: 0,
    marginLeft: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  quizTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 12,
    lineHeight: 26,
  },
  cardStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  dot: {
    fontSize: 14,
    color: '#CBD5E1',
  },
  scoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  scoreLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  scoreValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  scoreTotal: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '500',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  testTypeContainer: {
    flexDirection: 'column',
  },
  testTypeLabel: {
    fontSize: 11,
    color: '#94A3B8',
    textTransform: 'uppercase',
    fontWeight: '600',
    marginBottom: 2,
  },
  testTypeValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0FDFA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#01b4ae',
  },

  // Admin Card
  adminCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.15)',
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  adminIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  adminTextContainer: {
    flex: 1,
  },
  adminCardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 4,
  },
  adminCardDescription: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 20,
  },
  arrowContainer: {
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 50,
  },

  // States
  listContent: {
    paddingBottom: 40,
  },
  skeletonContainer: {
    marginTop: 10,
    gap: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    marginTop: 40,
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
    backgroundColor: '#01b4ae',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyIconData: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
  },
});