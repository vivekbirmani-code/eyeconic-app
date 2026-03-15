import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Phone, PhoneOff, Mic, MicOff } from 'lucide-react-native';
import { useCall } from '@/context/CallContext';
import { useRouter } from 'expo-router';

export default function FloatingCallBar() {
  const { callState, leaveCall, endCall, toggleMute, maximizeCall } = useCall();
  const router = useRouter();

  if (!callState.isInCall || !callState.isMinimized) {
    return null;
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleReturnToCall = () => {
    maximizeCall();
    if (callState.groupId) {
      router.push(`/call/${callState.groupId}?callId=${callState.callId}` as any);
    }
  };

  const handleEndCall = () => {
    if (callState.isInitiator) {
      endCall();
      return;
    }
    leaveCall();
  };

  return (
    <TouchableOpacity 
      style={styles.container}
      onPress={handleReturnToCall}
      activeOpacity={0.9}
    >
      <View style={styles.leftSection}>
        <View style={styles.callIndicator}>
          <Phone color="#FFFFFF" size={16} />
        </View>
        <View style={styles.callInfo}>
          <Text style={styles.callTitle}>{callState.groupName || 'Active Call'}</Text>
          <Text style={styles.callDuration}>
            {formatDuration(callState.callDuration)} • {callState.participants.length} participant(s)
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity 
          style={[styles.actionButton, callState.isMuted && styles.actionButtonActive]}
          onPress={toggleMute}
        >
          {callState.isMuted ? (
            <MicOff color="#FFFFFF" size={16} />
          ) : (
            <Mic color="#FFFFFF" size={16} />
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.actionButton, styles.endButton]}
          onPress={handleEndCall}
        >
          <PhoneOff color="#FFFFFF" size={16} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 10,
    left: 10,
    right: 10,
    backgroundColor: '#10B981',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    zIndex: 1000,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  callIndicator: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  callInfo: {
    flex: 1,
  },
  callTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  callDuration: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  endButton: {
    backgroundColor: '#EF4444',
  },
});
