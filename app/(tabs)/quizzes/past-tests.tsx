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
  Trash2,
  FileText,
} from 'lucide-react-native';
import { colors, testTypeTints } from '@/utils/theme';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import ShareQuizModal from '@/components/ShareQuizModal';
import DeleteQuizModal, { DeleteQuizTarget } from '@/components/DeleteQuizModal';

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

  // Delete modal state
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [quizToDelete, setQuizToDelete] = useState<Quiz | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const openDeleteModal = (quiz: Quiz) => {
    setQuizToDelete(quiz);
    setDeleteModalVisible(true);
  };

  const handleConfirmDelete = async (quiz: DeleteQuizTarget) => {
    try {
      setDeleting(true);
      await api.delete(`/quizzes/${quiz._id}`);
      setDeleteModalVisible(false);
      setQuizToDelete(null);
      // Immediately remove from local state
      setQuizzes(prev => prev.filter(q => q._id !== quiz._id));
      setFilteredQuizzes(prev => prev.filter(q => q._id !== quiz._id));
      Alert.alert('Success', 'Test deleted successfully');
    } catch (error: any) {
      console.error('Delete error:', error);
      const message = error.response?.data?.message || 'Something went wrong while deleting this test. Please try again.';
      Alert.alert('Unable to delete test', message);
    } finally {
      setDeleting(false);
    }
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
          <ActivityIndicator color={colors.primary} style={{ marginTop: 50 }} />
        ) : filteredQuizzes.length === 0 ? (
          <View style={styles.emptyContainer}>
            <FileText color={colors.textMuted} size={48} />
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
                  <Share2 color={colors.primary} size={20} />
                  <Text style={[styles.actionButtonText, styles.shareBtnText]}>Share</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, styles.deleteBtn]}
                  onPress={() => openDeleteModal(quiz)}
                >
                  <Trash2 color="#EF4444" size={20} />
                  <Text style={[styles.actionButtonText, styles.deleteBtnText]}>Delete</Text>
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

      {/* Delete Confirmation Modal */}
      <DeleteQuizModal
        visible={deleteModalVisible}
        quiz={quizToDelete}
        deleting={deleting}
        onClose={() => {
          if (!deleting) {
            setDeleteModalVisible(false);
            setQuizToDelete(null);
          }
        }}
        onConfirmDelete={handleConfirmDelete}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.primary,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
  },
  searchContainer: {
    padding: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
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
    gap: 16,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: colors.danger,
    textAlign: 'center',
    marginTop: 50,
  },
  quizCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
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
    color: colors.text,
    marginBottom: 8,
  },
  quizMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  // Badge geometry/tints mirror Analytics' test list (TestDropdown)
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.bg,
  },
  dailyBadge: {
    backgroundColor: testTypeTints.daily,
  },
  weeklyBadge: {
    backgroundColor: testTypeTints.weekly,
  },
  grandBadge: {
    backgroundColor: testTypeTints.grand,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textBody,
    textTransform: 'capitalize',
  },
  subjectText: {
    fontSize: 13,
    color: colors.textSecondary,
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
    color: colors.textSecondary,
  },
  dateText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
  actionButtons: {
    flexDirection: 'column',
    gap: 8,
    justifyContent: 'center',
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: colors.bg,
  },
  actionButton: {
    alignItems: 'center',
    gap: 2,
  },
  actionButtonText: {
    fontSize: 11,
    color: '#4B5563',
    fontWeight: '500',
  },
  shareBtn: {},
  shareBtnText: {
    color: colors.primary,
  },
  deleteBtn: {},
  deleteBtnText: {
    color: colors.danger,
  },
});
