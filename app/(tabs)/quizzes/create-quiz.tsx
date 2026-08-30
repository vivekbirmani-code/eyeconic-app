import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  Modal,
  Image,
  Switch,
  FlatList,
} from 'react-native';
import { ScreenContainer, FullScreenContainer } from '@/components/layout';
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
  Eye,
  Minus,
  Sparkles
} from 'lucide-react-native';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import DateTimePicker from '@react-native-community/datetimepicker';
import { formatToIST } from '@/utils/date';
import useDebounce from '@/hooks/useDebounce';
import { QUESTION_TYPES, QUESTION_TYPE_LABELS, DIFFICULTY_LEVELS, DIFFICULTY_LABELS } from '@/types/question';

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

interface Mentor {
  _id: string;
  name: string;
  email: string;
}

interface Group {
  _id: string;
  name: string;
  description?: string;
  members?: Array<{
    _id: string;
    role?: string;
  }>;
  students?: Array<string | { _id: string }>;
}

interface Question {
  _id: string;
  qid?: string;
  question: string;
  questionImage?: string;
  subject: { _id: string; name: string };
  topicName?: string;
  subtopicName?: string;
  system?: string;
  questionType?: string;
  difficulty?: string;
  options?: string[];
  optionImages?: string[];
  assertion?: string;
  reason?: string;
  columnA?: string[];
  columnB?: string[];
  correctAnswer?: any;
  explanation?: string;
  explanationImage?: string;
  marks?: number;
  tags?: string[];
}

interface QuizSection {
  name: string;
  duration: number; // minutes
  selectionType: 'mixed' | 'manual';
  questions: string[]; // IDs
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
  const [assignToAllFreeUsers, setAssignToAllFreeUsers] = useState(false);

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
  const [difficultyFilter, setDifficultyFilter] = useState('');
  const [questionTypeFilter, setQuestionTypeFilter] = useState('');
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Step 4: Student Selection
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupSearch, setGroupSearch] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  // Mentor Selection
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [selectedMentors, setSelectedMentors] = useState<string[]>([]);
  const [assignmentTab, setAssignmentTab] = useState<'students' | 'mentors'>('students');

  // Step 4: Sections (NEW)
  const [quizSections, setQuizSections] = useState<QuizSection[]>([]);

  // Instructions
  const defaultInstructions = [
    'Read each question carefully before answering.',
    'You cannot go back to previous questions once answered.',
    'Do not switch tabs during the test.',
    'Your answers are auto-saved.',
    'Submit before the timer expires.'
  ];
  const [instructions, setInstructions] = useState(defaultInstructions.join('\n'));

  // Debounced search values for flicker-free filtering
  const debouncedStudentSearch = useDebounce(studentSearch, 250);
  const debouncedGroupSearch = useDebounce(groupSearch, 250);

  const studentIdSet = useMemo(() => {
    return new Set(students.map(student => student._id));
  }, [students]);

  const groupStudentMap = useMemo(() => {
    const map: Record<string, string[]> = {};

    groups.forEach(group => {
      const studentIds = new Set<string>();

      if (Array.isArray(group.members)) {
        group.members.forEach(member => {
          if (!member?._id) return;
          if (member.role === 'student' || studentIdSet.has(member._id)) {
            studentIds.add(member._id);
          }
        });
      }

      if (Array.isArray(group.students)) {
        group.students.forEach(student => {
          const studentId = typeof student === 'string' ? student : student?._id;
          if (studentId && studentIdSet.has(studentId)) {
            studentIds.add(studentId);
          }
        });
      }

      map[group._id] = Array.from(studentIds);
    });

    return map;
  }, [groups, studentIdSet]);

  const filteredGroups = useMemo(() => {
    const query = debouncedGroupSearch.trim().toLowerCase();

    return groups.filter(group => {
      const hasStudents = (groupStudentMap[group._id]?.length || 0) > 0;
      if (!hasStudents) return false;

      if (!query) return true;

      return (
        group.name.toLowerCase().includes(query) ||
        (group.description || '').toLowerCase().includes(query)
      );
    });
  }, [debouncedGroupSearch, groups, groupStudentMap]);

  const selectedGroupStudentIdSet = useMemo(() => {
    const ids = new Set<string>();

    selectedGroupIds.forEach(groupId => {
      (groupStudentMap[groupId] || []).forEach(studentId => ids.add(studentId));
    });

    return ids;
  }, [selectedGroupIds, groupStudentMap]);

  useEffect(() => {
    fetchSubjects();
    fetchStudents();
    fetchGroups();
    fetchMentors();

    if (cloneId) {
      loadQuiz(cloneId as string, true);
    } else if (editId) {
      loadQuiz(editId as string, false);
    }
  }, [cloneId, editId]);

  // Debounced search/filters for Step 3
  useEffect(() => {
    if (step === 3) {
      const timer = setTimeout(() => {
        fetchQuestions(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [questionSearch, topicFilter, tagFilter, difficultyFilter, questionTypeFilter, questionSubjectFilter, step]);

  const fetchMentors = async () => {
    try {
      setLoadingQuestions(true);
      const response = await api.get('/users/role/mentor');
      console.log('Fetched mentors:', response.data?.length);
      setMentors(response.data);
    } catch (error) {
      console.error('Error fetching mentors:', error);
    } finally {
      setLoadingQuestions(false);
    }
  };

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
      if (quiz.assignToAllFreeUsers !== undefined) {
        setAssignToAllFreeUsers(quiz.assignToAllFreeUsers);
      }

      // Load time window
      if (quiz.scheduledDate) setScheduledDate(new Date(quiz.scheduledDate));
      if (quiz.expiryDate) setExpiryDate(new Date(quiz.expiryDate));

      // Prefer subject IDs from quiz questions so mixed quizzes stay mixed in edit mode.
      const questionSubjectIds = Array.from(
        new Set(
          (quiz.questions || [])
            .map((q: any) => (typeof q.subject === 'object' ? q.subject?._id : q.subject))
            .filter(Boolean)
        )
      ) as string[];
      if (questionSubjectIds.length > 0) {
        setSelectedSubjects(questionSubjectIds);
      } else if (quiz.subject?._id) {
        setSelectedSubjects([quiz.subject._id]);
      }

      if (quiz.questions && quiz.questions.length > 0) {
        const qIds = quiz.questions.map((q: any) => q._id || q);
        setSelectedQuestions(qIds);
      }

      if (!isClone && quiz.assignedStudents) {
        setSelectedStudents(quiz.assignedStudents.map((s: any) => s._id || s));
      }

      if (!isClone && quiz.assignedMentors) {
        setSelectedMentors(quiz.assignedMentors.map((m: any) => m._id || m));
      }

      // Load sections
      if (quiz.sections && quiz.sections.length > 0) {
        setQuizSections(quiz.sections.map((s: any) => ({
          name: s.name,
          duration: s.duration,
          selectionType: s.selectionType || 'manual',
          questions: s.questions?.map((q: any) => q._id || q) || []
        })));
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

    // Client-side topic filtering
    if (topicFilter) {
      filtered = filtered.filter(q => q.topicName?.toLowerCase().includes(topicFilter.toLowerCase()));
    }

    // Client-side tag filtering
    if (tagFilter) {
      const tf = tagFilter.toLowerCase();
      filtered = filtered.filter(q => q.tags?.some(t => t.toLowerCase().includes(tf)));
    }

    if (difficultyFilter) {
      filtered = filtered.filter(q => q.difficulty === difficultyFilter);
    }

    if (questionTypeFilter) {
      filtered = filtered.filter(q => q.questionType === questionTypeFilter);
    }

    setFilteredQuestions(filtered);
  }, [questionSearch, availableQuestionsList, questionSubjectFilter, topicFilter, tagFilter, difficultyFilter, questionTypeFilter]);

  useEffect(() => {
    // Filter students by search query and subject
    let filtered = students;

    if (selectedGroupIds.length > 0) {
      filtered = filtered.filter(student => selectedGroupStudentIdSet.has(student._id));
    }

    const query = debouncedStudentSearch.toLowerCase();
    if (query) {
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(query) ||
        s.email.toLowerCase().includes(query)
      );
    }

    setFilteredStudents(filtered);
  }, [debouncedStudentSearch, students, selectedGroupIds, selectedGroupStudentIdSet]);

  useEffect(() => {
    // Remove stale selected group IDs if groups list changes.
    setSelectedGroupIds(prev => prev.filter(groupId => groups.some(group => group._id === groupId)));
  }, [groups]);

  useEffect(() => {
    // If user changed selected subjects in Step 1, ensure Step 3 chip filter stays valid.
    if (questionSubjectFilter && !selectedSubjects.includes(questionSubjectFilter)) {
      setQuestionSubjectFilter('');
    }
  }, [selectedSubjects, questionSubjectFilter]);

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
      const response = await api.get('/users/role/student');
      const data = Array.isArray(response.data) ? response.data : [];
      setStudents(data);
      setFilteredStudents(data);
    } catch (error) {
      console.error('Error fetching students:', error);
      setStudents([]);
      setFilteredStudents([]);
    }
  };

  const fetchGroups = async () => {
    try {
      const response = await api.get('/groups');
      setGroups(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error fetching groups:', error);
      setGroups([]);
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

  const fetchQuestions = async (reset = false) => {
    if (selectedSubjects.length === 0) return;

    const effectiveSubjectIds =
      questionSubjectFilter && selectedSubjects.includes(questionSubjectFilter)
        ? [questionSubjectFilter]
        : selectedSubjects;

    if (effectiveSubjectIds.length === 0) return;

    if (reset) {
      setPage(1);
      setAvailableQuestionsList([]);
      setFilteredQuestions([]);
      setHasMore(true);
      setLoadingQuestions(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const currentPage = reset ? 1 : page;
      const params = new URLSearchParams();
      effectiveSubjectIds.forEach(id => params.append('subjects', id));
      params.append('page', currentPage.toString());
      params.append('limit', '50');
      if (questionSearch) params.append('search', questionSearch);
      if (topicFilter) params.append('topic', topicFilter);
      if (tagFilter) params.append('tag', tagFilter);
      if (difficultyFilter) params.append('difficulty', difficultyFilter);
      if (questionTypeFilter) params.append('questionType', questionTypeFilter);

      const response = await api.get(`/question-bank/by-subjects?${params}`);
      const { questions, total, pages } = response.data;

      const newQuestions = Array.isArray(questions) ? questions : [];
      
      if (reset) {
        setAvailableQuestionsList(newQuestions);
        setFilteredQuestions(newQuestions);
      } else {
        setAvailableQuestionsList(prev => [...prev, ...newQuestions]);
        setFilteredQuestions(prev => [...prev, ...newQuestions]);
      }

      setTotalQuestions(total);
      setHasMore(currentPage < pages);
      setPage(currentPage + 1);
    } catch (error) {
      console.error('Error fetching questions:', error);
      if (reset) {
        setAvailableQuestionsList([]);
        setFilteredQuestions([]);
      }
    } finally {
      setLoadingQuestions(false);
      setLoadingMore(false);
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
      .filter(Boolean);
    const subjectLabel = selectedNames.length > 1 ? 'Mixed' : (selectedNames[0] || '');
    const typeLabel = testType === 'daily' ? 'Daily' : testType === 'weekly' ? 'Weekly' : 'Grand';
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    setTitle(`${subjectLabel} ${typeLabel} Test - ${date}`.trim());
  };

  const selectedFilteredStudentCount = filteredStudents.filter(student =>
    selectedStudents.includes(student._id)
  ).length;

  const allFilteredStudentsSelected = filteredStudents.length > 0
    && selectedFilteredStudentCount === filteredStudents.length;

  const someFilteredStudentsSelected = selectedFilteredStudentCount > 0
    && !allFilteredStudentsSelected;

  const allFilteredGroupsSelected = filteredGroups.length > 0
    && filteredGroups.every(group => selectedGroupIds.includes(group._id));

  const handleSelectAll = () => {
    const filteredIds = new Set(filteredStudents.map(student => student._id));
    if (allFilteredStudentsSelected) {
      setSelectedStudents(prev => prev.filter(studentId => !filteredIds.has(studentId)));
      return;
    }

    setSelectedStudents(prev => Array.from(new Set([...prev, ...Array.from(filteredIds)])));
  };

  const toggleGroupFilter = (groupId: string) => {
    setSelectedGroupIds(prev =>
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    );
  };

  const handleSelectAllFilteredGroups = () => {
    const filteredGroupIds = filteredGroups.map(group => group._id);
    if (filteredGroupIds.length === 0) return;

    if (allFilteredGroupsSelected) {
      setSelectedGroupIds(prev => prev.filter(id => !filteredGroupIds.includes(id)));
      return;
    }

    setSelectedGroupIds(prev => Array.from(new Set([...prev, ...filteredGroupIds])));
  };

  const handleSelectAllMentors = () => {
    if (selectedMentors.length === mentors.length) {
      setSelectedMentors([]);
    } else {
      setSelectedMentors(mentors.map(m => m._id));
    }
  };

  const toggleStudent = (studentId: string) => {
    setSelectedStudents(prev =>
      prev.includes(studentId) ? prev.filter(id => id !== studentId) : [...prev, studentId]
    );
  };

  const toggleMentor = (mentorId: string) => {
    if (selectedMentors.includes(mentorId)) {
      setSelectedMentors(selectedMentors.filter(id => id !== mentorId));
    } else {
      setSelectedMentors([...selectedMentors, mentorId]);
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
    if (!assignToAllFreeUsers && selectedStudents.length === 0 && selectedMentors.length === 0) {
      Alert.alert('Error', 'Please select at least one student or mentor');
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
          assignedMentors: selectedMentors,
          shareSolution,
          assignToAllFreeUsers,
          scheduledDate: scheduledDate?.toISOString(),
          expiryDate: expiryDate?.toISOString(),
          sections: quizSections
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
          assignedMentors: selectedMentors,
          shareSolution,
          assignToAllFreeUsers,
          scheduledDate: scheduledDate?.toISOString(),
          expiryDate: expiryDate?.toISOString(),
          sections: quizSections
        });
        Alert.alert(
          'Success',
          `Quiz ${cloneId ? 'cloned' : 'created'} and assigned successfully!`,
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

      {/* Difficulty filter */}
      <View style={styles.filterRow}>
        <Text style={styles.filterLabel}>Difficulty:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <TouchableOpacity
            style={[styles.filterChip, !difficultyFilter && styles.filterChipActive]}
            onPress={() => setDifficultyFilter('')}
          >
            <Text style={[styles.filterChipText, !difficultyFilter && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          {DIFFICULTY_LEVELS.map(level => (
            <TouchableOpacity
              key={level}
              style={[styles.filterChip, difficultyFilter === level && styles.filterChipActive]}
              onPress={() => setDifficultyFilter(level)}
            >
              <Text style={[styles.filterChipText, difficultyFilter === level && styles.filterChipTextActive]}>
                {DIFFICULTY_LABELS[level]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Question Type filter */}
      <View style={styles.filterRow}>
        <Text style={styles.filterLabel}>Type:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <TouchableOpacity
            style={[styles.filterChip, !questionTypeFilter && styles.filterChipActive]}
            onPress={() => setQuestionTypeFilter('')}
          >
            <Text style={[styles.filterChipText, !questionTypeFilter && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          {QUESTION_TYPES.map(type => (
            <TouchableOpacity
              key={type}
              style={[styles.filterChip, questionTypeFilter === type && styles.filterChipActive]}
              onPress={() => setQuestionTypeFilter(type)}
            >
              <Text style={[styles.filterChipText, questionTypeFilter === type && styles.filterChipTextActive]}>
                {QUESTION_TYPE_LABELS[type]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
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
      <View style={[styles.studentList, { flex: 1 }]}>
        {loadingQuestions && page === 1 ? (
          <ActivityIndicator color="#2563EB" style={{ marginTop: 20 }} />
        ) : filteredQuestions.length === 0 ? (
          <Text style={styles.emptyText}>No questions found</Text>
        ) : (
          <FlatList
            data={filteredQuestions}
            keyExtractor={(item: Question) => item._id}
            renderItem={({ item }: { item: Question }) => (
              <TouchableOpacity
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
                    {item.difficulty && <Text style={styles.questionTopic}> • {DIFFICULTY_LABELS[item.difficulty as keyof typeof DIFFICULTY_LABELS] || item.difficulty}</Text>}
                    {item.questionType && <Text style={styles.questionTopic}> • {QUESTION_TYPE_LABELS[item.questionType as keyof typeof QUESTION_TYPE_LABELS] || item.questionType}</Text>}
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
            )}
            onEndReached={() => {
              if (hasMore && !loadingMore) {
                fetchQuestions(false);
              }
            }}
            onEndReachedThreshold={0.5}
            ListFooterComponent={() => (
              loadingMore ? (
                <ActivityIndicator color="#2563EB" style={{ marginVertical: 20 }} />
              ) : null
            )}
            contentContainerStyle={{ paddingBottom: 20 }}
          />
        )}
      </View>
    </View>
  );

  // Step 4 - Section Configuration (NEW)
  const renderStep4 = () => {
    const totalTime = parseInt(duration) || 0;
    const allocatedTime = quizSections.reduce((sum, s) => sum + s.duration, 0);

    const initializeSections = (count: number) => {
      const newSections: QuizSection[] = [];
      const equalTime = Math.floor(totalTime / count);
      for (let i = 0; i < count; i++) {
        newSections.push({
          name: `Section ${i + 1}`,
          duration: i === count - 1 ? totalTime - (equalTime * (count - 1)) : equalTime,
          selectionType: 'mixed',
          questions: []
        });
      }
      setQuizSections(newSections);
    };

    const updateSection = (index: number, updates: Partial<QuizSection>) => {
      const updated = [...quizSections];
      updated[index] = { ...updated[index], ...updates };
      setQuizSections(updated);
    };

    return (
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>Configure Sections</Text>

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            ⏱️ Total Duration: {totalTime} mins | Allocated: {allocatedTime} mins
          </Text>
          {allocatedTime !== totalTime && (
             <Text style={{color: '#EF4444', fontSize: 12, marginTop: 4}}>
               ⚠️ Allocated time ({allocatedTime}) does not match total duration ({totalTime})
             </Text>
          )}
        </View>

        <View style={styles.sectionSetupHeader}>
          <Text style={styles.inputLabel}>Number of Sections</Text>
          <View style={{flexDirection: 'row', gap: 8, marginTop: 8}}>
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

        <ScrollView style={{marginTop: 16}}>
          {quizSections.map((section, idx) => (
            <View key={idx} style={styles.sectionConfigCard}>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
                <TextInput
                  style={[styles.input, {flex: 2, marginRight: 8}]}
                  value={section.name}
                  onChangeText={(val) => updateSection(idx, { name: val })}
                  placeholder="Section Name"
                />
                <View style={{flex: 1}}>
                  <TextInput
                    style={styles.input}
                    value={section.duration.toString()}
                    onChangeText={(val) => updateSection(idx, { duration: parseInt(val) || 0 })}
                    keyboardType="numeric"
                    placeholder="Mins"
                  />
                </View>
              </View>

              <View style={{flexDirection: 'row', gap: 8, marginTop: 12}}>
                <TouchableOpacity 
                  style={[styles.typeButton, section.selectionType === 'mixed' && styles.typeButtonActive]}
                  onPress={() => updateSection(idx, { selectionType: 'mixed', questions: [] })}
                >
                  <Text style={[styles.typeButtonText, section.selectionType === 'mixed' && styles.typeButtonTextActive]}>Mixed</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.typeButton, section.selectionType === 'manual' && styles.typeButtonActive]}
                  onPress={() => updateSection(idx, { selectionType: 'manual' })}
                >
                  <Text style={[styles.typeButtonText, section.selectionType === 'manual' && styles.typeButtonTextActive]}>Manual</Text>
                </TouchableOpacity>
              </View>

              {section.selectionType === 'manual' && (
                <View style={{marginTop: 12}}>
                   <Text style={{fontSize: 12, color: '#6B7280', marginBottom: 4}}>
                     Questions: {section.questions.length} assigned
                   </Text>
                   <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{paddingBottom: 8}}>
                      {selectedQuestions.map(qId => {
                         const q = availableQuestionsList.find(aq => aq._id === qId);
                         if (!q) return null;
                         const isAssigned = section.questions.includes(qId);
                         return (
                           <TouchableOpacity 
                            key={qId} 
                            style={[styles.qTinyChip, isAssigned && styles.qTinyChipActive]}
                            onPress={() => {
                               const newQs = isAssigned 
                                ? section.questions.filter(id => id !== qId)
                                : [...section.questions, qId];
                               updateSection(idx, { questions: newQs });
                            }}
                           >
                             <Text style={[styles.qTinyChipText, isAssigned && styles.qTinyChipTextActive]} numberOfLines={1}>
                               {q.question.substring(0, 20)}...
                             </Text>
                           </TouchableOpacity>
                         );
                      })}
                   </ScrollView>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    );
  };

  // Step 5 - Assignments (Students & Mentors)
  const renderStep5 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Assign Quiz</Text>

      {/* Assign to all Free Users Toggle */}
      <View style={styles.toggleContainer}>
        <View style={styles.toggleLabelContainer}>
          <Text style={styles.toggleLabel}>Assign to all Free Users</Text>
          <Text style={styles.toggleHelperText}>
            Automatically share this quiz with all free/unregistered student users
          </Text>
        </View>
        <Switch
          value={assignToAllFreeUsers}
          onValueChange={setAssignToAllFreeUsers}
          trackColor={{ false: '#D1D5DB', true: '#93C5FD' }}
          thumbColor={assignToAllFreeUsers ? '#2563EB' : '#9CA3AF'}
        />
      </View>

      <View style={styles.assignmentTabs}>
        <TouchableOpacity 
          style={[styles.assignmentTab, assignmentTab === 'students' && styles.assignmentTabActive]}
          onPress={() => setAssignmentTab('students')}
        >
          <Text style={[styles.assignmentTabText, assignmentTab === 'students' && styles.assignmentTabTextActive]}>
            Students ({students.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.assignmentTab, assignmentTab === 'mentors' && styles.assignmentTabActive]}
          onPress={() => setAssignmentTab('mentors')}
        >
          <Text style={[styles.assignmentTabText, assignmentTab === 'mentors' && styles.assignmentTabTextActive]}>
            Mentors ({mentors.length})
          </Text>
        </TouchableOpacity>
      </View>

      {assignmentTab === 'students' ? (
        assignToAllFreeUsers ? (
          <View style={styles.freeUserAssignmentBanner}>
            <Sparkles color="#01b4ae" size={28} style={{ marginBottom: 8 }} />
            <Text style={styles.freeUserAssignmentTitle}>Assigning to All Free Users</Text>
            <Text style={styles.freeUserAssignmentText}>
              This quiz is configured to be shared with all unregistered and free student users automatically. Individual student selection is disabled.
            </Text>
          </View>
        ) : (
          <>
          <View style={styles.selectionHeader}>
            <Text style={styles.selectionCount}>
              {selectedGroupIds.length} group filter(s) active
            </Text>
            <TouchableOpacity
              onPress={handleSelectAllFilteredGroups}
              disabled={filteredGroups.length === 0}
            >
              <Text style={[styles.selectAllText, filteredGroups.length === 0 && styles.selectAllTextDisabled]}>
                {allFilteredGroupsSelected ? 'Deselect Filtered Groups' : 'Select Filtered Groups'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchInput}>
            <Users color="#6B7280" size={20} />
            <TextInput
              style={styles.searchTextInput}
              placeholder="Filter groups by name..."
              value={groupSearch}
              onChangeText={setGroupSearch}
            />
            {groupSearch.length > 0 && (
              <TouchableOpacity onPress={() => setGroupSearch('')}>
                <X color="#9CA3AF" size={16} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.groupChipScroll}
            contentContainerStyle={styles.groupChipScrollContent}
          >
            {filteredGroups.length === 0 ? (
              <Text style={styles.groupFilterEmpty}>No matching groups</Text>
            ) : (
              filteredGroups.map(group => (
                <TouchableOpacity
                  key={group._id}
                  style={[
                    styles.groupChip,
                    selectedGroupIds.includes(group._id) && styles.groupChipActive
                  ]}
                  onPress={() => toggleGroupFilter(group._id)}
                >
                  <Text
                    style={[
                      styles.groupChipText,
                      selectedGroupIds.includes(group._id) && styles.groupChipTextActive
                    ]}
                  >
                    {group.name} ({groupStudentMap[group._id]?.length || 0})
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>

          {selectedGroupIds.length > 0 && (
            <TouchableOpacity onPress={() => setSelectedGroupIds([])}>
              <Text style={styles.clearGroupFilterText}>Clear Group Filters</Text>
            </TouchableOpacity>
          )}

          <View style={styles.selectionHeader}>
            <TouchableOpacity
              style={styles.selectAllCheckboxRow}
              onPress={handleSelectAll}
              disabled={filteredStudents.length === 0}
              activeOpacity={0.7}
            >
              <View style={[
                styles.checkbox,
                (allFilteredStudentsSelected || someFilteredStudentsSelected) && styles.checkboxSelected,
              ]}>
                {allFilteredStudentsSelected && <Check color="#FFF" size={14} />}
                {someFilteredStudentsSelected && <Minus color="#FFF" size={14} />}
              </View>
              <Text style={[styles.selectAllText, filteredStudents.length === 0 && styles.selectAllTextDisabled]}>
                {allFilteredStudentsSelected ? 'Deselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.selectionCount}>
              {selectedFilteredStudentCount} of {filteredStudents.length} visible ({selectedStudents.length} total)
            </Text>
          </View>

          <View style={styles.searchInput}>
            <Search color="#6B7280" size={20} />
            <TextInput
              style={styles.searchTextInput}
              placeholder={selectedGroupIds.length > 0 ? 'Search students in selected groups...' : 'Search students...'}
              value={studentSearch}
              onChangeText={setStudentSearch}
            />
            {studentSearch.length > 0 && (
              <TouchableOpacity onPress={() => setStudentSearch('')}>
                <X color="#9CA3AF" size={16} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.studentList}>
            {loadingQuestions ? (
              <ActivityIndicator color="#2563EB" style={{ marginTop: 20 }} />
            ) : filteredStudents.length === 0 ? (
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
        </>
        )
      ) : (
        <>
          <View style={styles.selectionHeader}>
            <Text style={styles.selectionCount}>
              {selectedMentors.length} of {mentors.length} mentors selected
            </Text>
            <TouchableOpacity onPress={handleSelectAllMentors}>
              <Text style={styles.selectAllText}>
                {selectedMentors.length === mentors.length ? 'Deselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.studentList}>
            {loadingQuestions ? (
              <ActivityIndicator color="#2563EB" style={{ marginTop: 20 }} />
            ) : mentors.length === 0 ? (
              <Text style={styles.emptyText}>No mentors found</Text>
            ) : (
              mentors.map(item => (
                <TouchableOpacity
                  key={item._id}
                  style={[
                    styles.studentItem,
                    selectedMentors.includes(item._id) && styles.studentItemSelected
                  ]}
                  onPress={() => toggleMentor(item._id)}
                >
                  <View style={[
                    styles.checkbox,
                    selectedMentors.includes(item._id) && styles.checkboxSelected
                  ]}>
                    {selectedMentors.includes(item._id) && <Check color="#FFF" size={14} />}
                  </View>
                  <View style={styles.studentInfo}>
                    <Text style={styles.studentName}>{item.name}</Text>
                    <Text style={styles.studentEmail}>{item.email}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        </>
      )}
    </View>
  );

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
        <Text style={styles.headerTitle}>Create Quiz</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Progress Steps */}
      <View style={styles.progressContainer}>
        {[1, 2, 3, 4, 5].map(s => (
          <React.Fragment key={s}>
            <View style={styles.progressStep}>
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
                {s === 1 ? 'Type' : s === 2 ? 'Settings' : s === 3 ? 'Questions' : s === 4 ? 'Sections' : 'Assign'}
              </Text>
            </View>
            {s < 5 && (
              <View style={[
                styles.progressLine,
                step > s && styles.progressLineActive
              ]} />
            )}
          </React.Fragment>
        ))}
      </View>

      {/* Step Content */}
      {step === 3 ? (
        <View style={styles.content}>
          {renderStep3()}
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled={true}
        >
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 4 && renderStep4()}
          {step === 5 && renderStep5()}
        </ScrollView>
      )}

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

        {step < 5 ? (
          <TouchableOpacity
            style={[styles.nextButton,
            (step === 1 && selectedSubjects.length === 0) && styles.buttonDisabled,
            (step === 3 && selectedQuestions.length === 0) && styles.buttonDisabled,
            (step === 4 && quizSections.length === 0) && styles.buttonDisabled
            ]}
            onPress={() => {
              if (step === 1 && selectedSubjects.length === 0) return;
              if (step === 3 && selectedQuestions.length === 0) return;
              if (step === 4 && quizSections.length === 0) {
                 Alert.alert('Error', 'Please define at least one section');
                 return;
              }
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
              <Text style={styles.createButtonText}>{editId ? 'Update Quiz' : 'Create & Assign Quiz'}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Question Detail Modal */}
      <Modal visible={!!selectedQuestion} animationType="slide" onRequestClose={() => setSelectedQuestion(null)}>
        <FullScreenContainer style={styles.modalContainer}>
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

              {/* Assertion / Reason */}
              {selectedQuestion.questionType === 'assertion_reason' && (
                <View style={styles.questionSection}>
                  <Text style={styles.sectionLabel}>Assertion</Text>
                  <Text style={styles.fullQuestionText}>{selectedQuestion.assertion}</Text>
                  <Text style={[styles.sectionLabel, { marginTop: 12 }]}>Reason</Text>
                  <Text style={styles.fullQuestionText}>{selectedQuestion.reason}</Text>
                </View>
              )}

              {/* Match the Following */}
              {selectedQuestion.questionType === 'match_the_following' ? (
                <View style={styles.optionsSection}>
                  <Text style={styles.sectionLabel}>Column A</Text>
                  {(selectedQuestion.columnA || []).map((a, i) => (
                    <Text key={i} style={styles.optionText}>{i + 1}. {a}</Text>
                  ))}
                  <Text style={[styles.sectionLabel, { marginTop: 12 }]}>Column B</Text>
                  {(selectedQuestion.columnB || []).map((b, i) => (
                    <Text key={i} style={styles.optionText}>{String.fromCharCode(65 + i)}. {b}</Text>
                  ))}
                </View>
              ) : selectedQuestion.questionType === 'numerical' ? (
                <View style={styles.optionsSection}>
                  <Text style={styles.sectionLabel}>Correct Answer</Text>
                  <Text style={styles.fullQuestionText}>{String(selectedQuestion.correctAnswer)}</Text>
                </View>
              ) : (
              <View style={styles.optionsSection}>
                <Text style={styles.sectionLabel}>Options</Text>
                {(selectedQuestion.options || []).map((option, index) => {
                  const isCorrect = Array.isArray(selectedQuestion.correctAnswer)
                    ? selectedQuestion.correctAnswer.includes(index)
                    : selectedQuestion.correctAnswer === index;
                  return (
                  <View
                    key={index}
                    style={[
                      styles.optionBox,
                      isCorrect && styles.correctOption
                    ]}
                  >
                    <Text style={[
                      styles.optionLabel,
                      isCorrect && styles.correctOptionText
                    ]}>
                      {String.fromCharCode(65 + index)}.
                    </Text>
                    <View style={styles.optionContent}>
                      <Text style={[
                        styles.optionText,
                        isCorrect && styles.correctOptionText
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
                    {isCorrect && (
                      <Check color="#059669" size={20} />
                    )}
                  </View>
                  );
                })}
              </View>
              )}

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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
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
    fontSize: 10,
    color: '#6B7280',
    marginTop: 4,
  },
  progressLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#E5E7EB',
    marginTop: -16, // Align with center of circle
    marginHorizontal: -10,
    zIndex: -1,
  },
  progressLineActive: {
    backgroundColor: '#2563EB',
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
  assignmentTabs: {
    flexDirection: 'row',
    backgroundColor: '#E5E7EB',
    borderRadius: 10,
    padding: 2,
    marginBottom: 24,
    width: '100%',
  },
  assignmentTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  assignmentTabActive: {
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3.84,
    elevation: 5,
  },
  assignmentTabText: {
    fontSize: 14,
    color: '#4B5563',
    fontWeight: '600',
  },
  assignmentTabTextActive: {
    color: '#2563EB',
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
  sectionSetupHeader: {
    marginBottom: 8,
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
    fontWeight: 'bold',
  },
  sectionConfigCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
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
  qTinyChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    maxWidth: 150,
  },
  qTinyChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  qTinyChipText: {
    fontSize: 11,
    color: '#6B7280',
  },
  qTinyChipTextActive: {
    color: '#FFF',
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
  selectAllCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  selectAllTextDisabled: {
    color: '#9CA3AF',
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
  groupChipScroll: {
    marginBottom: 8,
  },
  groupChipScrollContent: {
    paddingRight: 12,
    gap: 8,
  },
  groupFilterEmpty: {
    fontSize: 13,
    color: '#9CA3AF',
    paddingVertical: 10,
  },
  groupChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  groupChipActive: {
    backgroundColor: '#EBF5FF',
    borderColor: '#2563EB',
  },
  groupChipText: {
    fontSize: 12,
    color: '#4B5563',
    fontWeight: '500',
  },
  groupChipTextActive: {
    color: '#1D4ED8',
    fontWeight: '600',
  },
  clearGroupFilterText: {
    fontSize: 13,
    color: '#2563EB',
    fontWeight: '600',
    marginBottom: 12,
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
    flex: 1,
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
  sectionContainer: {
    marginBottom: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#374151',
    backgroundColor: '#F3F4F6',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  freeUserAssignmentBanner: {
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 16,
  },
  freeUserAssignmentTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0D9488',
    marginBottom: 6,
    textAlign: 'center',
  },
  freeUserAssignmentText: {
    fontSize: 14,
    color: '#0F766E',
    textAlign: 'center',
    lineHeight: 20,
  },
});
