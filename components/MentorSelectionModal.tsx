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
  Easing
} from 'react-native';
import { X, UserCheck, User as UserIcon } from 'lucide-react-native';
import * as Haptics from '@/utils/haptics';
import { api } from '@/services/api';

interface Mentor {
  _id: string;
  name: string;
  email: string;
  phone?: string;
}

interface MentorAssignment {
  _id: string;
  mentor: Mentor;
  assignedBy: {
    name: string;
    email: string;
  };
  createdAt: string;
}

interface MentorSelectionModalProps {
  visible: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  onSave: (mentor: Mentor) => void;
}

export default function MentorSelectionModal({
  visible,
  onClose,
  studentId,
  studentName,
  onSave
}: MentorSelectionModalProps) {
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [currentAssignment, setCurrentAssignment] = useState<MentorAssignment | null>(null);
  const [selectedMentorId, setSelectedMentorId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const modalOpacity = useRef(new Animated.Value(0)).current;
  const modalScale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (visible) {
      fetchMentors();
      fetchCurrentAssignment();
      animateIn();
    } else {
      animateOut();
    }
  }, [visible]);

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

  const fetchMentors = async () => {
    try {
      const response = await api.get('/users/search?role=mentor');
      setMentors(response.data);
    } catch (error) {
      console.error('Error fetching mentors:', error);
    }
  };

  const fetchCurrentAssignment = async () => {
    setIsLoading(true);
    try {
      const response = await api.get(`/mentor-students/student/${studentId}`);
      if (response.data) {
        setCurrentAssignment(response.data);
        setSelectedMentorId(response.data.mentor._id);
      }
    } catch (error) {
      console.error('Error fetching current assignment:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedMentorId) {
      alert('Please select a mentor');
      return;
    }

    // If same mentor is selected, just close
    if (currentAssignment && currentAssignment.mentor._id === selectedMentorId) {
      onClose();
      return;
    }

    const selectedMentor = mentors.find(m => m._id === selectedMentorId);
    if (!selectedMentor) return;

    setIsSaving(true);
    try {
      await api.post('/mentor-students', {
        mentorId: selectedMentorId,
        studentId
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSave(selectedMentor);
      onClose();
    } catch (error: any) {
      console.error('Error assigning mentor:', error);
      alert(error?.response?.data?.message || 'Failed to assign mentor');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  const selectMentor = (mentorId: string) => {
    Haptics.selectionAsync();
    setSelectedMentorId(mentorId);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.overlay, { opacity: modalOpacity }]}>
        <Animated.View
          style={[
            styles.modalContainer,
            {
              transform: [{ scale: modalScale }]
            }
          ]}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Assign Mentor</Text>
              <Text style={styles.subtitle}>{studentName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X color="#6B7280" size={24} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#01b4ae" />
              <Text style={styles.loadingText}>Loading mentors...</Text>
            </View>
          ) : (
            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
              {currentAssignment && (
                <View style={styles.currentAssignment}>
                  <Text style={styles.currentLabel}>Current Mentor:</Text>
                  <View style={styles.currentMentorCard}>
                    <UserCheck color="#10B981" size={20} />
                    <View style={styles.currentMentorInfo}>
                      <Text style={styles.currentMentorName}>{currentAssignment.mentor.name}</Text>
                      <Text style={styles.currentMentorEmail}>{currentAssignment.mentor.email}</Text>
                    </View>
                  </View>
                </View>
              )}

              <Text style={styles.sectionTitle}>
                {currentAssignment ? 'Select New Mentor' : 'Select Mentor'}
              </Text>

              {mentors.length === 0 ? (
                <View style={styles.emptyState}>
                  <UserIcon color="#9CA3AF" size={48} />
                  <Text style={styles.emptyText}>No mentors available</Text>
                </View>
              ) : (
                <View style={styles.mentorList}>
                  {mentors.map(mentor => (
                    <TouchableOpacity
                      key={mentor._id}
                      style={[
                        styles.mentorCard,
                        selectedMentorId === mentor._id && styles.mentorCardSelected
                      ]}
                      onPress={() => selectMentor(mentor._id)}
                      activeOpacity={0.7}
                    >
                      <View style={[
                        styles.radioCircle,
                        selectedMentorId === mentor._id && styles.radioCircleSelected
                      ]}>
                        {selectedMentorId === mentor._id && (
                          <View style={styles.radioInner} />
                        )}
                      </View>
                      <View style={styles.mentorInfo}>
                        <Text style={[
                          styles.mentorName,
                          selectedMentorId === mentor._id && styles.mentorNameSelected
                        ]}>
                          {mentor.name}
                        </Text>
                        <Text style={styles.mentorEmail}>{mentor.email}</Text>
                        {mentor.phone && (
                          <Text style={styles.mentorPhone}>{mentor.phone}</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </ScrollView>
          )}

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onClose}
              disabled={isSaving}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.saveButton,
                (isSaving || !selectedMentorId) && styles.saveButtonDisabled
              ]}
              onPress={handleSave}
              disabled={isSaving || isLoading || !selectedMentorId}
            >
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <UserCheck color="#FFFFFF" size={18} />
                  <Text style={styles.saveButtonText}>Assign Mentor</Text>
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
    padding: 20
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
    elevation: 10
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6'
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280'
  },
  closeButton: {
    padding: 4
  },
  content: {
    flex: 1,
    padding: 20
  },
  currentAssignment: {
    marginBottom: 24
  },
  currentLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8
  },
  currentMentorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1FAE5'
  },
  currentMentorInfo: {
    flex: 1,
    marginLeft: 12
  },
  currentMentorName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 2
  },
  currentMentorEmail: {
    fontSize: 14,
    color: '#6B7280'
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12
  },
  mentorList: {
    gap: 12
  },
  mentorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB'
  },
  mentorCardSelected: {
    backgroundColor: '#ECFDF5',
    borderColor: '#01b4ae'
  },
  radioCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#9CA3AF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12
  },
  radioCircleSelected: {
    borderColor: '#01b4ae'
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#01b4ae'
  },
  mentorInfo: {
    flex: 1
  },
  mentorName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 2
  },
  mentorNameSelected: {
    color: '#01b4ae'
  },
  mentorEmail: {
    fontSize: 14,
    color: '#6B7280'
  },
  mentorPhone: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 2
  },
  emptyState: {
    alignItems: 'center',
    padding: 40
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280'
  },
  footer: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6'
  },
  cancelButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center'
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151'
  },
  saveButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#01b4ae',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  saveButtonDisabled: {
    opacity: 0.6
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF'
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280'
  }
});
