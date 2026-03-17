import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  StatusBar
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CheckCircle, XCircle, Clock, Award, BarChart3, FileText } from 'lucide-react-native';
import { api } from '@/services/api';

interface ResultData {
  attemptId: string;
  quiz: {
    title: string;
    subject: string;
    totalQuestions: number;
    totalMarks: number;
    shareSolution: boolean;  // NEW: Whether solutions are shared with students
  };
  score: number;
  marksObtained: number;
  percentage: number;
  startTime: string;
  endTime: string;
  status: string;
  sectionPerformance: Array<{
    sectionName: string;
    correct: number;
    incorrect: number;
    skipped: number;
    timeSpent: number;
    accuracy: number;
  }>;
  detailedResults: any[];
  canRequestRetest: boolean;
  retestRequested: boolean;
  retestApproved: boolean;
}

export default function QuizResult() {
  const { id, attemptId } = useLocalSearchParams();
  const router = useRouter();
  const [result, setResult] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchResults();
  }, []);

  const fetchResults = async () => {
    try {
      // groupBy=subject ensures section analysis groups by actual subject names
      const response = await api.get(`/quizzes/${id}/attempt/${attemptId}/results?groupBy=subject`);
      const data = response.data;

      // Transform backend response to match ResultData interface
      const formattedResult: ResultData = {
        attemptId: data.attempt._id,
        quiz: {
          title: data.quiz.title,
          subject: typeof data.quiz.subject === 'object' ? data.quiz.subject.name : data.quiz.subject,
          totalQuestions: data.attempt.totalQuestions,
          totalMarks: data.attempt.totalMarks,
          shareSolution: data.quiz.shareSolution !== undefined ? data.quiz.shareSolution : true
        },
        score: data.attempt.score,
        marksObtained: data.attempt.marksObtained,
        // Accuracy = marks / totalMarks to match the admin panel
        percentage: data.attempt.totalMarks > 0
          ? Math.round((data.attempt.marksObtained / data.attempt.totalMarks) * 100)
          : 0,
        startTime: data.attempt.startTime,
        endTime: data.attempt.endTime,
        status: data.attempt.status,
        sectionPerformance: data.attempt.sectionPerformance || [],
        detailedResults: data.questions || [],
        canRequestRetest: !data.attempt.retestRequested && !data.attempt.retestApproved,
        retestRequested: data.attempt.retestRequested || false,
        retestApproved: data.attempt.retestApproved || false
      };

      setResult(formattedResult);
    } catch (error: any) {
      console.error('Error fetching results:', error);
      Alert.alert('Error', 'Failed to load results');
      router.back();
    } finally {
      setLoading(false);
    }
  };

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
              fetchResults();
            } catch (error: any) {
              Alert.alert('Error', error.response?.data?.message || 'Failed to request retest');
            }
          }
        }
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
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#2563EB" />
      </SafeAreaView>
    );
  }

  if (!result) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Results not found</Text>
      </SafeAreaView>
    );
  }

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    }
    return `${minutes}m ${secs}s`;
  };

  // Calculate section accuracy with fallback for backward compatibility
  const sectionPerformanceWithAccuracy = result.sectionPerformance.map(section => {
    const totalQuestionsInSection = section.correct + section.incorrect + section.skipped;
    const accuracy = section.accuracy !== undefined
      ? section.accuracy
      : (totalQuestionsInSection > 0 ? Math.round((section.correct / totalQuestionsInSection) * 100) : 0);

    return {
      ...section,
      accuracy
    };
  });

  const totalTimeSpent = sectionPerformanceWithAccuracy.reduce((sum, section) => sum + section.timeSpent, 0);
  const correctCount = sectionPerformanceWithAccuracy.reduce((sum, section) => sum + section.correct, 0);
  const incorrectCount = sectionPerformanceWithAccuracy.reduce((sum, section) => sum + section.incorrect, 0);
  const skippedCount = sectionPerformanceWithAccuracy.reduce((sum, section) => sum + section.skipped, 0);
  const markedCount = result.detailedResults.filter(r => r.markedForReview).length;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{result.quiz.title}</Text>
          <Text style={styles.subtitle}>
            {new Date(result.endTime).toLocaleDateString()} • {new Date(result.endTime).toLocaleTimeString()}
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
            {/* View Solutions Button - Only show if shareSolution is true */}
            {result.quiz.shareSolution && (
              <TouchableOpacity style={styles.solutionsButton} onPress={handleViewSolutions}>
                <FileText color="#2563EB" size={20} />
                <Text style={styles.solutionsButtonText}>View Solutions</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Score Card */}
        <View style={styles.scoreCard}>
          <View style={styles.scoreIconContainer}>
            {result.percentage >= 50 ? (
              <CheckCircle color="#10B981" size={64} />
            ) : (
              <XCircle color="#EF4444" size={64} />
            )}
          </View>
          <Text style={styles.scoreText}>
            {result.score}/{result.quiz.totalQuestions}
          </Text>
          <Text style={styles.scoreSubtext}>Questions Correct</Text>
          <View style={styles.percentageContainer}>
            <Text style={[
              styles.percentageText,
              result.percentage >= 50 ? styles.passPercentage : styles.failPercentage
            ]}>
              {result.percentage}%
            </Text>
          </View>
        </View>

        {/* Metrics Grid */}
        <View style={styles.metricsContainer}>
          <View style={styles.metricCard}>
            <CheckCircle color="#10B981" size={24} />
            <Text style={styles.metricValue}>{correctCount}</Text>
            <Text style={styles.metricLabel}>Correct</Text>
          </View>

          <View style={styles.metricCard}>
            <XCircle color="#EF4444" size={24} />
            <Text style={styles.metricValue}>{incorrectCount}</Text>
            <Text style={styles.metricLabel}>Incorrect</Text>
          </View>

          <View style={styles.metricCard}>
            <Clock color="#F59E0B" size={24} />
            <Text style={styles.metricValue}>{skippedCount}</Text>
            <Text style={styles.metricLabel}>Skipped</Text>
          </View>
        </View>

        <View style={styles.metricsContainer}>
          <View style={styles.metricCard}>
            <BarChart3 color="#6B7280" size={24} />
            <Text style={styles.metricValue}>{markedCount}</Text>
            <Text style={styles.metricLabel}>Marked for Review</Text>
          </View>

          <View style={styles.metricCard}>
            <Award color="#8B5CF6" size={24} />
            <Text style={styles.metricValue}>{result.percentage}%</Text>
            <Text style={styles.metricLabel}>Accuracy</Text>
          </View>

          <View style={styles.metricCard}>
            <Clock color="#3B82F6" size={24} />
            <Text style={styles.metricValue}>{formatTime(totalTimeSpent)}</Text>
            <Text style={styles.metricLabel}>Time Taken</Text>
          </View>
        </View>

        {/* Section Performance */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Section Performance</Text>
          <View style={styles.tableContainer}>
            {/* Table Header */}
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, styles.colSection]}>Section</Text>
              <Text style={[styles.tableHeaderText, styles.colStat]}>Correct</Text>
              <Text style={[styles.tableHeaderText, styles.colStat]}>Wrong</Text>
              <Text style={[styles.tableHeaderText, styles.colStat]}>Skip</Text>
              <Text style={[styles.tableHeaderText, styles.colStat]}>Acc%</Text>
              <Text style={[styles.tableHeaderText, styles.colTime]}>Time</Text>
            </View>

            {/* Table Rows */}
            {sectionPerformanceWithAccuracy.map((section, index) => (
              <View key={index} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.colSection]} numberOfLines={1}>
                  {section.sectionName}
                </Text>
                <Text style={[styles.tableCell, styles.colStat, styles.correctText]}>
                  {section.correct}
                </Text>
                <Text style={[styles.tableCell, styles.colStat, styles.incorrectText]}>
                  {section.incorrect}
                </Text>
                <Text style={[styles.tableCell, styles.colStat, styles.skippedText]}>
                  {section.skipped}
                </Text>
                <Text style={[styles.tableCell, styles.colStat]}>
                  {section.accuracy}%
                </Text>
                <Text style={[styles.tableCell, styles.colTime]}>
                  {formatTime(section.timeSpent)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Bottom Button */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.backButton} onPress={handleBackToQuizzes}>
          <Text style={styles.backButtonText}>Back to Quizzes</Text>
        </TouchableOpacity>
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
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
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
  percentageContainer: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  percentageText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  passPercentage: {
    color: '#10B981',
  },
  failPercentage: {
    color: '#EF4444',
  },
  metricsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
    marginTop: 8,
  },
  metricLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
    textAlign: 'center',
  },
  section: {
    margin: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 12,
  },
  tableContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  tableHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F2937',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  tableCell: {
    fontSize: 13,
    color: '#4B5563',
  },
  colSection: {
    flex: 2,
  },
  colStat: {
    flex: 1,
    textAlign: 'center',
  },
  colTime: {
    flex: 1.2,
    textAlign: 'right',
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
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
  },
});
