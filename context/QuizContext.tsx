import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '@/services/api';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StudentResponse } from '@/types/question';

interface QuizAnswer {
  questionIndex: number;
  questionId?: string;
  selectedAnswer: StudentResponse;
  markedForReview: boolean;
  timeSpent: number;
}

// Section-locking snapshot shapes (mirror backend models/QuizAttempt.js).
export interface SectionDefinition {
  index: number;
  name: string;
  duration: number; // minutes
  questionIds: string[];
}

export interface SectionState {
  index: number;
  status: 'in_progress' | 'submitted' | 'auto_submitted';
  startedAt?: string;
  endsAt?: string;
  submittedAt?: string;
}

interface QuizAttempt {
  attemptId: string;
  quizId: string;
  startTime: Date;
  duration: number;
  answers: QuizAnswer[];
  status: 'in_progress' | 'completed' | 'auto_submitted';
  sectionLockEnabled?: boolean;
  sectionDefinitions?: SectionDefinition[];
  sectionStates?: SectionState[];
  /**
   * Proctoring session info (Phase 3). Present only for attempts that were
   * proctored at /start (frozen snapshot) — its presence is what arms the
   * monitoring engine on the taking screen. Non-proctored attempts never
   * set it, so their behavior is unchanged.
   */
  proctoringSessionId?: string;
  proctoringPolicy?: Record<string, unknown>;
  /**
   * How this attempt object entered the app session: a direct /start response
   * ('start') or a restore/resync ('resume' — AsyncStorage reload, app
   * relaunch, re-navigation). Drives SESSION_STARTED vs SESSION_RESUMED.
   */
  proctoringArm?: 'start' | 'resume';
}

interface QuizContextType {
  currentAttempt: QuizAttempt | null;
  startQuiz: (quizId: string, options?: { precheckToken?: string }) => Promise<any>;
  saveAnswer: (questionIndex: number, selectedAnswer: StudentResponse, markedForReview: boolean, timeSpent: number, questionId?: string) => Promise<void>;
  submitQuiz: (isAutoSubmit?: boolean) => Promise<any>;
  submitSection: (sectionIndex: number, isAutoSubmit?: boolean) => Promise<any>;
  loadAttempt: (attemptId: string) => Promise<any>;
  clearAttempt: () => void;
  isLoading: boolean;
}

const QuizContext = createContext<QuizContextType | undefined>(undefined);

// True when the server rejected an answer because its section is locked —
// these entries must be dropped (never retried); the section is final.
const isSectionLockedError = (error: any) =>
  error?.response?.status === 403 && error?.response?.data?.errorCode === 'SECTION_LOCKED';

// True when the server rejected the write because the whole attempt was
// already finalized by the server-side duration deadline (Phase 1, plan §7.5
// — e.g. the device clock ran behind the server). Terminal exactly like a
// locked section: the attempt is over, retrying would silently discard the
// student's answers forever.
const isAttemptExpiredError = (error: any) =>
  error?.response?.status === 403 && error?.response?.data?.errorCode === 'TIME_EXPIRED';

const isFinalWriteRejection = (error: any) =>
  isSectionLockedError(error) || isAttemptExpiredError(error);

export const QuizProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentAttempt, setCurrentAttempt] = useState<QuizAttempt | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [saveQueue, setSaveQueue] = useState<Map<number, QuizAnswer>>(new Map());

  // Auto-save every 10 seconds
  useEffect(() => {
    if (currentAttempt && saveQueue.size > 0) {
      const timer = setTimeout(() => {
        processSaveQueue();
      }, 10000);

      return () => clearTimeout(timer);
    }
  }, [saveQueue, currentAttempt]);

  // Save attempt to local storage for offline support
  useEffect(() => {
    if (currentAttempt) {
      AsyncStorage.setItem('currentQuizAttempt', JSON.stringify(currentAttempt));
    }
  }, [currentAttempt]);

  // Load from local storage on mount
  useEffect(() => {
    loadFromStorage();
  }, []);

  const loadFromStorage = async () => {
    try {
      const stored = await AsyncStorage.getItem('currentQuizAttempt');
      if (stored) {
        const attempt = JSON.parse(stored);
        // A storage restore is by definition not the original /start — the
        // proctoring engine arms as resumed (SESSION_RESUMED).
        if (attempt?.proctoringSessionId) attempt.proctoringArm = 'resume';
        setCurrentAttempt(attempt);
      }
    } catch (error) {
      console.error('Error loading attempt from storage:', error);
    }
  };

  const processSaveQueue = async () => {
    if (!currentAttempt || saveQueue.size === 0) return;

    // Settle each answer independently: SECTION_LOCKED entries are dropped
    // (the section is final server-side), network failures stay queued.
    const entries = Array.from(saveQueue.entries());
    const failed: [number, QuizAnswer][] = [];

    await Promise.allSettled(
      entries.map(async ([questionIndex, answer]) => {
        try {
          await api.put(`/quizzes/${currentAttempt.quizId}/attempt/${currentAttempt.attemptId}/answer`, answer);
        } catch (error: any) {
          if (isFinalWriteRejection(error)) {
            setSaveQueue(prevQueue => {
              const newQueue = new Map(prevQueue);
              newQueue.delete(questionIndex);
              return newQueue;
            });
          } else {
            failed.push([questionIndex, answer]);
          }
        }
      })
    );

    if (failed.length === 0) {
      setSaveQueue(new Map());
    } else {
      const retryQueue = new Map(failed);
      setSaveQueue(retryQueue);
    }
  };

  const startQuiz = async (quizId: string, options?: { precheckToken?: string }) => {
    setIsLoading(true);
    try {
      // Proctored quizzes: the precheck attestation token rides along; the
      // server gates the start on consent + this token (Phase 2). Non-proctored
      // quizzes send no token and behave exactly as before.
      const response = await api.post(`/quizzes/${quizId}/start`, {
        ...(options?.precheckToken ? { precheckToken: options.precheckToken } : {}),
      });

      const attempt: QuizAttempt = {
        attemptId: response.data.attemptId,
        quizId,
        startTime: new Date(response.data.startTime),
        duration: response.data.duration,
        answers: response.data.answers || [],
        status: 'in_progress',
        sectionLockEnabled: response.data.sectionLockEnabled === true,
        sectionDefinitions: response.data.sectionDefinitions,
        sectionStates: response.data.sectionStates,
        ...(response.data.proctoringSessionId ? {
          proctoringSessionId: response.data.proctoringSessionId,
          proctoringPolicy: response.data.proctoringPolicy,
          proctoringArm: 'start' as const,
        } : {}),
      };

      setCurrentAttempt(attempt);
      return response.data;
    } catch (error: any) {
      console.error('Start quiz error:', error);
      if (error.response) {
        console.error('Error response:', error.response.data);
        console.error('Error status:', error.response.status);
      }

      const errorMessage = error.response?.data?.message || 'Failed to start quiz';
      const errorTitle = error.response?.status === 403 ? 'Access Denied' : 'Error';

      Alert.alert(errorTitle, errorMessage);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const saveAnswer = async (
    questionIndex: number,
    selectedAnswer: StudentResponse,
    markedForReview: boolean = false,
    timeSpent: number = 0,
    questionId?: string
  ) => {
    if (!currentAttempt) return;

    const answerData: QuizAnswer = {
      questionIndex,
      questionId,
      selectedAnswer,
      markedForReview,
      timeSpent
    };

    // Update local state immediately using functional updater to avoid stale closure
    setCurrentAttempt(prev => {
      if (!prev) return prev;
      const updatedAnswers = [...prev.answers];
      const idx = updatedAnswers.findIndex(a => a.questionIndex === questionIndex);

      if (idx !== -1) {
        updatedAnswers[idx] = answerData;
      } else {
        updatedAnswers.push(answerData);
      }

      return {
        ...prev,
        answers: updatedAnswers
      };
    });

    // Add to save queue using functional updater
    setSaveQueue(prevQueue => {
      const newQueue = new Map(prevQueue);
      newQueue.set(questionIndex, answerData);
      return newQueue;
    });

    // Immediate save for critical actions (not waiting for auto-save)
    try {
      await api.put(
        `/quizzes/${currentAttempt.quizId}/attempt/${currentAttempt.attemptId}/answer`,
        answerData
      );

      // Remove from queue after successful immediate save
      setSaveQueue(prevQueue => {
        const newQueue = new Map(prevQueue);
        newQueue.delete(questionIndex);
        return newQueue;
      });
    } catch (error: any) {
      if (isFinalWriteRejection(error)) {
        // The section was locked server-side (timer expired on another
        // device / while away). Drop the write — it is final.
        setSaveQueue(prevQueue => {
          const newQueue = new Map(prevQueue);
          newQueue.delete(questionIndex);
          return newQueue;
        });
        return;
      }
      console.warn('Immediate save failed, will retry in background:', error);
      // Keep in queue - will be picked up by processSaveQueue
    }
  };

  const submitQuiz = async (isAutoSubmit: boolean = false) => {
    if (!currentAttempt) {
      throw new Error('No active attempt');
    }

    // Process any pending saves
    await processSaveQueue();

    setIsLoading(true);
    try {
      const response = await api.post(
        `/quizzes/${currentAttempt.quizId}/attempt/${currentAttempt.attemptId}/submit`,
        { isAutoSubmit }
      );

      // Clear local storage
      await AsyncStorage.removeItem('currentQuizAttempt');
      setCurrentAttempt(null);

      return response.data;
    } catch (error: any) {
      // Only show alert for manual submission errors
      // Auto-submit errors are handled by the calling component
      if (!isAutoSubmit) {
        const errorMessage = error.response?.data?.message || 'Failed to submit quiz';
        Alert.alert('Error', errorMessage);
      }
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Submits a single section (section locking). Flushes pending saves first
  // so the section's final answers ride along. Returns the server response:
  // either { nextSection, sectionStates } or — for the final section — the
  // standard submit payload (client routes to results exactly like
  // submitQuiz).
  const submitSection = async (sectionIndex: number, isAutoSubmit: boolean = false) => {
    if (!currentAttempt) {
      throw new Error('No active attempt');
    }

    await processSaveQueue();

    setIsLoading(true);
    try {
      const response = await api.post(
        `/quizzes/${currentAttempt.quizId}/attempt/${currentAttempt.attemptId}/sections/${sectionIndex}/submit`,
        { isAutoSubmit }
      );

      const data = response.data;
      const finalized =
        data.attemptFinalized === true ||
        (data.status && data.status !== 'in_progress');

      if (finalized) {
        await AsyncStorage.removeItem('currentQuizAttempt');
        setCurrentAttempt(null);
      } else if (Array.isArray(data.sectionStates)) {
        setCurrentAttempt(prev => (prev ? { ...prev, sectionStates: data.sectionStates } : prev));
      }

      return data;
    } catch (error: any) {
      if (!isAutoSubmit) {
        const errorMessage = error.response?.data?.message || 'Failed to submit section';
        Alert.alert('Error', errorMessage);
      }
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Fetches the authoritative attempt state from the server. The taking
  // screen calls this on mount so refresh / app restart / second device /
  // tampered local state all adopt the server's section progress.
  const loadAttempt = async (attemptId: string) => {
    setIsLoading(true);
    try {
      const response = await api.get(`/quizzes/attempt/${attemptId}`);
      const data = response.data;
      const attempt: QuizAttempt = {
        attemptId: data._id,
        quizId: typeof data.quiz === 'object' ? data.quiz?._id : data.quiz,
        startTime: new Date(data.startTime),
        duration: data.duration ?? 0, // taking screen uses quiz.duration when unset
        answers: data.answers || [],
        status: data.status || 'in_progress',
        sectionLockEnabled: data.sectionLockEnabled === true,
        sectionDefinitions: data.sectionDefinitions,
        sectionStates: data.sectionStates,
        ...(data.proctoringSession?.id ? {
          proctoringSessionId: data.proctoringSession.id,
          proctoringArm: 'resume' as const,
        } : {}),
      };
      setCurrentAttempt(attempt);
      return data;
    } catch (error) {
      console.error('Error loading attempt:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const clearAttempt = () => {
    setCurrentAttempt(null);
    setSaveQueue(new Map());
    AsyncStorage.removeItem('currentQuizAttempt');
  };

  return (
    <QuizContext.Provider
      value={{
        currentAttempt,
        startQuiz,
        saveAnswer,
        submitQuiz,
        submitSection,
        loadAttempt,
        clearAttempt,
        isLoading
      }}
    >
      {children}
    </QuizContext.Provider>
  );
};

export const useQuiz = () => {
  const context = useContext(QuizContext);
  if (!context) {
    throw new Error('useQuiz must be used within QuizProvider');
  }
  return context;
};
