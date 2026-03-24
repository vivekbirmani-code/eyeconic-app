import React, { createContext, useContext, useState, useRef, useEffect, ReactNode } from 'react';
import { Platform, Vibration, AppState } from 'react-native';
import WakeUpModule from '@/modules/WakeUpModule';
import { io, Socket } from 'socket.io-client';
import { getSocketURL } from '@/services/config';
import { useAuth } from './AuthContext';
import { dismissCallNotification } from '@/utils/notificationService';

// Safe import for expo-av Audio
let Audio: any = null;
try {
  const expoAv = require('expo-av');
  Audio = expoAv.Audio;
} catch (e) {
  console.log('expo-av Audio not available');
}

// WebRTC imports - handled safely for both Expo Go and Native
let RTCPeerConnection: any;
let RTCSessionDescription: any;
let RTCIceCandidate: any;
let mediaDevices: any;
let MediaStream: any;
let RTCView: any;
let InCallManager: any;
let isWebRTCAvailable = false;

try {
  const webrtc = require('react-native-webrtc');
  RTCPeerConnection = webrtc.RTCPeerConnection;
  RTCSessionDescription = webrtc.RTCSessionDescription;
  RTCIceCandidate = webrtc.RTCIceCandidate;
  mediaDevices = webrtc.mediaDevices;
  MediaStream = webrtc.MediaStream;
  RTCView = webrtc.RTCView;
  isWebRTCAvailable = true;
  console.log('WebRTC initialized successfully');
  
  // Try to import InCallManager for audio routing
  try {
    InCallManager = require('react-native-incall-manager').default;
  } catch (e) {
    console.log('InCallManager not available');
  }
} catch (e) {
  console.log('WebRTC not available - calls will be disabled in this environment (likely Expo Go)');
  
  // Mock objects to prevent crashes if code is accidentally called
  RTCPeerConnection = class {};
  RTCSessionDescription = class {};
  RTCIceCandidate = class {};
  mediaDevices = { getUserMedia: () => Promise.reject('WebRTC not available') };
  MediaStream = class {};
  RTCView = () => null;
}

interface Participant {
  _id: string;
  name: string;
  isMuted: boolean;
  isSpeaking?: boolean;
}

interface IncomingCallData {
  callId: string;
  groupId: string;
  groupName: string;
  callerName: string;
  callerId: string;
}

interface CallState {
  callId: string | null;
  groupId: string | null;
  groupName: string | null;
  isInCall: boolean;
  isMinimized: boolean;
  isMuted: boolean;
  isSpeakerOn: boolean;
  participants: Participant[];
  callDuration: number;
  isInitiator: boolean;
}

// Debug statistics for troubleshooting
interface DebugStats {
  iceStatus: string;
  signalingStatus: string;
  localTrackCount: number;
  remoteTrackCount: number;
  socketConnected: boolean;
  iceCandidatesSent: number;
  iceCandidatesReceived: number;
}

interface CallContextType {
  callState: CallState;
  incomingCall: IncomingCallData | null;
  initiateCall: (groupId: string, groupName: string, targetUserIds: string[]) => void;
  joinCall: (callId: string, groupId: string, groupName: string) => void;
  acceptIncomingCall: () => void;
  declineIncomingCall: () => void;
  leaveCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  minimizeCall: () => void;
  maximizeCall: () => void;
  addParticipant: (userId: string) => void;
  localStream: any;
  remoteStreams: Map<string, any>;
  isWebRTCSupported: boolean;
  debugStats: DebugStats; // Added debug stats
}

const initialCallState: CallState = {
  callId: null,
  groupId: null,
  groupName: null,
  isInCall: false,
  isMinimized: false,
  isMuted: false,
  isSpeakerOn: false,
  participants: [],
  callDuration: 0,
  isInitiator: false,
};

const initialDebugStats: DebugStats = {
  iceStatus: 'new',
  signalingStatus: 'stable',
  localTrackCount: 0,
  remoteTrackCount: 0,
  socketConnected: false,
  iceCandidatesSent: 0,
  iceCandidatesReceived: 0,
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
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, any>>(new Map());
  const [debugStats, setDebugStats] = useState<DebugStats>(initialDebugStats); // Added debug state
  
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionsRef = useRef<Map<string, any>>(new Map());
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerStartedRef = useRef<boolean>(false); // Track if timer was started for this call session
  const localStreamRef = useRef<any>(null);
  const pendingCandidatesRef = useRef<Map<string, any[]>>(new Map());
  
  // Refs to access current state in socket callbacks (fixes stale closure issue)
  const callStateRef = useRef(callState);
  const userRef = useRef(user);
  
  // Keep refs in sync with state
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);
  
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    if (user?._id) {
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
      setDebugStats(prev => ({ ...prev, socketConnected: true }));
      // Use ref to get current user (fixes stale closure)
      socketRef.current?.emit('register_user', userRef.current?._id);
    });

    socketRef.current.on('disconnect', () => {
      console.log('Call socket disconnected');
      setDebugStats(prev => ({ ...prev, socketConnected: false }));
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
    socketRef.current.on('call_joined', handleCallJoined);
    socketRef.current.on('call_declined', handleCallDeclined);
  };

  const handleCallDeclined = (data: any) => {
    const { userId, callId } = data;
    console.log(`User ${userId} declined call ${callId}`);
    
    // If we are the initiator, we might want to show feedback or end the call if it's 1-on-1
    if (callStateRef.current.isInitiator && callStateRef.current.callId === callId) {
      // Find the participant name
      const participantName = callStateRef.current.participants.find(p => p._id === userId)?.name || 'Participant';
      
      console.log(`${participantName} declined the call`);
      
      // If it's a 1-on-1 call and they declined, we should end the call session for us too
      // since there's no one else to talk to.
      // If it's a 1-on-1 call and they declined, we should end the call session for us too
      // since there's no one else to talk to. Notify the server to finalize the message.
      if (callStateRef.current.participants.length <= 2) {
        console.log('1-on-1 call declined, ending call for initiator');
        endCall();
      }
    }
  };

  const handleIncomingCall = (data: any) => {
    const { callId, groupId, initiatorId, initiatorName, groupName, targetUserIds } = data;

    // Guard: only show ring to the user(s) who were explicitly targeted
    // This is a client-side safety check in addition to the server-side targeted emit
    const currentUserId = userRef.current?._id;
    if (targetUserIds && targetUserIds.length > 0) {
      const isTargeted = targetUserIds.some(
        (id: string) => id.toString() === currentUserId?.toString()
      );
      if (!isTargeted) {
        console.log('Ignoring incoming_call — current user is not a target');
        return;
      }
    }

    // Use ref to avoid stale closure on isInCall state
    if (callStateRef.current.isInCall) return;
    
    console.log('Incoming call from:', initiatorName);
    
    // Set incoming call state to show full-screen UI
    setIncomingCall({
      callId,
      groupId,
      groupName: groupName || 'Group Call',
      callerName: initiatorName,
      callerId: initiatorId,
    });

    if (Platform.OS === 'android') {
      const appState = AppState.currentState;
      if (appState === 'background' || appState === 'inactive') {
        try {
          WakeUpModule.activate();
        } catch (error) {
          console.error('Failed to wake up device:', error);
        }
      }
    }
  };

  const handleCallInitiated = (data: any) => {
    console.log('Call initiated:', data.callId);
    setCallState(prev => ({
      ...prev,
      callId: data.callId
    }));
  };

  const handleCallJoined = (data: any) => {
    console.log('Successfully joined call:', data);
    // Update participants from server
    if (data.participants) {
      const participantsList = data.participants
        .filter((p: any) => !p.leftAt)
        .map((p: any) => ({
          _id: p.userId.toString(),
          name: p.userName || 'Unknown',
          isMuted: p.isMuted || false,
        }));
      
      // Calculate synced call duration from server startTime
      let syncedDuration = 0;
      if (data.startTime) {
        const startTime = new Date(data.startTime).getTime();
        const now = Date.now();
        syncedDuration = Math.floor((now - startTime) / 1000);
      }
      
      setCallState(prev => ({
        ...prev,
        participants: participantsList,
        callDuration: syncedDuration > 0 ? syncedDuration : prev.callDuration
      }));
      
      // Start timer for joiners after syncing with server time
      // Only start if this call session hasn't started a timer yet
      if (!timerStartedRef.current) {
        timerStartedRef.current = true;
        startCallTimer();
      }
    }
  };

  const handleCallOffer = async (data: any) => {
    if (!isWebRTCAvailable) return;
    const { callId, offer, fromUserId } = data;
    
    console.log('Received call offer from:', fromUserId);
    
    // Skip if this offer is from ourselves (use ref to avoid stale closure)
    if (fromUserId === userRef.current?._id) return;

    try {
      // CRITICAL: Ensure local stream exists BEFORE creating peer connection
      // Otherwise our audio tracks won't be added to the connection
      if (!localStreamRef.current) {
        console.log('Starting local stream for incoming offer...');
        const stream = await startLocalStream();
        if (!stream) {
          console.error('Failed to start local stream for call');
          return;
        }
      }

      // Start InCallManager for audio routing (receiver side)
      if (InCallManager) {
        InCallManager.start({ media: 'audio', auto: true, ringback: '' });
        InCallManager.setForceSpeakerphoneOn(false);
        console.log('InCallManager started for receiver');
      }

      // Get or create peer connection (now local stream exists)
      let pc = peerConnectionsRef.current.get(fromUserId);
      if (!pc) {
        pc = await createPeerConnection(fromUserId);
        peerConnectionsRef.current.set(fromUserId, pc);
      }

      // Set remote description
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      // Add any pending ICE candidates
      const pendingCandidates = pendingCandidatesRef.current.get(fromUserId) || [];
      for (const candidate of pendingCandidates) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingCandidatesRef.current.delete(fromUserId);
      
      // Create and send answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Use refs to get current state values (fixes stale closure)
      const currentCallState = callStateRef.current;
      const currentUser = userRef.current;
      
      console.log('Sending answer with callId:', callId || currentCallState.callId, 'groupId:', currentCallState.groupId);

      socketRef.current?.emit('call_answer', {
        callId: callId || currentCallState.callId,
        groupId: currentCallState.groupId,
        answer: pc.localDescription,
        fromUserId: currentUser?._id,
        toUserId: fromUserId
      });
      
      console.log('Sent call answer to:', fromUserId, 'with local tracks:', localStreamRef.current?.getTracks().length);
    } catch (error) {
      console.error('Error handling call offer:', error);
    }
  };

  const handleCallAnswer = async (data: any) => {
    if (!isWebRTCAvailable) return;
    const { callId, answer, fromUserId } = data;
    
    console.log('Received call answer from:', fromUserId);
    
    // Skip if this is from ourselves (use ref to avoid stale closure)
    if (fromUserId === userRef.current?._id) return;

    try {
      const pc = peerConnectionsRef.current.get(fromUserId);
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('Set remote description from:', fromUserId);
        
        // Add any pending ICE candidates
        const pendingCandidates = pendingCandidatesRef.current.get(fromUserId) || [];
        for (const candidate of pendingCandidates) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingCandidatesRef.current.delete(fromUserId);
      }
    } catch (error) {
      console.error('Error handling call answer:', error);
    }
  };

  const handleIceCandidate = async (data: any) => {
    if (!isWebRTCAvailable) return;
    const { callId, candidate, fromUserId } = data;
    
    // Skip if this is from ourselves (use ref to avoid stale closure)
    if (fromUserId === userRef.current?._id) return;

    try {
      setDebugStats(prev => ({ ...prev, iceCandidatesReceived: prev.iceCandidatesReceived + 1 }));
      const pc = peerConnectionsRef.current.get(fromUserId);
      if (pc && candidate) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          // Queue candidate for later
          const pending = pendingCandidatesRef.current.get(fromUserId) || [];
          pending.push(candidate);
          pendingCandidatesRef.current.set(fromUserId, pending);
        }
      }
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  };

  const handleUserJoined = async (data: any) => {
    const { userId, userName, callId } = data;
    
    console.log('User joined call:', userName, userId);
    
    // Add to participants if not already there
    setCallState(prev => {
      const exists = prev.participants.some(p => p._id === userId);
      if (exists) return prev;
      return {
        ...prev,
        participants: [...prev.participants, { _id: userId, name: userName, isMuted: false }]
      };
    });

    // If we're the initiator or already in call, create offer for new participant
    // Use refs to get current state values (fixes stale closure issue)
    const currentCallState = callStateRef.current;
    const currentUser = userRef.current;
    
    console.log('handleUserJoined check:', {
      isInCall: currentCallState.isInCall,
      isWebRTCAvailable,
      userId,
      currentUserId: currentUser?._id
    });
    
    if (currentCallState.isInCall && isWebRTCAvailable && userId !== currentUser?._id) {
      console.log('Creating offer for new participant:', userId);
      // Small delay to ensure local stream is ready
      setTimeout(() => {
        createOfferForUser(userId);
      }, 500);
    }
  };

  const handleUserLeft = (data: any) => {
    const { userId } = data;
    
    console.log('User left call:', userId);
    
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
    console.log('Call ended');
    cleanup();
    setCallState(initialCallState);
    setIncomingCall(null);
  };

  const createPeerConnection = async (userId: string): Promise<any> => {
    if (!isWebRTCAvailable) return null;
    
    console.log('Creating peer connection for:', userId);
    
    const pc = new RTCPeerConnection(ICE_SERVERS);

    // Handle ICE candidates
    (pc as any).onicecandidate = (event: any) => {
      if (event.candidate) {
        setDebugStats(prev => ({ ...prev, iceCandidatesSent: prev.iceCandidatesSent + 1 }));
        // Use refs to get current state values (fixes stale closure)
        const currentCallState = callStateRef.current;
        const currentUser = userRef.current;
        console.log('Sending ICE candidate, callId:', currentCallState.callId, 'groupId:', currentCallState.groupId);
        socketRef.current?.emit('call_ice_candidate', {
          callId: currentCallState.callId,
          groupId: currentCallState.groupId,
          candidate: event.candidate,
          fromUserId: currentUser?._id
        });
      }
    };

    // Update debug stats on ICE state change
    (pc as any).oniceconnectionstatechange = () => {
      setDebugStats(prev => ({ ...prev, iceStatus: pc.iceConnectionState }));
      console.log('ICE state:', pc.iceConnectionState);
    };

    (pc as any).onsignalingstatechange = () => {
      setDebugStats(prev => ({ ...prev, signalingStatus: pc.signalingState }));
    };

    // Handle incoming audio tracks
    (pc as any).ontrack = (event: any) => {
      console.log('Received remote track from:', userId, event.track.kind);
      setDebugStats(prev => ({ ...prev, remoteTrackCount: prev.remoteTrackCount + 1 }));
      if (event.streams && event.streams[0]) {
        setRemoteStreams(prev => {
          const newMap = new Map(prev);
          newMap.set(userId, event.streams[0]);
          return newMap;
        });
      }
    };
    
    // Handle connection state changes
    (pc as any).onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState, 'for user:', userId);
    };

    // Add local stream tracks if available
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track: any) => {
        console.log('Adding local track:', track.kind);
        pc.addTrack(track, stream);
      });
      setDebugStats(prev => ({ ...prev, localTrackCount: stream.getTracks().length }));
    }

    return pc;
  };

  const createOfferForUser = async (userId: string) => {
    if (!isWebRTCAvailable) return;
    
    console.log('Creating offer for user:', userId);
    
    try {
      // Ensure local stream exists
      if (!localStreamRef.current) {
        console.log('Starting local stream before creating offer...');
        await startLocalStream();
      }

      // Ensure InCallManager is started for audio routing
      if (InCallManager) {
        InCallManager.start({ media: 'audio', auto: true, ringback: '' });
        InCallManager.setForceSpeakerphoneOn(false);
      }

      let pc = peerConnectionsRef.current.get(userId);
      if (!pc) {
        pc = await createPeerConnection(userId);
        peerConnectionsRef.current.set(userId, pc);
      }

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      await pc.setLocalDescription(offer);

      // Use refs to get current state values (fixes stale closure)
      const currentCallState = callStateRef.current;
      const currentUser = userRef.current;
      
      console.log('Sending offer with callId:', currentCallState.callId, 'groupId:', currentCallState.groupId);
      
      socketRef.current?.emit('call_offer', {
        callId: currentCallState.callId,
        groupId: currentCallState.groupId,
        offer: pc.localDescription,
        fromUserId: currentUser?._id,
        targetUserId: userId
      });
      
      console.log('Sent offer to:', userId, 'with local tracks:', localStreamRef.current?.getTracks().length);
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  };

  const startLocalStream = async () => {
    if (!isWebRTCAvailable) {
      console.log('WebRTC not available');
      return null;
    }
    
    try {
      // Simply ensure recording is allowed - let InCallManager handle routing to prevent conflicts
      if (Audio) {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
          // Removed Android earpiece settings to avoid conflict with InCallManager
        });
      }

      const stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false
      });
      
      console.log('Local stream started with tracks:', stream.getTracks().length);
      setLocalStream(stream);
      localStreamRef.current = stream;
      setDebugStats(prev => ({ ...prev, localTrackCount: stream.getTracks().length }));
      return stream;
    } catch (error) {
      console.error('Error getting user media:', error);
      return null;
    }
  };

  const audioLevelIntervalRef = useRef<any>(null);

  const startAudioLevelMonitor = () => {
    if (audioLevelIntervalRef.current) clearInterval(audioLevelIntervalRef.current);
    
    audioLevelIntervalRef.current = setInterval(async () => {
      if (!callState.isInCall) return;

      // check local audio level
      // Note: Getting local audio level from getUserMedia stream directly is hard in RN-WebRTC
      // We'll rely on the fact that if not muted, we are "speaking" if there's input
      // Ideally we'd check stats on the sender track
      
      // Check remote audio levels
      peerConnectionsRef.current.forEach(async (pc, userId) => {
        try {
          const stats = await pc.getStats();
          let audioLevel = 0;
          
          stats.forEach((report: any) => {
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
              // audioLevel is 0..1
              if (report.audioLevel) audioLevel = report.audioLevel;
            }
          });

          // Threshold for "speaking"
          const isSpeaking = audioLevel > 0.05; // 5% volume threshold
          
          setCallState(prev => ({
            ...prev,
            participants: prev.participants.map(p => 
              p._id === userId && p.isSpeaking !== isSpeaking 
                ? { ...p, isSpeaking } 
                : p
            )
          }));
        } catch (e) {
          // ignore stats error
        }
      });
    }, 200); // Check every 200ms
  };

  const startCallTimer = () => {
    // Clear any existing timer first to prevent multiple intervals
    stopCallTimer();
    
    startAudioLevelMonitor(); // Start audio monitoring when call starts
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
    if (audioLevelIntervalRef.current) {
      clearInterval(audioLevelIntervalRef.current);
      audioLevelIntervalRef.current = null;
    }
    timerStartedRef.current = false; // Reset for next call session
  };

  const initiateCall = async (groupId: string, groupName: string, targetUserIds: string[]) => {
    if (!isWebRTCAvailable) {
      console.log('WebRTC not available');
      return;
    }
    
    console.log('Initiating call to group:', groupId);
    
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

    // Start InCallManager for audio routing (speaker mode)
    if (InCallManager) {
      InCallManager.start({ media: 'audio', auto: true, ringback: '' });
      InCallManager.setForceSpeakerphoneOn(false);
      console.log('InCallManager started for call (earpiece mode)');
    }

    socketRef.current?.emit('join_room', groupId);
    socketRef.current?.emit('call_initiate', {
      groupId,
      groupName,
      initiatorId: user?._id,
      initiatorName: user?.name,
      targetUserIds
    });

    timerStartedRef.current = true;
    startCallTimer();
  };

  const joinCall = async (callId: string, groupId: string, groupName: string) => {
    if (!isWebRTCAvailable) {
      console.log('WebRTC not available');
      return;
    }
    
    console.log('Joining call:', callId);
    
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

    // Start InCallManager for audio routing (speaker mode)
    if (InCallManager) {
      InCallManager.start({ media: 'audio', auto: true, ringback: '' });
      InCallManager.setForceSpeakerphoneOn(false);
      console.log('InCallManager started for joining call (earpiece mode)');
    }

    socketRef.current?.emit('join_room', groupId);
    socketRef.current?.emit('call_join', {
      callId,
      userId: user?._id,
      userName: user?.name
    });

    // Don't start timer here for joiners - wait for server sync in handleCallJoined
    // This prevents timer de-sync between sender and receiver
  };

  const acceptIncomingCall = async () => {
    if (!incomingCall) return;
    
    console.log('Accepting incoming call');
    
    const { callId, groupId, groupName } = incomingCall;
    setIncomingCall(null);
    
    await joinCall(callId, groupId, groupName);
  };

  const declineIncomingCall = () => {
    if (!incomingCall) return;
    
    console.log('Declining incoming call');
    
    // Notify the server that we declined
    socketRef.current?.emit('call_decline', {
      callId: incomingCall.callId,
      groupId: incomingCall.groupId,
      userId: user?._id
    });
 
    setIncomingCall(null);
  };

  const leaveCall = () => {
    console.log('Leaving call');
    socketRef.current?.emit('call_leave', {
      callId: callState.callId,
      userId: user?._id
    });

    cleanup();
    setCallState(initialCallState);
  };

  const endCall = () => {
    console.log('Ending call for everyone');
    socketRef.current?.emit('call_end', {
      callId: callState.callId,
      endedBy: user?._id,
      endedByName: user?.name
    });

    cleanup();
    setCallState(initialCallState);
  };

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const isMuted = !audioTrack.enabled;
        
        console.log('Mute toggled:', isMuted);
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

  const toggleSpeaker = () => {
    if (InCallManager) {
      const newSpeakerState = !callState.isSpeakerOn;
      InCallManager.setForceSpeakerphoneOn(newSpeakerState);
      setCallState(prev => ({ ...prev, isSpeakerOn: newSpeakerState }));
      console.log('Speaker toggled:', newSpeakerState ? 'ON' : 'OFF');
    }
  };

  const addParticipant = (userId: string) => {
    if (isWebRTCAvailable) {
      createOfferForUser(userId);
    }
  };

  const cleanup = () => {
    console.log('Cleaning up call resources');
    stopCallTimer();
    dismissCallNotification();
    
    // Stop InCallManager
    if (InCallManager) {
      InCallManager.stop();
      console.log('InCallManager stopped');
    }
    
    // Close all peer connections
    peerConnectionsRef.current.forEach((pc, id) => {
      try {
        pc.close();
      } catch (e) {
        console.log('Error closing peer connection:', e);
      }
    });
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();

    // Stop local stream
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track: any) => {
        track.stop();
      });
      setLocalStream(null);
      localStreamRef.current = null;
    }

    setRemoteStreams(new Map());
  };

  return (
    <CallContext.Provider
      value={{
        callState,
        incomingCall,
        initiateCall,
        joinCall,
        acceptIncomingCall,
        declineIncomingCall,
        leaveCall,
        endCall,
        toggleMute,
        toggleSpeaker,
        minimizeCall,
        maximizeCall,
        addParticipant,
        localStream,
        remoteStreams,
        isWebRTCSupported: isWebRTCAvailable,
        debugStats, // Added
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
