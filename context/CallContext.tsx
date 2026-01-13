import React, { createContext, useContext, useState, useRef, useEffect, ReactNode } from 'react';
import { Platform, Alert } from 'react-native';
import { io, Socket } from 'socket.io-client';
import Constants from 'expo-constants';
import { useAuth } from './AuthContext';

// WebRTC imports - these will fail in Expo Go
let RTCPeerConnection: any;
let RTCSessionDescription: any;
let RTCIceCandidate: any;
let mediaDevices: any;
let MediaStream: any;
let isWebRTCAvailable = false;

try {
  const webrtc = require('react-native-webrtc');
  RTCPeerConnection = webrtc.RTCPeerConnection;
  RTCSessionDescription = webrtc.RTCSessionDescription;
  RTCIceCandidate = webrtc.RTCIceCandidate;
  mediaDevices = webrtc.mediaDevices;
  MediaStream = webrtc.MediaStream;
  isWebRTCAvailable = true;
} catch (e) {
  console.log('WebRTC not available - calls will be disabled');
}

interface Participant {
  _id: string;
  name: string;
  isMuted: boolean;
}

interface CallState {
  callId: string | null;
  groupId: string | null;
  groupName: string | null;
  isInCall: boolean;
  isMinimized: boolean;
  isMuted: boolean;
  participants: Participant[];
  callDuration: number;
  isInitiator: boolean;
}

interface CallContextType {
  callState: CallState;
  initiateCall: (groupId: string, groupName: string, targetUserIds: string[]) => void;
  joinCall: (callId: string, groupId: string, groupName: string) => void;
  leaveCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  minimizeCall: () => void;
  maximizeCall: () => void;
  addParticipant: (userId: string) => void;
  localStream: any;
  remoteStreams: Map<string, any>;
  isWebRTCSupported: boolean;
}

const initialCallState: CallState = {
  callId: null,
  groupId: null,
  groupName: null,
  isInCall: false,
  isMinimized: false,
  isMuted: false,
  participants: [],
  callDuration: 0,
  isInitiator: false,
};

const CallContext = createContext<CallContextType | undefined>(undefined);

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [callState, setCallState] = useState<CallState>(initialCallState);
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, any>>(new Map());
  
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionsRef = useRef<Map<string, any>>(new Map());
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getSocketURL = () => {
    if (Platform.OS === 'web') return 'http://localhost:3000';
    const hostUri = Constants.expoConfig?.hostUri;
    if (hostUri) {
      const ip = hostUri.split(':')[0];
      return `http://${ip}:3000`;
    }
    return 'http://10.78.16.198:3000';
  };

  useEffect(() => {
    if (user?._id && isWebRTCAvailable) {
      setupSocket();
    }

    return () => {
      cleanup();
    };
  }, [user?._id]);

  const setupSocket = () => {
    socketRef.current = io(getSocketURL());

    socketRef.current.on('connect', () => {
      console.log('Call socket connected');
      socketRef.current?.emit('register_user', user?._id);
    });

    // Listen for incoming calls
    socketRef.current.on('incoming_call', handleIncomingCall);
    
    // WebRTC signaling
    socketRef.current.on('call_offer', handleCallOffer);
    socketRef.current.on('call_answer', handleCallAnswer);
    socketRef.current.on('call_ice_candidate', handleIceCandidate);
    
    // Call management
    socketRef.current.on('call_user_joined', handleUserJoined);
    socketRef.current.on('call_user_left', handleUserLeft);
    socketRef.current.on('call_user_muted', handleUserMuted);
    socketRef.current.on('call_ended', handleCallEnded);
    socketRef.current.on('call_initiated', handleCallInitiated);
  };

  const handleIncomingCall = (data: any) => {
    const { callId, groupId, initiatorName } = data;
    
    Alert.alert(
      'Incoming Call',
      `${initiatorName} is calling...`,
      [
        { text: 'Decline', style: 'cancel' },
        { 
          text: 'Accept', 
          onPress: () => joinCall(callId, groupId, 'Call')
        }
      ]
    );
  };

  const handleCallInitiated = (data: any) => {
    setCallState(prev => ({
      ...prev,
      callId: data.callId
    }));
  };

  const handleCallOffer = async (data: any) => {
    if (!isWebRTCAvailable) return;
    const { callId, offer, fromUserId } = data;
    
    if (!callState.isInCall || callState.callId !== callId) return;

    try {
      let pc = peerConnectionsRef.current.get(fromUserId);
      if (!pc) {
        pc = createPeerConnection(fromUserId);
        peerConnectionsRef.current.set(fromUserId, pc);
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketRef.current?.emit('call_answer', {
        callId,
        groupId: callState.groupId,
        answer: pc.localDescription,
        fromUserId: user?._id,
        toUserId: fromUserId
      });
    } catch (error) {
      console.error('Error handling call offer:', error);
    }
  };

  const handleCallAnswer = async (data: any) => {
    if (!isWebRTCAvailable) return;
    const { callId, answer, fromUserId } = data;
    
    if (callState.callId !== callId) return;

    try {
      const pc = peerConnectionsRef.current.get(fromUserId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    } catch (error) {
      console.error('Error handling call answer:', error);
    }
  };

  const handleIceCandidate = async (data: any) => {
    if (!isWebRTCAvailable) return;
    const { callId, candidate, fromUserId } = data;
    
    if (callState.callId !== callId) return;

    try {
      const pc = peerConnectionsRef.current.get(fromUserId);
      if (pc && candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  };

  const handleUserJoined = (data: any) => {
    const { userId, userName } = data;
    
    setCallState(prev => ({
      ...prev,
      participants: [...prev.participants, { _id: userId, name: userName, isMuted: false }]
    }));

    // Create offer for new participant
    if (callState.isInitiator && isWebRTCAvailable) {
      createOfferForUser(userId);
    }
  };

  const handleUserLeft = (data: any) => {
    const { userId } = data;
    
    setCallState(prev => ({
      ...prev,
      participants: prev.participants.filter(p => p._id !== userId)
    }));

    // Close peer connection
    const pc = peerConnectionsRef.current.get(userId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(userId);
    }

    // Remove remote stream
    setRemoteStreams(prev => {
      const newMap = new Map(prev);
      newMap.delete(userId);
      return newMap;
    });
  };

  const handleUserMuted = (data: any) => {
    const { userId, isMuted } = data;
    
    setCallState(prev => ({
      ...prev,
      participants: prev.participants.map(p => 
        p._id === userId ? { ...p, isMuted } : p
      )
    }));
  };

  const handleCallEnded = (data: any) => {
    cleanup();
    setCallState(initialCallState);
  };

  const createPeerConnection = (userId: string): any => {
    if (!isWebRTCAvailable) return null;
    
    const pc = new RTCPeerConnection(ICE_SERVERS);

    // Type assertion needed for react-native-webrtc
    (pc as any).onicecandidate = (event: any) => {
      if (event.candidate) {
        socketRef.current?.emit('call_ice_candidate', {
          callId: callState.callId,
          groupId: callState.groupId,
          candidate: event.candidate,
          fromUserId: user?._id
        });
      }
    };

    (pc as any).ontrack = (event: any) => {
      if (event.streams && event.streams[0]) {
        setRemoteStreams(prev => {
          const newMap = new Map(prev);
          newMap.set(userId, event.streams[0]);
          return newMap;
        });
      }
    };

    // Add local stream tracks
    if (localStream) {
      localStream.getTracks().forEach((track: any) => {
        pc.addTrack(track, localStream);
      });
    }

    return pc;
  };

  const createOfferForUser = async (userId: string) => {
    if (!isWebRTCAvailable) return;
    
    try {
      let pc = peerConnectionsRef.current.get(userId);
      if (!pc) {
        pc = createPeerConnection(userId);
        peerConnectionsRef.current.set(userId, pc);
      }

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      await pc.setLocalDescription(offer);

      socketRef.current?.emit('call_offer', {
        callId: callState.callId,
        groupId: callState.groupId,
        offer: pc.localDescription,
        fromUserId: user?._id,
        targetUserId: userId
      });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  };

  const startLocalStream = async () => {
    if (!isWebRTCAvailable) {
      Alert.alert('Not Available', 'Calling requires a development build. Please run "npx expo prebuild && npx expo run:android"');
      return null;
    }
    
    try {
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      setLocalStream(stream);
      return stream;
    } catch (error) {
      console.error('Error getting user media:', error);
      Alert.alert('Error', 'Failed to access microphone');
      return null;
    }
  };

  const startCallTimer = () => {
    callTimerRef.current = setInterval(() => {
      setCallState(prev => ({
        ...prev,
        callDuration: prev.callDuration + 1
      }));
    }, 1000);
  };

  const stopCallTimer = () => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
  };

  const initiateCall = async (groupId: string, groupName: string, targetUserIds: string[]) => {
    if (!isWebRTCAvailable) {
      Alert.alert('Not Available', 'Calling requires a development build. Please run "npx expo prebuild && npx expo run:android"');
      return;
    }
    
    const stream = await startLocalStream();
    if (!stream) return;

    setCallState({
      ...initialCallState,
      groupId,
      groupName,
      isInCall: true,
      isInitiator: true,
      participants: [{ _id: user?._id || '', name: user?.name || 'You', isMuted: false }]
    });

    socketRef.current?.emit('join_room', groupId);
    socketRef.current?.emit('call_initiate', {
      groupId,
      initiatorId: user?._id,
      initiatorName: user?.name,
      targetUserIds
    });

    startCallTimer();
  };

  const joinCall = async (callId: string, groupId: string, groupName: string) => {
    if (!isWebRTCAvailable) {
      Alert.alert('Not Available', 'Calling requires a development build. Please run "npx expo prebuild && npx expo run:android"');
      return;
    }
    
    const stream = await startLocalStream();
    if (!stream) return;

    setCallState({
      ...initialCallState,
      callId,
      groupId,
      groupName,
      isInCall: true,
      isInitiator: false,
      participants: [{ _id: user?._id || '', name: user?.name || 'You', isMuted: false }]
    });

    socketRef.current?.emit('join_room', groupId);
    socketRef.current?.emit('call_join', {
      callId,
      userId: user?._id,
      userName: user?.name
    });

    startCallTimer();
  };

  const leaveCall = () => {
    socketRef.current?.emit('call_leave', {
      callId: callState.callId,
      userId: user?._id
    });

    cleanup();
    setCallState(initialCallState);
  };

  const endCall = () => {
    socketRef.current?.emit('call_end', {
      callId: callState.callId
    });

    cleanup();
    setCallState(initialCallState);
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const isMuted = !audioTrack.enabled;
        
        setCallState(prev => ({ ...prev, isMuted }));
        
        socketRef.current?.emit('call_mute', {
          callId: callState.callId,
          userId: user?._id,
          isMuted
        });
      }
    }
  };

  const minimizeCall = () => {
    setCallState(prev => ({ ...prev, isMinimized: true }));
  };

  const maximizeCall = () => {
    setCallState(prev => ({ ...prev, isMinimized: false }));
  };

  const addParticipant = (userId: string) => {
    if (isWebRTCAvailable) {
      createOfferForUser(userId);
    }
  };

  const cleanup = () => {
    stopCallTimer();
    
    // Close all peer connections
    peerConnectionsRef.current.forEach(pc => pc?.close?.());
    peerConnectionsRef.current.clear();

    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach((track: any) => track.stop());
      setLocalStream(null);
    }

    setRemoteStreams(new Map());
  };

  return (
    <CallContext.Provider
      value={{
        callState,
        initiateCall,
        joinCall,
        leaveCall,
        endCall,
        toggleMute,
        minimizeCall,
        maximizeCall,
        addParticipant,
        localStream,
        remoteStreams,
        isWebRTCSupported: isWebRTCAvailable,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const context = useContext(CallContext);
  if (context === undefined) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
}
