import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { getApiBaseURL } from '@/services/config';
import { StudentResponse } from '@/types/question';

// Get API URL for public endpoints
const API_URL = getApiBaseURL();

// Simple UUID generator for guest ID
const generateUUID = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
interface GuestAnswer {
  questionIndex: number;
  questionId?: string;
  selectedAnswer: StudentResponse;
  markedForReview: boolean;
  timeSpent: number;
}

// Section-locking snapshot shapes (mirror backend models/GuestAttempt.js).
export interface GuestSectionDefinition {
  index: number;
  name: string;
  duration: number; // minutes
  questionIds: string[];
}

export interface GuestSectionState {
  index: number;
  status: 'in_progress' | 'submitted' | 'auto_submitted';
  startedAt?: string;
  endsAt?: string;
  submittedAt?: string;
}

interface GuestAttempt {
  attemptId: string;
  shareToken: string;
  quizId: string;
  startTime: Date;
  duration: number;
  answers: GuestAnswer[];
  status: 'in_progress' | 'completed' | 'auto_submitted';
  sectionLockEnabled?: boolean;
  sectionDefinitions?: GuestSectionDefinition[];
  sectionStates?: GuestSectionState[];
}

interface Quiz {
  _id: string;
  title: string;
  subject: { _id: string; name: string };
  duration: number;
  instructions: string[];
  totalMarks: number;
  questions: any[];
}

interface GuestQuizContextType {
  guestId: string | null;
  currentAttempt: GuestAttempt | null;
  quizData: Quiz | null;
  isLoading: boolean;
  error: string | null;
  fetchQuizByToken: (shareToken: string) => Promise<Quiz | null>;
  startGuestQuiz: (shareToken: string) => Promise<any>;
  saveGuestAnswer: (questionIndex: number, selectedAnswer: StudentResponse, markedForReview: boolean, timeSpent: number, questionId?: string) => Promise<void>;
  submitGuestQuiz: () => Promise<any>;
  submitGuestSection: (sectionIndex: number, isAutoSubmit?: boolean) => Promise<any>;
  resyncGuestProgress: () => Promise<{ finalized: boolean; status?: string }>;
  clearGuestAttempt: () => void;
}

const GuestQuizContext = createContext<GuestQuizContextType | undefined>(undefined);

const GUEST_ID_KEY = '@eyeconic_guest_id';
const GUEST_ATTEMPT_KEY = '@eyeconic_guest_attempt';

export const GuestQuizProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [guestId, setGuestId] = useState<string | null>(null);
  const [currentAttempt, setCurrentAttempt] = useState<GuestAttempt | null>(null);
  const [quizData, setQuizData] = useState<Quiz | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize or retrieve guest ID
  useEffect(() => {
    initializeGuestId();
    loadAttemptFromStorage();
  }, []);

  // Save attempt to storage whenever it changes
  useEffect(() => {
    if (currentAttempt) {
      AsyncStorage.setItem(GUEST_ATTEMPT_KEY, JSON.stringify(currentAttempt));
    }
  }, [currentAttempt]);

  const initializeGuestId = async () => {
    try {
      let storedGuestId = await AsyncStorage.getItem(GUEST_ID_KEY);
      if (!storedGuestId) {
        // Generate a new UUID for this device
        storedGuestId = generateUUID();
        await AsyncStorage.setItem(GUEST_ID_KEY, storedGuestId);
      }
      setGuestId(storedGuestId);
    } catch (err) {
      console.error('Error initializing guest ID:', err);
    }
  };

  const loadAttemptFromStorage = async () => {
    try {
      const stored = await AsyncStorage.getItem(GUEST_ATTEMPT_KEY);
      if (stored) {
        const attempt = JSON.parse(stored);
        setCurrentAttempt(attempt);
      }
    } catch (err) {
      console.error('Error loading guest attempt:', err);
    }
  };

  const fetchQuizByToken = async (shareToken: string): Promise<Quiz | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/public/quiz/${shareToken}`);
      const data = await response.json();

      if (!response.ok) {
        setError(data.message || 'Failed to fetch quiz');
        return null;
      }

      return data.quiz;
    } catch (err) {
      console.error('Fetch quiz error:', err);
      setError('Failed to connect to server');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const startGuestQuiz = async (shareToken: string) => {
    if (!guestId) {
      await initializeGuestId();
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/public/quiz/${shareToken}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          guestId,
          deviceInfo: 'React Native App'
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to start quiz');
      }

      // The attempt ended server-side while the guest was away (section
      // timers kept running). Route to results instead of the taking screen.
      if (data.attemptFinalized) {
        setCurrentAttempt(null);
        await AsyncStorage.removeItem(GUEST_ATTEMPT_KEY);
        return data;
      }

      const attempt: GuestAttempt = {
        attemptId: data.attempt._id,
        shareToken,
        quizId: data.quiz._id,
        startTime: new Date(data.attempt.startTime),
        duration: data.quiz.duration,
        answers: data.attempt.answers || [],
        status: 'in_progress',
        sectionLockEnabled: data.attempt.sectionLockEnabled === true,
        sectionDefinitions: data.attempt.sectionDefinitions,
        sectionStates: data.attempt.sectionStates,
      };

      setCurrentAttempt(attempt);
      setQuizData(data.quiz);
      return data;
    } catch (err: any) {
      console.error('Start guest quiz error:', err);
      setError(err.message || 'Failed to start quiz');
      Alert.alert('Error', err.message || 'Failed to start quiz');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const saveGuestAnswer = async (
    questionIndex: number,
    selectedAnswer: StudentResponse,
    markedForReview: boolean = false,
    timeSpent: number = 0,
    questionId?: string
  ) => {
    if (!currentAttempt) return;

    // Update local state immediately using functional updater to avoid stale closure
    setCurrentAttempt(prev => {
      if (!prev) return prev;
      
      const updatedAnswers = [...prev.answers];
      const answerIndex = updatedAnswers.findIndex(a => a.questionIndex === questionIndex);

      const newAnswer = {
        questionIndex,
        questionId,
        selectedAnswer,
        markedForReview,
        timeSpent
      };

      if (answerIndex !== -1) {
        updatedAnswers[answerIndex] = newAnswer;
      } else {
        updatedAnswers.push(newAnswer);
      }

      return {
        ...prev,
        answers: updatedAnswers
      };
    });

    // Save to server (fire and forget for better UX)
    try {
      // Reconstruct answers for network request to respect scope
      // We use the current snapshot for the network request
      const networkAnswers = [...currentAttempt.answers];
      const idx = networkAnswers.findIndex(a => a.questionIndex === questionIndex);
      const answerData = {
        questionIndex,
        questionId,
        selectedAnswer,
        markedForReview,
        timeSpent
      };
      
      if (idx !== -1) {
        networkAnswers[idx] = answerData;
      } else {
        networkAnswers.push(answerData);
      }

      // Section locking: pre-filter the outgoing snapshot to the active
      // section (the server filters authoritatively as well — this just
      // avoids shipping writes that are guaranteed to be dropped).
      const lockEnforced =
        currentAttempt.sectionLockEnabled === true &&
        (currentAttempt.sectionDefinitions?.length ?? 0) > 0;
      const outboundAnswers = lockEnforced
        ? (() => {
            const qidToSection = new Map<string, number>();
            currentAttempt.sectionDefinitions!.forEach(d => {
              (d.questionIds || []).forEach(qid => qidToSection.set(String(qid), d.index));
            });
            const activeIdx = currentAttempt.sectionStates?.find(s => s.status === 'in_progress')?.index;
            return networkAnswers.filter(a => {
              const qid = a.questionId ? String(a.questionId) : null;
              return qid !== null && qidToSection.get(qid) === activeIdx;
            });
          })()
        : networkAnswers;

      await fetch(`${API_URL}/public/quiz/${currentAttempt.shareToken}/save-progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          guestId,
          attemptId: currentAttempt.attemptId,
          answers: outboundAnswers
        }),
      });
    } catch (err) {
      console.warn('Failed to save progress to server:', err);
      // Continue anyway - we have local state
    }
  };

  const submitGuestQuiz = async () => {
    if (!currentAttempt || !guestId) {
      throw new Error('No active attempt');
    }

    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/public/quiz/${currentAttempt.shareToken}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          guestId,
          attemptId: currentAttempt.attemptId,
          answers: currentAttempt.answers
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to submit quiz');
      }

      // Update status but keep attempt for result page
      setCurrentAttempt({
        ...currentAttempt,
        status: 'completed'
      });

      // Clear from storage
      await AsyncStorage.removeItem(GUEST_ATTEMPT_KEY);

      return data;
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to submit quiz');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Submits a single section of a guest attempt (section locking). Sends the
  // current answers snapshot so the closing section's final answers flush
  // atomically with the section close. Returns the server response: either
  // { nextSection, sectionStates } or the finalize payload.
  const submitGuestSection = async (sectionIndex: number, isAutoSubmit: boolean = false) => {
    if (!currentAttempt || !guestId) {
      throw new Error('No active attempt');
    }

    setIsLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/public/quiz/${currentAttempt.shareToken}/sections/${sectionIndex}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guestId,
            attemptId: currentAttempt.attemptId,
            isAutoSubmit,
            answers: currentAttempt.answers
          }),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to submit section');
      }

      const finalized = data.attemptFinalized === true || data.submitted === true;
      if (finalized) {
        // Whole attempt finished — keep the attempt in memory for the result
        // page, clear persisted state (mirrors submitGuestQuiz).
        setCurrentAttempt({
          ...currentAttempt,
          status: data.status === 'auto_submitted' ? 'auto_submitted' : 'completed'
        });
        await AsyncStorage.removeItem(GUEST_ATTEMPT_KEY);
      } else if (Array.isArray(data.sectionStates)) {
        setCurrentAttempt(prev => (prev ? { ...prev, sectionStates: data.sectionStates } : prev));
      }

      return data;
    } catch (err: any) {
      if (!isAutoSubmit) {
        Alert.alert('Error', err.message || 'Failed to submit section');
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Lightweight server re-sync for the taking screen: pushes the current
  // snapshot through save-progress (which lazily applies section expiries)
  // and reports whether the attempt already ended server-side.
  const resyncGuestProgress = async (): Promise<{ finalized: boolean; status?: string }> => {
    if (!currentAttempt || !guestId) return { finalized: false };
    try {
      const response = await fetch(`${API_URL}/public/quiz/${currentAttempt.shareToken}/save-progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestId,
          attemptId: currentAttempt.attemptId,
          answers: currentAttempt.answers
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        if (data.attemptFinalized) return { finalized: true, status: data.status };
        return { finalized: false };
      }
      // 404 = no in-progress attempt left server-side (already finalized).
      if (response.status === 404) return { finalized: true, status: 'completed' };
      return { finalized: false };
    } catch {
      // Offline / transient — keep local state; the next save or section
      // submit re-syncs anyway.
      return { finalized: false };
    }
  };

  const clearGuestAttempt = () => {
    setCurrentAttempt(null);
    setQuizData(null);
    setError(null);
    AsyncStorage.removeItem(GUEST_ATTEMPT_KEY);
  };

  return (
    <GuestQuizContext.Provider
      value={{
        guestId,
        currentAttempt,
        quizData,
        isLoading,
        error,
        fetchQuizByToken,
        startGuestQuiz,
        saveGuestAnswer,
        submitGuestQuiz,
        submitGuestSection,
        resyncGuestProgress,
        clearGuestAttempt
      }}
    >
      {children}
    </GuestQuizContext.Provider>
  );
};

export const useGuestQuiz = () => {
  const context = useContext(GuestQuizContext);
  if (!context) {
    throw new Error('useGuestQuiz must be used within GuestQuizProvider');
  }
  return context;
};

// Export guest ID getter for login page
export const getGuestId = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(GUEST_ID_KEY);
  } catch {
    return null;
  }
};
