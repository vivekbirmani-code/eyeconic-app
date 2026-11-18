import { useState, useEffect, useCallback, useRef } from 'react';
import { withFeatureGate } from '@/components/withFeatureGate';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { FullScreenContainer } from '@/components/layout';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';
import * as Haptics from '@/utils/haptics';
import { colors } from '@/utils/theme';
import SearchBar from '@/components/SearchBar';
import Collapsible from '@/components/Collapsible';
import TouchableScale from '@/components/TouchableScale';
import { Toast } from '@/components/Toast';
import { X, Check, ChevronDown } from 'lucide-react-native';

interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
}

type GroupType = 'general' | 'mentors' | 'admin';
type SearchRole = 'mentor' | 'student' | 'admin';

/**
 * Create New Group screen.
 *
 * Implemented as an expo-router modal screen (not a RN Modal) so it renders in
 * the main window. Under Android edge-to-edge (Expo SDK 54), RN Modal windows
 * are not resized by the soft keyboard and receive no keyboard events, which
 * left the lower half of this form permanently hidden behind the keyboard.
 * In the main window, KeyboardAvoidingView + ScrollView keep every field and
 * control reachable while typing.
 */
function CreateGroup() {
  const { user } = useAuth();
  const router = useRouter();

  const [newGroup, setNewGroup] = useState({
    name: '',
    description: '',
    type: 'general' as GroupType,
  });

  // Member selection state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchRole, setSearchRole] = useState<SearchRole>('student');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [selectedMentors, setSelectedMentors] = useState<User[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<User[]>([]);
  const [selectedAdmins, setSelectedAdmins] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  // Chevron spins with the dropdown's expand/collapse.
  const chevronSpin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(chevronSpin, {
      toValue: isDropdownOpen ? 1 : 0,
      friction: 6,
      tension: 180,
      useNativeDriver: true,
    }).start();
  }, [isDropdownOpen, chevronSpin]);

  // Only admins may create groups; bounce everyone else out immediately.
  useEffect(() => {
    if (user && user.role !== 'admin') {
      router.back();
    }
  }, [user, router]);

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

  const close = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const createGroup = async () => {
    if (!newGroup.name) {
      Alert.alert('Error', 'Please enter a group name');
      return;
    }

    setIsCreating(true);
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

      // Groups list refreshes via useFocusEffect when this screen closes.
      router.back();
      Toast.show(`Group created with ${memberIds.length + 1} member${memberIds.length ? 's' : ''}`);
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to create group';
      Alert.alert('Error', message);
    } finally {
      setIsCreating(false);
    }
  };

  const renderSelectedUser = (userItem: User, onRemove: () => void) => (
    <View key={userItem._id} style={styles.selectedChip}>
      <Text style={styles.chipText}>{userItem.name} ({userItem.role})</Text>
      <TouchableOpacity onPress={onRemove}>
        <X color={colors.textSecondary} size={16} />
      </TouchableOpacity>
    </View>
  );

  // Wait until the auth context resolves before rendering admin-only UI.
  if (!user || user.role !== 'admin') {
    return <View style={styles.blankContainer} />;
  }

  return (
    <FullScreenContainer style={styles.container}>
      <KeyboardAvoidingView style={styles.keyboardArea} behavior="padding">
        <View style={styles.header}>
          <Text style={styles.title}>Create New Group</Text>
          <TouchableOpacity onPress={close} disabled={isCreating}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Group Details */}
          <TextInput
            style={styles.input}
            placeholder="Group Name"
            placeholderTextColor={colors.textMuted}
            value={newGroup.name}
            onChangeText={(text) => setNewGroup({ ...newGroup, name: text })}
            editable={!isCreating}
          />
          <TextInput
            style={styles.textArea}
            placeholder="Description (optional)"
            placeholderTextColor={colors.textMuted}
            value={newGroup.description}
            onChangeText={(text) => setNewGroup({ ...newGroup, description: text })}
            multiline
            numberOfLines={3}
            editable={!isCreating}
          />

          {/* Group Type Selection Dropdown */}
          <View style={styles.typeContainer}>
            <Text style={styles.sectionLabel}>Group Type</Text>

            <TouchableOpacity
              style={styles.dropdownButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setIsDropdownOpen(!isDropdownOpen);
              }}
              activeOpacity={0.7}
              disabled={isCreating}
              accessibilityRole="button"
              accessibilityLabel={`Group type: ${newGroup.type}. ${isDropdownOpen ? 'Close' : 'Open'} type options`}
              accessibilityState={{ expanded: isDropdownOpen }}
            >
              <Text style={styles.dropdownButtonText}>
                {newGroup.type.charAt(0).toUpperCase() + newGroup.type.slice(1)}
              </Text>
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
                <ChevronDown size={20} color={colors.textSecondary} />
              </Animated.View>
            </TouchableOpacity>

            <Collapsible visible={isDropdownOpen}>
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
                    {newGroup.type === type && <Check size={16} color={colors.primary} />}
                  </TouchableOpacity>
                ))}
              </View>
            </Collapsible>

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
                Adding: <Text style={{ fontWeight: 'bold' }}>{newGroup.type === 'admin' ? 'Admins' : 'Mentors'}</Text>
              </Text>
            </View>
          )}

          {/* Search Input */}
          <View style={styles.searchContainer}>
            <SearchBar
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={`Search ${searchRole}s by name...`}
              isSearching={isSearching}
              returnKeyType="search"
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
                  <Check color={colors.success} size={20} />
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

          <TouchableScale
            style={[styles.createButton, isCreating && styles.createButtonDisabled]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              createGroup();
            }}
            disabled={isCreating}
            accessibilityRole="button"
            accessibilityLabel="Create group"
          >
            <Text style={styles.createButtonText}>Create Group</Text>
          </TouchableScale>
        </ScrollView>
      </KeyboardAvoidingView>
    </FullScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  blankContainer: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  keyboardArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  // Cancel is a neutral action — gray, not danger-red (approved change #2).
  cancelText: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    marginBottom: 16,
  },
  textArea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    textAlignVertical: 'top',
    height: 100,
    marginBottom: 20,
  },
  typeContainer: {
    marginBottom: 20,
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textBody,
    marginBottom: 12,
  },
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 4,
  },
  dropdownButtonText: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '500',
  },
  dropdownContainer: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceMuted,
  },
  dropdownItemActive: {
    backgroundColor: colors.primaryTint,
  },
  dropdownItemText: {
    fontSize: 16,
    color: colors.textBody,
  },
  typeDescription: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 6,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  // Segment control — flat track, active segment lifts onto the surface.
  roleToggle: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 3,
    marginBottom: 20,
  },
  roleButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 9,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  roleButtonActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  roleButtonText: {
    fontSize: 14.5,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  roleButtonTextActive: {
    color: colors.primaryText,
    fontWeight: '700',
  },
  fixedRoleContainer: {
    marginBottom: 16,
    alignItems: 'center',
    padding: 10,
    backgroundColor: colors.bg,
    borderRadius: 10,
  },
  fixedRoleText: {
    fontSize: 14,
    color: colors.textBody,
  },
  searchContainer: {
    marginBottom: 12,
  },
  searchResults: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
    overflow: 'hidden',
  },
  searchResultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceMuted,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  resultEmail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  selectedSection: {
    marginBottom: 16,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryTint,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.primaryTintBorder,
  },
  chipText: {
    fontSize: 14,
    color: colors.primaryText,
    fontWeight: '600',
  },
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 40,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  createButtonDisabled: {
    opacity: 0.7,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
});
// TEMPORARY FEATURE FREEZE — quiz-only availability (utils/featureAvailability.ts).
export default withFeatureGate('chat')(CreateGroup);
