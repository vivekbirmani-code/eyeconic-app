import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Linking,
  Alert,
} from 'react-native';
import { FullScreenContainer } from '@/components/layout';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { BookOpen, Clock, FileText, Award, AlertCircle, ExternalLink, MailCheck } from 'lucide-react-native';
import { useGuestQuiz } from '@/context/GuestQuizContext';

interface Quiz {
  _id: string;
  title: string;
  subject: { _id: string; name: string };
  duration: number;
  instructions: string[];
  totalMarks: number;
  questionCount: number;
  // Section-locking metadata (structure only, no question content).
  lockSectionsAfterSubmission?: boolean;
  sections?: { name: string; duration: number; questionCount: number }[];
  // Public-quiz verification (backend decision 2026-10-23): every public
  // quiz now requires OTP email verification, which only the web flow
  // provides — the server sends the authoritative browser URL here.
  webUrl?: string;
  proctoringRequired?: boolean;
}

export default function GuestQuizInstructions() {
  const router = useRouter();
  const { shareToken } = useLocalSearchParams<{ shareToken: string }>();
  const { fetchQuizByToken, startGuestQuiz, isLoading, error } = useGuestQuiz();
  
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [starting, setStarting] = useState(false);
  const [webRedirectUrl, setWebRedirectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (shareToken) {
      loadQuiz();
    }
  }, [shareToken]);

  const loadQuiz = async () => {
    if (!shareToken) return;
    const quizData = await fetchQuizByToken(shareToken);
    if (quizData) {
      setQuiz(quizData as any);
      // Verification redirect (backend decision 2026-10-23): every public
      // quiz requires OTP email verification, which only the browser flow
      // provides — the server sends the authoritative web URL.
      if ((quizData as any).webUrl) {
        setWebRedirectUrl((quizData as any).webUrl as string);
      }
    }
  };

  const openInBrowser = async () => {
    if (!webRedirectUrl) return;
    try {
      const supported = await Linking.canOpenURL(webRedirectUrl);
      if (supported) {
        await Linking.openURL(webRedirectUrl);
      } else {
        Alert.alert('Cannot open browser', webRedirectUrl);
      }
    } catch {
      Alert.alert('Cannot open browser', webRedirectUrl);
    }
  };

  const handleStartQuiz = async () => {
    if (!shareToken) return;
    // The browser flow owns public quizzes now — never attempt an
    // anonymous in-app start when the server offers the web URL.
    if (webRedirectUrl) {
      openInBrowser();
      return;
    }

    setStarting(true);
    try {
      const result = await startGuestQuiz(shareToken);
      if (result?.attemptFinalized) {
        // The attempt ended server-side while the guest was away.
        router.replace(`/guest-quiz/${shareToken}/result` as any);
        return;
      }
      router.replace(`/guest-quiz/${shareToken}/taking`);
    } catch (err) {
      console.error('Failed to start quiz:', err);
    } finally {
      setStarting(false);
    }
  };

  if (isLoading) {
    return (
      <FullScreenContainer style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading quiz...</Text>
        </View>
      </FullScreenContainer>
    );
  }

  // Email-verification redirect: the rest of this flow lives in the browser
  // (OTP verify → proctoring checks where armed → take the test).
  if (webRedirectUrl) {
    return (
      <FullScreenContainer style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
        <View style={styles.redirectContainer}>
          <MailCheck size={64} color="#01b4ae" />
          <Text style={styles.redirectTitle}>Verification required</Text>
          <Text style={styles.redirectText}>
            {quiz?.title ? `${quiz.title}\n\n` : ''}
            This test now opens in your browser. You'll verify your email with a one-time code
            {quiz?.proctoringRequired ? ' and complete a short camera check' : ''} before starting —
            something the browser flow does for you.
          </Text>
          <TouchableOpacity style={styles.redirectButton} onPress={openInBrowser}>
            <ExternalLink size={20} color="#ffffff" />
            <Text style={styles.redirectButtonText}>Open in Browser</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backLink}
            onPress={() => router.replace('/login')}
          >
            <Text style={styles.backLinkText}>Back to login</Text>
          </TouchableOpacity>
        </View>
      </FullScreenContainer>
    );
  }

  if (error || !quiz) {
    return (
      <FullScreenContainer style={styles.container}>
        <View style={styles.errorContainer}>
          <AlertCircle size={64} color="#ef4444" />
          <Text style={styles.errorTitle}>Quiz Not Found</Text>
          <Text style={styles.errorText}>
            {error || 'This quiz link may be invalid or has expired.'}
          </Text>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.replace('/login')}
          >
            <Text style={styles.backButtonText}>Go to Login</Text>
          </TouchableOpacity>
        </View>
      </FullScreenContainer>
    );
  }

  return (
    <FullScreenContainer style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.guestBadge}>
            <Text style={styles.guestBadgeText}>Guest Mode</Text>
          </View>
          <Text style={styles.title}>{quiz.title}</Text>
          <Text style={styles.subject}>{quiz.subject?.name || 'General'}</Text>
        </View>

        {/* Quiz Info Cards */}
        <View style={styles.infoGrid}>
          <View style={styles.infoCard}>
            <Clock size={24} color="#6366f1" />
            <Text style={styles.infoValue}>{quiz.duration} min</Text>
            <Text style={styles.infoLabel}>Duration</Text>
          </View>
          <View style={styles.infoCard}>
            <FileText size={24} color="#6366f1" />
            <Text style={styles.infoValue}>{quiz.questionCount || '—'}</Text>
            <Text style={styles.infoLabel}>Questions</Text>
          </View>
          <View style={styles.infoCard}>
            <Award size={24} color="#6366f1" />
            <Text style={styles.infoValue}>{quiz.totalMarks}</Text>
            <Text style={styles.infoLabel}>Total Marks</Text>
          </View>
        </View>

        {/* Instructions */}
        <View style={styles.instructionsSection}>
          <View style={styles.sectionHeader}>
            <BookOpen size={20} color="#374151" />
            <Text style={styles.sectionTitle}>Instructions</Text>
          </View>
          
          <View style={styles.instructionsList}>
            {quiz.instructions && quiz.instructions.length > 0 ? (
              quiz.instructions.map((instruction, index) => (
                <View key={index} style={styles.instructionItem}>
                  <Text style={styles.instructionNumber}>{index + 1}.</Text>
                  <Text style={styles.instructionText}>{instruction}</Text>
                </View>
              ))
            ) : (
              <>
                <View style={styles.instructionItem}>
                  <Text style={styles.instructionNumber}>1.</Text>
                  <Text style={styles.instructionText}>
                    Read each question carefully before answering.
                  </Text>
                </View>
                <View style={styles.instructionItem}>
                  <Text style={styles.instructionNumber}>2.</Text>
                  <Text style={styles.instructionText}>
                    You can navigate between questions using the navigation panel.
                  </Text>
                </View>
                <View style={styles.instructionItem}>
                  <Text style={styles.instructionNumber}>3.</Text>
                  <Text style={styles.instructionText}>
                    The quiz will auto-submit when the timer runs out.
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* Sequential sections notice (section locking) */}
        {quiz.lockSectionsAfterSubmission !== false && (quiz.sections?.length ?? 0) > 0 && (
          <View style={styles.noticeCard}>
            <AlertCircle size={20} color="#f59e0b" />
            <View style={{ flex: 1 }}>
              <Text style={styles.noticeText}>
                🔒 Sections are sequential — once you submit a section (or its timer ends), you cannot return to it. Each section has its own timer:
              </Text>
              {(quiz.sections || []).map((section, index) => (
                <Text key={index} style={[styles.noticeText, { marginTop: 4 }]}>
                  • {section.name}: {section.questionCount} questions ({section.duration} mins)
                </Text>
              ))}
            </View>
          </View>
        )}

        {/* Guest Notice */}
        <View style={styles.noticeCard}>
          <AlertCircle size={20} color="#f59e0b" />
          <Text style={styles.noticeText}>
            You're taking this quiz as a guest. Sign in after completion to view your results and save them to your profile.
          </Text>
        </View>
      </ScrollView>

      {/* Start Button */}
      <View style={styles.footer}>
        <TouchableOpacity 
          style={[styles.startButton, starting && styles.startButtonDisabled]}
          onPress={handleStartQuiz}
          disabled={starting}
        >
          {starting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.startButtonText}>Start Quiz</Text>
          )}
        </TouchableOpacity>
      </View>
    </FullScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6b7280',
  },
  redirectContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  redirectTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginTop: 20,
  },
  redirectText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 24,
  },
  redirectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#01b4ae',
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 14,
    marginTop: 28,
  },
  redirectButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  backLink: {
    marginTop: 20,
    padding: 8,
  },
  backLinkText: {
    color: '#6366f1',
    fontSize: 15,
    fontWeight: '500',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginTop: 16,
  },
  errorText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
  },
  backButton: {
    marginTop: 24,
    backgroundColor: '#6366f1',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  guestBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginBottom: 12,
  },
  guestBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400e',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  subject: {
    fontSize: 16,
    color: '#6366f1',
    marginTop: 8,
    fontWeight: '500',
  },
  infoGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  infoCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  infoValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginTop: 8,
  },
  infoLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  instructionsSection: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  instructionsList: {
    gap: 12,
  },
  instructionItem: {
    flexDirection: 'row',
    gap: 8,
  },
  instructionNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
    width: 20,
  },
  instructionText: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  noticeCard: {
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  noticeText: {
    flex: 1,
    fontSize: 14,
    color: '#92400e',
    lineHeight: 20,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  startButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  startButtonDisabled: {
    opacity: 0.7,
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
});
