import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  TextInput,
  Alert,
  Platform,
  Animated,
  Easing,
  LayoutAnimation,
  UIManager,
  Pressable,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/layout';
import { Plus, User as UserIcon, Search, X, ChevronRight, UserPlus } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from '@/utils/haptics';
import { useFocusEffect } from '@react-navigation/native';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { api, getUserMessage } from '@/services/api';
import { fetchSignUpEnabled } from '@/services/settings';
import { useAppRefresh } from '@/hooks/useAppRefresh';
import UserAvatar from '@/components/UserAvatar';
import type { User } from '@/types/user';

export default function Users() {
  const { user } = useAuth();
  const { socket } = useNotifications();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'student' | 'mentor' | 'admin'>('all');
  const [profileStatusFilter, setProfileStatusFilter] = useState<'all' | 'complete' | 'incomplete'>('all');

  // Admin-controlled public sign-up toggle (backend setting, off by default).
  // When off, the app hides the Sign Up option and the backend rejects new
  // registrations; existing users (including imported students) sign in normally.
  const [signUpEnabled, setSignUpEnabled] = useState(false);
  const [isTogglingSignUp, setIsTogglingSignUp] = useState(false);

  // Animation values for premium UI
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const filterSlideY = useRef(new Animated.Value(20)).current;
  const searchFocusAnim = useRef(new Animated.Value(0)).current;
  const [isSearchFocused, setIsSearchFocused] = useState(false);

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

  // Refresh the admin sign-up toggle on tab focus so changes made
  // elsewhere (e.g. another admin session) are reflected here.
  const fetchSignUpSetting = useCallback(async () => {
    try {
      setSignUpEnabled(await fetchSignUpEnabled());
    } catch {
      setSignUpEnabled(false);
    }
  }, []);

  // Refresh on tab focus
  useFocusEffect(
    useCallback(() => {
      fetchUsers();
      fetchSignUpSetting();
    }, [fetchUsers, fetchSignUpSetting])
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

  // Toggle public sign-up on/off (admin-only backend endpoint)
  const handleToggleSignUp = async (nextValue: boolean) => {
    if (isTogglingSignUp) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const previousValue = signUpEnabled;
    setSignUpEnabled(nextValue); // optimistic — reverted on failure
    setIsTogglingSignUp(true);

    try {
      const response = await api.put('/settings/signup-enabled', {
        signUpEnabled: nextValue,
      });
      setSignUpEnabled(response.data?.signUpEnabled === true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setSignUpEnabled(previousValue);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Update Failed',
        getUserMessage(error) || 'Could not update the sign-up setting. Please try again.'
      );
    } finally {
      setIsTogglingSignUp(false);
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

  // User Details and Create User live in expo-router modal screens (see
  // app/user-details.tsx / app/create-user.tsx) so their text inputs get real
  // keyboard avoidance on every Android version. Both refresh this list via
  // the useFocusEffect above when they close.
  const openUserDetails = (userItem: User) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/user-details',
      params: { user: JSON.stringify(userItem) },
    });
  };

  const openCreateUser = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/create-user');
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
          onPress={openCreateUser}
          activeOpacity={0.85}
        >
          <Plus color="#01b4ae" size={22} />
        </TouchableOpacity>
      </Animated.View>

      {/* Public Sign-Up toggle — controls whether the app allows new
          self-registered (free) accounts. Off by default. */}
      <View style={styles.signUpCard}>
        <View style={styles.signUpIconContainer}>
          <UserPlus color="#01b4ae" size={20} />
        </View>
        <View style={styles.signUpTextContainer}>
          <Text style={styles.signUpTitle}>Public Sign-Up</Text>
          <Text
            style={[
              styles.signUpSubtitle,
              signUpEnabled ? styles.signUpSubtitleOn : styles.signUpSubtitleOff,
            ]}
          >
            {signUpEnabled
              ? 'On — anyone can create a free account from the app.'
              : 'Off — no new sign-ups. Only existing users can sign in.'}
          </Text>
        </View>
        <Switch
          value={signUpEnabled}
          onValueChange={handleToggleSignUp}
          disabled={isTogglingSignUp}
          trackColor={{ false: '#D1D5DB', true: '#01b4ae' }}
          thumbColor="#FFFFFF"
          ios_backgroundColor="#D1D5DB"
        />
      </View>

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
  signUpCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  signUpIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(1, 180, 174, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  signUpTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  signUpTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  signUpSubtitle: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17,
  },
  signUpSubtitleOn: {
    color: '#059669',
  },
  signUpSubtitleOff: {
    color: '#6B7280',
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
  errorText: {
    fontSize: 18,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 50,
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
});