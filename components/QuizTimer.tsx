import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface QuizTimerProps {
  duration: number; // Duration in minutes
  startTime: Date;
  onTimeUp: () => void;
  isPaused?: boolean;
}

export const QuizTimer: React.FC<QuizTimerProps> = ({ 
  duration, 
  startTime, 
  onTimeUp,
  isPaused = false 
}) => {
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isWarning, setIsWarning] = useState(false);
  const timeUpCalledRef = useRef(false);

  useEffect(() => {
    // Reset the timeUpCalled flag when startTime changes (new attempt)
    timeUpCalledRef.current = false;
  }, [startTime]);

  useEffect(() => {
    const calculateTimeRemaining = () => {
      const now = new Date();
      const elapsed = Math.floor((now.getTime() - new Date(startTime).getTime()) / 1000); // seconds
      const total = duration * 60; // convert minutes to seconds
      const remaining = total - elapsed;

      if (remaining <= 0) {
        // Only call onTimeUp once
        if (!timeUpCalledRef.current) {
          timeUpCalledRef.current = true;
          onTimeUp();
        }
        return 0;
      }

      // Warning at 5 minutes
      if (remaining <= 300 && !isWarning) {
        setIsWarning(true);
      }

      return remaining;
    };

    const timer = setInterval(() => {
      if (!isPaused) {
        const remaining = calculateTimeRemaining();
        setTimeRemaining(remaining);
        
        // Clear interval when time is up to prevent unnecessary ticks
        if (remaining <= 0) {
          clearInterval(timer);
        }
      }
    }, 1000);

    // Initial calculation
    const initial = calculateTimeRemaining();
    setTimeRemaining(initial);
    
    // If already expired on mount, clear immediately
    if (initial <= 0) {
      clearInterval(timer);
    }

    return () => clearInterval(timer);
  }, [duration, startTime, isPaused, isWarning, onTimeUp]);

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <View style={[
      styles.container, 
      isWarning && styles.warningContainer,
      timeRemaining <= 60 && styles.criticalContainer
    ]}>
      <Text style={[
        styles.timerText,
        isWarning && styles.warningText,
        timeRemaining <= 60 && styles.criticalText
      ]}>
        ⏱️ {formatTime(timeRemaining)}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#EBF5FF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  warningContainer: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  criticalContainer: {
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
  },
  timerText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2563EB',
  },
  warningText: {
    color: '#F59E0B',
  },
  criticalText: {
    color: '#EF4444',
  },
});
