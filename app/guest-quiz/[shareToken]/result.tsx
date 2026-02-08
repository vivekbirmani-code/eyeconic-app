import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Platform,
  StatusBar,
  Linking,
  Image
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CheckCircle, LogIn, FileText, ArrowRight } from 'lucide-react-native';
import { useGuestQuiz } from '@/context/GuestQuizContext';

const GOOGLE_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSccHeq1gUBguz8MYr4JGFzYFlsZeHCOsEq2BQ6g1chlvmkIuQ/viewform';

export default function GuestQuizResult() {
  const router = useRouter();
  const { shareToken } = useLocalSearchParams<{ shareToken: string }>();
  const { quizData, currentAttempt, clearGuestAttempt } = useGuestQuiz();

  const handleSignIn = () => {
    clearGuestAttempt();
    router.replace('/login');
  };

  const handleStartJourney = () => {
    Linking.openURL(GOOGLE_FORM_URL);
  };

  const handleGoHome = () => {
    clearGuestAttempt();
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      
      <View style={styles.content}>
        {/* Success Icon */}
        <View style={styles.successIconContainer}>
          <CheckCircle size={80} color="#10b981" />
        </View>

        {/* Success Message */}
        <Text style={styles.title}>Quiz Submitted!</Text>
        <Text style={styles.subtitle}>
          {quizData?.title || 'Quiz'} completed successfully
        </Text>

        {/* Info Box */}
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Want to see your results?</Text>
          <Text style={styles.infoText}>
            Sign in to your account to view your score, detailed analysis, and track your progress.
          </Text>
        </View>

        {/* Sign In Button */}
        <TouchableOpacity style={styles.primaryButton} onPress={handleSignIn}>
          <LogIn size={20} color="#ffffff" />
          <Text style={styles.primaryButtonText}>Sign In to View Results</Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Start Journey Card */}
        <TouchableOpacity style={styles.journeyCard} onPress={handleStartJourney}>
          <View style={styles.journeyCardContent}>
            <View style={styles.journeyIconContainer}>
              <FileText size={28} color="#6366f1" />
            </View>
            <View style={styles.journeyTextContainer}>
              <Text style={styles.journeyTitle}>Start Your Journey</Text>
              <Text style={styles.journeyDescription}>
                New here? Fill out our registration form to create an account and unlock all features.
              </Text>
            </View>
            <ArrowRight size={24} color="#6366f1" />
          </View>
        </TouchableOpacity>

        {/* Home Button */}
        <TouchableOpacity style={styles.secondaryButton} onPress={handleGoHome}>
          <Text style={styles.secondaryButtonText}>Go to Home</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  content: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIconContainer: {
    marginBottom: 24,
    padding: 20,
    backgroundColor: '#ecfdf5',
    borderRadius: 100,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 32,
  },
  infoBox: {
    backgroundColor: '#eef2ff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 20,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#6366f1',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e5e7eb',
  },
  dividerText: {
    marginHorizontal: 16,
    fontSize: 14,
    color: '#9ca3af',
  },
  journeyCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  journeyCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  journeyIconContainer: {
    width: 56,
    height: 56,
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  journeyTextContainer: {
    flex: 1,
  },
  journeyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  journeyDescription: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
  },
  secondaryButton: {
    paddingVertical: 12,
  },
  secondaryButtonText: {
    fontSize: 14,
    color: '#6b7280',
    textDecorationLine: 'underline',
  },
});
