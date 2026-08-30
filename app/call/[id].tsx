import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  FlatList,
  Modal,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { FullScreenContainer } from '@/components/layout';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Phone, PhoneOff, Mic, MicOff, UserPlus, X, Check, Volume2, VolumeX } from 'lucide-react-native';
import { useCall } from '@/context/CallContext';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';

// Try to import RTCView for audio playback
let RTCView: any = null;
try {
  const webrtc = require('react-native-webrtc');
  RTCView = webrtc.RTCView;
} catch (e) {
  console.log('RTCView not available');
}

interface Member {
  _id: string;
  name: string;
  email: string;
}

function resolveRouteParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default function CallScreen() {
  const { id: groupIdParam, callId: callIdParam } = useLocalSearchParams<{ id: string; callId?: string }>();
  const groupId = resolveRouteParam(groupIdParam);
  const callId = resolveRouteParam(callIdParam);
  const router = useRouter();
  const { user } = useAuth();
  const {
    callState,
    initiateCall,
    joinCall,
    leaveCall,
    endCall,
    toggleMute,
    toggleSpeaker,
    minimizeCall,
    addParticipant,
    remoteStreams,
    isWebRTCSupported,
  } = useCall();

  const [groupMembers, setGroupMembers] = useState<Member[]>([]);
  const [groupName, setGroupName] = useState('');
  const [isAddMemberVisible, setIsAddMemberVisible] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [isStartingCall, setIsStartingCall] = useState(false);
  const [showWebCallModal, setShowWebCallModal] = useState(false);
  const wasInCallRef = useRef(false);

  useEffect(() => {
    if (groupId) {
      fetchGroupDetails();
    }
  }, [groupId]);

  useEffect(() => {
    // If we have a callId parameter, join the existing call
    if (callId && groupId && !callState.isInCall) {
      joinCall(callId, groupId, groupName);
    }
  }, [callId, groupId, groupName]);

  useEffect(() => {
    if (callState.isInCall) {
      wasInCallRef.current = true;
      return;
    }

    // If this screen had an active call and it ended/disconnected, return to previous screen.
    if (wasInCallRef.current) {
      wasInCallRef.current = false;
      router.back();
    }
  }, [callState.isInCall, router]);

  const fetchGroupDetails = async () => {
    if (!groupId) return;
    try {
      const response = await api.get(`/groups/${groupId}`);
      setGroupName(response.data.name);
      setGroupMembers(response.data.members || []);
    } catch (error) {
      console.error('Error fetching group:', error);
      Alert.alert('Unable to load group', 'Please go back and try again.');
    }
  };

  const handleStartCall = async () => {
    if (Platform.OS === 'web') {
      setShowWebCallModal(true);
      return;
    }

    if (!groupId) {
      Alert.alert('Unable to start call', 'Group information is missing. Please go back and try again.');
      return;
    }

    if (!isWebRTCSupported) {
      Alert.alert(
        'Calling unavailable',
        'Voice calling is not available in this environment. Please use the App Store build on a physical device.'
      );
      return;
    }

    const targetUserIds =
      selectedMembers.length > 0
        ? selectedMembers
        : groupMembers.filter(m => m._id !== user?._id).map(m => m._id);

    if (targetUserIds.length === 0) {
      Alert.alert('No members to call', 'There are no other members in this group to call.');
      return;
    }

    setIsStartingCall(true);
    try {
      const started = await initiateCall(groupId, groupName, targetUserIds);
      if (!started) {
        console.log('Call did not start — microphone permission or media stream unavailable');
      }
    } catch (error) {
      console.error('Error starting call:', error);
      Alert.alert('Call failed', 'Could not start the call. Please try again.');
    } finally {
      setIsStartingCall(false);
    }
  };

  const handleBack = () => {
    if (callState.isInCall) {
      minimizeCall();
    }
    router.back();
  };

  const handleEndCall = () => {
    if (callState.isInitiator) {
      endCall();
    } else {
      leaveCall();
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleMemberSelection = (memberId: string) => {
    setSelectedMembers(prev =>
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  };

  const nonParticipatingMembers = groupMembers.filter(
    m => !callState.participants.some(p => p._id === m._id) && m._id !== user?._id
  );

  const handleAddParticipant = (userId: string) => {
    addParticipant(userId);
    setIsAddMemberVisible(false);
  };

  // If not in a call, show the call initiation screen
  if (!callState.isInCall) {
    return (
      <FullScreenContainer style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft color="#000000" size={24} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Start Call</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.content}>
          <View style={styles.callIcon}>
            <Phone color="#FFFFFF" size={40} />
          </View>
          <Text style={styles.groupName}>{groupName}</Text>
          <Text style={styles.memberCount}>{groupMembers.length} members</Text>

          <Text style={styles.sectionTitle}>Select participants (optional)</Text>
          <ScrollView
            style={styles.memberList}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {groupMembers.filter(m => m._id !== user?._id).map(member => (
              <TouchableOpacity
                key={member._id}
                style={[
                  styles.memberItem,
                  selectedMembers.includes(member._id) && styles.memberItemSelected
                ]}
                onPress={() => toggleMemberSelection(member._id)}
              >
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>
                    {member.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.memberName}>{member.name}</Text>
                {selectedMembers.includes(member._id) && (
                  <Check color="#10B981" size={20} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={[styles.startCallButton, isStartingCall && styles.startCallButtonDisabled]}
            onPress={handleStartCall}
            disabled={isStartingCall}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={
              selectedMembers.length > 0
                ? `Call ${selectedMembers.length} selected members`
                : 'Call all members'
            }
          >
            {isStartingCall ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Phone color="#FFFFFF" size={24} />
            )}
            <Text style={styles.startCallButtonText}>
              {isStartingCall
                ? 'Starting call...'
                : selectedMembers.length > 0
                  ? `Call ${selectedMembers.length} selected`
                  : 'Call All Members'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Web-only: Calling not available modal */}
        <Modal visible={showWebCallModal} animationType="fade" transparent>
          <View style={styles.webModalOverlay}>
            <View style={styles.webModalContainer}>
              <View style={styles.webModalIconContainer}>
                <Phone color="#10B981" size={36} />
              </View>
              <Text style={styles.webModalTitle}>Calling Not Available on Web</Text>
              <Text style={styles.webModalMessage}>
                {'Calling is currently available only on our mobile application.\n\nTo access features like voice and group calling, please download the app from the Google Play Store or Apple App Store.'}
              </Text>
              <View style={styles.webModalDivider} />
              <TouchableOpacity
                style={styles.webModalButton}
                onPress={() => setShowWebCallModal(false)}
              >
                <Text style={styles.webModalButtonText}>Got it</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </FullScreenContainer>
    );
  }

  // Active call screen
  // Render audio elements for each remote stream - must have size for audio to work on Android
  const renderAudioStreams = () => {
    if (!RTCView) return null;

    const streams: React.ReactNode[] = [];
    remoteStreams.forEach((stream, odId) => {
      console.log('Rendering RTCView for remote stream:', odId);
      streams.push(
        <RTCView
          key={odId}
          streamURL={stream.toURL()}
          style={{
            position: 'absolute',
            top: -100,
            left: -100,
            width: 50,
            height: 50,
            opacity: 0
          }}
          objectFit="cover"
          zOrder={0}
        />
      );
    });
    return streams;
  };

  return (
    <FullScreenContainer style={styles.callContainer}>
      {/* RTCView components for remote audio - positioned off-screen but NOT hidden */}
      {renderAudioStreams()}

      <View style={styles.callHeader}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <View style={styles.callHeaderInfo}>
          <Text style={styles.callGroupName}>{callState.groupName || groupName}</Text>
          <Text style={styles.callDuration}>{formatDuration(callState.callDuration)}</Text>
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setIsAddMemberVisible(true)}
        >
          <UserPlus color="#FFFFFF" size={24} />
        </TouchableOpacity>
      </View>

      <View style={styles.participantsContainer}>
        <FlatList
          data={callState.participants}
          keyExtractor={(item) => item._id}
          numColumns={2}
          contentContainerStyle={styles.participantsList}
          renderItem={({ item }) => (
            <View style={styles.participantCard}>
              <View style={[
                styles.participantAvatar,
                item.isMuted && styles.participantAvatarMuted,
                item.isSpeaking && styles.participantAvatarSpeaking
              ]}>
                <Text style={styles.participantAvatarText}>
                  {item.name.charAt(0).toUpperCase()}
                </Text>
                {item.isMuted && (
                  <View style={styles.mutedBadge}>
                    <MicOff color="#EF4444" size={12} />
                  </View>
                )}
                {/* Speaking indicator icon/badge could go here too, but border is clearer */}
              </View>
              <Text style={styles.participantName}>
                {item._id === user?._id ? 'You' : item.name}
              </Text>
            </View>
          )}
        />
      </View>

      <View style={styles.callControls}>
        <TouchableOpacity
          style={[styles.controlButton, callState.isMuted && styles.controlButtonActive]}
          onPress={toggleMute}
        >
          {callState.isMuted ? (
            <MicOff color="#FFFFFF" size={28} />
          ) : (
            <Mic color="#FFFFFF" size={28} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, callState.isSpeakerOn && styles.controlButtonActive]}
          onPress={toggleSpeaker}
        >
          {callState.isSpeakerOn ? (
            <Volume2 color="#FFFFFF" size={28} />
          ) : (
            <VolumeX color="#FFFFFF" size={28} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, styles.endCallButton]}
          onPress={handleEndCall}
        >
          <PhoneOff color="#FFFFFF" size={28} />
        </TouchableOpacity>
      </View>

      {/* Add Member Modal */}
      <Modal visible={isAddMemberVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add to Call</Text>
              <TouchableOpacity onPress={() => setIsAddMemberVisible(false)}>
                <X color="#6B7280" size={24} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.memberList}>
              {nonParticipatingMembers.length === 0 ? (
                <Text style={styles.emptyText}>All members are in the call</Text>
              ) : (
                nonParticipatingMembers.map(member => (
                  <TouchableOpacity
                    key={member._id}
                    style={styles.memberItem}
                    onPress={() => handleAddParticipant(member._id)}
                  >
                    <View style={styles.memberAvatar}>
                      <Text style={styles.memberAvatarText}>
                        {member.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <Phone color="#10B981" size={20} />
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </FullScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    padding: 5,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
  },
  content: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
  },
  callIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 30,
    marginBottom: 20,
  },
  groupName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000000',
    textAlign: 'center',
  },
  memberCount: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 5,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginTop: 30,
    marginBottom: 15,
    alignSelf: 'flex-start',
  },
  memberList: {
    width: '100%',
    flex: 1,
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    marginBottom: 8,
  },
  memberItemSelected: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  memberAvatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
  },
  memberName: {
    flex: 1,
    fontSize: 16,
    color: '#000000',
  },
  startCallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10B981',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginTop: 20,
    gap: 10,
    flexShrink: 0,
    minHeight: 56,
  },
  startCallButtonDisabled: {
    opacity: 0.7,
  },
  startCallButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  // Active call styles
  callContainer: {
    flex: 1,
    backgroundColor: '#1F2937',
  },
  callHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 15,
  },
  callHeaderInfo: {
    alignItems: 'center',
  },
  callGroupName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  callDuration: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 4,
  },
  addButton: {
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
  },
  participantsContainer: {
    flex: 1,
    padding: 20,
  },
  participantsList: {
    justifyContent: 'center',
  },
  participantCard: {
    flex: 1,
    alignItems: 'center',
    margin: 10,
    padding: 20,
  },
  participantAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  participantAvatarMuted: {
    backgroundColor: '#6B7280',
  },
  participantAvatarSpeaking: {
    borderWidth: 3,
    borderColor: '#10B981', // Green border when speaking
  },
  participantAvatarText: {
    fontSize: 32,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  mutedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 4,
  },
  participantName: {
    fontSize: 14,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  callControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    padding: 30,
    gap: 40,
  },
  controlButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  endCallButton: {
    backgroundColor: '#EF4444',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    padding: 20,
  },
  // Web-only modal styles
  webModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  webModalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 32,
    width: '100%',
    maxWidth: 460,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  webModalIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ECFDF5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  webModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 12,
  },
  webModalMessage: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  webModalDivider: {
    width: '100%',
    height: 1,
    backgroundColor: '#E5E7EB',
    marginBottom: 20,
  },
  webModalButton: {
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
    alignItems: 'center',
  },
  webModalButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
