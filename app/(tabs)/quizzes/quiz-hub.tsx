import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Platform,
  StatusBar,
  Alert
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  BookOpen,
  PlusCircle,
  Database,
  Users,
  Search,
  Clock,
  ChevronRight,
  BarChart3
} from 'lucide-react-native';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';

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

  useEffect(() => {
    fetchData();
  }, []);

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
      color: '#2563EB',
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Quiz Management</Text>
          <Text style={styles.headerSubtitle}>Manage questions and tests</Text>
        </View>

        {/* Quick Stats */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{questionStats.total}</Text>
            <Text style={styles.statLabel}>Questions</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{quizStats.total}</Text>
            <Text style={styles.statLabel}>Total Tests</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{quizStats.daily}</Text>
            <Text style={styles.statLabel}>Daily</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{quizStats.weekly}</Text>
            <Text style={styles.statLabel}>Weekly</Text>
          </View>
        </View>

        {/* Menu Items */}
        <View style={styles.menuContainer}>
          {menuItems.map((item, index) => (
            <TouchableOpacity
              key={index}
              style={styles.menuItem}
              onPress={() => router.push(item.route as any)}
            >
              <View style={[styles.menuIconContainer, { backgroundColor: item.color + '20' }]}>
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
            </TouchableOpacity>
          ))}
        </View>

        {/* Subject Breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Questions by Subject</Text>
          {loading ? (
            <ActivityIndicator color="#2563EB" />
          ) : (
            <View style={styles.subjectList}>
              {questionStats.bySubject.map((item, index) => (
                <View key={index} style={styles.subjectItem}>
                  <View style={styles.subjectInfo}>
                    <BookOpen color="#6B7280" size={16} />
                    <Text style={styles.subjectName}>{item.subject}</Text>
                  </View>
                  <View style={styles.subjectCount}>
                    <Text style={styles.subjectCountText}>{item.count}</Text>
                  </View>
                </View>
              ))}
              {questionStats.bySubject.length === 0 && (
                <Text style={styles.emptyText}>No questions yet. Import from Excel or add manually.</Text>
              )}
            </View>
          )}
        </View>

        {/* Recent Quizzes */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Tests</Text>
          {loading ? (
            <ActivityIndicator color="#2563EB" />
          ) : (
            <View style={styles.quizList}>
              {recentQuizzes.map((quiz, index) => (
                <View key={index} style={styles.quizItem}>
                  <View style={styles.quizInfo}>
                    <Text style={styles.quizTitle} numberOfLines={1}>{quiz.title}</Text>
                    <View style={styles.quizMeta}>
                      <View style={[
                        styles.typeBadge,
                        quiz.testType === 'daily' && styles.dailyBadge,
                        quiz.testType === 'weekly' && styles.weeklyBadge,
                        quiz.testType === 'grand' && styles.grandBadge
                      ]}>
                        <Text style={styles.typeBadgeText}>{quiz.testType}</Text>
                      </View>
                      <Text style={styles.studentCount}>
                        <Users color="#6B7280" size={12} /> {quiz.assignedStudents?.length || 0} students
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.quizDate}>
                    {new Date(quiz.createdAt).toLocaleDateString()}
                  </Text>
                </View>
              ))}
              {recentQuizzes.length === 0 && (
                <Text style={styles.emptyText}>No tests created yet.</Text>
              )}
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
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
    padding: 20,
    backgroundColor: '#2563EB',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFF',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#BFDBFE',
    marginTop: 4,
  },
  statsContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  statLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
  },
  menuContainer: {
    padding: 16,
    gap: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  menuIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
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
  },
  menuSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  badge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
  },
  subjectList: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    overflow: 'hidden',
  },
  subjectItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  subjectInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  subjectName: {
    fontSize: 15,
    color: '#1F2937',
  },
  subjectCount: {
    backgroundColor: '#EBF5FF',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  subjectCountText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
  },
  quizList: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    overflow: 'hidden',
  },
  quizItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  quizInfo: {
    flex: 1,
  },
  quizTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  quizMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#F3F4F6',
  },
  dailyBadge: {
    backgroundColor: '#DBEAFE',
  },
  weeklyBadge: {
    backgroundColor: '#D1FAE5',
  },
  grandBadge: {
    backgroundColor: '#FEF3C7',
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#374151',
    textTransform: 'capitalize',
  },
  studentCount: {
    fontSize: 12,
    color: '#6B7280',
  },
  quizDate: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 50,
  },
});
