import React, { useState, useEffect, useRef } from 'react';
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
  FlatList,
  Image,
  Animated,
  Pressable
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
  Edit,
  Image as ImageIcon,
  Eye,
  ArrowLeft,
  ChevronRight
} from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from '@/utils/haptics';

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
  questionImage?: string;
  options: string[];
  optionImages?: string[];
  correctAnswer?: number;
  explanation?: string;
  explanationImage?: string;
  marks: number;
  tags?: string[];
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

  // Add/Edit Question Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);

  const [newQuestion, setNewQuestion] = useState({
    subject: '',
    topicName: '',
    question: '',
    questionImage: '',
    options: ['', '', '', ''],
    optionImages: ['', '', '', ''],
    correctAnswer: 0,
    explanation: '',
    marks: 1
  });
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);

  // Subject dropdown
  const [showSubjectDropdown, setShowSubjectDropdown] = useState(false);

  // Stats
  const [stats, setStats] = useState<{ total: number; bySubject: any[] }>({ total: 0, bySubject: [] });

  // Question View Modal
  const [selectedViewQuestion, setSelectedViewQuestion] = useState<Question | null>(null);

  // Animation Refs
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fetchSubjects();
    fetchStats();
    runEntryAnimations();
  }, []);

  useEffect(() => {
    fetchQuestions();
  }, [selectedSubject, searchQuery]);

  const runEntryAnimations = () => {
    Animated.timing(headerOpacity, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  };

  const fetchSubjects = async () => {
    try {
      const response = await api.get('/subjects/list');
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

      // Fade in content
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
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

  const handlePickImage = async (type: 'question' | 'option', optionIndex?: number) => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets[0].base64) {
        uploadImage(result.assets[0].base64, type, optionIndex);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const uploadImage = async (base64: string, type: 'question' | 'option', optionIndex?: number) => {
    setImageUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', {
        uri: `data:image/jpeg;base64,${base64}`,
        type: 'image/jpeg',
        name: 'upload.jpg',
      } as any);

      const response = await api.post('/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const imageUrl = response.data.url;

      if (type === 'question') {
        setNewQuestion(prev => ({ ...prev, questionImage: imageUrl }));
      } else if (type === 'option' && typeof optionIndex === 'number') {
        setNewQuestion(prev => {
          const newOptionImages = [...prev.optionImages];
          newOptionImages[optionIndex] = imageUrl;
          return { ...prev, optionImages: newOptionImages };
        });
      }
    } catch (error) {
      console.error('Upload failed:', error);
      Alert.alert('Error', 'Failed to upload image');
    } finally {
      setImageUploading(false);
    }
  };

  const handleAddQuestion = async () => {
    if (!newQuestion.subject) {
      Alert.alert('Error', 'Please select a subject');
      return;
    }
    if (!newQuestion.question.trim() && !newQuestion.questionImage) {
      Alert.alert('Error', 'Please enter the question or upload an image');
      return;
    }

    // Validate options: need at least 2 options matching either text or image
    const validOptionsCount = newQuestion.options.reduce((acc, opt, idx) => {
      const hasText = !!opt.trim();
      const hasImage = !!newQuestion.optionImages[idx];
      return acc + (hasText || hasImage ? 1 : 0);
    }, 0);

    if (validOptionsCount < 2) {
      Alert.alert('Error', 'Please provide at least 2 options (text or image)');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...newQuestion,
      };

      if (editingQuestionId) {
        await api.put(`/question-bank/${editingQuestionId}`, payload);
        Alert.alert('Success', 'Question updated successfully');
      } else {
        await api.post('/question-bank', payload);
        Alert.alert('Success', 'Question added successfully');
      }

      setShowAddModal(false);
      resetNewQuestion();
      fetchQuestions();
      fetchStats();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to save question');
    } finally {
      setSaving(false);
    }
  };

  const handleEditQuestion = (q: Question) => {
    setEditingQuestionId(q._id);
    setNewQuestion({
      subject: q.subject._id,
      topicName: q.topicName || '',
      question: q.question,
      questionImage: q.questionImage || '',
      options: q.options.concat(['', '', '', '']).slice(0, 4),
      optionImages: (q.optionImages || []).concat(['', '', '', '']).slice(0, 4),
      correctAnswer: 0,
      explanation: (q as any).explanation || '',
      marks: q.marks
    });
    if ((q as any).correctAnswer !== undefined) {
      setNewQuestion(prev => ({ ...prev, correctAnswer: (q as any).correctAnswer }));
    }
    setShowAddModal(true);
  };

  const resetNewQuestion = () => {
    setNewQuestion({
      subject: '',
      topicName: '',
      question: '',
      questionImage: '',
      options: ['', '', '', ''],
      optionImages: ['', '', '', ''],
      correctAnswer: 0,
      explanation: '',
      marks: 1
    });
    setEditingQuestionId(null);
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

      let base64: string;

      try {
        const response = await fetch(file.uri);
        const blob = await response.blob();

        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const base64Data = dataUrl.split(',')[1];
            resolve(base64Data);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (fetchError) {
        try {
          const FileSystem = require('expo-file-system');
          base64 = await FileSystem.readAsStringAsync(file.uri, {
            encoding: FileSystem.EncodingType.Base64
          });
        } catch (fsError) {
          Alert.alert('Error', 'Could not read the file.');
          setUploading(false);
          return;
        }
      }

      const apiResponse = await api.post('/question-bank/bulk-import-base64', {
        filename: file.name,
        data: base64
      });

      Alert.alert(
        'Success',
        `Imported ${apiResponse.data.count} questions!`,
        [{ text: 'OK', onPress: () => { fetchQuestions(); fetchStats(); fetchSubjects(); } }]
      );
    } catch (error: any) {
      console.error('Import error:', error);
      Alert.alert('Error', 'Failed to import questions');
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

  // Skeleton Component
  const Skeleton = ({ style }: { style?: any }) => (
    <View style={[styles.skeleton, style]} />
  );

  const renderQuestion = ({ item, index }: { item: Question; index: number }) => (
    <Pressable
      style={({ pressed }) => [
        styles.questionCard,
        pressed && styles.questionCardPressed
      ]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setSelectedViewQuestion(item);
      }}
    >
      <View style={styles.questionHeader}>
        <View style={styles.questionIdContainer}>
          <Text style={styles.questionNumber}>Q{index + 1}</Text>
        </View>
        <View style={styles.questionMeta}>
          <View style={styles.badgeContainer}>
            <Text style={styles.badgeText}>{item.subject?.name}</Text>
          </View>
          {item.topicName && (
            <View style={[styles.badgeContainer, styles.topicBadge]}>
              <Text style={styles.topicBadgeText}>{item.topicName}</Text>
            </View>
          )}
          <View style={[styles.badgeContainer, styles.marksBadge]}>
            <Text style={styles.marksBadgeText}>{item.marks}M</Text>
          </View>
        </View>
      </View>

      <Text style={styles.questionText} numberOfLines={2}>{item.question}</Text>

      {item.questionImage && (
        <View style={styles.imageIndicator}>
          <ImageIcon size={14} color="#01b4ae" />
          <Text style={styles.imageIndicatorText}>Contains Image</Text>
        </View>
      )}

      <View style={styles.cardFooter}>
        <View style={styles.optionsPreview}>
          <Text style={styles.optionCount}>{item.options.length} Options</Text>
        </View>

        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => setSelectedViewQuestion(item)}
          >
            <Eye color="#6B7280" size={18} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleEditQuestion(item)}
          >
            <Edit color="#01b4ae" size={18} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={() => handleDeleteQuestion(item._id)}
          >
            <Trash2 color="#EF4444" size={18} />
          </TouchableOpacity>
        </View>
      </View>
    </Pressable>
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
      <StatusBar barStyle="light-content" />

      {/* Top Glow */}
      <LinearGradient
        colors={['rgba(1, 180, 174, 0.15)', 'rgba(255,255,255,0)']}
        style={styles.topGlow}
      />

      {/* Header */}
      <Animated.View style={{ opacity: headerOpacity }}>
        <LinearGradient
          colors={['#01b4ae', '#009d99', '#01b4ae']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.headerGradient}
        >
          <View style={styles.headerContent}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <ArrowLeft color="#FFF" size={24} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Question Bank</Text>
              <Text style={styles.headerSubtitle}>{stats.total} questions available</Text>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.headerIconBtn}
                onPress={handleBulkImport}
              >
                {uploading ? <ActivityIndicator color="#FFF" size="small" /> : <Upload color="#FFF" size={20} />}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.headerIconBtn}
                onPress={() => {
                  resetNewQuestion();
                  setShowAddModal(true);
                }}
              >
                <Plus color="#FFF" size={20} />
              </TouchableOpacity>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>

      <View style={styles.contentContainer}>
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Search color="#9CA3AF" size={20} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search questions..."
              placeholderTextColor="#9CA3AF"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>

        {/* Categories / Stats */}
        <View style={styles.statsListContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.statsScrollContent}
          >
            <Pressable
              style={[
                styles.statChip,
                selectedSubject === '' && styles.statChipActive
              ]}
              onPress={() => setSelectedSubject('')}
            >
              <Text style={[
                styles.statChipText,
                selectedSubject === '' && styles.statChipTextActive
              ]}>All</Text>
            </Pressable>

            {stats.bySubject.map((stat, index) => (
              <Pressable
                key={index}
                style={[
                  styles.statChip,
                  selectedSubject === stat._id && styles.statChipActive
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelectedSubject(selectedSubject === stat._id ? '' : stat._id);
                }}
              >
                <Text style={[
                  styles.statChipText,
                  selectedSubject === stat._id && styles.statChipTextActive
                ]}>{stat.subject} ({stat.count})</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Questions List */}
        {loading ? (
          <View style={styles.loadingContainer}>
            {[1, 2, 3].map(i => (
              <View key={i} style={styles.skeletonCard}>
                <Skeleton style={{ width: 40, height: 20, marginBottom: 10 }} />
                <Skeleton style={{ width: '80%', height: 16, marginBottom: 6 }} />
                <Skeleton style={{ width: '60%', height: 16, marginBottom: 15 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Skeleton style={{ width: 60, height: 20 }} />
                  <Skeleton style={{ width: 80, height: 20 }} />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Animated.FlatList
            data={questions}
            renderItem={renderQuestion}
            keyExtractor={item => item._id}
            contentContainerStyle={styles.listContent}
            style={{ opacity: contentOpacity }}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <View style={styles.emptyIconContainer}>
                  <BookOpen color="#01b4ae" size={32} />
                </View>
                <Text style={styles.emptyText}>No questions found</Text>
                <Text style={styles.emptySubtext}>Try adjusting your filters or add a new question</Text>
              </View>
            }
          />
        )}
      </View>

      {/* Add/Edit Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <LinearGradient
            colors={['#01b4ae', '#009d99']}
            style={styles.modalHeader}
          >
            <Text style={styles.modalTitle}>{editingQuestionId ? 'Edit Question' : 'Add Question'}</Text>
            <TouchableOpacity onPress={() => setShowAddModal(false)} style={styles.closeButton}>
              <X color="#FFF" size={24} />
            </TouchableOpacity>
          </LinearGradient>

          <ScrollView
            style={styles.modalContent}
            contentContainerStyle={{ flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled={true}
          >
            {/* Subject Dropdown */}
            <Text style={styles.label}>Subject *</Text>
            <View style={{ zIndex: 3000, elevation: 5, overflow: 'visible' }}>
              <TouchableOpacity
                style={styles.dropdownButton}
                onPress={() => setShowSubjectDropdown(!showSubjectDropdown)}
              >
                <Text style={newQuestion.subject ? styles.dropdownText : styles.placeholderText}>
                  {(Array.isArray(subjects) ? subjects : []).find(s => s._id === newQuestion.subject)?.name || 'Select Subject'}
                </Text>
                <ChevronDown color="#6B7280" size={20} />
              </TouchableOpacity>

              {showSubjectDropdown && (
                <View style={[styles.dropdownList, { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 4000, elevation: 5 }]}>
                  <ScrollView nestedScrollEnabled style={{ maxHeight: 200 }}>
                    {subjects.map(subject => (
                      <TouchableOpacity
                        key={subject._id}
                        style={styles.dropdownItem}
                        onPress={() => {
                          setNewQuestion({ ...newQuestion, subject: subject._id });
                          setShowSubjectDropdown(false);
                        }}
                      >
                        <Text style={[
                          styles.dropdownItemText,
                          newQuestion.subject === subject._id && styles.selectedDropdownText
                        ]}>{subject.name}</Text>
                        {newQuestion.subject === subject._id && <Check color="#01b4ae" size={16} />}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            <Text style={styles.label}>Topic</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Cardiovascular System"
              value={newQuestion.topicName}
              onChangeText={text => setNewQuestion({ ...newQuestion, topicName: text })}
            />

            <Text style={styles.label}>Question Text *</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Enter question..."
              multiline
              value={newQuestion.question}
              onChangeText={text => setNewQuestion({ ...newQuestion, question: text })}
            />

            <TouchableOpacity
              style={styles.imageUploadBtn}
              onPress={() => handlePickImage('question')}
            >
              <ImageIcon color="#01b4ae" size={20} />
              <Text style={styles.imageUploadText}>{newQuestion.questionImage ? 'Change Image' : 'Add Image'}</Text>
            </TouchableOpacity>

            {newQuestion.questionImage ? (
              <View style={styles.previewImageContainer}>
                <Image source={{ uri: newQuestion.questionImage }} style={styles.previewImage} resizeMode="contain" />
                <TouchableOpacity
                  style={styles.removeImgBtn}
                  onPress={() => setNewQuestion(prev => ({ ...prev, questionImage: '' }))}
                >
                  <X color="#FFF" size={14} />
                </TouchableOpacity>
              </View>
            ) : null}

            <Text style={styles.label}>Options (Select correct answer) *</Text>
            {newQuestion.options.map((opt, idx) => (
              <View key={idx} style={styles.optionRow}>
                <TouchableOpacity
                  style={[styles.radioBtn, newQuestion.correctAnswer === idx && styles.radioBtnSelected]}
                  onPress={() => setNewQuestion(prev => ({ ...prev, correctAnswer: idx }))}
                >
                  {newQuestion.correctAnswer === idx && <View style={styles.radioInner} />}
                </TouchableOpacity>
                <View style={{ flex: 1, gap: 8 }}>
                  <TextInput
                    style={styles.optionInput}
                    placeholder={`Option ${idx + 1}`}
                    value={opt}
                    onChangeText={text => {
                      const newOpts = [...newQuestion.options];
                      newOpts[idx] = text;
                      setNewQuestion(prev => ({ ...prev, options: newOpts }));
                    }}
                  />
                  <TouchableOpacity
                    onPress={() => handlePickImage('option', idx)}
                    style={styles.miniImageLink}
                  >
                    <ImageIcon size={14} color="#01b4ae" />
                    <Text style={styles.miniImageLinkText}>
                      {newQuestion.optionImages[idx] ? 'Change Image' : 'Add Image'}
                    </Text>
                  </TouchableOpacity>
                  {newQuestion.optionImages[idx] ? (
                    <View style={styles.miniImagePreview}>
                      <Image source={{ uri: newQuestion.optionImages[idx] }} style={{ width: 60, height: 60, borderRadius: 4 }} />
                      <TouchableOpacity onPress={() => {
                        const newImgs = [...newQuestion.optionImages];
                        newImgs[idx] = '';
                        setNewQuestion(prev => ({ ...prev, optionImages: newImgs }));
                      }}>
                        <Text style={{ color: '#EF4444', fontSize: 10, marginTop: 2 }}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              </View>
            ))}

            <Text style={styles.label}>Marks</Text>
            <TextInput
              style={styles.input}
              value={newQuestion.marks.toString()}
              keyboardType="numeric"
              onChangeText={text => setNewQuestion({ ...newQuestion, marks: parseInt(text) || 1 })}
            />

            <Text style={styles.label}>Explanation</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Explain correct answer..."
              multiline
              value={newQuestion.explanation}
              onChangeText={text => setNewQuestion({ ...newQuestion, explanation: text })}
            />

            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.disabledBtn]}
              onPress={handleAddQuestion}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>{editingQuestionId ? 'Update' : 'Save Question'}</Text>}
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* View/Preview Modal */}
      <Modal visible={!!selectedViewQuestion} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <LinearGradient
            colors={['#01b4ae', '#009d99']}
            style={styles.modalHeader}
          >
            <Text style={styles.modalTitle}>Preview</Text>
            <TouchableOpacity onPress={() => setSelectedViewQuestion(null)} style={styles.closeButton}>
              <X color="#FFF" size={24} />
            </TouchableOpacity>
          </LinearGradient>

          {selectedViewQuestion && (
            <ScrollView 
              style={styles.modalContent} 
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled={true}
              contentContainerStyle={{ flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.previewCard}>
                <View style={styles.previewMetaRow}>
                  <View style={styles.badgeContainer}>
                    <Text style={styles.badgeText}>{selectedViewQuestion.subject.name}</Text>
                  </View>
                  <View style={[styles.badgeContainer, styles.marksBadge]}>
                    <Text style={styles.marksBadgeText}>{selectedViewQuestion.marks} Marks</Text>
                  </View>
                </View>

                <Text style={styles.previewQuestion}>{selectedViewQuestion.question}</Text>

                {selectedViewQuestion.questionImage && (
                  <Image
                    source={{ uri: selectedViewQuestion.questionImage }}
                    style={styles.previewMainImage}
                    resizeMode="contain"
                  />
                )}

                <View style={styles.previewDivider} />

                {selectedViewQuestion.options.map((opt, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.previewOption,
                      selectedViewQuestion.correctAnswer === idx && styles.previewOptionCorrect
                    ]}
                  >
                    <Text style={[
                      styles.previewOptionLabel,
                      selectedViewQuestion.correctAnswer === idx && styles.previewOptionLabelCorrect
                    ]}>{String.fromCharCode(65 + idx)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[
                        styles.previewOptionText,
                        selectedViewQuestion.correctAnswer === idx && styles.previewOptionTextCorrect
                      ]}>{opt}</Text>
                      {selectedViewQuestion.optionImages?.[idx] ? (
                        <Image source={{ uri: selectedViewQuestion.optionImages[idx] }} style={styles.previewOptionImage} resizeMode="contain" />
                      ) : null}
                    </View>
                    {selectedViewQuestion.correctAnswer === idx && <Check color="#10B981" size={20} />}
                  </View>
                ))}

                {(selectedViewQuestion.explanation || selectedViewQuestion.explanationImage) && (
                  <View style={styles.explanationBox}>
                    <Text style={styles.explanationTitle}>Explanation</Text>
                    <Text style={styles.explanationText}>{selectedViewQuestion.explanation}</Text>
                  </View>
                )}
              </View>
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB', // Light gray bg
  },
  topGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 300,
    zIndex: 0,
  },
  headerGradient: {
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight! + 10 : 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 10,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  backButton: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  headerIconBtn: {
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    backdropFilter: 'blur(10px)',
  },
  contentContainer: {
    flex: 1,
    paddingTop: 10,
  },

  // Search
  searchContainer: {
    paddingHorizontal: 20,
    marginTop: -25, // Overlap header
    marginBottom: 10,
    zIndex: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 52,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
    color: '#1F2937',
  },

  // Stats/Filters
  statsListContainer: {
    marginBottom: 10,
  },
  statsScrollContent: {
    paddingHorizontal: 20,
    gap: 10,
    paddingBottom: 10,
    paddingTop: 5,
  },
  statChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statChipActive: {
    backgroundColor: '#01b4ae',
    borderColor: '#01b4ae',
  },
  statChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4B5563',
  },
  statChipTextActive: {
    color: '#FFF',
  },

  // List
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 16,
  },
  questionCard: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
  },
  questionCardPressed: {
    transform: [{ scale: 0.98 }],
    shadowOpacity: 0.04,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  questionIdContainer: {
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginRight: 10,
  },
  questionNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#01b4ae',
  },
  questionMeta: {
    flexDirection: 'row',
    flex: 1,
    gap: 6,
    flexWrap: 'wrap',
  },
  badgeContainer: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    color: '#4B5563',
    fontWeight: '500',
  },
  topicBadge: {
    backgroundColor: '#EFF6FF',
  },
  topicBadgeText: {
    color: '#3B82F6',
  },
  marksBadge: {
    backgroundColor: '#ECFDF5',
  },
  marksBadgeText: {
    color: '#10B981',
    fontWeight: '600',
  },
  questionText: {
    fontSize: 15,
    color: '#1F2937',
    marginBottom: 12,
    lineHeight: 22,
    fontWeight: '500',
  },
  imageIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(1, 180, 174, 0.05)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  imageIndicatorText: {
    fontSize: 12,
    color: '#01b4ae',
    fontWeight: '500',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 12,
    marginTop: 4,
  },
  optionsPreview: {
    flexDirection: 'row',
  },
  optionCount: {
    fontSize: 12,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
  },
  deleteButton: {
    backgroundColor: '#FEF2F2',
  },

  // Skeleton
  loadingContainer: {
    paddingHorizontal: 20,
    gap: 16,
  },
  skeletonCard: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 18,
    height: 160,
  },
  skeleton: {
    backgroundColor: '#F3F4F6',
    borderRadius: 4,
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 6,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  errorText: {
    textAlign: 'center',
    color: 'red',
    marginTop: 50,
  },

  // Modals
  modalContainer: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
  },
  closeButton: {
    padding: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#1F2937',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 14,
  },
  dropdownText: {
    fontSize: 16,
    color: '#1F2937',
  },
  placeholderText: {
    fontSize: 16,
    color: '#9CA3AF',
  },
  dropdownList: {
    marginTop: 8,
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    maxHeight: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  dropdownItemText: {
    fontSize: 15,
    color: '#374151',
  },
  selectedDropdownText: {
    color: '#01b4ae',
    fontWeight: '600',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  radioBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 14,
  },
  radioBtnSelected: {
    borderColor: '#01b4ae',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#01b4ae',
  },
  optionInput: {
    flex: 1,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
  },
  saveBtn: {
    backgroundColor: '#01b4ae',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    marginTop: 30,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  disabledBtn: {
    opacity: 0.7,
  },
  saveBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  imageUploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    padding: 12,
    borderRadius: 10,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  imageUploadText: {
    color: '#01b4ae',
    fontWeight: '600',
    fontSize: 14,
  },
  previewImageContainer: {
    marginTop: 10,
    width: '100%',
    height: 180,
    borderRadius: 12,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  removeImgBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#EF4444',
    padding: 6,
    borderRadius: 20,
  },
  miniImageLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4
  },
  miniImageLinkText: {
    fontSize: 12,
    color: '#01b4ae'
  },
  miniImagePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4
  },

  // Preview Modal
  previewCard: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  previewMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  previewQuestion: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 26,
    marginBottom: 16,
  },
  previewMainImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: '#F9FAFB',
  },
  previewDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 16,
  },
  previewOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F9FAFB',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    gap: 12,
  },
  previewOptionCorrect: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  previewOptionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#6B7280',
  },
  previewOptionLabelCorrect: {
    color: '#059669',
  },
  previewOptionText: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 22,
  },
  previewOptionTextCorrect: {
    color: '#047857',
    fontWeight: '500',
  },
  previewOptionImage: {
    width: '100%',
    height: 120,
    marginTop: 8,
    borderRadius: 8,
  },
  explanationBox: {
    marginTop: 20,
    backgroundColor: '#FFFBEB',
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
  },
  explanationTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#B45309',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  explanationText: {
    fontSize: 14,
    color: '#92400E',
    lineHeight: 22,
  },
});
