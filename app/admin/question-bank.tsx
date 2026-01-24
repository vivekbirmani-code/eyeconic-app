import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  Platform,
  StatusBar,
  FlatList
} from 'react-native';
import { useRouter } from 'expo-router';
import { 
  Plus, 
  Upload, 
  BookOpen, 
  ChevronDown, 
  X, 
  Check,
  Search,
  Filter,
  Trash2,
  Edit
} from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
// FileSystem is required dynamically for native platforms only
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';

interface Subject {
  _id: string;
  name: string;
}

interface Question {
  _id: string;
  qid?: string;
  subject: { _id: string; name: string };
  topicName?: string;
  question: string;
  options: string[];
  marks: number;
}

export default function QuestionBankManagement() {
  const { user } = useAuth();
  const router = useRouter();
  
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  
  // Filters
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Add Question Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newQuestion, setNewQuestion] = useState({
    subject: '',
    topicName: '',
    question: '',
    options: ['', '', '', ''],
    correctAnswer: 0,
    explanation: '',
    marks: 1
  });
  const [saving, setSaving] = useState(false);
  
  // Subject dropdown
  const [showSubjectDropdown, setShowSubjectDropdown] = useState(false);
  
  // Stats
  const [stats, setStats] = useState<{ total: number; bySubject: any[] }>({ total: 0, bySubject: [] });

  useEffect(() => {
    fetchSubjects();
    fetchStats();
  }, []);

  useEffect(() => {
    fetchQuestions();
  }, [selectedSubject, searchQuery]);

  const fetchSubjects = async () => {
    try {
      // Use /subjects/list endpoint which returns flat array (not grouped by year)
      const response = await api.get('/subjects/list');
      console.log('Subjects loaded:', response.data);
      setSubjects(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error fetching subjects:', error);
      setSubjects([]);
    }
  };

  const fetchQuestions = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (selectedSubject) params.subject = selectedSubject;
      if (searchQuery) params.search = searchQuery;
      
      const response = await api.get('/question-bank', { params });
      setQuestions(response.data);
    } catch (error) {
      console.error('Error fetching questions:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await api.get('/question-bank/stats/summary');
      setStats({
        total: response.data?.total || 0,
        bySubject: Array.isArray(response.data?.bySubject) ? response.data.bySubject : []
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      setStats({ total: 0, bySubject: [] });
    }
  };

  const handleAddQuestion = async () => {
    if (!newQuestion.subject) {
      Alert.alert('Error', 'Please select a subject');
      return;
    }
    if (!newQuestion.question.trim()) {
      Alert.alert('Error', 'Please enter the question');
      return;
    }
    if (!newQuestion.options[0] || !newQuestion.options[1]) {
      Alert.alert('Error', 'Please enter at least 2 options');
      return;
    }

    setSaving(true);
    try {
      await api.post('/question-bank', {
        ...newQuestion,
        options: newQuestion.options.filter(o => o.trim())
      });
      
      Alert.alert('Success', 'Question added successfully');
      setShowAddModal(false);
      resetNewQuestion();
      fetchQuestions();
      fetchStats();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to add question');
    } finally {
      setSaving(false);
    }
  };

  const resetNewQuestion = () => {
    setNewQuestion({
      subject: '',
      topicName: '',
      question: '',
      options: ['', '', '', ''],
      correctAnswer: 0,
      explanation: '',
      marks: 1
    });
  };

  const handleBulkImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        copyToCacheDirectory: true
      });

      if (result.canceled || !result.assets?.[0]) return;

      setUploading(true);
      const file = result.assets[0];
      
      // Try to get file content - works differently on web vs native
      let base64: string;
      
      try {
        // Method 1: Try fetch (works on web with blob URLs)
        const response = await fetch(file.uri);
        const blob = await response.blob();
        
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            // Extract base64 from data URL (format: data:mime;base64,XXXXX)
            const base64Data = dataUrl.split(',')[1];
            resolve(base64Data);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (fetchError) {
        console.log('Fetch method failed, trying FileSystem...');
        // Method 2: Try expo-file-system (native only)
        try {
          const FileSystem = require('expo-file-system');
          base64 = await FileSystem.readAsStringAsync(file.uri, {
            encoding: FileSystem.EncodingType.Base64
          });
        } catch (fsError) {
          console.error('Both methods failed:', fetchError, fsError);
          Alert.alert('Error', 'Could not read the file. Please try again.');
          setUploading(false);
          return;
        }
      }
      
      console.log('Uploading file:', file.name, 'Size:', base64.length);
      
      // Send base64 to backend
      const apiResponse = await api.post('/question-bank/bulk-import-base64', {
        filename: file.name,
        data: base64
      });

      Alert.alert(
        'Success',
        `Imported ${apiResponse.data.count} questions!${apiResponse.data.newSubjects?.length ? `\n\nNew subjects created: ${apiResponse.data.newSubjects.join(', ')}` : ''}${apiResponse.data.errors?.length ? `\n\nWarnings: ${apiResponse.data.errors.length} rows had issues` : ''}`,
        [{ text: 'OK', onPress: () => { fetchQuestions(); fetchStats(); fetchSubjects(); } }]
      );
    } catch (error: any) {
      console.error('Import error:', error);
      Alert.alert('Error', error.response?.data?.message || error.message || 'Failed to import questions');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    Alert.alert(
      'Delete Question',
      'Are you sure you want to delete this question?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/question-bank/${id}`);
              fetchQuestions();
              fetchStats();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete question');
            }
          }
        }
      ]
    );
  };

  const renderQuestion = ({ item, index }: { item: Question; index: number }) => (
    <View style={styles.questionCard}>
      <View style={styles.questionHeader}>
        <Text style={styles.questionNumber}>Q{index + 1}</Text>
        <View style={styles.questionMeta}>
          <Text style={styles.subjectBadge}>{item.subject?.name}</Text>
          {item.topicName && (
            <Text style={styles.topicBadge}>{item.topicName}</Text>
          )}
          <Text style={styles.marksBadge}>{item.marks}M</Text>
        </View>
        <TouchableOpacity onPress={() => handleDeleteQuestion(item._id)}>
          <Trash2 color="#EF4444" size={18} />
        </TouchableOpacity>
      </View>
      <Text style={styles.questionText} numberOfLines={2}>{item.question}</Text>
      <View style={styles.optionsPreview}>
        {item.options.slice(0, 2).map((opt, i) => (
          <Text key={i} style={styles.optionPreview} numberOfLines={1}>
            {String.fromCharCode(65 + i)}. {opt}
          </Text>
        ))}
        {item.options.length > 2 && (
          <Text style={styles.moreOptions}>+{item.options.length - 2} more</Text>
        )}
      </View>
    </View>
  );

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
        <View>
          <Text style={styles.headerTitle}>Question Bank</Text>
          <Text style={styles.headerSubtitle}>{stats.total} questions total</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity 
            style={styles.uploadButton}
            onPress={handleBulkImport}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <>
                <Upload color="#FFF" size={18} />
                <Text style={styles.uploadButtonText}>Import Excel</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.addButton}
            onPress={() => setShowAddModal(true)}
          >
            <Plus color="#FFF" size={20} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats Cards */}
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        style={styles.statsScroll}
        contentContainerStyle={styles.statsContainer}
      >
        {stats.bySubject.map((stat, index) => (
          <TouchableOpacity 
            key={index}
            style={[
              styles.statCard,
              selectedSubject === stat._id && styles.statCardActive
            ]}
            onPress={() => setSelectedSubject(selectedSubject === stat._id ? '' : stat._id)}
          >
            <Text style={styles.statCount}>{stat.count}</Text>
            <Text style={styles.statSubject} numberOfLines={1}>{stat.subject}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Search & Filter */}
      <View style={styles.searchRow}>
        <View style={styles.searchInput}>
          <Search color="#6B7280" size={20} />
          <TextInput
            style={styles.searchTextInput}
            placeholder="Search questions..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={fetchQuestions}
          />
        </View>
      </View>

      {/* Questions List */}
      {loading ? (
        <ActivityIndicator size="large" color="#2563EB" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={questions}
          renderItem={renderQuestion}
          keyExtractor={item => item._id}
          contentContainerStyle={styles.questionsList}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <BookOpen color="#9CA3AF" size={48} />
              <Text style={styles.emptyText}>No questions found</Text>
              <Text style={styles.emptySubtext}>Add questions or import from Excel</Text>
            </View>
          }
        />
      )}

      {/* Add Question Modal */}
      <Modal visible={showAddModal} animationType="slide">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Question</Text>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <X color="#6B7280" size={24} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
            {/* Subject Selector */}
            <Text style={styles.inputLabel}>Subject *</Text>
            <TouchableOpacity 
              style={styles.dropdown}
              onPress={() => setShowSubjectDropdown(!showSubjectDropdown)}
            >
              <Text style={newQuestion.subject ? styles.dropdownText : styles.dropdownPlaceholder}>
                {(Array.isArray(subjects) ? subjects : []).find(s => s._id === newQuestion.subject)?.name || 'Select Subject'}
              </Text>
              <ChevronDown color="#6B7280" size={20} />
            </TouchableOpacity>
            
            {showSubjectDropdown && (
              <View style={styles.dropdownList}>
                <ScrollView style={{ maxHeight: 250 }} nestedScrollEnabled={true}>
                  {(Array.isArray(subjects) ? subjects : []).map(subject => (
                    <TouchableOpacity
                      key={subject._id}
                      style={styles.dropdownItem}
                      onPress={() => {
                        setNewQuestion({ ...newQuestion, subject: subject._id });
                        setShowSubjectDropdown(false);
                      }}
                    >
                      <Text style={styles.dropdownItemText}>{subject.name}</Text>
                      {newQuestion.subject === subject._id && (
                        <Check color="#10B981" size={18} />
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Topic */}
            <Text style={styles.inputLabel}>Topic/Chapter</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Cardiovascular System"
              value={newQuestion.topicName}
              onChangeText={text => setNewQuestion({ ...newQuestion, topicName: text })}
            />

            {/* Question */}
            <Text style={styles.inputLabel}>Question *</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Enter your question here..."
              value={newQuestion.question}
              onChangeText={text => setNewQuestion({ ...newQuestion, question: text })}
              multiline
            />

            {/* Options */}
            <Text style={styles.inputLabel}>Options *</Text>
            {newQuestion.options.map((option, index) => (
              <View key={index} style={styles.optionRow}>
                <TouchableOpacity
                  style={[
                    styles.optionRadio,
                    newQuestion.correctAnswer === index && styles.optionRadioSelected
                  ]}
                  onPress={() => setNewQuestion({ ...newQuestion, correctAnswer: index })}
                >
                  {newQuestion.correctAnswer === index && (
                    <View style={styles.optionRadioInner} />
                  )}
                </TouchableOpacity>
                <Text style={styles.optionLabel}>{String.fromCharCode(65 + index)}.</Text>
                <TextInput
                  style={styles.optionInput}
                  placeholder={`Option ${String.fromCharCode(65 + index)}`}
                  value={option}
                  onChangeText={text => {
                    const newOptions = [...newQuestion.options];
                    newOptions[index] = text;
                    setNewQuestion({ ...newQuestion, options: newOptions });
                  }}
                />
              </View>
            ))}
            <Text style={styles.hintText}>Tap the circle to mark correct answer</Text>

            {/* Explanation */}
            <Text style={styles.inputLabel}>Explanation (Optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Explain why this is the correct answer..."
              value={newQuestion.explanation}
              onChangeText={text => setNewQuestion({ ...newQuestion, explanation: text })}
              multiline
            />

            {/* Marks */}
            <Text style={styles.inputLabel}>Marks</Text>
            <TextInput
              style={styles.input}
              placeholder="1"
              value={newQuestion.marks.toString()}
              onChangeText={text => setNewQuestion({ ...newQuestion, marks: parseInt(text) || 1 })}
              keyboardType="numeric"
            />

            {/* Save Button */}
            <TouchableOpacity 
              style={styles.saveButton}
              onPress={handleAddQuestion}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.saveButtonText}>Save Question</Text>
              )}
            </TouchableOpacity>

            {/* Add Another Button */}
            <TouchableOpacity 
              style={styles.addAnotherButton}
              onPress={async () => {
                await handleAddQuestion();
                // Don't close modal, just reset form
              }}
              disabled={saving}
            >
              <Plus color="#2563EB" size={20} />
              <Text style={styles.addAnotherText}>Save & Add Another</Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#2563EB',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFF',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#BFDBFE',
    marginTop: 4,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F59E0B',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  uploadButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  addButton: {
    backgroundColor: '#10B981',
    padding: 10,
    borderRadius: 8,
  },
  statsScroll: {
    maxHeight: 90,
    backgroundColor: '#FFF',
  },
  statsContainer: {
    padding: 16,
    gap: 12,
  },
  statCard: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 100,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  statCardActive: {
    borderColor: '#2563EB',
    backgroundColor: '#EBF5FF',
  },
  statCount: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  statSubject: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  searchRow: {
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
  questionsList: {
    padding: 16,
    gap: 12,
  },
  questionCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  questionNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2563EB',
    marginRight: 12,
  },
  questionMeta: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  subjectBadge: {
    fontSize: 11,
    backgroundColor: '#EBF5FF',
    color: '#2563EB',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    fontWeight: '600',
  },
  topicBadge: {
    fontSize: 11,
    backgroundColor: '#F3F4F6',
    color: '#6B7280',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  marksBadge: {
    fontSize: 11,
    backgroundColor: '#D1FAE5',
    color: '#059669',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    fontWeight: '600',
  },
  questionText: {
    fontSize: 14,
    color: '#1F2937',
    lineHeight: 20,
    marginBottom: 8,
  },
  optionsPreview: {
    gap: 4,
  },
  optionPreview: {
    fontSize: 12,
    color: '#6B7280',
  },
  moreOptions: {
    fontSize: 12,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 8,
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 50,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  dropdownText: {
    fontSize: 16,
    color: '#1F2937',
  },
  dropdownPlaceholder: {
    fontSize: 16,
    color: '#9CA3AF',
  },
  dropdownList: {
    backgroundColor: '#FFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginTop: 4,
    maxHeight: 260,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  dropdownItemText: {
    fontSize: 16,
    color: '#1F2937',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  optionRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionRadioSelected: {
    borderColor: '#10B981',
  },
  optionRadioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#10B981',
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    width: 24,
  },
  optionInput: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  hintText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  saveButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  addAnotherButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#2563EB',
    borderRadius: 8,
  },
  addAnotherText: {
    color: '#2563EB',
    fontSize: 16,
    fontWeight: '600',
  },
});
