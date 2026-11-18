import { useMemo, useState, useEffect, useRef } from 'react';
import { withFeatureGate } from '@/components/withFeatureGate';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, UserPlus } from 'lucide-react-native';
import { FullScreenContainer } from '@/components/layout';
import { colors } from '@/utils/theme';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import { Toast } from '@/components/Toast';
import { api } from '@/services/api';
import UserAvatar from '@/components/UserAvatar';

/**
 * Selection circle with a springy check pop when it turns on.
 */
function SpringCheckbox({ selected }: { selected: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!selected) return;
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.3, speed: 40, bounciness: 7, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 220, useNativeDriver: true }),
    ]).start();
  }, [selected, scale]);

  return (
    <Animated.View
      style={[
        styles.checkbox,
        selected && styles.checkboxSelected,
        { transform: [{ scale: selected ? scale : 1 }] },
      ]}
    >
      {selected && <Check color="#FFFFFF" size={15} />}
    </Animated.View>
  );
}

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
function AddMembersScreen() {
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
      Toast.show(
        selectedNewMembers.length === 1
          ? 'Member added'
          : `${selectedNewMembers.length} members added`
      );
      router.back();
    } catch (error: any) {
      Alert.alert('Error', error?.response?.data?.message || 'Failed to add members');
      setIsAdding(false);
    }
  };

  return (
    <FullScreenContainer style={styles.container}>
      <ScreenHeader
        title="Add Participants"
        onBack={() => router.back()}
        backIcon="x"
        backAccessibilityLabel="Close add participants"
        right={
          selectedNewMembers.length > 0 ? (
            <TouchableOpacity
              onPress={addMembers}
              disabled={isAdding}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Add ${selectedNewMembers.length} participants`}
            >
              <View style={styles.addButtonRow}>
                {isAdding ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : null}
                <Text style={styles.doneButtonText}>
                  {isAdding ? 'Adding…' : `Add (${selectedNewMembers.length})`}
                </Text>
              </View>
            </TouchableOpacity>
          ) : undefined
        }
      />

      <View style={styles.searchContainer}>
        <SearchBar
          value={memberSearchQuery}
          onChangeText={setMemberSearchQuery}
          placeholder="Search users..."
        />
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
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
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`Select ${item.name}`}
            >
              <UserAvatar
                name={item.name}
                role={item.role}
                imageUrl={item.profilePicture}
                size={42}
              />
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{item.name}</Text>
                <Text style={styles.memberEmail} numberOfLines={1}>{item.email} • {item.role}</Text>
              </View>
              <SpringCheckbox selected={selectedNewMembers.includes(item._id)} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconContainer}>
                <UserPlus color={colors.textMuted} size={34} />
              </View>
              <Text style={styles.emptyTitle}>No users found</Text>
              <Text style={styles.emptySubtext}>Try a different name or email</Text>
            </View>
          }
        />
      )}
    </FullScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  addButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  doneButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  searchContainer: {
    padding: 10,
  },
  userList: {
    paddingBottom: 20,
  },
  userSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceMuted,
  },
  memberInfo: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  memberName: {
    fontSize: 15.5,
    fontWeight: '600',
    color: colors.text,
  },
  memberEmail: {
    fontSize: 12.5,
    color: colors.textMuted,
    marginTop: 1,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  emptySubtext: {
    fontSize: 13.5,
    color: colors.textMuted,
    marginTop: 4,
  },
});
// TEMPORARY FEATURE FREEZE — quiz-only availability (utils/featureAvailability.ts).
export default withFeatureGate('chat')(AddMembersScreen);
