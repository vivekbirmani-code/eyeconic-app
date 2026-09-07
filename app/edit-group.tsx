import { useEffect, useRef, useState } from 'react';
import { withFeatureGate } from '@/components/withFeatureGate';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingDialog } from '@/components/KeyboardAvoidingDialog';
import { api } from '@/services/api';

/**
 * Edit Group dialog (Groups → edit a group).
 *
 * Implemented as an expo-router transparent-modal screen (not a RN Modal) so
 * it renders in the main window: under Android edge-to-edge (Expo SDK 54,
 * enforced on Android 15+) RN Modal windows get no keyboard resize/events, so
 * the keyboard covered the name/description inputs and the Save button. The
 * route slides in from the bottom like the old Modal did; KeyboardAvoidingView
 * inside KeyboardAvoidingDialog keeps the card above the keyboard.
 */
function EditGroupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId?: string; name?: string; description?: string }>();

  const [editName, setEditName] = useState(params.name ?? '');
  const [editDescription, setEditDescription] = useState(params.description ?? '');
  const [isSaving, setIsSaving] = useState(false);
  // Guards against a double tap firing router.back() twice.
  const isClosingRef = useRef(false);

  const groupId = params.groupId;

  // Deep link / missing param guard: leave the way we came in.
  useEffect(() => {
    if (!groupId) {
      router.back();
    }
  }, [groupId, router]);

  const close = () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    router.back();
  };

  const handleEditGroup = async () => {
    if (!groupId || isSaving) {
      if (!groupId) close();
      return;
    }

    if (!editName.trim()) {
      Alert.alert('Error', 'Group name is required');
      return;
    }

    setIsSaving(true);
    try {
      await api.put(`/groups/${groupId}`, {
        name: editName.trim(),
        description: editDescription.trim()
      });
      // Groups list refreshes via useFocusEffect when this screen closes.
      close();
      Alert.alert('Success', 'Group updated successfully');
    } catch (error: any) {
      Alert.alert('Error', error?.response?.data?.message || 'Failed to update group');
    } finally {
      setIsSaving(false);
    }
  };

  if (!groupId) {
    return <View style={styles.screenRoot} />;
  }

  return (
    <View style={styles.screenRoot}>
      {/* Static dialog (the route itself provides the slide-in animation);
          back navigation is handled by the router, so dismissable is off. */}
      <KeyboardAvoidingDialog
        visible
        onClose={close}
        dismissable={false}
        animationType="none"
        cardStyle={styles.card}
      >
        <Text style={styles.title}>Edit Group</Text>
        <TextInput
          style={styles.input}
          placeholder="Group Name"
          placeholderTextColor="#9CA3AF"
          value={editName}
          onChangeText={setEditName}
          editable={!isSaving}
        />
        <TextInput
          style={styles.textArea}
          placeholder="Description (optional)"
          placeholderTextColor="#9CA3AF"
          value={editDescription}
          onChangeText={setEditDescription}
          multiline
          numberOfLines={3}
          editable={!isSaving}
        />
        <View style={styles.buttons}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={close}
            disabled={isSaving}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
            onPress={handleEditGroup}
            disabled={isSaving}
          >
            <Text style={styles.saveButtonText}>Save</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingDialog>
    </View>
  );
}

const styles = StyleSheet.create({
  // transparentModal route — the dim comes from the dialog overlay.
  screenRoot: {
    flex: 1,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 420,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    backgroundColor: '#F9FAFB',
    color: '#1F2937',
    marginBottom: 12,
  },
  textArea: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    backgroundColor: '#F9FAFB',
    color: '#1F2937',
    textAlignVertical: 'top',
    height: 90,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#6B7280',
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#01b4ae',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
// TEMPORARY FEATURE FREEZE — quiz-only availability (utils/featureAvailability.ts).
export default withFeatureGate('chat')(EditGroupScreen);
