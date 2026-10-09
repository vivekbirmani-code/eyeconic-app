import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  BackHandler,
  Animated,
  Dimensions,
  AccessibilityInfo,
  Image,
  Modal,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, Flag, AlertCircle, X } from 'lucide-react-native';
import type { CameraView } from 'expo-camera';
import { api } from '@/services/api';
import { useQuiz } from '@/context/QuizContext';
import { QuizTimer } from '@/components/QuizTimer';
import { QuestionNavigationGrid } from '@/components/QuestionNavigationGrid';
import { SectionTabs } from '@/components/SectionTabs';
import { QuestionSkeleton } from '@/components/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ProctoringBanner } from '@/components/proctoring/ProctoringBanner';
import { ProctoringCameraPip } from '@/components/proctoring/ProctoringCameraPip';
import { useProctoringSession } from '@/hooks/useProctoringSession';
import { useAttemptScreenCapturePrevention } from '@/hooks/useAttemptScreenCapturePrevention';
import { PROCTORING_COPY } from '@/utils/proctoringCopy';
import { getSocketURL } from '@/services/config';
import { formatToIST } from '@/utils/date';
import QuestionPrompt from '@/components/quiz/QuestionPrompt';
import { QuestionType, StudentResponse, isResponseAnswered } from '@/types/question';

interface Question {
  _id: string;
  question: string;
  questionImage?: string;
  questionType?: QuestionType;
  options?: string[];
  optionImages?: string[];
  assertion?: string;
  reason?: string;
  columnA?: string[];
  columnB?: string[];
  marks: number;
  subject?: {
    _id: string;
    name: string;
  };
}

const defaultResponseFor = (type?: QuestionType): StudentResponse => {
  switch (type) {
    case 'multiple_correct': return [];
    case 'match_the_following': return {};
    case 'numerical': return null;
    default: return -1;
  }
};

interface Quiz {
  _id: string;
  title: string;
  subject: string;
  duration: number;
  totalMarks: number;
  questions: Question[];
  expiryDate?: string;
  sections?: {
    name: string;
    duration: number;
    selectionType: 'mixed' | 'manual';
    questions: string[] | Question[];
  }[];
}

const getQuestionId = (question: any): string => {
  if (!question) return '';
  if (typeof question === 'string') return question;
  return question._id || '';
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function QuizTakingContent() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { currentAttempt, saveAnswer, submitQuiz, submitSection, loadAttempt, isLoading: quizLoading } = useQuiz();

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<StudentResponse>(-1);
  const [markedForReview, setMarkedForReview] = useState(false);
  const [currentSection, setCurrentSection] = useState<string>('All');
  const [questionStartTime, setQuestionStartTime] = useState(Date.now());
  const [showNavigationGrid, setShowNavigationGrid] = useState(SCREEN_WIDTH > 768);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [showReviewModal, setShowReviewModal] = useState(false);

  // ===== Section locking (the attempt snapshot is the single truth) =====
  const sectionLockOn =
    currentAttempt?.sectionLockEnabled === true &&
    (currentAttempt?.sectionDefinitions?.length ?? 0) > 0;

  // ===== Proctoring (Phase 3) — armed only for snapshot-carrying attempts;
  // non-proctored attempts never mount a camera or an engine =====
  const proctoringCameraRef = useRef<CameraView | null>(null);
  const proctoring = useProctoringSession({
    quizId: String(id),
    attemptId: currentAttempt?.attemptId,
    sessionId: currentAttempt?.proctoringSessionId,
    policy: currentAttempt?.proctoringPolicy,
    arm: currentAttempt?.proctoringArm,
    cameraRef: proctoringCameraRef,
  });
  // ===== Proctoring (Phase 4, D13) — attempt-scoped screen-capture
  // prevention: armed only while the proctored session is active, released on
  // finalize (context clears the attempt) and on unmount (navigation away).
  // Never active on non-proctored attempts. Deterrence only — no evidence is
  // captured or stored, and this is not a guarantee. =====
  useAttemptScreenCapturePrevention({
    active: proctoring.active,
    policy: currentAttempt?.proctoringPolicy,
    attemptId: currentAttempt?.attemptId,
  });
  // ===== Phase 6 (§20.3/§20.6): the server policy-auto-submitted this
  // attempt (the D3 focus ladder's terminal step — never silent). The student
  // sees exactly what happened in plain English, then lands on their result —
  // the same destination as any other submit. =====
  useEffect(() => {
    if (!proctoring.autoSubmitted || !currentAttempt?.attemptId) return;
    const copy = PROCTORING_COPY.warnings.autoSubmitted;
    Alert.alert(copy.title, copy.body, [
      {
        text: 'OK',
        onPress: () => router.replace(`/quizzes/${id}/result/${currentAttempt.attemptId}`),
      },
    ]);
    // Fire once per attempt — the banner copy is static.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proctoring.autoSubmitted]);
  const activeSectionState = sectionLockOn
    ? currentAttempt?.sectionStates?.find(s => s.status === 'in_progress') ?? null
    : null;
  const activeSectionIndex = activeSectionState?.index ?? -1;
  const activeSectionDef = sectionLockOn
    ? currentAttempt?.sectionDefinitions?.find(d => d.index === activeSectionIndex) ?? null
    : null;
  const isLastSection =
    sectionLockOn && activeSectionIndex === (currentAttempt?.sectionDefinitions?.length ?? 0) - 1;

  // ===== Server-authoritative countdown inputs =====
  // clockOffsetMs corrects the device clock against the server's own "now"
  // (captured when the attempt payload arrived). Combined with a server
  // deadline below, a drifted/tampered device clock can no longer extend or
  // shrink the visible remaining time. The server stays the enforcer — this
  // is display-only.
  const clockOffsetMs = useMemo(() => {
    const serverNow = currentAttempt?.serverNow;
    if (!serverNow) return 0;
    const serverMs = new Date(serverNow).getTime();
    if (!Number.isFinite(serverMs)) return 0;
    return serverMs - Date.now();
  }, [currentAttempt?.serverNow]);

  // Effective participation deadline for a FLAT attempt =
  // min(server-computed attempt deadline, quiz end) — the same formula the
  // backend enforces on every write. Null for section-locked/pre-deadline
  // attempts (the section timer or the legacy fallback is used instead).
  const effectiveDeadlineMs = useMemo(() => {
    const candidates: number[] = [];
    const attemptDeadline = currentAttempt?.durationDeadline
      ? new Date(currentAttempt.durationDeadline).getTime()
      : NaN;
    if (Number.isFinite(attemptDeadline)) candidates.push(attemptDeadline);
    const quizEnd = quiz?.expiryDate ? new Date(quiz.expiryDate).getTime() : NaN;
    if (Number.isFinite(quizEnd)) candidates.push(quizEnd);
    return candidates.length > 0 ? Math.min(...candidates) : null;
  }, [currentAttempt?.durationDeadline, quiz?.expiryDate]);

  // Section countdown: the server-stored section end, capped by the quiz's
  // own end (a section can never outlive the quiz window server-side).
  const sectionDeadlineMs = useMemo(() => {
    if (!activeSectionState?.endsAt) return null;
    const endsAt = new Date(activeSectionState.endsAt).getTime();
    if (!Number.isFinite(endsAt)) return null;
    const quizEnd = quiz?.expiryDate ? new Date(quiz.expiryDate).getTime() : NaN;
    return Number.isFinite(quizEnd) ? Math.min(endsAt, quizEnd) : endsAt;
  }, [activeSectionState?.endsAt, quiz?.expiryDate]);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const buttonScaleAnim = useRef(new Animated.Value(1)).current;

  const scrollViewRef = useRef<ScrollView>(null);

  // Helper to resolve image URLs (handles relative paths from backend)
  const getImageUrl = useCallback((path?: string) => {
    if (!path) return undefined;
    if (path.startsWith('http') || path.startsWith('https') || path.startsWith('file://') || path.startsWith('data:')) {
      return { uri: path };
    }

    // Prepend base URL for relative paths
    const baseUrl = getSocketURL();
    // Ensure we don't have double slashes if path starts with /
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return { uri: `${baseUrl}${cleanPath}` };
  }, []);

  // Handle image load errors gracefully
  const handleImageError = useCallback((url: string) => {
    setFailedImages(prev => new Set(prev).add(url));
  }, []);

  // Helper to safely get subject name with fallback
  const getSubjectName = useCallback((question: any): string => {
    return question.subject?.name || question.subjectName || 'Uncategorized';
  }, []);

  // Memoize sections to avoid recalculation
  const sections = useMemo(() => {
    if (!quiz) return [];

    // Section locking: sections come from the attempt snapshot verbatim —
    // sequential navigation only, no "All" view.
    if (sectionLockOn && currentAttempt?.sectionDefinitions?.length) {
      return currentAttempt.sectionDefinitions.map(d => d.name);
    }

    // Prioritize defined sections
    if (quiz.sections && quiz.sections.length > 0) {
      return ['All', ...quiz.sections.map(s => s.name)];
    }

    const subjects = quiz.questions.map(q => getSubjectName(q));
    return ['All', ...Array.from(new Set(subjects))];
  }, [quiz, getSubjectName, sectionLockOn, currentAttempt]);

  const sectionQuestionIdsMap = useMemo(() => {
    if (!quiz) return {} as Record<string, string[]>;

    // Section locking: the server-authoritative partition, used verbatim.
    // Never re-derive membership client-side — display must match what the
    // backend enforces.
    if (sectionLockOn && currentAttempt?.sectionDefinitions?.length) {
      const lockedMap: Record<string, string[]> = {};
      currentAttempt.sectionDefinitions.forEach(d => {
        lockedMap[d.name] = (d.questionIds || []).map(String).filter(Boolean);
      });
      return lockedMap;
    }

    if (!quiz.sections || quiz.sections.length === 0) return {} as Record<string, string[]>;

    const allQuestionIds = quiz.questions.map(q => getQuestionId(q)).filter(Boolean);
    const allQuestionIdSet = new Set(allQuestionIds);

    const map: Record<string, string[]> = {};
    const mixedSectionNames: string[] = [];
    const assignedQuestionIds = new Set<string>();

    quiz.sections.forEach(section => {
      const normalizedIds = (section.questions || [])
        .map(q => getQuestionId(q))
        .filter(qid => qid && allQuestionIdSet.has(qid));

      map[section.name] = [...new Set(normalizedIds)];
      map[section.name].forEach(qid => assignedQuestionIds.add(qid));

      if (section.selectionType === 'mixed') {
        mixedSectionNames.push(section.name);
      }
    });

    const unassignedQuestionIds = allQuestionIds.filter(qid => !assignedQuestionIds.has(qid));
    if (mixedSectionNames.length > 0 && unassignedQuestionIds.length > 0) {
      unassignedQuestionIds.forEach((qid, index) => {
        const sectionName = mixedSectionNames[index % mixedSectionNames.length];
        map[sectionName] = [...new Set([...(map[sectionName] || []), qid])];
      });
    }

    return map;
  }, [quiz]);

  const activeQuestionIndexes = useMemo(() => {
    if (!quiz) return [];
    if (currentSection === 'All') return quiz.questions.map((_, index) => index);

    if (quiz.sections && quiz.sections.length > 0) {
      // Preserve the order defined in section.questions (not global array order)
      const sectionQuestionIds = sectionQuestionIdsMap[currentSection] || [];
      // Build a map from questionId -> global index for O(1) lookup
      const idToGlobalIndex: Record<string, number> = {};
      quiz.questions.forEach((question, index) => {
        const qid = getQuestionId(question);
        if (qid) idToGlobalIndex[qid] = index;
      });
      // Return indexes in section-defined order, skipping any not found
      return sectionQuestionIds
        .map(qid => idToGlobalIndex[qid])
        .filter((idx): idx is number => idx !== undefined);
    }

    return quiz.questions
      .map((question, index) => (getSubjectName(question) === currentSection ? index : -1))
      .filter(index => index !== -1);
  }, [quiz, currentSection, getSubjectName, sectionQuestionIdsMap]);


  const currentQuestionPosition = useMemo(
    () => activeQuestionIndexes.indexOf(currentQuestionIndex),
    [activeQuestionIndexes, currentQuestionIndex]
  );

  // Memoize question statuses
  const questionStatuses = useMemo(() => {
    if (!quiz || !currentAttempt) return [];
    return quiz.questions.map((q, index) => {
      const answer = currentAttempt.answers.find(a => a.questionIndex === index);
      return {
        answered: isResponseAnswered(q.questionType || 'mcq_single', answer?.selectedAnswer as StudentResponse),
        markedForReview: answer?.markedForReview || false,
        visited: index <= currentQuestionIndex
      };
    });
  }, [quiz, currentAttempt, currentQuestionIndex]);

  // Review-modal scope: with section locking, an intermediate section reviews
  // only itself; the final section reviews the whole quiz (like today).
  const reviewIndexes = useMemo(() => {
    if (sectionLockOn && !isLastSection) return activeQuestionIndexes;
    return quiz ? quiz.questions.map((_, i) => i) : [];
  }, [sectionLockOn, isLastSection, activeQuestionIndexes, quiz]);

  const reviewStats = useMemo(() => {
    let answered = 0;
    let marked = 0;
    reviewIndexes.forEach(i => {
      const status = questionStatuses[i];
      if (!status) return;
      if (status.answered) answered++;
      if (status.markedForReview) marked++;
    });
    return {
      total: reviewIndexes.length,
      answered,
      marked,
      unanswered: reviewIndexes.length - answered
    };
  }, [reviewIndexes, questionStatuses]);

  // Per-section tab statuses for the locked UI (✓ Submitted / active /
  // upcoming). Absent when locking is off — the tabs render exactly as
  // before the feature existed.
  const sectionStatuses = useMemo(() => {
    if (!sectionLockOn || !currentAttempt?.sectionDefinitions?.length) return undefined;
    const map: { [name: string]: 'locked' | 'active' | 'upcoming' } = {};
    currentAttempt.sectionDefinitions.forEach(d => {
      if (activeSectionIndex >= 0 && d.index < activeSectionIndex) map[d.name] = 'locked';
      else if (d.index === activeSectionIndex) map[d.name] = 'active';
      else map[d.name] = 'upcoming';
    });
    return map;
  }, [sectionLockOn, currentAttempt, activeSectionIndex]);

  // Memoize question counts
  const questionCounts = useMemo(() => {
    if (!quiz) return {};
    return sections.reduce((acc, section) => {
      if (section === 'All') {
        acc[section] = quiz.questions.length;
      } else if (quiz.sections && quiz.sections.length > 0) {
        acc[section] = sectionQuestionIdsMap[section]?.length || 0;
      } else {
        acc[section] = quiz.questions.filter(q => getSubjectName(q) === section).length;
      }
      return acc;
    }, {} as { [key: string]: number });
  }, [quiz, sections, getSubjectName, sectionQuestionIdsMap]);



  useEffect(() => {
    // Animate in on mount
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useEffect(() => {
    if (currentAttempt && currentAttempt.answers) {
      const answer = currentAttempt.answers.find(a => a.questionIndex === currentQuestionIndex);
      const questionType = quiz?.questions[currentQuestionIndex]?.questionType;
      if (answer && isResponseAnswered(questionType || 'mcq_single', answer.selectedAnswer as StudentResponse)) {
        setSelectedAnswer(answer.selectedAnswer as StudentResponse);
        setMarkedForReview(answer.markedForReview);
      } else {
        setSelectedAnswer(defaultResponseFor(questionType));
        setMarkedForReview(answer?.markedForReview || false);
      }
    }
    setQuestionStartTime(Date.now());
    setSaveError(false);

    // Animate question change
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [currentQuestionIndex, currentAttempt, quiz]);

  useEffect(() => {
    if (activeQuestionIndexes.length === 0) return;
    if (!activeQuestionIndexes.includes(currentQuestionIndex)) {
      setCurrentQuestionIndex(activeQuestionIndexes[0]);
    }
  }, [activeQuestionIndexes, currentQuestionIndex]);

  // Section locking: adopt the server-authoritative active section whenever
  // it changes (section submit, timer expiry while away, mount re-sync).
  // The currentQuestionIndex then re-centers via the effect above because
  // activeQuestionIndexes recomputes for the new section.
  useEffect(() => {
    if (!sectionLockOn || !activeSectionDef) return;
    if (currentSection !== activeSectionDef.name) {
      setCurrentSection(activeSectionDef.name);
    }
  }, [sectionLockOn, activeSectionDef, currentSection]);

  useEffect(() => {
    // With section locking there is no 'All' fallback — an empty section
    // must not kick the student into a nonexistent view.
    if (sectionLockOn) return;
    if (currentSection !== 'All' && activeQuestionIndexes.length === 0) {
      setCurrentSection('All');
    }
  }, [sectionLockOn, currentSection, activeQuestionIndexes]);

  // Section locking: re-sync with the server once per attempt so refresh,
  // app restart, a second device, or tampered local state all adopt the
  // server's progress. If the attempt already ended, route to results.
  const syncedAttemptRef = useRef<string | null>(null);
  useEffect(() => {
    const attemptId = currentAttempt?.attemptId;
    if (!attemptId || syncedAttemptRef.current === attemptId) return;
    syncedAttemptRef.current = attemptId;

    let cancelled = false;
    (async () => {
      try {
        const data = await loadAttempt(attemptId);
        if (cancelled) return;
        if (data?.status && data.status !== 'in_progress') {
          router.replace(`/quizzes/${id}/result/${attemptId}`);
        }
      } catch (error) {
        // Offline / transient failure: keep local state; the next save or
        // section submit re-syncs with the server anyway.
        console.warn('Attempt re-sync failed:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [currentAttempt?.attemptId, id, loadAttempt, router]);

  const fetchQuizDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get(`/quizzes/${id}`);
      setQuiz(response.data);
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Failed to load quiz';
      setError(errorMessage);
      Alert.alert('Error', errorMessage, [
        { text: 'Retry', onPress: fetchQuizDetails },
        { text: 'Go Back', onPress: () => router.back() }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const recordExitAttempted = proctoring.recordExitAttempted;
  const handleBackPress = useCallback(() => {
    // Proctored attempts record the exit attempt (informational, plan §14.3);
    // no-op for non-proctored attempts.
    recordExitAttempted();
    Alert.alert(
      'Exit Quiz?',
      'Your progress has been saved. Are you sure you want to exit?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => router.back() }
      ]
    );
  }, [recordExitAttempted, router]);

  // The server rejected a write because the attempt was finalized server-side
  // (duration deadline or quiz window closed while this screen was open /
  // offline). Adopt the server's terminal state: re-sync, then land the
  // student on their result — never leave a dead retry loop on screen.
  const serverFinalizedHandledRef = useRef(false);
  const handleServerFinalized = useCallback(async () => {
    if (serverFinalizedHandledRef.current) return;
    serverFinalizedHandledRef.current = true;
    const attemptId = currentAttempt?.attemptId;
    try {
      if (attemptId) {
        const data = await loadAttempt(attemptId);
        if (data?.status && data.status !== 'in_progress') {
          Alert.alert(
            'Time Over',
            "This quiz's time has ended. Your saved answers have been submitted.",
            [{ text: 'View Results', onPress: () => router.replace(`/quizzes/${id}/result/${attemptId}`) }]
          );
          return;
        }
      }
    } catch (syncError) {
      console.warn('Post-expiry re-sync failed:', syncError);
    }
    Alert.alert(
      'Time Over',
      "This quiz's time has ended. Your saved answers are being submitted.",
      [{ text: 'OK' }]
    );
  }, [currentAttempt?.attemptId, loadAttempt, router, id]);

  // True when a save/submit error means the attempt is FINAL server-side
  // (the whole attempt expired, or the section locked) — not a retryable failure.
  const isFinalRejection = useCallback((error: any) =>
    error?.response?.status === 403 &&
    (error?.response?.data?.errorCode === 'TIME_EXPIRED' ||
      error?.response?.data?.errorCode === 'SECTION_LOCKED'), []);

  const handleResponseChange = useCallback(async (response: StudentResponse) => {
    // Button press animation
    Animated.sequence([
      Animated.timing(buttonScaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(buttonScaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    setSelectedAnswer(response);
    setSaving(true);
    setSaveError(false);

    const timeSpent = Math.floor((Date.now() - questionStartTime) / 1000);
    const questionId = quiz?.questions[currentQuestionIndex]?._id;

    try {
      await saveAnswer(currentQuestionIndex, response, markedForReview, timeSpent, questionId);
      AccessibilityInfo.announceForAccessibility('Response saved');
    } catch (error) {
      if (isFinalRejection(error)) {
        setSaving(false);
        handleServerFinalized();
        return;
      }
      setSaveError(true);
      console.error('Save error:', error);
    } finally {
      setSaving(false);
    }
  }, [currentQuestionIndex, markedForReview, questionStartTime, saveAnswer, quiz, isFinalRejection, handleServerFinalized]);

  const handleMarkForReview = useCallback(async () => {
    const newMarkedState = !markedForReview;
    setMarkedForReview(newMarkedState);

    const timeSpent = Math.floor((Date.now() - questionStartTime) / 1000);
    const questionId = quiz?.questions[currentQuestionIndex]?._id;

    try {
      await saveAnswer(currentQuestionIndex, selectedAnswer, newMarkedState, timeSpent, questionId);
      AccessibilityInfo.announceForAccessibility(
        newMarkedState ? 'Question marked for review' : 'Question unmarked'
      );
    } catch (error) {
      if (isFinalRejection(error)) {
        handleServerFinalized();
        return;
      }
      console.error('Mark error:', error);
    }
  }, [markedForReview, currentQuestionIndex, selectedAnswer, questionStartTime, saveAnswer, quiz, isFinalRejection, handleServerFinalized]);

  const handleNextQuestion = useCallback(async () => {
    const activeIndex = activeQuestionIndexes.indexOf(currentQuestionIndex);
    if (quiz && activeIndex !== -1 && activeIndex < activeQuestionIndexes.length - 1) {
      // Save current progress/time before moving
      const timeSpent = Math.floor((Date.now() - questionStartTime) / 1000);
      const questionId = quiz?.questions[currentQuestionIndex]?._id;
      try {
        await saveAnswer(currentQuestionIndex, selectedAnswer, markedForReview, timeSpent, questionId);
      } catch (err) {
        if (isFinalRejection(err)) {
          handleServerFinalized();
          return;
        }
        console.error('Save failed on skip:', err);
      }

      setCurrentQuestionIndex(activeQuestionIndexes[activeIndex + 1]);
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [quiz, currentQuestionIndex, activeQuestionIndexes, questionStartTime, selectedAnswer, markedForReview, saveAnswer, isFinalRejection, handleServerFinalized]);

  const handlePreviousQuestion = useCallback(async () => {
    const activeIndex = activeQuestionIndexes.indexOf(currentQuestionIndex);
    if (activeIndex > 0) {
      // Save current progress/time before moving
      const timeSpent = Math.floor((Date.now() - questionStartTime) / 1000);
      const questionId = quiz?.questions[currentQuestionIndex]?._id;
      try {
        await saveAnswer(currentQuestionIndex, selectedAnswer, markedForReview, timeSpent, questionId);
      } catch (err) {
        if (isFinalRejection(err)) {
          handleServerFinalized();
          return;
        }
        console.error('Save failed on skip back:', err);
      }

      setCurrentQuestionIndex(activeQuestionIndexes[activeIndex - 1]);
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [currentQuestionIndex, activeQuestionIndexes, questionStartTime, selectedAnswer, markedForReview, saveAnswer, quiz, isFinalRejection, handleServerFinalized]);

  // Helper: find which section a given global question index belongs to
  const getSectionForIndex = useCallback((index: number): string => {
    if (!quiz) return 'All';
    if (!quiz.sections || quiz.sections.length === 0) return 'All';
    const questionId = getQuestionId(quiz.questions[index]);
    for (const section of quiz.sections) {
      const ids = (section.questions || []).map(q => getQuestionId(q));
      if (ids.includes(questionId)) return section.name;
    }
    return 'All';
  }, [quiz]);

  const handleQuestionSelect = useCallback((index: number) => {
    // Section locking: navigation (review-modal grid, tablet sidebar) may
    // only target the active section.
    if (sectionLockOn && !activeQuestionIndexes.includes(index)) return;

    // Sync section so the question is visible
    const targetSection = getSectionForIndex(index);
    setCurrentSection(targetSection);
    setCurrentQuestionIndex(index);
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
  }, [getSectionForIndex, sectionLockOn, activeQuestionIndexes]);

  const handleSubmitQuiz = useCallback(() => {
    setShowReviewModal(true);
  }, []);

  const handleFinalSubmit = useCallback(() => {
    // Section locking: submitting the active section (the final section
    // submits the whole test through the same server path as whole-quiz
    // submit). There is deliberately no "end entire test early" action —
    // students proceed section by section only.
    if (sectionLockOn && activeSectionIndex >= 0) {
      Alert.alert(
        isLastSection ? 'Submit Test' : 'Submit Section',
        isLastSection
          ? 'Are you sure you want to submit? You cannot change your answers after submission.'
          : `Submit "${activeSectionDef?.name ?? 'this section'}"? You cannot return to this section after submitting.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: isLastSection ? 'Submit' : 'Submit Section',
            style: 'destructive',
            onPress: async () => {
              try {
                const result = await submitSection(activeSectionIndex, false);
                setShowReviewModal(false);
                const finalized =
                  result.attemptFinalized === true ||
                  (result.status && result.status !== 'in_progress');
                if (finalized) {
                  router.replace(`/quizzes/${id}/result/${result.attemptId || currentAttempt?.attemptId}`);
                }
                // Otherwise the context adopted the next section's state and
                // the adopt-effect re-centers the UI on it.
              } catch (error) {
                // Context already surfaced manual-submit errors via Alert.
              }
            }
          }
        ]
      );
      return;
    }

    Alert.alert(
      'Submit Quiz',
      'Are you sure you want to submit? You cannot change your answers after submission.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await submitQuiz(false);
              setShowReviewModal(false);
              router.replace(`/quizzes/${id}/result/${result.attemptId || currentAttempt?.attemptId}`);
            } catch (error) {
              Alert.alert('Error', 'Failed to submit quiz. Please try again.');
            }
          }
        }
      ]
    );
  }, [sectionLockOn, activeSectionIndex, isLastSection, activeSectionDef, submitSection, submitQuiz, id, currentAttempt, router]);

  // Section locking: the section timer hit zero — the server is the truth.
  // Submit the section as auto; the response either advances to the next
  // section or finalizes the whole attempt.
  const handleSectionTimeUp = useCallback(async () => {
    if (!sectionLockOn || activeSectionIndex < 0) return;
    try {
      const result = await submitSection(activeSectionIndex, true);
      const finalized =
        result.attemptFinalized === true ||
        (result.status && result.status !== 'in_progress');
      if (finalized) {
        Alert.alert(
          'Time Up!',
          'The test time has ended. Your answers have been submitted.',
          [{
            text: 'View Results',
            onPress: () => router.replace(`/quizzes/${id}/result/${result.attemptId || currentAttempt?.attemptId}`)
          }]
        );
      } else {
        Alert.alert(
          'Section Time Up',
          `"${result.nextSection?.name ?? 'The next section'}" has started. The previous section has been submitted and locked.`,
          [{ text: 'OK' }]
        );
      }
    } catch (error: any) {
      console.error('Section auto-submit error:', error);
      // Most likely the server already advanced the section (deadline passed
      // server-side first). Re-sync and adopt its truth.
      const attemptId = currentAttempt?.attemptId;
      if (attemptId) {
        try {
          const data = await loadAttempt(attemptId);
          if (data?.status && data.status !== 'in_progress') {
            router.replace(`/quizzes/${id}/result/${attemptId}`);
            return;
          }
        } catch (syncError) {
          console.warn('Post-timeout re-sync failed:', syncError);
        }
      }
      Alert.alert(
        'Section Time Up',
        'The section time has ended. Your answers are being submitted.',
        [{ text: 'OK' }]
      );
    }
  }, [sectionLockOn, activeSectionIndex, submitSection, loadAttempt, id, currentAttempt, router]);

  const handleTimeUp = useCallback(async () => {
    try {
      const result = await submitQuiz(true);
      
      // Handle case where quiz was already submitted
      if (result.isAlreadySubmitted) {
        Alert.alert(
          'Already Submitted',
          'This quiz has already been submitted.',
          [{ 
            text: 'View Results', 
            onPress: () => router.replace(`/quizzes/${id}/result/${result.attemptId || currentAttempt?.attemptId}`)
          }]
        );
        return;
      }

      // Successful auto-submit
      Alert.alert(
        'Time Up!',
        'The test duration has ended. Your answers have been submitted.',
        [{ 
          text: 'View Results',
          onPress: () => router.replace(`/quizzes/${id}/result/${result.attemptId || currentAttempt?.attemptId}`)
        }]
      );
    } catch (error: any) {
      console.error('Auto-submit error:', error);
      
      // Show specific error message from backend if available
      const errorMessage = error.response?.data?.message || 'Failed to auto-submit. Please submit manually.';
      const errorCode = error.response?.data?.errorCode;
      
      // Handle specific error cases
      if (errorCode === 'ATTEMPT_NOT_FOUND') {
        Alert.alert(
          'Error',
          'Your quiz attempt could not be found. Your progress may have been lost.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      } else if (errorCode === 'QUIZ_NOT_FOUND') {
        Alert.alert(
          'Error',
          'This quiz no longer exists. Your attempt could not be submitted.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      } else {
        // Generic error - allow manual submission
        Alert.alert(
          'Auto-Submit Failed',
          errorMessage + '\n\nPlease try submitting manually using the Submit button.',
          [{ text: 'OK' }]
        );
      }
    }
  }, [submitQuiz, id, currentAttempt, router]);

  const handleSectionChange = useCallback((section: string) => {
    // Section locking: only the active section is navigable (tabs are
    // disabled too — this guard covers any other trigger path).
    if (sectionLockOn && activeSectionDef && section !== activeSectionDef.name) return;

    setCurrentSection(section);

    if (!quiz) return;
    if (section === 'All') {
      if (currentQuestionIndex < 0 || currentQuestionIndex >= quiz.questions.length) {
        setCurrentQuestionIndex(0);
      }
      return;
    }

    let firstQuestionInSection = -1;
    if (quiz.sections && quiz.sections.length > 0) {
      const sectionIds = new Set(sectionQuestionIdsMap[section] || []);
      firstQuestionInSection = quiz.questions.findIndex(q => sectionIds.has(getQuestionId(q)));
    } else {
      firstQuestionInSection = quiz.questions.findIndex(q => getSubjectName(q) === section);
    }

    if (firstQuestionInSection !== -1) {
      setCurrentQuestionIndex(firstQuestionInSection);
    }
  }, [quiz, getSubjectName, sectionQuestionIdsMap, currentQuestionIndex, sectionLockOn, activeSectionDef]);

  useEffect(() => {
    // Fetch quiz details only on mount/id change
    fetchQuizDetails();
  }, [id]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBackPress();
      return true;
    });

    // Announce screen to screen readers
    AccessibilityInfo.announceForAccessibility('Quiz taking screen loaded');

    // Tab switch detection (Web only)
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        // Log tab switch to backend
        if (currentAttempt?.attemptId) {
          api.post(`/quizzes/${id}/attempt/${currentAttempt.attemptId}/tab-switch`)
            .catch(console.error);
        }

        // Show warning
        Alert.alert(
          '⚠️ Warning',
          'Tab switching is not allowed during the test! This activity has been logged.',
          [{ text: 'OK' }]
        );
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      backHandler.remove();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [currentAttempt, handleBackPress, id]);

  // Loading state
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

  // Error state
  if (error || !quiz || !currentAttempt) {
    return (
      <ScreenContainer style={styles.container}>
        <View style={styles.errorContainer}>
          <AlertCircle color="#EF4444" size={64} />
          <Text style={styles.errorText}>{error || 'Failed to load quiz'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchQuizDetails}>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  const currentQuestion = quiz.questions[currentQuestionIndex];

  // Calculate actual duration based on expiry format
  const getActualDuration = () => {
    if (!quiz || !currentAttempt) return 0;
    
    let defaultDuration = quiz.duration; // in minutes
    
    // If quiz has an expiry date, enforce it as a hard deadline
    if (quiz.expiryDate) {
      const startTime = new Date(currentAttempt.startTime).getTime();
      const expiryTime = new Date(quiz.expiryDate).getTime();
      
      // Calculate how many minutes from startTime until expiryTime
      const maxMinutesAllowed = Math.floor((expiryTime - startTime) / 60000);
      
      // The student gets whichever is shorter: the normal test duration, or the time until it expires
      if (maxMinutesAllowed > 0 && maxMinutesAllowed < defaultDuration) {
        defaultDuration = maxMinutesAllowed;
      }
    }
    
    return defaultDuration;
  };

  return (
    <ScreenContainer style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text
            style={styles.quizTitle}
            numberOfLines={1}
            accessible={true}
            accessibilityLabel={`Quiz: ${quiz.title}`}
          >
            {quiz.title}
          </Text>
          {quiz.expiryDate && (
            <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
              Ends: {formatToIST(quiz.expiryDate)}
            </Text>
          )}
        </View>
        <View style={styles.headerRight}>
          {currentAttempt && sectionLockOn && activeSectionDef && activeSectionState?.startedAt ? (
            <QuizTimer
              duration={activeSectionDef.duration}
              startTime={new Date(activeSectionState.startedAt)}
              deadline={sectionDeadlineMs ?? undefined}
              clockOffsetMs={clockOffsetMs}
              onTimeUp={handleSectionTimeUp}
            />
          ) : currentAttempt && (
            <QuizTimer
              duration={getActualDuration()}
              startTime={currentAttempt.startTime}
              deadline={effectiveDeadlineMs ?? undefined}
              clockOffsetMs={clockOffsetMs}
              onTimeUp={handleTimeUp}
            />
          )}
        </View>
      </View>

      {/* Save Status Indicator */}
      {saving && (
        <View style={styles.savingIndicator}>
          <ActivityIndicator size="small" color="#2563EB" />
          <Text style={styles.savingText}>Saving...</Text>
        </View>
      )}
      {saveError && (
        <View style={styles.errorIndicator}>
          <AlertCircle color="#EF4444" size={16} />
          <Text style={styles.errorIndicatorText}>Save failed - will retry</Text>
        </View>
      )}

      {/* Proctoring: technical-status banner (display only — no policy
          warnings exist in this phase) */}
      {proctoring.active && (
        <ProctoringBanner cameraIssue={proctoring.cameraIssue} warning={proctoring.warning} />
      )}

      {/* Section Tabs */}
      <SectionTabs
        sections={sections}
        currentSection={currentSection}
        onSectionChange={handleSectionChange}
        questionCounts={questionCounts}
        sectionStatuses={sectionStatuses}
      />

      <View style={styles.mainContent}>
        {/* Proctoring: student-visible PiP preview — the same CameraView the
            engine captures from (one camera session, never recorded) */}
        {proctoring.active && (
          <ProctoringCameraPip
            ref={proctoringCameraRef}
            dimmed={proctoring.status !== 'monitoring'}
          />
        )}

        {/* Question Area */}
        <View style={styles.questionAreaWrapper}>
          <ScrollView
            ref={scrollViewRef}
            style={styles.questionArea}
            contentContainerStyle={
              proctoring.active
                ? [styles.questionContentContainer, styles.questionContentContainerProctored]
                : styles.questionContentContainer
            }
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.questionContainer}>
              {/* Question Header */}
              <View style={styles.questionHeader}>
                <Text style={styles.questionNumber}>
                  Question {Math.max(currentQuestionPosition, 0) + 1} of {activeQuestionIndexes.length || quiz.questions.length}
                </Text>
                <View style={styles.badges}>
                  <View style={styles.sectionBadge}>
                    <Text style={styles.badgeText}>{getSubjectName(currentQuestion)}</Text>
                  </View>
                  <View style={styles.marksBadge}>
                    <Text style={styles.badgeText}>{currentQuestion.marks} marks</Text>
                  </View>
                </View>
              </View>

              {/* Question Text */}
              <Text style={styles.questionText}>
                {currentQuestion.question}
              </Text>

              {/* Question Image */}
              {currentQuestion.questionImage && !failedImages.has(currentQuestion.questionImage) && (
                <Image
                  source={getImageUrl(currentQuestion.questionImage)}
                  style={styles.questionImage}
                  resizeMode="contain"
                  onError={() => handleImageError(currentQuestion.questionImage!)}
                />
              )}

              {/* Answer Input (adapts to question type) */}
              <QuestionPrompt
                question={currentQuestion}
                response={selectedAnswer}
                onChange={handleResponseChange}
                getImageUrl={getImageUrl}
                failedImages={failedImages}
                onImageError={handleImageError}
              />

              {/* Clear Response */}
              {isResponseAnswered(currentQuestion.questionType || 'mcq_single', selectedAnswer) && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={() => handleResponseChange(defaultResponseFor(currentQuestion.questionType))}
                >
                  <Text style={styles.clearButtonText}>Clear Response</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Spacer for bottom nav */}
            <View style={{ height: 100 }} />
          </ScrollView>
        </View>

        {/* Navigation Grid (Right Sidebar on tablet) */}
        {showNavigationGrid && SCREEN_WIDTH > 768 && (
          <View style={styles.navigationGridContainer}>
            <QuestionNavigationGrid
              totalQuestions={quiz.questions.length}
              currentQuestion={currentQuestionIndex}
              questionStatuses={questionStatuses}
              onQuestionSelect={handleQuestionSelect}
            />
          </View>
        )}
      </View>

      {/* Bottom Navigation */}
      <View style={styles.bottomNavWrapper}>
        <View style={styles.bottomNav}>
            <TouchableOpacity
              style={[
                styles.navButton,
                styles.markButton,
                markedForReview && styles.markedButton
              ]}
              onPress={handleMarkForReview}
            >
              <Flag
                color={markedForReview ? '#FFFFFF' : '#A855F7'}
                size={20}
                fill={markedForReview ? '#FFFFFF' : 'none'}
              />
            </TouchableOpacity>

            <View style={styles.navButtonGroup}>
              <TouchableOpacity
                style={[styles.navButton, styles.prevButton]}
                onPress={handlePreviousQuestion}
                disabled={currentQuestionPosition <= 0}
              >
                <ChevronLeft color={currentQuestionPosition <= 0 ? '#9CA3AF' : '#2563EB'} size={20} />
                <Text style={[
                  styles.navButtonText,
                  currentQuestionPosition <= 0 && styles.disabledText
                ]}>
                  Prev
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.navButton, styles.nextButton]}
                onPress={handleNextQuestion}
                disabled={currentQuestionPosition === -1 || currentQuestionPosition >= activeQuestionIndexes.length - 1}
              >
                <Text style={[
                  styles.navButtonText,
                  (currentQuestionPosition === -1 || currentQuestionPosition >= activeQuestionIndexes.length - 1) && styles.disabledText
                ]}>
                  Next
                </Text>
                <ChevronRight
                  color={(currentQuestionPosition === -1 || currentQuestionPosition >= activeQuestionIndexes.length - 1) ? '#9CA3AF' : '#2563EB'}
                  size={20}
                />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.navButton, styles.submitButton]}
              onPress={handleSubmitQuiz}
              disabled={quizLoading}
            >
              <Text style={styles.submitButtonText}>
                {sectionLockOn && !isLastSection ? 'Submit Section' : 'Submit'}
              </Text>
            </TouchableOpacity>
          </View>
      </View>

      {/* Review Modal */}
      <Modal
        visible={showReviewModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReviewModal(false)}
      >
        {/* Plain View, not FullScreenContainer: this is a transparent
            bottom-sheet backdrop — the scrim must stay full-bleed rather than
            being inset by safe-area padding. */}
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {sectionLockOn && !isLastSection && activeSectionDef
                  ? `Review: ${activeSectionDef.name}`
                  : 'Review Before Submission'}
              </Text>
              <TouchableOpacity onPress={() => setShowReviewModal(false)}>
                <X color="#4B5563" size={24} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalSummaryBox}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{reviewStats.total}</Text>
                <Text style={styles.summaryLabel}>Total</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: '#10B981' }]}>
                  {reviewStats.answered}
                </Text>
                <Text style={styles.summaryLabel}>Answered</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: '#A855F7' }]}>
                  {reviewStats.marked}
                </Text>
                <Text style={styles.summaryLabel}>Marked</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: '#EF4444' }]}>
                  {reviewStats.unanswered}
                </Text>
                <Text style={styles.summaryLabel}>Unanswered</Text>
              </View>
            </View>

            <Text style={styles.modalSubtitle}>Questions ({reviewStats.total})</Text>
            <ScrollView style={styles.modalQuestionsGrid} showsVerticalScrollIndicator={false}>
              <View style={styles.gridContainer}>
                {reviewIndexes.map((index) => {
                  const status = questionStatuses[index];
                  // Priority: answered+marked = green with purple border, only-marked = purple, answered = green, not visited = white
                  let bgColor = '#FFFFFF';
                  let borderColor = '#D1D5DB';
                  let textColor = '#4B5563';

                  if (status.answered && status.markedForReview) {
                    // Answered AND bookmarked: show green background with purple border
                    bgColor = '#10B981';
                    borderColor = '#A855F7';
                    textColor = '#FFFFFF';
                  } else if (status.answered) {
                    bgColor = '#10B981';
                    borderColor = '#10B981';
                    textColor = '#FFFFFF';
                  } else if (status.markedForReview) {
                    // Only marked (unanswered): purple
                    bgColor = '#A855F7';
                    borderColor = '#A855F7';
                    textColor = '#FFFFFF';
                  }

                  return (
                    <TouchableOpacity
                      key={index}
                      style={[
                        styles.gridItem,
                        { backgroundColor: bgColor, borderColor: borderColor, borderWidth: (status.answered && status.markedForReview) ? 3 : 1 }
                      ]}
                      onPress={() => {
                        handleQuestionSelect(index);
                        setShowReviewModal(false);
                      }}
                    >
                      <Text style={[styles.gridItemText, { color: textColor }]}>
                        {index + 1}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity 
                style={styles.modalReturnBtn}
                onPress={() => setShowReviewModal(false)}
              >
                <Text style={styles.modalReturnBtnText}>Return to Quiz</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalFinalSubmitBtn}
                onPress={handleFinalSubmit}
                disabled={quizLoading}
              >
                {quizLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalFinalSubmitBtnText}>
                    {sectionLockOn && !isLastSection ? 'Submit Section' : 'Final Submit'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

// Wrap with error boundary
export default function QuizTaking() {
  return (
    <ErrorBoundary>
      <QuizTakingContent />
    </ErrorBoundary>
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
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerLeft: {
    flex: 1,
    marginRight: 16,
  },
  quizTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  headerRight: {
    flexShrink: 0,
  },
  savingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EBF5FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#2563EB',
  },
  savingText: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '500',
  },
  errorIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#EF4444',
  },
  errorIndicatorText: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '500',
  },
  mainContent: {
    flex: 1,
    flexDirection: 'row',
  },
  questionAreaWrapper: {
    flex: 1,
  },
  questionArea: {
    flex: 1,
  },
  questionContainer: {
    padding: 20,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  questionNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
  },
  badges: {
    flexDirection: 'row',
    gap: 8,
  },
  sectionBadge: {
    backgroundColor: '#EBF5FF',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  marksBadge: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    color: '#1F2937',
    fontWeight: '500',
  },
  questionText: {
    fontSize: 16,
    color: '#1F2937',
    lineHeight: 24,
    marginBottom: 24,
  },
  optionsContainer: {
    gap: 12,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    minHeight: 56, // Accessibility: minimum touch target
  },
  selectedOption: {
    borderColor: '#2563EB',
    backgroundColor: '#EBF5FF',
  },
  optionRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  selectedRadio: {
    borderColor: '#2563EB',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#2563EB',
  },
  optionContent: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  optionText: {
    flex: 1,
    fontSize: 16,
    color: '#4B5563',
    lineHeight: 22,
  },
  selectedOptionText: {
    color: '#1F2937',
    fontWeight: '500',
  },
  clearButton: {
    marginTop: 16,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 8,
    minHeight: 48, // Accessibility
  },
  clearButtonText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },
  navigationGridContainer: {
    width: 280,
    backgroundColor: '#FFFFFF',
    borderLeftWidth: 1,
    borderLeftColor: '#E5E7EB',
  },
  questionContentContainer: {
    paddingBottom: 20,
  },
  // Clear the question text below the floating PiP camera (proctored only).
  questionContentContainerProctored: {
    paddingTop: 152,
  },
  bottomNavWrapper: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 4,
    minHeight: 44,
  },
  navButtonGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  markButton: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#A855F7',
  },
  markedButton: {
    backgroundColor: '#A855F7',
    borderColor: '#A855F7',
  },
  prevButton: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  nextButton: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  submitButton: {
    backgroundColor: '#10B981',
  },
  navButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
  },
  markedButtonText: {
    color: '#FFFFFF',
  },
  submitButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  disabledText: {
    color: '#9CA3AF',
  },
  questionImage: {
    width: '100%',
    height: 200,
    marginBottom: 20,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  optionImage: {
    width: '100%',
    height: 150,
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '85%',
    padding: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  modalSummaryBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 4,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  modalSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 16,
  },
  modalQuestionsGrid: {
    flex: 1,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingBottom: 24,
  },
  gridItem: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridItemText: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  modalReturnBtn: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  modalReturnBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  modalFinalSubmitBtn: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#10B981',
  },
  modalFinalSubmitBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
