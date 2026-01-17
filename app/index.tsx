import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter, useRootNavigationState } from 'expo-router';
import { useAuth } from '@/context/AuthContext';

export default function Index() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const rootNavigationState = useRootNavigationState();

  useEffect(() => {
    // Wait for both auth loading to complete AND navigation to be ready
    if (!isLoading && rootNavigationState?.key) {
      // Use setTimeout to ensure the layout is fully mounted
      const timer = setTimeout(() => {
        if (user) {
          router.replace('/(tabs)/dashboard');
        } else {
          router.replace('/login');
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [user, isLoading, rootNavigationState?.key]);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Loading...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  text: {
    fontSize: 18,
    color: '#000000',
  },
});