import { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, MessageCircle, Users, Search, X, Check } from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
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
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [newGroup, setNewGroup] = useState({
    name: '',
    description: '',
  });
  
  // Member selection state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchRole, setSearchRole] = useState<'mentor' | 'student'>('student');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [selectedMentors, setSelectedMentors] = useState<User[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      const response = await api.get('/groups');
      setGroups(response.data);
    } catch (error) {
      Alert.alert('Error', 'Failed to fetch groups');
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
      const selectedIds = [...selectedMentors, ...selectedStudents].map(u => u._id);
      const filtered = response.data.filter((u: User) => !selectedIds.includes(u._id));
      setSearchResults(filtered);
    } catch (error) {
      console.log('Search error:', error);
    } finally {
      setIsSearching(false);
    }
  }, [selectedMentors, selectedStudents]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery) {
        searchUsers(searchQuery, searchRole);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, searchRole, searchUsers]);

  const addMember = (userToAdd: User) => {
    if (userToAdd.role === 'mentor') {
      setSelectedMentors(prev => [...prev, userToAdd]);
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

  const resetModal = () => {
    setNewGroup({ name: '', description: '' });
    setSelectedMentors([]);
    setSelectedStudents([]);
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
      const memberIds = [...selectedMentors, ...selectedStudents].map(u => u._id);
      
      // Create the group with members in one request
      await api.post('/groups', {
        name: newGroup.name,
        description: newGroup.description,
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

  const renderGroup = ({ item }: { item: Group }) => (
    <TouchableOpacity
      style={styles.groupCard}
      onPress={() => openChat(item._id)}
    >
      <MessageCircle color="#2563EB" size={24} />
      <View style={styles.groupInfo}>
        <Text style={styles.groupName}>{item.name}</Text>
        <Text style={styles.groupDescription}>{item.description}</Text>
        <View style={styles.memberCount}>
          <Users color="#6B7280" size={16} />
          <Text style={styles.memberText}>{item.members.length} members</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderSelectedUser = (userItem: User, onRemove: () => void) => (
    <View key={userItem._id} style={styles.selectedChip}>
      <Text style={styles.chipText}>{userItem.name}</Text>
      <TouchableOpacity onPress={onRemove}>
        <X color="#6B7280" size={16} />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Groups</Text>
        {user?.role === 'admin' && (
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setIsModalVisible(true)}
          >
            <Plus color="#FFFFFF" size={20} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={groups}
        renderItem={renderGroup}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No groups yet</Text>
        }
      />

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

              {/* Role Toggle */}
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

              {/* Search Input */}
              <View style={styles.searchContainer}>
                <Search color="#6B7280" size={20} />
                <TextInput
                  style={styles.searchInput}
                  placeholder={`Search ${searchRole}s by name or email...`}
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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000000',
  },
  addButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    padding: 10,
  },
  list: {
    padding: 20,
    gap: 15,
  },
  emptyText: {
    textAlign: 'center',
    color: '#6B7280',
    fontSize: 16,
    marginTop: 40,
  },
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 15,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 10,
  },
  groupInfo: {
    marginLeft: 15,
    flex: 1,
  },
  groupName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  groupDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  memberCount: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 5,
  },
  memberText: {
    fontSize: 12,
    color: '#6B7280',
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
  textArea: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
    color: '#000000',
    textAlignVertical: 'top',
    height: 80,
    marginBottom: 20,
  },
  roleToggle: {
    flexDirection: 'row',
    marginBottom: 15,
    gap: 10,
  },
  roleButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  roleButtonActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  roleButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  roleButtonTextActive: {
    color: '#FFFFFF',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F9FAFB',
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    padding: 12,
    fontSize: 16,
    color: '#000000',
  },
  searchResults: {
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 15,
  },
  searchResultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  resultName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  resultEmail: {
    fontSize: 12,
    color: '#6B7280',
  },
  selectedSection: {
    marginBottom: 15,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 10,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E0E7FF',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
  },
  chipText: {
    fontSize: 14,
    color: '#3730A3',
  },
  createButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});