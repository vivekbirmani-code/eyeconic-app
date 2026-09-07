import { useRef, useState } from 'react';
import { withFeatureGate } from '@/components/withFeatureGate';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
  Animated,
  KeyboardAvoidingView,
  LayoutChangeEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { FullScreenContainer } from '@/components/layout';
import * as Haptics from '@/utils/haptics';
import { api } from '@/services/api';

const SEGMENT_TRACK_INSET = 4;

/**
 * Create New User screen (User Management → "+").
 *
 * Implemented as an expo-router modal screen (not a RN Modal) so it renders in
 * the main window. Under Android edge-to-edge (Expo SDK 54, enforced on
 * Android 15+), RN Modal windows are not resized by the soft keyboard and
 * receive no keyboard events, which left the lower form fields hidden behind
 * the keyboard. In the main window, KeyboardAvoidingView + ScrollView keep
 * every field and the Create button reachable while typing.
 */
function CreateUserScreen() {
  const router = useRouter();

  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    role: 'student',
  });

  // Role selector animation for segmented control.
  // Position is 0 (Student) or 1 (Mentor); actual pixel offset is
  // multiplied by the measured half-width so both states stay symmetrical.
  const roleIndicatorPosition = useRef(new Animated.Value(0)).current;
  const roleSegmentWidthAnim = useRef(new Animated.Value(0)).current;
  const [roleSegmentWidth, setRoleSegmentWidth] = useState(0);

  const [isCreating, setIsCreating] = useState(false);
  // Guards against a double tap firing router.back() twice.
  const isClosingRef = useRef(false);

  const close = () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const createUser = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (isCreating) return;

    setIsCreating(true);
    try {
      await api.post('/users', newUser);
      // Users list refreshes via useFocusEffect when this screen closes.
      if (!isClosingRef.current) {
        isClosingRef.current = true;
        router.back();
      }
      Alert.alert('Success', 'User created successfully');
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to create user';
      Alert.alert('Error', message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <FullScreenContainer style={styles.modalContainer}>
      <KeyboardAvoidingView style={styles.keyboardArea} behavior="padding">
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Create New User</Text>
          <TouchableOpacity onPress={close} disabled={isCreating}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.modalContent}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            style={styles.input}
            placeholder="Full Name"
            placeholderTextColor="#9CA3AF"
            value={newUser.name}
            onChangeText={(text) => setNewUser({ ...newUser, name: text })}
            editable={!isCreating}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#9CA3AF"
            value={newUser.email}
            onChangeText={(text) => setNewUser({ ...newUser, email: text })}
            keyboardType="email-address"
            autoCapitalize="none"
            editable={!isCreating}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#9CA3AF"
            value={newUser.password}
            onChangeText={(text) => setNewUser({ ...newUser, password: text })}
            secureTextEntry
            editable={!isCreating}
          />
          <TextInput
            style={styles.input}
            placeholder="Phone Number "
            placeholderTextColor="#9CA3AF"
            value={newUser.phone}
            onChangeText={(text) => setNewUser({ ...newUser, phone: text })}
            keyboardType="phone-pad"
            editable={!isCreating}
          />

          <View style={styles.roleSelector}>
            <Text style={styles.roleLabel}>Role:</Text>
            <View
              style={styles.segmentedControl}
              onLayout={(event: LayoutChangeEvent) => {
                const trackWidth = event.nativeEvent.layout.width;
                const segmentWidth =
                  (trackWidth - SEGMENT_TRACK_INSET * 2) / 2;
                if (segmentWidth > 0 && segmentWidth !== roleSegmentWidth) {
                  setRoleSegmentWidth(segmentWidth);
                  roleSegmentWidthAnim.setValue(segmentWidth);
                }
              }}
            >
              {roleSegmentWidth > 0 && (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.segmentIndicator,
                    {
                      width: roleSegmentWidth,
                      transform: [{
                        translateX: Animated.multiply(
                          roleIndicatorPosition,
                          roleSegmentWidthAnim
                        ),
                      }],
                    },
                  ]}
                />
              )}
              <TouchableOpacity
                style={styles.segmentButton}
                onPress={() => {
                  Haptics.selectionAsync();
                  Animated.spring(roleIndicatorPosition, {
                    toValue: 0,
                    friction: 8,
                    tension: 50,
                    useNativeDriver: true,
                  }).start();
                  setNewUser({ ...newUser, role: 'student' });
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Student"
                accessibilityState={{ selected: newUser.role === 'student' }}
              >
                <Text style={[
                  styles.segmentButtonText,
                  newUser.role === 'student' && styles.segmentButtonTextActive
                ]}>Student</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.segmentButton}
                onPress={() => {
                  Haptics.selectionAsync();
                  Animated.spring(roleIndicatorPosition, {
                    toValue: 1,
                    friction: 8,
                    tension: 50,
                    useNativeDriver: true,
                  }).start();
                  setNewUser({ ...newUser, role: 'mentor' });
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Mentor"
                accessibilityState={{ selected: newUser.role === 'mentor' }}
              >
                <Text style={[
                  styles.segmentButtonText,
                  newUser.role === 'mentor' && styles.segmentButtonTextActive
                ]}>Mentor</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.createButton, isCreating && styles.createButtonDisabled]}
            onPress={createUser}
            disabled={isCreating}
          >
            <Text style={styles.createButtonText}>Create User</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </FullScreenContainer>
  );
}

const styles = StyleSheet.create({
  keyboardArea: {
    flex: 1,
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
  roleSelector: {
    marginTop: 10,
  },
  roleLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 10,
  },
  createButton: {
    backgroundColor: '#01b4ae',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 25,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 4,
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  // Segmented control styles for role selector
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: SEGMENT_TRACK_INSET,
    position: 'relative',
  },
  segmentIndicator: {
    position: 'absolute',
    top: SEGMENT_TRACK_INSET,
    bottom: SEGMENT_TRACK_INSET,
    left: SEGMENT_TRACK_INSET,
    backgroundColor: '#01b4ae',
    borderRadius: 10,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  segmentButton: {
    flex: 1,
    flexBasis: 0,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  segmentButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    textAlign: 'center',
    width: '100%',
  },
  segmentButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
// TEMPORARY FEATURE FREEZE — quiz-only availability (utils/featureAvailability.ts).
export default withFeatureGate('userManagement')(CreateUserScreen);
