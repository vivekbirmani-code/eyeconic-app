import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  StatusBar
} from 'react-native';
import { CheckCircle, XCircle, Clock } from 'lucide-react-native';
import { api } from '@/services/api';

interface RetestRequest {
  _id: string;
  student: {
    _id: string;
    name: string;
    email: string;
  };
  quiz: {
    _id: string;
    title: string;
    subject: string;
  };
  score: number;
  totalQuestions: number;
  marksObtained: number;
  totalMarks: number;
  completedAt: string;
}

export default function RetestRequests() {
  const [requests, setRequests] = useState<RetestRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      const response = await api.get('/quizzes/retest-requests/pending');
      setRequests(response.data);
    } catch (error) {
      Alert.alert('Error', 'Failed to load retest requests');
    } finally {
      setLoading(false);
    }
  };

  const handleDecision = async (attemptId: string, approved: boolean) => {
    setProcessing(attemptId);
    try {
      await api.put(`/quizzes/attempt/${attemptId}/retest-decision`, { approved });
      
      Alert.alert(
        'Success',
        `Retest request ${approved ? 'approved' : 'rejected'}`,
        [{ text: 'OK', onPress: () => fetchRequests() }]
      );
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to process request');
    } finally {
      setProcessing(null);
    }
  };

  const renderRequest = ({ item }: { item: RetestRequest }) => {
    const percentage = Math.round((item.marksObtained / item.totalMarks) * 100);
    const isProcessing = processing === item._id;

    return (
      <View style={styles.requestCard}>
        <View style={styles.requestHeader}>
          <View style={styles.studentInfo}>
            <Text style={styles.studentName}>{item.student.name}</Text>
            <Text style={styles.studentEmail}>{item.student.email}</Text>
          </View>
          <View style={styles.scoreContainer}>
            <Text style={[
              styles.percentage,
              percentage >= 50 ? styles.passPercentage : styles.failPercentage
            ]}>
              {percentage}%
            </Text>
          </View>
        </View>

        <View style={styles.quizInfo}>
          <Text style={styles.quizTitle}>{item.quiz.title}</Text>
          <Text style={styles.quizSubject}>{item.quiz.subject}</Text>
        </View>

        <View style={styles.stats}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Score</Text>
            <Text style={styles.statValue}>
              {item.score}/{item.totalQuestions}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Marks</Text>
            <Text style={styles.statValue}>
              {item.marksObtained}/{item.totalMarks}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Completed</Text>
            <Text style={styles.statValue}>
              {new Date(item.completedAt).toLocaleDateString()}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.rejectButton]}
            onPress={() => handleDecision(item._id, false)}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <XCircle color="#FFFFFF" size={18} />
                <Text style={styles.actionButtonText}>Reject</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.approveButton]}
            onPress={() => handleDecision(item._id, true)}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <CheckCircle color="#FFFFFF" size={18} />
                <Text style={styles.actionButtonText}>Approve</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#2563EB" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Retest Requests</Text>
        <Text style={styles.subtitle}>
          {requests.length} pending {requests.length === 1 ? 'request' : 'requests'}
        </Text>
      </View>

      <FlatList
        data={requests}
        renderItem={renderRequest}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Clock color="#9CA3AF" size={64} />
            <Text style={styles.emptyText}>No pending requests</Text>
          </View>
        }
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
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
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
  list: {
    padding: 20,
    gap: 16,
  },
  requestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  studentInfo: {
    flex: 1,
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
  scoreContainer: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  percentage: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  passPercentage: {
    color: '#10B981',
  },
  failPercentage: {
    color: '#EF4444',
  },
  quizInfo: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  quizTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
  },
  quizSubject: {
    fontSize: 13,
    color: '#2563EB',
    fontWeight: '500',
    marginTop: 2,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
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
  },
  rejectButton:{
    backgroundColor: '#EF4444',
  },
  approveButton: {
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
