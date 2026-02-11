import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { getApiBaseURL } from '@/services/config';

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
  selectedAnswer: number;
  markedForReview: boolean;
  timeSpent: number;
}

interface GuestAttempt {
  attemptId: string;
  shareToken: string;
  quizId: string;
  startTime: Date;
  duration: number;
  answers: GuestAnswer[];
  status: 'in_progress' | 'completed';
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
  startGuestQuiz: (shareToken: string) => Promise<void>;
  saveGuestAnswer: (questionIndex: number, selectedAnswer: number, markedForReview: boolean, timeSpent: number) => Promise<void>;
  submitGuestQuiz: () => Promise<any>;
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

      const attempt: GuestAttempt = {
        attemptId: data.attempt._id,
        shareToken,
        quizId: data.quiz._id,
        startTime: new Date(data.attempt.startTime),
        duration: data.quiz.duration,
        answers: data.attempt.answers || [],
        status: 'in_progress'
      };

      setCurrentAttempt(attempt);
      setQuizData(data.quiz);
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
    selectedAnswer: number,
    markedForReview: boolean = false,
    timeSpent: number = 0
  ) => {
    if (!currentAttempt) return;

    // Update local state immediately using functional updater to avoid stale closure
    setCurrentAttempt(prev => {
      if (!prev) return prev;
      
      const updatedAnswers = [...prev.answers];
      const answerIndex = updatedAnswers.findIndex(a => a.questionIndex === questionIndex);

      const newAnswer = {
        questionIndex,
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
        selectedAnswer,
        markedForReview,
        timeSpent
      };
      
      if (idx !== -1) {
        networkAnswers[idx] = answerData;
      } else {
        networkAnswers.push(answerData);
      }

      await fetch(`${API_URL}/public/quiz/${currentAttempt.shareToken}/save-progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          guestId,
          attemptId: currentAttempt.attemptId,
          answers: networkAnswers
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
