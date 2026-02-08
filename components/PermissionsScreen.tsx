import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  StatusBar,
  Dimensions,
  Alert,
} from 'react-native';
import { Mic, Bell, CheckCircle } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Check if running in Expo Go
const isExpoGo = Constants.appOwnership === 'expo';

// Dynamically import Notifications to prevent crash in Expo Go
let Notifications: any = null;
try {
  Notifications = require('expo-notifications');
} catch (e) {
  console.log('expo-notifications not available');
}

// Dynamically import Audio to prevent crash if expo-av issues
let Audio: any = null;
try {
  // Use expo-av for permission request
  const ExpoAV = require('expo-av');
  Audio = ExpoAV.Audio;
} catch (e) {
  console.log('expo-av not available');
}

const { width, height } = Dimensions.get('window');

interface PermissionsScreenProps {
  onComplete: () => void;
}

export default function PermissionsScreen({ onComplete }: PermissionsScreenProps) {
  const [micPermission, setMicPermission] = useState<boolean | null>(null);
  const [notifPermission, setNotifPermission] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const requestMicrophonePermission = async () => {
    if (!Audio) {
      console.log('Audio module not available, skipping permission');
      setMicPermission(true); // Graceful fallback
      return true;
    }

    try {
      const { granted } = await Audio.requestPermissionsAsync();
      setMicPermission(granted);
      return granted;
    } catch (error) {
      console.error('Error requesting microphone permission:', error);
      setMicPermission(false);
      return false;
    }
  };

  const requestNotificationPermission = async () => {
    // Skip in Expo Go since push notifications don't work
    if (isExpoGo || !Notifications) {
      console.log('Notification permission skipped in Expo Go');
      setNotifPermission(true); // Pretend granted to allow app to continue
      return true;
    }
    
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      const granted = status === 'granted';
      setNotifPermission(granted);
      return granted;
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      setNotifPermission(false);
      return false;
    }
  };

  const handleRequestPermissions = async () => {
    setIsLoading(true);
    
    // Request microphone first
    await requestMicrophonePermission();
    
    // Then notifications
    await requestNotificationPermission();
    
    setIsLoading(false);
  };

  const handleContinue = async () => {
    // Mark permissions as completed
    await AsyncStorage.setItem('permissions_requested', 'true');
    onComplete();
  };

  const allPermissionsGranted = micPermission === true && notifPermission === true;
  const anyPermissionRequested = micPermission !== null || notifPermission !== null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      
      <View style={styles.header}>
        <Text style={styles.title}>Welcome to NEET Mentorship</Text>
        <Text style={styles.subtitle}>
          We need a few permissions to enable calling and notifications.
        </Text>
        {isExpoGo && (
          <Text style={styles.expoGoWarning}>
            ⚠️ Running in Expo Go - Calling & Push features disabled
          </Text>
        )}
      </View>

      <View style={styles.permissionsList}>
        {/* Microphone Permission */}
        <View style={styles.permissionItem}>
          <View style={[
            styles.iconContainer,
            micPermission === true && styles.iconContainerGranted
          ]}>
            {micPermission === true ? (
              <CheckCircle color="#FFFFFF" size={28} />
            ) : (
              <Mic color="#10B981" size={28} />
            )}
          </View>
          <View style={styles.permissionInfo}>
            <Text style={styles.permissionTitle}>Microphone</Text>
            <Text style={styles.permissionDesc}>
              Required for voice calls with mentors
            </Text>
          </View>
          {micPermission === true && (
            <Text style={styles.grantedText}>Granted</Text>
          )}
        </View>

        {/* Notification Permission */}
        <View style={styles.permissionItem}>
          <View style={[
            styles.iconContainer,
            notifPermission === true && styles.iconContainerGranted
          ]}>
            {notifPermission === true ? (
              <CheckCircle color="#FFFFFF" size={28} />
            ) : (
              <Bell color="#10B981" size={28} />
            )}
          </View>
          <View style={styles.permissionInfo}>
            <Text style={styles.permissionTitle}>Notifications</Text>
            <Text style={styles.permissionDesc}>
              Get notified about incoming calls and messages
            </Text>
          </View>
          {notifPermission === true && (
            <Text style={styles.grantedText}>Granted</Text>
          )}
        </View>
      </View>

      <View style={styles.footer}>
        {!anyPermissionRequested ? (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleRequestPermissions}
            disabled={isLoading}
          >
            <Text style={styles.primaryButtonText}>
              {isLoading ? 'Requesting...' : 'Grant Permissions'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.primaryButton,
              !allPermissionsGranted && styles.secondaryButton
            ]}
            onPress={handleContinue}
          >
            <Text style={[
              styles.primaryButtonText,
              !allPermissionsGranted && styles.secondaryButtonText
            ]}>
              {allPermissionsGranted ? 'Continue' : 'Continue Anyway'}
            </Text>
          </TouchableOpacity>
        )}

        {!anyPermissionRequested && (
          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleContinue}
          >
            <Text style={styles.skipButtonText}>Skip for now</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 50,
    paddingHorizontal: 24,
  },
  header: {
    marginTop: 40,
    marginBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    lineHeight: 24,
  },
  expoGoWarning: {
    marginTop: 12,
    fontSize: 14,
    color: '#F59E0B',
    fontWeight: '500',
  },
  permissionsList: {
    flex: 1,
  },
  permissionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#ECFDF5',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  iconContainerGranted: {
    backgroundColor: '#10B981',
  },
  permissionInfo: {
    flex: 1,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  permissionDesc: {
    fontSize: 14,
    color: '#6B7280',
  },
  grantedText: {
    fontSize: 14,
    color: '#10B981',
    fontWeight: '500',
  },
  footer: {
    paddingBottom: 40,
  },
  primaryButton: {
    backgroundColor: '#10B981',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#F3F4F6',
  },
  secondaryButtonText: {
    color: '#374151',
  },
  skipButton: {
    padding: 12,
    alignItems: 'center',
  },
  skipButtonText: {
    color: '#6B7280',
    fontSize: 16,
  },
});
