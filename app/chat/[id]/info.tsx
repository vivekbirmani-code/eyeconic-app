import { useCallback, useState } from 'react';
import { withFeatureGate } from '@/components/withFeatureGate';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Users, UserPlus } from 'lucide-react-native';
import { FullScreenContainer } from '@/components/layout';
import { useAuth } from '@/context/AuthContext';
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
  description: string;
  members: User[];
  createdBy: User;
  createdAt: string;
}

interface Subject {
  _id: string;
  name: string;
  year?: string;
}

// Group Info screen. Presented as a regular stack screen (not a RN Modal) so
// safe-area insets apply and the native iOS edge-swipe / Android back
// navigation work.
function GroupInfoScreen() {
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [group, setGroup] = useState<Group | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Each student member's assigned subjects, keyed by student id.
  // Subjects belong to the student (not the group); this view only surfaces
  // the existing per-student assignments.
  const [subjectsByStudent, setSubjectsByStudent] = useState<Record<string, Subject[]>>({});
  const [subjectsStatus, setSubjectsStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const fetchGroup = useCallback(async () => {
    if (!groupId) return;
    try {
      const response = await api.get(`/groups/${groupId}`);
      setGroup(response.data);
    } catch (error) {
      Alert.alert('Error', 'Failed to load group');
      router.back();
    } finally {
      setIsLoading(false);
    }
  }, [groupId, router]);

  const fetchMemberSubjects = useCallback(async () => {
    if (!groupId) return;
    try {
      const response = await api.get(`/groups/${groupId}/student-subjects`);
      setSubjectsByStudent(response.data?.subjectsByStudent ?? {});
      setSubjectsStatus('ready');
    } catch (error) {
      console.error('Error fetching member subjects:', error);
      setSubjectsStatus('error');
    }
  }, [groupId]);

  // Refetch every time the screen comes into focus (initial open and when
  // returning from Add Participants) so member/subject changes are reflected
  // immediately, with no stale data.
  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      setSubjectsStatus('loading');
      fetchGroup();
      fetchMemberSubjects();
    }, [fetchGroup, fetchMemberSubjects])
  );

  const removeMember = async (userId: string) => {
    Alert.alert(
      'Remove Member',
      'Are you sure you want to remove this member from the group?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/groups/${groupId}/members/${userId}`);
              fetchGroup();
              fetchMemberSubjects();
            } catch (error: any) {
              Alert.alert('Error', error?.response?.data?.message || 'Failed to remove member');
            }
          }
        }
      ]
    );
  };

  // Renders a student member's own assigned subjects under their row.
  // Never blocks or breaks the member list: loading, error and empty
  // states degrade to small inline hints.
  const renderMemberSubjects = (member: User) => {
    if (subjectsStatus === 'loading') {
      return (
        <View style={styles.memberSubjectsLoading}>
          <ActivityIndicator size="small" color="#01b4ae" />
        </View>
      );
    }

    if (subjectsStatus === 'error') {
      return (
        <Text style={styles.memberSubjectsHint}>Subjects unavailable</Text>
      );
    }

    const subjects = subjectsByStudent[member._id];
    if (!subjects || subjects.length === 0) {
      return (
        <Text style={styles.memberSubjectsHint}>No subjects assigned</Text>
      );
    }

    return (
      <View style={styles.memberSubjectsRow}>
        {subjects.map((subject) => (
          <View key={subject._id} style={styles.memberSubjectChip}>
            <Text style={styles.memberSubjectChipText}>{subject.name}</Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <FullScreenContainer style={styles.container}>
      <View style={styles.modalHeader}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color="#000000" size={24} />
        </TouchableOpacity>
        <Text style={styles.modalTitle}>Group Info</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={{ flex: 1 }}>
        <FlatList
          data={group?.members || []}
          keyExtractor={(item) => item._id}
          style={{ flex: 1 }}
          contentContainerStyle={group ? { paddingBottom: 40 } : styles.loadingContainer}
          showsVerticalScrollIndicator={true}
          removeClippedSubviews={false}
          nestedScrollEnabled={true}
          scrollEnabled={true}
          ListEmptyComponent={
            isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#01b4ae" />
              </View>
            ) : (
              <View style={styles.loadingContainer}>
                <Text style={styles.emptyText}>No members found</Text>
              </View>
            )
          }
          ListHeaderComponent={() => (
            <>
              {group && (
                <>
                  <View style={styles.groupProfileSection}>
                    <View style={styles.largeGroupIcon}>
                      <Users color="#FFFFFF" size={40} />
                    </View>
                    <Text style={styles.largeGroupName}>{group?.name}</Text>
                    {group?.description ? (
                      <Text style={styles.groupDescription}>{group.description}</Text>
                    ) : null}
                    <Text style={styles.groupMeta}>
                      Created by {group?.createdBy?.name} • {new Date(group?.createdAt || '').toLocaleDateString()}
                    </Text>
                  </View>

                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{group?.members?.length || 0} participants</Text>
                  </View>

                  {user?.role === 'admin' && (
                    <TouchableOpacity
                      style={styles.addMemberRow}
                      onPress={() => router.push(`/chat/${groupId}/add-members` as any)}
                    >
                      <View style={styles.addMemberIcon}>
                        <UserPlus color="#2563EB" size={20} />
                      </View>
                      <Text style={styles.addMemberText}>Add Participants</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </>
          )}
          renderItem={({ item: member }) => (
            <View key={member._id} style={styles.memberRow}>
              <UserAvatar
                name={member.name}
                role={member.role}
                imageUrl={member.profilePicture}
                size={40}
              />
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>
                  {member._id === user?._id ? 'You' : member.name}
                </Text>
                <Text style={styles.memberEmail}>{member.role}</Text>
                {member.role === 'student' && renderMemberSubjects(member)}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {group?.createdBy?._id === member._id && (
                  <Text style={styles.adminBadge}>Group Admin</Text>
                )}
                {user?.role === 'admin' && member._id !== group?.createdBy?._id && (
                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => removeMember(member._id)}
                  >
                    <Text style={styles.removeText}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        />
      </View>
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
  groupProfileSection: {
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  largeGroupIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#01b4ae',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  largeGroupName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 5,
    textAlign: 'center',
  },
  groupDescription: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 5,
  },
  groupMeta: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  sectionHeader: {
    padding: 15,
    backgroundColor: '#F9FAFB',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  addMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  addMemberIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E0F7F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  addMemberText: {
    fontSize: 16,
    color: '#01b4ae',
    fontWeight: '600',
  },
  memberRow: {
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
  // Student subject chips — same palette as the Assigned Subjects chips in
  // User Details, scaled down to fit the member row.
  memberSubjectsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  memberSubjectChip: {
    backgroundColor: '#E0F7F6',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B2F5EA',
  },
  memberSubjectChipText: {
    color: '#00796B',
    fontSize: 11,
    fontWeight: '600',
  },
  memberSubjectsHint: {
    fontSize: 12,
    color: '#9CA3AF',
    fontStyle: 'italic',
    marginTop: 4,
  },
  memberSubjectsLoading: {
    marginTop: 6,
  },
  adminBadge: {
    fontSize: 11,
    color: '#01b4ae',
    backgroundColor: '#E0F7F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 2,
    fontWeight: '700',
  },
  removeButton: {
    marginTop: 4,
  },
  removeText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6B7280',
  },
});
// TEMPORARY FEATURE FREEZE — quiz-only availability (utils/featureAvailability.ts).
export default withFeatureGate('chat')(GroupInfoScreen);
