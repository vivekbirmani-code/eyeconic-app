import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { withFeatureGate } from '@/components/withFeatureGate';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ScrollView,
  Animated,
  Easing,
  Pressable,
  RefreshControl,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Plus, MessageCircle, Users, ChevronDown, Pencil, Folder } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from '@/utils/haptics';
import { colors } from '@/utils/theme';
import SearchBar from '@/components/SearchBar';
import TouchableScale from '@/components/TouchableScale';
import Collapsible from '@/components/Collapsible';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { api } from '@/services/api';
import { useAppRefresh } from '@/hooks/useAppRefresh';

interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
}

interface Group {
  _id: string;
  name: string;
  description?: string;
  type?: 'general' | 'mentors' | 'admin';
  members: User[];
  mentors?: User[];
  createdBy: { name: string };
}

interface MentorFolder {
  key: string;
  title: string;
  mentorEmail: string;
  groups: Group[];
}

// ---- Motion constants ------------------------------------------------
// Cards cascade in one-by-one on first load; the gate flag (see Groups)
// turns entrance off afterwards so refetches/focus returns never replay it.
const CARD_STAGGER_MS = 35;
const MAX_STAGGERED_CARDS = 12;

/**
 * One group card: springy press feedback, one-shot staggered entrance, and a
 * tiny pop on the unread badge when a new message lands.
 */
function GroupCard({
  group,
  index,
  animateEntrance,
  unreadCount,
  isAdmin,
  onOpen,
  onEdit,
}: {
  group: Group;
  index: number;
  animateEntrance: boolean;
  unreadCount: number;
  isAdmin: boolean;
  onOpen: (groupId: string) => void;
  onEdit: (group: Group) => void;
}) {
  const entrance = useRef(new Animated.Value(animateEntrance ? 0 : 1)).current;
  const badgeScale = useRef(new Animated.Value(1)).current;
  const prevUnreadRef = useRef(unreadCount);

  useEffect(() => {
    if (!animateEntrance) return;
    Animated.parallel([
      Animated.timing(entrance, {
        toValue: 1,
        duration: 280,
        delay: 60 + Math.min(index, MAX_STAGGERED_CARDS) * CARD_STAGGER_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Badge pops only when the count GROWS (new message), not on refetches that
  // reset it to zero.
  useEffect(() => {
    const grew = unreadCount > prevUnreadRef.current;
    prevUnreadRef.current = unreadCount;
    if (!grew) return;
    Animated.sequence([
      Animated.spring(badgeScale, { toValue: 1.35, speed: 40, bounciness: 6, useNativeDriver: true }),
      Animated.spring(badgeScale, { toValue: 1, friction: 4, tension: 220, useNativeDriver: true }),
    ]).start();
  }, [unreadCount, badgeScale]);

  // The entrance wrapper exists ONLY when the entrance animates. A resting
  // native-driven Animated style (value parked at 1, never driven) paints as
  // NOTHING when the card is remounted on bridgeless Android (folder
  // collapse/reopen) — plain children at rest are immune.
  const card = (
    <TouchableScale
      style={styles.groupCard}
      onPress={() => onOpen(group._id)}
      // No accessibilityRole here on purpose: the edit-pencil inside is a
      // button, and two nested role=button elements render as an invalid
      // <button> inside <button> on web. The card keeps its label; the
      // pencil keeps full button semantics.
      accessibilityLabel={`Open group ${group.name}`}
    >
        <View style={styles.groupIconTile}>
          <MessageCircle color={colors.primary} size={22} />
        </View>
        <View style={styles.groupInfo}>
          <View style={styles.groupHeaderRow}>
            <Text style={styles.groupName} numberOfLines={1}>{group.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {isAdmin && (
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation?.();
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onEdit(group);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${group.name}`}
                >
                  <Pencil color={colors.textSecondary} size={16} />
                </TouchableOpacity>
              )}
              {unreadCount > 0 && (
                <Animated.View style={[styles.unreadBadge, { transform: [{ scale: badgeScale }] }]}>
                  <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
                </Animated.View>
              )}
            </View>
          </View>
          {group.description ? (
            <Text style={styles.groupDescription} numberOfLines={1}>{group.description}</Text>
          ) : null}
          <View style={styles.memberCount}>
            <Users color={colors.textMuted} size={14} />
            <Text style={styles.memberText}>{group.members.length} members</Text>
          </View>
        </View>
      </TouchableScale>
  );

  if (!animateEntrance) return card;

  return (
    <Animated.View
      style={{
        opacity: entrance,
        transform: [{
          translateY: entrance.interpolate({
            inputRange: [0, 1],
            outputRange: [14, 0],
          }),
        }],
      }}
    >
      {card}
    </Animated.View>
  );
}

/**
 * One mentor folder: staggered block entrance, spring chevron rotation, and a
 * height-animated expand/collapse (content unmounts when fully collapsed).
 */
function MentorFolderCard({
  folder,
  index,
  animateEntrance,
  isCollapsed,
  onToggle,
  renderGroupItem,
}: {
  folder: MentorFolder;
  index: number;
  animateEntrance: boolean;
  isCollapsed: boolean;
  onToggle: (folderKey: string) => void;
  renderGroupItem: (group: Group) => React.ReactNode;
}) {
  const entrance = useRef(new Animated.Value(animateEntrance ? 0 : 1)).current;
  const chevronSpin = useRef(new Animated.Value(isCollapsed ? 0 : 1)).current;

  useEffect(() => {
    if (!animateEntrance) return;
    Animated.timing(entrance, {
      toValue: 1,
      duration: 280,
      delay: 60 + Math.min(index, MAX_STAGGERED_CARDS) * CARD_STAGGER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    Animated.spring(chevronSpin, {
      toValue: isCollapsed ? 0 : 1,
      friction: 6,
      tension: 180,
      useNativeDriver: true,
    }).start();
  }, [isCollapsed, chevronSpin]);

  // Same remount rule as GroupCard: animated wrapper only while animating.
  const folderBody = (
    <View style={styles.mentorFolderCard}>
        <TouchableScale
          style={styles.mentorFolderHeader}
          onPress={() => onToggle(folder.key)}
          accessibilityRole="button"
          accessibilityLabel={`${folder.title} folder, ${folder.groups.length} student groups. ${isCollapsed ? 'Collapsed' : 'Expanded'}`}
          accessibilityState={{ expanded: !isCollapsed }}
        >
          <View style={styles.mentorFolderHeaderLeft}>
            <View style={styles.mentorFolderIcon}>
              <Folder color={colors.primary} size={18} />
            </View>
            <View>
              <Text style={styles.mentorFolderTitle}>{folder.title}</Text>
              <Text style={styles.mentorFolderSubtitle}>
                {folder.groups.length} student group{folder.groups.length === 1 ? '' : 's'}
              </Text>
            </View>
          </View>
          <Animated.View
            style={{
              transform: [{
                rotate: chevronSpin.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '180deg'],
                }),
              }],
            }}
          >
            <ChevronDown color={colors.textSecondary} size={18} />
          </Animated.View>
        </TouchableScale>

        <Collapsible visible={!isCollapsed}>
          <View style={styles.mentorFolderContent}>
            {folder.groups.map((group) => (
              <View key={group._id} style={styles.mentorFolderGroupItem}>
                {renderGroupItem(group)}
              </View>
            ))}
          </View>
        </Collapsible>
      </View>
  );

  if (!animateEntrance) return folderBody;

  return <Animated.View style={{ opacity: entrance }}>{folderBody}</Animated.View>;
}

function Groups() {
  const { user } = useAuth();
  const { unreadCounts, socket } = useNotifications();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [activeFolderKey, setActiveFolderKey] = useState<string>('all');

  // Animation values for premium UI
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerScale = useRef(new Animated.Value(0.95)).current;
  // Cards stagger in only on the screen's first load; later refetches /
  // focus returns render instantly (cards read this ref at mount time).
  const entranceEnabledRef = useRef(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Premium page entry animation (header) + entrance gate expiry.
  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(headerScale, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
    const gateTimer = setTimeout(() => {
      entranceEnabledRef.current = false;
    }, 60 + MAX_STAGGERED_CARDS * CARD_STAGGER_MS + 500);
    return () => clearTimeout(gateTimer);
  }, []);

  // Declare fetchGroups first so hooks below can reference it.
  // showLoading=false keeps the current list on screen during pull-to-refresh
  // (skeletons are only for a cold start).
  const fetchGroups = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    try {
      const response = await api.get('/groups');
      setGroups(response.data);
    } catch (error) {
      Alert.alert('Error', 'Failed to fetch groups');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshGroups = useCallback(async () => {
    setIsRefreshing(true);
    await fetchGroups(false);
    setIsRefreshing(false);
  }, [fetchGroups]);

  // Refresh on tab focus (every time user navigates to this tab)
  useFocusEffect(
    useCallback(() => {
      fetchGroups();
    }, [fetchGroups])
  );

  // Refresh when app comes back to foreground
  useAppRefresh(fetchGroups);

  // Listen for real-time group_added/group_removed events from server
  useEffect(() => {
    if (!socket) return;
    socket.on('group_added', fetchGroups);
    socket.on('group_removed', fetchGroups);
    return () => {
      socket.off('group_added', fetchGroups);
      socket.off('group_removed', fetchGroups);
    };
  }, [socket, fetchGroups]);

  const normalizedGroupSearchQuery = groupSearchQuery.trim().toLowerCase();

  const sortGroupsByPriority = useCallback((groupList: Group[]) => {
    return [...groupList].sort((a, b) => {
      const unreadA = unreadCounts[a._id] || 0;
      const unreadB = unreadCounts[b._id] || 0;

      if (unreadA > 0 && unreadB === 0) return -1;
      if (unreadA === 0 && unreadB > 0) return 1;

      return a.name.localeCompare(b.name);
    });
  }, [unreadCounts]);

  const matchesGroupSearch = useCallback((group: Group) => {
    if (!normalizedGroupSearchQuery) return true;
    return (
      group.name.toLowerCase().includes(normalizedGroupSearchQuery) ||
      group.description?.toLowerCase().includes(normalizedGroupSearchQuery)
    );
  }, [normalizedGroupSearchQuery]);

  // Non-admin list behavior
  const filteredAndSortedGroups = useMemo(() => {
    return sortGroupsByPriority(groups.filter(matchesGroupSearch));
  }, [groups, matchesGroupSearch, sortGroupsByPriority]);

  // Admin view: show student groups in mentor-wise folders
  const { mentorFolders, otherGroups } = useMemo(() => {
    if (user?.role !== 'admin') {
      return {
        mentorFolders: [] as MentorFolder[],
        otherGroups: [] as Group[],
      };
    }

    const studentGroups: Group[] = [];
    const nonStudentGroups: Group[] = [];

    groups.forEach((group) => {
      const hasStudent = group.members?.some((member) => member.role === 'student');
      if ((group.type || 'general') === 'general' && hasStudent) {
        studentGroups.push(group);
      } else {
        nonStudentGroups.push(group);
      }
    });

    const foldersMap = new Map<string, MentorFolder>();

    const ensureFolder = (key: string, title: string, mentorEmail = '') => {
      if (!foldersMap.has(key)) {
        foldersMap.set(key, { key, title, mentorEmail, groups: [] });
      }
      return foldersMap.get(key)!;
    };

    studentGroups.forEach((group) => {
      const mentorsForGroup = new Map<string, User>();

      if (Array.isArray(group.mentors)) {
        group.mentors.forEach((mentor: any) => {
          if (mentor && typeof mentor === 'object' && mentor._id) {
            mentorsForGroup.set(String(mentor._id), mentor as User);
          }
        });
      }

      group.members?.forEach((member) => {
        if (member.role === 'mentor') {
          mentorsForGroup.set(member._id, member);
        }
      });

      if (mentorsForGroup.size === 0) {
        ensureFolder('unassigned', 'Unassigned').groups.push(group);
        return;
      }

      mentorsForGroup.forEach((mentor) => {
        ensureFolder(mentor._id, mentor.name, mentor.email || '').groups.push(group);
      });
    });

    const folders = Array.from(foldersMap.values())
      .map((folder) => {
        const mentorMatches = !!normalizedGroupSearchQuery && (
          folder.title.toLowerCase().includes(normalizedGroupSearchQuery) ||
          folder.mentorEmail.toLowerCase().includes(normalizedGroupSearchQuery)
        );

        const visibleGroups = sortGroupsByPriority(
          folder.groups.filter((group) => mentorMatches || matchesGroupSearch(group))
        );

        return {
          ...folder,
          groups: visibleGroups,
        };
      })
      .filter((folder) => folder.groups.length > 0)
      .sort((a, b) => {
        if (a.key === 'unassigned') return 1;
        if (b.key === 'unassigned') return -1;
        return a.title.localeCompare(b.title);
      });

    return {
      mentorFolders: folders,
      otherGroups: sortGroupsByPriority(nonStudentGroups.filter(matchesGroupSearch)),
    };
  }, [groups, matchesGroupSearch, normalizedGroupSearchQuery, sortGroupsByPriority, user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    setCollapsedFolders((prev) => {
      const next: Record<string, boolean> = {};
      mentorFolders.forEach((folder) => {
        next[folder.key] = prev[folder.key] ?? false;
      });
      return next;
    });
  }, [mentorFolders, user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    if (activeFolderKey === 'all') return;
    const exists = mentorFolders.some((folder) => folder.key === activeFolderKey);
    if (!exists) {
      setActiveFolderKey('all');
    }
  }, [mentorFolders, activeFolderKey, user?.role]);

  const visibleMentorFolders = useMemo(() => {
    if (activeFolderKey === 'all') return mentorFolders;
    return mentorFolders.filter((folder) => folder.key === activeFolderKey);
  }, [mentorFolders, activeFolderKey]);

  const openChat = (groupId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/chat/[id]', params: { id: groupId } });
  };

  const openEditModal = (group: Group) => {
    // Edit Group lives in an expo-router transparent-modal screen (see
    // app/edit-group.tsx) so its text inputs get real keyboard avoidance on
    // every Android version; the groups list refreshes on focus when it closes.
    router.push({
      pathname: '/edit-group',
      params: {
        groupId: group._id,
        name: group.name,
        description: group.description || '',
      },
    });
  };

  // Skeleton loading card component
  const SkeletonGroupCard = () => {
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
              colors={['transparent', 'rgba(1,180,174,0.1)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
        <View style={styles.skeletonContent}>
          <View style={styles.skeletonTitle}>
            <Animated.View style={[styles.shimmer, { transform: [{ translateX }] }]}>
              <LinearGradient
                colors={['transparent', 'rgba(1,180,174,0.1)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>
          <View style={styles.skeletonDescription}>
            <Animated.View style={[styles.shimmer, { transform: [{ translateX }] }]}>
              <LinearGradient
                colors={['transparent', 'rgba(1,180,174,0.1)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>
          <View style={styles.skeletonMemberCount}>
            <Animated.View style={[styles.shimmer, { transform: [{ translateX }] }]}>
              <LinearGradient
                colors={['transparent', 'rgba(1,180,174,0.1)', 'transparent']}
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

  // Inner (folder) items never stagger — only top-level cards do.
  const renderGroupItem = (group: Group) => (
    <GroupCard
      group={group}
      index={0}
      animateEntrance={false}
      unreadCount={unreadCounts[group._id] || 0}
      isAdmin={user?.role === 'admin'}
      onOpen={openChat}
      onEdit={openEditModal}
    />
  );

  const toggleFolder = (folderKey: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderKey]: !prev[folderKey],
    }));
  };

  return (
    <ScreenContainer style={styles.container}>
      {/* Premium Teal Gradient Header */}
      <Animated.View
        style={[
          styles.headerContainer,
          {
            opacity: headerOpacity,
            transform: [{ scale: headerScale }],
          }
        ]}
      >
        <LinearGradient
          colors={['#01b4ae', '#009c96']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerGradient}
        >
          <Text style={styles.title}>Groups</Text>
          {user?.role === 'admin' && (
            <Pressable
              style={styles.addButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.push('/create-group');
              }}
              onPressIn={() => {
                Animated.spring(headerScale, {
                  toValue: 0.95,
                  friction: 8,
                  useNativeDriver: true,
                }).start();
              }}
              onPressOut={() => {
                Animated.spring(headerScale, {
                  toValue: 1,
                  friction: 8,
                  useNativeDriver: true,
                }).start();
              }}
            >
              <Plus color="#FFFFFF" size={22} />
            </Pressable>
          )}
        </LinearGradient>
      </Animated.View>

      {/* Group Search Bar */}
      <View style={styles.groupSearchContainer}>
        <SearchBar
          value={groupSearchQuery}
          onChangeText={setGroupSearchQuery}
          placeholder={user?.role === 'admin' ? 'Search groups or mentors...' : 'Search groups...'}
        />
      </View>

      {user?.role === 'admin' && mentorFolders.length > 0 && (
        <View style={styles.folderTopStrip}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.folderTopStripContent}
          >
            <TouchableOpacity
              style={[
                styles.folderTopChip,
                activeFolderKey === 'all' && styles.folderTopChipActive
              ]}
              onPress={() => setActiveFolderKey('all')}
            >
              <Text
                style={[
                  styles.folderTopChipText,
                  activeFolderKey === 'all' && styles.folderTopChipTextActive
                ]}
              >
                All Folders ({mentorFolders.length})
              </Text>
            </TouchableOpacity>

            {mentorFolders.map((folder) => (
              <TouchableOpacity
                key={folder.key}
                style={[
                  styles.folderTopChip,
                  activeFolderKey === folder.key && styles.folderTopChipActive
                ]}
                onPress={() => setActiveFolderKey(folder.key)}
              >
                <Text
                  style={[
                    styles.folderTopChipText,
                    activeFolderKey === folder.key && styles.folderTopChipTextActive
                  ]}
                >
                  {folder.title} ({folder.groups.length})
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Groups List with Skeleton Loading */}
      {isLoading ? (
        <View style={styles.list}>
          {[1, 2, 3, 4, 5].map((key) => (
            <SkeletonGroupCard key={key} />
          ))}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {user?.role === 'admin' ? (
            <ScrollView
              contentContainerStyle={[styles.list, styles.adminScrollContent]}
              showsVerticalScrollIndicator={false}
              scrollIndicatorInsets={{ bottom: 120 }}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={refreshGroups}
                  tintColor={colors.primary}
                  colors={[colors.primary]}
                />
              }
            >
              {visibleMentorFolders.map((folder, index) => (
                <MentorFolderCard
                  key={folder.key}
                  folder={folder}
                  index={index}
                  animateEntrance={entranceEnabledRef.current}
                  isCollapsed={!!collapsedFolders[folder.key]}
                  onToggle={toggleFolder}
                  renderGroupItem={renderGroupItem}
                />
              ))}

              {activeFolderKey === 'all' && otherGroups.length > 0 && (
                <View style={styles.otherGroupsSection}>
                  <Text style={styles.otherGroupsTitle}>Other Groups</Text>
                  {otherGroups.map((group, index) => (
                    <GroupCard
                      key={group._id}
                      group={group}
                      index={visibleMentorFolders.length + index}
                      animateEntrance={entranceEnabledRef.current}
                      unreadCount={unreadCounts[group._id] || 0}
                      isAdmin
                      onOpen={openChat}
                      onEdit={openEditModal}
                    />
                  ))}
                </View>
              )}

              {visibleMentorFolders.length === 0 && otherGroups.length === 0 && (
                <View style={styles.emptyContainer}>
                  <View style={styles.emptyIconContainer}>
                    <MessageCircle color={colors.primary} size={44} />
                  </View>
                  <Text style={styles.emptyTitle}>
                    {groupSearchQuery.trim() ? 'No matching groups' : 'No groups yet'}
                  </Text>
                  <Text style={styles.emptySubtext}>
                    {groupSearchQuery.trim()
                      ? 'Try changing search text'
                      : 'Create your first group to get started'}
                  </Text>
                  <TouchableOpacity
                    style={styles.emptyCreateButton}
                    onPress={() => router.push('/create-group')}
                  >
                    <Plus color="#FFFFFF" size={20} />
                    <Text style={styles.emptyCreateButtonText}>Create Group</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          ) : (
            <FlatList
              data={filteredAndSortedGroups}
              renderItem={({ item, index }) => (
                <GroupCard
                  group={item}
                  index={index}
                  animateEntrance={entranceEnabledRef.current}
                  unreadCount={unreadCounts[item._id] || 0}
                  isAdmin={false}
                  onOpen={openChat}
                  onEdit={openEditModal}
                />
              )}
              keyExtractor={(item) => item._id}
              contentContainerStyle={[styles.list, styles.studentScrollContent]}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={refreshGroups}
                  tintColor={colors.primary}
                  colors={[colors.primary]}
                />
              }
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <View style={styles.emptyIconContainer}>
                    <MessageCircle color={colors.primary} size={44} />
                  </View>
                  <Text style={styles.emptyTitle}>No groups yet</Text>
                  <Text style={styles.emptySubtext}>
                    Create your first group to get started
                  </Text>
                </View>
              }
            />
          )}
        </View>
      )}

    </ScreenContainer>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  // Premium header with gradient
  headerContainer: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  headerGradient: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 24,
    paddingBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  addButton: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 50,
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  list: {
    padding: 20,
    gap: 12,
  },
  adminScrollContent: {
    paddingBottom: 140,
  },
  studentScrollContent: {
    paddingBottom: 120, // Enough to clear the tab bar for students/mentors
  },
  folderTopStrip: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 10,
  },
  folderTopStripContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  folderTopChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceMuted,
  },
  folderTopChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  folderTopChipText: {
    fontSize: 13,
    color: colors.textBody,
    fontWeight: '600',
  },
  folderTopChipTextActive: {
    color: colors.primaryText,
  },
  mentorFolderCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 12,
  },
  mentorFolderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  mentorFolderHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  mentorFolderIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mentorFolderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  mentorFolderSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  mentorFolderContent: {
    marginTop: 10,
  },
  mentorFolderGroupItem: {
    marginBottom: 0,
  },
  otherGroupsSection: {
    marginTop: 6,
  },
  otherGroupsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textBody,
    marginBottom: 10,
  },
  // Skeleton loading styles
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  skeletonAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryTint,
    overflow: 'hidden',
  },
  shimmer: {
    width: '100%',
    height: '100%',
  },
  groupSearchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  skeletonContent: {
    flex: 1,
    marginLeft: 14,
  },
  skeletonTitle: {
    height: 16,
    width: '60%',
    backgroundColor: colors.border,
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden',
  },
  skeletonDescription: {
    height: 13,
    width: '80%',
    backgroundColor: colors.border,
    borderRadius: 6,
    marginBottom: 10,
    overflow: 'hidden',
  },
  skeletonMemberCount: {
    height: 11,
    width: 80,
    backgroundColor: colors.border,
    borderRadius: 6,
    overflow: 'hidden',
  },
  // Group card — one soft neutral shadow; the icon tile carries the identity.
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  // Teal-tinted icon tile (approved change #1) — same language as the folder
  // icons beside it, replacing the lone blue bare icon.
  groupIconTile: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryTint,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupInfo: {
    marginLeft: 14,
    flex: 1,
  },
  groupName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  groupHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  unreadBadge: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    minWidth: 22,
    height: 20,
    paddingHorizontal: 7,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  groupDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  memberCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  memberText: {
    fontSize: 12.5,
    color: colors.textMuted,
    fontWeight: '500',
  },
  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyIconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primaryTint,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 21,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
  },
  emptyCreateButton: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  emptyCreateButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
// TEMPORARY FEATURE FREEZE — quiz-only availability (utils/featureAvailability.ts).
export default withFeatureGate('chat')(Groups);
