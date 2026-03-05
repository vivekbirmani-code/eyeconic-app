import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  StatusBar,
  Modal,
  Image,
  Switch
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ChevronDown,
  ChevronLeft,
  Check,
  Clock,
  BookOpen,
  Users,
  Search,
  X,
  Eye
} from 'lucide-react-native';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import DateTimePicker from '@react-native-community/datetimepicker';
import { formatToIST } from '@/utils/date';

interface Subject {
  _id: string;
  name: string;
}

interface Student {
  _id: string;
  name: string;
  email: string;
  subjects?: Subject[];
}

interface Question {
  _id: string;
  qid?: string;
  question: string;
  questionImage?: string;
  subject: { _id: string; name: string };
  topicName?: string;
  options: string[];
  optionImages?: string[];
  correctAnswer?: number;
  explanation?: string;
  explanationImage?: string;
  marks?: number;
  tags?: string[];
}

type TestType = 'daily' | 'weekly' | 'grand';

export default function CreateQuiz() {
  const { user } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const params = useLocalSearchParams();
  const { cloneId, editId } = params;

  // Step 1: Test Type & Subjects (now supports multiple)
  const [testType, setTestType] = useState<TestType>('daily');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [showSubjectDropdown, setShowSubjectDropdown] = useState(false);

  // Step 2: Quiz Settings
  const [title, setTitle] = useState('');
  const [showDurationDropdown, setShowDurationDropdown] = useState(false);
  const [numberOfQuestions, setNumberOfQuestions] = useState('10');
  const [duration, setDuration] = useState('30');
  const [positiveMarks, setPositiveMarks] = useState('4');
  const [negativeMarks, setNegativeMarks] = useState('1');
  const [availableQuestions, setAvailableQuestions] = useState(0);
  const [shareSolution, setShareSolution] = useState(true);  // NEW: Share solutions with students

  // Time Window
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [tempDate, setTempDate] = useState<Date>(new Date());

  // Step 3: Question Selection (NEW)
  const [availableQuestionsList, setAvailableQuestionsList] = useState<Question[]>([]);
  const [filteredQuestions, setFilteredQuestions] = useState<Question[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  const [questionSearch, setQuestionSearch] = useState('');
  const [questionSubjectFilter, setQuestionSubjectFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);

  // Step 4: Student Selection
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');

  // Instructions
  const defaultInstructions = [
    'Read each question carefully before answering.',
    'You cannot go back to previous questions once answered.',
    'Do not switch tabs during the test.',
    'Your answers are auto-saved.',
    'Submit before the timer expires.'
  ];
  const [instructions, setInstructions] = useState(defaultInstructions.join('\n'));

  useEffect(() => {
    fetchSubjects();
    fetchStudents();

    if (cloneId) {
      loadQuiz(cloneId as string, true);
    } else if (editId) {
      loadQuiz(editId as string, false);
    }
  }, [cloneId, editId]);

  const loadQuiz = async (id: string, isClone: boolean) => {
    try {
      setLoading(true);
      const response = await api.get(`/quizzes/${id}`);
      const quiz = response.data;

      setTitle(isClone ? `Copy of ${quiz.title}` : quiz.title);
      setTestType(quiz.testType);
      setDuration(quiz.duration.toString());
      if (quiz.positiveMarks !== undefined) setPositiveMarks(quiz.positiveMarks.toString());
      if (quiz.negativeMarks !== undefined) setNegativeMarks(quiz.negativeMarks.toString());
      setInstructions(quiz.instructions ? quiz.instructions.join('\n') : defaultInstructions.join('\n'));

      // Load shareSolution setting (defaults to true if not present)
      if (quiz.shareSolution !== undefined) {
        setShareSolution(quiz.shareSolution);
      }

      // Load time window
      if (quiz.scheduledDate) setScheduledDate(new Date(quiz.scheduledDate));
      if (quiz.expiryDate) setExpiryDate(new Date(quiz.expiryDate));

      if (quiz.subject) {
        setSelectedSubjects([quiz.subject._id]);
      }

      if (quiz.questions && quiz.questions.length > 0) {
        const qIds = quiz.questions.map((q: any) => q._id || q);
        setSelectedQuestions(qIds);
      }

      if (!isClone && quiz.assignedStudents) {
        setSelectedStudents(quiz.assignedStudents.map((s: any) => s._id || s));
      }

    } catch (error) {
      console.error('Error loading quiz:', error);
      Alert.alert('Error', 'Failed to load quiz details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedSubjects.length > 0) {
      fetchQuestionCount();
      generateTitle();
    }
  }, [selectedSubjects, testType]);

  // Fetch questions when entering step 3
  useEffect(() => {
    if (step === 3 && selectedSubjects.length > 0 && availableQuestionsList.length === 0) {
      fetchQuestions();
    }
  }, [step, selectedSubjects]);

  // Filter questions by search and subject filter
  useEffect(() => {
    let filtered = availableQuestionsList;

    const query = questionSearch.toLowerCase();
    if (query) {
      filtered = filtered.filter(q =>
        q.question.toLowerCase().includes(query) ||
        q.qid?.toLowerCase().includes(query) ||
        q.topicName?.toLowerCase().includes(query)
      );
    }

    if (questionSubjectFilter) {
      filtered = filtered.filter(q => q.subject._id === questionSubjectFilter);
    }

    if (questionSubjectFilter) {
      filtered = filtered.filter(q => q.subject._id === questionSubjectFilter);
    }

    // Client-side topic filtering
    if (topicFilter) {
      filtered = filtered.filter(q => q.topicName?.toLowerCase().includes(topicFilter.toLowerCase()));
    }

    // Client-side tag filtering
    if (tagFilter) {
      const tf = tagFilter.toLowerCase();
      filtered = filtered.filter(q => q.tags?.some(t => t.toLowerCase().includes(tf)));
    }

    setFilteredQuestions(filtered);
  }, [questionSearch, availableQuestionsList, questionSubjectFilter, topicFilter, tagFilter]);

  useEffect(() => {
    // Filter students by search query and subject
    let filtered = students;

    const query = studentSearch.toLowerCase();
    if (query) {
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(query) ||
        s.email.toLowerCase().includes(query)
      );
    }

    // Filter by subject if selected
    if (subjectFilter) {
      filtered = filtered.filter(s =>
        s.subjects?.some(sub => sub._id === subjectFilter)
      );
    }

    setFilteredStudents(filtered);
  }, [studentSearch, students, subjectFilter]);

  const fetchSubjects = async () => {
    try {
      const response = await api.get('/subjects/list');
      setSubjects(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error fetching subjects:', error);
      setSubjects([]);
    }
  };

  const fetchStudents = async () => {
    try {
      const response = await api.get('/users?role=student');
      const data = Array.isArray(response.data) ? response.data : [];
      setStudents(data);
      setFilteredStudents(data);
    } catch (error) {
      console.error('Error fetching students:', error);
      setStudents([]);
      setFilteredStudents([]);
    }
  };

  const fetchQuestionCount = async () => {
    try {
      const response = await api.get('/question-bank/stats/summary');
      const bySubject = Array.isArray(response.data?.bySubject) ? response.data.bySubject : [];

      // Sum up questions from all selected subjects
      let totalAvailable = 0;
      selectedSubjects.forEach(subId => {
        const stat = bySubject.find((s: any) => s._id === subId);
        totalAvailable += stat?.count || 0;
      });

      setAvailableQuestions(totalAvailable);
    } catch (error) {
      console.error('Error fetching question count:', error);
      setAvailableQuestions(0);
    }
  };

  const fetchQuestions = async () => {
    if (selectedSubjects.length === 0) return;

    setLoadingQuestions(true);
    try {
      const params = new URLSearchParams();
      selectedSubjects.forEach(id => params.append('subjects', id));

      const response = await api.get(`/question-bank/by-subjects?${params}`);
      const questions = Array.isArray(response.data) ? response.data : [];
      setAvailableQuestionsList(questions);
      setFilteredQuestions(questions);
    } catch (error) {
      console.error('Error fetching questions:', error);
      setAvailableQuestionsList([]);
      setFilteredQuestions([]);
    } finally {
      setLoadingQuestions(false);
    }
  };


  const toggleSubject = (subjectId: string) => {
    if (selectedSubjects.includes(subjectId)) {
      setSelectedSubjects(selectedSubjects.filter(id => id !== subjectId));
    } else {
      setSelectedSubjects([...selectedSubjects, subjectId]);
    }
  };

  const generateTitle = () => {
    const subjectsArray = Array.isArray(subjects) ? subjects : [];
    const selectedNames = selectedSubjects
      .map(id => subjectsArray.find(s => s._id === id)?.name)
      .filter(Boolean)
      .join(', ');
    const typeLabel = testType === 'daily' ? 'Daily' : testType === 'weekly' ? 'Weekly' : 'Grand';
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    setTitle(`${selectedNames || ''} ${typeLabel} Test - ${date}`);
  };

  const handleSelectAll = () => {
    if (selectedStudents.length === filteredStudents.length) {
      setSelectedStudents([]);
    } else {
      setSelectedStudents(filteredStudents.map(s => s._id));
    }
  };

  const toggleStudent = (studentId: string) => {
    if (selectedStudents.includes(studentId)) {
      setSelectedStudents(selectedStudents.filter(id => id !== studentId));
    } else {
      setSelectedStudents([...selectedStudents, studentId]);
    }
  };

  const toggleQuestion = (questionId: string) => {
    if (selectedQuestions.includes(questionId)) {
      setSelectedQuestions(selectedQuestions.filter(id => id !== questionId));
    } else {
      setSelectedQuestions([...selectedQuestions, questionId]);
    }
  };

  const handleSelectAllQuestions = () => {
    if (selectedQuestions.length === filteredQuestions.length) {
      setSelectedQuestions([]);
    } else {
      setSelectedQuestions(filteredQuestions.map(q => q._id));
    }
  };

  const handleCreateQuiz = async () => {
    if (selectedSubjects.length === 0) {
      Alert.alert('Error', 'Please select at least one subject');
      return;
    }
    if (!title.trim()) {
      Alert.alert('Error', 'Please enter a title');
      return;
    }
    if (selectedQuestions.length === 0) {
      Alert.alert('Error', 'Please select at least one question');
      return;
    }
    if (selectedStudents.length === 0) {
      Alert.alert('Error', 'Please select at least one student');
      return;
    }
    if (scheduledDate && expiryDate && expiryDate <= scheduledDate) {
      Alert.alert('Error', 'End date must be after start date');
      return;
    }

    setCreating(true);
    try {
      if (editId) {
        // Update existing quiz
        await api.put(`/quizzes/${editId}`, {
          title: title.trim(),
          subjects: selectedSubjects, // Pass array, backend handles it or takes first
          subject: selectedSubjects[0], // Pass single for backward compat
          testType,
          numberOfQuestions: selectedQuestions.length,
          questions: selectedQuestions,
          duration: parseInt(duration),
          positiveMarks: parseFloat(positiveMarks) || 4,
          negativeMarks: parseFloat(negativeMarks) || 0,
          instructions: instructions.split('\n').filter(i => i.trim()),
          assignedStudents: selectedStudents,
          shareSolution,  // NEW: Include shareSolution setting
          scheduledDate: scheduledDate?.toISOString(),
          expiryDate: expiryDate?.toISOString()
        });
        Alert.alert('Success', 'Quiz updated successfully!', [{ text: 'OK', onPress: () => router.back() }]);
      } else {
        // Create new
        const response = await api.post('/quizzes/create-from-bank', {
          title: title.trim(),
          subjects: selectedSubjects,
          testType,
          numberOfQuestions: selectedQuestions.length,
          selectedQuestionIds: selectedQuestions,
          duration: parseInt(duration),
          positiveMarks: parseFloat(positiveMarks) || 4,
          negativeMarks: parseFloat(negativeMarks) || 0,
          instructions: instructions.split('\n').filter(i => i.trim()),
          assignedStudents: selectedStudents,
          shareSolution,  // NEW: Include shareSolution setting
          scheduledDate: scheduledDate?.toISOString(),
          expiryDate: expiryDate?.toISOString()
        });
        Alert.alert(
          'Success',
          `Quiz ${cloneId ? 'cloned' : 'created'} and assigned to ${selectedStudents.length} students!`,
          [{ text: 'OK', onPress: () => router.back() }]
        );
      }


    } catch (error: any) {
      console.error('Create quiz error:', error);
      Alert.alert('Error', error.response?.data?.message || 'Failed to create quiz');
    } finally {
      setCreating(false);
    }
  };

  const getSelectedSubjectNames = () => {
    const subjectsArray = Array.isArray(subjects) ? subjects : [];
    const names = selectedSubjects
      .map(id => subjectsArray.find(s => s._id === id)?.name)
      .filter(Boolean);
    if (names.length === 0) return 'Select subjects';
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
  };

  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Select Test Type</Text>

      <View style={styles.testTypeContainer}>
        {(['daily', 'weekly', 'grand'] as TestType[]).map(type => (
          <TouchableOpacity
            key={type}
            style={[
              styles.testTypeCard,
              testType === type && styles.testTypeCardActive
            ]}
            onPress={() => setTestType(type)}
          >
            <View style={[
              styles.testTypeIcon,
              testType === type && styles.testTypeIconActive
            ]}>
              {type === 'daily' && <Clock color={testType === type ? '#FFF' : '#6B7280'} size={24} />}
              {type === 'weekly' && <BookOpen color={testType === type ? '#FFF' : '#6B7280'} size={24} />}
              {type === 'grand' && <Users color={testType === type ? '#FFF' : '#6B7280'} size={24} />}
            </View>
            <Text style={[
              styles.testTypeName,
              testType === type && styles.testTypeNameActive
            ]}>
              {type.charAt(0).toUpperCase() + type.slice(1)} Test
            </Text>
            <Text style={styles.testTypeDesc}>
              {type === 'daily' && ''}
              {type === 'weekly' && ''}
              {type === 'grand' && ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.inputLabel}>Select Subject(s)</Text>
      <TouchableOpacity
        style={styles.dropdown}
        onPress={() => setShowSubjectDropdown(!showSubjectDropdown)}
      >
        <Text style={selectedSubjects.length > 0 ? styles.dropdownText : styles.dropdownPlaceholder}>
          {getSelectedSubjectNames()}
        </Text>
        <ChevronDown color="#6B7280" size={20} />
      </TouchableOpacity>

      {showSubjectDropdown && (
        <View style={styles.dropdownList}>
          <ScrollView style={{ maxHeight: 250 }} nestedScrollEnabled={true}>
            <TouchableOpacity
              style={[
                styles.dropdownItem,
                Array.isArray(subjects) && subjects.length > 0 && selectedSubjects.length === subjects.length && styles.dropdownItemSelected
              ]}
              onPress={() => {
                const subjectsArray = Array.isArray(subjects) ? subjects : [];
                if (selectedSubjects.length === subjectsArray.length && subjectsArray.length > 0) {
                  setSelectedSubjects([]);
                } else {
                  setSelectedSubjects(subjectsArray.map(s => s._id));
                }
              }}
            >
              <View style={[
                styles.checkbox,
                Array.isArray(subjects) && subjects.length > 0 && selectedSubjects.length === subjects.length && styles.checkboxSelected
              ]}>
                {Array.isArray(subjects) && subjects.length > 0 && selectedSubjects.length === subjects.length && <Check color="#FFF" size={14} />}
              </View>
              <Text style={styles.dropdownItemText}>Select All</Text>
            </TouchableOpacity>
            {(Array.isArray(subjects) ? subjects : []).map(subject => (
              <TouchableOpacity
                key={subject._id}
                style={[
                  styles.dropdownItem,
                  selectedSubjects.includes(subject._id) && styles.dropdownItemSelected
                ]}
                onPress={() => toggleSubject(subject._id)}
              >
                <View style={[
                  styles.checkbox,
                  selectedSubjects.includes(subject._id) && styles.checkboxSelected
                ]}>
                  {selectedSubjects.includes(subject._id) && <Check color="#FFF" size={14} />}
                </View>
                <Text style={styles.dropdownItemText}>{subject.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {selectedSubjects.length > 0 && (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            📚 {availableQuestions} questions available ({selectedSubjects.length} subjects)
          </Text>
        </View>
      )}
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Quiz Settings</Text>

      <Text style={styles.inputLabel}>Quiz Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Enter quiz title"
      />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.inputLabel}>Positive Marks</Text>
          <TextInput
            style={styles.input}
            value={positiveMarks}
            onChangeText={setPositiveMarks}
            keyboardType="numeric"
            placeholder="4"
          />
        </View>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.inputLabel}>Negative Marks</Text>
          <TextInput
            style={styles.input}
            value={negativeMarks}
            onChangeText={setNegativeMarks}
            keyboardType="numeric"
            placeholder="1"
          />
        </View>
      </View>

      <Text style={styles.inputLabel}>Duration (minutes)</Text>
      <View style={{ position: 'relative', zIndex: 10 }}>
        <TextInput
          style={styles.input}
          value={duration}
          onChangeText={setDuration}
          keyboardType="numeric"
          placeholder="30"
        />
        <TouchableOpacity 
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 50, justifyContent: 'center', alignItems: 'center' }}
          onPress={() => setShowDurationDropdown(!showDurationDropdown)}
        >
          <ChevronDown color="#6B7280" size={20} />
        </TouchableOpacity>
      </View>
      {showDurationDropdown && (
        <View style={styles.dropdownList}>
          {[
            { label: '50 minutes', value: '50' },
            { label: '1.5 hrs', value: '90' },
            { label: '3 hrs', value: '180' },
            { label: '3.5 hrs', value: '210' },
          ].map(option => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.dropdownItem,
                duration === option.value && styles.dropdownItemSelected
              ]}
              onPress={() => {
                setDuration(option.value);
                setShowDurationDropdown(false);
              }}
            >
              <Text style={styles.dropdownItemText}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={styles.inputLabel}>Instructions</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={instructions}
        onChangeText={setInstructions}
        multiline
        placeholder="Enter instructions (one per line)"
      />

      {/* Share Quiz Solution Toggle */}
      <View style={styles.toggleContainer}>
        <View style={styles.toggleLabelContainer}>
          <Text style={styles.toggleLabel}>Share Quiz Solution</Text>
          <Text style={styles.toggleHelperText}>
            Allow students to see correct answers and explanations after submission
          </Text>
        </View>
        <Switch
          value={shareSolution}
          onValueChange={setShareSolution}
          trackColor={{ false: '#D1D5DB', true: '#93C5FD' }}
          thumbColor={shareSolution ? '#2563EB' : '#9CA3AF'}
        />
      </View>

      {/* Time Window */}
      <Text style={styles.inputLabel}>Start Date & Time</Text>
      <TouchableOpacity
        style={styles.datePickerButton}
        onPress={() => {
          setTempDate(scheduledDate || new Date());
          setPickerMode('date');
          setShowStartPicker(true);
        }}
      >
        <Clock color="#6B7280" size={18} />
        <Text style={[styles.datePickerText, !scheduledDate && { color: '#9CA3AF' }]}>
          {scheduledDate ? scheduledDate.toLocaleString() : 'Select start date & time (Optional)'}
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

      <Text style={styles.inputLabel}>End Date & Time</Text>
      <TouchableOpacity
        style={styles.datePickerButton}
        onPress={() => {
          setTempDate(expiryDate || new Date());
          setPickerMode('date');
          setShowEndPicker(true);
        }}
      >
        <Clock color="#6B7280" size={18} />
        <Text style={[styles.datePickerText, !expiryDate && { color: '#9CA3AF' }]}>
          {expiryDate ? expiryDate.toLocaleString() : 'Select end date & time (Optional)'}
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

      {/* IST Preview Helper */}
      {(scheduledDate || expiryDate) && (
        <View style={{ marginTop: 8, padding: 8, backgroundColor: '#F3F4F6', borderRadius: 8 }}>
          <Text style={{ fontSize: 12, color: '#4B5563', fontWeight: '600', marginBottom: 4 }}>
            Students will see (IST):
          </Text>
          {scheduledDate && (
            <Text style={{ fontSize: 12, color: '#6B7280' }}>
              Starts: {formatToIST(scheduledDate)}
            </Text>
          )}
          {expiryDate && (
            <Text style={{ fontSize: 12, color: '#6B7280' }}>
              Ends: {formatToIST(expiryDate)}
            </Text>
          )}
        </View>
      )}

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          📚 {availableQuestions} questions available from {selectedSubjects.length} subject(s)
        </Text>
      </View>
    </View>
  );

  // Step 3 - Question Selection
  const renderStep3 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Select Questions</Text>

      <View style={styles.selectionHeader}>
        <Text style={styles.selectionCount}>
          {selectedQuestions.length} questions selected
        </Text>
        <TouchableOpacity onPress={handleSelectAllQuestions}>
          <Text style={styles.selectAllText}>
            {selectedQuestions.length === filteredQuestions.length ? 'Deselect All' : 'Select All'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchInput}>
        <Search color="#6B7280" size={20} />
        <TextInput
          style={styles.searchTextInput}
          placeholder="Search questions..."
          value={questionSearch}
          onChangeText={setQuestionSearch}
        />
        {questionSearch.length > 0 && (
          <TouchableOpacity onPress={() => setQuestionSearch('')}>
            <X color="#6B7280" size={18} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filterRow}>
        <TextInput
          style={[styles.searchTextInput, { flex: 1, marginRight: 8 }]}
          placeholder="Filter by Topic..."
          value={topicFilter}
          onChangeText={setTopicFilter}
        />
        <TextInput
          style={[styles.searchTextInput, { flex: 1 }]}
          placeholder="Filter by Tag..."
          value={tagFilter}
          onChangeText={setTagFilter}
        />
      </View>

      {/* Subject filter for questions - only show selected subjects */}
      <View style={styles.filterRow}>
        <Text style={styles.filterLabel}>Filter by subject:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <TouchableOpacity
            style={[styles.filterChip, !questionSubjectFilter && styles.filterChipActive]}
            onPress={() => setQuestionSubjectFilter('')}
          >
            <Text style={[styles.filterChipText, !questionSubjectFilter && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          {subjects.filter(sub => selectedSubjects.includes(sub._id)).map(sub => (
            <TouchableOpacity
              key={sub._id}
              style={[styles.filterChip, questionSubjectFilter === sub._id && styles.filterChipActive]}
              onPress={() => setQuestionSubjectFilter(sub._id)}
            >
              <Text style={[styles.filterChipText, questionSubjectFilter === sub._id && styles.filterChipTextActive]}>
                {sub.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Question list */}
      <View style={styles.studentList}>
        {loadingQuestions ? (
          <ActivityIndicator color="#2563EB" style={{ marginTop: 20 }} />
        ) : filteredQuestions.length === 0 ? (
          <Text style={styles.emptyText}>No questions found</Text>
        ) : (
          filteredQuestions.map(item => (
            <TouchableOpacity
              key={item._id}
              style={[
                styles.questionItem,
                selectedQuestions.includes(item._id) && styles.questionItemSelected
              ]}
              onPress={() => toggleQuestion(item._id)}
            >
              <View style={[styles.checkbox, selectedQuestions.includes(item._id) && styles.checkboxSelected]}>
                {selectedQuestions.includes(item._id) && <Check color="#FFF" size={14} />}
              </View>
              <View style={styles.questionInfo}>
                <Text style={styles.questionText} numberOfLines={2}>{item.question}</Text>
                <View style={styles.questionMeta}>
                  <Text style={styles.questionSubject}>{item.subject?.name}</Text>
                  {item.topicName && <Text style={styles.questionTopic}> • {item.topicName}</Text>}
                </View>
              </View>
              <TouchableOpacity
                style={styles.viewButton}
                onPress={() => setSelectedQuestion(item)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Eye color="#2563EB" size={20} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}
      </View>
    </View>
  );

  // Step 4 - Student Selection
  const renderStep4 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Assign Students</Text>

      <View style={styles.selectionHeader}>
        <Text style={styles.selectionCount}>
          {selectedStudents.length} of {filteredStudents.length} selected
        </Text>
        <TouchableOpacity onPress={handleSelectAll}>
          <Text style={styles.selectAllText}>
            {selectedStudents.length === filteredStudents.length ? 'Deselect All' : 'Select All'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchInput}>
        <Search color="#6B7280" size={20} />
        <TextInput
          style={styles.searchTextInput}
          placeholder="Search students..."
          value={studentSearch}
          onChangeText={setStudentSearch}
        />
      </View>

      {/* Subject filter for students */}
      <View style={styles.filterRow}>
        <Text style={styles.filterLabel}>Filter by subject:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <TouchableOpacity
            style={[styles.filterChip, !subjectFilter && styles.filterChipActive]}
            onPress={() => setSubjectFilter('')}
          >
            <Text style={[styles.filterChipText, !subjectFilter && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          {subjects.map(sub => (
            <TouchableOpacity
              key={sub._id}
              style={[styles.filterChip, subjectFilter === sub._id && styles.filterChipActive]}
              onPress={() => setSubjectFilter(sub._id)}
            >
              <Text style={[styles.filterChipText, subjectFilter === sub._id && styles.filterChipTextActive]}>
                {sub.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Student list using map instead of FlatList */}
      <View style={styles.studentList}>
        {filteredStudents.length === 0 ? (
          <Text style={styles.emptyText}>No students found</Text>
        ) : (
          filteredStudents.map(item => (
            <TouchableOpacity
              key={item._id}
              style={[
                styles.studentItem,
                selectedStudents.includes(item._id) && styles.studentItemSelected
              ]}
              onPress={() => toggleStudent(item._id)}
            >
              <View style={[
                styles.checkbox,
                selectedStudents.includes(item._id) && styles.checkboxSelected
              ]}>
                {selectedStudents.includes(item._id) && <Check color="#FFF" size={14} />}
              </View>
              <View style={styles.studentInfo}>
                <Text style={styles.studentName}>{item.name}</Text>
                <Text style={styles.studentEmail}>{item.email}</Text>
              </View>
            </TouchableOpacity>
          ))
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
        <TouchableOpacity onPress={() => router.back()}>
          <ChevronLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Quiz</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Progress Steps */}
      <View style={styles.progressContainer}>
        {[1, 2, 3, 4].map(s => (
          <View key={s} style={styles.progressStep}>
            <View style={[
              styles.progressCircle,
              step >= s && styles.progressCircleActive
            ]}>
              <Text style={[
                styles.progressNumber,
                step >= s && styles.progressNumberActive
              ]}>
                {s}
              </Text>
            </View>
            <Text style={styles.progressLabel}>
              {s === 1 ? 'Type' : s === 2 ? 'Settings' : s === 3 ? 'Questions' : 'Students'}
            </Text>
          </View>
        ))}
      </View>

      {/* Step Content */}
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled={true}
      >
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </ScrollView>

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        {step > 1 && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setStep(step - 1)}
          >
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        )}

        {step < 4 ? (
          <TouchableOpacity
            style={[styles.nextButton,
            (step === 1 && selectedSubjects.length === 0) && styles.buttonDisabled,
            (step === 3 && selectedQuestions.length === 0) && styles.buttonDisabled
            ]}
            onPress={() => {
              if (step === 1 && selectedSubjects.length === 0) return;
              if (step === 3 && selectedQuestions.length === 0) return;
              setStep(step + 1);
            }}
            disabled={(step === 1 && selectedSubjects.length === 0) || (step === 3 && selectedQuestions.length === 0)}
          >
            <Text style={styles.nextButtonText}>Next</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.createButton, creating && styles.buttonDisabled]}
            onPress={handleCreateQuiz}
            disabled={creating}
          >
            {creating ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.createButtonText}>Create & Assign Quiz</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Question Detail Modal */}
      <Modal visible={!!selectedQuestion} animationType="slide" onRequestClose={() => setSelectedQuestion(null)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Question Preview</Text>
            <TouchableOpacity onPress={() => setSelectedQuestion(null)}>
              <X color="#FFF" size={24} />
            </TouchableOpacity>
          </View>

          {selectedQuestion && (
            <ScrollView
              style={styles.modalContent}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
              contentContainerStyle={{ paddingBottom: 40 }}
              overScrollMode="always"
            >
              {/* Question */}
              <View style={styles.questionSection}>
                <Text style={styles.sectionLabel}>Question</Text>
                <Text style={styles.fullQuestionText}>{selectedQuestion.question}</Text>
                {selectedQuestion.questionImage && (
                  <Image
                    source={{ uri: selectedQuestion.questionImage }}
                    style={styles.questionImage}
                    resizeMode="contain"
                  />
                )}
              </View>

              {/* Options */}
              <View style={styles.optionsSection}>
                <Text style={styles.sectionLabel}>Options</Text>
                {selectedQuestion.options.map((option, index) => (
                  <View
                    key={index}
                    style={[
                      styles.optionBox,
                      selectedQuestion.correctAnswer === index && styles.correctOption
                    ]}
                  >
                    <Text style={[
                      styles.optionLabel,
                      selectedQuestion.correctAnswer === index && styles.correctOptionText
                    ]}>
                      {String.fromCharCode(65 + index)}.
                    </Text>
                    <View style={styles.optionContent}>
                      <Text style={[
                        styles.optionText,
                        selectedQuestion.correctAnswer === index && styles.correctOptionText
                      ]}>
                        {option}
                      </Text>
                      {selectedQuestion.optionImages?.[index] && (
                        <Image
                          source={{ uri: selectedQuestion.optionImages[index] }}
                          style={styles.optionImage}
                          resizeMode="contain"
                        />
                      )}
                    </View>
                    {selectedQuestion.correctAnswer === index && (
                      <Check color="#059669" size={20} />
                    )}
                  </View>
                ))}
              </View>

              {/* Explanation */}
              {(selectedQuestion.explanation || selectedQuestion.explanationImage) && (
                <View style={styles.explanationSection}>
                  <Text style={styles.sectionLabel}>Explanation</Text>
                  {selectedQuestion.explanation && (
                    <Text style={styles.explanationText}>{selectedQuestion.explanation}</Text>
                  )}
                  {selectedQuestion.explanationImage && (
                    <Image
                      source={{ uri: selectedQuestion.explanationImage }}
                      style={styles.explanationImage}
                      resizeMode="contain"
                    />
                  )}
                </View>
              )}

              {/* Meta Info */}
              <View style={styles.metaSection}>
                <Text style={styles.metaText}>Subject: {selectedQuestion.subject?.name}</Text>
                {selectedQuestion.topicName && <Text style={styles.metaText}>Topic: {selectedQuestion.topicName}</Text>}
                {selectedQuestion.marks && <Text style={styles.metaText}>Marks: {selectedQuestion.marks}</Text>}
              </View>

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
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#FFF',
    gap: 40,
  },
  progressStep: {
    alignItems: 'center',
  },
  progressCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressCircleActive: {
    backgroundColor: '#2563EB',
  },
  progressNumber: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#6B7280',
  },
  progressNumberActive: {
    color: '#FFF',
  },
  progressLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  content: {
    flex: 1,
  },
  stepContent: {
    padding: 20,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 20,
  },
  testTypeContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  testTypeCard: {
    flex: 1,
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  testTypeCardActive: {
    borderColor: '#2563EB',
    backgroundColor: '#EBF5FF',
  },
  testTypeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  testTypeIconActive: {
    backgroundColor: '#2563EB',
  },
  testTypeName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
  },
  testTypeNameActive: {
    color: '#2563EB',
  },
  testTypeDesc: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#FFF',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
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
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 12,
  },
  dropdownItemSelected: {
    backgroundColor: '#EBF5FF',
  },
  dropdownItemText: {
    fontSize: 16,
    color: '#1F2937',
  },
  infoBox: {
    backgroundColor: '#EBF5FF',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
  },
  infoText: {
    fontSize: 14,
    color: '#2563EB',
  },
  row: {
    flexDirection: 'row',
    gap: 16,
  },
  halfInput: {
    flex: 1,
  },
  helperText: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  selectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  selectionCount: {
    fontSize: 14,
    color: '#6B7280',
  },
  selectAllText: {
    fontSize: 14,
    color: '#2563EB',
    fontWeight: '600',
  },
  searchInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 8,
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 12,
  },
  searchTextInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
  },
  filterRow: {
    marginBottom: 12,
  },
  filterLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#2563EB',
  },
  filterChipText: {
    fontSize: 12,
    color: '#6B7280',
  },
  filterChipTextActive: {
    color: '#FFF',
  },
  studentList: {
    minHeight: 200,
  },
  studentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  studentItemSelected: {
    backgroundColor: '#EBF5FF',
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  studentEmail: {
    fontSize: 13,
    color: '#6B7280',
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 50,
  },
  bottomNav: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 12,
  },
  backButton: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2563EB',
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2563EB',
  },
  nextButton: {
    flex: 2,
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#2563EB',
    alignItems: 'center',
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  createButton: {
    flex: 2,
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#10B981',
    alignItems: 'center',
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  questionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  questionItemSelected: {
    backgroundColor: '#EBF5FF',
    borderColor: '#2563EB',
  },
  questionInfo: {
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
    marginTop: 6,
  },
  questionSubject: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '500',
  },
  questionTopic: {
    fontSize: 12,
    color: '#6B7280',
  },
  viewButton: {
    padding: 8,
  },
  // Question Detail Modal Styles
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
  modalContent: {
    flex: 1,
    padding: 16,
  },
  questionSection: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  fullQuestionText: {
    fontSize: 16,
    color: '#1F2937',
    lineHeight: 24,
  },
  questionImage: {
    width: '100%',
    height: 200,
    marginTop: 12,
    borderRadius: 8,
  },
  optionsSection: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  optionBox: {
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
  optionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    width: 24,
  },
  correctOptionText: {
    color: '#059669',
  },
  optionContent: {
    flex: 1,
  },
  optionText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  optionImage: {
    width: '100%',
    height: 120,
    marginTop: 8,
    borderRadius: 6,
  },
  explanationSection: {
    backgroundColor: '#FEF3C7',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  explanationText: {
    fontSize: 14,
    color: '#92400E',
    lineHeight: 20,
  },
  explanationImage: {
    width: '100%',
    height: 150,
    marginTop: 12,
    borderRadius: 8,
  },
  metaSection: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  metaText: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 4,
  },
  // Toggle Styles for shareSolution
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F9FAFB',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  toggleLabelContainer: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  toggleHelperText: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  datePickerText: {
    fontSize: 15,
    color: '#1F2937',
    flex: 1,
  },
});
