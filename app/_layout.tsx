import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider } from '@/context/AuthContext';
import { NotificationProvider } from '@/context/NotificationContext';

export default function RootLayout() {
  useFrameworkReady();

  return (
    <AuthProvider>
      <NotificationProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="+not-found" />
        </Stack>
        <StatusBar style="dark" backgroundColor="#FFFFFF" />
      </NotificationProvider>
    </AuthProvider>
  );
}