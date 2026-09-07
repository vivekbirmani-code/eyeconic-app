import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Clock } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/layout';
import * as Haptics from '@/utils/haptics';
import { useAuth } from '@/context/AuthContext';
import {
  FeatureKey,
  FEATURE_LABELS,
  isFeatureEnabled,
} from '@/utils/featureAvailability';

interface FeatureComingSoonProps {
  /** Feature whose availability is being reported. */
  feature: FeatureKey;
  /**
   * 'screen' — full-screen state used when the whole route is gated.
   * 'inline' — embedded in an existing screen layout (e.g. tab content).
   */
  variant?: 'screen' | 'inline';
}

/**
 * Professional "Coming Soon" state for temporarily disabled features
 * (see utils/featureAvailability.ts). Rendered instead of disabled feature
 * content so the app never shows a broken or empty screen.
 */
export function FeatureComingSoon({ feature, variant = 'screen' }: FeatureComingSoonProps) {
  const router = useRouter();
  const { user } = useAuth();

  // Free users have no Tests tab — send them Home instead.
  const isFreeUser = user?.isFreeUser === true;

  const handleGoToTests = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.replace((isFreeUser ? '/(tabs)/dashboard' : '/(tabs)/quizzes') as any);
  };

  const content = (
    <View style={styles.centered}>
      <View style={styles.iconCircle}>
        <Clock color="#01b4ae" size={28} />
      </View>
      <Text style={styles.featureLabel}>{FEATURE_LABELS[feature]}</Text>
      <Text style={styles.title}>Coming Soon</Text>
      <Text style={styles.message}>
        This feature is temporarily unavailable and will be enabled in a future
        version.
      </Text>
      {isFeatureEnabled('quizzes') && (
        <TouchableOpacity
          style={styles.ctaButton}
          onPress={handleGoToTests}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={isFreeUser ? 'Go Home' : 'Go to Tests'}
        >
          <Text style={styles.ctaText}>{isFreeUser ? 'Go Home' : 'Go to Tests'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  if (variant === 'inline') {
    return <View style={styles.inlineWrapper}>{content}</View>;
  }

  return (
    <ScreenContainer style={styles.screenWrapper}>{content}</ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenWrapper: {
    backgroundColor: '#FFFFFF',
  },
  inlineWrapper: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(1, 180, 174, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  featureLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#01b4ae',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
  },
  message: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
    maxWidth: 280,
  },
  ctaButton: {
    backgroundColor: '#01b4ae',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
