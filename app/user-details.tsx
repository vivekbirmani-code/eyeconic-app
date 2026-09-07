import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withFeatureGate } from '@/components/withFeatureGate';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  X,
  Mail,
  Shield,
  Calendar,
  Phone,
  Lock,
  Key,
  Users as UsersIcon,
  Pencil,
  Search,
  CheckSquare,
  Square,
} from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from '@/utils/haptics';
import { api } from '@/services/api';
import SubjectSelectionModal from '@/components/SubjectSelectionModal';
import MentorSelectionModal, { type Mentor } from '@/components/MentorSelectionModal';
import UserAvatar from '@/components/UserAvatar';
import { KeyboardAvoidingDialog } from '@/components/KeyboardAvoidingDialog';
import type { User, Subject, GroupAssignment } from '@/types/user';

// Same pattern the backend validates with (utils/otpHelpers.js)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * User Details screen (User Management → tap a user).
 *
 * Implemented as an expo-router transparent-modal screen (not a RN Modal) so
 * it renders in the main window. Under Android edge-to-edge (Expo SDK 54,
 * enforced on Android 15+), RN Modal windows are neither resized by the soft
 * keyboard nor do they receive keyboard events — the keyboard simply covered
 * the Reset Password field and buttons on newer Android devices. In the main
 * window, KeyboardAvoidingView + ScrollView keep the focused input reachable.
 * Visuals (dim + blur + spring card) are identical to the old modal.
 */
function UserDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ user?: string }>();

  const [selectedUser, setSelectedUser] = useState<User | null>(() => {
    try {
      return params.user ? (JSON.parse(params.user) as User) : null;
    } catch {
      return null;
    }
  });
  const [newPassword, setNewPassword] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  // Email correction state
  const [isEditEmailVisible, setIsEditEmailVisible] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);

  // Mentor group management state
  const [isGroupModalVisible, setIsGroupModalVisible] = useState(false);
  const [mentorGroups, setMentorGroups] = useState<GroupAssignment[]>([]);
  const [originalAssignments, setOriginalAssignments] = useState<Set<string>>(new Set());
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [isSavingGroups, setIsSavingGroups] = useState(false);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');

  // Subject and Mentor assignment state
  const [isSubjectModalVisible, setIsSubjectModalVisible] = useState(false);
  const [isMentorModalVisible, setIsMentorModalVisible] = useState(false);
  const [isLoadingMentor, setIsLoadingMentor] = useState(false);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

  // Modal animation values
  const modalOpacity = useRef(new Animated.Value(0)).current;
  const modalTranslateY = useRef(new Animated.Value(30)).current;
  const modalScale = useRef(new Animated.Value(0.95)).current;
  // Guards against a double tap firing router.back() twice.
  const isClosingRef = useRef(false);

  // Deep link / missing param guard: leave the way we came in.
  useEffect(() => {
    if (!selectedUser) {
      router.back();
    }
  }, [selectedUser, router]);

  const fetchMentorDetails = async (studentId: string) => {
    setIsLoadingMentor(true);
    try {
      const response = await api.get<{ mentors: Mentor[] }>(`/mentor-students/student/${studentId}`);
      const mentors = response.data?.mentors ?? [];
      setSelectedUser(prev => (prev && prev._id === studentId ? { ...prev, assignedMentors: mentors } : prev));
    } catch (error) {
      console.error('Error fetching mentor details:', error);
      Alert.alert('Error', 'Unable to load assigned mentors. Please try again.');
    } finally {
      setIsLoadingMentor(false);
    }
  };

  const fetchStudentSubjects = async (studentId: string) => {
    setIsLoadingSubjects(true);
    try {
      const response = await api.get(`/student-subjects/${studentId}`);
      if (response.data && response.data.subjects) {
        // Verify we have an array
        const subjects = Array.isArray(response.data.subjects) ? response.data.subjects : [];
        setSelectedUser(prev => (prev && prev._id === studentId ? { ...prev, assignedSubjects: subjects } : prev));
      } else {
        setSelectedUser(prev => (prev && prev._id === studentId ? { ...prev, assignedSubjects: [] } : prev));
      }
    } catch (error) {
      console.error('Error fetching student subjects:', error);
    } finally {
      setIsLoadingSubjects(false);
    }
  };

  // Open animation + dependent-data load (was openUserDetails in users.tsx)
  useEffect(() => {
    if (!selectedUser) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    Animated.parallel([
      Animated.timing(modalOpacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(modalTranslateY, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(modalScale, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    if (selectedUser.role === 'student') {
      fetchMentorDetails(selectedUser._id);
      fetchStudentSubjects(selectedUser._id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeDetail = () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setIsMentorModalVisible(false);
    setIsSubjectModalVisible(false);
    closeEditEmailDialog();
    Keyboard.dismiss();
    // Animate out, then pop the route (users list refreshes on tab focus)
    Animated.parallel([
      Animated.timing(modalOpacity, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(modalTranslateY, {
        toValue: 30,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(modalScale, {
        toValue: 0.95,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => router.back());
  };

  const resetPassword = async () => {
    if (!selectedUser) return;

    if (!newPassword || newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    setIsResettingPassword(true);
    try {
      await api.post(`/users/${selectedUser._id}/reset-password`, { newPassword });
      Alert.alert('Success', 'Password reset successfully');
      setNewPassword('');
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to reset password';
      Alert.alert('Error', message);
    } finally {
      setIsResettingPassword(false);
    }
  };

  const openEditEmailDialog = () => {
    if (!selectedUser) return;
    // Prefill with the current email so a typo can be fixed in place
    setNewEmail(selectedUser.email);
    setEmailError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss();
    setIsEditEmailVisible(true);
  };

  const closeEditEmailDialog = () => {
    if (isUpdatingEmail) return;
    setIsEditEmailVisible(false);
    setEmailError(null);
  };

  const updateEmail = async () => {
    if (!selectedUser || isUpdatingEmail) return;

    const trimmedEmail = newEmail.trim().toLowerCase();
    if (!trimmedEmail) {
      setEmailError('Email is required');
      return;
    }
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setEmailError('Please enter a valid email address');
      return;
    }
    if (trimmedEmail === selectedUser.email.toLowerCase()) {
      setEmailError('This is already the current email');
      return;
    }

    setIsUpdatingEmail(true);
    setEmailError(null);
    try {
      const response = await api.put(`/users/${selectedUser._id}/email`, { email: trimmedEmail });
      const updatedEmail = response.data?.email ?? trimmedEmail;

      // Reflect the new email immediately (the users list refreshes on focus)
      setSelectedUser(prev => (prev && prev._id === selectedUser._id ? { ...prev, email: updatedEmail } : prev));

      setIsEditEmailVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Success', 'Email updated successfully');
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to update email';
      setEmailError(message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  const handleToggleUserTier = async () => {
    if (!selectedUser) return;

    const newIsFreeUser = !selectedUser.isFreeUser;
    const tierText = newIsFreeUser ? 'Free' : 'Paid';

    Alert.alert(
      'Confirm Tier Change',
      `Are you sure you want to convert this student to a ${tierText} User?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Convert',
          onPress: async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            try {
              const response = await api.put(`/users/${selectedUser._id}`, {
                isFreeUser: newIsFreeUser
              });

              const updatedUser = response.data;
              setSelectedUser(prev => prev ? { ...prev, isFreeUser: updatedUser.isFreeUser } : null);

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert('Success', `Student converted to ${tierText} User successfully.`);
            } catch (error: any) {
              const message = error?.response?.data?.message || 'Failed to update user tier';
              Alert.alert('Error', message);
            }
          }
        }
      ]
    );
  };

  const openMentorAssignmentModal = useCallback(() => {
    if (!selectedUser || selectedUser.role !== 'student') {
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsMentorModalVisible(true);
  }, [selectedUser]);

  const handleMentorModalClose = useCallback(() => {
    setIsMentorModalVisible(false);
  }, []);

  const handleMentorSave = useCallback(async (assignedMentors: Mentor[]) => {
    if (!selectedUser) {
      return;
    }

    const studentId = selectedUser._id;
    setSelectedUser(prev => (prev && prev._id === studentId ? { ...prev, assignedMentors } : prev));
    await fetchMentorDetails(studentId);

    const mentorCount = assignedMentors.length;
    Alert.alert(
      'Success',
      mentorCount > 0
        ? `${mentorCount} mentor${mentorCount === 1 ? '' : 's'} assigned successfully.`
        : 'All mentor assignments have been removed.'
    );
  }, [selectedUser]);

  const handleSaveSubjects = async (subjects: Subject[]) => {
    // 1. Optimistic update
    setSelectedUser(prev => prev ? { ...prev, assignedSubjects: subjects } : null);

    if (!selectedUser) return;

    // 2. Perform Save
    const subjectIds = subjects.map(s => s._id);
    try {
      await api.post(`/student-subjects/${selectedUser._id}`, {
        subjectIds
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // 3. Silent Refetch (Source of Truth)
      await fetchStudentSubjects(selectedUser._id);

    } catch (error: any) {
      console.error('Error saving subjects:', error);
      // Alert.alert (not alert): the web-only global throws a ReferenceError
      // on React Native, which would silently swallow save failures.
      Alert.alert('Error', error?.response?.data?.message || 'Failed to save subjects');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      // On error, revert to server state (which might be empty or old, but better than broken optimistic state)
      fetchStudentSubjects(selectedUser._id);
    }
  };

  const fetchMentorGroups = async (mentorId: string) => {
    setIsLoadingGroups(true);
    try {
      const response = await api.get(`/groups/mentor/${mentorId}/assignments`);
      setMentorGroups(response.data);
      // Store original assignments to track changes
      const assigned = new Set<string>(response.data.filter((g: GroupAssignment) => g.isAssigned).map((g: GroupAssignment) => g._id));
      setOriginalAssignments(assigned);
    } catch (error: any) {
      Alert.alert('Error', 'Failed to fetch group assignments');
    } finally {
      setIsLoadingGroups(false);
    }
  };

  const toggleGroupAssignment = (groupId: string) => {
    setMentorGroups(prev => prev.map(g =>
      g._id === groupId ? { ...g, isAssigned: !g.isAssigned } : g
    ));
  };

  const saveMentorGroups = async () => {
    if (!selectedUser) return;

    setIsSavingGroups(true);
    try {
      const currentAssignments = new Set(mentorGroups.filter(g => g.isAssigned).map(g => g._id));

      // Find groups to add (in current but not in original)
      const addToGroups = [...currentAssignments].filter(id => !originalAssignments.has(id));

      // Find groups to remove (in original but not in current)
      const removeFromGroups = [...originalAssignments].filter(id => !currentAssignments.has(id));

      if (addToGroups.length === 0 && removeFromGroups.length === 0) {
        setIsGroupModalVisible(false);
        return;
      }

      await api.post('/groups/bulk-mentor-assignment', {
        mentorId: selectedUser._id,
        addToGroups,
        removeFromGroups
      });

      Alert.alert('Success', 'Group assignments updated successfully');
      setOriginalAssignments(currentAssignments);
      setIsGroupModalVisible(false);
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to update group assignments';
      Alert.alert('Error', message);
    } finally {
      setIsSavingGroups(false);
    }
  };

  const openGroupManagement = () => {
    if (!selectedUser) return;
    setGroupSearchQuery('');
    fetchMentorGroups(selectedUser._id);
    setIsGroupModalVisible(true);
  };

  const filteredMentorGroups = useMemo(() => {
    if (!groupSearchQuery) return mentorGroups;
    return mentorGroups.filter(g =>
      g.name.toLowerCase().includes(groupSearchQuery.toLowerCase())
    );
  }, [mentorGroups, groupSearchQuery]);

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return '#EF4444';
      case 'mentor': return '#10B981';
      case 'student': return '#2563EB';
      default: return '#6B7280';
    }
  };

  const getRoleBgColor = (role: string) => {
    switch (role) {
      case 'admin': return '#FEE2E2';
      case 'mentor': return '#D1FAE5';
      case 'student': return '#DBEAFE';
      default: return '#F3F4F6';
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (!selectedUser) {
    return <View style={styles.screenRoot} />;
  }

  return (
    <View style={styles.screenRoot}>
      <Animated.View style={[styles.detailOverlay, { opacity: modalOpacity }]}>
        <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
        {/* KeyboardAvoidingView (main window → keyboard events fire on every
            Android version) shrinks the card area while the keyboard is open;
            the ScrollView then scrolls the focused field into view. */}
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.detailAvoid}
        >
          <Animated.View
            style={[
              styles.detailModal,
              {
                transform: [
                  { translateY: modalTranslateY },
                  { scale: modalScale }
                ],
              }
            ]}
          >
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>User Details</Text>
              <TouchableOpacity onPress={closeDetail}>
                <X color="#6B7280" size={24} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.detailScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
            >
              <View style={styles.detailContent}>
                {/* Avatar */}
                <View style={styles.avatarContainer}>
                  <UserAvatar
                    name={selectedUser.name}
                    role={selectedUser.role}
                    imageUrl={selectedUser.profilePicture}
                    size={96}
                  />
                  <Text style={styles.detailName}>{selectedUser.name}</Text>
                  <View style={[styles.roleBadgeLarge, { backgroundColor: getRoleBgColor(selectedUser.role) }]}>
                    <Text style={[styles.roleBadgeText, { color: getRoleColor(selectedUser.role) }]}>
                      {selectedUser.role.toUpperCase()}
                    </Text>
                  </View>
                </View>

                {/* Info Rows */}
                <View style={styles.infoSection}>
                  <View style={styles.infoRow}>
                    <Mail color="#6B7280" size={20} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Email</Text>
                      <Text style={styles.infoValue}>{selectedUser.email}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.editEmailButton}
                      onPress={openEditEmailDialog}
                      activeOpacity={0.85}
                      accessibilityLabel="Edit email"
                      accessibilityHint="Correct the email address of this user"
                    >
                      <Pencil color="#FFFFFF" size={14} />
                      <Text style={styles.editEmailButtonText}>Edit</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.infoRow}>
                    <Phone color="#6B7280" size={20} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Phone</Text>
                      <Text style={styles.infoValue}>
                        {selectedUser.phone || 'Not provided'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.infoRow}>
                    <Shield color="#6B7280" size={20} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Account Status</Text>
                      <Text style={[styles.infoValue, { color: '#10B981' }]}>Active</Text>
                    </View>
                  </View>

                  <View style={styles.infoRow}>
                    <Calendar color="#6B7280" size={20} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Created</Text>
                      <Text style={styles.infoValue}>{formatDate(selectedUser.createdAt)}</Text>
                    </View>
                  </View>

                  {selectedUser.role === 'student' && (
                    <View style={styles.infoRow}>
                      <UsersIcon color="#6B7280" size={20} />
                      <View style={styles.infoContent}>
                        <Text style={styles.infoLabel}>Student Tier</Text>
                        <Text style={[styles.infoValue, { fontWeight: 'bold', color: selectedUser.isFreeUser ? '#D97706' : '#059669' }]}>
                          {selectedUser.isFreeUser ? 'Free User' : 'Paid User'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.tierButton,
                          selectedUser.isFreeUser ? styles.tierButtonFree : styles.tierButtonPaid,
                        ]}
                        onPress={handleToggleUserTier}
                        activeOpacity={0.85}
                        accessibilityLabel={selectedUser.isFreeUser ? 'Convert student to Paid User' : 'Convert student to Free User'}
                      >
                        <Text style={styles.tierButtonText}>
                          {selectedUser.isFreeUser ? 'Make Paid' : 'Make Free'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* Student Profile Details - Only shown for students */}
                {selectedUser.role === 'student' && !selectedUser.isFreeUser && (
                  <View style={styles.studentProfileSection}>
                    <Text style={styles.studentProfileTitle}>
                      Student Profile {selectedUser.isProfileComplete === false && '(Incomplete)'}
                    </Text>

                    {selectedUser.isProfileComplete ? (
                      <View style={styles.profileGrid}>
                        <View style={styles.profileRow}>
                          <Text style={styles.profileLabel}>MBBS Batch:</Text>
                          <Text style={styles.profileValue}>{selectedUser.studentProfile?.mbbsBatch || 'N/A'}</Text>
                        </View>
                        <View style={styles.profileRow}>
                          <Text style={styles.profileLabel}>College:</Text>
                          <Text style={styles.profileValue}>{selectedUser.studentProfile?.collegeName || 'N/A'}</Text>
                        </View>
                        <View style={styles.profileRow}>
                          <Text style={styles.profileLabel}>Batch Type:</Text>
                          <Text style={styles.profileValue}>{selectedUser.studentProfile?.batchType || 'N/A'}</Text>
                        </View>
                        <View style={styles.profileRow}>
                          <Text style={styles.profileLabel}>Attempt No:</Text>
                          <Text style={styles.profileValue}>{selectedUser.studentProfile?.attemptNo || 'N/A'}</Text>
                        </View>
                        <View style={styles.profileRow}>
                          <Text style={styles.profileLabel}>Grand Tests Given:</Text>
                          <Text style={styles.profileValue}>{selectedUser.studentProfile?.grandTestsGiven || 'N/A'}</Text>
                        </View>
                        <View style={styles.profileRow}>
                          <Text style={styles.profileLabel}>Avg Corrects:</Text>
                          <Text style={styles.profileValue}>{selectedUser.studentProfile?.averageCorrects || 'N/A'}</Text>
                        </View>
                        <View style={styles.profileRow}>
                          <Text style={styles.profileLabel}>Avg Score:</Text>
                          <Text style={styles.profileValue}>{selectedUser.studentProfile?.averageScore || 'N/A'}</Text>
                        </View>
                        <View style={styles.profileRow}>
                          <Text style={styles.profileLabel}>Weakest Subjects:</Text>
                          <Text style={styles.profileValue}>{selectedUser.studentProfile?.weakestSubjects || 'N/A'}</Text>
                        </View>
                        <View style={styles.profileRow}>
                          <Text style={styles.profileLabel}>Target Branch:</Text>
                          <Text style={styles.profileValue}>{selectedUser.studentProfile?.targetBranch || 'N/A'}</Text>
                        </View>
                        <View style={styles.profileRow}>
                          <Text style={styles.profileLabel}>Subscriptions:</Text>
                          <Text style={styles.profileValue}>{selectedUser.studentProfile?.subscriptions || 'N/A'}</Text>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.profileIncompleteMessage}>
                        <Text style={styles.profileIncompleteText}>
                          This student has not completed their profile yet.
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Subject and Mentor Assignment - Only shown for students */}
                {selectedUser.role === 'student' && !selectedUser.isFreeUser && (
                  <>
                    {/* Subject Assignment Section */}
                    <View style={styles.assignmentSection}>
                      <View style={styles.assignmentHeader}>
                        <Text style={styles.assignmentTitle}>Assigned Subjects</Text>
                        <TouchableOpacity
                          style={styles.assignButton}
                          onPress={() => setIsSubjectModalVisible(true)}
                        >
                          <Text style={styles.assignButtonText}>Manage Subjects</Text>
                        </TouchableOpacity>
                      </View>

                      {isLoadingSubjects && !selectedUser.assignedSubjects ? (
                        <View style={styles.mentorLoadingContainer}>
                          <ActivityIndicator size="small" color="#01b4ae" />
                          <Text style={styles.mentorLoadingText}>Loading subjects...</Text>
                        </View>
                      ) : selectedUser.assignedSubjects && selectedUser.assignedSubjects.length > 0 ? (
                        <View style={styles.assignedSubjectsList}>
                          {selectedUser.assignedSubjects.map((subject, index) => (
                            <View key={subject._id || index} style={styles.assignedSubjectChip}>
                              <Text style={styles.assignedSubjectText}>{subject.name}</Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.assignmentHint}>
                          No subjects assigned yet.
                        </Text>
                      )}
                    </View>

                    {/* Mentor Assignment Section */}
                    <View style={styles.assignmentSection}>
                      <View style={styles.assignmentHeader}>
                        <Text style={styles.assignmentTitle}>Assigned Mentors</Text>
                        <TouchableOpacity
                          style={styles.assignButton}
                          onPress={openMentorAssignmentModal}
                        >
                          <Text style={styles.assignButtonText}>Manage Mentors</Text>
                        </TouchableOpacity>
                      </View>

                      {isLoadingMentor && (!selectedUser.assignedMentors || selectedUser.assignedMentors.length === 0) ? (
                        <View style={styles.mentorLoadingContainer}>
                          <ActivityIndicator size="small" color="#01b4ae" />
                          <Text style={styles.mentorLoadingText}>Loading mentors...</Text>
                        </View>
                      ) : selectedUser.assignedMentors && selectedUser.assignedMentors.length > 0 ? (
                        <View style={{ gap: 8 }}>
                          {selectedUser.assignedMentors.map((mentor) => (
                            <View key={mentor._id} style={styles.assignedMentorCard}>
                              <View style={styles.assignedMentorAvatar}>
                                <Text style={{ color: '#01b4ae', fontWeight: 'bold' }}>
                                  {mentor.name.charAt(0).toUpperCase()}
                                </Text>
                              </View>
                              <View style={styles.assignedMentorInfo}>
                                <Text style={styles.assignedMentorName}>{mentor.name}</Text>
                                <Text style={styles.assignedMentorEmail}>{mentor.email}</Text>
                                {mentor.phone && (
                                  <Text style={styles.assignedMentorPhone}>{mentor.phone}</Text>
                                )}
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <View style={styles.emptyMentorState}>
                          <Text style={styles.emptyMentorText}>No mentors assigned</Text>
                          <TouchableOpacity
                            style={styles.assignLink}
                            onPress={openMentorAssignmentModal}
                          >
                            <Text style={styles.assignLinkText}>Assign Now</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </>
                )}

                {/* Mentor Group Management Section */}
                {selectedUser.role === 'mentor' && (
                  <View style={styles.mentorGroupSection}>
                    <Text style={styles.mentorGroupTitle}>Group Assignments</Text>
                    <TouchableOpacity
                      style={styles.manageGroupsButton}
                      onPress={openGroupManagement}
                    >
                      <UsersIcon color="#FFFFFF" size={18} />
                      <Text style={styles.manageGroupsButtonText}>Manage Groups</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Reset Password Section */}
                <View style={styles.resetSection}>
                  <Text style={styles.resetTitle}>Reset Password</Text>
                  <View style={styles.resetInputRow}>
                    <Key color="#6B7280" size={20} />
                    <TextInput
                      style={styles.resetInput}
                      placeholder="New password (min 6 chars)"
                      placeholderTextColor="#9CA3AF"
                      value={newPassword}
                      onChangeText={setNewPassword}
                      secureTextEntry
                      autoComplete="new-password"
                    />
                  </View>
                  <TouchableOpacity
                    style={[styles.resetButton, isResettingPassword && styles.resetButtonDisabled]}
                    onPress={resetPassword}
                    disabled={isResettingPassword}
                  >
                    <Lock color="#FFFFFF" size={16} />
                    <Text style={styles.resetButtonText}>
                      {isResettingPassword ? 'Resetting...' : 'Reset Password'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={closeDetail}
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>

      {/* Edit Email dialog — in-tree (KeyboardAvoidingDialog) so it also gets
          keyboard avoidance; layered above the detail card via elevation. */}
      <KeyboardAvoidingDialog
        visible={isEditEmailVisible}
        onClose={closeEditEmailDialog}
        animationType="none"
        cardStyle={styles.editEmailModal}
      >
        <View style={styles.detailHeader}>
          <Text style={styles.detailTitle}>Edit Email</Text>
          <TouchableOpacity onPress={closeEditEmailDialog} disabled={isUpdatingEmail}>
            <X color="#6B7280" size={24} />
          </TouchableOpacity>
        </View>

        <View style={styles.editEmailContent}>
          <Text style={styles.editEmailLabel}>Current Email</Text>
          <Text style={styles.editEmailCurrentValue}>{selectedUser.email}</Text>

          <Text style={styles.editEmailLabel}>New Email</Text>
          <View style={styles.resetInputRow}>
            <Mail color="#6B7280" size={20} />
            <TextInput
              style={styles.resetInput}
              placeholder="Enter new email address"
              placeholderTextColor="#9CA3AF"
              value={newEmail}
              onChangeText={setNewEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              editable={!isUpdatingEmail}
            />
          </View>
          {emailError ? (
            <Text style={styles.editEmailError}>{emailError}</Text>
          ) : null}

          <View style={[styles.groupModalButtons, styles.editEmailActions]}>
            <TouchableOpacity
              style={styles.groupCancelButton}
              onPress={closeEditEmailDialog}
              disabled={isUpdatingEmail}
            >
              <Text style={styles.groupCancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.groupSaveButton, isUpdatingEmail && styles.groupSaveButtonDisabled]}
              onPress={updateEmail}
              disabled={isUpdatingEmail}
            >
              <Text style={styles.groupSaveButtonText}>
                {isUpdatingEmail ? 'Saving...' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingDialog>

      {/* Manage Groups dialog (mentor users) */}
      <KeyboardAvoidingDialog
        visible={isGroupModalVisible}
        onClose={() => setIsGroupModalVisible(false)}
        animationType="slide"
        cardStyle={styles.groupModal}
      >
        <View style={styles.detailHeader}>
          <Text style={styles.detailTitle}>Manage Groups</Text>
          <TouchableOpacity onPress={() => setIsGroupModalVisible(false)}>
            <X color="#6B7280" size={24} />
          </TouchableOpacity>
        </View>

        {/* Group Search */}
        <View style={styles.groupSearchContainer}>
          <Search color="#6B7280" size={18} />
          <TextInput
            style={styles.groupSearchInput}
            placeholder="Search groups..."
            placeholderTextColor="#9CA3AF"
            value={groupSearchQuery}
            onChangeText={setGroupSearchQuery}
          />
          {groupSearchQuery !== '' && (
            <TouchableOpacity onPress={() => setGroupSearchQuery('')}>
              <X color="#6B7280" size={18} />
            </TouchableOpacity>
          )}
        </View>

        {isLoadingGroups ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading groups...</Text>
          </View>
        ) : (
          <View style={styles.groupListContainer}>
            <ScrollView
              style={styles.groupList}
              contentContainerStyle={styles.groupListContent}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
              keyboardShouldPersistTaps="handled"
            >
              {filteredMentorGroups.length === 0 ? (
                <Text style={styles.emptyText}>No groups found</Text>
              ) : (
                filteredMentorGroups.map(group => (
                  <TouchableOpacity
                    key={group._id}
                    style={[
                      styles.groupItem,
                      group.isAssigned && styles.groupItemSelected
                    ]}
                    onPress={() => toggleGroupAssignment(group._id)}
                  >
                    {group.isAssigned ? (
                      <CheckSquare color="#10B981" size={22} />
                    ) : (
                      <Square color="#9CA3AF" size={22} />
                    )}
                    <View style={styles.groupItemInfo}>
                      <Text style={[
                        styles.groupItemName,
                        group.isAssigned && styles.groupItemNameSelected
                      ]}>
                        {group.name}
                      </Text>
                      {group.description && (
                        <Text style={styles.groupItemDesc} numberOfLines={1}>
                          {group.description}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        )}

        {/* Summary and Save */}
        <View style={styles.groupModalFooter}>
          <Text style={styles.groupSummary}>
            {mentorGroups.filter(g => g.isAssigned).length} group(s) selected
          </Text>
          <View style={styles.groupModalButtons}>
            <TouchableOpacity
              style={styles.groupCancelButton}
              onPress={() => setIsGroupModalVisible(false)}
            >
              <Text style={styles.groupCancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.groupSaveButton, isSavingGroups && styles.groupSaveButtonDisabled]}
              onPress={saveMentorGroups}
              disabled={isSavingGroups}
            >
              <Text style={styles.groupSaveButtonText}>
                {isSavingGroups ? 'Saving...' : 'Save Changes'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingDialog>

      {/* Assignment modals — plain top-level RN Modals work from a normal
          screen (no in-modal stacking issue) and contain no text inputs. */}
      {selectedUser.role === 'student' && (
        <>
          <SubjectSelectionModal
            visible={isSubjectModalVisible}
            onClose={() => setIsSubjectModalVisible(false)}
            studentId={selectedUser._id}
            studentName={selectedUser.name}
            onSave={handleSaveSubjects}
          />
          <MentorSelectionModal
            visible={isMentorModalVisible}
            onClose={handleMentorModalClose}
            studentId={selectedUser._id}
            studentName={selectedUser.name}
            onSave={handleMentorSave}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // transparentModal route — the dim comes from detailOverlay, the screen
  // itself must stay see-through (also set via contentStyle in _layout.tsx).
  screenRoot: {
    flex: 1,
  },
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: 20,
  },
  detailAvoid: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  detailTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
  },
  detailScroll: {
    flexGrow: 1,
  },
  detailContent: {
    padding: 20,
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  assignedSubjectsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  assignedSubjectChip: {
    backgroundColor: '#E0F7F6',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#B2F5EA',
  },
  assignedSubjectText: {
    color: '#00796B',
    fontSize: 12,
    fontWeight: '600',
  },
  detailName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 8,
  },
  roleBadgeLarge: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  infoSection: {
    marginTop: 10,
    gap: 15,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    padding: 15,
    borderRadius: 12,
    gap: 15,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 16,
    color: '#000000',
    fontWeight: '500',
  },
  // Student tier action inside the "Student Tier" info row. Layout is shared
  // by both tier states; only the background color differs so the button is
  // always laid out inside the row (never pushed past the modal edge).
  tierButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  tierButtonPaid: {
    backgroundColor: '#EF4444',
  },
  tierButtonFree: {
    backgroundColor: '#01b4ae',
  },
  tierButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  // Email correction action inside the "Email" info row, matching the tier
  // button pattern used in the "Student Tier" row above.
  editEmailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#01b4ae',
  },
  editEmailButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  editEmailModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '100%',
    maxWidth: 400,
  },
  editEmailContent: {
    padding: 20,
  },
  editEmailLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  editEmailCurrentValue: {
    fontSize: 15,
    color: '#000000',
    fontWeight: '500',
    marginBottom: 15,
  },
  editEmailError: {
    fontSize: 13,
    color: '#EF4444',
    marginTop: 8,
    marginBottom: 8,
  },
  editEmailActions: {
    marginTop: 20,
  },
  closeButton: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
    marginTop: 10,
  },
  closeButtonText: {
    color: '#374151',
    fontSize: 16,
    fontWeight: '600',
  },
  resetSection: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#E0F7F6',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#01b4ae',
  },
  resetTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#01b4ae',
    marginBottom: 10,
  },
  resetInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  resetInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    fontSize: 14,
    color: '#000000',
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#01b4ae',
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  resetButtonDisabled: {
    opacity: 0.6,
  },
  resetButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  // Mentor Assignment Styles
  mentorLoadingContainer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mentorLoadingText: {
    color: '#6B7280',
    fontSize: 13,
  },
  assignedMentorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  assignedMentorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  assignedMentorInfo: {
    flex: 1,
  },
  assignedMentorName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#064E3B',
    marginBottom: 2,
  },
  assignedMentorEmail: {
    fontSize: 13,
    color: '#047857',
  },
  assignedMentorPhone: {
    fontSize: 12,
    color: '#6EE7B7',
    marginTop: 2,
  },
  mentorGroupSection: {
    marginTop: 10,
    marginBottom: 10,
    padding: 15,
    backgroundColor: '#F0FDFA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  mentorGroupTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F766E',
    marginBottom: 10,
  },
  manageGroupsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0D9488',
    borderRadius: 8,
    padding: 10,
    gap: 6,
  },
  manageGroupsButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  // Student Profile Styles
  studentProfileSection: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#F0F9FF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0EA5E9',
  },
  studentProfileTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0369A1',
    marginBottom: 15,
  },
  profileGrid: {
    gap: 10,
  },
  profileRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 8,
  },
  profileLabel: {
    fontSize: 13,
    color: '#6B7280',
    width: 120,
    fontWeight: '500',
  },
  profileValue: {
    fontSize: 13,
    color: '#000000',
    flex: 1,
    fontWeight: '600',
  },
  profileIncompleteMessage: {
    padding: 15,
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
  },
  profileIncompleteText: {
    fontSize: 14,
    color: '#92400E',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  // Group Modal Styles
  groupModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '100%',
    maxWidth: 400,
    maxHeight: 450,
    display: 'flex',
    flexDirection: 'column',
  },
  groupSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 15,
    marginVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  groupSearchInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 14,
    color: '#000000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 14,
    color: '#6B7280',
  },
  groupListContainer: {
    flex: 1,
    minHeight: 100,
  },
  groupList: {
    flex: 1,
  },
  groupListContent: {
    paddingHorizontal: 15,
    paddingBottom: 10,
  },
  groupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 12,
  },
  groupItemSelected: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  groupItemInfo: {
    flex: 1,
  },
  groupItemName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#374151',
  },
  groupItemNameSelected: {
    color: '#047857',
    fontWeight: '600',
  },
  groupItemDesc: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  groupModalFooter: {
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  groupSummary: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 12,
    textAlign: 'center',
  },
  groupModalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  groupCancelButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  groupCancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  groupSaveButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#01b4ae',
    alignItems: 'center',
  },
  groupSaveButtonDisabled: {
    opacity: 0.6,
  },
  groupSaveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyText: {
    textAlign: 'center',
    color: '#6B7280',
    fontSize: 16,
    marginTop: 40,
  },
  // Assignment Section Styles
  assignmentSection: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  assignmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  assignmentTitle: {
    // flex: 1 lets the title take the space it needs and wrap on narrow
    // screens, so the "Manage ..." button beside it can never overlap it.
    flex: 1,
    marginRight: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#92400E',
  },
  assignButton: {
    backgroundColor: '#01b4ae',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  assignButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  assignmentHint: {
    fontSize: 12,
    color: '#78350F',
    fontStyle: 'italic',
  },
  emptyMentorState: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
  },
  emptyMentorText: {
    marginTop: 8,
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 12,
  },
  assignLink: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#E0F7F6',
    borderRadius: 20,
  },
  assignLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#01b4ae',
  },
});
// TEMPORARY FEATURE FREEZE — quiz-only availability (utils/featureAvailability.ts).
export default withFeatureGate('userManagement')(UserDetailsScreen);
