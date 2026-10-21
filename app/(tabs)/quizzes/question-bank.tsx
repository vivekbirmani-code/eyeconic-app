import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  StatusBar,
  Image,
  Animated,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { useRouter } from 'expo-router';
import {
  Plus,
  Upload,
  BookOpen,
  ChevronDown,
  X,
  Check,
  Search,
  Trash2,
  Edit,
  Image as ImageIcon,
  Eye,
  ArrowLeft,
  PlusCircle,
  MinusCircle
} from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { api, normalizeApiError } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from '@/utils/haptics';
import {
  Question,
  QuestionFormState,
  QuestionType,
  Difficulty,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  DIFFICULTY_LEVELS,
  DIFFICULTY_LABELS,
  DEFAULT_ASSERTION_REASON_OPTIONS,
  emptyQuestionFormState,
} from '@/types/question';
import ImageUploadSummaryModal, { ImageImportSummary } from '@/components/ImageUploadSummaryModal';

interface Subject {
  _id: string;
  name: string;
}

const getDifficultyBadgeStyle = (difficulty: string) => ({
  backgroundColor: difficulty === 'hard' ? '#FEF2F2' : difficulty === 'medium' ? '#FFFBEB' : '#ECFDF5',
});

export default function QuestionBankManagement() {
  const { user } = useAuth();
  const router = useRouter();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Image Upload Summary popup after a bulk import (question/solution image
  // outcomes); null = closed. Only set when the file carried images.
  const [imageSummary, setImageSummary] = useState<ImageImportSummary | null>(null);

  // Filters
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterQuestionType, setFilterQuestionType] = useState<QuestionType | ''>('');
  const [filterDifficulty, setFilterDifficulty] = useState<Difficulty | ''>('');

  // Add/Edit Question Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);

  const [newQuestion, setNewQuestion] = useState<QuestionFormState>(emptyQuestionFormState());
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);

  // Dropdowns
  const [showSubjectDropdown, setShowSubjectDropdown] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [showDifficultyDropdown, setShowDifficultyDropdown] = useState(false);

  // Stats
  const [stats, setStats] = useState<{ total: number; bySubject: any[] }>({ total: 0, bySubject: [] });

  // Question View Modal
  const [selectedViewQuestion, setSelectedViewQuestion] = useState<Question | null>(null);

  // Animation Refs
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fetchSubjects();
    fetchStats();
    runEntryAnimations();
  }, []);

  useEffect(() => {
    fetchQuestions();
  }, [selectedSubject, searchQuery, filterQuestionType, filterDifficulty]);

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
      if (filterQuestionType) params.questionType = filterQuestionType;
      if (filterDifficulty) params.difficulty = filterDifficulty;

      // Server-side filtering: the full bank is never fetched and filtered client-side.
      const response = await api.get('/question-bank', { params });
      setQuestions(response.data);

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

  const handlePickImage = async (type: 'question' | 'option' | 'explanation', optionIndex?: number) => {
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

  const uploadImage = async (base64: string, type: 'question' | 'option' | 'explanation', optionIndex?: number) => {
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
      } else if (type === 'explanation') {
        setNewQuestion(prev => ({ ...prev, explanationImage: imageUrl }));
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

  // ---- Type-specific option list helpers ----
  const addOption = () => {
    setNewQuestion(prev => (prev.options.length >= 6 ? prev : {
      ...prev,
      options: [...prev.options, ''],
      optionImages: [...prev.optionImages, ''],
    }));
  };

  const removeOption = (idx: number) => {
    setNewQuestion(prev => {
      if (prev.options.length <= 2) return prev;
      const options = prev.options.filter((_, i) => i !== idx);
      const optionImages = prev.optionImages.filter((_, i) => i !== idx);
      const correctAnswer = prev.correctAnswer === idx ? 0 : prev.correctAnswer > idx ? prev.correctAnswer - 1 : prev.correctAnswer;
      const correctAnswers = prev.correctAnswers
        .filter(i => i !== idx)
        .map(i => (i > idx ? i - 1 : i));
      return { ...prev, options, optionImages, correctAnswer, correctAnswers };
    });
  };

  const toggleMultipleCorrect = (idx: number) => {
    setNewQuestion(prev => {
      const has = prev.correctAnswers.includes(idx);
      const correctAnswers = has ? prev.correctAnswers.filter(i => i !== idx) : [...prev.correctAnswers, idx];
      return { ...prev, correctAnswers };
    });
  };

  const addColumnEntry = (column: 'columnA' | 'columnB') => {
    setNewQuestion(prev => (prev[column].length >= 6 ? prev : { ...prev, [column]: [...prev[column], ''] }));
  };

  const removeColumnEntry = (column: 'columnA' | 'columnB', idx: number) => {
    setNewQuestion(prev => {
      if (prev[column].length <= 2) return prev;
      const updated = prev[column].filter((_, i) => i !== idx);
      let correctMapping = prev.correctMapping;
      if (column === 'columnA') {
        correctMapping = {};
        Object.entries(prev.correctMapping).forEach(([k, v]) => {
          const ki = Number(k);
          if (ki === idx) return;
          correctMapping[String(ki > idx ? ki - 1 : ki)] = v;
        });
      } else {
        correctMapping = {};
        Object.entries(prev.correctMapping).forEach(([k, v]) => {
          const vi = Number(v);
          if (vi === idx) return; // drop mapping pointing at removed column B entry
          correctMapping[k] = String(vi > idx ? vi - 1 : vi);
        });
      }
      return { ...prev, [column]: updated, correctMapping };
    });
  };

  const setMapping = (aIndex: number, bIndex: number) => {
    setNewQuestion(prev => ({ ...prev, correctMapping: { ...prev.correctMapping, [String(aIndex)]: String(bIndex) } }));
  };

  const onQuestionTypeChange = (type: QuestionType) => {
    setNewQuestion(prev => {
      const next: QuestionFormState = { ...prev, questionType: type };
      // Seed sensible defaults for the newly selected type without wiping unrelated metadata (subject/topic/subtopic/system/tags/difficulty are untouched).
      if (type === 'assertion_reason' && (!prev.assertion && !prev.reason) && prev.options.every(o => !o.trim())) {
        next.options = [...DEFAULT_ASSERTION_REASON_OPTIONS];
        next.optionImages = ['', '', '', ''];
      }
      if ((type === 'mcq_single' || type === 'image_based' || type === 'multiple_correct') && next.options.length < 2) {
        next.options = ['', '', '', ''];
        next.optionImages = ['', '', '', ''];
      }
      if (type === 'match_the_following' && (next.columnA.length < 2 || next.columnB.length < 2)) {
        next.columnA = next.columnA.length >= 2 ? next.columnA : ['', ''];
        next.columnB = next.columnB.length >= 2 ? next.columnB : ['', ''];
      }
      return next;
    });
    setShowTypeDropdown(false);
  };

  const validateForm = (): string | null => {
    if (!newQuestion.subject) return 'Please select a Subject';
    if (!newQuestion.topicName.trim()) return 'Topic is required';
    if (!newQuestion.subtopicName.trim()) return 'Subtopic is required';
    if (!newQuestion.system.trim()) return 'System is required';
    if (!newQuestion.difficulty) return 'Difficulty is required';
    if (!newQuestion.question.trim() && !newQuestion.questionImage) return 'Please enter the question or upload an image';

    switch (newQuestion.questionType) {
      case 'mcq_single': {
        const valid = newQuestion.options.filter(o => o.trim()).length;
        if (valid < 2) return 'Please provide at least 2 options';
        break;
      }
      case 'image_based': {
        if (!newQuestion.questionImage) return 'Image-Based questions require a question image';
        const valid = newQuestion.options.filter(o => o.trim()).length;
        if (valid < 2) return 'Please provide at least 2 options';
        break;
      }
      case 'multiple_correct': {
        const valid = newQuestion.options.filter(o => o.trim()).length;
        if (valid < 2) return 'Please provide at least 2 options';
        if (newQuestion.correctAnswers.length === 0) return 'Select at least one correct option';
        break;
      }
      case 'assertion_reason': {
        if (!newQuestion.assertion.trim()) return 'Assertion text is required';
        if (!newQuestion.reason.trim()) return 'Reason text is required';
        break;
      }
      case 'match_the_following': {
        const a = newQuestion.columnA.filter(v => v.trim()).length;
        const b = newQuestion.columnB.filter(v => v.trim()).length;
        if (a < 2) return 'Column A needs at least 2 entries';
        if (b < 2) return 'Column B needs at least 2 entries';
        if (Object.keys(newQuestion.correctMapping).length !== newQuestion.columnA.length) {
          return 'Every Column A entry must be matched to a Column B entry';
        }
        break;
      }
      case 'numerical': {
        if (newQuestion.correctNumerical.trim() === '' || Number.isNaN(Number(newQuestion.correctNumerical))) {
          return 'Please provide a valid numerical answer';
        }
        break;
      }
    }
    return null;
  };

  const buildPayload = () => {
    const base: any = {
      subject: newQuestion.subject,
      topicName: newQuestion.topicName.trim(),
      subtopicName: newQuestion.subtopicName.trim(),
      system: newQuestion.system.trim(),
      questionType: newQuestion.questionType,
      difficulty: newQuestion.difficulty,
      tags: newQuestion.tags,
      question: newQuestion.question.trim(),
      questionImage: newQuestion.questionImage || undefined,
      explanation: newQuestion.explanation,
      explanationImage: newQuestion.explanationImage || undefined,
      positiveMarks: parseFloat(newQuestion.positiveMarks?.toString() || '0') || 0,
      negativeMarks: parseFloat(newQuestion.negativeMarks?.toString() || '0') || 0,
      marks: parseFloat(newQuestion.positiveMarks?.toString() || '0') || 0,
    };

    switch (newQuestion.questionType) {
      case 'mcq_single':
      case 'image_based':
        base.options = newQuestion.options;
        base.optionImages = newQuestion.optionImages;
        base.correctAnswer = newQuestion.correctAnswer;
        break;
      case 'multiple_correct':
        base.options = newQuestion.options;
        base.optionImages = newQuestion.optionImages;
        base.correctAnswer = newQuestion.correctAnswers;
        break;
      case 'assertion_reason':
        base.assertion = newQuestion.assertion.trim();
        base.reason = newQuestion.reason.trim();
        base.options = newQuestion.options;
        base.correctAnswer = newQuestion.correctAnswer;
        break;
      case 'match_the_following':
        base.columnA = newQuestion.columnA.filter(v => v.trim());
        base.columnB = newQuestion.columnB.filter(v => v.trim());
        base.correctAnswer = newQuestion.correctMapping;
        break;
      case 'numerical':
        base.correctAnswer = Number(newQuestion.correctNumerical);
        break;
    }
    return base;
  };

  const handleAddQuestion = async () => {
    const error = validateForm();
    if (error) {
      Alert.alert('Validation Error', error);
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();

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
      const errors = error.response?.data?.errors;
      const message = Array.isArray(errors) && errors.length > 0
        ? errors.join('\n')
        : (error.response?.data?.message || 'Failed to save question');
      Alert.alert('Error', message);
    } finally {
      setSaving(false);
    }
  };

  const handleEditQuestion = (q: Question) => {
    if (!q.subject || !q.subject._id) {
      Alert.alert(
        'Cannot Edit',
        'This question has no subject assigned or the subject was deleted. Please delete and recreate this question.',
        [{ text: 'OK' }]
      );
      return;
    }

    const questionType = q.questionType || 'mcq_single';
    const baseOptions = q.options && q.options.length >= 2 ? q.options : ['', '', '', ''];
    const baseOptionImages = q.optionImages && q.optionImages.length ? q.optionImages : baseOptions.map(() => '');

    const form: QuestionFormState = {
      ...emptyQuestionFormState(),
      subject: q.subject._id,
      topicName: q.topicName || '',
      subtopicName: q.subtopicName || '',
      system: q.system || '',
      questionType,
      tags: q.tags || [],
      difficulty: q.difficulty || 'medium',
      question: q.question,
      questionImage: q.questionImage || '',
      options: baseOptions,
      optionImages: baseOptionImages,
      explanation: q.explanation || '',
      explanationImage: q.explanationImage || '',
      marks: q.marks || 4,
      positiveMarks: q.positiveMarks !== undefined ? q.positiveMarks : (q.marks || 4),
      negativeMarks: q.negativeMarks !== undefined ? q.negativeMarks : 0,
      assertion: q.assertion || '',
      reason: q.reason || '',
      columnA: q.columnA && q.columnA.length >= 2 ? q.columnA : ['', ''],
      columnB: q.columnB && q.columnB.length >= 2 ? q.columnB : ['', ''],
      correctMapping: {},
      correctAnswer: 0,
      correctAnswers: [],
      correctNumerical: '',
    };

    if (questionType === 'multiple_correct' && Array.isArray(q.correctAnswer)) {
      form.correctAnswers = q.correctAnswer as number[];
    } else if (questionType === 'match_the_following' && q.correctAnswer && typeof q.correctAnswer === 'object') {
      form.correctMapping = q.correctAnswer as Record<string, string>;
    } else if (questionType === 'numerical') {
      form.correctNumerical = q.correctAnswer !== undefined ? String(q.correctAnswer) : '';
    } else if (typeof q.correctAnswer === 'number') {
      form.correctAnswer = q.correctAnswer;
    }

    setEditingQuestionId(q._id);
    setNewQuestion(form);
    setShowAddModal(true);
  };

  const resetNewQuestion = () => {
    setNewQuestion(emptyQuestionFormState());
    setEditingQuestionId(null);
  };

  const handleBulkImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          // CSV — parsed by the same backend import (SheetJS auto-detect).
          'text/csv',
          'application/csv',
          'text/comma-separated-values',
          'public.comma-separated-values-text',
        ],
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

      const errorPreview = Array.isArray(apiResponse.data?.errors) && apiResponse.data.errors.length > 0
        ? `\n\n${apiResponse.data.errors.slice(0, 5).join('\n')}${apiResponse.data.errors.length > 5 ? '\n...' : ''}`
        : '';
      const dupCount = Number(apiResponse.data?.duplicatesSkipped) || 0;
      const dupInFile = Number(apiResponse.data?.duplicatesInFile) || 0;
      const dupExisting = Number(apiResponse.data?.duplicatesExisting) || 0;
      const duplicateNote = dupCount > 0
        ? `\n${dupCount} duplicate row(s) skipped (${dupInFile} repeated in this file, ${dupExisting} already in the bank).`
        : '';
      // Image transfers that kept their direct source URLs — surfaced so a
      // partial transfer is never reported as a fully clean import.
      const warnings = Array.isArray(apiResponse.data?.warnings) ? apiResponse.data.warnings : [];
      const warningPreview = warnings.length > 0
        ? `\n\n⚠️ ${warnings.length} image(s) kept on their direct URLs:\n${warnings.slice(0, 5).join('\n')}${warnings.length > 5 ? '\n...' : ''}`
        : '';

      Alert.alert(
        'Import Complete',
        `Imported ${apiResponse.data.count} of ${apiResponse.data?.totalRows ?? '?'} rows.${duplicateNote}${errorPreview}${warningPreview}`,
        [{
          text: 'OK',
          onPress: () => {
            fetchQuestions(); fetchStats(); fetchSubjects();
            // Image summary popup follows the row-level report — after every
            // import; a no-image file reports "No images were found".
            const summary: ImageImportSummary | undefined = apiResponse.data?.imageSummary;
            if (summary) setImageSummary(summary);
          }
        }]
      );
    } catch (error: unknown) {
      const normalized = normalizeApiError(error);
      const axiosData = (error as { response?: { data?: { code?: string; errors?: string[] } } })?.response?.data;
      const validationErrors = axiosData?.errors;
      const isImportValidation = axiosData?.code === 'IMPORT_VALIDATION_ERROR' || normalized.code === 'VALIDATION_ERROR';

      if (isImportValidation && validationErrors?.length) {
        const formatted = validationErrors
          .slice(0, 8)
          .map((entry) => entry.replace(/^Row (\d+): /, 'Row $1\n• '))
          .join('\n\n');
        Alert.alert('Excel validation failed', formatted);
      } else {
        Alert.alert('Import Failed', normalized.userMessage);
      }

      if (!isImportValidation) {
        console.error('Import error:', normalized.code, normalized.userMessage);
      }
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

  const renderQuestionCard = (item: Question, index: number) => (
    <Pressable
      key={item._id}
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
            <Text style={styles.badgeText} numberOfLines={1}>{item.subject?.name || 'Unknown Subject'}</Text>
          </View>
          {item.topicName && (
            <View style={[styles.badgeContainer, styles.topicBadge]}>
              <Text style={styles.topicBadgeText} numberOfLines={1}>{item.topicName}</Text>
            </View>
          )}
          {item.subtopicName && (
            <View style={[styles.badgeContainer, styles.subtopicBadge]}>
              <Text style={styles.subtopicBadgeText} numberOfLines={1}>{item.subtopicName}</Text>
            </View>
          )}
          {item.system && (
            <View style={[styles.badgeContainer, styles.systemBadge]}>
              <Text style={styles.systemBadgeText} numberOfLines={1}>{item.system}</Text>
            </View>
          )}
          {item.difficulty && (
            <View style={[styles.badgeContainer, getDifficultyBadgeStyle(item.difficulty)]}>
              <Text style={styles.difficultyBadgeText}>{DIFFICULTY_LABELS[item.difficulty]}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.typeRow}>
        <Text style={styles.typeRowText}>{QUESTION_TYPE_LABELS[item.questionType] || 'MCQ — Single Correct'}</Text>
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
          <Text style={styles.optionCount}>
            {item.tags && item.tags.length > 0 ? item.tags.join(', ') : 'No tags'}
          </Text>
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
      <ScreenContainer style={styles.container}>
        <Text style={styles.errorText}>Admin access required</Text>
      </ScreenContainer>
    );
  }

  const renderOptionsEditor = (mode: 'single' | 'multiple') => (
    <>
      <View style={styles.rowBetween}>
        <Text style={styles.label}>
          {mode === 'multiple' ? 'Options (Check all correct answers) *' : 'Options (Select correct answer) *'}
        </Text>
        {newQuestion.options.length < 6 && (
          <TouchableOpacity onPress={addOption} style={styles.addOptionBtn}>
            <PlusCircle color="#01b4ae" size={20} />
          </TouchableOpacity>
        )}
      </View>
      {newQuestion.options.map((opt, idx) => (
        <View key={idx} style={styles.optionRow}>
          <TouchableOpacity
            style={mode === 'multiple'
              ? [styles.checkBtn, newQuestion.correctAnswers.includes(idx) && styles.checkBtnSelected]
              : [styles.radioBtn, newQuestion.correctAnswer === idx && styles.radioBtnSelected]}
            onPress={() => mode === 'multiple' ? toggleMultipleCorrect(idx) : setNewQuestion(prev => ({ ...prev, correctAnswer: idx }))}
          >
            {mode === 'multiple'
              ? (newQuestion.correctAnswers.includes(idx) && <Check color="#FFF" size={14} />)
              : (newQuestion.correctAnswer === idx && <View style={styles.radioInner} />)}
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
            <View style={styles.rowBetween}>
              <TouchableOpacity
                onPress={() => handlePickImage('option', idx)}
                style={styles.miniImageLink}
              >
                <ImageIcon size={14} color="#01b4ae" />
                <Text style={styles.miniImageLinkText}>
                  {newQuestion.optionImages[idx] ? 'Change Image' : 'Add Image'}
                </Text>
              </TouchableOpacity>
              {newQuestion.options.length > 2 && (
                <TouchableOpacity onPress={() => removeOption(idx)}>
                  <MinusCircle color="#EF4444" size={18} />
                </TouchableOpacity>
              )}
            </View>
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
    </>
  );

  const renderTypeSpecificEditor = () => {
    switch (newQuestion.questionType) {
      case 'mcq_single':
        return renderOptionsEditor('single');
      case 'multiple_correct':
        return renderOptionsEditor('multiple');
      case 'image_based':
        return (
          <>
            <Text style={styles.helperText}>Image-Based questions require a question image (below).</Text>
            {renderOptionsEditor('single')}
          </>
        );
      case 'assertion_reason':
        return (
          <>
            <Text style={styles.label}>Assertion *</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Enter the assertion statement..."
              multiline
              value={newQuestion.assertion}
              onChangeText={text => setNewQuestion(prev => ({ ...prev, assertion: text }))}
            />
            <Text style={styles.label}>Reason *</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Enter the reason statement..."
              multiline
              value={newQuestion.reason}
              onChangeText={text => setNewQuestion(prev => ({ ...prev, reason: text }))}
            />
            {renderOptionsEditor('single')}
          </>
        );
      case 'match_the_following':
        return (
          <>
            <View style={styles.rowBetween}>
              <Text style={styles.label}>Column A *</Text>
              {newQuestion.columnA.length < 6 && (
                <TouchableOpacity onPress={() => addColumnEntry('columnA')} style={styles.addOptionBtn}>
                  <PlusCircle color="#01b4ae" size={20} />
                </TouchableOpacity>
              )}
            </View>
            {newQuestion.columnA.map((val, idx) => (
              <View key={idx} style={styles.matchRow}>
                <Text style={styles.matchIndex}>{idx + 1}.</Text>
                <TextInput
                  style={[styles.optionInput, { flex: 1 }]}
                  placeholder={`Column A item ${idx + 1}`}
                  value={val}
                  onChangeText={text => {
                    const columnA = [...newQuestion.columnA];
                    columnA[idx] = text;
                    setNewQuestion(prev => ({ ...prev, columnA }));
                  }}
                />
                {newQuestion.columnA.length > 2 && (
                  <TouchableOpacity onPress={() => removeColumnEntry('columnA', idx)}>
                    <MinusCircle color="#EF4444" size={18} />
                  </TouchableOpacity>
                )}
              </View>
            ))}

            <View style={styles.rowBetween}>
              <Text style={styles.label}>Column B *</Text>
              {newQuestion.columnB.length < 6 && (
                <TouchableOpacity onPress={() => addColumnEntry('columnB')} style={styles.addOptionBtn}>
                  <PlusCircle color="#01b4ae" size={20} />
                </TouchableOpacity>
              )}
            </View>
            {newQuestion.columnB.map((val, idx) => (
              <View key={idx} style={styles.matchRow}>
                <Text style={styles.matchIndex}>{String.fromCharCode(65 + idx)}.</Text>
                <TextInput
                  style={[styles.optionInput, { flex: 1 }]}
                  placeholder={`Column B item ${String.fromCharCode(65 + idx)}`}
                  value={val}
                  onChangeText={text => {
                    const columnB = [...newQuestion.columnB];
                    columnB[idx] = text;
                    setNewQuestion(prev => ({ ...prev, columnB }));
                  }}
                />
                {newQuestion.columnB.length > 2 && (
                  <TouchableOpacity onPress={() => removeColumnEntry('columnB', idx)}>
                    <MinusCircle color="#EF4444" size={18} />
                  </TouchableOpacity>
                )}
              </View>
            ))}

            <Text style={styles.label}>Correct Matching *</Text>
            {newQuestion.columnA.map((val, aIdx) => (
              <View key={aIdx} style={styles.mappingRow}>
                <Text style={styles.mappingLabel} numberOfLines={1}>{aIdx + 1}. {val || '(empty)'}</Text>
                <View style={styles.mappingChips}>
                  {newQuestion.columnB.map((_, bIdx) => (
                    <TouchableOpacity
                      key={bIdx}
                      style={[
                        styles.mappingChip,
                        newQuestion.correctMapping[String(aIdx)] === String(bIdx) && styles.mappingChipActive
                      ]}
                      onPress={() => setMapping(aIdx, bIdx)}
                    >
                      <Text style={[
                        styles.mappingChipText,
                        newQuestion.correctMapping[String(aIdx)] === String(bIdx) && styles.mappingChipTextActive
                      ]}>{String.fromCharCode(65 + bIdx)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
          </>
        );
      case 'numerical':
        return (
          <>
            <Text style={styles.label}>Correct Numerical Answer *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 42.5"
              keyboardType="numeric"
              value={newQuestion.correctNumerical}
              onChangeText={text => setNewQuestion(prev => ({ ...prev, correctNumerical: text }))}
            />
            <Text style={styles.helperText}>Exact numeric match is required — no tolerance range is applied.</Text>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <ScreenContainer style={styles.container}>
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

        {/* Subject filter */}
        <View style={styles.statsListContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.statsScrollContent}
          >
            <Pressable
              style={[styles.statChip, selectedSubject === '' && styles.statChipActive]}
              onPress={() => setSelectedSubject('')}
            >
              <Text style={[styles.statChipText, selectedSubject === '' && styles.statChipTextActive]}>All</Text>
            </Pressable>

            {stats.bySubject.map((stat, index) => (
              <Pressable
                key={index}
                style={[styles.statChip, selectedSubject === stat._id && styles.statChipActive]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelectedSubject(selectedSubject === stat._id ? '' : stat._id);
                }}
              >
                <Text style={[styles.statChipText, selectedSubject === stat._id && styles.statChipTextActive]}>
                  {stat.subject} ({stat.count})
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Question Type + Difficulty filters */}
        <View style={styles.statsListContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsScrollContent}>
            <Pressable
              style={[styles.statChip, styles.filterChip, filterQuestionType === '' && styles.statChipActive]}
              onPress={() => setFilterQuestionType('')}
            >
              <Text style={[styles.statChipText, filterQuestionType === '' && styles.statChipTextActive]}>All Types</Text>
            </Pressable>
            {QUESTION_TYPES.map(type => (
              <Pressable
                key={type}
                style={[styles.statChip, styles.filterChip, filterQuestionType === type && styles.statChipActive]}
                onPress={() => setFilterQuestionType(filterQuestionType === type ? '' : type)}
              >
                <Text style={[styles.statChipText, filterQuestionType === type && styles.statChipTextActive]}>
                  {QUESTION_TYPE_LABELS[type]}
                </Text>
              </Pressable>
            ))}
            <View style={styles.filterDivider} />
            {DIFFICULTY_LEVELS.map(level => (
              <Pressable
                key={level}
                style={[styles.statChip, styles.filterChip, filterDifficulty === level && styles.statChipActive]}
                onPress={() => setFilterDifficulty(filterDifficulty === level ? '' : level)}
              >
                <Text style={[styles.statChipText, filterDifficulty === level && styles.statChipTextActive]}>
                  {DIFFICULTY_LABELS[level]}
                </Text>
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
          <Animated.ScrollView
            contentContainerStyle={styles.listContent}
            style={{ opacity: contentOpacity }}
            showsVerticalScrollIndicator={false}
          >
            {questions.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconContainer}>
                  <BookOpen color="#01b4ae" size={32} />
                </View>
                <Text style={styles.emptyText}>No questions found</Text>
                <Text style={styles.emptySubtext}>Try adjusting your filters or add a new question</Text>
              </View>
            ) : (
              questions.map((item, index) => renderQuestionCard(item, index))
            )}
          </Animated.ScrollView>
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

          {/* 'height' behavior is never used on Android (this app runs
              edge-to-edge, where RN Modal windows are not resized for the
              keyboard and receive no keyboard events); iOS keeps 'padding' so
              the lower form fields stay reachable above the keyboard. */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalContent}
          >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled={true}
          >
            {/* ---- Question Classification ---- */}
            <Text style={styles.sectionHeading}>Question Classification</Text>

            <Text style={styles.label}>Subject *</Text>
            <View style={{ zIndex: 3000, elevation: 5, overflow: 'visible' }}>
              <TouchableOpacity
                style={styles.dropdownButton}
                onPress={() => setShowSubjectDropdown(!showSubjectDropdown)}
                accessibilityRole="button"
                accessibilityLabel="Select subject"
              >
                <Text style={newQuestion.subject ? styles.dropdownText : styles.placeholderText} numberOfLines={1}>
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
                          setNewQuestion(prev => ({ ...prev, subject: subject._id }));
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

            <Text style={styles.label}>Topic *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., General Pathology"
              value={newQuestion.topicName}
              onChangeText={text => setNewQuestion(prev => ({ ...prev, topicName: text }))}
              accessibilityLabel="Topic"
            />

            <Text style={styles.label}>Subtopic *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Acute Inflammation"
              value={newQuestion.subtopicName}
              onChangeText={text => setNewQuestion(prev => ({ ...prev, subtopicName: text }))}
              accessibilityLabel="Subtopic"
            />
            <Text style={styles.helperText}>Subtopic is a distinct classification level from Topic and Tag.</Text>

            <Text style={styles.label}>System *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Immune System"
              value={newQuestion.system}
              onChangeText={text => setNewQuestion(prev => ({ ...prev, system: text }))}
              accessibilityLabel="System"
            />

            {/* ---- Question Configuration ---- */}
            <Text style={styles.sectionHeading}>Question Configuration</Text>

            <Text style={styles.label}>Question Type *</Text>
            <View style={{ zIndex: 2000, elevation: 4, overflow: 'visible' }}>
              <TouchableOpacity
                style={styles.dropdownButton}
                onPress={() => setShowTypeDropdown(!showTypeDropdown)}
                accessibilityRole="button"
                accessibilityLabel="Select question type"
              >
                <Text style={styles.dropdownText} numberOfLines={1}>{QUESTION_TYPE_LABELS[newQuestion.questionType]}</Text>
                <ChevronDown color="#6B7280" size={20} />
              </TouchableOpacity>
              {showTypeDropdown && (
                <View style={[styles.dropdownList, { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 3000, elevation: 5 }]}>
                  {QUESTION_TYPES.map(type => (
                    <TouchableOpacity
                      key={type}
                      style={styles.dropdownItem}
                      onPress={() => onQuestionTypeChange(type)}
                    >
                      <Text style={[styles.dropdownItemText, newQuestion.questionType === type && styles.selectedDropdownText]}>
                        {QUESTION_TYPE_LABELS[type]}
                      </Text>
                      {newQuestion.questionType === type && <Check color="#01b4ae" size={16} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <Text style={styles.label}>Difficulty *</Text>
            <View style={{ zIndex: 1000, elevation: 3, overflow: 'visible' }}>
              <TouchableOpacity
                style={styles.dropdownButton}
                onPress={() => setShowDifficultyDropdown(!showDifficultyDropdown)}
                accessibilityRole="button"
                accessibilityLabel="Select difficulty"
              >
                <Text style={styles.dropdownText} numberOfLines={1}>{DIFFICULTY_LABELS[newQuestion.difficulty]}</Text>
                <ChevronDown color="#6B7280" size={20} />
              </TouchableOpacity>
              {showDifficultyDropdown && (
                <View style={[styles.dropdownList, { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 2000, elevation: 5 }]}>
                  {DIFFICULTY_LEVELS.map(level => (
                    <TouchableOpacity
                      key={level}
                      style={styles.dropdownItem}
                      onPress={() => { setNewQuestion(prev => ({ ...prev, difficulty: level })); setShowDifficultyDropdown(false); }}
                    >
                      <Text style={[styles.dropdownItemText, newQuestion.difficulty === level && styles.selectedDropdownText]}>
                        {DIFFICULTY_LABELS[level]}
                      </Text>
                      {newQuestion.difficulty === level && <Check color="#01b4ae" size={16} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* ---- Question Content ---- */}
            <Text style={styles.sectionHeading}>Question Content</Text>

            <Text style={styles.label}>Question Text {newQuestion.questionType === 'image_based' ? '' : '*'}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Enter question..."
              multiline
              value={newQuestion.question}
              onChangeText={text => setNewQuestion(prev => ({ ...prev, question: text }))}
            />

            <TouchableOpacity
              style={styles.imageUploadBtn}
              onPress={() => handlePickImage('question')}
            >
              <ImageIcon color="#01b4ae" size={20} />
              <Text style={styles.imageUploadText}>
                {newQuestion.questionImage ? 'Change Image' : (newQuestion.questionType === 'image_based' ? 'Add Image *' : 'Add Image')}
              </Text>
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

            {/* ---- Type-specific answer configuration ---- */}
            {renderTypeSpecificEditor()}

            {/* ---- Additional Classification ---- */}
            <Text style={styles.sectionHeading}>Additional Classification</Text>
            <View>
              <Text style={styles.label}>Tags (Optional)</Text>
              <TextInput
                style={styles.input}
                value={newQuestion.tags?.join(', ') || ''}
                placeholder="e.g., High Yield, Clinical, NEET"
                onChangeText={text => {
                  const tags = text.split(',').map(t => t.trim()).filter(t => t);
                  setNewQuestion(prev => ({ ...prev, tags }));
                }}
                accessibilityLabel="Tags (optional)"
              />
              <Text style={styles.helperText}>Separate multiple tags with commas. Tags are optional.</Text>
            </View>

            <Text style={styles.label}>Explanation</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Explain correct answer..."
              multiline
              value={newQuestion.explanation}
              onChangeText={text => setNewQuestion(prev => ({ ...prev, explanation: text }))}
            />

            <TouchableOpacity
              style={styles.imageUploadBtn}
              onPress={() => handlePickImage('explanation')}
            >
              <ImageIcon color="#01b4ae" size={20} />
              <Text style={styles.imageUploadText}>{newQuestion.explanationImage ? 'Change Image' : 'Add Image'}</Text>
            </TouchableOpacity>

            {newQuestion.explanationImage ? (
              <View style={styles.previewImageContainer}>
                <Image source={{ uri: newQuestion.explanationImage }} style={styles.previewImage} resizeMode="contain" />
                <TouchableOpacity
                  style={styles.removeImgBtn}
                  onPress={() => setNewQuestion(prev => ({ ...prev, explanationImage: '' }))}
                >
                  <X color="#FFF" size={14} />
                </TouchableOpacity>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.disabledBtn]}
              onPress={handleAddQuestion}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>{editingQuestionId ? 'Update' : 'Save Question'}</Text>}
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
          </KeyboardAvoidingView>
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
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
              keyboardShouldPersistTaps="handled"
              bounces={true}
              overScrollMode="always"
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

                <View style={styles.metadataGrid}>
                  <Text style={styles.metadataLine}><Text style={styles.metadataKey}>Topic: </Text>{selectedViewQuestion.topicName || '—'}</Text>
                  <Text style={styles.metadataLine}><Text style={styles.metadataKey}>Subtopic: </Text>{selectedViewQuestion.subtopicName || '—'}</Text>
                  <Text style={styles.metadataLine}><Text style={styles.metadataKey}>System: </Text>{selectedViewQuestion.system || '—'}</Text>
                  <Text style={styles.metadataLine}><Text style={styles.metadataKey}>Question Type: </Text>{QUESTION_TYPE_LABELS[selectedViewQuestion.questionType] || 'MCQ — Single Correct'}</Text>
                  <Text style={styles.metadataLine}><Text style={styles.metadataKey}>Difficulty: </Text>{selectedViewQuestion.difficulty ? DIFFICULTY_LABELS[selectedViewQuestion.difficulty] : '—'}</Text>
                  <Text style={styles.metadataLine}><Text style={styles.metadataKey}>Tags: </Text>{selectedViewQuestion.tags && selectedViewQuestion.tags.length > 0 ? selectedViewQuestion.tags.join(', ') : 'None'}</Text>
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

                {selectedViewQuestion.questionType === 'assertion_reason' && (
                  <View style={{ marginBottom: 16 }}>
                    <Text style={styles.metadataLine}><Text style={styles.metadataKey}>Assertion: </Text>{selectedViewQuestion.assertion}</Text>
                    <Text style={styles.metadataLine}><Text style={styles.metadataKey}>Reason: </Text>{selectedViewQuestion.reason}</Text>
                  </View>
                )}

                {selectedViewQuestion.questionType === 'match_the_following' ? (
                  <View>
                    {(selectedViewQuestion.columnA || []).map((a, idx) => {
                      const mapping = (selectedViewQuestion.correctAnswer as Record<string, string>) || {};
                      const bIdx = mapping[String(idx)];
                      const bText = bIdx !== undefined ? selectedViewQuestion.columnB?.[Number(bIdx)] : undefined;
                      return (
                        <View key={idx} style={styles.previewOption}>
                          <Text style={styles.previewOptionText}>{idx + 1}. {a} → {bText ? `${String.fromCharCode(65 + Number(bIdx))}. ${bText}` : '—'}</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : selectedViewQuestion.questionType === 'numerical' ? (
                  <View style={styles.previewOption}>
                    <Text style={styles.previewOptionText}>Correct Answer: {String(selectedViewQuestion.correctAnswer)}</Text>
                  </View>
                ) : (
                  (selectedViewQuestion.options || []).map((opt, idx) => {
                    const isMultiple = selectedViewQuestion.questionType === 'multiple_correct';
                    const correct = isMultiple
                      ? Array.isArray(selectedViewQuestion.correctAnswer) && (selectedViewQuestion.correctAnswer as number[]).includes(idx)
                      : selectedViewQuestion.correctAnswer === idx;
                    return (
                      <View
                        key={idx}
                        style={[styles.previewOption, correct && styles.previewOptionCorrect]}
                      >
                        <Text style={[styles.previewOptionLabel, correct && styles.previewOptionLabelCorrect]}>
                          {String.fromCharCode(65 + idx)}
                        </Text>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.previewOptionText, correct && styles.previewOptionTextCorrect]}>{opt}</Text>
                          {selectedViewQuestion.optionImages?.[idx] ? (
                            <Image source={{ uri: selectedViewQuestion.optionImages[idx] }} style={styles.previewOptionImage} resizeMode="contain" />
                          ) : null}
                        </View>
                        {correct && <Check color="#10B981" size={20} />}
                      </View>
                    );
                  })
                )}

                {(selectedViewQuestion.explanation || selectedViewQuestion.explanationImage) && (
                  <View style={styles.explanationBox}>
                    <Text style={styles.explanationTitle}>Explanation</Text>
                    {selectedViewQuestion.explanation ? <Text style={styles.explanationText}>{selectedViewQuestion.explanation}</Text> : null}
                    {selectedViewQuestion.explanationImage ? (
                      <Image
                        source={{ uri: selectedViewQuestion.explanationImage }}
                        style={[styles.previewMainImage, { marginTop: 10, height: 180 }]}
                        resizeMode="contain"
                      />
                    ) : null}
                  </View>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      <ImageUploadSummaryModal
        visible={!!imageSummary}
        summary={imageSummary}
        onClose={() => setImageSummary(null)}
      />

    </ScreenContainer>
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
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 12,
  },
  filterDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 4,
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
    marginBottom: 16,
  },
  questionCardPressed: {
    transform: [{ scale: 0.98 }],
    shadowOpacity: 0.04,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
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
    fontSize: 11,
    fontWeight: '500',
  },
  subtopicBadge: {
    backgroundColor: '#F5F3FF',
  },
  subtopicBadgeText: {
    color: '#7C3AED',
    fontSize: 11,
    fontWeight: '500',
  },
  systemBadge: {
    backgroundColor: '#FFF7ED',
  },
  systemBadgeText: {
    color: '#EA580C',
    fontSize: 11,
    fontWeight: '500',
  },
  difficultyBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#374151',
  },
  marksBadge: {
    backgroundColor: '#ECFDF5',
  },
  marksBadgeText: {
    color: '#10B981',
    fontWeight: '600',
  },
  typeRow: {
    marginBottom: 8,
  },
  typeRowText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#01b4ae',
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
    flex: 1,
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
  sectionHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: '#01b4ae',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 4,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 20,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addOptionBtn: {
    padding: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 12,
    fontSize: 16,
    color: '#1F2937',
    marginBottom: 16,
  },
  helperText: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: -12,
    marginBottom: 16,
    marginLeft: 4
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
    marginBottom: 16,
  },
  dropdownText: {
    fontSize: 16,
    color: '#1F2937',
    flex: 1,
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
    maxHeight: 260,
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
    flex: 1,
    marginRight: 8,
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
  checkBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 14,
  },
  checkBtnSelected: {
    borderColor: '#01b4ae',
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
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  matchIndex: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6B7280',
    width: 20,
  },
  mappingRow: {
    marginBottom: 12,
  },
  mappingLabel: {
    fontSize: 13,
    color: '#374151',
    marginBottom: 6,
  },
  mappingChips: {
    flexDirection: 'row',
    gap: 8,
  },
  mappingChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mappingChipActive: {
    backgroundColor: '#01b4ae',
    borderColor: '#01b4ae',
  },
  mappingChipText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
  },
  mappingChipTextActive: {
    color: '#FFF',
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
  metadataGrid: {
    marginBottom: 16,
    gap: 4,
  },
  metadataLine: {
    fontSize: 13,
    color: '#374151',
  },
  metadataKey: {
    fontWeight: '700',
    color: '#1F2937',
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
