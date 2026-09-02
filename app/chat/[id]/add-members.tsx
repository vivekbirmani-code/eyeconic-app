import { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { X, Search, Check } from 'lucide-react-native';
import { FullScreenContainer } from '@/components/layout';
import { api } from '@/services/api';
import UserAvatar from '@/components/UserAvatar';

interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
  profilePicture?: string | null;
}

interface Group {
  _id: string;
  name: string;
  members: User[];
}

// Add Participants screen for a chat group. Presented as a regular stack
// screen (not a RN Modal) so safe-area insets apply, the native iOS
// edge-swipe / Android back navigation work, and the search input behaves
// correctly with the keyboard on Android.
export default function AddMembersScreen() {
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [group, setGroup] = useState<Group | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [selectedNewMembers, setSelectedNewMembers] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [groupRes, usersRes] = await Promise.all([
          api.get(`/groups/${groupId}`),
          api.get('/users'),
        ]);
        setGroup(groupRes.data);
        setAllUsers(usersRes.data);
      } catch (error) {
        console.log('Error fetching data', error);
        Alert.alert('Error', 'Failed to load users');
      } finally {
        setIsLoading(false);
      }
    };
    if (groupId) {
      loadData();
    }
  }, [groupId]);

  const filteredUsersToAdd = useMemo(() => {
    if (!group) return [];

    const currentMemberIds = group.members.map(m => m._id);

    return allUsers.filter(u =>
      !currentMemberIds.includes(u._id) &&
      (u.name.toLowerCase().includes(memberSearchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(memberSearchQuery.toLowerCase()))
    );
  }, [allUsers, group, memberSearchQuery]);

  const toggleUserSelection = (userId: string) => {
    setSelectedNewMembers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const addMembers = async () => {
    if (selectedNewMembers.length === 0 || isAdding) return;
    setIsAdding(true);

    try {
      await api.post(`/groups/${groupId}/members`, { userIds: selectedNewMembers });
      Alert.alert('Success', 'Members added successfully');
      router.back();
    } catch (error: any) {
      Alert.alert('Error', error?.response?.data?.message || 'Failed to add members');
      setIsAdding(false);
    }
  };

  return (
    <FullScreenContainer style={styles.container}>
      <View style={styles.modalHeader}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Close add participants"
        >
          <X color="#000000" size={24} />
        </TouchableOpacity>
        <Text style={styles.modalTitle}>Add Participants</Text>
        {selectedNewMembers.length > 0 ? (
          <TouchableOpacity onPress={addMembers} disabled={isAdding}>
            <Text style={styles.doneButtonText}>Add ({selectedNewMembers.length})</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      <View style={styles.searchContainer}>
        <Search color="#6B7280" size={20} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search users..."
          placeholderTextColor="#9CA3AF"
          value={memberSearchQuery}
          onChangeText={setMemberSearchQuery}
        />
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#01b4ae" />
        </View>
      ) : (
        <FlatList
          data={filteredUsersToAdd}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.userList}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.userSelectRow}
              onPress={() => toggleUserSelection(item._id)}
            >
              <UserAvatar
                name={item.name}
                role={item.role}
                imageUrl={item.profilePicture}
                size={40}
              />
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{item.name}</Text>
                <Text style={styles.memberEmail}>{item.email} • {item.role}</Text>
              </View>
              <View style={[
                styles.checkbox,
                selectedNewMembers.includes(item._id) && styles.checkboxSelected
              ]}>
                {selectedNewMembers.includes(item._id) && (
                  <Check color="#FFFFFF" size={16} />
                )}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No users found</Text>
          }
        />
      )}
    </FullScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    padding: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#F3F4F6',
    margin: 10,
    borderRadius: 8,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
    color: '#000000',
  },
  userList: {
    paddingBottom: 20,
  },
  userSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000000',
  },
  memberEmail: {
    fontSize: 13,
    color: '#6B7280',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#01b4ae',
    borderColor: '#01b4ae',
  },
  doneButtonText: {
    color: '#01b4ae',
    fontSize: 16,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6B7280',
    textAlign: 'center',
    padding: 20,
  },
});
