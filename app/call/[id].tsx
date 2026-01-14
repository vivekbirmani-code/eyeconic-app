import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  FlatList,
  Modal,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Phone, PhoneOff, Mic, MicOff, UserPlus, X, Check } from 'lucide-react-native';
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

export default function CallScreen() {
  const { id: groupId, callId } = useLocalSearchParams<{ id: string; callId?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { 
    callState, 
    initiateCall, 
    joinCall, 
    leaveCall, 
    endCall, 
    toggleMute, 
    minimizeCall,
    addParticipant,
    remoteStreams
  } = useCall();
  
  const [groupMembers, setGroupMembers] = useState<Member[]>([]);
  const [groupName, setGroupName] = useState('');
  const [isAddMemberVisible, setIsAddMemberVisible] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [isStartingCall, setIsStartingCall] = useState(false);

  useEffect(() => {
    fetchGroupDetails();
  }, [groupId]);


  useEffect(() => {
    // If we have a callId parameter, join the existing call
    if (callId && !callState.isInCall) {
      joinCall(callId, groupId, groupName);
    }
  }, [callId, groupName]);

  const fetchGroupDetails = async () => {
    try {
      const response = await api.get(`/groups/${groupId}`);
      setGroupName(response.data.name);
      setGroupMembers(response.data.members || []);
    } catch (error) {
      console.error('Error fetching group:', error);
    }
  };

  const handleStartCall = () => {
    if (selectedMembers.length === 0) {
      // Call all members
      const memberIds = groupMembers
        .filter(m => m._id !== user?._id)
        .map(m => m._id);
      initiateCall(groupId, groupName, memberIds);
    } else {
      initiateCall(groupId, groupName, selectedMembers);
    }
    setIsStartingCall(false);
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
    router.back();
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
  if (!callState.isInCall && !isStartingCall) {
    return (
      <SafeAreaView style={styles.container}>
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
          <ScrollView style={styles.memberList}>
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

          <TouchableOpacity style={styles.startCallButton} onPress={handleStartCall}>
            <Phone color="#FFFFFF" size={24} />
            <Text style={styles.startCallButtonText}>
              {selectedMembers.length > 0 
                ? `Call ${selectedMembers.length} selected`
                : 'Call All Members'
              }
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Active call screen
  // Render hidden audio elements for each remote stream
  const renderAudioStreams = () => {
    if (!RTCView) return null;
    
    const streams: React.ReactNode[] = [];
    remoteStreams.forEach((stream, odId) => {
      streams.push(
        <RTCView
          key={odId}
          streamURL={stream.toURL()}
          style={{ width: 1, height: 1, position: 'absolute', top: -100 }}
          objectFit="cover"
          zOrder={0}
        />
      );
    });
    return streams;
  };

  return (
    <SafeAreaView style={styles.callContainer}>
      {/* Hidden audio players for remote streams */}
      <View style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
        {renderAudioStreams()}
      </View>
      
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
                item.isMuted && styles.participantAvatarMuted
              ]}>
                <Text style={styles.participantAvatarText}>
                  {item.name.charAt(0).toUpperCase()}
                </Text>
                {item.isMuted && (
                  <View style={styles.mutedBadge}>
                    <MicOff color="#EF4444" size={12} />
                  </View>
                )}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
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
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
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
});
