import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import {
  Users,
  Search,
  Check,
  X,
  Copy,
  Globe,
  Link,
  AlertCircle,
  Minus,
} from 'lucide-react-native';
import { api } from '@/services/api';
import * as Clipboard from 'expo-clipboard';
import useDebounce from '@/hooks/useDebounce';
import { colors } from '@/utils/theme';

// Minimal quiz shape the share sheet needs. Both the freshly created quiz
// (create/import responses) and the Past Tests list rows satisfy this.
export interface ShareQuizTarget {
  _id: string;
  title: string;
  assignedStudents: string[];
}

interface Student {
  _id: string;
  name: string;
  email: string;
}

interface Group {
  _id: string;
  name: string;
  description?: string;
  members?: { _id: string; role?: string }[];
  students?: (string | { _id: string })[];
}

interface ShareQuizModalProps {
  visible: boolean;
  quiz: ShareQuizTarget | null;
  onClose: () => void;
  // Called after a successful internal share / free-user share so parents
  // can refresh their quiz lists. The modal closes itself right after.
  onShareComplete?: () => void;
  // Hide the Internal tab and open straight into External sharing. Used by
  // flows that have ALREADY collected internal assignments right before the
  // sheet opens (Create Quiz step 5) — re-picking internal students there
  // would be a duplicate assignment path.
  externalOnly?: boolean;
}

/**
 * Bottom-sheet Share Quiz popup with Internal / External tabs.
 *
 * Internal: pick extra registered students (with group filters + select all)
 * or blast to all free users. External: generate / copy / revoke a public
 * quiz link. Extracted verbatim from Past Tests so Create Quiz, Import Quiz
 * and Past Tests all share one pixel-identical implementation.
 *
 * Pass `externalOnly` to render only the External tab (Create Quiz uses this
 * because internal students were just assigned in its step 5).
 */
export default function ShareQuizModal({ visible, quiz, onClose, onShareComplete, externalOnly = false }: ShareQuizModalProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupSearch, setGroupSearch] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [sharing, setSharing] = useState(false);

  // External share state
  const [shareMode, setShareMode] = useState<'internal' | 'external'>('internal');
  const [publicShareUrl, setPublicShareUrl] = useState<string | null>(null);
  const [shareExpiry, setShareExpiry] = useState<Date | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [copied, setCopied] = useState(false);

  // Debounced search values for flicker-free filtering
  const debouncedStudentSearch = useDebounce(studentSearch, 250);
  const debouncedGroupSearch = useDebounce(groupSearch, 250);

  // Local snapshot of the quiz being shared. Kept in state (not read straight
  // from props) so assignedStudents filtering stays stable across re-renders
  // while the sheet is open.
  const [activeQuiz, setActiveQuiz] = useState<ShareQuizTarget | null>(null);

  const studentIdSet = useMemo(() => {
    return new Set(students.map(student => student._id));
  }, [students]);

  const groupStudentMap = useMemo(() => {
    const map: Record<string, string[]> = {};

    groups.forEach(group => {
      const studentIds = new Set<string>();

      if (Array.isArray(group.members)) {
        group.members.forEach(member => {
          if (!member?._id) return;
          if (member.role === 'student' || studentIdSet.has(member._id)) {
            studentIds.add(member._id);
          }
        });
      }

      if (Array.isArray(group.students)) {
        group.students.forEach(student => {
          const studentId = typeof student === 'string' ? student : student?._id;
          if (studentId && studentIdSet.has(studentId)) {
            studentIds.add(studentId);
          }
        });
      }

      map[group._id] = Array.from(studentIds);
    });

    return map;
  }, [groups, studentIdSet]);

  const filteredGroups = useMemo(() => {
    const query = debouncedGroupSearch.trim().toLowerCase();

    return groups.filter(group => {
      const hasStudents = (groupStudentMap[group._id]?.length || 0) > 0;
      if (!hasStudents) return false;

      if (!query) return true;

      return (
        group.name.toLowerCase().includes(query) ||
        (group.description || '').toLowerCase().includes(query)
      );
    });
  }, [debouncedGroupSearch, groups, groupStudentMap]);

  const selectedGroupStudentIdSet = useMemo(() => {
    const ids = new Set<string>();

    selectedGroupIds.forEach(groupId => {
      (groupStudentMap[groupId] || []).forEach(studentId => ids.add(studentId));
    });

    return ids;
  }, [selectedGroupIds, groupStudentMap]);

  const availableStudents = useMemo(() => {
    if (!activeQuiz) return [];

    const query = debouncedStudentSearch.toLowerCase();

    return students.filter(student => {
      const alreadyAssigned = activeQuiz.assignedStudents.includes(student._id);
      if (alreadyAssigned) return false;

      if (selectedGroupIds.length > 0 && !selectedGroupStudentIdSet.has(student._id)) {
        return false;
      }

      if (query) {
        return (
          student.name.toLowerCase().includes(query) ||
          student.email.toLowerCase().includes(query)
        );
      }

      return true;
    });
  }, [activeQuiz, debouncedStudentSearch, students, selectedGroupIds, selectedGroupStudentIdSet]);

  const selectedFilteredStudentCount = useMemo(() => {
    return availableStudents.filter(student => selectedStudents.includes(student._id)).length;
  }, [availableStudents, selectedStudents]);

  const allFilteredStudentsSelected = useMemo(() => {
    return availableStudents.length > 0 && selectedFilteredStudentCount === availableStudents.length;
  }, [availableStudents.length, selectedFilteredStudentCount]);

  const someFilteredStudentsSelected = useMemo(() => {
    return selectedFilteredStudentCount > 0 && !allFilteredStudentsSelected;
  }, [selectedFilteredStudentCount, allFilteredStudentsSelected]);

  const allFilteredGroupsSelected = useMemo(() => {
    return filteredGroups.length > 0
      && filteredGroups.every(group => selectedGroupIds.includes(group._id));
  }, [filteredGroups, selectedGroupIds]);

  useEffect(() => {
    // Opening the sheet resets every picker and reloads its data, mirroring
    // the original Past Tests openShareModal() behavior.
    if (!visible || !quiz) return;

    setActiveQuiz(quiz);
    setSelectedStudents([]);
    setStudentSearch('');
    setGroupSearch('');
    setSelectedGroupIds([]);
    setShareMode(externalOnly ? 'external' : 'internal');
    setPublicShareUrl(null);
    setShareExpiry(null);
    setCopied(false);

    // The internal pickers (and their API calls) are dead weight when the
    // Internal tab is hidden.
    if (!externalOnly) {
      fetchStudents();
      fetchGroups();
    }
    checkExistingShareLink(quiz._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, quiz?._id]);

  useEffect(() => {
    // Remove stale selected group IDs if groups list changes.
    setSelectedGroupIds(prev => prev.filter(groupId => groups.some(group => group._id === groupId)));
  }, [groups]);

  const fetchStudents = async () => {
    try {
      const response = await api.get('/users?role=student');
      setStudents(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error fetching students:', error);
      setStudents([]);
    }
  };

  const fetchGroups = async () => {
    try {
      const response = await api.get('/groups');
      setGroups(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error fetching groups:', error);
      setGroups([]);
    }
  };

  const checkExistingShareLink = async (quizId: string) => {
    try {
      const response = await api.get(`/quizzes/${quizId}/share-status`);
      if (response.data.isPublic && response.data.shareUrl) {
        setPublicShareUrl(response.data.shareUrl);
        setShareExpiry(response.data.publicExpiryDate ? new Date(response.data.publicExpiryDate) : null);
      }
    } catch {
      // Ignore - no existing share link
    }
  };

  const toggleStudent = (studentId: string) => {
    setSelectedStudents(prev =>
      prev.includes(studentId) ? prev.filter(id => id !== studentId) : [...prev, studentId]
    );
  };

  const toggleGroupFilter = (groupId: string) => {
    setSelectedGroupIds(prev =>
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    );
  };

  const handleSelectAllFilteredGroups = () => {
    const filteredGroupIds = filteredGroups.map(group => group._id);
    if (filteredGroupIds.length === 0) return;

    if (allFilteredGroupsSelected) {
      setSelectedGroupIds(prev => prev.filter(id => !filteredGroupIds.includes(id)));
      return;
    }

    setSelectedGroupIds(prev => Array.from(new Set([...prev, ...filteredGroupIds])));
  };

  const handleSelectAllFilteredStudents = () => {
    const filteredStudentIds = new Set(availableStudents.map(student => student._id));
    if (filteredStudentIds.size === 0) return;

    if (allFilteredStudentsSelected) {
      setSelectedStudents(prev => prev.filter(id => !filteredStudentIds.has(id)));
      return;
    }

    setSelectedStudents(prev => Array.from(new Set([...prev, ...Array.from(filteredStudentIds)])));
  };

  const handleShare = async () => {
    if (!activeQuiz || selectedStudents.length === 0) {
      Alert.alert('Error', 'Please select at least one student');
      return;
    }

    setSharing(true);
    try {
      const response = await api.put(`/quizzes/${activeQuiz._id}/share`, {
        studentIds: selectedStudents
      });

      Alert.alert('Success', response.data.message);
      onShareComplete?.();
      onClose();
    } catch (error: any) {
      console.error('Share error:', error);
      Alert.alert('Error', error.response?.data?.message || 'Failed to share quiz');
    } finally {
      setSharing(false);
    }
  };

  const handleShareWithFreeUsers = async () => {
    if (!activeQuiz) return;

    setSharing(true);
    try {
      await api.put(`/quizzes/${activeQuiz._id}/share`, {
        assignToAllFreeUsers: true
      });

      Alert.alert('Success', 'Quiz shared with all free users successfully!');
      onShareComplete?.();
      onClose();
    } catch (error: any) {
      console.error('Share with free users error:', error);
      Alert.alert('Error', error.response?.data?.message || 'Failed to share with free users');
    } finally {
      setSharing(false);
    }
  };

  const handleGeneratePublicLink = async () => {
    if (!activeQuiz) return;

    setGeneratingLink(true);
    try {
      const response = await api.post(`/quizzes/${activeQuiz._id}/generate-share-link`, {});

      setPublicShareUrl(response.data.shareUrl);
      setShareExpiry(response.data.expiryDate ? new Date(response.data.expiryDate) : null);
      Alert.alert('Success', 'Public share link generated!');
    } catch (error: any) {
      console.error('Generate link error:', error);
      Alert.alert('Error', error.response?.data?.message || 'Failed to generate link');
    } finally {
      setGeneratingLink(false);
    }
  };

  const handleRevokePublicLink = async () => {
    if (!activeQuiz) return;

    Alert.alert(
      'Revoke Link',
      'This will disable the public share link. Anyone with the link will no longer be able to access the quiz.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.post(`/quizzes/${activeQuiz._id}/revoke-share-link`);
              setPublicShareUrl(null);
              setShareExpiry(null);
              Alert.alert('Success', 'Share link revoked');
            } catch (error: any) {
              Alert.alert('Error', error.response?.data?.message || 'Failed to revoke link');
            }
          }
        }
      ]
    );
  };

  const handleCopyLink = async () => {
    if (publicShareUrl) {
      await Clipboard.setStringAsync(publicShareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Modal
      visible={visible && !!activeQuiz}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Share Quiz</Text>
            <TouchableOpacity onPress={onClose}>
              <X color="#6B7280" size={24} />
            </TouchableOpacity>
          </View>

          {activeQuiz && (
            <Text style={styles.modalSubtitle} numberOfLines={1}>
              {activeQuiz.title}
            </Text>
          )}

          {/* Share Mode Tabs — Internal is hidden in externalOnly mode
              (internal students were just assigned in the wizard's step 5). */}
          <View style={styles.shareModeTabs}>
            {!externalOnly && (
              <TouchableOpacity
                style={[styles.shareModeTab, shareMode === 'internal' && styles.shareModeTabActive]}
                onPress={() => setShareMode('internal')}
              >
                <Users size={18} color={shareMode === 'internal' ? colors.primary : '#6B7280'} />
                <Text style={[styles.shareModeTabText, shareMode === 'internal' && styles.shareModeTabTextActive]}>
                  Internal
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.shareModeTab, shareMode === 'external' && styles.shareModeTabActive]}
              onPress={() => setShareMode('external')}
            >
              <Globe size={18} color={shareMode === 'external' ? colors.primary : '#6B7280'} />
              <Text style={[styles.shareModeTabText, shareMode === 'external' && styles.shareModeTabTextActive]}>
                External
              </Text>
            </TouchableOpacity>
          </View>

          {shareMode === 'internal' ? (
            // Internal sharing (existing student assignment)
            <>
              <View style={styles.modalSearchInput}>
                <Users color="#6B7280" size={18} />
                <TextInput
                  style={styles.modalSearchTextInput}
                  placeholder="Filter groups by name..."
                  value={groupSearch}
                  onChangeText={setGroupSearch}
                />
                {groupSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setGroupSearch('')}>
                    <X color="#9CA3AF" size={16} />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.selectionActionRow}>
                <Text style={styles.selectedCount}>
                  {selectedGroupIds.length} group filter(s) active
                </Text>
                <TouchableOpacity
                  onPress={handleSelectAllFilteredGroups}
                  disabled={filteredGroups.length === 0}
                >
                  <Text style={[styles.selectAllActionText, filteredGroups.length === 0 && styles.selectAllActionTextDisabled]}>
                    {allFilteredGroupsSelected ? 'Deselect Filtered Groups' : 'Select Filtered Groups'}
                  </Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                horizontal
                style={styles.groupFilterList}
                contentContainerStyle={styles.groupFilterListContent}
                showsHorizontalScrollIndicator={false}
              >
                {filteredGroups.length === 0 ? (
                  <Text style={styles.noGroupsText}>No matching groups</Text>
                ) : (
                  filteredGroups.map(group => (
                    <TouchableOpacity
                      key={group._id}
                      style={[
                        styles.groupFilterChip,
                        selectedGroupIds.includes(group._id) && styles.groupFilterChipSelected
                      ]}
                      onPress={() => toggleGroupFilter(group._id)}
                    >
                      <Text
                        style={[
                          styles.groupFilterChipText,
                          selectedGroupIds.includes(group._id) && styles.groupFilterChipTextSelected
                        ]}
                      >
                        {group.name} ({groupStudentMap[group._id]?.length || 0})
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>

              {selectedGroupIds.length > 0 && (
                <TouchableOpacity onPress={() => setSelectedGroupIds([])}>
                  <Text style={styles.clearFilterText}>Clear Group Filters</Text>
                </TouchableOpacity>
              )}

              <View style={styles.modalSearchInput}>
                <Search color="#6B7280" size={18} />
                <TextInput
                  style={styles.modalSearchTextInput}
                  placeholder={selectedGroupIds.length > 0 ? 'Search students in selected groups...' : 'Search students...'}
                  value={studentSearch}
                  onChangeText={setStudentSearch}
                />
                {studentSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setStudentSearch('')}>
                    <X color="#9CA3AF" size={16} />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.selectionActionRow}>
                <TouchableOpacity
                  style={styles.selectAllCheckboxRow}
                  onPress={handleSelectAllFilteredStudents}
                  disabled={availableStudents.length === 0}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.checkbox,
                    (allFilteredStudentsSelected || someFilteredStudentsSelected) && styles.checkboxSelected,
                  ]}>
                    {allFilteredStudentsSelected && <Check color="#FFF" size={14} />}
                    {someFilteredStudentsSelected && <Minus color="#FFF" size={14} />}
                  </View>
                  <Text style={[styles.selectAllActionText, availableStudents.length === 0 && styles.selectAllActionTextDisabled]}>
                    {allFilteredStudentsSelected ? 'Deselect All' : 'Select All'}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.selectedCount}>
                  {selectedFilteredStudentCount} of {availableStudents.length} visible ({selectedStudents.length} total)
                </Text>
              </View>

              <ScrollView style={styles.studentList}>
                {availableStudents.length === 0 ? (
                  <Text style={styles.noStudentsText}>
                    {studentSearch || selectedGroupIds.length > 0
                      ? 'No matching students'
                      : 'All students already have access'}
                  </Text>
                ) : (
                  availableStudents.map(student => (
                    <TouchableOpacity
                      key={student._id}
                      style={[
                        styles.studentItem,
                        selectedStudents.includes(student._id) && styles.studentItemSelected
                      ]}
                      onPress={() => toggleStudent(student._id)}
                    >
                      <View style={[
                        styles.checkbox,
                        selectedStudents.includes(student._id) && styles.checkboxSelected
                      ]}>
                        {selectedStudents.includes(student._id) && <Check color="#FFF" size={14} />}
                      </View>
                      <View style={styles.studentInfo}>
                        <Text style={styles.studentName}>{student.name}</Text>
                        <Text style={styles.studentEmail}>{student.email}</Text>
                      </View>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>

              <TouchableOpacity
                style={[styles.shareConfirmButton, (sharing || selectedStudents.length === 0) && styles.buttonDisabled]}
                onPress={handleShare}
                disabled={sharing || selectedStudents.length === 0}
              >
                {sharing ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.shareConfirmText}>Share with {selectedStudents.length} Student(s)</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.shareFreeConfirmButton, sharing && styles.buttonDisabled]}
                onPress={handleShareWithFreeUsers}
                disabled={sharing}
              >
                {sharing ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={[styles.shareConfirmText, styles.shareFreeConfirmText]}>Share with All Free Users 🚀</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            // External sharing (public link)
            <ScrollView
              style={styles.externalShareContainer}
              contentContainerStyle={styles.externalShareContent}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.externalShareInfo}>
                <AlertCircle size={20} color="#F59E0B" />
                <Text style={styles.externalShareInfoText}>
                  Public links allow unregistered users to attempt this quiz. They&apos;ll be prompted to sign in after completion.
                </Text>
              </View>

              {publicShareUrl ? (
                <>
                  <View style={styles.linkContainer}>
                    <Link size={18} color={colors.primary} />
                    <Text style={styles.linkText} numberOfLines={1}>
                      {publicShareUrl}
                    </Text>
                    <TouchableOpacity
                      style={styles.copyButton}
                      onPress={handleCopyLink}
                    >
                      {copied ? (
                        <Check size={18} color="#10B981" />
                      ) : (
                        <Copy size={18} color="#6B7280" />
                      )}
                    </TouchableOpacity>
                  </View>

                  {shareExpiry ? (
                    <Text style={styles.expiryText}>
                      Expires: {new Date(shareExpiry).toLocaleDateString()}
                    </Text>
                  ) : (
                    <Text style={styles.expiryText}>
                      Never expires
                    </Text>
                  )}

                  <TouchableOpacity
                    style={styles.revokeButton}
                    onPress={handleRevokePublicLink}
                  >
                    <Text style={styles.revokeButtonText}>Revoke Link</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={[styles.generateLinkButton, generatingLink && styles.buttonDisabled]}
                  onPress={handleGeneratePublicLink}
                  disabled={generatingLink}
                >
                  {generatingLink ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <>
                      <Link size={18} color="#FFF" />
                      <Text style={styles.generateLinkText}>Generate Public Link</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
  },
  modalSearchInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 12,
  },
  modalSearchTextInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
  },
  selectedCount: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
    marginBottom: 12,
  },
  selectionActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 12,
  },
  selectAllCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectAllActionText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  selectAllActionTextDisabled: {
    color: '#9CA3AF',
  },
  groupFilterList: {
    maxHeight: 48,
    marginBottom: 10,
  },
  groupFilterListContent: {
    gap: 8,
    paddingRight: 12,
  },
  noGroupsText: {
    fontSize: 13,
    color: '#9CA3AF',
    paddingVertical: 10,
  },
  groupFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  groupFilterChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  groupFilterChipText: {
    fontSize: 12,
    color: '#4B5563',
    fontWeight: '500',
  },
  groupFilterChipTextSelected: {
    color: colors.primaryDark,
    fontWeight: '600',
  },
  clearFilterText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 12,
  },
  studentList: {
    maxHeight: 300,
    marginBottom: 16,
  },
  noStudentsText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    paddingVertical: 20,
  },
  studentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#F9FAFB',
    gap: 12,
  },
  studentItemSelected: {
    backgroundColor: colors.primaryTint,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1F2937',
  },
  studentEmail: {
    fontSize: 12,
    color: '#6B7280',
  },
  shareConfirmButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  // Secondary action — teal outline so only one primary button is solid
  shareFreeConfirmButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  shareFreeConfirmText: {
    color: colors.primary,
  },
  shareConfirmText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  // Share mode tabs
  shareModeTabs: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 4,
    marginBottom: 16,
  },
  shareModeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 6,
  },
  shareModeTabActive: {
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  shareModeTabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  shareModeTabTextActive: {
    color: colors.primary,
  },
  // External share styles
  externalShareContainer: {
    maxHeight: 400,
    width: '100%',
  },
  externalShareContent: {
    paddingBottom: 20,
  },
  externalShareInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#FFFBEB',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  externalShareInfoText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
    lineHeight: 18,
  },
  linkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 8,
    gap: 10,
    marginBottom: 8,
  },
  linkText: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  copyButton: {
    padding: 6,
  },
  expiryText: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 16,
  },
  generateLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: 8,
  },
  generateLinkText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  revokeButton: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  revokeButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#EF4444',
  },
});
