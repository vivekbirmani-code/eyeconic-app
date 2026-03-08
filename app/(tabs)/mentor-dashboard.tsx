import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
  Platform,
  StatusBar,
  FlatList
} from 'react-native';
import {
  Users,
  Plus,
  Calendar,
  CheckCircle,
  Clock,
  BookOpen,
  TrendingUp
} from 'lucide-react-native';
import * as Haptics from '@/utils/haptics';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';

interface Subject {
  _id: string;
  name: string;
  year: string;
}

interface Student {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  subjects: Subject[];
  stats: {
    total: number;
    pending: number;
    completed: number;
    verified: number;
    redo: number;
    completionPercentage: number;
  };
}

interface Assignment {
  _id: string;
  title: string;
  description?: string;
  subject: Subject;
  student: {
    _id: string;
    name: string;
    email: string;
  };
  taskType: string;
  duration: number;
  scheduledDate: string;
  status: 'pending' | 'completed' | 'verified' | 'redo';
  completedAt?: string;
  verifiedAt?: string;
  mentorComment?: string;
  redoReason?: string;
  createdAt: string;
}

type TabType = 'students' | 'create' | 'thisWeek' | 'verify' | 'analytics';

import { useRouter } from 'expo-router';

export default function MentorDashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('students');
  const [students, setStudents] = useState<Student[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Create assignment form state
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskType, setTaskType] = useState('Main Video');
  const [duration, setDuration] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Verification state
  const [pendingVerification, setPendingVerification] = useState<Assignment[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [verifyComment, setVerifyComment] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (user?.role === 'mentor') {
      fetchStudents();
      fetchAssignments();
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === 'verify') {
      fetchPendingVerification();
    }
  }, [activeTab, assignments]);

  const fetchStudents = async () => {
    setIsLoading(true);
    try {
      const response = await api.get(`/assignments/mentor/${user?._id}/students`);
      setStudents(response.data);
    } catch (error) {
      console.error('Error fetching students:', error);
      Alert.alert('Error', 'Failed to fetch students');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAssignments = async () => {
    try {
      const response = await api.get(`/assignments/mentor/${user?._id}`);
      setAssignments(response.data);
    } catch (error) {
      console.error('Error fetching assignments:', error);
    }
  };

  const fetchPendingVerification = () => {
    const pending = assignments.filter(a => a.status === 'completed');
    setPendingVerification(pending);
  };

  const getThisWeekAssignments = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + diffToMonday);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    return assignments.filter(a => {
      const scheduledDate = new Date(a.scheduledDate);
      return scheduledDate >= weekStart && scheduledDate <= weekEnd;
    });
  };

  const createAssignment = async () => {
    if (!selectedStudentId || !selectedSubjectId || !taskTitle || !duration || !scheduledDate) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    setIsCreating(true);
    try {
      await api.post('/assignments', {
        title: taskTitle,
        description: taskDescription,
        subjectId: selectedSubjectId,
        studentId: selectedStudentId,
        taskType,
        duration: parseInt(duration),
        scheduledDate
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Success', 'Assignment created successfully');

      // Reset form
      setTaskTitle('');
      setTaskDescription('');
      setDuration('');
      setScheduledDate('');

      // Refresh data
      fetchAssignments();
      fetchStudents();
    } catch (error: any) {
      console.error('Error creating assignment:', error);
      Alert.alert('Error', error?.response?.data?.message || 'Failed to create assignment');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsCreating(false);
    }
  };

  const verifyAssignment = async (assignmentId: string, action: 'done' | 'redo') => {
    setIsVerifying(true);
    try {
      await api.put(`/assignments/${assignmentId}/verify`, {
        action,
        comment: verifyComment
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Success', action === 'done' ? 'Assignment verified!' : 'Sent back for redo');

      setVerifyComment('');
      setSelectedAssignment(null);
      fetchAssignments();
      fetchStudents();
    } catch (error: any) {
      console.error('Error verifying assignment:', error);
      Alert.alert('Error', error?.response?.data?.message || 'Failed to verify assignment');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsVerifying(false);
    }
  };

  const getSelectedStudent = () => {
    return students.find(s => s._id === selectedStudentId);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'verified': return '#10B981';
      case 'completed': return '#3B82F6';
      case 'redo': return '#F59E0B';
      case 'pending': return '#6B7280';
      default: return '#6B7280';
    }
  };

  const getStatusBgColor = (status: string) => {
    switch (status) {
      case 'verified': return '#D1FAE5';
      case 'completed': return '#DBEAFE';
      case 'redo': return '#FEF3C7';
      case 'pending': return '#F3F4F6';
      default: return '#F3F4F6';
    }
  };

  const renderStudentCard = ({ item }: { item: Student }) => (
    <TouchableOpacity style={styles.studentCard} activeOpacity={0.7}>
      <View style={styles.studentHeader}>
        <View style={styles.studentAvatar}>
          <Text style={styles.studentAvatarText}>
            {item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.studentInfo}>
          <Text style={styles.studentName}>{item.name}</Text>
          <Text style={styles.studentEmail}>{item.email}</Text>
        </View>
      </View>

      <View style={styles.subjectsContainer}>
        <Text style={styles.subjectsLabel}>Subjects:</Text>
        <View style={styles.subjectChips}>
          {item.subjects.length > 0 ? (
            item.subjects.map(subject => (
              <View key={subject._id} style={styles.subjectChip}>
                <Text style={styles.subjectChipText}>{subject.name}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.noSubjects}>No subjects assigned</Text>
          )}
        </View>
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{item.stats.total}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#F59E0B' }]}>{item.stats.pending}</Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#10B981' }]}>{item.stats.verified}</Text>
          <Text style={styles.statLabel}>Verified</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#01b4ae' }]}>{item.stats.completionPercentage}%</Text>
          <Text style={styles.statLabel}>Completion</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderAssignmentCard = ({ item }: { item: Assignment }) => (
    <View style={styles.assignmentCard}>
      <View style={styles.assignmentHeader}>
        <View style={styles.assignmentSubject}>
          <BookOpen color="#01b4ae" size={16} />
          <Text style={styles.assignmentSubjectText}>{item.subject.name}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: getStatusBgColor(item.status) }]}>
          <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
            {item.status.toUpperCase()}
          </Text>
        </View>
      </View>

      <Text style={styles.assignmentTitle}>{item.title}</Text>
      {item.description && (
        <Text style={styles.assignmentDescription}>{item.description}</Text>
      )}

      <View style={styles.assignmentMeta}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Student:</Text>
          <Text style={styles.metaValue}>{item.student.name}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Type:</Text>
          <Text style={styles.metaValue}>{item.taskType}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Duration:</Text>
          <Text style={styles.metaValue}>{item.duration} min</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Scheduled:</Text>
          <Text style={styles.metaValue}>
            {new Date(item.scheduledDate).toLocaleDateString()}
          </Text>
        </View>
      </View>

      {item.status === 'completed' && (
        <View style={styles.verifyActions}>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => {
              setSelectedAssignment(item);
              Alert.alert(
                'Verify Assignment',
                'Mark this assignment as done?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Done',
                    onPress: () => verifyAssignment(item._id, 'done')
                  }
                ]
              );
            }}
          >
            <CheckCircle color="#FFFFFF" size={16} />
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.redoButton}
            onPress={() => {
              setSelectedAssignment(item);
              Alert.prompt(
                'Request Redo',
                'Enter reason for redo (optional):',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Send for Redo',
                    onPress: (reason?: string) => {
                      setVerifyComment(reason || '');
                      verifyAssignment(item._id, 'redo');
                    }
                  }
                ]
              );
            }}
          >
            <Text style={styles.redoButtonText}>Redo</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  if (user?.role !== 'mentor') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Access Denied - Mentors Only</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mentor Dashboard</Text>
        <Text style={styles.headerSubtitle}>Manage your students and assignments</Text>
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'students' && styles.tabActive]}
          onPress={() => {
            setActiveTab('students');
            Haptics.selectionAsync();
          }}
        >
          <Users color={activeTab === 'students' ? '#01b4ae' : '#6B7280'} size={20} />
          <Text style={[styles.tabText, activeTab === 'students' && styles.tabTextActive]}>
            Students
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'create' && styles.tabActive]}
          onPress={() => {
            setActiveTab('create');
            Haptics.selectionAsync();
          }}
        >
          <Plus color={activeTab === 'create' ? '#01b4ae' : '#6B7280'} size={20} />
          <Text style={[styles.tabText, activeTab === 'create' && styles.tabTextActive]}>
            Create
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'thisWeek' && styles.tabActive]}
          onPress={() => {
            setActiveTab('thisWeek');
            Haptics.selectionAsync();
          }}
        >
          <Calendar color={activeTab === 'thisWeek' ? '#01b4ae' : '#6B7280'} size={20} />
          <Text style={[styles.tabText, activeTab === 'thisWeek' && styles.tabTextActive]}>
            This Week
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'verify' && styles.tabActive]}
          onPress={() => {
            setActiveTab('verify');
            Haptics.selectionAsync();
          }}
        >
          <CheckCircle color={activeTab === 'verify' ? '#01b4ae' : '#6B7280'} size={20} />
          <Text style={[styles.tabText, activeTab === 'verify' && styles.tabTextActive]}>
            Verify
          </Text>
          {pendingVerification.length > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{pendingVerification.length}</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tab}
          onPress={() => {
            Haptics.selectionAsync();
            router.push('/quizzes/student-analytics');
          }}
        >
          <TrendingUp color="#6B7280" size={20} />
          <Text style={styles.tabText}>
            Analytics
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tab Content */}
      <View style={styles.content}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#01b4ae" />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        ) : (
          <>
            {/* Students Tab */}
            {activeTab === 'students' && (
              <FlatList
                data={students}
                renderItem={renderStudentCard}
                keyExtractor={item => item._id}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Users color="#9CA3AF" size={48} />
                    <Text style={styles.emptyText}>No students assigned yet</Text>
                    <Text style={styles.emptyHint}>
                      Admin will assign students to you
                    </Text>
                  </View>
                }
              />
            )}

            {/* Create Assignment Tab */}
            {activeTab === 'create' && (
              <ScrollView contentContainerStyle={styles.formContainer}>
                <Text style={styles.formTitle}>Create New Assignment</Text>

                {/* Student Selection */}
                <Text style={styles.label}>Select Student *</Text>
                <View style={styles.pickerContainer}>
                  {students.map(student => (
                    <TouchableOpacity
                      key={student._id}
                      style={[
                        styles.radioOption,
                        selectedStudentId === student._id && styles.radioOptionSelected
                      ]}
                      onPress={() => {
                        setSelectedStudentId(student._id);
                        setSelectedSubjectId(''); // Reset subject when student changes
                        Haptics.selectionAsync();
                      }}
                    >
                      <View style={[
                        styles.radioCircle,
                        selectedStudentId === student._id && styles.radioCircleSelected
                      ]}>
                        {selectedStudentId === student._id && (
                          <View style={styles.radioInner} />
                        )}
                      </View>
                      <Text style={styles.radioLabel}>{student.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Subject Selection */}
                {selectedStudentId && (
                  <>
                    <Text style={styles.label}>Select Subject *</Text>
                    <View style={styles.pickerContainer}>
                      {getSelectedStudent()?.subjects.map(subject => (
                        <TouchableOpacity
                          key={subject._id}
                          style={[
                            styles.radioOption,
                            selectedSubjectId === subject._id && styles.radioOptionSelected
                          ]}
                          onPress={() => {
                            setSelectedSubjectId(subject._id);
                            Haptics.selectionAsync();
                          }}
                        >
                          <View style={[
                            styles.radioCircle,
                            selectedSubjectId === subject._id && styles.radioCircleSelected
                          ]}>
                            {selectedSubjectId === subject._id && (
                              <View style={styles.radioInner} />
                            )}
                          </View>
                          <Text style={styles.radioLabel}>
                            {subject.name} ({subject.year} Year)
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                {/* Task Title */}
                <Text style={styles.label}>Task Title *</Text>
                <TextInput
                  style={styles.input}
                  value={taskTitle}
                  onChangeText={setTaskTitle}
                  placeholder="e.g., Neoplasia: Hallmarks"
                  placeholderTextColor="#9CA3AF"
                />

                {/* Task Description */}
                <Text style={styles.label}>Description (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={taskDescription}
                  onChangeText={setTaskDescription}
                  placeholder="Additional details..."
                  placeholderTextColor="#9CA3AF"
                  multiline
                  numberOfLines={3}
                />

                {/* Task Type */}
                <Text style={styles.label}>Task Type *</Text>
                <View style={styles.radioRow}>
                  {['Main Video', 'Revision 1 (R1)', 'Revision 2 (R2)', 'Revision 3 (R3)', 'Other'].map(type => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.typeChip,
                        taskType === type && styles.typeChipSelected
                      ]}
                      onPress={() => {
                        setTaskType(type);
                        Haptics.selectionAsync();
                      }}
                    >
                      <Text style={[
                        styles.typeChipText,
                        taskType === type && styles.typeChipTextSelected
                      ]}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Duration */}
                <Text style={styles.label}>Duration (minutes) *</Text>
                <TextInput
                  style={styles.input}
                  value={duration}
                  onChangeText={setDuration}
                  placeholder="e.g., 60"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="numeric"
                />

                {/* Scheduled Date */}
                <Text style={styles.label}>Scheduled Date *</Text>
                <TextInput
                  style={styles.input}
                  value={scheduledDate}
                  onChangeText={setScheduledDate}
                  placeholder="YYYY-MM-DD (e.g., 2026-01-21)"
                  placeholderTextColor="#9CA3AF"
                />

                <TouchableOpacity
                  style={[styles.createButton, isCreating && styles.createButtonDisabled]}
                  onPress={createAssignment}
                  disabled={isCreating}
                >
                  {isCreating ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Plus color="#FFFFFF" size={20} />
                      <Text style={styles.createButtonText}>Create Assignment</Text>
                    </>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}

            {/* This Week Tab */}
            {activeTab === 'thisWeek' && (
              <FlatList
                data={getThisWeekAssignments()}
                renderItem={renderAssignmentCard}
                keyExtractor={item => item._id}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Calendar color="#9CA3AF" size={48} />
                    <Text style={styles.emptyText}>No assignments this week</Text>
                  </View>
                }
              />
            )}

            {/* Verification Tab */}
            {activeTab === 'verify' && (
              <FlatList
                data={pendingVerification}
                renderItem={renderAssignmentCard}
                keyExtractor={item => item._id}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <CheckCircle color="#9CA3AF" size={48} />
                    <Text style={styles.emptyText}>No assignments to verify</Text>
                    <Text style={styles.emptyHint}>
                      Completed assignments will appear here
                    </Text>
                  </View>
                }
              />
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFCFC',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  header: {
    backgroundColor: '#01b4ae',
    padding: 20,
    paddingBottom: 24,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#E0F7F6',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingHorizontal: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#01b4ae',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  tabTextActive: {
    color: '#01b4ae',
    fontWeight: '700',
  },
  badge: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  studentCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  studentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  studentAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E0F7F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  studentAvatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#01b4ae',
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  studentEmail: {
    fontSize: 13,
    color: '#6B7280',
  },
  subjectsContainer: {
    marginBottom: 16,
  },
  subjectsLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subjectChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  subjectChip: {
    backgroundColor: '#E0F7F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#01b4ae',
  },
  subjectChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#01b4ae',
  },
  noSubjects: {
    fontSize: 12,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    color: '#6B7280',
  },
  assignmentCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  assignmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  assignmentSubject: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  assignmentSubjectText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#01b4ae',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  assignmentTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  assignmentDescription: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 10,
  },
  assignmentMeta: {
    gap: 6,
  },
  metaItem: {
    flexDirection: 'row',
  },
  metaLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    width: 80,
  },
  metaValue: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '500',
    flex: 1,
  },
  verifyActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  doneButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 8,
    gap: 6,
  },
  doneButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  redoButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 8,
  },
  redoButtonText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
  },
  emptyHint: {
    marginTop: 8,
    fontSize: 13,
    color: '#9CA3AF',
  },
  errorText: {
    fontSize: 18,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 50,
  },
  formContainer: {
    padding: 20,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  pickerContainer: {
    gap: 10,
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    backgroundColor: '#F9FAFB',
  },
  radioOptionSelected: {
    backgroundColor: '#E0F7F6',
    borderColor: '#01b4ae',
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  radioCircleSelected: {
    borderColor: '#01b4ae',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#01b4ae',
  },
  radioLabel: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  radioRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  typeChipSelected: {
    backgroundColor: '#01b4ae',
    borderColor: '#01b4ae',
  },
  typeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  typeChipTextSelected: {
    color: '#FFFFFF',
  },
  createButton: {
    flexDirection: 'row',
    backgroundColor: '#01b4ae',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    gap: 8,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
