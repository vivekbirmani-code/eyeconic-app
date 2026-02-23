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
  Linking,
  Alert
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Search,
  ChevronLeft,
  User,
  BookOpen,
  TrendingUp,
  Clock,
  AlertTriangle,
  Download,
  BarChart3,
  Grid3X3
} from 'lucide-react-native';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import TabSwitcher from '@/components/analytics/TabSwitcher';
import TestDropdown from '@/components/analytics/test-analytics/TestDropdown';
import TestOverview from '@/components/analytics/test-analytics/TestOverview';
import PerformanceMetrics from '@/components/analytics/test-analytics/PerformanceMetrics';
import QuestionAnalytics from '@/components/analytics/test-analytics/QuestionAnalytics';
import StudentPerformanceList from '@/components/analytics/test-analytics/StudentPerformanceList';
import AttemptDetailModal from '@/components/analytics/AttemptDetailModal';

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

interface SubjectPerformance {
  subjectId: string;
  subjectName: string;
  tests: number;
  totalMarks: number;
  obtainedMarks: number;
  totalCorrect: number;
  totalQuestions: number;
  percentage: number;
  attempts: any[];
}

interface TestListItem {
  _id: string;
  title: string;
  testType: string;
  assignedCount: number;
  attemptCount: number;
}

interface TestAnalyticsData {
  test: {
    _id: string;
    title: string;
    subject: any;
    testType: string;
    totalMarks: number;
    totalQuestions: number;
  };
  overview: {
    totalAssigned: number;
    totalAttempted: number;
    completionRate: number;
    avgScore: number;
    highestScore: number;
    lowestScore: number;
  };
  performanceMetrics: {
    totalQuestions: number;
    avgCorrect: string | number;
    avgWrong: string | number;
    avgSkipped: string | number;
    avgTime: number;
  };
  questionAnalytics: any[];
  studentPerformance: any[];
}

export default function Analytics() {
  const { user } = useAuth();
  const router = useRouter();

  // Tab state
  const [activeTab, setActiveTab] = useState<'test' | 'student' | 'heatmap'>('test');

  // Test Analytics state
  const [tests, setTests] = useState<TestListItem[]>([]);
  const [selectedTest, setSelectedTest] = useState<TestListItem | null>(null);
  const [testAnalytics, setTestAnalytics] = useState<TestAnalyticsData | null>(null);
  const [loadingTests, setLoadingTests] = useState(false);
  const [loadingTestAnalytics, setLoadingTestAnalytics] = useState(false);

  // Student Analytics state
  const [searchQuery, setSearchQuery] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [studentAnalytics, setStudentAnalytics] = useState<StudentAnalytics | null>(null);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [loadingStudentAnalytics, setLoadingStudentAnalytics] = useState(false);

  // Subject-wise report for selected student
  const [subjectReport, setSubjectReport] = useState<SubjectPerformance[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);

  // Heat map state
  const [heatmapData, setHeatmapData] = useState<any>(null);
  const [loadingHeatmap, setLoadingHeatmap] = useState(false);

  // Modal state
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    if (activeTab === 'test') {
      fetchTests();
    } else if (activeTab === 'student') {
      fetchStudents();
    } else if (activeTab === 'heatmap') {
      fetchHeatmap();
    }
  }, [activeTab]);

  useEffect(() => {
    const query = searchQuery.toLowerCase();
    setFilteredStudents(
      students.filter(s =>
        s.name.toLowerCase().includes(query) ||
        s.email.toLowerCase().includes(query)
      )
    );
  }, [searchQuery, students]);

  useEffect(() => {
    if (selectedTest) {
      fetchTestAnalytics(selectedTest._id);
    }
  }, [selectedTest]);

  const fetchTests = async () => {
    setLoadingTests(true);
    try {
      const response = await api.get('/quizzes/analytics/tests/list');
      setTests(response.data.tests || []);
    } catch (error) {
      console.error('Error fetching tests:', error);
      setTests([]);
    } finally {
      setLoadingTests(false);
    }
  };

  const fetchTestAnalytics = async (testId: string) => {
    setLoadingTestAnalytics(true);
    try {
      const response = await api.get(`/quizzes/analytics/test/${testId}`);
      setTestAnalytics(response.data);
    } catch (error) {
      console.error('Error fetching test analytics:', error);
      setTestAnalytics(null);
    } finally {
      setLoadingTestAnalytics(false);
    }
  };

  const fetchStudents = async () => {
    setLoadingStudents(true);
    try {
      const response = await api.get('/users?role=student');
      const data = Array.isArray(response.data) ? response.data : [];
      const studentsOnly = data.filter((u: any) => u.role === 'student');
      setStudents(studentsOnly);
      setFilteredStudents(studentsOnly);
    } catch (error) {
      console.error('Error fetching students:', error);
      setStudents([]);
      setFilteredStudents([]);
    } finally {
      setLoadingStudents(false);
    }
  };

  const fetchStudentAnalytics = async (studentId: string) => {
    setLoadingStudentAnalytics(true);
    try {
      const response = await api.get(`/quizzes/analytics/student/${studentId}`);
      setStudentAnalytics(response.data);
    } catch (error) {
      console.error('Error fetching analytics:', error);
      setStudentAnalytics(null);
    } finally {
      setLoadingStudentAnalytics(false);
    }
  };

  const handleSelectStudent = (student: Student) => {
    setSelectedStudent(student);
    fetchStudentAnalytics(student._id);
  };

  const handleStudentAttemptClick = (attemptId: string) => {
    setSelectedAttemptId(attemptId);
    setModalVisible(true);
  };

  const fetchSubjectReport = async (studentId: string) => {
    setLoadingSubjects(true);
    try {
      const response = await api.get(`/quizzes/analytics/student/${studentId}/subjects`);
      setSubjectReport(response.data.subjects || []);
    } catch (error) {
      console.error('Error fetching subject report:', error);
      setSubjectReport([]);
    } finally {
      setLoadingSubjects(false);
    }
  };

  const fetchHeatmap = async () => {
    setLoadingHeatmap(true);
    try {
      const response = await api.get('/quizzes/analytics/heatmap');
      setHeatmapData(response.data);
    } catch (error) {
      console.error('Error fetching heatmap:', error);
      setHeatmapData(null);
    } finally {
      setLoadingHeatmap(false);
    }
  };

  const handleDownloadCSV = async () => {
    if (!selectedTest) return;
    try {
      const baseURL = api.defaults.baseURL || '';
      // Extract the bearer token from the axios instance
      const authHeader = api.defaults.headers.common['Authorization'] as string;
      const token = authHeader ? authHeader.replace('Bearer ', '') : '';
      
      // Append the token as a query parameter so the backend auth middleware can read it
      const url = `${baseURL}/quizzes/analytics/test-report/${selectedTest._id}/csv?token=${token}`;
      
      // Open in browser to trigger the download
      Linking.openURL(url);
    } catch (error) {
      Alert.alert('Error', 'Failed to download CSV');
    }
  };

  // When selecting a student, also fetch their subject report
  const handleSelectStudentEnhanced = (student: Student) => {
    setSelectedStudent(student);
    fetchStudentAnalytics(student._id);
    fetchSubjectReport(student._id);
  };

  if (user?.role !== 'admin') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Admin access required</Text>
      </SafeAreaView>
    );
  }

  const tabs = [
    { key: 'test', label: 'Test Analytics' },
    { key: 'student', label: 'Student Analytics' },
    { key: 'heatmap', label: 'Heat Map' }
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <ChevronLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Analytics</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Tab Switcher */}
      <TabSwitcher
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as 'test' | 'student' | 'heatmap')}
      />

      {/* Content */}
      {activeTab === 'test' ? (
        // TEST ANALYTICS TAB
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <TestDropdown
            tests={tests}
            selectedTest={selectedTest}
            onTestSelect={setSelectedTest}
            loading={loadingTests}
          />

          {selectedTest && (
            <>
              {loadingTestAnalytics ? (
                <ActivityIndicator color="#01b4ae" style={{ marginTop: 40 }} />
              ) : testAnalytics ? (
                <>
                  <TestOverview
                    overview={testAnalytics.overview}
                    totalMarks={testAnalytics.test.totalMarks}
                  />
                  <PerformanceMetrics metrics={testAnalytics.performanceMetrics} />

                  {/* Download CSV Button */}
                  <TouchableOpacity
                    style={styles.downloadButton}
                    onPress={handleDownloadCSV}
                  >
                    <Download color="#FFF" size={18} />
                    <Text style={styles.downloadButtonText}>Download Report (CSV)</Text>
                  </TouchableOpacity>

                  <QuestionAnalytics questions={testAnalytics.questionAnalytics} />
                  <StudentPerformanceList
                    students={testAnalytics.studentPerformance}
                    onStudentClick={handleStudentAttemptClick}
                  />
                </>
              ) : (
                <View style={styles.emptyContainer}>
                  <AlertTriangle color="#9CA3AF" size={48} />
                  <Text style={styles.emptyText}>Failed to load analytics</Text>
                </View>
              )}
            </>
          )}

          {!selectedTest && !loadingTests && (
            <View style={styles.emptyContainer}>
              <BookOpen color="#9CA3AF" size={48} />
              <Text style={styles.emptyText}>Select a test to view analytics</Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      ) : activeTab === 'student' ? (
        // STUDENT ANALYTICS TAB
        <View style={styles.content}>
          {!selectedStudent ? (
            <>
              <View style={styles.searchContainer}>
                <Search color="#6B7280" size={20} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search students by name or email..."
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>

              <View style={styles.studentList}>
                <Text style={styles.listTitle}>Select a Student</Text>
                {loadingStudents ? (
                  <ActivityIndicator color="#01b4ae" style={{ marginTop: 20 }} />
                ) : (
                  <FlatList
                    data={filteredStudents}
                    keyExtractor={item => item._id}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={styles.studentItem}
                        onPress={() => handleSelectStudentEnhanced(item)}
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
            </>
          ) : (
            <ScrollView style={styles.analyticsContainer} showsVerticalScrollIndicator={false}>
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

              {loadingStudentAnalytics ? (
                <ActivityIndicator color="#01b4ae" style={{ marginTop: 40 }} />
              ) : studentAnalytics ? (
                <>
                  <View style={styles.summaryContainer}>
                    <View style={styles.summaryCard}>
                      <BookOpen color="#2563EB" size={24} />
                      <Text style={styles.summaryNumber}>{studentAnalytics.summary.totalTests}</Text>
                      <Text style={styles.summaryLabel}>Tests Taken</Text>
                    </View>
                    <View style={styles.summaryCard}>
                      <TrendingUp color="#10B981" size={24} />
                      <Text style={styles.summaryNumber}>{studentAnalytics.summary.avgPercentage}%</Text>
                      <Text style={styles.summaryLabel}>Average</Text>
                    </View>
                    <View style={styles.summaryCard}>
                      <Text style={[styles.summaryNumber, { fontSize: 20 }]}>
                        {studentAnalytics.summary.obtainedMarks}/{studentAnalytics.summary.totalMarks}
                      </Text>
                      <Text style={styles.summaryLabel}>Total Marks</Text>
                    </View>
                  </View>

                  {/* Subject-Wise Performance */}
                  <Text style={styles.sectionTitle}>Subject-Wise Performance</Text>
                  {loadingSubjects ? (
                    <ActivityIndicator color="#01b4ae" style={{ marginTop: 12 }} />
                  ) : subjectReport.length > 0 ? (
                    subjectReport.map(sub => (
                      <TouchableOpacity
                        key={sub.subjectId}
                        style={styles.subjectCard}
                        onPress={() => setExpandedSubject(
                          expandedSubject === sub.subjectId ? null : sub.subjectId
                        )}
                        activeOpacity={0.7}
                      >
                        <View style={styles.subjectHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.subjectName}>{sub.subjectName}</Text>
                            <Text style={styles.subjectMeta}>
                              {sub.tests} tests • {sub.totalCorrect}/{sub.totalQuestions} correct
                            </Text>
                          </View>
                          <View style={[
                            styles.subjectPctBadge,
                            { backgroundColor: sub.percentage >= 60 ? '#D1FAE5' : '#FEE2E2' }
                          ]}>
                            <Text style={[
                              styles.subjectPctText,
                              { color: sub.percentage >= 60 ? '#059669' : '#DC2626' }
                            ]}>
                              {sub.percentage}%
                            </Text>
                          </View>
                        </View>
                        <View style={styles.progressBarBg}>
                          <View style={[
                            styles.progressBarFill,
                            { width: `${Math.min(sub.percentage, 100)}%`, backgroundColor: sub.percentage >= 60 ? '#10B981' : '#EF4444' }
                          ]} />
                        </View>
                        {expandedSubject === sub.subjectId && sub.attempts.length > 0 && (
                          <View style={styles.subjectAttempts}>
                            {sub.attempts.map((att: any, i: number) => (
                              <TouchableOpacity
                                key={i}
                                style={styles.subjectAttemptRow}
                                onPress={() => handleStudentAttemptClick(att._id)}
                              >
                                <Text style={styles.subjectAttemptTitle} numberOfLines={1}>{att.quizTitle}</Text>
                                <Text style={[
                                  styles.subjectAttemptPct,
                                  { color: att.percentage >= 60 ? '#10B981' : '#EF4444' }
                                ]}>{att.percentage}%</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}
                      </TouchableOpacity>
                    ))
                  ) : (
                    <Text style={{ color: '#9CA3AF', textAlign: 'center', marginTop: 12 }}>No subject data available</Text>
                  )}

                  <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Test History</Text>
                  {studentAnalytics.attempts.length > 0 ? (
                    studentAnalytics.attempts.map((attempt, index) => (
                      <TouchableOpacity
                        key={index}
                        style={styles.attemptCard}
                        onPress={() => handleStudentAttemptClick(attempt._id)}
                      >
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
                      </TouchableOpacity>
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
      ) : (
        // HEAT MAP TAB
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {loadingHeatmap ? (
            <ActivityIndicator color="#01b4ae" style={{ marginTop: 60 }} />
          ) : heatmapData ? (
            <View style={{ padding: 16 }}>
              <Text style={styles.sectionTitle}>Performance Heat Map</Text>
              <Text style={{ color: '#6B7280', fontSize: 13, marginBottom: 16 }}>
                Students × Tests • Color indicates accuracy percentage
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={true}>
                <View>
                  <View style={{ flexDirection: 'row' }}>
                    <View style={[styles.heatCell, styles.heatHeaderCell, { width: 120 }]}>
                      <Text style={styles.heatHeaderText}>Student</Text>
                    </View>
                    {heatmapData.tests.map((t: any) => (
                      <View key={t._id} style={[styles.heatCell, styles.heatHeaderCell]}>
                        <Text style={styles.heatHeaderText} numberOfLines={2}>{t.title}</Text>
                      </View>
                    ))}
                  </View>
                  {heatmapData.students.map((s: any) => (
                    <View key={s.studentId} style={{ flexDirection: 'row' }}>
                      <View style={[styles.heatCell, { width: 120, backgroundColor: '#F9FAFB' }]}>
                        <Text style={{ fontSize: 11, color: '#374151', fontWeight: '500' }} numberOfLines={1}>{s.studentName}</Text>
                      </View>
                      {heatmapData.tests.map((t: any) => {
                        const score = s.scores[t._id];
                        const bg = score === undefined ? '#F3F4F6'
                          : score >= 80 ? '#059669'
                          : score >= 60 ? '#10B981'
                          : score >= 40 ? '#FBBF24'
                          : score >= 20 ? '#F97316'
                          : '#EF4444';
                        return (
                          <View key={t._id} style={[styles.heatCell, { backgroundColor: bg }]}>
                            <Text style={{ fontSize: 11, color: score !== undefined ? '#FFF' : '#9CA3AF', fontWeight: '600' }}>
                              {score !== undefined ? `${score}%` : '—'}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.heatLegend}>
                <Text style={{ fontSize: 12, color: '#6B7280', marginRight: 8 }}>Legend:</Text>
                {[
                  { color: '#059669', label: '80%+' },
                  { color: '#10B981', label: '60-79%' },
                  { color: '#FBBF24', label: '40-59%' },
                  { color: '#F97316', label: '20-39%' },
                  { color: '#EF4444', label: '<20%' },
                  { color: '#F3F4F6', label: 'N/A' }
                ].map((item, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 10 }}>
                    <View style={{ width: 12, height: 12, backgroundColor: item.color, borderRadius: 2, marginRight: 4 }} />
                    <Text style={{ fontSize: 11, color: '#6B7280' }}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Grid3X3 color="#9CA3AF" size={48} />
              <Text style={styles.emptyText}>No heatmap data available</Text>
            </View>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Attempt Detail Modal */}
      <AttemptDetailModal
        attemptId={selectedAttemptId}
        visible={modalVisible}
        onClose={() => {
          setModalVisible(false);
          setSelectedAttemptId(null);
        }}
      />
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
  emptyContainer: {
    alignItems: 'center',
    padding: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 16,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 50,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#01b4ae',
    padding: 14,
    borderRadius: 10,
    marginHorizontal: 16,
    marginVertical: 12,
    gap: 8,
  },
  downloadButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  subjectCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
  },
  subjectHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  subjectName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  subjectMeta: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  subjectPctBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  subjectPctText: {
    fontSize: 14,
    fontWeight: '700',
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 6,
    borderRadius: 3,
  },
  subjectAttempts: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 8,
  },
  subjectAttemptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  subjectAttemptTitle: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    marginRight: 8,
  },
  subjectAttemptPct: {
    fontSize: 13,
    fontWeight: '600',
  },
  heatCell: {
    width: 70,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#E5E7EB',
  },
  heatHeaderCell: {
    backgroundColor: '#F9FAFB',
    height: 50,
  },
  heatHeaderText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
  },
  heatLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 16,
    padding: 10,
    backgroundColor: '#FFF',
    borderRadius: 8,
  },
});
