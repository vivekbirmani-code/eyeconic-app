import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface QuizTimerProps {
  duration: number; // Duration in minutes (fallback when no deadline is known)
  startTime: Date;
  onTimeUp: () => void;
  isPaused?: boolean;
  /**
   * Server-authoritative deadline (epoch ms or Date). When present the
   * countdown is derived from IT instead of startTime + duration: the server
   * computed it and enforces it, so this is display-only truth. Combined
   * with clockOffsetMs, a device clock that drifts or is tampered with
   * cannot extend or shrink the real remaining time.
   */
  deadline?: number | Date;
  /**
   * serverNow - deviceNow captured when the server payload arrived; the
   * countdown estimates server time as Date.now() + clockOffsetMs.
   */
  clockOffsetMs?: number;
}

export const QuizTimer: React.FC<QuizTimerProps> = ({
  duration,
  startTime,
  onTimeUp,
  isPaused = false,
  deadline,
  clockOffsetMs = 0,
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
      // Server-clock estimate: correct the device clock by the offset
      // captured against the server's own "now" when the attempt loaded.
      const nowServerMs = Date.now() + clockOffsetMs;

      let remaining: number;
      const deadlineMs = deadline instanceof Date
        ? deadline.getTime()
        : (deadline !== undefined && deadline !== null ? new Date(deadline).getTime() : NaN);

      if (Number.isFinite(deadlineMs)) {
        remaining = Math.ceil((deadlineMs - nowServerMs) / 1000);
      } else {
        // Legacy path (pre-deadline attempts): device clock vs the
        // server-recorded start time.
        const elapsed = Math.floor((nowServerMs - new Date(startTime).getTime()) / 1000); // seconds
        const total = duration * 60; // convert minutes to seconds
        remaining = total - elapsed;
      }

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
  }, [duration, startTime, isPaused, isWarning, onTimeUp, deadline, clockOffsetMs]);

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
