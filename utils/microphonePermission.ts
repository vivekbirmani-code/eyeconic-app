import { Alert, Linking } from 'react-native';

let Audio: typeof import('expo-av').Audio | null = null;
try {
  const expoAv = require('expo-av');
  Audio = expoAv.Audio;
} catch {
  console.log('expo-av not available');
}

/**
 * Requests microphone permission when the user initiates a call or other mic feature.
 * Triggers the native iOS/Android dialog directly — no pre-permission modal.
 */
export async function ensureMicrophonePermission(): Promise<boolean> {
  if (!Audio) {
    return true;
  }

  try {
    const existing = await Audio.getPermissionsAsync();
    if (existing.granted) {
      return true;
    }

    if (existing.canAskAgain === false) {
      Alert.alert(
        'Microphone Access Required',
        'Enable microphone access in Settings to speak during live mentorship calls.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return false;
    }

    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) {
      Alert.alert(
        'Microphone Access Required',
        'Microphone access is needed to participate in live mentorship sessions and audio calls.',
        [{ text: 'OK' }]
      );
    }
    return granted;
  } catch (error) {
    console.error('Error requesting microphone permission:', error);
    return false;
  }
}
