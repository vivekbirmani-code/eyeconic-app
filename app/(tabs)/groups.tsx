import { useState, useEffect, useCallback, useRef } from 'react';
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
  Easing,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, MessageCircle, Users, Search, X, Check, ChevronDown, ChevronUp } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from '@/utils/haptics';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { api } from '@/services/api';

interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
}

interface Group {
  _id: string;
  name: string;
  description: string;
  members: User[];
  createdBy: { name: string };
}

export default function Groups() {
  const { user } = useAuth();
  const { unreadCounts } = useNotifications();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [newGroup, setNewGroup] = useState({
    name: '',
    description: '',
    type: 'general' as 'general' | 'mentors' | 'admin',
  });

  // Member selection state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchRole, setSearchRole] = useState<'mentor' | 'student' | 'admin'>('student');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [selectedMentors, setSelectedMentors] = useState<User[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<User[]>([]);
  const [selectedAdmins, setSelectedAdmins] = useState<User[]>([]); // New state for admins
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

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

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/groups');
      setGroups(response.data);
    } catch (error) {
      Alert.alert('Error', 'Failed to fetch groups');
    } finally {
      setIsLoading(false);
    }
  };

  const searchUsers = useCallback(async (query: string, role: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await api.get(`/users/search?q=${query}&role=${role}`);
      // Filter out already selected users
      const selectedIds = [...selectedMentors, ...selectedStudents, ...selectedAdmins].map(u => u._id);
      const filtered = response.data.filter((u: User) => !selectedIds.includes(u._id));
      setSearchResults(filtered);
    } catch (error) {
      console.log('Search error:', error);
    } finally {
      setIsSearching(false);
    }
  }, [selectedMentors, selectedStudents, selectedAdmins]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery) {
        searchUsers(searchQuery, searchRole);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, searchRole, searchUsers]);

  const addMember = (userToAdd: User) => {
    // Validation based on group type
    if (newGroup.type === 'mentors' && userToAdd.role === 'student') {
      Alert.alert('Error', 'Mentors group cannot include students');
      return;
    }

    if (newGroup.type === 'admin' && userToAdd.role !== 'admin') {
      Alert.alert('Error', 'Admin group can only include admins');
      return;
    }

    if (newGroup.type === 'general' && userToAdd.role === 'student') {
      if (selectedStudents.length >= 1) {
        Alert.alert('Error', 'General group can only have 1 student');
        return;
      }
    }

    if (userToAdd.role === 'mentor') {
      setSelectedMentors(prev => [...prev, userToAdd]);
    } else if (userToAdd.role === 'admin') {
      setSelectedAdmins(prev => [...prev, userToAdd]);
    } else {
      setSelectedStudents(prev => [...prev, userToAdd]);
    }
    setSearchResults(prev => prev.filter(u => u._id !== userToAdd._id));
    setSearchQuery('');
  };

  const removeMentor = (userId: string) => {
    setSelectedMentors(prev => prev.filter(u => u._id !== userId));
  };

  const removeStudent = (userId: string) => {
    setSelectedStudents(prev => prev.filter(u => u._id !== userId));
  };
  
  const removeAdmin = (userId: string) => {
    setSelectedAdmins(prev => prev.filter(u => u._id !== userId));
  };

  const resetModal = () => {
    setNewGroup({ name: '', description: '', type: 'general' });
    setSelectedMentors([]);
    setSelectedStudents([]);
    setSelectedAdmins([]);
    setSearchQuery('');
    setSearchResults([]);
    setIsModalVisible(false);
  };

  const createGroup = async () => {
    if (!newGroup.name) {
      Alert.alert('Error', 'Please enter a group name');
      return;
    }

    try {
      // Collect all member IDs
      const memberIds = [...selectedMentors, ...selectedStudents, ...selectedAdmins].map(u => u._id);

      // Create the group with members in one request
      await api.post('/groups', {
        name: newGroup.name,
        description: newGroup.description,
        type: newGroup.type,
        memberIds: memberIds
      });

      resetModal();
      fetchGroups();
      Alert.alert('Success', 'Group created successfully with ' + (memberIds.length + 1) + ' members');
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to create group';
      Alert.alert('Error', message);
    }
  };

  const openChat = (groupId: string) => {
    router.push({ pathname: '/chat/[id]', params: { id: groupId } });
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
            {unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
              </View>
            )}
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

  /* eslint-disable react/display-name */
  const renderSelectedUser = (userItem: User, onRemove: () => void) => (
    <View key={userItem._id} style={styles.selectedChip}>
      <Text style={styles.chipText}>{userItem.name} ({userItem.role})</Text>
      <TouchableOpacity onPress={onRemove}>
        <X color="#6B7280" size={16} />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
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
                setIsModalVisible(true);
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
          <FlatList
            data={groups}
            renderItem={renderGroup}
            keyExtractor={(item) => item._id}
            contentContainerStyle={styles.list}
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
                {user?.role === 'admin' && (
                  <TouchableOpacity
                    style={styles.emptyCreateButton}
                    onPress={() => setIsModalVisible(true)}
                  >
                    <Plus color="#FFFFFF" size={20} />
                    <Text style={styles.emptyCreateButtonText}>Create Group</Text>
                  </TouchableOpacity>
                )}
              </View>
            }
          />
        </Animated.View>
      )}

      {user?.role === 'admin' && (
        <Modal visible={isModalVisible} animationType="slide">
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Group</Text>
              <TouchableOpacity onPress={resetModal}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              {/* Group Details */}
              <TextInput
                style={styles.input}
                placeholder="Group Name"
                placeholderTextColor="#9CA3AF"
                value={newGroup.name}
                onChangeText={(text) => setNewGroup({ ...newGroup, name: text })}
              />
              <TextInput
                style={styles.textArea}
                placeholder="Description (optional)"
                placeholderTextColor="#9CA3AF"
                value={newGroup.description}
                onChangeText={(text) => setNewGroup({ ...newGroup, description: text })}
                multiline
                numberOfLines={3}
              />

              {/* Group Type Selection */}
              {/* Group Type Selection Dropdown */}
              <View style={styles.typeContainer}>
                <Text style={styles.sectionLabel}>Group Type</Text>
                
                <TouchableOpacity 
                  style={styles.dropdownButton} 
                  onPress={() => setIsDropdownOpen(!isDropdownOpen)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.dropdownButtonText}>
                    {newGroup.type.charAt(0).toUpperCase() + newGroup.type.slice(1)}
                  </Text>
                  {isDropdownOpen ? <ChevronUp size={20} color="#6B7280" /> : <ChevronDown size={20} color="#6B7280" />}
                </TouchableOpacity>

                {isDropdownOpen && (
                  <View style={styles.dropdownContainer}>
                    {(['general', 'mentors', 'admin'] as const).map((type) => (
                      <TouchableOpacity
                        key={type}
                        style={[
                          styles.dropdownItem,
                          newGroup.type === type && styles.dropdownItemActive
                        ]}
                        onPress={() => {
                          setNewGroup({ ...newGroup, type });
                          setIsDropdownOpen(false);
                          
                          // Update search role and clear invalid selections based on type
                          if (type === 'mentors') {
                              setSearchRole('mentor');
                              setSelectedStudents([]);
                              setSelectedAdmins([]);
                          } else if (type === 'admin') {
                              setSearchRole('admin');
                              setSelectedStudents([]);
                              setSelectedMentors([]);
                          } else {
                              setSearchRole('student'); // Default for general
                              if (selectedStudents.length > 1) {
                                  setSelectedStudents([selectedStudents[0]]);
                              }
                              setSelectedAdmins([]);
                          }
                        }}
                      >
                        <Text style={styles.dropdownItemText}>{type.charAt(0).toUpperCase() + type.slice(1)}</Text>
                        {newGroup.type === type && <Check size={16} color="#01b4ae" />}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                <Text style={styles.typeDescription}>
                    {newGroup.type === 'general' ? 'Allows Mentors & 1 Student' : 
                     newGroup.type === 'mentors' ? 'Only Mentors (No Students)' : 
                     'Only Admins allowed'}
                </Text>
              </View>

              {/* Role Toggle - Conditionally Rendered */}
              {newGroup.type === 'general' && (
                <View style={styles.roleToggle}>
                    <TouchableOpacity
                    style={[styles.roleButton, searchRole === 'mentor' && styles.roleButtonActive]}
                    onPress={() => { setSearchRole('mentor'); setSearchQuery(''); setSearchResults([]); }}
                    >
                    <Text style={[styles.roleButtonText, searchRole === 'mentor' && styles.roleButtonTextActive]}>
                        Mentors
                    </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                    style={[styles.roleButton, searchRole === 'student' && styles.roleButtonActive]}
                    onPress={() => { setSearchRole('student'); setSearchQuery(''); setSearchResults([]); }}
                    >
                    <Text style={[styles.roleButtonText, searchRole === 'student' && styles.roleButtonTextActive]}>
                        Students
                    </Text>
                    </TouchableOpacity>
                </View>
              )}
                
              {/* Informational Text for fixed roles */}
              {newGroup.type !== 'general' && (
                  <View style={styles.fixedRoleContainer}>
                      <Text style={styles.fixedRoleText}>
                          Adding: <Text style={{fontWeight: 'bold'}}>{newGroup.type === 'admin' ? 'Admins' : 'Mentors'}</Text>
                      </Text>
                  </View>
              )}

              {/* Search Input */}
              <View style={styles.searchContainer}>
                <Search color="#6B7280" size={20} />
                <TextInput
                  style={styles.searchInput}
                  placeholder={`Search ${searchRole}s by name...`}
                  placeholderTextColor="#9CA3AF"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <View style={styles.searchResults}>
                  {searchResults.map((result) => (
                    <TouchableOpacity
                      key={result._id}
                      style={styles.searchResultItem}
                      onPress={() => addMember(result)}
                    >
                      <View>
                        <Text style={styles.resultName}>{result.name}</Text>
                        <Text style={styles.resultEmail}>{result.email}</Text>
                      </View>
                      <Check color="#22C55E" size={20} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Selected Admins */}
              {selectedAdmins.length > 0 && (
                <View style={styles.selectedSection}>
                  <Text style={styles.sectionLabel}>Selected Admins ({selectedAdmins.length})</Text>
                  <View style={styles.chipsContainer}>
                    {selectedAdmins.map((a) => renderSelectedUser(a, () => removeAdmin(a._id)))}
                  </View>
                </View>
              )}

              {/* Selected Mentors */}
              {selectedMentors.length > 0 && (
                <View style={styles.selectedSection}>
                  <Text style={styles.sectionLabel}>Selected Mentors ({selectedMentors.length})</Text>
                  <View style={styles.chipsContainer}>
                    {selectedMentors.map((m) => renderSelectedUser(m, () => removeMentor(m._id)))}
                  </View>
                </View>
              )}

              {/* Selected Students */}
              {selectedStudents.length > 0 && (
                <View style={styles.selectedSection}>
                  <Text style={styles.sectionLabel}>Selected Students ({selectedStudents.length})</Text>
                  <View style={styles.chipsContainer}>
                    {selectedStudents.map((s) => renderSelectedUser(s, () => removeStudent(s._id)))}
                  </View>
                </View>
              )}

              <TouchableOpacity style={styles.createButton} onPress={createGroup}>
                <Text style={styles.createButtonText}>Create Group</Text>
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
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
  typeDescription: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 6,
    fontStyle: 'italic',
    textAlign: 'center'
  },
  fixedRoleContainer: {
    marginBottom: 16,
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#F3F4F6',
    borderRadius: 8
  },
  fixedRoleText: {
    fontSize: 14,
    color: '#4B5563'
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
  // Modal styles
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
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  cancelText: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
    color: '#1F2937',
    marginBottom: 16,
  },
  textArea: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
    color: '#1F2937',
    textAlignVertical: 'top',
    height: 100,
    marginBottom: 20,
  },
  roleToggle: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 4,
    marginBottom: 20,
  },
  typeContainer: {
    marginBottom: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  // Dropdown Styles
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 4,
  },
  dropdownButtonText: {
    fontSize: 16,
    color: '#1F2937',
    fontWeight: '500',
  },
  dropdownContainer: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  dropdownItemActive: {
    backgroundColor: '#F0FDFA',
  },
  dropdownItemText: {
    fontSize: 16,
    color: '#374151',
  },
  roleButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  roleButtonActive: {
    backgroundColor: '#01b4ae',
    borderColor: '#01b4ae',
  },
  roleButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7280',
  },
  roleButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: '#F9FAFB',
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    padding: 14,
    fontSize: 16,
    color: '#1F2937',
  },
  searchResults: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 16,
    overflow: 'hidden',
  },
  searchResultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  resultName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
  },
  resultEmail: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  selectedSection: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 12,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E0F7F6',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: '#01b4ae',
  },
  chipText: {
    fontSize: 14,
    color: '#01b4ae',
    fontWeight: '600',
  },
  createButton: {
    backgroundColor: '#01b4ae',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 40,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
});