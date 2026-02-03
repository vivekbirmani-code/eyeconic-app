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
  Alert,
  Platform,
  StatusBar,
  Modal,
  Image,
  FlatList
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { 
  ChevronLeft, 
  Save, 
  Plus, 
  X, 
  Search, 
  Check,
  Eye,
  Trash2,
  Image as ImageIcon 
} from 'lucide-react-native';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';

interface Question {
  _id: string;
  qid?: string;
  question: string;
  questionImage?: string;
  options: string[];
  optionImages?: string[];
  correctAnswer?: number;
  explanation?: string;
  explanationImage?: string;
  marks: number;
  topicName?: string;
  subject: { _id: string; name: string };
  tags?: string[];
}

interface Quiz {
  _id: string;
  title: string;
  subject: { _id: string; name: string };
  testType: string;
  duration: number;
  instructions: string[];
  questions: Question[];
  totalMarks: number;
}

interface Subject {
  _id: string;
  name: string;
}

export default function EditQuiz() {
  const { user } = useAuth();
  const router = useRouter();
  const { id } = useLocalSearchParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [quiz, setQuiz] = useState<Quiz | null>(null);

  // Editable fields
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('');
  const [instructions, setInstructions] = useState('');
  const [selectedQuestions, setSelectedQuestions] = useState<Question[]>([]);

  // Question Picker Modal
  const [showQuestionPicker, setShowQuestionPicker] = useState(false);
  const [availableQuestions, setAvailableQuestions] = useState<Question[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [questionSearch, setQuestionSearch] = useState('');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [filterSubjectId, setFilterSubjectId] = useState<string>('all');

  // Question Preview Modal
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null);

  useEffect(() => {
    if (id) {
      loadQuiz();
    }
  }, [id]);

  const loadQuiz = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/quizzes/${id}`);
      const quizData = response.data;
      
      setQuiz(quizData);
      setTitle(quizData.title);
      setDuration(quizData.duration.toString());
      setInstructions(quizData.instructions?.join('\n') || '');
      setSelectedQuestions(quizData.questions || []);
    } catch (error) {
      console.error('Error loading quiz:', error);
      Alert.alert('Error', 'Failed to load quiz details');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableQuestions = async (subjectId?: string) => {
    try {
      setLoadingQuestions(true);
      const params: any = { limit: 500 };
      
      // If a specific subject is selected (not 'all'), filter by it
      if (subjectId && subjectId !== 'all') {
        params.subject = subjectId;
      }
      
      const response = await api.get('/question-bank', { params });
      setAvailableQuestions(response.data.questions || response.data);
    } catch (error) {
      console.error('Error loading questions:', error);
      Alert.alert('Error', 'Failed to load questions');
    } finally {
      setLoadingQuestions(false);
    }
  };

  const fetchSubjects = async () => {
    try {
      const response = await api.get('/subjects/list');
      const subjectsData = response.data.subjects || response.data;
      if (Array.isArray(subjectsData)) {
        setSubjects(subjectsData);
      } else {
        console.warn('Expected array for subjects, got:', typeof subjectsData);
        setSubjects([]);
      }
    } catch (error) {
      console.error('Error loading subjects:', error);
      setSubjects([]);
    }
  };

  const handleOpenQuestionPicker = () => {
    setShowQuestionPicker(true);
    setFilterSubjectId('all');
    fetchSubjects();
    loadAvailableQuestions('all');
  };

  const handleAddQuestion = (question: Question) => {
    if (!selectedQuestions.find(q => q._id === question._id)) {
      setSelectedQuestions([...selectedQuestions, question]);
    }
  };

  const handleRemoveQuestion = (questionId: string) => {
    setSelectedQuestions(selectedQuestions.filter(q => q._id !== questionId));
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Please enter a title');
      return;
    }

    if (selectedQuestions.length === 0) {
      Alert.alert('Error', 'Please select at least one question');
      return;
    }

    try {
      setSaving(true);
      await api.put(`/quizzes/${id}`, {
        title: title.trim(),
        duration: parseInt(duration) || 30,
        instructions: instructions.split('\n').filter(line => line.trim()),
        questions: selectedQuestions.map(q => q._id)
      });

      Alert.alert('Success', 'Quiz updated successfully', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      console.error('Error saving quiz:', error);
      Alert.alert('Error', 'Failed to save quiz');
    } finally {
      setSaving(false);
    }
  };

  const filteredAvailableQuestions = availableQuestions.filter(q => {
    if (questionSearch) {
      const search = questionSearch.toLowerCase();
      return q.question.toLowerCase().includes(search) ||
             q.qid?.toLowerCase().includes(search) ||
             q.topicName?.toLowerCase().includes(search);
    }
    return true;
  });

  const isQuestionSelected = (questionId: string) => {
    return selectedQuestions.some(q => q._id === questionId);
  };

  if (user?.role !== 'admin') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Admin access required</Text>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.loadingText}>Loading quiz...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Quiz</Text>
        <TouchableOpacity 
          style={[styles.saveButton, saving && styles.buttonDisabled]} 
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <>
              <Save color="#FFF" size={18} />
              <Text style={styles.saveButtonText}>Save</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Quiz Details Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Quiz Details</Text>
          
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Enter quiz title"
              placeholderTextColor="#9CA3AF"
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Duration (mins)</Text>
              <TextInput
                style={styles.input}
                value={duration}
                onChangeText={setDuration}
                placeholder="30"
                keyboardType="numeric"
                placeholderTextColor="#9CA3AF"
              />
            </View>
            <View style={{ width: 16 }} />
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Test Type</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>{quiz?.testType}</Text>
              </View>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Subject</Text>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>{quiz?.subject?.name}</Text>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Instructions (one per line)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={instructions}
              onChangeText={setInstructions}
              placeholder="Enter instructions..."
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>
        </View>

        {/* Questions Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Questions ({selectedQuestions.length})</Text>
            <TouchableOpacity 
              style={styles.addButton}
              onPress={handleOpenQuestionPicker}
            >
              <Plus color="#FFF" size={18} />
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>

          {selectedQuestions.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No questions added yet</Text>
              <Text style={styles.emptySubtext}>Tap "Add" to add questions to this quiz</Text>
            </View>
          ) : (
            selectedQuestions.map((question, index) => (
              <View key={question._id} style={styles.questionItem}>
                <View style={styles.questionNumber}>
                  <Text style={styles.questionNumberText}>{index + 1}</Text>
                </View>
                <TouchableOpacity 
                  style={styles.questionContent}
                  onPress={() => setPreviewQuestion(question)}
                >
                  <Text style={styles.questionText} numberOfLines={2}>
                    {question.question}
                  </Text>
                  <View style={styles.questionMeta}>
                    {question.questionImage && (
                      <View style={styles.imageBadge}>
                        <ImageIcon size={12} color="#2563EB" />
                      </View>
                    )}
                    <Text style={styles.marksBadge}>{question.marks}M</Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.questionActions}>
                  <TouchableOpacity onPress={() => setPreviewQuestion(question)}>
                    <Eye color="#6B7280" size={18} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleRemoveQuestion(question._id)}>
                    <Trash2 color="#EF4444" size={18} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Question Picker Modal */}
      <Modal
        visible={showQuestionPicker}
        animationType="slide"
        onRequestClose={() => setShowQuestionPicker(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Questions</Text>
            <TouchableOpacity onPress={() => setShowQuestionPicker(false)}>
              <X color="#FFF" size={24} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchContainer}>
            <Search color="#6B7280" size={20} />
            <TextInput
              style={styles.searchInput}
              value={questionSearch}
              onChangeText={setQuestionSearch}
              placeholder="Search questions..."
              placeholderTextColor="#9CA3AF"
            />
          </View>

          {/* Subject Filter Chips */}
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            style={styles.subjectFilterContainer}
            contentContainerStyle={styles.subjectFilterContent}
          >
            <TouchableOpacity
              style={[styles.subjectChip, filterSubjectId === 'all' && styles.subjectChipActive]}
              onPress={() => {
                setFilterSubjectId('all');
                loadAvailableQuestions('all');
              }}
            >
              <Text style={[styles.subjectChipText, filterSubjectId === 'all' && styles.subjectChipTextActive]}>
                All
              </Text>
            </TouchableOpacity>
            {subjects?.map(sub => (
              <TouchableOpacity
                key={sub._id}
                style={[styles.subjectChip, filterSubjectId === sub._id && styles.subjectChipActive]}
                onPress={() => {
                  setFilterSubjectId(sub._id);
                  loadAvailableQuestions(sub._id);
                }}
              >
                <Text style={[styles.subjectChipText, filterSubjectId === sub._id && styles.subjectChipTextActive]}>
                  {sub.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {loadingQuestions ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#2563EB" />
            </View>
          ) : (
            <FlatList
              data={filteredAvailableQuestions}
              keyExtractor={(item) => item._id}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.pickerItem,
                    isQuestionSelected(item._id) && styles.pickerItemSelected
                  ]}
                  onPress={() => handleAddQuestion(item)}
                  disabled={isQuestionSelected(item._id)}
                >
                  <View style={styles.pickerCheckbox}>
                    {isQuestionSelected(item._id) && <Check color="#FFF" size={14} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerQuestionText} numberOfLines={2}>
                      {item.question}
                    </Text>
                    <Text style={styles.pickerMeta}>
                      {item.topicName && `${item.topicName} • `}{item.marks}M
                    </Text>
                  </View>
                  {item.questionImage && (
                    <ImageIcon size={16} color="#2563EB" />
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No questions found</Text>
                </View>
              }
            />
          )}
        </SafeAreaView>
      </Modal>

      {/* Question Preview Modal */}
      <Modal
        visible={!!previewQuestion}
        animationType="slide"
        onRequestClose={() => setPreviewQuestion(null)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Question Preview</Text>
            <TouchableOpacity onPress={() => setPreviewQuestion(null)}>
              <X color="#FFF" size={24} />
            </TouchableOpacity>
          </View>

          {previewQuestion && (
            <ScrollView style={styles.previewContent} showsVerticalScrollIndicator={false}>
              <View style={styles.previewSection}>
                <Text style={styles.previewLabel}>Question</Text>
                <Text style={styles.previewText}>{previewQuestion.question}</Text>
                {previewQuestion.questionImage && (
                  <Image
                    source={{ uri: previewQuestion.questionImage }}
                    style={styles.previewImage}
                    resizeMode="contain"
                  />
                )}
              </View>

              <View style={styles.previewSection}>
                <Text style={styles.previewLabel}>Options</Text>
                {previewQuestion.options.map((option, index) => (
                  <View
                    key={index}
                    style={[
                      styles.previewOption,
                      previewQuestion.correctAnswer === index && styles.correctOption
                    ]}
                  >
                    <Text style={[
                      styles.previewOptionLabel,
                      previewQuestion.correctAnswer === index && styles.correctText
                    ]}>
                      {String.fromCharCode(65 + index)}.
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[
                        styles.previewOptionText,
                        previewQuestion.correctAnswer === index && styles.correctText
                      ]}>
                        {option}
                      </Text>
                      {previewQuestion.optionImages?.[index] && (
                        <Image
                          source={{ uri: previewQuestion.optionImages[index] }}
                          style={styles.previewOptionImage}
                          resizeMode="contain"
                        />
                      )}
                    </View>
                    {previewQuestion.correctAnswer === index && (
                      <Check color="#059669" size={20} />
                    )}
                  </View>
                ))}
              </View>

              {previewQuestion.explanation && (
                <View style={[styles.previewSection, { backgroundColor: '#FEF3C7' }]}>
                  <Text style={styles.previewLabel}>Explanation</Text>
                  <Text style={styles.explanationText}>{previewQuestion.explanation}</Text>
                </View>
              )}

              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </SafeAreaView>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#6B7280',
  },
  errorText: {
    flex: 1,
    textAlign: 'center',
    marginTop: 100,
    fontSize: 16,
    color: '#EF4444',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#2563EB',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
    marginLeft: 8,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#1F2937',
  },
  textArea: {
    minHeight: 100,
  },
  row: {
    flexDirection: 'row',
  },
  readOnlyField: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
  },
  readOnlyText: {
    fontSize: 15,
    color: '#6B7280',
    textTransform: 'capitalize',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563EB',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  addButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 15,
    color: '#6B7280',
  },
  emptySubtext: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 4,
  },
  questionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    gap: 12,
  },
  questionNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EBF5FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  questionNumberText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB',
  },
  questionContent: {
    flex: 1,
  },
  questionText: {
    fontSize: 14,
    color: '#1F2937',
    lineHeight: 20,
  },
  questionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  imageBadge: {
    padding: 4,
    backgroundColor: '#EBF5FF',
    borderRadius: 4,
  },
  marksBadge: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  questionActions: {
    flexDirection: 'row',
    gap: 16,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#2563EB',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    margin: 16,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1F2937',
  },
  listContent: {
    padding: 16,
    paddingTop: 0,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    gap: 12,
  },
  pickerItemSelected: {
    backgroundColor: '#EBF5FF',
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  pickerCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF',
  },
  pickerQuestionText: {
    fontSize: 14,
    color: '#1F2937',
    lineHeight: 20,
  },
  pickerMeta: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  previewContent: {
    flex: 1,
    padding: 16,
  },
  previewSection: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  previewLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  previewText: {
    fontSize: 16,
    color: '#1F2937',
    lineHeight: 24,
  },
  previewImage: {
    width: '100%',
    height: 200,
    marginTop: 12,
    borderRadius: 8,
  },
  previewOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    marginBottom: 8,
    gap: 12,
  },
  correctOption: {
    backgroundColor: '#D1FAE5',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  previewOptionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    width: 24,
  },
  previewOptionText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  correctText: {
    color: '#059669',
  },
  previewOptionImage: {
    width: '100%',
    height: 100,
    marginTop: 8,
    borderRadius: 6,
  },
  explanationText: {
    fontSize: 14,
    color: '#92400E',
    lineHeight: 20,
  },
  subjectFilterContainer: {
    maxHeight: 48,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  subjectFilterContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  subjectChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 16,
    marginRight: 8,
  },
  subjectChipActive: {
    backgroundColor: '#2563EB',
  },
  subjectChipText: {
    fontSize: 13,
    color: '#4B5563',
    fontWeight: '500',
  },
  subjectChipTextActive: {
    color: '#FFF',
  },
});
