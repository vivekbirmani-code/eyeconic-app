import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Platform,
  StatusBar,
} from 'react-native';
import { useRouter } from 'expo-router';
import { CheckCircle, LogIn } from 'lucide-react-native';
import { useGuestQuiz } from '@/context/GuestQuizContext';

export default function GuestQuizResult() {
  const router = useRouter();
  const { quizData, clearGuestAttempt } = useGuestQuiz();

  const handleSignIn = () => {
    clearGuestAttempt();
    router.replace('/login');
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
            Contact your administrator if you need login credentials.
          </Text>
        </View>

        {/* Sign In Button */}
        <TouchableOpacity style={styles.primaryButton} onPress={handleSignIn}>
          <LogIn size={20} color="#ffffff" />
          <Text style={styles.primaryButtonText}>Sign In to View Results</Text>
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
  secondaryButton: {
    paddingVertical: 12,
  },
  secondaryButtonText: {
    fontSize: 14,
    color: '#6b7280',
    textDecorationLine: 'underline',
  },
});
