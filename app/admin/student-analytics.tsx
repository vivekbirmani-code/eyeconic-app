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
  StatusBar
} from 'react-native';
import { useRouter } from 'expo-router';
import { 
  Search, 
  ChevronLeft,
  User,
  BookOpen,
  TrendingUp,
  Clock,
  AlertTriangle
} from 'lucide-react-native';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';

interface Student {
  _id: string;
  name: string;
  email: string;
}

interface AttemptSummary {
  _id: string;
  quiz: { title: string; testType: string };
  score: number;
  totalQuestions: number;
  marksObtained: number;
  totalMarks: number;
  percentage: number;
  endTime: string;
  tabSwitchCount: number;
}

interface StudentAnalytics {
  summary: {
    totalTests: number;
    totalMarks: number;
    obtainedMarks: number;
    avgPercentage: number;
  };
  attempts: AttemptSummary[];
}

export default function StudentAnalytics() {
  const { user } = useAuth();
  const router = useRouter();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [analytics, setAnalytics] = useState<StudentAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  useEffect(() => {
    fetchStudents();
  }, []);

  useEffect(() => {
    const query = searchQuery.toLowerCase();
    setFilteredStudents(
      students.filter(s => 
        s.name.toLowerCase().includes(query) || 
        s.email.toLowerCase().includes(query)
      )
    );
  }, [searchQuery, students]);

  const fetchStudents = async () => {
    setLoading(true);
    try {
      const response = await api.get('/users?role=student');
      // Ensure we have an array and filter for students only
      const data = Array.isArray(response.data) ? response.data : [];
      const studentsOnly = data.filter((u: any) => u.role === 'student');
      setStudents(studentsOnly);
      setFilteredStudents(studentsOnly);
    } catch (error) {
      console.error('Error fetching students:', error);
      setStudents([]);
      setFilteredStudents([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchStudentAnalytics = async (studentId: string) => {
    setLoadingAnalytics(true);
    try {
      const response = await api.get(`/quizzes/analytics/student/${studentId}`);
      setAnalytics(response.data);
    } catch (error) {
      console.error('Error fetching analytics:', error);
      setAnalytics(null);
    } finally {
      setLoadingAnalytics(false);
    }
  };

  const handleSelectStudent = (student: Student) => {
    setSelectedStudent(student);
    fetchStudentAnalytics(student._id);
  };

  if (user?.role !== 'admin') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Admin access required</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <ChevronLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Student Analytics</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        {/* Search */}
        <View style={styles.searchContainer}>
          <Search color="#6B7280" size={20} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search students by name or email..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Student List */}
        {!selectedStudent ? (
          <View style={styles.studentList}>
            <Text style={styles.listTitle}>Select a Student</Text>
            {loading ? (
              <ActivityIndicator color="#2563EB" style={{ marginTop: 20 }} />
            ) : (
              <FlatList
                data={filteredStudents}
                keyExtractor={item => item._id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.studentItem}
                    onPress={() => handleSelectStudent(item)}
                  >
                    <View style={styles.studentAvatar}>
                      <User color="#6B7280" size={20} />
                    </View>
                    <View style={styles.studentInfo}>
                      <Text style={styles.studentName}>{item.name}</Text>
                      <Text style={styles.studentEmail}>{item.email}</Text>
                    </View>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>No students found</Text>
                }
              />
            )}
          </View>
        ) : (
          /* Analytics View */
          <ScrollView style={styles.analyticsContainer} showsVerticalScrollIndicator={false}>
            {/* Selected Student Header */}
            <View style={styles.selectedStudentCard}>
              <View style={styles.studentAvatar}>
                <User color="#6B7280" size={24} />
              </View>
              <View style={styles.selectedStudentInfo}>
                <Text style={styles.selectedStudentName}>{selectedStudent.name}</Text>
                <Text style={styles.selectedStudentEmail}>{selectedStudent.email}</Text>
              </View>
              <TouchableOpacity
                style={styles.changeButton}
                onPress={() => setSelectedStudent(null)}
              >
                <Text style={styles.changeButtonText}>Change</Text>
              </TouchableOpacity>
            </View>

            {loadingAnalytics ? (
              <ActivityIndicator color="#2563EB" style={{ marginTop: 40 }} />
            ) : analytics ? (
              <>
                {/* Summary Cards */}
                <View style={styles.summaryContainer}>
                  <View style={styles.summaryCard}>
                    <BookOpen color="#2563EB" size={24} />
                    <Text style={styles.summaryNumber}>{analytics.summary.totalTests}</Text>
                    <Text style={styles.summaryLabel}>Tests Taken</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <TrendingUp color="#10B981" size={24} />
                    <Text style={styles.summaryNumber}>{analytics.summary.avgPercentage}%</Text>
                    <Text style={styles.summaryLabel}>Average</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={[styles.summaryNumber, { fontSize: 20 }]}>
                      {analytics.summary.obtainedMarks}/{analytics.summary.totalMarks}
                    </Text>
                    <Text style={styles.summaryLabel}>Total Marks</Text>
                  </View>
                </View>

                {/* Test History */}
                <Text style={styles.sectionTitle}>Test History</Text>
                {analytics.attempts.length > 0 ? (
                  analytics.attempts.map((attempt, index) => (
                    <View key={index} style={styles.attemptCard}>
                      <View style={styles.attemptHeader}>
                        <Text style={styles.attemptTitle} numberOfLines={1}>
                          {attempt.quiz?.title || 'Untitled Quiz'}
                        </Text>
                        <View style={[
                          styles.typeBadge,
                          attempt.quiz?.testType === 'daily' && styles.dailyBadge,
                          attempt.quiz?.testType === 'weekly' && styles.weeklyBadge,
                          attempt.quiz?.testType === 'grand' && styles.grandBadge
                        ]}>
                          <Text style={styles.typeBadgeText}>{attempt.quiz?.testType || 'test'}</Text>
                        </View>
                      </View>
                      
                      <View style={styles.attemptStats}>
                        <View style={styles.attemptStat}>
                          <Text style={styles.attemptStatLabel}>Score</Text>
                          <Text style={styles.attemptStatValue}>
                            {attempt.score}/{attempt.totalQuestions}
                          </Text>
                        </View>
                        <View style={styles.attemptStat}>
                          <Text style={styles.attemptStatLabel}>Marks</Text>
                          <Text style={styles.attemptStatValue}>
                            {attempt.marksObtained}/{attempt.totalMarks}
                          </Text>
                        </View>
                        <View style={styles.attemptStat}>
                          <Text style={styles.attemptStatLabel}>Percentage</Text>
                          <Text style={[
                            styles.attemptStatValue,
                            attempt.percentage >= 60 ? styles.passText : styles.failText
                          ]}>
                            {attempt.percentage}%
                          </Text>
                        </View>
                      </View>

                      <View style={styles.attemptFooter}>
                        <View style={styles.attemptDate}>
                          <Clock color="#6B7280" size={14} />
                          <Text style={styles.attemptDateText}>
                            {new Date(attempt.endTime).toLocaleDateString()}
                          </Text>
                        </View>
                        {attempt.tabSwitchCount > 0 && (
                          <View style={styles.tabWarning}>
                            <AlertTriangle color="#F59E0B" size={14} />
                            <Text style={styles.tabWarningText}>
                              {attempt.tabSwitchCount} tab switches
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  ))
                ) : (
                  <View style={styles.noAttempts}>
                    <BookOpen color="#9CA3AF" size={48} />
                    <Text style={styles.noAttemptsText}>No tests taken yet</Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.noAttempts}>
                <Text style={styles.noAttemptsText}>Failed to load analytics</Text>
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        )}
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
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#2563EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
  },
  content: {
    flex: 1,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    margin: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  studentList: {
    flex: 1,
    padding: 16,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 12,
  },
  studentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
  },
  studentAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  studentEmail: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  analyticsContainer: {
    flex: 1,
    padding: 16,
  },
  selectedStudentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    gap: 12,
  },
  selectedStudentInfo: {
    flex: 1,
  },
  selectedStudentName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  selectedStudentEmail: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  changeButton: {
    backgroundColor: '#EBF5FF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  changeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
  },
  summaryContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1F2937',
    marginTop: 8,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
  },
  attemptCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  attemptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  attemptTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginRight: 8,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
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
  attemptStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#F3F4F6',
  },
  attemptStat: {
    alignItems: 'center',
  },
  attemptStatLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  attemptStatValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  passText: {
    color: '#10B981',
  },
  failText: {
    color: '#EF4444',
  },
  attemptFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  attemptDate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  attemptDateText: {
    fontSize: 12,
    color: '#6B7280',
  },
  tabWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  tabWarningText: {
    fontSize: 11,
    color: '#92400E',
    fontWeight: '500',
  },
  noAttempts: {
    alignItems: 'center',
    padding: 40,
  },
  noAttemptsText: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 16,
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
