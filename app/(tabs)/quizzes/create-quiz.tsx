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
  Modal,
  Image,
  Switch,
  FlatList,
  KeyboardAvoidingView,
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
  Sparkles,
  AlertTriangle,
  Layers,
} from 'lucide-react-native';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import ShareQuizModal, { ShareQuizTarget } from '@/components/ShareQuizModal';
import { DateTimeField } from '@/components/DateTimeField';
import { formatToIST } from '@/utils/date';
import { isValidQuizWindow } from '@/utils/quizDateTime';
import {
  PROCTORING_DISABLED_PAYLOAD,
  PROCTORING_ON_PAYLOAD,
  proctoringUnavailableHint,
  type ProctoringEligibility,
} from '@/utils/proctoringToggle';
import useDebounce from '@/hooks/useDebounce';
import { colors } from '@/utils/theme';
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

/** Duration quick-preset chips shown under the minutes input in Step 2. */
const DURATION_PRESETS = [
  { label: '50 min', value: '50' },
  { label: '1.5 hrs', value: '90' },
  { label: '3 hrs', value: '180' },
  { label: '3.5 hrs', value: '210' },
];

/** Wizard step names, indexed by step number (1–5). */
const STEP_LABELS = ['Type', 'Settings', 'Questions', 'Sections', 'Assign'];

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
  const [duration, setDuration] = useState('30');
  const [positiveMarks, setPositiveMarks] = useState('4');
  const [negativeMarks, setNegativeMarks] = useState('1');
  const [availableQuestions, setAvailableQuestions] = useState(0);
  const [shareSolution, setShareSolution] = useState(true);  // NEW: Share solutions with students
  // AI Proctoring opt-in (Phase 9): admin preference only — the server
  // re-resolves eligibility at every start. Default OFF (D15).
  const [proctoringEnabled, setProctoringEnabled] = useState(false);
  const [proctoringEligibility, setProctoringEligibility] = useState<ProctoringEligibility | null>(null);
  const [lockSectionsAfterSubmission, setLockSectionsAfterSubmission] = useState(true);  // Section locking (default ON)
  const [assignToAllFreeUsers, setAssignToAllFreeUsers] = useState(false);

  // Time Window
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);

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
  // Dedicated flag for the step-5 audience lists — must not reuse the step-3
  // question-loading flag (a mentor fetch used to flicker the question list).
  const [loadingUsers, setLoadingUsers] = useState(false);

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

  // Post-creation Share Quiz popup (same sheet as Past Tests)
  const [createdQuiz, setCreatedQuiz] = useState<ShareQuizTarget | null>(null);
  const [shareModalVisible, setShareModalVisible] = useState(false);

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
      setLoadingUsers(true);
      const response = await api.get('/users/role/mentor');
      setMentors(response.data);
    } catch (error) {
      console.error('Error fetching mentors:', error);
    } finally {
      setLoadingUsers(false);
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
      // Section locking: missing on legacy quizzes = ON (never default OFF)
      setLockSectionsAfterSubmission(quiz.lockSectionsAfterSubmission !== false);
      // AI Proctoring: stored preference + live server-side eligibility for
      // the "temporarily unavailable" hint. Missing = OFF.
      setProctoringEnabled(quiz.proctoring?.enabled === true);
      setProctoringEligibility(quiz.proctoringEligibility ?? null);
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

  // "All selected" must be membership-based, not length-based: comparing
  // lengths misread selections made on other filter/pages as "everything
  // selected" whenever the counts happened to coincide.
  const allFilteredQuestionsSelected = filteredQuestions.length > 0
    && filteredQuestions.every(q => selectedQuestions.includes(q._id));

  const handleSelectAllQuestions = () => {
    const filteredIds = new Set(filteredQuestions.map(q => q._id));
    if (allFilteredQuestionsSelected) {
      // Deselect only what is visible; selections outside the current
      // filter/search stay — same semantics as the student select-all.
      setSelectedQuestions(prev => prev.filter(id => !filteredIds.has(id)));
      return;
    }

    setSelectedQuestions(prev => Array.from(new Set([...prev, ...Array.from(filteredIds)])));
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
    const parsedDuration = parseInt(duration, 10);
    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      Alert.alert('Error', 'Please enter a valid quiz duration in minutes');
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
    if (!isValidQuizWindow(scheduledDate, expiryDate)) {
      Alert.alert('Error', 'End date must be after start date');
      return;
    }
    const allocatedTime = quizSections.reduce((sum, s) => sum + s.duration, 0);
    if (quizSections.length > 0 && allocatedTime !== parsedDuration) {
      Alert.alert(
        'Error',
        `Section time allocation (${allocatedTime} mins) must match quiz duration (${parsedDuration} mins)`
      );
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
          duration: parsedDuration,
          positiveMarks: parseFloat(positiveMarks) || 4,
          negativeMarks: parseFloat(negativeMarks) || 0,
          instructions: instructions.split('\n').filter(i => i.trim()),
          assignedStudents: selectedStudents,
          assignedMentors: selectedMentors,
          shareSolution,
          lockSectionsAfterSubmission,
          assignToAllFreeUsers,
          scheduledDate: scheduledDate?.toISOString(),
          expiryDate: expiryDate?.toISOString(),
          sections: quizSections,
          // Phase 9 toggle: ON sends the complete silent-record payload (never
          // a bare enabled:true — schema defaults include warn-then-submit);
          // OFF explicitly disables for future attempts.
          proctoring: proctoringEnabled ? PROCTORING_ON_PAYLOAD : PROCTORING_DISABLED_PAYLOAD
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
          duration: parsedDuration,
          positiveMarks: parseFloat(positiveMarks) || 4,
          negativeMarks: parseFloat(negativeMarks) || 0,
          instructions: instructions.split('\n').filter(i => i.trim()),
          assignedStudents: selectedStudents,
          assignedMentors: selectedMentors,
          shareSolution,
          lockSectionsAfterSubmission,
          assignToAllFreeUsers,
          scheduledDate: scheduledDate?.toISOString(),
          expiryDate: expiryDate?.toISOString(),
          sections: quizSections,
          // Phase 9 toggle: OFF = omit entirely (absent = unproctored quiz).
          ...(proctoringEnabled ? { proctoring: PROCTORING_ON_PAYLOAD } : {})
        });

        // Offer external sharing straight after creation with the same Share
        // Quiz sheet used in Past Tests (externalOnly — internal students
        // were just assigned in step 5).
        const quiz = response.data?.quiz;
        if (quiz?._id && quiz.title) {
          setCreatedQuiz({
            _id: quiz._id,
            title: quiz.title,
            assignedStudents: Array.isArray(quiz.assignedStudents)
              ? quiz.assignedStudents.map((s: any) => (typeof s === 'string' ? s : s?._id)).filter(Boolean)
              : [],
          });
          setShareModalVisible(true);
        } else {
          // Shouldn't happen (backend always returns the quiz), but never
          // strand the user without a success confirmation.
          Alert.alert(
            'Success',
            `Quiz ${cloneId ? 'cloned' : 'created'} and assigned successfully!`,
            [{ text: 'OK', onPress: () => router.back() }]
          );
        }
      }


    } catch (error: any) {
      console.error('Create quiz error:', error);
      const data = error.response?.data;
      const message = data?.message || 'Failed to create quiz';
      const detail = typeof data?.error === 'string' && data.error !== message ? data.error : undefined;
      Alert.alert('Error', detail ? `${message}\n${detail}` : message);
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
        {(['daily', 'weekly', 'grand'] as TestType[]).map(type => {
          const active = testType === type;
          return (
            <TouchableOpacity
              key={type}
              style={[
                styles.testTypeCard,
                active && styles.testTypeCardActive
              ]}
              onPress={() => setTestType(type)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${type} test`}
            >
              <View style={[styles.testTypeIcon, active && styles.testTypeIconActive]}>
                {type === 'daily' && <Clock color={active ? '#FFF' : colors.textSecondary} size={22} />}
                {type === 'weekly' && <BookOpen color={active ? '#FFF' : colors.textSecondary} size={22} />}
                {type === 'grand' && <Users color={active ? '#FFF' : colors.textSecondary} size={22} />}
              </View>
              <Text style={[styles.testTypeName, active && styles.testTypeNameActive]}>
                {type.charAt(0).toUpperCase() + type.slice(1)} Test
              </Text>
              <Text style={styles.testTypeDesc}>
                {type === 'daily' ? 'Focused daily practice' : type === 'weekly' ? 'Weekly revision test' : 'Full-length test'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.inputLabel}>Select Subject(s)</Text>
      <TouchableOpacity
        style={styles.dropdown}
        onPress={() => setShowSubjectDropdown(!showSubjectDropdown)}
        accessibilityRole="button"
        accessibilityLabel="Select subjects"
        accessibilityHint={selectedSubjects.length > 0 ? `${selectedSubjects.length} subjects selected` : undefined}
      >
        <Text style={selectedSubjects.length > 0 ? styles.dropdownText : styles.dropdownPlaceholder}>
          {getSelectedSubjectNames()}
        </Text>
        <ChevronDown color={colors.textSecondary} size={20} />
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
            {availableQuestions} questions available across {selectedSubjects.length} subject{selectedSubjects.length > 1 ? 's' : ''}
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
        placeholderTextColor={colors.textMuted}
      />

      <View style={styles.fieldRow}>
        <View style={styles.fieldRowItem}>
          <Text style={styles.inputLabel}>Positive Marks</Text>
          <TextInput
            style={styles.input}
            value={positiveMarks}
            onChangeText={setPositiveMarks}
            keyboardType="numeric"
            placeholder="4"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={styles.fieldRowItem}>
          <Text style={styles.inputLabel}>Negative Marks</Text>
          <TextInput
            style={styles.input}
            value={negativeMarks}
            onChangeText={setNegativeMarks}
            keyboardType="numeric"
            placeholder="1"
            placeholderTextColor={colors.textMuted}
          />
        </View>
      </View>

      <Text style={styles.inputLabel}>Duration (minutes)</Text>
      <TextInput
        style={styles.input}
        value={duration}
        onChangeText={setDuration}
        keyboardType="numeric"
        placeholder="30"
        placeholderTextColor={colors.textMuted}
      />
      {/* Quick presets — visible chips instead of a dropdown hidden behind a chevron. */}
      <View style={styles.presetChipRow}>
        {DURATION_PRESETS.map(option => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.presetChip,
              duration === option.value && styles.presetChipActive
            ]}
            onPress={() => setDuration(option.value)}
            accessibilityRole="button"
            accessibilityLabel={`Set duration to ${option.label}`}
            accessibilityState={{ selected: duration === option.value }}
          >
            <Text style={[styles.presetChipText, duration === option.value && styles.presetChipTextActive]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.inputLabel}>Instructions</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={instructions}
        onChangeText={setInstructions}
        multiline
        placeholder="Enter instructions (one per line)"
        placeholderTextColor={colors.textMuted}
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
          trackColor={{ false: colors.borderStrong, true: 'rgba(1, 180, 174, 0.45)' }}
          thumbColor={shareSolution ? colors.primary : colors.textMuted}
        />
      </View>

      {/* Lock Sections After Submission Toggle */}
      <View style={styles.toggleContainer}>
        <View style={styles.toggleLabelContainer}>
          <Text style={styles.toggleLabel}>Lock Sections After Submission</Text>
          <Text style={styles.toggleHelperText}>
            Students complete sections in order, each with its own timer. Once a section is submitted (or its time ends), they cannot return to it. Applies only to quizzes with sections.
          </Text>
        </View>
        <Switch
          value={lockSectionsAfterSubmission}
          onValueChange={setLockSectionsAfterSubmission}
          trackColor={{ false: colors.borderStrong, true: 'rgba(1, 180, 174, 0.45)' }}
          thumbColor={lockSectionsAfterSubmission ? colors.primary : colors.textMuted}
        />
      </View>

      {/* AI Proctoring Toggle (Phase 9): per-quiz opt-in. The server stays
          authoritative — ON only makes THIS quiz eligible while the global
          flag and emergency switch allow it; monitoring is silent-record. */}
      <View style={styles.toggleContainer}>
        <View style={styles.toggleLabelContainer}>
          <Text style={styles.toggleLabel}>Enable AI Proctoring</Text>
          <Text style={styles.toggleHelperText}>
            Camera-based monitoring for this quiz only. Records silently for later review — no warnings, no auto-submit, no photos leave the phone.
          </Text>
          {proctoringEnabled && proctoringEligibility && !proctoringEligibility.enabled && (
            <Text style={styles.proctoringUnavailableText}>
              {proctoringUnavailableHint(proctoringEligibility)}
            </Text>
          )}
        </View>
        <Switch
          value={proctoringEnabled}
          onValueChange={(next) => {
            setProctoringEnabled(next);
            // Phase 9 fix: the hint must reflect LIVE server state — the
            // load-time eligibility snapshot goes stale (and was computed
            // against the stored opt-in, which may have been OFF).
            if (next && editId) {
              api.get(`/quizzes/${editId}`)
                .then((res) => setProctoringEligibility(res.data?.proctoringEligibility ?? null))
                .catch(() => setProctoringEligibility(null));
            }
          }}
          trackColor={{ false: colors.borderStrong, true: 'rgba(1, 180, 174, 0.45)' }}
          thumbColor={proctoringEnabled ? colors.primary : colors.textMuted}
        />
      </View>

      {/* Time Window */}
      <DateTimeField
        label="Start Date & Time"
        value={scheduledDate}
        placeholder="Select start date & time (Optional)"
        onCommit={setScheduledDate}
      />

      <DateTimeField
        label="End Date & Time"
        value={expiryDate}
        placeholder="Select end date & time (Optional)"
        onCommit={setExpiryDate}
      />

      {scheduledDate && expiryDate && expiryDate <= scheduledDate && (
        <Text style={styles.fieldError}>
          End date must be after start date
        </Text>
      )}

      {/* IST Preview Helper */}
      {(scheduledDate || expiryDate) && (
        <View style={styles.istPreviewBox}>
          <Text style={styles.istPreviewLabel}>
            Students will see (IST):
          </Text>
          {scheduledDate && (
            <Text style={styles.istPreviewText}>
              Starts: {formatToIST(scheduledDate)}
            </Text>
          )}
          {expiryDate && (
            <Text style={styles.istPreviewText}>
              Ends: {formatToIST(expiryDate)}
            </Text>
          )}
        </View>
      )}

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          {availableQuestions} questions available from {selectedSubjects.length} subject{selectedSubjects.length > 1 ? 's' : ''}
        </Text>
      </View>
    </View>
  );

  // Step 3 - Question Selection
  const renderStep3 = () => (
    <View style={styles.step3Content}>
      <Text style={[styles.stepTitle, styles.step3Title]}>Select Questions</Text>

      <View style={styles.selectionHeader}>
        <Text style={styles.selectionCount}>
          {selectedQuestions.length} selected{totalQuestions > 0 ? ` · ${totalQuestions} available` : ''}
        </Text>
        <TouchableOpacity
          onPress={handleSelectAllQuestions}
          accessibilityRole="button"
          accessibilityLabel={
            allFilteredQuestionsSelected
              ? 'Deselect visible questions'
              : 'Select visible questions'
          }
        >
          <Text style={[styles.selectAllText, filteredQuestions.length === 0 && styles.selectAllTextDisabled]}>
            {allFilteredQuestionsSelected ? 'Deselect All' : 'Select All'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchInput}>
        <Search color={colors.textSecondary} size={20} />
        <TextInput
          style={styles.searchTextInput}
          placeholder="Search questions..."
          placeholderTextColor={colors.textMuted}
          value={questionSearch}
          onChangeText={setQuestionSearch}
        />
        {questionSearch.length > 0 && (
          <TouchableOpacity onPress={() => setQuestionSearch('')} accessibilityLabel="Clear search">
            <X color={colors.textSecondary} size={18} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filterRow}>
        <TextInput
          style={styles.filterTextInput}
          placeholder="Filter by Topic..."
          placeholderTextColor={colors.textMuted}
          value={topicFilter}
          onChangeText={setTopicFilter}
        />
        <TextInput
          style={styles.filterTextInput}
          placeholder="Filter by Tag..."
          placeholderTextColor={colors.textMuted}
          value={tagFilter}
          onChangeText={setTagFilter}
        />
      </View>

      {/* Difficulty filter */}
      <View style={styles.filterChipRow}>
        <Text style={styles.filterLabelInline}>Difficulty</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterChipScroll}
          contentContainerStyle={styles.filterChipScrollContent}
        >
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
      <View style={styles.filterChipRow}>
        <Text style={styles.filterLabelInline}>Type</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterChipScroll}
          contentContainerStyle={styles.filterChipScrollContent}
        >
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
      <View style={styles.filterChipRow}>
        <Text style={styles.filterLabelInline}>Subject</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterChipScroll}
          contentContainerStyle={styles.filterChipScrollContent}
        >
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

      {/* Question list - flexes into all vertical space left by the fixed controls above,
          inside a bounded parent so the FlatList virtualizes properly and never slides
          under the wizard footer or tab bar. */}
      <View style={styles.questionList}>
        {loadingQuestions && page === 1 ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : filteredQuestions.length === 0 ? (
          <View style={styles.emptyState}>
            <Search color={colors.textMuted} size={28} />
            <Text style={styles.emptyStateTitle}>No questions found</Text>
            <Text style={styles.emptyStateText}>
              Try a different search, or clear the filters above.
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredQuestions}
            keyExtractor={(item: Question) => item._id}
            extraData={selectedQuestions}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            renderItem={({ item }: { item: Question }) => {
              const isSelected = selectedQuestions.includes(item._id);
              return (
                <TouchableOpacity
                  style={[
                    styles.questionItem,
                    isSelected && styles.questionItemSelected
                  ]}
                  onPress={() => toggleQuestion(item._id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected && <Check color="#FFF" size={14} />}
                  </View>
                  <View style={styles.questionInfo}>
                    <Text style={styles.questionText} numberOfLines={2}>{item.question}</Text>
                    <View style={styles.questionMeta}>
                      {item.subject?.name && (
                        <View style={styles.questionSubjectBadge}>
                          <Text style={styles.questionSubjectBadgeText}>{item.subject.name}</Text>
                        </View>
                      )}
                      {item.topicName && <Text style={styles.questionTopic}>{item.topicName}</Text>}
                      {item.difficulty && <Text style={styles.questionTopic}>{DIFFICULTY_LABELS[item.difficulty as keyof typeof DIFFICULTY_LABELS] || item.difficulty}</Text>}
                      {item.questionType && <Text style={styles.questionTopic}>{QUESTION_TYPE_LABELS[item.questionType as keyof typeof QUESTION_TYPE_LABELS] || item.questionType}</Text>}
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.viewButton}
                    onPress={() => setSelectedQuestion(item)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel="Preview question"
                  >
                    <Eye color={colors.primary} size={19} />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
            onEndReached={() => {
              if (hasMore && !loadingMore) {
                fetchQuestions(false);
              }
            }}
            onEndReachedThreshold={0.5}
            ListFooterComponent={() => (
              loadingMore ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
              ) : null
            )}
            contentContainerStyle={{ paddingBottom: 12 }}
          />
        )}
      </View>
    </View>
  );

  // Step 4 - Section Configuration (NEW)
  const renderStep4 = () => {
    const totalTime = parseInt(duration) || 0;
    const allocatedTime = quizSections.reduce((sum, s) => sum + s.duration, 0);
    const allocationMatches = quizSections.length > 0 && allocatedTime === totalTime;

    // Changing the count preserves configured sections: fewer truncates the
    // tail, more appends sections pre-filled with an equal share of the
    // unallocated time. Only a move from zero sections equal-splits the full
    // duration (same defaults the old re-initialize produced, without
    // discarding user-entered names/durations/questions on every change).
    const setSectionCount = (count: number) => {
      setQuizSections(prev => {
        if (prev.length === count) return prev;
        if (count < prev.length) return prev.slice(0, count);

        const allocated = prev.reduce((sum, s) => sum + s.duration, 0);
        const remaining = Math.max(totalTime - allocated, 0);
        const additions = count - prev.length;
        const equalTime = Math.floor(remaining / additions);

        const next = [...prev];
        for (let i = 0; i < additions; i++) {
          next.push({
            name: `Section ${prev.length + i + 1}`,
            duration: i === additions - 1 ? remaining - equalTime * (additions - 1) : equalTime,
            selectionType: 'mixed',
            questions: []
          });
        }
        return next;
      });
    };

    const updateSection = (index: number, updates: Partial<QuizSection>) => {
      const updated = [...quizSections];
      updated[index] = { ...updated[index], ...updates };
      setQuizSections(updated);
    };

    return (
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>Configure Sections</Text>

        <View style={styles.sectionSummaryRow}>
          <View style={styles.summaryTile}>
            <Text style={styles.summaryTileLabel}>Total Duration</Text>
            <Text style={styles.summaryTileValue}>{totalTime} min</Text>
          </View>
          <View style={[styles.summaryTile, quizSections.length > 0 && (allocationMatches ? styles.summaryTileMatch : styles.summaryTileMismatch)]}>
            <Text style={styles.summaryTileLabel}>Allocated</Text>
            <Text style={styles.summaryTileValue}>{allocatedTime} min</Text>
          </View>
        </View>

        {quizSections.length > 0 && !allocationMatches && (
          <View style={styles.mismatchRow}>
            <AlertTriangle color={colors.dangerDark} size={16} />
            <Text style={styles.mismatchText}>
              Allocated time ({allocatedTime} min) must match total duration ({totalTime} min) before the quiz can be created.
            </Text>
          </View>
        )}

        <Text style={styles.inputLabel}>Number of Sections</Text>
        <View style={styles.countChipRow}>
          {[1, 2, 3, 4, 5].map(n => (
            <TouchableOpacity
              key={n}
              style={[styles.countChip, quizSections.length === n && styles.countChipActive]}
              onPress={() => setSectionCount(n)}
              accessibilityRole="button"
              accessibilityLabel={`${n} sections`}
              accessibilityState={{ selected: quizSections.length === n }}
            >
              <Text style={[styles.countChipText, quizSections.length === n && styles.countChipTextActive]}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {quizSections.length === 0 ? (
          <View style={styles.sectionsEmptyState}>
            <Layers color={colors.textMuted} size={28} />
            <Text style={styles.emptyStateTitle}>No sections yet</Text>
            <Text style={styles.emptyStateText}>
              Pick the number of sections above to split this quiz into timed parts. Leave it at one section for a simple, single-timer test.
            </Text>
          </View>
        ) : (
          <View style={styles.sectionList}>
            {quizSections.map((section, idx) => (
              <View key={idx} style={styles.sectionConfigCard}>
                <View style={styles.sectionCardHeader}>
                  <View style={styles.sectionNumberBadge}>
                    <Text style={styles.sectionNumberText}>{idx + 1}</Text>
                  </View>
                  <TextInput
                    style={styles.sectionNameInput}
                    value={section.name}
                    onChangeText={(val) => updateSection(idx, { name: val })}
                    placeholder="Section Name"
                    placeholderTextColor={colors.textMuted}
                  />
                  <TextInput
                    style={styles.sectionDurationInput}
                    value={section.duration.toString()}
                    onChangeText={(val) => updateSection(idx, { duration: parseInt(val) || 0 })}
                    keyboardType="numeric"
                    placeholder="Min"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>

                <View style={styles.typeButtonRow}>
                  <TouchableOpacity
                    style={[styles.typeButton, section.selectionType === 'mixed' && styles.typeButtonActive]}
                    onPress={() => updateSection(idx, { selectionType: 'mixed', questions: [] })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: section.selectionType === 'mixed' }}
                  >
                    <Text style={[styles.typeButtonText, section.selectionType === 'mixed' && styles.typeButtonTextActive]}>Mixed</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.typeButton, section.selectionType === 'manual' && styles.typeButtonActive]}
                    onPress={() => updateSection(idx, { selectionType: 'manual' })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: section.selectionType === 'manual' }}
                  >
                    <Text style={[styles.typeButtonText, section.selectionType === 'manual' && styles.typeButtonTextActive]}>Manual</Text>
                  </TouchableOpacity>
                </View>

                {section.selectionType === 'manual' && (
                  <View style={styles.manualQuestionsBlock}>
                    <Text style={styles.manualQuestionsLabel}>
                      {section.questions.length} of {selectedQuestions.length} selected questions assigned
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.qTinyChipScrollContent}>
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
          </View>
        )}
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
          trackColor={{ false: colors.borderStrong, true: 'rgba(1, 180, 174, 0.45)' }}
          thumbColor={assignToAllFreeUsers ? colors.primary : colors.textMuted}
        />
      </View>

      <View style={styles.assignmentTabs}>
        <TouchableOpacity
          style={[styles.assignmentTab, assignmentTab === 'students' && styles.assignmentTabActive]}
          onPress={() => setAssignmentTab('students')}
          accessibilityRole="tab"
          accessibilityState={{ selected: assignmentTab === 'students' }}
        >
          <Text style={[styles.assignmentTabText, assignmentTab === 'students' && styles.assignmentTabTextActive]}>
            Students ({students.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.assignmentTab, assignmentTab === 'mentors' && styles.assignmentTabActive]}
          onPress={() => setAssignmentTab('mentors')}
          accessibilityRole="tab"
          accessibilityState={{ selected: assignmentTab === 'mentors' }}
        >
          <Text style={[styles.assignmentTabText, assignmentTab === 'mentors' && styles.assignmentTabTextActive]}>
            Mentors ({mentors.length})
          </Text>
        </TouchableOpacity>
      </View>

      {assignmentTab === 'students' ? (
        assignToAllFreeUsers ? (
          <View style={styles.freeUserAssignmentBanner}>
            <Sparkles color={colors.primary} size={28} style={{ marginBottom: 8 }} />
            <Text style={styles.freeUserAssignmentTitle}>Assigning to All Free Users</Text>
            <Text style={styles.freeUserAssignmentText}>
              This quiz is configured to be shared with all unregistered and free student users automatically. Individual student selection is disabled.
            </Text>
          </View>
        ) : (
          <>
          <View style={styles.selectionHeader}>
            <Text style={styles.selectionCount}>
              {selectedGroupIds.length} group filter{selectedGroupIds.length === 1 ? '' : 's'} active
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
            <Users color={colors.textSecondary} size={20} />
            <TextInput
              style={styles.searchTextInput}
              placeholder="Filter groups by name..."
              placeholderTextColor={colors.textMuted}
              value={groupSearch}
              onChangeText={setGroupSearch}
            />
            {groupSearch.length > 0 && (
              <TouchableOpacity onPress={() => setGroupSearch('')} accessibilityLabel="Clear group filter search">
                <X color={colors.textSecondary} size={16} />
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
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedGroupIds.includes(group._id) }}
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
            <TouchableOpacity onPress={() => setSelectedGroupIds([])} accessibilityRole="button" accessibilityLabel="Clear group filters">
              <Text style={styles.clearGroupFilterText}>Clear Group Filters</Text>
            </TouchableOpacity>
          )}

          <View style={styles.selectionHeader}>
            <TouchableOpacity
              style={styles.selectAllCheckboxRow}
              onPress={handleSelectAll}
              disabled={filteredStudents.length === 0}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={allFilteredStudentsSelected ? 'Deselect visible students' : 'Select visible students'}
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
            <Search color={colors.textSecondary} size={20} />
            <TextInput
              style={styles.searchTextInput}
              placeholder={selectedGroupIds.length > 0 ? 'Search students in selected groups...' : 'Search students...'}
              placeholderTextColor={colors.textMuted}
              value={studentSearch}
              onChangeText={setStudentSearch}
            />
            {studentSearch.length > 0 && (
              <TouchableOpacity onPress={() => setStudentSearch('')} accessibilityLabel="Clear student search">
                <X color={colors.textSecondary} size={16} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.studentList}>
            {loadingUsers ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
            ) : filteredStudents.length === 0 ? (
              <View style={styles.emptyState}>
                <Users color={colors.textMuted} size={28} />
                <Text style={styles.emptyStateTitle}>No students found</Text>
                <Text style={styles.emptyStateText}>
                  Try a different search, or clear the group filters.
                </Text>
              </View>
            ) : (
              filteredStudents.map(item => {
                const isSelected = selectedStudents.includes(item._id);
                return (
                  <TouchableOpacity
                    key={item._id}
                    style={[
                      styles.studentItem,
                      isSelected && styles.studentItemSelected
                    ]}
                    onPress={() => toggleStudent(item._id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                  >
                    <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                      {isSelected && <Check color="#FFF" size={14} />}
                    </View>
                    <View style={styles.studentInfo}>
                      <Text style={styles.studentName}>{item.name}</Text>
                      <Text style={styles.studentEmail}>{item.email}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
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
            {loadingUsers ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
            ) : mentors.length === 0 ? (
              <View style={styles.emptyState}>
                <Users color={colors.textMuted} size={28} />
                <Text style={styles.emptyStateTitle}>No mentors found</Text>
              </View>
            ) : (
              mentors.map(item => {
                const isSelected = selectedMentors.includes(item._id);
                return (
                  <TouchableOpacity
                    key={item._id}
                    style={[
                      styles.studentItem,
                      isSelected && styles.studentItemSelected
                    ]}
                    onPress={() => toggleMentor(item._id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                  >
                    <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                      {isSelected && <Check color="#FFF" size={14} />}
                    </View>
                    <View style={styles.studentInfo}>
                      <Text style={styles.studentName}>{item.name}</Text>
                      <Text style={styles.studentEmail}>{item.email}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
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
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
          <ChevronLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {editId ? 'Edit Quiz' : cloneId ? 'Clone Quiz' : 'Create Quiz'}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {/* KeyboardAvoidingView keeps Step 2's inputs and the wizard footer
          reachable while the software keyboard is open (same pattern as the
          other full-screen form routes: create-group, create-user). */}
      <KeyboardAvoidingView behavior="padding" style={styles.keyboardArea}>
        {/* Compact progress header — "Step X of 5" + segmented bar. Five
            labeled circles overflowed narrow phones; this never clips, and
            tapping a completed segment jumps back to that step. */}
        <View style={styles.progressContainer}>
          <View style={styles.progressHeaderRow}>
            <Text style={styles.progressStepLabel}>
              Step {step} of {STEP_LABELS.length}
            </Text>
            <Text style={styles.progressStepName}>{STEP_LABELS[step - 1]}</Text>
          </View>
          <View style={styles.progressSegments} accessibilityLabel={`Step ${step} of ${STEP_LABELS.length}`}>
            {STEP_LABELS.map((label, idx) => {
              const s = idx + 1;
              const isCurrent = s === step;
              const isDone = s < step;
              return (
                <TouchableOpacity
                  key={label}
                  style={styles.progressSegmentTouchable}
                  onPress={() => {
                    if (s < step) setStep(s);
                  }}
                  disabled={s >= step}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to step ${s}: ${label}`}
                  accessibilityState={{ disabled: s >= step }}
                >
                  <View
                    style={[
                      styles.progressSegment,
                      isDone && styles.progressSegmentDone,
                      isCurrent && styles.progressSegmentCurrent,
                    ]}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
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
            keyboardShouldPersistTaps="handled"
          >
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 4 && renderStep4()}
            {step === 5 && renderStep5()}
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        {step > 1 && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setStep(step - 1)}
            accessibilityRole="button"
            accessibilityLabel="Previous step"
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
            accessibilityRole="button"
            accessibilityLabel="Next step"
          >
            <Text style={styles.nextButtonText}>Next</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.createButton, creating && styles.buttonDisabled]}
            onPress={handleCreateQuiz}
            disabled={creating}
            accessibilityRole="button"
            accessibilityLabel={editId ? 'Update quiz' : 'Create and assign quiz'}
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
            <TouchableOpacity onPress={() => setSelectedQuestion(null)} accessibilityRole="button" accessibilityLabel="Close preview">
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

      {/* Post-creation Share Quiz sheet — closing it finishes the flow.
          External only: internal students were just assigned in step 5, so a
          second internal picker here would be a duplicate assignment path. */}
      <ShareQuizModal
        visible={shareModalVisible}
        quiz={createdQuiz}
        onClose={() => router.back()}
        externalOnly
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
  keyboardArea: {
    flex: 1,
  },
  progressContainer: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressStepLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  progressStepName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  progressSegments: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  progressSegmentTouchable: {
    flex: 1,
  },
  progressSegment: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  progressSegmentDone: {
    backgroundColor: 'rgba(1, 180, 174, 0.4)',
  },
  progressSegmentCurrent: {
    backgroundColor: colors.primary,
  },
  content: {
    flex: 1,
  },
  stepContent: {
    padding: 16,
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
  },
  // Step 3 uses a fixed-chrome + flexible-list layout: the controls below keep
  // their natural height while questionList (flex: 1) takes all remaining space.
  step3Content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  step3Title: {
    marginBottom: 8,
  },
  questionList: {
    flex: 1,
  },
  // ---- Step 1: test type & subjects ----
  testTypeContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  testTypeCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  testTypeCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  testTypeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  testTypeIconActive: {
    backgroundColor: colors.primary,
  },
  testTypeName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textBody,
    marginBottom: 2,
  },
  testTypeNameActive: {
    color: colors.primaryDark,
  },
  testTypeDesc: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
  infoBox: {
    backgroundColor: colors.primaryTint,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.primaryTintBorder,
  },
  infoText: {
    fontSize: 13,
    color: colors.primaryDark,
    fontWeight: '600',
  },
  // ---- Form fields ----
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textBody,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 12,
  },
  fieldRowItem: {
    flex: 1,
  },
  presetChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  presetChipText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  presetChipTextActive: {
    color: '#FFF',
    fontWeight: '600',
  },
  fieldError: {
    fontSize: 12,
    color: colors.danger,
    marginTop: 4,
  },
  istPreviewBox: {
    marginTop: 8,
    padding: 10,
    backgroundColor: colors.primaryTint,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primaryTintBorder,
  },
  istPreviewLabel: {
    fontSize: 12,
    color: colors.primaryDark,
    fontWeight: '600',
    marginBottom: 4,
  },
  istPreviewText: {
    fontSize: 12,
    color: colors.primaryText,
  },
  // ---- Step 3: question selection ----
  selectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  selectAllCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectionCount: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  selectAllText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  selectAllTextDisabled: {
    color: colors.textMuted,
  },
  searchInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchTextInput: {
    flex: 1,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  // Compact, visibly-boxed inputs so the Topic/Tag row reads as part of the
  // filter block instead of borderless text floating on the gray canvas.
  filterTextInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.text,
  },
  // Compact single-line filter group: fixed label + horizontally scrollable chips
  filterChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  // Fixed label column so every filter row (Difficulty/Type/Subject) starts its
  // chip strip at the same x-origin. minWidth keeps labels from ever wrapping
  // if a device font renders wider than expected.
  filterLabelInline: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    minWidth: 68,
    marginRight: 8,
  },
  filterChipScroll: {
    flex: 1,
  },
  // Center chips on the row's cross axis so active/inactive pills stay on one
  // shared baseline regardless of their rendered heights.
  filterChipScrollContent: {
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: '#FFF',
    fontWeight: '600',
  },
  questionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  questionItemSelected: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primary,
  },
  questionInfo: {
    flex: 1,
  },
  questionText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  questionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  questionSubjectBadge: {
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  questionSubjectBadgeText: {
    fontSize: 11,
    color: colors.primaryDark,
    fontWeight: '600',
  },
  questionTopic: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  viewButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // ---- Step 4: sections ----
  sectionSummaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  summaryTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  summaryTileLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  summaryTileValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  summaryTileMatch: {
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  summaryTileMismatch: {
    borderColor: 'rgba(239, 68, 68, 0.45)',
  },
  mismatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dangerTint,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  mismatchText: {
    flex: 1,
    fontSize: 13,
    color: colors.dangerDark,
    fontWeight: '500',
  },
  countChipRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  countChip: {
    minWidth: 44,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  countChipText: {
    fontSize: 14,
    color: colors.textBody,
  },
  countChipTextActive: {
    color: '#FFF',
    fontWeight: '700',
  },
  sectionList: {
    marginTop: 8,
  },
  sectionConfigCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionNumberBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primaryTint,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionNumberText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  sectionNameInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionDurationInput: {
    width: 76,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    textAlign: 'center',
  },
  typeButtonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  typeButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  typeButtonText: {
    fontSize: 13,
    color: colors.textBody,
  },
  typeButtonTextActive: {
    color: colors.primaryDark,
    fontWeight: '600',
  },
  manualQuestionsBlock: {
    marginTop: 12,
  },
  manualQuestionsLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  qTinyChipScrollContent: {
    paddingRight: 8,
    paddingBottom: 4,
  },
  qTinyChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: colors.bg,
    marginRight: 6,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 150,
  },
  qTinyChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  qTinyChipText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  qTinyChipTextActive: {
    color: '#FFF',
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dropdownText: {
    fontSize: 16,
    color: colors.text,
  },
  dropdownPlaceholder: {
    fontSize: 16,
    color: colors.textMuted,
  },
  dropdownList: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 4,
    maxHeight: 260,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg,
    gap: 12,
  },
  dropdownItemSelected: {
    backgroundColor: colors.primaryTint,
  },
  dropdownItemText: {
    fontSize: 16,
    color: colors.text,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  // ---- Step 5: assignment ----
  assignmentTabs: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
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
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  assignmentTabText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  assignmentTabTextActive: {
    color: '#FFFFFF',
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
    color: colors.textMuted,
    paddingVertical: 10,
  },
  groupChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  groupChipActive: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primary,
  },
  groupChipText: {
    fontSize: 12,
    color: colors.textBody,
    fontWeight: '500',
  },
  groupChipTextActive: {
    color: colors.primaryDark,
    fontWeight: '600',
  },
  clearGroupFilterText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 12,
  },
  studentList: {
    flex: 1,
    minHeight: 200,
  },
  studentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  studentItemSelected: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primary,
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  studentEmail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // ---- Toggles ----
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleLabelContainer: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  toggleHelperText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  proctoringUnavailableText: {
    fontSize: 12,
    color: colors.warning,
    lineHeight: 16,
    marginTop: 4,
  },
  // ---- Empty / error states ----
  emptyState: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
    gap: 6,
  },
  emptyStateTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textBody,
  },
  emptyStateText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  sectionsEmptyState: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 24,
    gap: 8,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    marginTop: 8,
  },
  errorText: {
    fontSize: 16,
    color: colors.danger,
    textAlign: 'center',
    marginTop: 50,
  },
  // ---- Bottom navigation ----
  bottomNav: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 12,
  },
  backButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },
  nextButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
  },
  createButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  // ---- Question Detail Modal ----
  modalContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.primary,
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
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  fullQuestionText: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 24,
  },
  questionImage: {
    width: '100%',
    height: 200,
    marginTop: 12,
    borderRadius: 8,
  },
  optionsSection: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  optionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 8,
    backgroundColor: colors.bg,
    marginBottom: 8,
    gap: 12,
  },
  correctOption: {
    backgroundColor: colors.successTint,
    borderWidth: 1,
    borderColor: colors.success,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textBody,
    width: 24,
  },
  correctOptionText: {
    color: colors.successDark,
  },
  optionContent: {
    flex: 1,
  },
  optionText: {
    fontSize: 14,
    color: colors.textBody,
    lineHeight: 20,
  },
  optionImage: {
    width: '100%',
    height: 120,
    marginTop: 8,
    borderRadius: 6,
  },
  explanationSection: {
    backgroundColor: colors.warningTint,
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
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  metaText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  freeUserAssignmentBanner: {
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primaryTintBorder,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 16,
  },
  freeUserAssignmentTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primaryDark,
    marginBottom: 6,
    textAlign: 'center',
  },
  freeUserAssignmentText: {
    fontSize: 14,
    color: colors.primaryText,
    textAlign: 'center',
    lineHeight: 20,
  },
});
