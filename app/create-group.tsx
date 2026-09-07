import { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { useRouter } from 'expo-router';
import { FullScreenContainer } from '@/components/layout';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';
import * as Haptics from '@/utils/haptics';
import { Search, X, Check, ChevronDown, ChevronUp } from 'lucide-react-native';

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
      Alert.alert('Success', 'Group created successfully with ' + (memberIds.length + 1) + ' members');
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
        <X color="#6B7280" size={16} />
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
            placeholderTextColor="#9CA3AF"
            value={newGroup.name}
            onChangeText={(text) => setNewGroup({ ...newGroup, name: text })}
            editable={!isCreating}
          />
          <TextInput
            style={styles.textArea}
            placeholder="Description (optional)"
            placeholderTextColor="#9CA3AF"
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
              onPress={() => setIsDropdownOpen(!isDropdownOpen)}
              activeOpacity={0.7}
              disabled={isCreating}
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
                Adding: <Text style={{ fontWeight: 'bold' }}>{newGroup.type === 'admin' ? 'Admins' : 'Mentors'}</Text>
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
              returnKeyType="search"
            />
            {isSearching && <Text style={styles.searchingText}>...</Text>}
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

          <TouchableOpacity
            style={[styles.createButton, isCreating && styles.createButtonDisabled]}
            onPress={createGroup}
            disabled={isCreating}
          >
            <Text style={styles.createButtonText}>Create Group</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </FullScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  blankContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
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
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  cancelText: {
    color: '#EF4444',
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
  typeContainer: {
    marginBottom: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 12,
  },
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
  typeDescription: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 6,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  roleToggle: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 4,
    marginBottom: 20,
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
  fixedRoleContainer: {
    marginBottom: 16,
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
  },
  fixedRoleText: {
    fontSize: 14,
    color: '#4B5563',
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
  searchingText: {
    color: '#6B7280',
    fontSize: 16,
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
