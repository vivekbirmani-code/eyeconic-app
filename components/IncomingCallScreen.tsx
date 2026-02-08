import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  StatusBar,
  Vibration,
  Dimensions,
} from 'react-native';
import { Phone, PhoneOff, X } from 'lucide-react-native';

// Dynamically import expo-av
let Audio: any = null;
try {
  const ExpoAV = require('expo-av');
  Audio = ExpoAV.Audio;
} catch (e) {
  console.log('expo-av not available');
}

const { width, height } = Dimensions.get('window');

interface IncomingCallScreenProps {
  callerName: string;
  groupName: string;
  onAccept: () => void;
  onDecline: () => void;
}

export default function IncomingCallScreen({
  callerName,
  groupName,
  onAccept,
  onDecline,
}: IncomingCallScreenProps) {
  const soundRef = useRef<any>(null); // Type as any since Audio might be missing
  const vibrationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    startRinging();
    
    return () => {
      stopRinging();
    };
  }, []);

  const startRinging = async () => {
    // Start vibration pattern (vibrate for 500ms, pause for 500ms, repeat)
    vibrationIntervalRef.current = setInterval(() => {
      Vibration.vibrate([0, 500, 500, 500]);
    }, 2000);

    // Initial vibration
    Vibration.vibrate([0, 500, 500, 500]);
    
    // Try to play sound if Audio is available
    if (Audio) {
      try {
        const { sound } = await Audio.Sound.createAsync(
            require('@/assets/sounds/ringtone.mp3'),
            { shouldPlay: true, isLooping: true }
        );
        soundRef.current = sound;
        await sound.playAsync();
      } catch (error) {
        console.log('Error playing ringtone:', error);
      }
    }
  };

  const stopRinging = async () => {
    // Stop vibration
    if (vibrationIntervalRef.current) {
      clearInterval(vibrationIntervalRef.current);
      vibrationIntervalRef.current = null;
    }
    Vibration.cancel();

    // Stop sound
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch (error) {
        console.log('Error stopping sound:', error);
      }
      soundRef.current = null;
    }
  };

  const handleAccept = () => {
    stopRinging();
    onAccept();
  };

  const handleDecline = () => {
    stopRinging();
    onDecline();
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1F2937" />
      
      {/* Top Section */}
      <View style={styles.topSection}>
        <Text style={styles.incomingText}>Incoming Call</Text>
        <Text style={styles.groupName}>{groupName}</Text>
      </View>

      {/* Center Section - Caller Info */}
      <View style={styles.centerSection}>
        <View style={styles.callerAvatar}>
          <Text style={styles.callerAvatarText}>
            {callerName.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.callerName}>{callerName}</Text>
        <Text style={styles.callingText}>is calling...</Text>
      </View>

      {/* Bottom Section - Action Buttons */}
      <View style={styles.bottomSection}>
        <TouchableOpacity
          style={[styles.actionButton, styles.declineButton]}
          onPress={handleDecline}
          activeOpacity={0.8}
        >
          <PhoneOff color="#FFFFFF" size={32} />
          <Text style={styles.buttonText}>Decline</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.acceptButton]}
          onPress={handleAccept}
          activeOpacity={0.8}
        >
          <Phone color="#FFFFFF" size={32} />
          <Text style={styles.buttonText}>Accept</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: width,
    height: height,
    backgroundColor: '#1F2937',
    zIndex: 9999,
    elevation: 9999,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 50,
  },
  topSection: {
    alignItems: 'center',
    paddingTop: 40,
  },
  incomingText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 8,
  },
  groupName: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  centerSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callerAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  callerAvatarText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  callerName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  callingText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  bottomSection: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 60,
    paddingHorizontal: 40,
  },
  actionButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  declineButton: {
    backgroundColor: '#EF4444',
  },
  acceptButton: {
    backgroundColor: '#10B981',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
  },
});
