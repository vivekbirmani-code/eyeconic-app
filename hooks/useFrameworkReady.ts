import { useEffect } from 'react';
import { Platform } from 'react-native';

export function useFrameworkReady() {
  useEffect(() => {
    // Only call on web platform where window.frameworkReady exists
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      (window as any).frameworkReady?.();
    }
  });
}
