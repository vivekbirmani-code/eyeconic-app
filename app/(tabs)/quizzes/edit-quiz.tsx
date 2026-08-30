import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  Image,
  FlatList,
} from 'react-native';
import { ScreenContainer, FullScreenContainer } from '@/components/layout';
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
import DateTimePicker from '@react-native-community/datetimepicker';

interface Question {
  _id: string;
  qid?: string;
  question: string;
  questionImage?: string;
  questionType?: string;
  options?: string[];
  optionImages?: string[];
  assertion?: string;
  reason?: string;
  columnA?: string[];
  columnB?: string[];
  correctAnswer?: any;
  explanation?: string;
  explanationImage?: string;
  marks: number;
  topicName?: string;
  subtopicName?: string;
  system?: string;
  difficulty?: string;
  subject: { _id: string; name: string };
  tags?: string[];
}

interface Quiz {
  _id: string;
  title: string;
  subject: { _id: string; name: string };
  subjectNames?: string[];
  testType: string;
  duration: number;
  instructions: string[];
  questions: Question[];
  totalMarks: number;
  scheduledDate?: string;
  expiryDate?: string;
  sections?: Array<{
    name: string;
    duration: number;
    selectionType?: 'mixed' | 'manual';
    questions?: Array<Question | string>;
  }>;
}

interface Subject {
  _id: string;
  name: string;
}

interface QuizSection {
  name: string;
  duration: number;
  selectionType: 'mixed' | 'manual';
  questions: string[];
}

const getUniqueSubjectNames = (quizData: Quiz | null, questions: Question[]): string[] => {
  const fromApi = Array.isArray(quizData?.subjectNames)
    ? quizData.subjectNames.filter(Boolean)
    : [];
  if (fromApi.length > 0) return [...new Set(fromApi)];

  const fromQuestions = (questions || [])
    .map(q => q.subject?.name)
    .filter(Boolean) as string[];
  if (fromQuestions.length > 0) return [...new Set(fromQuestions)];

  if (quizData?.subject?.name) return [quizData.subject.name];
  return [];
};

const normalizeMixedQuizTitle = (rawTitle: string, subjectNames: string[]): string => {
  if (!rawTitle || subjectNames.length <= 1) return rawTitle;
  if (/^\s*mixed\b/i.test(rawTitle)) return rawTitle;

  const generatedTitleMatch = rawTitle.match(/^\s*.+?\s+((?:Daily|Weekly|Grand)\s+Test\s+-\s+.+)$/i);
  if (!generatedTitleMatch) return rawTitle;
  return `Mixed ${generatedTitleMatch[1]}`;
};

const parseNonNegativeInt = (value: string): number => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

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

  // Time Window
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [tempDate, setTempDate] = useState<Date>(new Date());

  // Question Picker Modal
  const [showQuestionPicker, setShowQuestionPicker] = useState(false);
  const [availableQuestions, setAvailableQuestions] = useState<Question[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [questionSearch, setQuestionSearch] = useState('');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [filterSubjectId, setFilterSubjectId] = useState<string>('all');
  // Temporary selection state for the picker (committed on Save)
  const [pickerSelections, setPickerSelections] = useState<Set<string>>(new Set());

  // Question Preview Modal
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null);

  // Section Management
  const [quizSections, setQuizSections] = useState<QuizSection[]>([]);
  const [showSectionQuestionPicker, setShowSectionQuestionPicker] = useState(false);
  const [activeSectionIndex, setActiveSectionIndex] = useState<number | null>(null);
  const [sectionQuestionSelections, setSectionQuestionSelections] = useState<Set<string>>(new Set());
  const [sectionQuestionSearch, setSectionQuestionSearch] = useState('');
  const [sectionFilterSubjectId, setSectionFilterSubjectId] = useState<string>('all');

  useEffect(() => {
    if (id) {
      loadQuiz();
    }
  }, [id]);

  const loadQuiz = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/quizzes/${id}`);
      const quizData: Quiz = response.data;
      const fetchedQuestions = quizData.questions || [];
      const subjectNames = getUniqueSubjectNames(quizData, fetchedQuestions);
      
      setQuiz(quizData);
      setTitle(normalizeMixedQuizTitle(quizData.title, subjectNames));
      setDuration(quizData.duration.toString());
      setInstructions(quizData.instructions?.join('\n') || '');
      setSelectedQuestions(fetchedQuestions);
      setQuizSections(
        (quizData.sections || []).map(section => ({
          name: section.name || '',
          duration: Number(section.duration) || 0,
          selectionType: section.selectionType === 'mixed' ? 'mixed' : 'manual',
          questions: (section.questions || [])
            .map((q: any) => (typeof q === 'string' ? q : q?._id))
            .filter(Boolean)
        }))
      );

      // Load time window
      if (quizData.scheduledDate) setScheduledDate(new Date(quizData.scheduledDate));
      if (quizData.expiryDate) setExpiryDate(new Date(quizData.expiryDate));
    } catch (error) {
      console.error('Error loading quiz:', error);
      Alert.alert('Error', 'Failed to load quiz details');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  // allQuestions holds every question loaded when the picker opens — never changes during session
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);

  const loadAllQuestions = async () => {
    try {
      setLoadingQuestions(true);
      // Load without subject filter so we get everything; use a large limit
      const response = await api.get('/question-bank', { params: { limit: 1000 } });
      const fetchedQs: Question[] = response.data.questions || response.data;
      setAllQuestions(fetchedQs);
      setAvailableQuestions(fetchedQs); // keep availableQuestions in sync
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
    // Initialize picker selections from the current selected questions
    const initialSelections = new Set(selectedQuestions.map(q => q._id));
    setPickerSelections(initialSelections);

    setShowQuestionPicker(true);
    setFilterSubjectId('all');
    setQuestionSearch('');
    fetchSubjects();
    loadAllQuestions();
  };

  const handleTogglePickerQuestion = (question: Question) => {
    setPickerSelections(prev => {
      const next = new Set(prev);
      if (next.has(question._id)) {
        next.delete(question._id);
      } else {
        next.add(question._id);
      }
      return next;
    });
  };

  const handleSavePickerSelections = () => {
    // Build the selection array from allQuestions + initially selected questions
    const pool = [...allQuestions, ...selectedQuestions];
    const seen = new Set<string>();
    const deduped = pool.filter(q => {
      if (seen.has(q._id)) return false;
      seen.add(q._id);
      return true;
    });
    const newSelection = deduped.filter(q => pickerSelections.has(q._id));
    setSelectedQuestions(newSelection);
    setShowQuestionPicker(false);
  };

  const handleRemoveQuestion = (questionId: string) => {
    setSelectedQuestions(selectedQuestions.filter(q => q._id !== questionId));
  };

  const updateSection = (index: number, updates: Partial<QuizSection>) => {
    setQuizSections(prev =>
      prev.map((section, i) => (i === index ? { ...section, ...updates } : section))
    );
  };

  const initializeSections = (count: number) => {
    const totalDuration = parseInt(duration, 10) || 0;
    const equalTime = count > 0 ? Math.floor(totalDuration / count) : 0;
    const nextSections: QuizSection[] = [];

    for (let i = 0; i < count; i++) {
      nextSections.push({
        name: `Section ${i + 1}`,
        duration: i === count - 1 ? totalDuration - (equalTime * (count - 1)) : equalTime,
        selectionType: 'mixed',
        questions: []
      });
    }

    setQuizSections(nextSections);
  };

  const addSection = () => {
    const nextIndex = quizSections.length + 1;
    setQuizSections(prev => [
      ...prev,
      { name: `Section ${nextIndex}`, duration: 0, selectionType: 'mixed', questions: [] }
    ]);
  };

  const removeSection = (index: number) => {
    setQuizSections(prev => prev.filter((_, i) => i !== index));
  };

  const openSectionQuestionPicker = (sectionIndex: number) => {
    const section = quizSections[sectionIndex];
    if (!section) return;
    setActiveSectionIndex(sectionIndex);
    setSectionQuestionSelections(new Set(section.questions));
    setSectionQuestionSearch('');
    setSectionFilterSubjectId('all');
    setShowSectionQuestionPicker(true);
  };

  const closeSectionQuestionPicker = () => {
    setShowSectionQuestionPicker(false);
    setActiveSectionIndex(null);
    setSectionQuestionSelections(new Set());
    setSectionQuestionSearch('');
    setSectionFilterSubjectId('all');
  };

  const saveSectionQuestionPicker = () => {
    if (activeSectionIndex === null) return;
    updateSection(activeSectionIndex, { questions: Array.from(sectionQuestionSelections) });
    closeSectionQuestionPicker();
  };

  const toggleSectionQuestionSelection = (questionId: string) => {
    setSectionQuestionSelections(prev => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
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

    const totalDuration = parseInt(duration, 10) || 0;
    if (totalDuration <= 0) {
      Alert.alert('Error', 'Quiz duration must be greater than 0 minutes');
      return;
    }

    const validQuestionIds = new Set(selectedQuestions.map(q => q._id));
    const sectionPayload = quizSections.map(section => ({
      name: section.name.trim(),
      duration: parseNonNegativeInt(String(section.duration)),
      selectionType: section.selectionType,
      questions: section.selectionType === 'manual'
        ? section.questions.filter(qid => validQuestionIds.has(qid))
        : []
    }));

    const invalidSection = sectionPayload.find(section => !section.name || section.duration <= 0);
    if (invalidSection) {
      Alert.alert('Error', 'Each section must have a name and duration greater than 0');
      return;
    }

    const manualSectionWithoutQuestions = sectionPayload.find(
      section => section.selectionType === 'manual' && section.questions.length === 0
    );
    if (manualSectionWithoutQuestions) {
      Alert.alert('Error', 'Manual sections must have at least one assigned question');
      return;
    }

    const questionOwnerBySection = new Map<string, string>();
    for (const section of sectionPayload) {
      if (section.selectionType !== 'manual') continue;
      for (const qid of section.questions) {
        const owner = questionOwnerBySection.get(qid);
        if (owner) {
          Alert.alert(
            'Error',
            `A question is assigned to multiple sections (${owner} and ${section.name}). Assign each question to only one section.`
          );
          return;
        }
        questionOwnerBySection.set(qid, section.name);
      }
    }

    const hasMixedSection = sectionPayload.some(section => section.selectionType === 'mixed');
    if (!hasMixedSection && sectionPayload.length > 0 && questionOwnerBySection.size < selectedQuestions.length) {
      Alert.alert(
        'Error',
        `All questions must be assigned when sections are Manual only. ${selectedQuestions.length - questionOwnerBySection.size} question(s) are unassigned.`
      );
      return;
    }

    if (sectionPayload.length > 0) {
      const allocated = sectionPayload.reduce((sum, section) => sum + section.duration, 0);
      if (allocated !== totalDuration) {
        Alert.alert(
          'Error',
          `Section time allocation (${allocated} mins) must match quiz duration (${totalDuration} mins)`
        );
        return;
      }
    }

    try {
      setSaving(true);
      await api.put(`/quizzes/${id}`, {
        title: title.trim(),
        duration: totalDuration,
        instructions: instructions.split('\n').filter(line => line.trim()),
        questions: selectedQuestions.map(q => q._id),
        sections: sectionPayload,
        scheduledDate: scheduledDate?.toISOString(),
        expiryDate: expiryDate?.toISOString()
      });

      // Refresh local quiz state so screen shows updated values immediately
      await loadQuiz();
      Alert.alert('Success', 'Quiz updated successfully');
    } catch (error) {
      console.error('Error saving quiz:', error);
      Alert.alert('Error', 'Failed to save quiz');
    } finally {
      setSaving(false);
    }
  };

  // Client-side filtering: filter allQuestions by subject chip AND search text
  const filteredAvailableQuestions = allQuestions.filter(q => {
    // Subject chip filter
    if (filterSubjectId && filterSubjectId !== 'all') {
      // Match against the question's subject._id
      const qSubjectId = typeof q.subject === 'object' ? (q.subject as any)?._id : q.subject;
      if (qSubjectId !== filterSubjectId) return false;
    }
    // Text search filter
    if (questionSearch) {
      const search = questionSearch.toLowerCase();
      return q.question.toLowerCase().includes(search) ||
             (q.qid?.toLowerCase() ?? '').includes(search) ||
             (q.topicName?.toLowerCase() ?? '').includes(search);
    }
    return true;
  });

  useEffect(() => {
    const selectedQuestionIds = new Set(selectedQuestions.map(q => q._id));
    let changed = false;

    const prunedSections = quizSections.map(section => {
      const kept = section.questions.filter(qid => selectedQuestionIds.has(qid));
      if (kept.length !== section.questions.length) {
        changed = true;
        return { ...section, questions: kept };
      }
      return section;
    });

    if (changed) {
      setQuizSections(prunedSections);
    }
  }, [selectedQuestions, quizSections]);

  const sectionPickerSubjects = useMemo(() => {
    const map = new Map<string, Subject>();
    selectedQuestions.forEach(q => {
      const sid = q.subject?._id;
      if (sid && !map.has(sid)) {
        map.set(sid, { _id: sid, name: q.subject?.name || 'General' });
      }
    });
    return Array.from(map.values());
  }, [selectedQuestions]);

  useEffect(() => {
    if (sectionFilterSubjectId !== 'all' && !sectionPickerSubjects.some(s => s._id === sectionFilterSubjectId)) {
      setSectionFilterSubjectId('all');
    }
  }, [sectionFilterSubjectId, sectionPickerSubjects]);

  const filteredSectionQuestions = useMemo(() => {
    const search = sectionQuestionSearch.trim().toLowerCase();
    return selectedQuestions.filter(q => {
      if (sectionFilterSubjectId !== 'all' && q.subject?._id !== sectionFilterSubjectId) {
        return false;
      }
      if (!search) return true;
      return q.question.toLowerCase().includes(search) ||
        (q.qid?.toLowerCase() ?? '').includes(search) ||
        (q.topicName?.toLowerCase() ?? '').includes(search);
    });
  }, [selectedQuestions, sectionFilterSubjectId, sectionQuestionSearch]);

  const sectionQuestionStats = useMemo(() => {
    const selectedIds = new Set(selectedQuestions.map(q => q._id));
    const manualOwners = new Map<string, string>();
    let duplicateAssignments = 0;

    quizSections.forEach(section => {
      if (section.selectionType !== 'manual') return;

      const uniqueWithinSection = [...new Set(section.questions.filter(qid => selectedIds.has(qid)))];
      uniqueWithinSection.forEach(qid => {
        if (manualOwners.has(qid)) {
          duplicateAssignments += 1;
        } else {
          manualOwners.set(qid, section.name || 'Unnamed');
        }
      });
    });

    const hasMixedSection = quizSections.some(section => section.selectionType === 'mixed');
    const uniqueManualAssigned = manualOwners.size;
    const unassignedWithoutMixed = hasMixedSection
      ? 0
      : Math.max(0, selectedQuestions.length - uniqueManualAssigned);

    return {
      hasMixedSection,
      uniqueManualAssigned,
      duplicateAssignments,
      unassignedWithoutMixed
    };
  }, [quizSections, selectedQuestions]);

  const subjectNames = useMemo(
    () => getUniqueSubjectNames(quiz, selectedQuestions),
    [quiz, selectedQuestions]
  );
  const subjectLabel = subjectNames.length > 1 ? 'Mixed' : (subjectNames[0] || 'General');

  if (user?.role !== 'admin') {
    return (
      <ScreenContainer style={styles.container}>
        <Text style={styles.errorText}>Admin access required</Text>
      </ScreenContainer>
    );
  }

  if (loading) {
    return (
      <ScreenContainer style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.loadingText}>Loading quiz...</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.container}>
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
                onChangeText={(val) => setDuration(val.replace(/[^0-9]/g, ''))}
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
              <Text style={styles.readOnlyText}>{subjectLabel}</Text>
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

          {/* Time Window */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Start Date & Time</Text>
            <TouchableOpacity
              style={styles.datePickerButton}
              onPress={() => {
                setTempDate(scheduledDate || new Date());
                setPickerMode('date');
                setShowStartPicker(true);
              }}
            >
              <Text style={[styles.datePickerText, !scheduledDate && { color: '#9CA3AF' }]}>
                {scheduledDate ? scheduledDate.toLocaleString() : 'Select start date & time'}
              </Text>
            </TouchableOpacity>
            {showStartPicker && (
              <DateTimePicker
                value={tempDate}
                mode={pickerMode}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(event: any, selected?: Date) => {
                  if (event.type === 'dismissed') {
                    setShowStartPicker(false);
                    return;
                  }
                  if (selected) {
                    if (pickerMode === 'date') {
                      setTempDate(selected);
                      setPickerMode('time');
                    } else {
                      setScheduledDate(selected);
                      setShowStartPicker(false);
                      setPickerMode('date');
                    }
                  }
                }}
              />
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>End Date & Time</Text>
            <TouchableOpacity
              style={styles.datePickerButton}
              onPress={() => {
                setTempDate(expiryDate || new Date());
                setPickerMode('date');
                setShowEndPicker(true);
              }}
            >
              <Text style={[styles.datePickerText, !expiryDate && { color: '#9CA3AF' }]}>
                {expiryDate ? expiryDate.toLocaleString() : 'Select end date & time'}
              </Text>
            </TouchableOpacity>
            {showEndPicker && (
              <DateTimePicker
                value={tempDate}
                mode={pickerMode}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(event: any, selected?: Date) => {
                  if (event.type === 'dismissed') {
                    setShowEndPicker(false);
                    return;
                  }
                  if (selected) {
                    if (pickerMode === 'date') {
                      setTempDate(selected);
                      setPickerMode('time');
                    } else {
                      setExpiryDate(selected);
                      setShowEndPicker(false);
                      setPickerMode('date');
                    }
                  }
                }}
              />
            )}

            {scheduledDate && expiryDate && expiryDate <= scheduledDate && (
              <Text style={{ color: '#EF4444', fontSize: 12, marginTop: 4 }}>
                ⚠️ End date must be after start date
              </Text>
            )}
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

        {/* Sections Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Sections ({quizSections.length})</Text>
            <TouchableOpacity style={styles.addButton} onPress={addSection}>
              <Plus color="#FFF" size={18} />
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Total Duration: {parseInt(duration, 10) || 0} mins | Allocated: {quizSections.reduce((sum, s) => sum + (Number(s.duration) || 0), 0)} mins
            </Text>
            <Text style={styles.infoText}>
              Question Pool: {selectedQuestions.length} | Manual Assigned (unique): {sectionQuestionStats.uniqueManualAssigned}
            </Text>
            {sectionQuestionStats.duplicateAssignments > 0 && (
              <Text style={styles.infoWarningText}>
                Duplicate question assignment detected across sections.
              </Text>
            )}
            {!sectionQuestionStats.hasMixedSection && sectionQuestionStats.unassignedWithoutMixed > 0 && (
              <Text style={styles.infoWarningText}>
                {sectionQuestionStats.unassignedWithoutMixed} question(s) are not assigned to any section.
              </Text>
            )}
            <Text style={styles.infoHint}>Use Manual to assign specific questions to each section.</Text>
          </View>

          <View style={styles.sectionSetupHeader}>
            <Text style={styles.label}>Quick Section Count (No. of sections)</Text>
            <View style={styles.quickCountRow}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity
                  key={n}
                  style={[styles.smallChip, quizSections.length === n && styles.smallChipActive]}
                  onPress={() => initializeSections(n)}
                >
                  <Text style={[styles.smallChipText, quizSections.length === n && styles.smallChipTextActive]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {quizSections.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No sections configured</Text>
              <Text style={styles.emptySubtext}>Add a section or set quick count above</Text>
            </View>
          ) : (
            quizSections.map((section, idx) => (
              <View key={`${section.name}-${idx}`} style={styles.sectionConfigCard}>
                <View style={styles.sectionRow}>
                  <TextInput
                    style={[styles.input, { flex: 2, marginRight: 8 }]}
                    value={section.name}
                    onChangeText={(val) => updateSection(idx, { name: val })}
                    placeholder="Section Name"
                    placeholderTextColor="#9CA3AF"
                  />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={String(section.duration || '')}
                    onChangeText={(val) => updateSection(idx, { duration: parseNonNegativeInt(val) })}
                    keyboardType="numeric"
                    placeholder="Mins"
                    placeholderTextColor="#9CA3AF"
                  />
                  <TouchableOpacity
                    style={styles.sectionDeleteButton}
                    onPress={() => removeSection(idx)}
                  >
                    <Trash2 color="#EF4444" size={18} />
                  </TouchableOpacity>
                </View>

                <View style={styles.sectionTypeRow}>
                  <TouchableOpacity
                    style={[styles.typeButton, section.selectionType === 'mixed' && styles.typeButtonActive]}
                    onPress={() => updateSection(idx, { selectionType: 'mixed', questions: [] })}
                  >
                    <Text style={[styles.typeButtonText, section.selectionType === 'mixed' && styles.typeButtonTextActive]}>
                      Mixed
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.typeButton, section.selectionType === 'manual' && styles.typeButtonActive]}
                    onPress={() => updateSection(idx, { selectionType: 'manual' })}
                  >
                    <Text style={[styles.typeButtonText, section.selectionType === 'manual' && styles.typeButtonTextActive]}>
                      Manual
                    </Text>
                  </TouchableOpacity>
                </View>

                {section.selectionType === 'manual' && (
                  <View style={{ marginTop: 12 }}>
                    <View style={styles.manualHeaderRow}>
                      <Text style={styles.manualCountText}>Questions assigned: {section.questions.length}</Text>
                      <TouchableOpacity
                        style={styles.manualSelectButton}
                        onPress={() => openSectionQuestionPicker(idx)}
                      >
                        <Text style={styles.manualSelectButtonText}>Select Questions</Text>
                      </TouchableOpacity>
                    </View>

                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                      {section.questions.length === 0 ? (
                        <Text style={styles.emptySubtext}>No questions selected</Text>
                      ) : (
                        section.questions.map(qid => {
                          const q = selectedQuestions.find(item => item._id === qid);
                          if (!q) return null;
                          return (
                            <View key={qid} style={styles.qTinyChip}>
                              <Text style={styles.qTinyChipText} numberOfLines={1}>
                                {q.question}
                              </Text>
                            </View>
                          );
                        })
                      )}
                    </ScrollView>
                  </View>
                )}
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
        <FullScreenContainer style={styles.modalContainer}>
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
              onPress={() => setFilterSubjectId('all')}
            >
              <Text style={[styles.subjectChipText, filterSubjectId === 'all' && styles.subjectChipTextActive]}>
                All
              </Text>
            </TouchableOpacity>
            {subjects?.map(sub => (
              <TouchableOpacity
                key={sub._id}
                style={[styles.subjectChip, filterSubjectId === sub._id && styles.subjectChipActive]}
                onPress={() => setFilterSubjectId(sub._id)}
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
              contentContainerStyle={[styles.listContent, { paddingBottom: 90 }]}
              renderItem={({ item }) => {
                const selected = pickerSelections.has(item._id);
                return (
                  <TouchableOpacity
                    style={[
                      styles.pickerItem,
                      selected && styles.pickerItemSelected
                    ]}
                    onPress={() => handleTogglePickerQuestion(item)}
                    activeOpacity={0.7}
                  >
                    <View style={[
                      styles.pickerCheckbox,
                      selected && styles.pickerCheckboxSelected
                    ]}>
                      {selected && <Check color="#FFF" size={14} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerQuestionText} numberOfLines={2}>
                        {item.question}
                      </Text>
                      <Text style={styles.pickerMeta}>
                        {item.subject?.name ? `${item.subject.name}` : ''}{item.topicName ? ` • ${item.topicName}` : ''} • {item.marks}M
                      </Text>
                    </View>
                    {item.questionImage && (
                      <ImageIcon size={16} color="#2563EB" />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No questions found</Text>
                </View>
              }
            />
          )}

          {/* Save selection button */}
          <View style={styles.pickerSaveBar}>
            <Text style={styles.pickerSelectionCount}>
              {pickerSelections.size} question{pickerSelections.size !== 1 ? 's' : ''} selected
            </Text>
            <TouchableOpacity
              style={styles.pickerSaveButton}
              onPress={handleSavePickerSelections}
            >
              <Check color="#FFF" size={18} />
              <Text style={styles.pickerSaveButtonText}>Save Selection</Text>
            </TouchableOpacity>
          </View>
        </FullScreenContainer>
      </Modal>

      {/* Section Question Picker Modal */}
      <Modal
        visible={showSectionQuestionPicker}
        animationType="slide"
        onRequestClose={closeSectionQuestionPicker}
      >
        <FullScreenContainer style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {activeSectionIndex !== null ? `Section ${activeSectionIndex + 1} Questions` : 'Section Questions'}
            </Text>
            <TouchableOpacity onPress={closeSectionQuestionPicker}>
              <X color="#FFF" size={24} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchContainer}>
            <Search color="#6B7280" size={20} />
            <TextInput
              style={styles.searchInput}
              value={sectionQuestionSearch}
              onChangeText={setSectionQuestionSearch}
              placeholder="Search selected quiz questions..."
              placeholderTextColor="#9CA3AF"
            />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.subjectFilterContainer}
            contentContainerStyle={styles.subjectFilterContent}
          >
            <TouchableOpacity
              style={[styles.subjectChip, sectionFilterSubjectId === 'all' && styles.subjectChipActive]}
              onPress={() => setSectionFilterSubjectId('all')}
            >
              <Text style={[styles.subjectChipText, sectionFilterSubjectId === 'all' && styles.subjectChipTextActive]}>
                All
              </Text>
            </TouchableOpacity>
            {sectionPickerSubjects.map(sub => (
              <TouchableOpacity
                key={sub._id}
                style={[styles.subjectChip, sectionFilterSubjectId === sub._id && styles.subjectChipActive]}
                onPress={() => setSectionFilterSubjectId(sub._id)}
              >
                <Text style={[styles.subjectChipText, sectionFilterSubjectId === sub._id && styles.subjectChipTextActive]}>
                  {sub.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <FlatList
            data={filteredSectionQuestions}
            keyExtractor={(item) => item._id}
            contentContainerStyle={[styles.listContent, { paddingBottom: 90 }]}
            renderItem={({ item }) => {
              const selected = sectionQuestionSelections.has(item._id);
              return (
                <TouchableOpacity
                  style={[styles.pickerItem, selected && styles.pickerItemSelected]}
                  onPress={() => toggleSectionQuestionSelection(item._id)}
                >
                  <View style={[styles.pickerCheckbox, selected && styles.pickerCheckboxSelected]}>
                    {selected && <Check color="#FFF" size={14} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerQuestionText} numberOfLines={2}>
                      {item.question}
                    </Text>
                    <Text style={styles.pickerMeta}>
                      {item.subject?.name || 'General'}{item.topicName ? ` • ${item.topicName}` : ''} • {item.marks}M
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No questions found</Text>
              </View>
            }
          />

          <View style={styles.pickerSaveBar}>
            <Text style={styles.pickerSelectionCount}>
              {sectionQuestionSelections.size} question{sectionQuestionSelections.size !== 1 ? 's' : ''} selected
            </Text>
            <TouchableOpacity style={styles.pickerSaveButton} onPress={saveSectionQuestionPicker}>
              <Check color="#FFF" size={18} />
              <Text style={styles.pickerSaveButtonText}>Save Selection</Text>
            </TouchableOpacity>
          </View>
        </FullScreenContainer>
      </Modal>

      {/* Question Preview Modal */}
      <Modal
        visible={!!previewQuestion}
        animationType="slide"
        onRequestClose={() => setPreviewQuestion(null)}
      >
        <FullScreenContainer style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Question Preview</Text>
            <TouchableOpacity onPress={() => setPreviewQuestion(null)}>
              <X color="#FFF" size={24} />
            </TouchableOpacity>
          </View>

          {previewQuestion && (
            <ScrollView 
              style={styles.previewContent} 
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
              contentContainerStyle={{ paddingBottom: 40 }}
              overScrollMode="always"
            >
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

              {previewQuestion.questionType === 'assertion_reason' && (
                <View style={styles.previewSection}>
                  <Text style={styles.previewLabel}>Assertion</Text>
                  <Text style={styles.previewText}>{previewQuestion.assertion}</Text>
                  <Text style={[styles.previewLabel, { marginTop: 12 }]}>Reason</Text>
                  <Text style={styles.previewText}>{previewQuestion.reason}</Text>
                </View>
              )}

              {previewQuestion.questionType === 'match_the_following' ? (
                <View style={styles.previewSection}>
                  <Text style={styles.previewLabel}>Column A</Text>
                  {(previewQuestion.columnA || []).map((a: string, i: number) => (
                    <Text key={i} style={styles.previewOptionText}>{i + 1}. {a}</Text>
                  ))}
                  <Text style={[styles.previewLabel, { marginTop: 12 }]}>Column B</Text>
                  {(previewQuestion.columnB || []).map((b: string, i: number) => (
                    <Text key={i} style={styles.previewOptionText}>{String.fromCharCode(65 + i)}. {b}</Text>
                  ))}
                </View>
              ) : previewQuestion.questionType === 'numerical' ? (
                <View style={styles.previewSection}>
                  <Text style={styles.previewLabel}>Correct Answer</Text>
                  <Text style={styles.previewText}>{String(previewQuestion.correctAnswer)}</Text>
                </View>
              ) : (
              <View style={styles.previewSection}>
                <Text style={styles.previewLabel}>Options</Text>
                {(previewQuestion.options || []).map((option: string, index: number) => {
                  const isCorrect = Array.isArray(previewQuestion.correctAnswer)
                    ? previewQuestion.correctAnswer.includes(index)
                    : previewQuestion.correctAnswer === index;
                  return (
                  <View
                    key={index}
                    style={[
                      styles.previewOption,
                      isCorrect && styles.correctOption
                    ]}
                  >
                    <Text style={[
                      styles.previewOptionLabel,
                      isCorrect && styles.correctText
                    ]}>
                      {String.fromCharCode(65 + index)}.
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[
                        styles.previewOptionText,
                        isCorrect && styles.correctText
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
                    {isCorrect && (
                      <Check color="#059669" size={20} />
                    )}
                  </View>
                  );
                })}
              </View>
              )}

              {previewQuestion.explanation && (
                <View style={[styles.previewSection, { backgroundColor: '#FEF3C7' }]}>
                  <Text style={styles.previewLabel}>Explanation</Text>
                  <Text style={styles.explanationText}>{previewQuestion.explanation}</Text>
                </View>
              )}

              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </FullScreenContainer>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
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
  infoBox: {
    backgroundColor: '#EBF5FF',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  infoText: {
    fontSize: 14,
    color: '#1E40AF',
    fontWeight: '600',
  },
  infoWarningText: {
    marginTop: 6,
    fontSize: 12,
    color: '#B91C1C',
    fontWeight: '600',
  },
  infoHint: {
    marginTop: 6,
    fontSize: 12,
    color: '#1E40AF',
  },
  sectionSetupHeader: {
    marginBottom: 12,
  },
  quickCountRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  smallChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  smallChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  smallChipText: {
    fontSize: 12,
    color: '#4B5563',
  },
  smallChipTextActive: {
    color: '#FFF',
    fontWeight: '700',
  },
  sectionConfigCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionDeleteButton: {
    marginLeft: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
  },
  sectionTypeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  typeButtonActive: {
    borderColor: '#2563EB',
    backgroundColor: '#EBF5FF',
  },
  typeButtonText: {
    fontSize: 13,
    color: '#4B5563',
  },
  typeButtonTextActive: {
    color: '#2563EB',
    fontWeight: '600',
  },
  manualHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  manualCountText: {
    fontSize: 12,
    color: '#6B7280',
  },
  manualSelectButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#2563EB',
  },
  manualSelectButtonText: {
    fontSize: 12,
    color: '#FFF',
    fontWeight: '600',
  },
  qTinyChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    maxWidth: 180,
  },
  qTinyChipText: {
    fontSize: 11,
    color: '#6B7280',
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
  pickerCheckboxSelected: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  pickerSaveBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  pickerSelectionCount: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  pickerSaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  pickerSaveButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
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
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
  },
  datePickerText: {
    fontSize: 15,
    color: '#1F2937',
    flex: 1,
  },
});
