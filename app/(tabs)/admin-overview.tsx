import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Modal,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import {
  Users,
  UserCheck,
  TrendingUp,
  CheckCircle,
  Clock,
  AlertCircle,
  X,
  BarChart3
} from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from '@/utils/haptics';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { api } from '@/services/api';
import { useAppRefresh } from '@/hooks/useAppRefresh';
import UserAvatar from '@/components/UserAvatar';

interface StudentStat {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  profilePicture?: string | null;
  isProfileComplete?: boolean;
  mentor?: {
    _id: string;
    name: string;
    email: string;
  } | null;
  stats: {
    total: number;
    pending: number;
    completed: number;
    verified: number;
    redo: number;
    completionPercentage: number;
    verificationRate: number;
  };
  lastActivity?: string;
}

interface MentorStat {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  profilePicture?: string | null;
  stats: {
    assignedStudents: number;
    totalAssignments: number;
    verifiedThisWeek: number;
    avgStudentCompletionRate: number;
  };
}

interface MentorDetails {
  mentor: {
    _id: string;
    name: string;
    email: string;
    phone?: string;
  };
  stats: {
    assignedStudents: number;
    totalAssignments: number;
    verifiedThisWeek: number;
    avgStudentCompletionRate: number;
  };
  students: Array<{
    student: {
      _id: string;
      name: string;
      email: string;
      phone?: string;
    };
    subjects: Array<{
      _id: string;
      name: string;
      year: string;
    }>;
    assignments: any[];
    stats: {
      total: number;
      pending: number;
      completed: number;
      verified: number;
      redo: number;
    };
  }>;
}

type TabType = 'students' | 'mentors';

export default function AdminOverview() {
  const { user } = useAuth();
  const { socket } = useNotifications();
  const [activeTab, setActiveTab] = useState<TabType>('students');
  const [students, setStudents] = useState<StudentStat[]>([]);
  const [mentors, setMentors] = useState<MentorStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMentor, setSelectedMentor] = useState<MentorDetails | null>(null);
  const [selectedMentorId, setSelectedMentorId] = useState<string | null>(null);
  const [isMentorDetailsLoading, setIsMentorDetailsLoading] = useState(false);
  const [mentorDetailsError, setMentorDetailsError] = useState<string | null>(null);
  const [showMentorModal, setShowMentorModal] = useState(false);

  const fetchData = useCallback(async () => {
    if (user?.role !== 'admin') return;
    setIsLoading(true);
    try {
      if (activeTab === 'students') {
        const response = await api.get('/admin-overview/students');
        setStudents(response.data);
      } else {
        const response = await api.get('/admin-overview/mentors');
        setMentors(response.data);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user, activeTab]);

  // Refresh on tab focus
  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  // Refresh when app comes to foreground
  useAppRefresh(fetchData);

  // Listen for real-time user_updated events from server
  useEffect(() => {
    if (!socket) return;
    socket.on('user_updated', fetchData);
    socket.on('data_updated', fetchData);
    return () => {
      socket.off('user_updated', fetchData);
      socket.off('data_updated', fetchData);
    };
  }, [socket, fetchData]);

  const fetchMentorDetails = async (mentorId: string) => {
    setSelectedMentorId(mentorId);
    setIsMentorDetailsLoading(true);
    setMentorDetailsError(null);
    setSelectedMentor(null);
    setShowMentorModal(true);

    try {
      const response = await api.get(`/admin-overview/mentor/${mentorId}/details`);
      setSelectedMentor(response.data);
    } catch (error) {
      console.error('Error fetching mentor details:', error);
      setMentorDetailsError('Unable to load mentor details. Please try again.');
    } finally {
      setIsMentorDetailsLoading(false);
    }
  };

  const closeMentorModal = () => {
    setShowMentorModal(false);
    setSelectedMentor(null);
    setSelectedMentorId(null);
    setMentorDetailsError(null);
  };

  const selectedMentorName =
    selectedMentor?.mentor.name ??
    mentors.find((mentor) => mentor._id === selectedMentorId)?.name ??
    'Mentor Details';

  const getProgressColor = (percentage: number) => {
    if (percentage >= 75) return '#10B981';
    if (percentage >= 50) return '#F59E0B';
    return '#EF4444';
  };

  const renderStudentCard = ({ item }: { item: StudentStat }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.studentInfo}>
          <UserAvatar
            name={item.name}
            role="student"
            imageUrl={item.profilePicture}
            size={48}
          />
          <View style={styles.nameContainer}>
            <Text style={styles.cardName}>{item.name}</Text>
            <Text style={styles.cardEmail}>{item.email}</Text>
            {item.mentor && (
              <Text style={styles.mentorText}>Mentor: {item.mentor.name}</Text>
            )}
          </View>
        </View>
        {!item.isProfileComplete && (
          <View style={styles.incompleteBadge}>
            <AlertCircle color="#F59E0B" size={14} />
          </View>
        )}
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{item.stats.total}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color: '#F59E0B' }]}>{item.stats.pending}</Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color: '#10B981' }]}>{item.stats.verified}</Text>
          <Text style={styles.statLabel}>Done</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color: '#EF4444' }]}>{item.stats.redo}</Text>
          <Text style={styles.statLabel}>Redo</Text>
        </View>
      </View>

      <View style={styles.progressSection}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressLabel}>Completion Rate</Text>
          <Text
            style={[
              styles.progressPercent,
              { color: getProgressColor(item.stats.completionPercentage) }
            ]}
          >
            {item.stats.completionPercentage}%
          </Text>
        </View>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${item.stats.completionPercentage}%`,
                backgroundColor: getProgressColor(item.stats.completionPercentage)
              }
            ]}
          />
        </View>
      </View>
    </View>
  );

  const renderMentorCard = ({ item }: { item: MentorStat }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        fetchMentorDetails(item._id);
      }}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.studentInfo}>
          <UserAvatar
            name={item.name}
            role="mentor"
            imageUrl={item.profilePicture}
            size={48}
          />
          <View style={styles.nameContainer}>
            <Text style={styles.cardName}>{item.name}</Text>
            <Text style={styles.cardEmail}>{item.email}</Text>
          </View>
        </View>
        <Text style={styles.viewDetailsText}>View →</Text>
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color: '#2563EB' }]}>
            {item.stats.assignedStudents}
          </Text>
          <Text style={styles.statLabel}>Students</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{item.stats.totalAssignments}</Text>
          <Text style={styles.statLabel}>Tasks</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color: '#10B981' }]}>
            {item.stats.verifiedThisWeek}
          </Text>
          <Text style={styles.statLabel}>This Week</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color: '#01b4ae' }]}>
            {item.stats.avgStudentCompletionRate}%
          </Text>
          <Text style={styles.statLabel}>Avg Rate</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (user?.role !== 'admin') {
    return (
      <ScreenContainer style={styles.container}>
        <Text style={styles.errorText}>Access Denied - Admins Only</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Admin Overview</Text>
          <Text style={styles.headerSubtitle}>Monitor student & mentor performance</Text>
        </View>
        <BarChart3 color="#FFFFFF" size={28} />
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
            Students ({students.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'mentors' && styles.tabActive]}
          onPress={() => {
            setActiveTab('mentors');
            Haptics.selectionAsync();
          }}
        >
          <UserCheck color={activeTab === 'mentors' ? '#01b4ae' : '#6B7280'} size={20} />
          <Text style={[styles.tabText, activeTab === 'mentors' && styles.tabTextActive]}>
            Mentors ({mentors.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#01b4ae" />
            <Text style={styles.loadingText}>Loading data...</Text>
          </View>
        ) : (
          <FlatList
            data={activeTab === 'students' ? students : (mentors as any)}
            renderItem={activeTab === 'students' ? renderStudentCard : (renderMentorCard as any)}
            keyExtractor={item => item._id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                {activeTab === 'students' ? (
                  <Users color="#9CA3AF" size={48} />
                ) : (
                  <UserCheck color="#9CA3AF" size={48} />
                )}
                <Text style={styles.emptyText}>
                  No {activeTab === 'students' ? 'students' : 'mentors'} found
                </Text>
              </View>
            }
          />
        )}
      </View>

      {/* Mentor Details Modal */}
      <Modal
        visible={showMentorModal}
        animationType="slide"
        transparent={true}
        onRequestClose={closeMentorModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.mentorModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedMentorName}</Text>
              <TouchableOpacity onPress={closeMentorModal} style={styles.closeButton}>
                <X color="#6B7280" size={24} />
              </TouchableOpacity>
            </View>

            {isMentorDetailsLoading ? (
              <View style={styles.modalLoadingContainer}>
                <ActivityIndicator size="large" color="#01b4ae" />
                <Text style={styles.loadingText}>Loading mentor details...</Text>
              </View>
            ) : mentorDetailsError ? (
              <View style={styles.modalStateContainer}>
                <AlertCircle color="#EF4444" size={40} />
                <Text style={styles.modalErrorText}>{mentorDetailsError}</Text>
                {selectedMentorId && (
                  <TouchableOpacity
                    style={styles.retryButton}
                    onPress={() => fetchMentorDetails(selectedMentorId)}
                  >
                    <Text style={styles.retryButtonText}>Try Again</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : selectedMentor ? (
              <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
                <View style={styles.mentorInfoSection}>
                  <Text style={styles.mentorInfoEmail}>{selectedMentor.mentor.email}</Text>
                  {selectedMentor.mentor.phone ? (
                    <Text style={styles.mentorInfoPhone}>{selectedMentor.mentor.phone}</Text>
                  ) : null}
                </View>

                <View style={styles.modalStatsGrid}>
                  <View style={styles.modalStatBox}>
                    <Text style={[styles.modalStatValue, { color: '#2563EB' }]}>
                      {selectedMentor.stats.assignedStudents}
                    </Text>
                    <Text style={styles.modalStatLabel}>Students</Text>
                  </View>
                  <View style={styles.modalStatBox}>
                    <Text style={styles.modalStatValue}>
                      {selectedMentor.stats.totalAssignments}
                    </Text>
                    <Text style={styles.modalStatLabel}>Tasks</Text>
                  </View>
                  <View style={styles.modalStatBox}>
                    <Text style={[styles.modalStatValue, { color: '#10B981' }]}>
                      {selectedMentor.stats.verifiedThisWeek}
                    </Text>
                    <Text style={styles.modalStatLabel}>This Week</Text>
                  </View>
                  <View style={styles.modalStatBox}>
                    <Text style={[styles.modalStatValue, { color: '#01b4ae' }]}>
                      {selectedMentor.stats.avgStudentCompletionRate}%
                    </Text>
                    <Text style={styles.modalStatLabel}>Avg Rate</Text>
                  </View>
                </View>

                <Text style={styles.studentsSectionTitle}>
                  Assigned Students ({selectedMentor.stats.assignedStudents})
                </Text>

                {selectedMentor.students.length === 0 ? (
                  <View style={styles.modalEmptyState}>
                    <UserCheck color="#9CA3AF" size={40} />
                    <Text style={styles.modalEmptyText}>
                      No students assigned to this mentor yet.
                    </Text>
                  </View>
                ) : (
                  selectedMentor.students.map((studentData) => (
                    <View key={studentData.student._id} style={styles.studentDetailCard}>
                      <Text style={styles.studentDetailName}>{studentData.student.name}</Text>
                      <Text style={styles.studentDetailEmail}>{studentData.student.email}</Text>

                      {studentData.subjects.length > 0 && (
                        <View style={styles.subjectsSection}>
                          <Text style={styles.sectionLabel}>Subjects:</Text>
                          <View style={styles.subjectTags}>
                            {studentData.subjects.map(subject => (
                              <View key={subject._id} style={styles.subjectTag}>
                                <Text style={styles.subjectTagText}>{subject.name}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      )}

                      <View style={styles.miniStatsGrid}>
                        <View style={styles.miniStat}>
                          <Text style={styles.miniStatValue}>{studentData.stats.total}</Text>
                          <Text style={styles.miniStatLabel}>Total</Text>
                        </View>
                        <View style={styles.miniStat}>
                          <Text style={[styles.miniStatValue, { color: '#F59E0B' }]}>
                            {studentData.stats.pending}
                          </Text>
                          <Text style={styles.miniStatLabel}>Pending</Text>
                        </View>
                        <View style={styles.miniStat}>
                          <Text style={[styles.miniStatValue, { color: '#10B981' }]}>
                            {studentData.stats.verified}
                          </Text>
                          <Text style={styles.miniStatLabel}>Done</Text>
                        </View>
                      </View>

                      {studentData.assignments.length > 0 && (
                        <View style={styles.assignmentsSection}>
                          <Text style={styles.assignmentsSectionTitle}>Recent Assignments:</Text>
                          {studentData.assignments.slice(0, 5).map((assignment: any) => (
                            <View key={assignment._id} style={styles.assignmentItem}>
                              <View style={styles.assignmentHeader}>
                                <Text style={styles.assignmentTitle}>{assignment.title}</Text>
                                <View style={[
                                  styles.assignmentStatusBadge,
                                  {
                                    backgroundColor:
                                      assignment.status === 'verified' ? '#D1FAE5' :
                                        assignment.status === 'completed' ? '#DBEAFE' :
                                          assignment.status === 'redo' ? '#FEF3C7' : '#F3F4F6'
                                  }
                                ]}>
                                  <Text style={[
                                    styles.assignmentStatusText,
                                    {
                                      color:
                                        assignment.status === 'verified' ? '#047857' :
                                          assignment.status === 'completed' ? '#1E40AF' :
                                            assignment.status === 'redo' ? '#92400E' : '#6B7280'
                                    }
                                  ]}>
                                    {assignment.status.toUpperCase()}
                                  </Text>
                                </View>
                              </View>
                              <Text style={styles.assignmentSubject}>
                                {assignment.subject?.name || 'N/A'} • {assignment.taskType}
                              </Text>
                              <Text style={styles.assignmentDate}>
                                Due: {new Date(assignment.scheduledDate).toLocaleDateString()}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  ))
                )}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFCFC',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  content: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  card: {
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  studentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E0F7F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#01b4ae',
  },
  nameContainer: {
    flex: 1,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  cardEmail: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 2,
  },
  mentorText: {
    fontSize: 11,
    color: '#01b4ae',
    fontWeight: '600',
  },
  incompleteBadge: {
    padding: 6,
  },
  viewDetailsText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#01b4ae',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  progressSection: {
    marginTop: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  progressPercent: {
    fontSize: 12,
    fontWeight: '700',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
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
  errorText: {
    fontSize: 18,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 50,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  mentorModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    width: '100%',
    maxWidth: 500,
    maxHeight: '95%',
    minHeight: '85%',
    flex: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  closeButton: {
    padding: 4,
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  modalLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  modalStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  modalErrorText: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
  },
  retryButton: {
    marginTop: 8,
    backgroundColor: '#01b4ae',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  mentorInfoSection: {
    marginBottom: 16,
  },
  mentorInfoEmail: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 4,
  },
  mentorInfoPhone: {
    fontSize: 14,
    color: '#6B7280',
  },
  modalStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  modalStatBox: {
    alignItems: 'center',
    flex: 1,
  },
  modalStatValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  modalStatLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
    textAlign: 'center',
  },
  studentsSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  modalEmptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  modalEmptyText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  studentDetailCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  studentDetailName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  studentDetailEmail: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 12,
  },
  subjectsSection: {
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 6,
  },
  subjectTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  subjectTag: {
    backgroundColor: '#E0F7F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#01b4ae',
  },
  subjectTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#01b4ae',
  },
  miniStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  miniStat: {
    alignItems: 'center',
  },
  miniStatValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  miniStatLabel: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '500',
  },
  assignmentsSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  assignmentsSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 10,
  },
  assignmentItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  assignmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  assignmentTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  assignmentStatusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  assignmentStatusText: {
    fontSize: 9,
    fontWeight: '700',
  },
  assignmentSubject: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 2,
  },
  assignmentDate: {
    fontSize: 10,
    color: '#9CA3AF',
  },
});
