import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
  StatusBar,
  Alert,
  Modal
} from 'react-native';
import { useRouter } from 'expo-router';
import { 
  ChevronLeft,
  Search,
  Share2,
  Clock,
  Users,
  Check,
  X,
  Copy,
  Edit
} from 'lucide-react-native';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';

interface Quiz {
  _id: string;
  title: string;
  testType: string;
  subject: { name: string } | null;
  assignedStudents: string[];
  createdAt: string;
  duration: number;
  questions: string[];
}

interface Student {
  _id: string;
  name: string;
  email: string;
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
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    fetchQuizzes();
    fetchStudents();
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

  const fetchStudents = async () => {
    try {
      const response = await api.get('/users?role=student');
      setStudents(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error fetching students:', error);
      setStudents([]);
    }
  };

  const openShareModal = (quiz: Quiz) => {
    setSelectedQuiz(quiz);
    // Pre-filter out already assigned students
    setSelectedStudents([]);
    setStudentSearch('');
    setShareModalVisible(true);
  };

  const toggleStudent = (studentId: string) => {
    if (selectedStudents.includes(studentId)) {
      setSelectedStudents(selectedStudents.filter(id => id !== studentId));
    } else {
      setSelectedStudents([...selectedStudents, studentId]);
    }
  };

  const handleShare = async () => {
    if (!selectedQuiz || selectedStudents.length === 0) {
      Alert.alert('Error', 'Please select at least one student');
      return;
    }

    setSharing(true);
    try {
      const response = await api.put(`/quizzes/${selectedQuiz._id}/share`, {
        studentIds: selectedStudents
      });

      Alert.alert('Success', response.data.message);
      setShareModalVisible(false);
      fetchQuizzes(); // Refresh the list
    } catch (error: any) {
      console.error('Share error:', error);
      Alert.alert('Error', error.response?.data?.message || 'Failed to share quiz');
    } finally {
      setSharing(false);
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
              const response = await api.post(`/quizzes/${quiz._id}/duplicate`);
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

  const getAvailableStudents = () => {
    if (!selectedQuiz) return [];
    const query = studentSearch.toLowerCase();
    return students.filter(s => {
      // Filter out already assigned students
      const alreadyAssigned = selectedQuiz.assignedStudents.includes(s._id);
      if (alreadyAssigned) return false;
      // Filter by search
      if (query) {
        return s.name.toLowerCase().includes(query) || s.email.toLowerCase().includes(query);
      }
      return true;
    });
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
                  {quiz.subject?.name && (
                    <Text style={styles.subjectText}>{quiz.subject.name}</Text>
                  )}
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
                  onPress={() => router.push({ pathname: '/admin/edit-quiz', params: { id: quiz._id } })}
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
      <Modal
        visible={shareModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShareModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Share Quiz</Text>
              <TouchableOpacity onPress={() => setShareModalVisible(false)}>
                <X color="#6B7280" size={24} />
              </TouchableOpacity>
            </View>

            {selectedQuiz && (
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                {selectedQuiz.title}
              </Text>
            )}

            <View style={styles.modalSearchInput}>
              <Search color="#6B7280" size={18} />
              <TextInput
                style={styles.modalSearchTextInput}
                placeholder="Search students..."
                value={studentSearch}
                onChangeText={setStudentSearch}
              />
            </View>

            <Text style={styles.selectedCount}>
              {selectedStudents.length} student(s) selected
            </Text>

            <ScrollView style={styles.studentList}>
              {getAvailableStudents().length === 0 ? (
                <Text style={styles.noStudentsText}>
                  {studentSearch ? 'No matching students' : 'All students already have access'}
                </Text>
              ) : (
                getAvailableStudents().map(student => (
                  <TouchableOpacity
                    key={student._id}
                    style={[
                      styles.studentItem,
                      selectedStudents.includes(student._id) && styles.studentItemSelected
                    ]}
                    onPress={() => toggleStudent(student._id)}
                  >
                    <View style={[
                      styles.checkbox,
                      selectedStudents.includes(student._id) && styles.checkboxSelected
                    ]}>
                      {selectedStudents.includes(student._id) && <Check color="#FFF" size={14} />}
                    </View>
                    <View style={styles.studentInfo}>
                      <Text style={styles.studentName}>{student.name}</Text>
                      <Text style={styles.studentEmail}>{student.email}</Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.shareConfirmButton, (sharing || selectedStudents.length === 0) && styles.buttonDisabled]}
              onPress={handleShare}
              disabled={sharing || selectedStudents.length === 0}
            >
              {sharing ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.shareConfirmText}>Share with {selectedStudents.length} Student(s)</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
  },
  modalSearchInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 12,
  },
  modalSearchTextInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
  },
  selectedCount: {
    fontSize: 14,
    color: '#2563EB',
    fontWeight: '500',
    marginBottom: 12,
  },
  studentList: {
    maxHeight: 300,
    marginBottom: 16,
  },
  noStudentsText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    paddingVertical: 20,
  },
  studentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#F9FAFB',
    gap: 12,
  },
  studentItemSelected: {
    backgroundColor: '#EBF5FF',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1F2937',
  },
  studentEmail: {
    fontSize: 12,
    color: '#6B7280',
  },
  shareConfirmButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  shareConfirmText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
