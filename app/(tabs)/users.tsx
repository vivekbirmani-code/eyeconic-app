import { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TextInput,
  Modal,
  Alert,
  ScrollView,
  Platform,
  StatusBar,
  Animated,
  Easing
} from 'react-native';
import { Plus, User as UserIcon, Search, X, Mail, Shield, Calendar, Phone, Lock, Key, Users as UsersIcon, Check, Square, CheckSquare } from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';

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
  isActive?: boolean;
  isProfileComplete?: boolean;
  studentProfile?: StudentProfile;
  createdAt?: string;
  groups?: { _id: string; name: string }[];
}

interface GroupAssignment {
  _id: string;
  name: string;
  description?: string;
  isAssigned: boolean;
}

export default function Users() {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
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

  // Animation values for premium UI
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const filterSlideY = useRef(new Animated.Value(20)).current;
  const searchFocusAnim = useRef(new Animated.Value(0)).current;
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Only admin can access this screen
  if (user?.role !== 'admin') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Access Denied</Text>
      </SafeAreaView>
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

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await api.get('/users');
      setUsers(response.data);
    } catch (error) {
      Alert.alert('Error', 'Failed to fetch users');
    }
  };

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
    setIsDetailModalVisible(true);
    // Restore search query after a tick to prevent autofill
    setTimeout(() => setSearchQuery(currentSearch), 50);
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

  const renderUser = ({ item }: { item: User }) => (
    <TouchableOpacity
      style={styles.userCard}
      onPress={() => openUserDetails(item)}
      activeOpacity={0.7}
    >
      <View style={styles.userAvatar}>
        <UserIcon color="#01b4ae" size={24} />
      </View>
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.name}</Text>
        <Text style={styles.userEmail}>{item.email}</Text>
        <View style={styles.badgeRow}>
          <View style={[styles.roleBadge, { backgroundColor: getRoleBgColor(item.role) }]}>
            <Text style={[styles.userRole, { color: getRoleColor(item.role) }]}>
              {item.role.toUpperCase()}
            </Text>
          </View>
          {item.role === 'student' && item.isProfileComplete === false && (
            <View style={styles.incompleteProfileBadge}>
              <Text style={styles.incompleteProfileText}>Profile Incomplete</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
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

      {/* Role Filter */}
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
            onPress={() => {
              setRoleFilter(role);
              if (role !== 'student') setProfileStatusFilter('all');
            }}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.filterButtonText,
              roleFilter === role && styles.filterButtonTextActive
            ]}>
              {role === 'all' ? 'All' : role.charAt(0).toUpperCase() + role.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </Animated.View>

      {/* Profile Status Filter - visible only when Student is selected */}
      {roleFilter === 'student' && (
        <View style={styles.subFilterContainer}>
          <Text style={styles.subFilterLabel}>Profile Status:</Text>
          {(['all', 'complete', 'incomplete'] as const).map((status) => (
            <TouchableOpacity
              key={status}
              style={[
                styles.subFilterButton,
                profileStatusFilter === status && styles.subFilterButtonActive
              ]}
              onPress={() => setProfileStatusFilter(status)}
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
        </View>
      )}

      {/* Results Count */}
      <Text style={styles.resultCount}>
        {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''} found
      </Text>

      <FlatList
        data={filteredUsers}
        renderItem={renderUser}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No users found</Text>
        }
      />

      {/* Create User Modal */}
      <Modal visible={isCreateModalVisible} animationType="slide">
        <SafeAreaView style={styles.modalContainer}>
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
              <View style={styles.roleButtons}>
                <TouchableOpacity
                  style={[
                    styles.roleButton,
                    newUser.role === 'student' && styles.roleButtonActive,
                  ]}
                  onPress={() => setNewUser({ ...newUser, role: 'student' })}
                >
                  <Text style={[
                    styles.roleButtonText,
                    newUser.role === 'student' && styles.roleButtonTextActive
                  ]}>Student</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.roleButton,
                    newUser.role === 'mentor' && styles.roleButtonActive,
                  ]}
                  onPress={() => setNewUser({ ...newUser, role: 'mentor' })}
                >
                  <Text style={[
                    styles.roleButtonText,
                    newUser.role === 'mentor' && styles.roleButtonTextActive
                  ]}>Mentor</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={styles.createButton} onPress={createUser}>
              <Text style={styles.createButtonText}>Create User</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* User Details Modal */}
      <Modal visible={isDetailModalVisible} animationType="slide" transparent>
        <View style={styles.detailOverlay}>
          <View style={styles.detailModal}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>User Details</Text>
              <TouchableOpacity onPress={() => setIsDetailModalVisible(false)}>
                <X color="#6B7280" size={24} />
              </TouchableOpacity>
            </View>

            {selectedUser && (
              <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
                <View style={styles.detailContent}>
                  {/* Avatar */}
                  <View style={styles.avatarContainer}>
                    <View style={[styles.avatar, { backgroundColor: getRoleBgColor(selectedUser.role) }]}>
                      <UserIcon color={getRoleColor(selectedUser.role)} size={40} />
                    </View>
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
                  </View>

                  {/* Student Profile Details - Only shown for students */}
                  {selectedUser.role === 'student' && (
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
                    onPress={() => setIsDetailModalVisible(false)}
                  >
                    <Text style={styles.closeButtonText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
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
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  resetTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#92400E',
    marginBottom: 10,
  },
  resetInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  resetInput: {
    flex: 1,
    fontSize: 14,
    color: '#000000',
  },
  resetButton: {
    flexDirection: 'row',
    backgroundColor: '#F59E0B',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
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
  // Mentor Group Management Styles
  mentorGroupSection: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  mentorGroupTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#047857',
    marginBottom: 12,
  },
  manageGroupsButton: {
    flexDirection: 'row',
    backgroundColor: '#01b4ae',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  manageGroupsButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
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
});