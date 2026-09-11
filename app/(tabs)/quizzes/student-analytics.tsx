import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
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
  Grid3X3
} from 'lucide-react-native';
import { api } from '@/services/api';
import { downloadApiReport, getReportDownloadErrorMessage } from '@/services/downloads';
import { useAuth } from '@/context/AuthContext';
import TabSwitcher from '@/components/analytics/TabSwitcher';
import TestDropdown from '@/components/analytics/test-analytics/TestDropdown';
import TestOverview from '@/components/analytics/test-analytics/TestOverview';
import PerformanceMetrics from '@/components/analytics/test-analytics/PerformanceMetrics';
import QuestionAnalytics from '@/components/analytics/test-analytics/QuestionAnalytics';
import StudentPerformanceList from '@/components/analytics/test-analytics/StudentPerformanceList';
import GuestParticipantList, { type GuestParticipant } from '@/components/analytics/GuestParticipantList';
import AttemptDetailModal from '@/components/analytics/AttemptDetailModal';
import QuestionBankPerformance from '@/components/analytics/QuestionBankPerformance';
import AnalyticsKpiGrid from '@/components/analytics/AnalyticsKpiGrid';
import DateRangeFilter from '@/components/analytics/DateRangeFilter';
import ScoreLegend from '@/components/analytics/ScoreLegend';
import PerformanceTrend from '@/components/analytics/PerformanceTrend';
import ScoreDistribution from '@/components/analytics/ScoreDistribution';
import {
  DateRange,
  StudentAnalyticsSummary,
  StudentPerformanceResponse,
  StudentPerformanceAttempt,
  StudentPerformanceBreakdown,
  TrendPoint,
  AnalyticsInsight,
  TestOverviewData,
  ScoreDistributionBucket,
  formatPercent,
} from '@/types/analytics';
import { FrequentlyMissedSection } from '@/components/quiz/FrequentlyMissedSection';
import { FrequentlyMissedQuestion } from '@/types/quiz-result';

interface Student {
  _id: string;
  name: string;
  email: string;
}

interface AttemptSummary extends StudentPerformanceAttempt {}

interface StudentAnalytics extends Pick<StudentPerformanceResponse, 'summary' | 'attempts' | 'trend' | 'insights' | 'frequentlyMissedQuestions' | 'pagination'> {}

interface SubjectPerformance {
  subjectId: string;
  subjectName: string;
  tests: number;
  totalMarks: number;
  obtainedMarks: number;
  totalCorrect: number;
  totalIncorrect?: number;
  totalSkipped?: number;
  totalAttempted?: number;
  totalQuestions: number;
  scorePercentage?: number | null;
  accuracy?: number | null;
  percentage: number;
  attempts: any[];
}

interface TestListItem {
  _id: string;
  title: string;
  testType: string;
  assignedCount: number;
  attemptCount: number;
  // Admin-only: completed public-quiz guest attempts (mentors never get it).
  guestAttemptCount?: number | null;
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
  overview: TestOverviewData;
  performanceMetrics: {
    totalQuestions: number;
    avgCorrect: string | number;
    avgWrong: string | number;
    avgSkipped: string | number;
    avgTime: number;
  };
  questionAnalytics: any[];
  scoreDistribution?: ScoreDistributionBucket[];
  easiestQuestion?: any;
  hardestQuestion?: any;
  studentPerformance: any[];
  // Admin-only: unranked public-quiz guests (never inside studentPerformance)
  guestParticipants?: GuestParticipant[];
}

export default function Analytics() {
  const { user } = useAuth();
  const router = useRouter();

  const formatMarks = (value: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return Number(num.toFixed(2)).toString();
  };

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

  // Question Bank metadata performance (Subject/Topic/Subtopic/System/Type/Tag/Difficulty)
  const [qbPerformance, setQbPerformance] = useState<StudentPerformanceBreakdown | null>(null);
  const [loadingQbPerformance, setLoadingQbPerformance] = useState(false);

  // Heat map state
  const [heatmapData, setHeatmapData] = useState<any>(null);
  const [loadingHeatmap, setLoadingHeatmap] = useState(false);

  // Modal state
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>(null);

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
      if (user?.role === 'mentor') {
        const response = await api.get(`/assignments/mentor/${user._id}/students`);
        // Endpoint returns array of student objects (name, email, etc.)
        const mentorStudents = response.data || [];
        setStudents(mentorStudents);
        setFilteredStudents(mentorStudents);
      } else {
        const response = await api.get('/users?role=student');
        const data = Array.isArray(response.data) ? response.data : [];
        const studentsOnly = data.filter((u: any) => u.role === 'student');
        setStudents(studentsOnly);
        setFilteredStudents(studentsOnly);
      }
    } catch (error) {
      console.error('Error fetching students:', error);
      setStudents([]);
      setFilteredStudents([]);
    } finally {
      setLoadingStudents(false);
    }
  };

  const fetchStudentAnalytics = async (studentId: string, range: DateRange = dateRange) => {
    setLoadingStudentAnalytics(true);
    try {
      const params = range ? { range } : undefined;
      const response = await api.get(`/quizzes/analytics/student/${studentId}`, { params });
      setStudentAnalytics(response.data);
    } catch (error) {
      console.error('Error fetching analytics:', error);
      setStudentAnalytics(null);
    } finally {
      setLoadingStudentAnalytics(false);
    }
  };


  const handleStudentAttemptClick = (attemptId: string) => {
    setSelectedAttemptId(attemptId);
    setModalVisible(true);
  };

  const fetchSubjectReport = async (studentId: string, range: DateRange = dateRange) => {
    setLoadingSubjects(true);
    try {
      const params = range ? { range } : undefined;
      const response = await api.get(`/quizzes/analytics/student/${studentId}/subjects`, { params });
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

  const handleDownloadReport = async () => {
    if (!selectedTest) return;
    try {
      await downloadApiReport(`/quizzes/analytics/test-report/${selectedTest._id}/excel`);
    } catch (error) {
      Alert.alert('Download failed', getReportDownloadErrorMessage(error));
    }
  };

  const handleDownloadStudentCSV = async () => {
    if (!selectedStudent) return;
    try {
      await downloadApiReport(`/quizzes/analytics/student/${selectedStudent._id}/csv`);
    } catch (error) {
      Alert.alert('Download failed', getReportDownloadErrorMessage(error));
    }
  };

  const fetchQuestionBankPerformance = async (studentId: string) => {
    setLoadingQbPerformance(true);
    try {
      const response = await api.get(`/quizzes/analytics/student/${studentId}/performance`);
      setQbPerformance(response.data || null);
    } catch (error) {
      console.error('Error fetching question bank performance:', error);
      setQbPerformance(null);
    } finally {
      setLoadingQbPerformance(false);
    }
  };

  // When selecting a student, also fetch their subject report + question-level breakdown
  const handleSelectStudentEnhanced = (student: Student) => {
    setSelectedStudent(student);
    fetchStudentAnalytics(student._id);
    fetchSubjectReport(student._id);
    fetchQuestionBankPerformance(student._id);
  };

  const handleDateRangeChange = (range: DateRange) => {
    setDateRange(range);
    if (selectedStudent) {
      fetchStudentAnalytics(selectedStudent._id, range);
      fetchSubjectReport(selectedStudent._id, range);
    }
  };

  if (user?.role !== 'admin' && user?.role !== 'mentor') {
    return (
      <ScreenContainer style={styles.container}>
        <Text style={styles.errorText}>Admin or Mentor access required</Text>
      </ScreenContainer>
    );
  }

  const tabs = [
    { key: 'test', label: 'Test Analytics' },
    { key: 'student', label: 'Student Analytics' },
  ];

  if (user?.role === 'admin') {
    tabs.push({ key: 'heatmap', label: 'Heat Map' });
  }

  return (
    <ScreenContainer style={styles.container}>
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
                  <ScoreLegend />
                  <TestOverview
                    overview={testAnalytics.overview}
                    totalMarks={testAnalytics.test.totalMarks}
                  />
                  <PerformanceMetrics metrics={testAnalytics.performanceMetrics} />

                  {testAnalytics.scoreDistribution ? (
                    <>
                      <Text style={styles.sectionTitle}>Score Distribution</Text>
                      <ScoreDistribution
                        distribution={testAnalytics.scoreDistribution}
                        totalAttempts={testAnalytics.overview.totalAttempted}
                      />
                    </>
                  ) : null}

                  {(testAnalytics.easiestQuestion || testAnalytics.hardestQuestion) ? (
                    <View style={styles.insightCard}>
                      {testAnalytics.easiestQuestion ? (
                        <Text style={styles.insightText}>
                          Easiest: Q{testAnalytics.easiestQuestion.questionNumber}
                          {testAnalytics.easiestQuestion.topicName ? ` (${testAnalytics.easiestQuestion.topicName})` : ''}
                          {' — '}{testAnalytics.easiestQuestion.correctRate}% correct
                          ({testAnalytics.easiestQuestion.correctCount}/{testAnalytics.easiestQuestion.sampleSize})
                        </Text>
                      ) : null}
                      {testAnalytics.hardestQuestion ? (
                        <Text style={styles.insightText}>
                          Hardest: Q{testAnalytics.hardestQuestion.questionNumber}
                          {testAnalytics.hardestQuestion.topicName ? ` (${testAnalytics.hardestQuestion.topicName})` : ''}
                          {' — '}{testAnalytics.hardestQuestion.correctRate}% correct
                          ({testAnalytics.hardestQuestion.correctCount}/{testAnalytics.hardestQuestion.sampleSize})
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  {/* Download Excel Report Button */}
                  <TouchableOpacity
                    style={styles.downloadButton}
                    onPress={handleDownloadReport}
                  >
                    <Download color="#FFF" size={18} />
                    <Text style={styles.downloadButtonText}>Download Report (Excel)</Text>
                  </TouchableOpacity>

                  <QuestionAnalytics questions={testAnalytics.questionAnalytics} />
                  <StudentPerformanceList
                    students={testAnalytics.studentPerformance}
                    onStudentClick={handleStudentAttemptClick}
                  />
                  {user?.role === 'admin' && (
                    <GuestParticipantList
                      participants={testAnalytics.guestParticipants ?? []}
                      onParticipantClick={handleStudentAttemptClick}
                    />
                  )}
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

              {user?.role === 'admin' && (
                <TouchableOpacity
                  style={[styles.downloadButton, styles.studentDownloadButton]}
                  onPress={handleDownloadStudentCSV}
                >
                  <Download color="#FFF" size={18} />
                  <Text style={styles.downloadButtonText}>Download Student CSV</Text>
                </TouchableOpacity>
              )}

              {loadingStudentAnalytics ? (
                <ActivityIndicator color="#01b4ae" style={{ marginTop: 40 }} />
              ) : studentAnalytics ? (
                <>
                  <DateRangeFilter value={dateRange} onChange={handleDateRangeChange} />
                  <ScoreLegend />

                  <AnalyticsKpiGrid
                    items={[
                      {
                        value: String(studentAnalytics.summary.totalTests),
                        label: 'Tests Taken',
                      },
                      {
                        value: formatPercent(studentAnalytics.summary.avgScorePercentage ?? studentAnalytics.summary.avgPercentage),
                        label: 'Score %',
                        sublabel: 'marks-based',
                      },
                      {
                        value: formatPercent(studentAnalytics.summary.avgAccuracy, 'N/A'),
                        label: 'Accuracy',
                        sublabel: studentAnalytics.summary.avgAccuracy === null ? 'No attempted questions' : 'correct / attempted',
                      },
                      {
                        value: `${formatMarks(studentAnalytics.summary.obtainedMarks)}/${formatMarks(studentAnalytics.summary.totalMarks)}`,
                        label: 'Total Marks',
                      },
                      {
                        value: String(studentAnalytics.summary.totalCorrect ?? 0),
                        label: 'Correct',
                      },
                      {
                        value: String(studentAnalytics.summary.totalIncorrect ?? 0),
                        label: 'Incorrect',
                      },
                      {
                        value: String(studentAnalytics.summary.totalSkipped ?? 0),
                        label: 'Skipped',
                      },
                      {
                        value: String(studentAnalytics.summary.totalAttempted ?? 0),
                        label: 'Attempted',
                      },
                    ]}
                  />

                  {studentAnalytics.insights && studentAnalytics.insights.length > 0 ? (
                    <View style={styles.insightCard}>
                      {studentAnalytics.insights.map((insight, idx) => (
                        <Text key={idx} style={styles.insightText}>{insight.message}</Text>
                      ))}
                    </View>
                  ) : null}

                  <Text style={styles.sectionTitle}>Performance Trend</Text>
                  <PerformanceTrend trend={studentAnalytics.trend || []} />

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
                              {sub.tests} tests • Score {formatPercent(sub.scorePercentage ?? null, 'N/A')}
                            </Text>
                            <Text style={styles.subjectMeta}>
                              Acc {formatPercent(sub.accuracy, 'N/A')} • {sub.totalCorrect}/{sub.totalAttempted ?? sub.totalQuestions} correct
                            </Text>
                          </View>
                          <View style={[
                            styles.subjectPctBadge,
                            { backgroundColor: (sub.scorePercentage ?? sub.percentage) >= 60 ? '#D1FAE5' : '#FEE2E2' }
                          ]}>
                            <Text style={[
                              styles.subjectPctText,
                              { color: (sub.scorePercentage ?? sub.percentage) >= 60 ? '#059669' : '#DC2626' }
                            ]}>
                              {formatPercent(sub.scorePercentage ?? sub.percentage)}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.progressBarBg}>
                          <View style={[
                            styles.progressBarFill,
                            { width: `${Math.min(sub.scorePercentage ?? sub.percentage ?? 0, 100)}%`, backgroundColor: (sub.scorePercentage ?? sub.percentage) >= 60 ? '#10B981' : '#EF4444' }
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
                                  { color: (att.scorePercentage ?? att.percentage) >= 60 ? '#10B981' : '#EF4444' }
                                ]}>
                                  {formatPercent(att.scorePercentage ?? att.percentage)}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}
                      </TouchableOpacity>
                    ))
                  ) : (
                    <Text style={{ color: '#9CA3AF', textAlign: 'center', marginTop: 12 }}>No subject data available</Text>
                  )}

                  {/* Question Bank Performance: Subject / Topic / Subtopic / System / Question Type / Tag / Difficulty */}
                  <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Question Bank Performance</Text>
                  {loadingQbPerformance ? (
                    <ActivityIndicator color="#01b4ae" style={{ marginTop: 12 }} />
                  ) : (
                    <QuestionBankPerformance data={qbPerformance} />
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
                            <Text style={styles.attemptStatLabel}>Score %</Text>
                            <Text style={[
                              styles.attemptStatValue,
                              (attempt.scorePercentage ?? attempt.percentage) >= 60 ? styles.passText : styles.failText
                            ]}>
                              {formatPercent(attempt.scorePercentage ?? attempt.percentage)}
                            </Text>
                          </View>
                          <View style={styles.attemptStat}>
                            <Text style={styles.attemptStatLabel}>Accuracy</Text>
                            <Text style={styles.attemptStatValue}>
                              {formatPercent(attempt.accuracy, 'N/A')}
                            </Text>
                          </View>
                          <View style={styles.attemptStat}>
                            <Text style={styles.attemptStatLabel}>Marks</Text>
                            <Text style={styles.attemptStatValue}>
                              {formatMarks(attempt.marksObtained)}/{formatMarks(attempt.totalMarks)}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.attemptCws}>
                          C {attempt.correct ?? attempt.score} / W {attempt.incorrect ?? '—'} / S {attempt.skipped ?? '—'}
                        </Text>

                        <View style={styles.attemptFooter}>
                          <View style={styles.attemptDate}>
                            <Clock color="#6B7280" size={14} />
                            <Text style={styles.attemptDateText}>
                              {new Date(attempt.endTime).toLocaleDateString()}
                            </Text>
                          </View>
                          {(attempt.tabSwitchCount ?? 0) > 0 && (
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

                  <FrequentlyMissedSection
                    questions={(studentAnalytics.frequentlyMissedQuestions || []).map((item) => ({
                      ...item,
                      latestResult: item.latestResult === 'correct' ? 'correct' : 'incorrect',
                    })) as FrequentlyMissedQuestion[]}
                  />
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
                Students × Tests • Color indicates score percentage (marks-based)
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
  insightCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 6,
  },
  insightText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
  },
  attemptCws: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 8,
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
  studentDownloadButton: {
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 16,
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
