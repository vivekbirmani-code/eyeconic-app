import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Text as RNText, TouchableOpacity as RNTouchable, Platform, Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider } from '@/context/AuthContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { CallProvider, useCall } from '@/context/CallContext';
import { QuizProvider } from '@/context/QuizContext';
import { GuestQuizProvider } from '@/context/GuestQuizContext';
import FloatingCallBar from '@/components/FloatingCallBar';
import IncomingCallScreen from '@/components/IncomingCallScreen';
import DisclaimerScreen from '@/components/DisclaimerScreen';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { requestBatteryOptimizationExemption } from '@/utils/notificationService';
import { useRouter } from 'expo-router';
import { getApiBaseURL } from '@/services/config';

// Inner component to access call context
function AppContent() {
  const { incomingCall, acceptIncomingCall, declineIncomingCall, callState, remoteStreams } = useCall();
  const router = useRouter();
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [isCheckingInitialStatus, setIsCheckingInitialStatus] = useState(true);

  // Register for push notifications
  usePushNotifications();

  useEffect(() => {
    checkInitialStatus();

    // Handle deep links
    const handleDeepLink = async (event: { url: string }) => {
      const parsed = Linking.parse(event.url);
      // Handle mentorship://quiz/{shareToken} deep links
      if (parsed.path?.startsWith('quiz/') || parsed.hostname === 'quiz') {
        const shareToken = parsed.path?.replace('quiz/', '') || parsed.queryParams?.token;
        if (shareToken) {
          try {
            // Check if user is logged in
            const token = await AsyncStorage.getItem('authToken');
            if (token) {
              // User is logged in - use authenticated endpoint to resolve quiz ID
              // This works regardless of isPublic status
              const API_URL = getApiBaseURL();
              const response = await fetch(`${API_URL}/quizzes/by-token/${shareToken}`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              const data = await response.json();

              if (response.ok && data.quizId) {
                // Navigate to the correct tab-based quiz instructions path
                router.replace(`/(tabs)/quizzes/${data.quizId}/instructions` as any);
                return;
              } else if (response.status === 403) {
                 // Student is not assigned to this quiz
                 Alert.alert('Access Denied', data.message || 'Please ask the admin to assign you this test');
                 router.replace('/(tabs)/quizzes' as any);
                 return;
              }
            }
            // Not logged in or couldn't get quiz ID - go to guest mode
            router.replace(`/guest-quiz/${shareToken}` as any);
          } catch (error) {
            console.error('Deep link error:', error);
            // Fallback to guest mode
            router.replace(`/guest-quiz/${shareToken}` as any);
          }
        }
      }
    };

    // Listen for incoming deep links while app is open
    const subscription = Linking.addEventListener('url', handleDeepLink);

    // Handle deep link if app was opened via one
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink({ url });
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (isCheckingInitialStatus || showDisclaimer) return;
    if (Platform.OS !== 'android') return;

    const maybeRequestBatteryOptimizationExemption = async () => {
      try {
        const hasPrompted = await AsyncStorage.getItem('battery_optimization_prompted');
        if (hasPrompted) return;

        await AsyncStorage.setItem('battery_optimization_prompted', 'true');
        await requestBatteryOptimizationExemption();
      } catch (error) {
        console.error('Error requesting battery optimization exemption:', error);
      }
    };

    maybeRequestBatteryOptimizationExemption();
  }, [isCheckingInitialStatus, showDisclaimer]);

  const checkInitialStatus = async () => {
    try {
      // Check disclaimer first
      const disclaimerAccepted = await AsyncStorage.getItem('disclaimer_accepted');
      if (!disclaimerAccepted) {
        setShowDisclaimer(true);
        return;
      }

    } catch (error) {
      console.error('Error checking initial status:', error);
    } finally {
      setIsCheckingInitialStatus(false);
    }
  };

  const handleDisclaimerComplete = () => {
    setShowDisclaimer(false);
    // After disclaimer, check permissions
    checkInitialStatus();
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

      if (!RTCView) return null;

      remoteStreams.forEach((stream, odId) => {
        // Only render if stream and URL exist
        if (stream && stream.toURL()) {
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
        }
      });
    } catch (e) {
      // WebRTC not available - strict safe fail
      return null;
    }

    return streams;
  };

  // Show loading while checking status
  if (isCheckingInitialStatus && !showDisclaimer) {
    return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;
  }

  // Show disclaimer screen first
  if (showDisclaimer) {
    SplashScreen.hideAsync().catch(() => { });
    return <DisclaimerScreen onComplete={handleDisclaimerComplete} />;
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
        <Stack.Screen
          name="create-group"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen name="guest-quiz/[shareToken]" />
        <Stack.Screen name="chat/[id]/index" />
        <Stack.Screen name="chat/[id]/info" />
        <Stack.Screen name="chat/[id]/add-members" />
        <Stack.Screen name="call/[id]" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </View>
  );
}

// Error Boundary to catch crashes and show error info instead of crashing
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('App Error Boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#FEE2E2' }}>
          <View style={{ backgroundColor: '#FFFFFF', padding: 20, borderRadius: 12, maxWidth: 350, width: '100%' }}>
            <StatusBar style="dark" backgroundColor="#FEE2E2" />
            <RNText style={{ fontSize: 18, fontWeight: 'bold', color: '#DC2626', marginBottom: 8 }}>App Crashed</RNText>
            <RNText style={{ fontSize: 14, color: '#374151', marginBottom: 16 }}>{String(this.state.error?.message || 'Unknown error')}</RNText>
            <RNText style={{ fontSize: 12, color: '#6B7280' }}>{String(this.state.error?.stack?.substring(0, 300) || '')}</RNText>
            <RNTouchable
              style={{ marginTop: 16, backgroundColor: '#DC2626', padding: 12, borderRadius: 8, alignItems: 'center' as const }}
              onPress={() => this.setState({ hasError: false, error: null })}
            >
              <RNText style={{ color: '#FFFFFF', fontWeight: '600' }}>Try Again</RNText>
            </RNTouchable>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

export default function RootLayout() {
  useFrameworkReady();

  // useEffect(() => {
  //   if (Platform.OS !== 'web') {
  //     try {
  //       const ScreenCapture = require('expo-screen-capture');
  //       if (ScreenCapture && ScreenCapture.preventScreenCaptureAsync) {
  //         ScreenCapture.preventScreenCaptureAsync().catch(console.warn);
  //       }
  //     } catch (e) {
  //       console.warn('Failed to load expo-screen-capture', e);
  //     }
  //   }
  // }, []);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <NotificationProvider>
            <CallProvider>
              <QuizProvider>
                <GuestQuizProvider>
                  <AppContent />
                  <StatusBar style="dark" backgroundColor="#FFFFFF" />
                </GuestQuizProvider>
              </QuizProvider>
            </CallProvider>
          </NotificationProvider>
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
