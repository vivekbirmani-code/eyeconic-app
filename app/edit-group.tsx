import { useEffect, useRef, useState } from 'react';
import { withFeatureGate } from '@/components/withFeatureGate';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingDialog } from '@/components/KeyboardAvoidingDialog';
import { colors } from '@/utils/theme';
import { Toast } from '@/components/Toast';
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
      Toast.show('Group updated');
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
          placeholderTextColor={colors.textMuted}
          value={editName}
          onChangeText={setEditName}
          editable={!isSaving}
        />
        <TextInput
          style={styles.textArea}
          placeholder="Description (optional)"
          placeholderTextColor={colors.textMuted}
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
            {isSaving ? (
              <View style={styles.savingRow}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.saveButtonText}>Saving…</Text>
              </View>
            ) : (
              <Text style={styles.saveButtonText}>Save</Text>
            )}
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
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 420,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    marginBottom: 12,
  },
  textArea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
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
    backgroundColor: colors.bg,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    backgroundColor: colors.primary,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
// TEMPORARY FEATURE FREEZE — quiz-only availability (utils/featureAvailability.ts).
export default withFeatureGate('chat')(EditGroupScreen);
