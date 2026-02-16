import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '@/services/api';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface QuizAnswer {
  questionIndex: number;
  selectedAnswer: number;
  markedForReview: boolean;
  timeSpent: number;
}

interface QuizAttempt {
  attemptId: string;
  quizId: string;
  startTime: Date;
  duration: number;
  answers: QuizAnswer[];
  status: 'in_progress' | 'completed' | 'auto_submitted';
}

interface QuizContextType {
  currentAttempt: QuizAttempt | null;
  startQuiz: (quizId: string) => Promise<void>;
  saveAnswer: (questionIndex: number, selectedAnswer: number, markedForReview: boolean, timeSpent: number) => Promise<void>;
  submitQuiz: (isAutoSubmit?: boolean) => Promise<any>;
  loadAttempt: (attemptId: string) => Promise<void>;
  clearAttempt: () => void;
  isLoading: boolean;
}

const QuizContext = createContext<QuizContextType | undefined>(undefined);

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
        setCurrentAttempt(attempt);
      }
    } catch (error) {
      console.error('Error loading attempt from storage:', error);
    }
  };

  const processSaveQueue = async () => {
    if (!currentAttempt || saveQueue.size === 0) return;

    try {
      const updates = Array.from(saveQueue.values());

      // Send all updates to server
      await Promise.all(
        updates.map(answer =>
          api.put(`/quizzes/${currentAttempt.quizId}/attempt/${currentAttempt.attemptId}/answer`, answer)
        )
      );

      // Clear queue after successful save
      setSaveQueue(new Map());
    } catch (error) {
      console.error('Error saving answers:', error);
      // Keep in queue for retry
    }
  };

  const startQuiz = async (quizId: string) => {
    setIsLoading(true);
    try {
      const response = await api.post(`/quizzes/${quizId}/start`);

      const attempt: QuizAttempt = {
        attemptId: response.data.attemptId,
        quizId,
        startTime: new Date(response.data.startTime),
        duration: response.data.duration,
        answers: response.data.answers || [],
        status: 'in_progress'
      };

      setCurrentAttempt(attempt);
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
    selectedAnswer: number,
    markedForReview: boolean = false,
    timeSpent: number = 0
  ) => {
    if (!currentAttempt) return;

    const answerData: QuizAnswer = {
      questionIndex,
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
    } catch (error) {
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
      Alert.alert('Error', error.response?.data?.message || 'Failed to submit quiz');
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const loadAttempt = async (attemptId: string) => {
    setIsLoading(true);
    try {
      // This would be used to resume an in-progress attempt
      // Implementation depends on having an endpoint to fetch attempt details
      const response = await api.get(`/quizzes/attempt/${attemptId}`);
      setCurrentAttempt(response.data);
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
