import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  TextInput,
  Modal,
  Alert,
  ScrollView,
  Platform,
  Animated,
  Easing,
  LayoutAnimation,
  UIManager,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { ScreenContainer, FullScreenContainer } from '@/components/layout';
import { Plus, User as UserIcon, Search, X, Mail, Shield, Calendar, Phone, Lock, Key, Users as UsersIcon, Check, Square, CheckSquare, ChevronRight } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from '@/utils/haptics';
import { useFocusEffect } from '@react-navigation/native';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { api } from '@/services/api';
import SubjectSelectionModal from '@/components/SubjectSelectionModal';
import MentorSelectionModal, { type Mentor } from '@/components/MentorSelectionModal';
import { useAppRefresh } from '@/hooks/useAppRefresh';
import UserAvatar from '@/components/UserAvatar';

interface StudentProfile {
  mbbsBatch?: string;
  collegeName?: string;
  attemptNo?: number;
  batchType?: string;
  grandTestsGiven?: string;
  averageCorrects?: string;
  averageScore?: number;
  weakestSubjects?: string;
  targetBranch?: string;
  subscriptions?: string;
}

interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
  phone?: string;
  profilePicture?: string | null;
  isActive?: boolean;
  isProfileComplete?: boolean;
  isFreeUser?: boolean;
  studentProfile?: StudentProfile;
  createdAt?: string;
  groups?: { _id: string; name: string }[];
  assignedMentors?: {
    _id: string;
    name: string;
    email: string;
    phone?: string;
  }[];
  assignedSubjects?: Subject[];
}

interface Subject {
  _id: string;
  name: string;
  year: string;
  displayOrder: number;
}

interface GroupAssignment {
  _id: string;
  name: string;
  description?: string;
  isAssigned: boolean;
}

export default function Users() {
  const { user } = useAuth();
  const { socket } = useNotifications();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [isDetailModalVisible, setIsDetailModalVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'student' | 'mentor' | 'admin'>('all');
  const [profileStatusFilter, setProfileStatusFilter] = useState<'all' | 'complete' | 'incomplete'>('all');
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    role: 'student',
  });
  const [newPassword, setNewPassword] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);

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

  // Animation values for premium UI
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const filterSlideY = useRef(new Animated.Value(20)).current;
  const searchFocusAnim = useRef(new Animated.Value(0)).current;
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Mentor assignment state
  const [isLoadingMentor, setIsLoadingMentor] = useState(false);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

  // Modal animation values
  const modalOpacity = useRef(new Animated.Value(0)).current;
  const modalTranslateY = useRef(new Animated.Value(30)).current;
  const modalScale = useRef(new Animated.Value(0.95)).current;

  // Role selector animation for segmented control
  const roleIndicatorPosition = useRef(new Animated.Value(0)).current;

  // Card list animations
  const cardAnimations = useRef<Animated.Value[]>([]).current;

  // User counts by role
  const userCounts = useMemo(() => {
    const counts = { all: users.length, student: 0, mentor: 0, admin: 0 };
    users.forEach(u => {
      if (u.role === 'student') counts.student++;
      else if (u.role === 'mentor') counts.mentor++;
      else if (u.role === 'admin') counts.admin++;
    });
    return counts;
  }, [users]);

  // Only admin can access this screen
  if (user?.role !== 'admin') {
    return (
      <ScreenContainer style={styles.container}>
        <Text style={styles.errorText}>Access Denied</Text>
      </ScreenContainer>
    );
  }

  // Premium page entry animations
  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerOpacity, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(filterSlideY, {
        toValue: 0,
        duration: 500,
        delay: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Staggered card animation function (declared before fetchUsers so it can be referenced)
  const animateCardList = useCallback((count: number) => {
    LayoutAnimation.configureNext({
      duration: 300,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
  }, []);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/users');
      setUsers(response.data);
      // Trigger staggered animation for cards
      animateCardList(response.data.length);
    } catch (error) {
      Alert.alert('Error', 'Failed to fetch users');
    } finally {
      setIsLoading(false);
    }
  }, [animateCardList]);

  // Refresh on tab focus
  useFocusEffect(
    useCallback(() => {
      fetchUsers();
    }, [fetchUsers])
  );

  // Refresh when app comes to foreground
  useAppRefresh(fetchUsers);

  // Listen for real-time user_updated events from server
  useEffect(() => {
    if (!socket) return;
    socket.on('user_updated', fetchUsers);
    socket.on('data_updated', fetchUsers);
    return () => {
      socket.off('user_updated', fetchUsers);
      socket.off('data_updated', fetchUsers);
    };
  }, [socket, fetchUsers]);


  // Filter users based on search query and role filter
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      // Search filter (name, email, or phone)
      const matchesSearch = searchQuery === '' ||
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.phone && u.phone.includes(searchQuery));

      // Role filter
      const matchesRole = roleFilter === 'all' || u.role === roleFilter;

      // Profile Status Filter (only for students)
      let matchesProfileStatus = true;
      if (roleFilter === 'student' && profileStatusFilter !== 'all') {
        if (profileStatusFilter === 'complete') {
          matchesProfileStatus = u.isProfileComplete === true;
        } else {
          // Incomplete includes undefined or false
          matchesProfileStatus = u.isProfileComplete !== true;
        }
      }

      return matchesSearch && matchesRole && matchesProfileStatus;
    });
  }, [users, searchQuery, roleFilter, profileStatusFilter]);

  const createUser = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    try {
      await api.post('/users', newUser);
      setNewUser({ name: '', email: '', password: '', phone: '', role: 'student' });
      setIsCreateModalVisible(false);
      fetchUsers();
      Alert.alert('Success', 'User created successfully');
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to create user';
      Alert.alert('Error', message);
    }
  };

  const openUserDetails = (userItem: User) => {
    const currentSearch = searchQuery; // Save current search
    setSelectedUser(userItem);
    setNewPassword('');

    // Fetch assigned mentor for student
    if (userItem.role === 'student') {
      fetchMentorDetails(userItem._id);
      fetchStudentSubjects(userItem._id);
    }

    // Haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Reset animation values
    modalOpacity.setValue(0);
    modalTranslateY.setValue(30);
    modalScale.setValue(0.95);

    setIsDetailModalVisible(true);

    // Animate modal in
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

    // Restore search query after a tick to prevent autofill
    setTimeout(() => setSearchQuery(currentSearch), 50);
  };

  const closeDetailModal = () => {
    setIsMentorModalVisible(false);
    setIsSubjectModalVisible(false);
    // Animate modal out
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
    ]).start(() => {
      setIsDetailModalVisible(false);
    });
  };

  // Handle filter change with animation
  const handleFilterChange = (newFilter: 'all' | 'student' | 'mentor' | 'admin') => {
    Haptics.selectionAsync();
    LayoutAnimation.configureNext({
      duration: 250,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
    });
    setRoleFilter(newFilter);
    if (newFilter !== 'student') setProfileStatusFilter('all');
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
              
              // Update in our main users array
              setUsers(prev => prev.map(u => u._id === selectedUser._id ? { ...u, isFreeUser: updatedUser.isFreeUser } : u));
              
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

  const fetchStudentSubjects = async (studentId: string) => {
    setIsLoadingSubjects(true);
    try {
      const response = await api.get(`/student-subjects/${studentId}`);
      if (response.data && response.data.subjects) {
        // Verify we have an array
        const subjects = Array.isArray(response.data.subjects) ? response.data.subjects : [];
        setSelectedUser(prev => prev ? { ...prev, assignedSubjects: subjects } : null);
      } else {
        setSelectedUser(prev => prev ? { ...prev, assignedSubjects: [] } : null);
      }
    } catch (error) {
      console.error('Error fetching student subjects:', error);
      // On error, we might want to default to empty or keep previous state? 
      // For now, let's not clear it if it was optimistic, but maybe show toast?
      // Actually, if fetch fails, we should probably verify state.
    } finally {
      setIsLoadingSubjects(false);
    }
  };

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
      alert(error?.response?.data?.message || 'Failed to save subjects');
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

  // Search focus animation handlers
  const handleSearchFocus = () => {
    setIsSearchFocused(true);
    Animated.timing(searchFocusAnim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  };

  const handleSearchBlur = () => {
    setIsSearchFocused(false);
    Animated.timing(searchFocusAnim, {
      toValue: 0,
      duration: 200,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Skeleton loading card component
  const SkeletonCard = () => {
    const shimmerAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      const shimmer = Animated.loop(
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      shimmer.start();
      return () => shimmer.stop();
    }, []);

    const translateX = shimmerAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [-200, 200],
    });

    return (
      <View style={styles.skeletonCard}>
        <View style={styles.skeletonAvatar}>
          <Animated.View style={[styles.shimmer, { transform: [{ translateX }] }]}>
            <LinearGradient
              colors={['transparent', 'rgba(255,255,255,0.4)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
        <View style={styles.skeletonContent}>
          <View style={styles.skeletonName}>
            <Animated.View style={[styles.shimmer, { transform: [{ translateX }] }]}>
              <LinearGradient
                colors={['transparent', 'rgba(255,255,255,0.4)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>
          <View style={styles.skeletonEmail}>
            <Animated.View style={[styles.shimmer, { transform: [{ translateX }] }]}>
              <LinearGradient
                colors={['transparent', 'rgba(255,255,255,0.4)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>
          <View style={styles.skeletonBadge}>
            <Animated.View style={[styles.shimmer, { transform: [{ translateX }] }]}>
              <LinearGradient
                colors={['transparent', 'rgba(255,255,255,0.4)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>
        </View>
      </View>
    );
  };

  // Enhanced user card with micro-interactions
  const UserCard = ({ item }: { item: User }) => {
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const shadowAnim = useRef(new Animated.Value(1)).current;

    const handlePressIn = () => {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 0.98,
          friction: 8,
          tension: 100,
          useNativeDriver: true,
        }),
        Animated.timing(shadowAnim, {
          toValue: 0.5,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();
    };

    const handlePressOut = () => {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(shadowAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    };

    return (
      <Pressable
        onPress={() => openUserDetails(item)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        <Animated.View
          style={[
            styles.userCard,
            {
              transform: [{ scale: scaleAnim }],
              opacity: shadowAnim.interpolate({
                inputRange: [0.5, 1],
                outputRange: [0.95, 1],
              }),
            }
          ]}
        >
          <UserAvatar
            name={item.name}
            role={item.role}
            imageUrl={item.profilePicture}
            size={48}
          />
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{item.name}</Text>
            <Text style={styles.userEmail}>{item.email}</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.roleBadge, { backgroundColor: getRoleBgColor(item.role) }]}>
                <Text style={[styles.userRole, { color: getRoleColor(item.role) }]}>
                  {item.role.toUpperCase()}
                </Text>
              </View>
              {item.role === 'student' && (
                <View style={[styles.roleBadge, { backgroundColor: item.isFreeUser ? '#FEF3C7' : '#D1FAE5' }]}>
                  <Text style={[styles.userRole, { color: item.isFreeUser ? '#D97706' : '#059669' }]}>
                    {item.isFreeUser ? 'FREE USER' : 'PAID USER'}
                  </Text>
                </View>
              )}
              {item.role === 'student' && item.isProfileComplete === false && (
                <View style={styles.incompleteProfileBadge}>
                  <Text style={styles.incompleteProfileText}>Profile Incomplete</Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.chevronContainer}>
            <ChevronRight color="#9CA3AF" size={20} />
          </View>
        </Animated.View>
      </Pressable>
    );
  };

  const renderUser = ({ item }: { item: User }) => <UserCard item={item} />;

  return (
    <ScreenContainer style={styles.container}>
      <Animated.View style={[styles.header, { opacity: headerOpacity }]}>
        <Text style={styles.title}>User Management</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setIsCreateModalVisible(true)}
          activeOpacity={0.85}
        >
          <Plus color="#01b4ae" size={22} />
        </TouchableOpacity>
      </Animated.View>

      {/* Search Bar */}
      <Animated.View style={[
        styles.searchContainer,
        {
          borderColor: searchFocusAnim.interpolate({
            inputRange: [0, 1],
            outputRange: ['#E5E7EB', '#01b4ae']
          }),
          shadowOpacity: searchFocusAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 0.1]
          }),
        }
      ]}>
        <Search color="#6B7280" size={20} />
        <TextInput
          key="search-users-input"
          style={styles.searchInput}
          placeholder="Search by name, email or phone..."
          placeholderTextColor="#9CA3AF"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onFocus={handleSearchFocus}
          onBlur={handleSearchBlur}
          autoComplete="off"
          autoCorrect={false}
          autoCapitalize="none"
          textContentType="none"
          inputMode="search"
        />
        {searchQuery !== '' && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <X color="#6B7280" size={20} />
          </TouchableOpacity>
        )}
      </Animated.View>

      {/* Role Filter with counts */}
      <Animated.View style={[
        styles.filterContainer,
        {
          opacity: filterSlideY.interpolate({
            inputRange: [0, 20],
            outputRange: [1, 0]
          }),
          transform: [{ translateY: filterSlideY }]
        }
      ]}>
        {(['all', 'student', 'mentor', 'admin'] as const).map((role) => (
          <TouchableOpacity
            key={role}
            style={[
              styles.filterButton,
              roleFilter === role && styles.filterButtonActive
            ]}
            onPress={() => handleFilterChange(role)}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.filterButtonText,
              roleFilter === role && styles.filterButtonTextActive
            ]}>
              {role === 'all' ? 'All' : role.charAt(0).toUpperCase() + role.slice(1)}
              <Text style={[
                styles.filterCountText,
                roleFilter === role && styles.filterCountTextActive
              ]}> ({userCounts[role]})</Text>
            </Text>
          </TouchableOpacity>
        ))}
      </Animated.View>

      {/* Profile Status Filter - visible only when Student is selected */}
      {roleFilter === 'student' && (
        <Animated.View style={styles.subFilterContainer}>
          <Text style={styles.subFilterLabel}>Profile Status:</Text>
          {(['all', 'complete', 'incomplete'] as const).map((status) => (
            <TouchableOpacity
              key={status}
              style={[
                styles.subFilterButton,
                profileStatusFilter === status && styles.subFilterButtonActive
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                LayoutAnimation.configureNext({
                  duration: 200,
                  update: { type: LayoutAnimation.Types.easeInEaseOut },
                });
                setProfileStatusFilter(status);
              }}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.subFilterButtonText,
                profileStatusFilter === status && styles.subFilterButtonTextActive
              ]}>
                {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </Animated.View>
      )}

      {/* Results Count */}
      <Text style={styles.resultCount}>
        {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''} found
      </Text>

      {/* User List with skeleton loading */}
      {isLoading ? (
        <View style={styles.list}>
          {[1, 2, 3, 4, 5].map((key) => (
            <SkeletonCard key={key} />
          ))}
        </View>
      ) : (
        <FlatList
          data={filteredUsers}
          renderItem={renderUser}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No users found</Text>
          }
        />
      )}

      {/* Create User Modal */}
      <Modal visible={isCreateModalVisible} animationType="slide">
        <FullScreenContainer style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Create New User</Text>
            <TouchableOpacity onPress={() => setIsCreateModalVisible(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <TextInput
              style={styles.input}
              placeholder="Full Name"
              placeholderTextColor="#9CA3AF"
              value={newUser.name}
              onChangeText={(text) => setNewUser({ ...newUser, name: text })}
            />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#9CA3AF"
              value={newUser.email}
              onChangeText={(text) => setNewUser({ ...newUser, email: text })}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#9CA3AF"
              value={newUser.password}
              onChangeText={(text) => setNewUser({ ...newUser, password: text })}
              secureTextEntry
            />
            <TextInput
              style={styles.input}
              placeholder="Phone Number "
              placeholderTextColor="#9CA3AF"
              value={newUser.phone}
              onChangeText={(text) => setNewUser({ ...newUser, phone: text })}
              keyboardType="phone-pad"
            />

            <View style={styles.roleSelector}>
              <Text style={styles.roleLabel}>Role:</Text>
              <View style={styles.segmentedControl}>
                {/* Animated sliding indicator */}
                <Animated.View
                  style={[
                    styles.segmentIndicator,
                    {
                      transform: [{
                        translateX: roleIndicatorPosition.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 150], // Adjust based on button width
                        })
                      }]
                    }
                  ]}
                />
                <TouchableOpacity
                  style={styles.segmentButton}
                  onPress={() => {
                    Haptics.selectionAsync();
                    Animated.spring(roleIndicatorPosition, {
                      toValue: 0,
                      friction: 8,
                      tension: 50,
                      useNativeDriver: true,
                    }).start();
                    setNewUser({ ...newUser, role: 'student' });
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.segmentButtonText,
                    newUser.role === 'student' && styles.segmentButtonTextActive
                  ]}>Student</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.segmentButton}
                  onPress={() => {
                    Haptics.selectionAsync();
                    Animated.spring(roleIndicatorPosition, {
                      toValue: 1,
                      friction: 8,
                      tension: 50,
                      useNativeDriver: true,
                    }).start();
                    setNewUser({ ...newUser, role: 'mentor' });
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.segmentButtonText,
                    newUser.role === 'mentor' && styles.segmentButtonTextActive
                  ]}>Mentor</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={styles.createButton} onPress={createUser}>
              <Text style={styles.createButtonText}>Create User</Text>
            </TouchableOpacity>
          </ScrollView>
        </FullScreenContainer>
      </Modal>

      {/* User Details Modal with premium animations */}
      <Modal visible={isDetailModalVisible} animationType="none" transparent>
        <Animated.View style={[styles.detailOverlay, { opacity: modalOpacity }]}>
          <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
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
              <TouchableOpacity onPress={closeDetailModal}>
                <X color="#6B7280" size={24} />
              </TouchableOpacity>
            </View>

            {selectedUser && (
              <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
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
                      <View style={[styles.infoRow, { justifyContent: 'space-between', alignItems: 'center' }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <UsersIcon color="#6B7280" size={20} />
                          <View style={styles.infoContent}>
                            <Text style={styles.infoLabel}>Student Tier</Text>
                            <Text style={[styles.infoValue, { fontWeight: 'bold', color: selectedUser.isFreeUser ? '#D97706' : '#059669' }]}>
                              {selectedUser.isFreeUser ? 'Free User' : 'Paid User'}
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={{
                            backgroundColor: selectedUser.isFreeUser ? '#01b4ae' : '#EF4444',
                            paddingVertical: 6,
                            paddingHorizontal: 12,
                            borderRadius: 8,
                          }}
                          onPress={handleToggleUserTier}
                        >
                          <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 12 }}>
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
                    onPress={closeDetailModal}
                  >
                    <Text style={styles.closeButtonText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </Animated.View>

          {/* Assignment modals must be children of the detail modal for iOS modal stacking */}
          {selectedUser?.role === 'student' && (
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
        </Animated.View>
      </Modal>

      {/* Mentor Group Management Modal */}
      <Modal visible={isGroupModalVisible} animationType="slide" transparent>
        <View style={styles.detailOverlay}>
          <View style={styles.groupModal}>
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
    padding: 20,
    paddingVertical: 24,
    backgroundColor: '#01b4ae',
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  addButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    padding: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#000000',
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 18,
    gap: 10,
    flexWrap: 'wrap',
  },
  filterButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  filterButtonActive: {
    backgroundColor: '#01b4ae',
    borderColor: '#01b4ae',
    shadowColor: '#01b4ae',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  filterButtonText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '600',
  },
  filterButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  resultCount: {
    paddingHorizontal: 20,
    paddingTop: 15,
    fontSize: 14,
    color: '#6B7280',
  },
  list: {
    padding: 20,
    paddingTop: 10,
    gap: 12,
  },
  emptyText: {
    textAlign: 'center',
    color: '#6B7280',
    fontSize: 16,
    marginTop: 40,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E0F7F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userInfo: {
    marginLeft: 15,
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
    marginBottom: 6,
  },
  roleBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  incompleteProfileBadge: {
    backgroundColor: '#FEF3C7',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 0,
  },
  incompleteProfileText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
  },
  userRole: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
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
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
  },
  cancelText: {
    color: '#EF4444',
    fontSize: 16,
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
    color: '#000000',
    marginBottom: 15,
  },
  roleSelector: {
    marginTop: 10,
  },
  roleLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 10,
  },
  roleButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  roleButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  roleButtonActive: {
    backgroundColor: '#01b4ae',
    borderColor: '#01b4ae',
  },
  roleButtonText: {
    fontSize: 14,
    color: '#374151',
  },
  roleButtonTextActive: {
    color: '#FFFFFF',
  },
  createButton: {
    backgroundColor: '#01b4ae',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 25,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 4,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 18,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 50,
  },
  // Detail Modal Styles
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
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
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
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
  changeButton: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  changeButtonText: {
    color: '#374151',
  },
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
  subFilterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 12,
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 5,
  },
  subFilterLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginRight: 4,
    fontWeight: '600',
  },
  subFilterButton: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
  },
  subFilterButtonActive: {
    backgroundColor: '#E0F7F6',
    borderColor: '#01b4ae',
  },
  subFilterButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  subFilterButtonTextActive: {
    color: '#01b4ae',
    fontWeight: '700',
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
  // Skeleton loading styles
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 12,
  },
  skeletonAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  shimmer: {
    width: '100%',
    height: '100%',
  },
  skeletonContent: {
    flex: 1,
    marginLeft: 15,
  },
  skeletonName: {
    height: 16,
    width: '60%',
    backgroundColor: '#E5E7EB',
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden',
  },
  skeletonEmail: {
    height: 14,
    width: '80%',
    backgroundColor: '#E5E7EB',
    borderRadius: 6,
    marginBottom: 8,
    overflow: 'hidden',
  },
  skeletonBadge: {
    height: 22,
    width: 60,
    backgroundColor: '#E5E7EB',
    borderRadius: 11,
    overflow: 'hidden',
  },
  // Chevron container
  chevronContainer: {
    padding: 4,
    marginLeft: 8,
  },
  // Filter count text styles
  filterCountText: {
    fontSize: 12,
    fontWeight: '500',
  },
  filterCountTextActive: {
    fontWeight: '600',
  },
  // Segmented control styles for role selector
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 4,
    position: 'relative',
  },
  segmentIndicator: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 150,
    height: '100%',
    backgroundColor: '#01b4ae',
    borderRadius: 10,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  segmentButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  segmentButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
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
  // New Mentor List Styles
  mentorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 6,
  },
  mentorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E0F2FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  mentorInitials: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0284C7',
  },
  mentorInfoInRow: {
    flex: 1,
  },
  mentorName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  mentorDetailText: {
    fontSize: 13,
    color: '#6B7280',
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