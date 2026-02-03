import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Platform,
  StatusBar,
  Animated,
  Pressable
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  BookOpen,
  PlusCircle,
  Database,
  Clock,
  ChevronRight,
  BarChart3,
  Users
} from 'lucide-react-native';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from '@/utils/haptics';

interface QuizStats {
  total: number;
  daily: number;
  weekly: number;
  grand: number;
}

interface QuestionStats {
  total: number;
  bySubject: { subject: string; count: number }[];
}

interface RecentQuiz {
  _id: string;
  title: string;
  testType: string;
  subject: { name: string };
  assignedStudents: string[];
  createdAt: string;
}

export default function AdminQuizHub() {
  const { user } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [quizStats, setQuizStats] = useState<QuizStats>({ total: 0, daily: 0, weekly: 0, grand: 0 });
  const [questionStats, setQuestionStats] = useState<QuestionStats>({ total: 0, bySubject: [] });
  const [recentQuizzes, setRecentQuizzes] = useState<RecentQuiz[]>([]);
  const [pendingRetests, setPendingRetests] = useState(0);

  // Animation refs
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const statsOpacity = useRef(new Animated.Value(0)).current;
  const statsTranslateY = useRef(new Animated.Value(20)).current;
  const menuOpacity = useRef(new Animated.Value(0)).current;
  const menuTranslateY = useRef(new Animated.Value(20)).current;
  const sectionOpacity = useRef(new Animated.Value(0)).current;
  const sectionTranslateY = useRef(new Animated.Value(20)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fetchData();
    runEntryAnimations();
  }, []);

  const runEntryAnimations = () => {
    // Header fade in
    Animated.timing(headerOpacity, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    // Stats cards animation (delayed)
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(statsOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.spring(statsTranslateY, {
          toValue: 0,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();
    }, 200);

    // Menu items animation (more delayed)
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(menuOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.spring(menuTranslateY, {
          toValue: 0,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();
    }, 350);

    // Sections animation
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(sectionOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.spring(sectionTranslateY, {
          toValue: 0,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();
    }, 500);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch question stats
      try {
        const qbResponse = await api.get('/question-bank/stats/summary');
        setQuestionStats({
          total: qbResponse.data?.total || 0,
          bySubject: Array.isArray(qbResponse.data?.bySubject) ? qbResponse.data.bySubject : []
        });
      } catch (e) {
        setQuestionStats({ total: 0, bySubject: [] });
      }

      // Fetch recent quizzes
      try {
        const quizzesResponse = await api.get('/quizzes');
        const quizzes = Array.isArray(quizzesResponse.data) ? quizzesResponse.data : [];
        setRecentQuizzes(quizzes.slice(0, 5));

        // Calculate quiz stats
        setQuizStats({
          total: quizzes.length,
          daily: quizzes.filter((q: any) => q.testType === 'daily').length,
          weekly: quizzes.filter((q: any) => q.testType === 'weekly').length,
          grand: quizzes.filter((q: any) => q.testType === 'grand').length
        });
      } catch (e) {
        setRecentQuizzes([]);
        setQuizStats({ total: 0, daily: 0, weekly: 0, grand: 0 });
      }

      // Fetch pending retest requests
      try {
        const retestsResponse = await api.get('/quizzes/retest-requests/pending');
        const retests = Array.isArray(retestsResponse.data) ? retestsResponse.data : [];
        setPendingRetests(retests.length);
      } catch (e) {
        setPendingRetests(0);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      // Fade in content after loading
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
  };

  if (user?.role !== 'admin') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Admin access required</Text>
      </SafeAreaView>
    );
  }

  const menuItems = [
    {
      title: 'Question Bank',
      subtitle: `${questionStats.total} questions`,
      icon: Database,
      color: '#01b4ae',
      route: '/quizzes/question-bank'
    },
    {
      title: 'Create Quiz',
      subtitle: 'Daily, Weekly, Grand',
      icon: PlusCircle,
      color: '#10B981',
      route: '/quizzes/create-quiz'
    },
    {
      title: 'Student Analytics',
      subtitle: 'View test history',
      icon: BarChart3,
      color: '#8B5CF6',
      route: '/quizzes/student-analytics'
    },
    {
      title: 'Import from Excel',
      subtitle: 'Upload .xlsx files',
      icon: Database,
      color: '#0891B2',
      route: '/quizzes/import-quiz'
    },
    {
      title: 'Retest Requests',
      subtitle: pendingRetests > 0 ? `${pendingRetests} pending` : 'No pending requests',
      icon: Clock,
      color: '#F59E0B',
      route: '/quizzes/retest-requests',
      badge: pendingRetests
    },
    {
      title: 'Past Tests',
      subtitle: `${quizStats.total} tests created`,
      icon: BookOpen,
      color: '#6366F1',
      route: '/quizzes/past-tests'
    }
  ];

  const statCards = [
    { value: questionStats.total, label: 'Questions' },
    { value: quizStats.total, label: 'Total Tests' },
    { value: quizStats.daily, label: 'Daily' },
    { value: quizStats.weekly, label: 'Weekly' }
  ];

  const handleMenuPress = (route: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as any);
  };

  // Skeleton component
  const Skeleton = ({ style }: { style?: any }) => (
    <Animated.View style={[styles.skeleton, style]}>
      <View style={styles.skeletonShimmer} />
    </Animated.View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Top glow effect */}
      <LinearGradient
        colors={[
          'rgba(1, 180, 174, 0.18)',
          'rgba(1, 180, 174, 0.08)',
          'rgba(255, 255, 255, 0)'
        ]}
        locations={[0, 0.5, 1]}
        style={styles.topGlow}
      />

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Animated Header with Gradient */}
        <Animated.View style={{ opacity: headerOpacity }}>
          <LinearGradient
            colors={['#01b4ae', '#009d99', '#01b4ae']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.headerGradient}
          >
            <Text style={styles.headerTitle}>Quiz Hub</Text>
            <Text style={styles.headerSubtitle}>Manage questions and tests</Text>
          </LinearGradient>
        </Animated.View>

        {/* Quick Stats - Premium Cards */}
        <Animated.View
          style={[
            styles.statsContainer,
            {
              opacity: statsOpacity,
              transform: [{ translateY: statsTranslateY }],
            },
          ]}
        >
          {loading ? (
            // Skeleton loaders for stats
            <>
              {[1, 2, 3, 4].map((i) => (
                <View key={i} style={styles.statCard}>
                  <Skeleton style={styles.skeletonNumber} />
                  <Skeleton style={styles.skeletonLabel} />
                </View>
              ))}
            </>
          ) : (
            statCards.map((stat, index) => (
              <Pressable
                key={index}
                style={({ pressed }) => [
                  styles.statCard,
                  pressed && styles.statCardPressed
                ]}
                onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
              >
                <Animated.View style={{ opacity: contentOpacity }}>
                  <Text style={styles.statNumber}>{stat.value}</Text>
                  <Text style={styles.statLabel}>{stat.label}</Text>
                </Animated.View>
              </Pressable>
            ))
          )}
        </Animated.View>

        {/* Menu Items - Premium Design */}
        <Animated.View
          style={[
            styles.menuContainer,
            {
              opacity: menuOpacity,
              transform: [{ translateY: menuTranslateY }],
            },
          ]}
        >
          {loading ? (
            // Skeleton loaders for menu items
            <>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <View key={i} style={styles.menuItem}>
                  <Skeleton style={styles.skeletonIcon} />
                  <View style={styles.menuContent}>
                    <Skeleton style={styles.skeletonMenuTitle} />
                    <Skeleton style={styles.skeletonMenuSubtitle} />
                  </View>
                </View>
              ))}
            </>
          ) : (
            menuItems.map((item, index) => (
              <Pressable
                key={index}
                style={({ pressed }) => [
                  styles.menuItem,
                  pressed && styles.menuItemPressed
                ]}
                onPress={() => handleMenuPress(item.route)}
              >
                <Animated.View style={[styles.menuItemInner, { opacity: contentOpacity }]}>
                  <View style={[styles.menuIconContainer, { backgroundColor: item.color + '15' }]}>
                    <item.icon color={item.color} size={24} />
                  </View>
                  <View style={styles.menuContent}>
                    <Text style={styles.menuTitle}>{item.title}</Text>
                    <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
                  </View>
                  {item.badge! > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.badge}</Text>
                    </View>
                  )}
                  <ChevronRight color="#9CA3AF" size={20} />
                </Animated.View>
              </Pressable>
            ))
          )}
        </Animated.View>

        {/* Subject Breakdown */}
        <Animated.View
          style={[
            styles.section,
            {
              opacity: sectionOpacity,
              transform: [{ translateY: sectionTranslateY }],
            },
          ]}
        >
          <Text style={styles.sectionTitle}>Questions by Subject</Text>
          {loading ? (
            <View style={styles.subjectList}>
              {[1, 2, 3, 4].map((i) => (
                <View key={i} style={styles.subjectItem}>
                  <View style={styles.subjectInfo}>
                    <Skeleton style={styles.skeletonSubjectIcon} />
                    <Skeleton style={styles.skeletonSubjectName} />
                  </View>
                  <Skeleton style={styles.skeletonSubjectCount} />
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.subjectList}>
              {questionStats.bySubject.map((item, index) => (
                <Pressable
                  key={index}
                  style={({ pressed }) => [
                    styles.subjectItem,
                    pressed && styles.subjectItemPressed
                  ]}
                >
                  <Animated.View style={[styles.subjectItemInner, { opacity: contentOpacity }]}>
                    <View style={styles.subjectInfo}>
                      <View style={styles.subjectIconContainer}>
                        <BookOpen color="#01b4ae" size={16} />
                      </View>
                      <Text style={styles.subjectName}>{item.subject}</Text>
                    </View>
                    <View style={styles.subjectCount}>
                      <Text style={styles.subjectCountText}>{item.count}</Text>
                    </View>
                  </Animated.View>
                </Pressable>
              ))}
              {questionStats.bySubject.length === 0 && (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No questions yet. Import from Excel or add manually.</Text>
                </View>
              )}
            </View>
          )}
        </Animated.View>

        {/* Recent Quizzes */}
        <Animated.View
          style={[
            styles.section,
            {
              opacity: sectionOpacity,
              transform: [{ translateY: sectionTranslateY }],
            },
          ]}
        >
          <Text style={styles.sectionTitle}>Recent Tests</Text>
          {loading ? (
            <View style={styles.quizList}>
              {[1, 2, 3].map((i) => (
                <View key={i} style={styles.quizItem}>
                  <View style={styles.quizInfo}>
                    <Skeleton style={styles.skeletonQuizTitle} />
                    <View style={styles.quizMeta}>
                      <Skeleton style={styles.skeletonBadge} />
                      <Skeleton style={styles.skeletonStudentCount} />
                    </View>
                  </View>
                  <Skeleton style={styles.skeletonDate} />
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.quizList}>
              {recentQuizzes.map((quiz, index) => (
                <Pressable
                  key={index}
                  style={({ pressed }) => [
                    styles.quizItem,
                    pressed && styles.quizItemPressed
                  ]}
                >
                  <Animated.View style={[styles.quizItemInner, { opacity: contentOpacity }]}>
                    <View style={styles.quizInfo}>
                      <Text style={styles.quizTitle} numberOfLines={1}>{quiz.title}</Text>
                      <View style={styles.quizMeta}>
                        <View style={[
                          styles.typeBadge,
                          quiz.testType === 'daily' && styles.dailyBadge,
                          quiz.testType === 'weekly' && styles.weeklyBadge,
                          quiz.testType === 'grand' && styles.grandBadge
                        ]}>
                          <Text style={[
                            styles.typeBadgeText,
                            quiz.testType === 'daily' && styles.dailyBadgeText,
                            quiz.testType === 'weekly' && styles.weeklyBadgeText,
                            quiz.testType === 'grand' && styles.grandBadgeText
                          ]}>{quiz.testType}</Text>
                        </View>
                        <View style={styles.studentCountContainer}>
                          <Users color="#6B7280" size={12} />
                          <Text style={styles.studentCount}>{quiz.assignedStudents?.length || 0} students</Text>
                        </View>
                      </View>
                    </View>
                    <Text style={styles.quizDate}>
                      {new Date(quiz.createdAt).toLocaleDateString()}
                    </Text>
                  </Animated.View>
                </Pressable>
              ))}
              {recentQuizzes.length === 0 && (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No tests created yet.</Text>
                </View>
              )}
            </View>
          )}
        </Animated.View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  // Top glow effect
  topGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 250,
    zIndex: 0,
  },
  // Header with gradient
  headerGradient: {
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
    zIndex: 1,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 4,
    letterSpacing: 0.2,
  },
  // Stats cards
  statsContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  statCardPressed: {
    transform: [{ scale: 0.97 }],
    shadowOpacity: 0.04,
  },
  statNumber: {
    fontSize: 26,
    fontWeight: '700',
    color: '#01b4ae',
    textAlign: 'center',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 4,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  // Menu items
  menuContainer: {
    paddingHorizontal: 16,
    gap: 12,
  },
  menuItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
    overflow: 'hidden',
  },
  menuItemPressed: {
    transform: [{ scale: 0.98 }],
    shadowOpacity: 0.04,
    backgroundColor: 'rgba(1, 180, 174, 0.03)',
  },
  menuItemInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  menuIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuContent: {
    flex: 1,
    marginLeft: 16,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    letterSpacing: 0.2,
  },
  menuSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 3,
    fontWeight: '400',
  },
  badge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginRight: 8,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  // Sections
  section: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#01b4ae',
    marginBottom: 14,
    letterSpacing: 0.3,
  },
  // Subject list
  subjectList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  subjectItem: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(1, 180, 174, 0.08)',
  },
  subjectItemPressed: {
    backgroundColor: 'rgba(1, 180, 174, 0.03)',
  },
  subjectItemInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  subjectInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  subjectIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  subjectName: {
    fontSize: 15,
    color: '#1F2937',
    fontWeight: '500',
  },
  subjectCount: {
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.2)',
  },
  subjectCountText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#01b4ae',
  },
  // Quiz list
  quizList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  quizItem: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(1, 180, 174, 0.08)',
  },
  quizItemPressed: {
    backgroundColor: 'rgba(1, 180, 174, 0.03)',
  },
  quizItemInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  quizInfo: {
    flex: 1,
  },
  quizTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 6,
  },
  quizMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  dailyBadge: {
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.2)',
  },
  weeklyBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  grandBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#374151',
    textTransform: 'capitalize',
  },
  dailyBadgeText: {
    color: '#01b4ae',
  },
  weeklyBadgeText: {
    color: '#10B981',
  },
  grandBadgeText: {
    color: '#8B5CF6',
  },
  studentCountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  studentCount: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  quizDate: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  // Empty state
  emptyContainer: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    fontWeight: '400',
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 50,
    fontWeight: '500',
  },
  // Skeleton loading
  skeleton: {
    backgroundColor: '#E5E7EB',
    borderRadius: 8,
    overflow: 'hidden',
  },
  skeletonShimmer: {
    width: '100%',
    height: '100%',
    backgroundColor: '#E5E7EB',
  },
  skeletonNumber: {
    width: 40,
    height: 28,
    marginBottom: 6,
    alignSelf: 'center',
  },
  skeletonLabel: {
    width: 50,
    height: 12,
    alignSelf: 'center',
  },
  skeletonIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    marginRight: 16,
  },
  skeletonMenuTitle: {
    width: 120,
    height: 18,
    marginBottom: 6,
  },
  skeletonMenuSubtitle: {
    width: 80,
    height: 14,
  },
  skeletonSubjectIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  skeletonSubjectName: {
    width: 100,
    height: 16,
    marginLeft: 12,
  },
  skeletonSubjectCount: {
    width: 40,
    height: 28,
    borderRadius: 12,
  },
  skeletonQuizTitle: {
    width: 150,
    height: 18,
    marginBottom: 8,
  },
  skeletonBadge: {
    width: 50,
    height: 22,
    borderRadius: 8,
  },
  skeletonStudentCount: {
    width: 70,
    height: 14,
  },
  skeletonDate: {
    width: 60,
    height: 14,
  },
});
