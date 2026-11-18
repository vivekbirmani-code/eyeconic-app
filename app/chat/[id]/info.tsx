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
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Users, UserPlus, GraduationCap, Trash2, AlertTriangle, Pencil } from 'lucide-react-native';
import { FullScreenContainer } from '@/components/layout';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';
import * as Haptics from '@/utils/haptics';
import { colors } from '@/utils/theme';
import ScreenHeader from '@/components/ScreenHeader';
import { Toast } from '@/components/Toast';
import UserAvatar, { getRoleColors } from '@/components/UserAvatar';
import InternTimeSlicer from '@/components/intern/InternTimeSlicer';

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
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  // Pull-to-refresh: refetch without flashing the full-screen loader.
  const refreshInfo = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([fetchGroup(), fetchMemberSubjects()]);
    setIsRefreshing(false);
  }, [fetchGroup, fetchMemberSubjects]);

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

  // Delete Group (Admin only). Destructive and irreversible, so it always
  // confirms first: the alert names the group and spells out the blast radius
  // (entire chat history, removed for every member). The destructive button
  // style keeps it visually distinct from Cancel.
  const confirmDeleteGroup = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Delete Group',
      `Delete "${group?.name}" and its entire chat history? The group will be removed for all ${group?.members?.length ?? 0} members. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Group',
          style: 'destructive',
          onPress: performDeleteGroup,
        },
      ]
    );
  };

  const performDeleteGroup = async () => {
    if (isDeletingGroup) return;
    try {
      setIsDeletingGroup(true);
      await api.delete(`/groups/${groupId}`);
      Haptics.successNotification();
      // The chat screen below only reacts to the live 'group_deleted' socket
      // event when it is the focused screen — while Group Info is on top it
      // stays quiet, so this screen owns the navigation. dismissTo pops the
      // whole chat stack and lands on the Groups tab, which refetches on
      // focus so the deleted group is gone immediately. The toast (global
      // host) confirms the deletion on arrival.
      router.dismissTo('/(tabs)/groups' as any);
      Toast.show('Group deleted');
    } catch (error: any) {
      setIsDeletingGroup(false);
      Haptics.errorNotification();
      Alert.alert('Error', error?.response?.data?.message || 'Failed to delete group');
    }
  };

  // Renders a student member's own assigned subjects under their row.
  // Never blocks or breaks the member list: loading, error and empty
  // states degrade to small inline hints.
  const renderMemberSubjects = (member: User) => {
    if (subjectsStatus === 'loading') {
      return (
        <View style={styles.memberSubjectsLoading}>
          <ActivityIndicator size="small" color={colors.primary} />
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
      <ScreenHeader
        title="Group Info"
        onBack={() => router.back()}
        right={
          user?.role === 'admin' && group ? (
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({
                  pathname: '/edit-group',
                  params: {
                    groupId: group._id,
                    name: group.name,
                    description: group.description || '',
                  },
                } as any);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${group.name}`}
            >
              <Pencil color={colors.primary} size={20} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      <View style={{ flex: 1 }}>
        <FlatList
          data={group?.members || []}
          keyExtractor={(item) => item._id}
          style={{ flex: 1 }}
          contentContainerStyle={group ? { paddingBottom: 40 } : styles.loadingContainer}
          showsVerticalScrollIndicator={true}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refreshInfo}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          removeClippedSubviews={false}
          nestedScrollEnabled={true}
          scrollEnabled={true}
          ListEmptyComponent={
            isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              <View style={styles.loadingContainer}>
                <Text style={styles.emptyText}>No members found</Text>
              </View>
            )
          }
          ListFooterComponent={() =>
            // Danger zone for admins — kept at the very bottom of the list,
            // well away from the per-member actions, with a caption that
            // states the consequence before the tap.
            user?.role === 'admin' && group ? (
              <View style={styles.deleteGroupSection}>
                <TouchableOpacity
                  style={styles.deleteGroupButton}
                  onPress={confirmDeleteGroup}
                  disabled={isDeletingGroup}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Delete group"
                  accessibilityHint="Permanently deletes this group and its chat history for all members"
                >
                  {isDeletingGroup ? (
                    <ActivityIndicator size="small" color={colors.dangerDark} />
                  ) : (
                    <Trash2 color={colors.dangerDark} size={18} />
                  )}
                  <Text style={styles.deleteGroupButtonText}>
                    {isDeletingGroup ? 'Deleting…' : 'Delete Group'}
                  </Text>
                </TouchableOpacity>
                <View style={styles.deleteGroupHintRow}>
                  <AlertTriangle color={colors.warning} size={13} />
                  <Text style={styles.deleteGroupHintText}>
                    Permanently deletes this group and its entire chat history for all members.
                  </Text>
                </View>
              </View>
            ) : null
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

                  {/* Intern Mode: time slicer under the group description —
                      renders nothing for non-intern students. */}
                  {user?.role === 'student' && <InternTimeSlicer />}

                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{group?.members?.length || 0} participants</Text>
                  </View>

                  {user?.role === 'admin' && (
                    <TouchableOpacity
                      style={styles.addMemberRow}
                      onPress={() => router.push(`/chat/${groupId}/add-members` as any)}
                    >
                      <View style={styles.addMemberIcon}>
                        <UserPlus color={colors.primary} size={20} />
                      </View>
                      <Text style={styles.addMemberText}>Add Participants</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </>
          )}
          renderItem={({ item: member }) => {
            const roleColors = getRoleColors(member.role);
            return (
              <View key={member._id} style={styles.memberRow}>
                <UserAvatar
                  name={member.name}
                  role={member.role}
                  imageUrl={member.profilePicture}
                  size={42}
                />
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>
                    {member._id === user?._id ? 'You' : member.name}
                  </Text>
                  <View style={styles.roleChipRow}>
                    <View style={[styles.roleChip, { backgroundColor: roleColors.background }]}>
                      <Text style={[styles.roleChipText, { color: roleColors.text }]}>
                        {member.role}
                      </Text>
                    </View>
                  </View>
                  {member.role === 'student' && renderMemberSubjects(member)}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {group?.createdBy?._id === member._id && (
                    <Text style={styles.adminBadge}>Group Admin</Text>
                  )}
                  {/* Intern Mode: admins (Users tab stays frozen) and mentors can
                      reach the toggle from any student in any group. */}
                  {member.role === 'student' && (user?.role === 'admin' || user?.role === 'mentor') && (
                    <TouchableOpacity
                      style={styles.internPill}
                      onPress={() => {
                        router.push(`/intern-manage/${member._id}` as any);
                      }}
                      accessibilityLabel={`Manage intern mode for ${member.name}`}
                    >
                      <GraduationCap color={colors.primary} size={13} />
                      <Text style={styles.internPillText}>Intern Mode</Text>
                    </TouchableOpacity>
                  )}
                  {user?.role === 'admin' && member._id !== group?.createdBy?._id && (
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={() => removeMember(member._id)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${member.name} from group`}
                    >
                      <Text style={styles.removeText}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          }}
        />
      </View>
    </FullScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  groupProfileSection: {
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  largeGroupIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  largeGroupName: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 5,
    textAlign: 'center',
  },
  groupDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 5,
  },
  groupMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  sectionHeader: {
    padding: 15,
    backgroundColor: colors.surfaceMuted,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  addMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  addMemberIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primaryTint,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  addMemberText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceMuted,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  // Role chip — same tint pair as the avatar initials beside it.
  roleChipRow: {
    marginTop: 3,
  },
  roleChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 9,
  },
  roleChipText: {
    fontSize: 10.5,
    fontWeight: '700',
    textTransform: 'capitalize',
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
    backgroundColor: colors.primaryTint,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primaryTintBorder,
  },
  memberSubjectChipText: {
    color: colors.primaryText,
    fontSize: 11,
    fontWeight: '600',
  },
  memberSubjectsHint: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: 4,
  },
  memberSubjectsLoading: {
    marginTop: 6,
  },
  adminBadge: {
    fontSize: 11,
    color: colors.primaryText,
    backgroundColor: colors.primaryTint,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 2,
    fontWeight: '700',
  },
  // Proper outlined danger pill — a comfortable tap target instead of the
  // old 12px text link.
  removeButton: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.danger + '59',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  // Intern Mode entry on student member rows (admins + mentors).
  internPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginTop: 2,
  },
  internPillText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  removeText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  // Danger zone at the bottom of the member list (admin only).
  deleteGroupSection: {
    marginTop: 28,
    marginHorizontal: 15,
  },
  deleteGroupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.danger + '59',
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: colors.surface,
  },
  deleteGroupButtonText: {
    color: colors.dangerDark,
    fontSize: 15,
    fontWeight: '700',
  },
  deleteGroupHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 8,
  },
  deleteGroupHintText: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    flexShrink: 1,
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
    color: colors.textSecondary,
  },
});
// TEMPORARY FEATURE FREEZE — quiz-only availability (utils/featureAvailability.ts).
export default withFeatureGate('chat')(GroupInfoScreen);
