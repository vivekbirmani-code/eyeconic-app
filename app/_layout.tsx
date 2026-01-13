import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider } from '@/context/AuthContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { CallProvider } from '@/context/CallContext';
import FloatingCallBar from '@/components/FloatingCallBar';

export default function RootLayout() {
  useFrameworkReady();

  return (
    <AuthProvider>
      <NotificationProvider>
        <CallProvider>
          <View style={{ flex: 1 }}>
            <FloatingCallBar />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="login" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="chat/[id]" />
              <Stack.Screen name="call/[id]" />
              <Stack.Screen name="+not-found" />
            </Stack>
          </View>
          <StatusBar style="dark" backgroundColor="#FFFFFF" />
        </CallProvider>
      </NotificationProvider>
    </AuthProvider>
  );
}