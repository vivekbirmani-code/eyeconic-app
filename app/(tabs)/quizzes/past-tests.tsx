import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { useRouter } from 'expo-router';
import {
  ChevronLeft,
  Search,
  Share2,
  Clock,
  Users,
  X,
  Copy,
  Edit,
} from 'lucide-react-native';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import ShareQuizModal from '@/components/ShareQuizModal';

interface Quiz {
  _id: string;
  title: string;
  testType: string;
  subject: { name: string } | null;
  subjectNames?: string[];
  assignedStudents: string[];
  createdAt: string;
  duration: number;
  questions: string[];
}

export default function PastTests() {
  const { user } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [filteredQuizzes, setFilteredQuizzes] = useState<Quiz[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Share modal state
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz | null>(null);

  useEffect(() => {
    fetchQuizzes();
  }, []);

  useEffect(() => {
    const query = searchQuery.toLowerCase();
    if (!query) {
      setFilteredQuizzes(quizzes);
    } else {
      setFilteredQuizzes(
        quizzes.filter(q =>
          q.title.toLowerCase().includes(query) ||
          q.testType.toLowerCase().includes(query) ||
          q.subject?.name?.toLowerCase().includes(query)
        )
      );
    }
  }, [searchQuery, quizzes]);

  const fetchQuizzes = async () => {
    try {
      setLoading(true);
      const response = await api.get('/quizzes');
      const data = Array.isArray(response.data) ? response.data : [];
      setQuizzes(data);
      setFilteredQuizzes(data);
    } catch (error) {
      console.error('Error fetching quizzes:', error);
      setQuizzes([]);
      setFilteredQuizzes([]);
    } finally {
      setLoading(false);
    }
  };

  const openShareModal = (quiz: Quiz) => {
    setSelectedQuiz(quiz);
    setShareModalVisible(true);
  };

  const handleDuplicate = async (quiz: Quiz) => {
    Alert.alert(
      'Duplicate Quiz',
      `Create a copy of "${quiz.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Duplicate',
          onPress: async () => {
            try {
              setLoading(true);
              await api.post(`/quizzes/${quiz._id}/duplicate`);
              Alert.alert('Success', 'Quiz duplicated successfully');
              fetchQuizzes();
            } catch (error: any) {
              console.error('Duplicate error:', error);
              Alert.alert('Error', error.response?.data?.message || 'Failed to duplicate quiz');
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <ChevronLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Past Tests</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInput}>
          <Search color="#6B7280" size={20} />
          <TextInput
            style={styles.searchTextInput}
            placeholder="Search tests..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X color="#6B7280" size={18} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Quiz List */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color="#2563EB" style={{ marginTop: 50 }} />
        ) : filteredQuizzes.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {searchQuery ? 'No tests match your search' : 'No tests created yet'}
            </Text>
          </View>
        ) : (
          filteredQuizzes.map(quiz => (
            <View key={quiz._id} style={styles.quizCard}>
              <View style={styles.quizInfo}>
                <Text style={styles.quizTitle} numberOfLines={2}>{quiz.title}</Text>
                <View style={styles.quizMeta}>
                  <View style={[
                    styles.typeBadge,
                    quiz.testType === 'daily' && styles.dailyBadge,
                    quiz.testType === 'weekly' && styles.weeklyBadge,
                    quiz.testType === 'grand' && styles.grandBadge
                  ]}>
                    <Text style={styles.typeBadgeText}>{quiz.testType}</Text>
                  </View>
                  {(quiz.subjectNames?.length || quiz.subject?.name) ? (
                    <Text style={styles.subjectText}>
                      {quiz.subjectNames && quiz.subjectNames.length > 1
                        ? 'Mixed bag'
                        : `${quiz.subjectNames?.length === 1 ? quiz.subjectNames[0] : quiz.subject?.name} test`}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.quizStats}>
                  <View style={styles.statItem}>
                    <Clock color="#6B7280" size={14} />
                    <Text style={styles.statText}>{quiz.duration} min</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Users color="#6B7280" size={14} />
                    <Text style={styles.statText}>{quiz.assignedStudents?.length || 0} students</Text>
                  </View>
                </View>
                <Text style={styles.dateText}>{formatDate(quiz.createdAt)}</Text>
              </View>

              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => router.push({ pathname: '/quizzes/edit-quiz', params: { id: quiz._id } })}
                >
                  <Edit color="#4B5563" size={20} />
                  <Text style={styles.actionButtonText}>Edit</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleDuplicate(quiz)}
                >
                  <Copy color="#4B5563" size={20} />
                  <Text style={styles.actionButtonText}>Clone</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, styles.shareBtn]}
                  onPress={() => openShareModal(quiz)}
                >
                  <Share2 color="#2563EB" size={20} />
                  <Text style={[styles.actionButtonText, styles.shareBtnText]}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
        <View style={{ height: 30 }} />
      </ScrollView>

      {/* Share Modal */}
      <ShareQuizModal
        visible={shareModalVisible}
        quiz={selectedQuiz}
        onClose={() => setShareModalVisible(false)}
        onShareComplete={fetchQuizzes}
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
    backgroundColor: '#2563EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
  },
  searchContainer: {
    padding: 16,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  searchInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchTextInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 50,
  },
  emptyText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 50,
  },
  quizCard: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  quizInfo: {
    flex: 1,
  },
  quizTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 8,
  },
  quizMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
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
  subjectText: {
    fontSize: 13,
    color: '#6B7280',
  },
  quizStats: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 4,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 12,
    color: '#6B7280',
  },
  dateText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  actionButtons: {
    flexDirection: 'column',
    gap: 12,
    justifyContent: 'center',
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: '#F3F4F6',
  },
  actionButton: {
    alignItems: 'center',
    gap: 4,
  },
  actionButtonText: {
    fontSize: 11,
    color: '#4B5563',
    fontWeight: '500',
  },
  shareBtn: {},
  shareBtnText: {
    color: '#2563EB',
  },
});
