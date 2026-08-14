import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Easing,
  Alert,
  Platform,
} from 'react-native';
import { X, UserCheck, User as UserIcon } from 'lucide-react-native';
import * as Haptics from '@/utils/haptics';
import { api } from '@/services/api';

export interface Mentor {
  _id: string;
  name: string;
  email: string;
  phone?: string;
}

interface MentorSelectionModalProps {
  visible: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  onSave: (mentors: Mentor[]) => void;
}

export default function MentorSelectionModal({
  visible,
  onClose,
  studentId,
  studentName,
  onSave,
}: MentorSelectionModalProps) {
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [selectedMentorIds, setSelectedMentorIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const modalOpacity = useRef(new Animated.Value(0)).current;
  const modalScale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (!visible) {
      animateOut();
      return;
    }

    modalOpacity.setValue(0);
    modalScale.setValue(0.9);
    setLoadError(null);
    setSelectedMentorIds([]);
    void loadModalData();
    animateIn();
  }, [visible, studentId]);

  const animateIn = () => {
    Animated.parallel([
      Animated.timing(modalOpacity, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.spring(modalScale, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const animateOut = () => {
    Animated.parallel([
      Animated.timing(modalOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(modalScale, {
        toValue: 0.9,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const loadModalData = async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [mentorsResponse, assignmentResponse] = await Promise.all([
        api.get<Mentor[]>('/users/search?role=mentor'),
        api.get<{ mentors: Mentor[] }>(`/mentor-students/student/${studentId}`),
      ]);

      setMentors(mentorsResponse.data);
      const assignedIds = assignmentResponse.data?.mentors?.map((mentor) => mentor._id) ?? [];
      setSelectedMentorIds(assignedIds);
    } catch (error) {
      console.error('Error loading mentor assignment data:', error);
      setLoadError('Unable to load mentors. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await api.post<{ mentors: Mentor[] }>('/mentor-students', {
        mentorIds: selectedMentorIds,
        studentId,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const assignedMentors = response.data?.mentors ?? mentors.filter((mentor) =>
        selectedMentorIds.includes(mentor._id)
      );
      onSave(assignedMentors);
      onClose();
    } catch (error: unknown) {
      console.error('Error assigning mentors:', error);
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Unable to assign mentor. Please try again.';
      Alert.alert('Assignment Failed', message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleMentor = (mentorId: string) => {
    Haptics.selectionAsync();
    setSelectedMentorIds((prev) =>
      prev.includes(mentorId) ? prev.filter((id) => id !== mentorId) : [...prev, mentorId]
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <Animated.View style={[styles.overlay, { opacity: modalOpacity }]}>
        <Animated.View
          style={[
            styles.modalContainer,
            {
              transform: [{ scale: modalScale }],
            },
          ]}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Assign Mentors</Text>
              <Text style={styles.subtitle}>{studentName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityRole="button">
              <X color="#6B7280" size={24} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#01b4ae" />
              <Text style={styles.loadingText}>Loading mentors...</Text>
            </View>
          ) : loadError ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.errorText}>{loadError}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => void loadModalData()}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionTitle}>Select Mentors</Text>

              {mentors.length === 0 ? (
                <View style={styles.emptyState}>
                  <UserIcon color="#9CA3AF" size={48} />
                  <Text style={styles.emptyText}>No mentors available</Text>
                </View>
              ) : (
                <View style={styles.mentorList}>
                  {mentors.map((mentor) => {
                    const isSelected = selectedMentorIds.includes(mentor._id);
                    return (
                      <TouchableOpacity
                        key={mentor._id}
                        style={[styles.mentorCard, isSelected && styles.mentorCardSelected]}
                        onPress={() => toggleMentor(mentor._id)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.checkboxCircle, isSelected && styles.checkboxCircleSelected]}>
                          {isSelected && <UserCheck color="#FFFFFF" size={14} />}
                        </View>
                        <View style={styles.mentorInfo}>
                          <Text style={[styles.mentorName, isSelected && styles.mentorNameSelected]}>
                            {mentor.name}
                          </Text>
                          <Text style={styles.mentorEmail}>{mentor.email}</Text>
                          {mentor.phone ? <Text style={styles.mentorPhone}>{mentor.phone}</Text> : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          )}

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose} disabled={isSaving}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveButton, (isSaving || isLoading || !!loadError) && styles.saveButtonDisabled]}
              onPress={() => void handleSave()}
              disabled={isSaving || isLoading || !!loadError}
            >
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <UserCheck color="#FFFFFF" size={18} />
                  <Text style={styles.saveButtonText}>Save Assignments</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    maxHeight: '90%',
    minHeight: '70%',
    width: '100%',
    maxWidth: 500,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  mentorList: {
    gap: 12,
  },
  mentorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  mentorCardSelected: {
    backgroundColor: '#ECFDF5',
    borderColor: '#01b4ae',
  },
  checkboxCircle: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#9CA3AF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    backgroundColor: 'transparent',
  },
  checkboxCircleSelected: {
    borderColor: '#01b4ae',
    backgroundColor: '#01b4ae',
  },
  mentorInfo: {
    flex: 1,
  },
  mentorName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 2,
  },
  mentorNameSelected: {
    color: '#01b4ae',
  },
  mentorEmail: {
    fontSize: 14,
    color: '#6B7280',
  },
  mentorPhone: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
  },
  footer: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  cancelButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  saveButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#01b4ae',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
  },
  errorText: {
    fontSize: 14,
    color: '#DC2626',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#01b4ae',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
});
