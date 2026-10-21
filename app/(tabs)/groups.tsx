import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { withFeatureGate } from '@/components/withFeatureGate';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  TextInput,
  Alert,
  ScrollView,
  Animated,
  Easing,
  Pressable,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Plus, MessageCircle, Users, Search, X, ChevronDown, ChevronUp, Pencil, Folder } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from '@/utils/haptics';
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
  const cardsOpacity = useRef(new Animated.Value(0)).current;
  const cardsSlideY = useRef(new Animated.Value(20)).current;

  // Premium page entry animation
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
      Animated.timing(cardsOpacity, {
        toValue: 1,
        duration: 500,
        delay: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardsSlideY, {
        toValue: 0,
        duration: 500,
        delay: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Declare fetchGroups first so hooks below can reference it
  const fetchGroups = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/groups');
      setGroups(response.data);
    } catch (error) {
      Alert.alert('Error', 'Failed to fetch groups');
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  const renderGroup = ({ item }: { item: Group }) => {
    const unreadCount = unreadCounts[item._id] || 0;

    return (
      <TouchableOpacity
        style={styles.groupCard}
        onPress={() => openChat(item._id)}
      >
        <MessageCircle color="#2563EB" size={24} />
        <View style={styles.groupInfo}>
          <View style={styles.groupHeaderRow}>
            <Text style={styles.groupName}>{item.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {user?.role === 'admin' && (
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation?.();
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    openEditModal(item);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Pencil color="#6B7280" size={16} />
                </TouchableOpacity>
              )}
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
                </View>
              )}
            </View>
          </View>
          <Text style={styles.groupDescription}>{item.description}</Text>
          <View style={styles.memberCount}>
            <Users color="#6B7280" size={16} />
            <Text style={styles.memberText}>{item.members.length} members</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const toggleFolder = (folderKey: string) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderKey]: !prev[folderKey],
    }));
  };

  const renderMentorFolder = ({ item }: { item: MentorFolder }) => {
    const isCollapsed = !!collapsedFolders[item.key];

    return (
      <View style={styles.mentorFolderCard}>
        <TouchableOpacity
          style={styles.mentorFolderHeader}
          onPress={() => toggleFolder(item.key)}
          activeOpacity={0.85}
        >
          <View style={styles.mentorFolderHeaderLeft}>
            <View style={styles.mentorFolderIcon}>
              <Folder color="#01b4ae" size={18} />
            </View>
            <View>
              <Text style={styles.mentorFolderTitle}>{item.title}</Text>
              <Text style={styles.mentorFolderSubtitle}>
                {item.groups.length} student group{item.groups.length === 1 ? '' : 's'}
              </Text>
            </View>
          </View>
          {isCollapsed ? <ChevronDown color="#6B7280" size={18} /> : <ChevronUp color="#6B7280" size={18} />}
        </TouchableOpacity>

        {!isCollapsed && (
          <View style={styles.mentorFolderContent}>
            {item.groups.map((group) => (
              <View key={group._id} style={styles.mentorFolderGroupItem}>
                {renderGroup({ item: group })}
              </View>
            ))}
          </View>
        )}
      </View>
    );
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
        <View style={styles.groupSearchInner}>
          <Search color="#6B7280" size={18} />
          <TextInput
            style={styles.groupSearchInput}
            placeholder={user?.role === 'admin' ? 'Search groups or mentors...' : 'Search groups...'}
            placeholderTextColor="#9CA3AF"
            value={groupSearchQuery}
            onChangeText={setGroupSearchQuery}
          />
          {groupSearchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setGroupSearchQuery('')}>
              <X color="#6B7280" size={18} />
            </TouchableOpacity>
          )}
        </View>
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
        <Animated.View
          style={[
            styles.list,
            {
              opacity: cardsOpacity,
              transform: [{ translateY: cardsSlideY }],
            }
          ]}
        >
          {[1, 2, 3, 4, 5].map((key) => (
            <SkeletonGroupCard key={key} />
          ))}
        </Animated.View>
      ) : (
        <Animated.View
          style={{
            flex: 1,
            opacity: cardsOpacity,
            transform: [{ translateY: cardsSlideY }],
          }}
        >
          {user?.role === 'admin' ? (
            <ScrollView
              contentContainerStyle={[styles.list, styles.adminScrollContent]}
              showsVerticalScrollIndicator={false}
              scrollIndicatorInsets={{ bottom: 120 }}
            >
              {visibleMentorFolders.map((folder) => (
                <View key={folder.key}>
                  {renderMentorFolder({ item: folder })}
                </View>
              ))}

              {activeFolderKey === 'all' && otherGroups.length > 0 && (
                <View style={styles.otherGroupsSection}>
                  <Text style={styles.otherGroupsTitle}>Other Groups</Text>
                  {otherGroups.map((group) => (
                    <View key={group._id}>
                      {renderGroup({ item: group })}
                    </View>
                  ))}
                </View>
              )}

              {visibleMentorFolders.length === 0 && otherGroups.length === 0 && (
                <View style={styles.emptyContainer}>
                  <View style={styles.emptyIconContainer}>
                    <MessageCircle color="#01b4ae" size={48} />
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
              renderItem={renderGroup}
              keyExtractor={(item) => item._id}
              contentContainerStyle={[styles.list, styles.studentScrollContent]}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <View style={styles.emptyIconContainer}>
                    <MessageCircle color="#01b4ae" size={48} />
                  </View>
                  <Text style={styles.emptyTitle}>No groups yet</Text>
                  <Text style={styles.emptySubtext}>
                    Create your first group to get started
                  </Text>
                </View>
              }
            />
          )}
        </Animated.View>
      )}

    </ScreenContainer>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  // Premium header with gradient
  headerContainer: {
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
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
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
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
    borderColor: '#D1D5DB',
    backgroundColor: '#F9FAFB',
  },
  folderTopChipActive: {
    borderColor: '#01b4ae',
    backgroundColor: '#E6FFFB',
  },
  folderTopChipText: {
    fontSize: 13,
    color: '#4B5563',
    fontWeight: '600',
  },
  folderTopChipTextActive: {
    color: '#0f766e',
  },
  mentorFolderCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
    backgroundColor: '#E0F7F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mentorFolderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1F2937',
  },
  mentorFolderSubtitle: {
    fontSize: 12,
    color: '#6B7280',
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
    color: '#374151',
    marginBottom: 10,
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
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E0F7F6',
    overflow: 'hidden',
  },
  shimmer: {
    width: '100%',
    height: '100%',
  },
  groupSearchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  groupSearchInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 12,
    // Grows with the user's font scale instead of clipping the input's text
    // at a hard 44dp.
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  groupSearchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 15,
    color: '#1F2937',
    paddingVertical: 8,
  },
  skeletonContent: {
    flex: 1,
    marginLeft: 16,
  },
  skeletonTitle: {
    height: 18,
    width: '60%',
    backgroundColor: '#E5E7EB',
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden',
  },
  skeletonDescription: {
    height: 14,
    width: '80%',
    backgroundColor: '#E5E7EB',
    borderRadius: 6,
    marginBottom: 10,
    overflow: 'hidden',
  },
  skeletonMemberCount: {
    height: 12,
    width: 80,
    backgroundColor: '#E5E7EB',
    borderRadius: 6,
    overflow: 'hidden',
  },
  // Premium group card
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 12,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  groupIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E0F7F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupInfo: {
    marginLeft: 16,
    flex: 1,
  },
  groupName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1F2937',
    flex: 1,
  },
  groupHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  unreadBadge: {
    backgroundColor: '#01b4ae',
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  groupDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 8,
  },
  memberCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memberText: {
    fontSize: 13,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  // Premium empty state
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyIconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#E0F7F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 32,
  },
  emptyCreateButton: {
    flexDirection: 'row',
    backgroundColor: '#01b4ae',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  emptyCreateButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  // Edit Group modal styles
});
// TEMPORARY FEATURE FREEZE — quiz-only availability (utils/featureAvailability.ts).
export default withFeatureGate('chat')(Groups);
