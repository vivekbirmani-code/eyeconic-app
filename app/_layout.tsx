import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider } from '@/context/AuthContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { CallProvider, useCall } from '@/context/CallContext';
import { QuizProvider } from '@/context/QuizContext';
import FloatingCallBar from '@/components/FloatingCallBar';
import IncomingCallScreen from '@/components/IncomingCallScreen';
import PermissionsScreen from '@/components/PermissionsScreen';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useRouter } from 'expo-router';

// Inner component to access call context
function AppContent() {
  const { incomingCall, acceptIncomingCall, declineIncomingCall, callState, remoteStreams } = useCall();
  const router = useRouter();
  const [showPermissions, setShowPermissions] = useState(false);
  const [isCheckingPermissions, setIsCheckingPermissions] = useState(true);
  
  // Register for push notifications
  usePushNotifications();

  useEffect(() => {
    checkPermissionsStatus();
  }, []);

  const checkPermissionsStatus = async () => {
    try {
      const permissionsRequested = await AsyncStorage.getItem('permissions_requested');
      if (!permissionsRequested) {
        setShowPermissions(true);
      }
    } catch (error) {
      console.error('Error checking permissions status:', error);
    } finally {
      setIsCheckingPermissions(false);
    }
  };

  const handlePermissionsComplete = () => {
    setShowPermissions(false);
  };

  const handleAcceptCall = () => {
    acceptIncomingCall();
    // Navigate to call screen after accepting
    if (incomingCall) {
      router.push(`/call/${incomingCall.groupId}?callId=${incomingCall.callId}` as any);
    }
  };

  // Render audio elements for remote streams - must have actual size for audio on Android
  const renderAudioStreams = () => {
    const streams: React.ReactNode[] = [];
    
    // Try to import RTCView
    try {
      const { RTCView } = require('react-native-webrtc');
      remoteStreams.forEach((stream, odId) => {
        console.log('Layout rendering RTCView for stream:', odId);
        streams.push(
          <RTCView
            key={odId}
            streamURL={stream.toURL()}
            style={{ 
              position: 'absolute', 
              top: -200, 
              left: -200, 
              width: 50, 
              height: 50,
              opacity: 0
            }}
            objectFit="cover"
            zOrder={0}
          />
        );
      });
    } catch (e) {
      // WebRTC not available
    }
    
    return streams;
  };

  // Show loading while checking permissions
  if (isCheckingPermissions) {
    return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;
  }

  // Show permissions screen on first launch
  if (showPermissions) {
    return <PermissionsScreen onComplete={handlePermissionsComplete} />;
  }

  return (
    <View style={{ flex: 1 }}>
      {/* RTCView audio streams - positioned off-screen but NOT in hidden container */}
      {renderAudioStreams()}
      
      {/* Floating call bar when minimized */}
      <FloatingCallBar />
      
      {/* Incoming call full-screen UI */}
      {incomingCall && (
        <IncomingCallScreen
          callerName={incomingCall.callerName}
          groupName={incomingCall.groupName}
          onAccept={handleAcceptCall}
          onDecline={declineIncomingCall}
        />
      )}
      
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="call/[id]" />
        <Stack.Screen name="quiz/[id]/instructions" />
        <Stack.Screen name="quiz/[id]/taking" />
        <Stack.Screen name="quiz/[id]/result/[attemptId]" />
        <Stack.Screen name="quiz/[id]/review/[attemptId]" />
        <Stack.Screen name="quiz/retest-requests" />
        <Stack.Screen name="admin/quiz-hub" />
        <Stack.Screen name="admin/question-bank" />
        <Stack.Screen name="admin/create-quiz" />
        <Stack.Screen name="admin/student-analytics" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  useFrameworkReady();

  return (
    <AuthProvider>
      <NotificationProvider>
        <CallProvider>
          <QuizProvider>
            <AppContent />
            <StatusBar style="dark" backgroundColor="#FFFFFF" />
          </QuizProvider>
        </CallProvider>
      </NotificationProvider>
    </AuthProvider>
  );
}