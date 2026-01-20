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
import { X, Check, Square, CheckSquare } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { api } from '@/services/api';

interface Subject {
  _id: string;
  name: string;
  year: string;
  displayOrder: number;
}

interface GroupedSubjects {
  '1st': Subject[];
  '2nd': Subject[];
  '3rd': Subject[];
  '4th': Subject[];
}

interface SubjectSelectionModalProps {
  visible: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  onSave: () => void;
}

export default function SubjectSelectionModal({
  visible,
  onClose,
  studentId,
  studentName,
  onSave
}: SubjectSelectionModalProps) {
  const [subjects, setSubjects] = useState<GroupedSubjects>({
    '1st': [],
    '2nd': [],
    '3rd': [],
    '4th': []
  });
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const modalOpacity = useRef(new Animated.Value(0)).current;
  const modalScale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (visible) {
      fetchSubjects();
      fetchStudentSubjects();
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

  const fetchSubjects = async () => {
    try {
      const response = await api.get('/subjects');
      setSubjects(response.data);
    } catch (error) {
      console.error('Error fetching subjects:', error);
    }
  };

  const fetchStudentSubjects = async () => {
    setIsLoading(true);
    try {
      const response = await api.get(`/student-subjects/${studentId}`);
      if (response.data && response.data.subjects) {
        const subjectIds = response.data.subjects.map((s: Subject) => s._id);
        setSelectedSubjects(new Set(subjectIds));
      }
    } catch (error) {
      console.error('Error fetching student subjects:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSubject = (subjectId: string) => {
    Haptics.selectionAsync();
    setSelectedSubjects(prev => {
      const newSet = new Set(prev);
      if (newSet.has(subjectId)) {
        newSet.delete(subjectId);
      } else {
        newSet.add(subjectId);
      }
      return newSet;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.post(`/student-subjects/${studentId}`, {
        subjectIds: Array.from(selectedSubjects)
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSave();
      onClose();
    } catch (error: any) {
      console.error('Error saving subjects:', error);
      alert(error?.response?.data?.message || 'Failed to save subjects');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  const renderYearSection = (year: string, yearSubjects: Subject[]) => {
    if (yearSubjects.length === 0) return null;

    return (
      <View key={year} style={styles.yearSection}>
        <View style={styles.yearHeader}>
          <View style={styles.yearBadge}>
            <Text style={styles.yearText}>{year}</Text>
          </View>
          <Text style={styles.yearLabel}>Year</Text>
        </View>
        <View style={styles.subjectsGrid}>
          {yearSubjects.map(subject => (
            <TouchableOpacity
              key={subject._id}
              style={[
                styles.subjectCard,
                selectedSubjects.has(subject._id) && styles.subjectCardSelected
              ]}
              onPress={() => toggleSubject(subject._id)}
              activeOpacity={0.7}
            >
              <View style={styles.subjectCardContent}>
                <Text style={[
                  styles.subjectName,
                  selectedSubjects.has(subject._id) && styles.subjectNameSelected
                ]}>
                  {subject.name}
                </Text>
                <View style={styles.checkboxIcon}>
                  {selectedSubjects.has(subject._id) ? (
                    <CheckSquare color="#01b4ae" size={20} />
                  ) : (
                    <Square color="#9CA3AF" size={20} />
                  )}
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
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
              <Text style={styles.title}>Assign Subjects</Text>
              <Text style={styles.subtitle}>{studentName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X color="#6B7280" size={24} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#01b4ae" />
              <Text style={styles.loadingText}>Loading subjects...</Text>
            </View>
          ) : (
            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
              <Text style={styles.instruction}>
                Select subjects for this student. Tap to select/deselect.
              </Text>
              {renderYearSection('1st', subjects['1st'])}
              {renderYearSection('2nd', subjects['2nd'])}
              {renderYearSection('3rd', subjects['3rd'])}
              {renderYearSection('4th', subjects['4th'])}
              
              <View style={styles.selectedCount}>
                <Text style={styles.selectedCountText}>
                  {selectedSubjects.size} subject{selectedSubjects.size !== 1 ? 's' : ''} selected
                </Text>
              </View>
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
              style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={isSaving || isLoading}
            >
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Check color="#FFFFFF" size={18} />
                  <Text style={styles.saveButtonText}>Save</Text>
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
    maxHeight: '95%',
    minHeight: '80%',
    width: '100%',
    maxWidth: 600,
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
  instruction: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 20
  },
  yearSection: {
    marginBottom: 24
  },
  yearHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12
  },
  yearBadge: {
    backgroundColor: '#01b4ae',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8
  },
  yearText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700'
  },
  yearLabel: {
    fontSize: 16,
    color: '#374151',
    fontWeight: '600'
  },
  subjectsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  subjectCard: {
    backgroundColor: '#F9FAFB',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    minWidth: '48%',
    flexGrow: 1
  },
  subjectCardSelected: {
    backgroundColor: '#ECFDF5',
    borderColor: '#01b4ae'
  },
  subjectCardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  subjectName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    flex: 1
  },
  subjectNameSelected: {
    color: '#01b4ae'
  },
  checkboxIcon: {
    marginLeft: 8
  },
  selectedCount: {
    backgroundColor: '#F3F4F6',
    padding: 16,
    borderRadius: 12,
    marginTop: 8,
    marginBottom: 8
  },
  selectedCountText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center'
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
