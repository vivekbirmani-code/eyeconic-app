import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  StatusBar
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { BookOpen, Clock, FileText, Award } from 'lucide-react-native';
import { api } from '@/services/api';
import { useQuiz } from '@/context/QuizContext';
import { formatToIST } from '@/utils/date';

interface Quiz {
  _id: string;
  title: string;
  subject: any;
  subjectNames?: string[]; // computed by backend
  duration: number;
  instructions: string[];
  totalMarks: number;
  questions: any[];
  attemptStatus?: any;
  scheduledDate?: string;
  expiryDate?: string;
}

export default function QuizInstructions() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { startQuiz, isLoading: quizLoading } = useQuiz();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchQuizDetails();
  }, [id]);

  const fetchQuizDetails = async () => {
    try {
      const response = await api.get(`/quizzes/${id}`);
      setQuiz(response.data);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to load quiz');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const handleStartQuiz = async () => {
    if (!quiz) return;

    // Check if already attempted
    if (quiz.attemptStatus?.hasAttempted && !quiz.attemptStatus?.canRetake) {
      Alert.alert(
        'Already Attempted',
        'You have already attempted this quiz. Would you like to request a retest from admin?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Request Retest',
            onPress: () => router.push(`/quizzes/${id}/retest-request`)
          }
        ]
      );
      return;
    }

    Alert.alert(
      'Start Quiz',
      'Once started, the timer will begin. Are you ready?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: async () => {
            try {
              await startQuiz(quiz._id);
              router.replace(`/quizzes/${id}/taking`);
            } catch (error) {
              // Error handled in context
            }
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#2563EB" />
      </SafeAreaView>
    );
  }

  if (!quiz) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Quiz not found</Text>
      </SafeAreaView>
    );
  }

  // Get unique sections
  const sections = Array.from(new Set(quiz.questions.map(q => q.section || 'General')));

  const defaultInstructions = [
    'Read each question carefully before answering.',
    'You can navigate between questions using the navigation grid.',
    'Mark questions for review if you wish to revisit them later.',
    'The test will auto-submit when time expires.',
    'Ensure stable internet connection throughout the test.',
  ];

  const instructions = quiz.instructions && quiz.instructions.length > 0
    ? quiz.instructions
    : defaultInstructions;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <BookOpen color="#2563EB" size={32} />
          </View>
          <Text style={styles.title}>{quiz.title}</Text>
          <Text style={styles.subject}>
            {quiz.subjectNames && quiz.subjectNames.length > 1
              ? 'MIXED'
              : (quiz.subjectNames?.[0] || (typeof quiz.subject === 'object' ? quiz.subject?.name : quiz.subject) || 'General').toUpperCase()}
          </Text>
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <FileText color="#2563EB" size={24} />
            <Text style={styles.statValue}>{quiz.questions.length}</Text>
            <Text style={styles.statLabel}>Questions</Text>
          </View>

          <View style={styles.statCard}>
            <Award color="#10B981" size={24} />
            <Text style={styles.statValue}>{quiz.totalMarks}</Text>
            <Text style={styles.statLabel}>Total Marks</Text>
          </View>

          <View style={styles.statCard}>
            <Clock color="#F59E0B" size={24} />
            <Text style={styles.statValue}>{quiz.duration}</Text>
            <Text style={styles.statLabel}>Minutes</Text>
          </View>
        </View>

        {/* Time Window (IST) */}
        {(quiz.scheduledDate || quiz.expiryDate) && (
          <View style={styles.section}>
            <View style={[styles.noteCard, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
              <Text style={[styles.noteTitle, { color: '#1E40AF' }]}>📅 Schedule (IST)</Text>
              {quiz.scheduledDate && (
                <Text style={[styles.noteText, { color: '#1E40AF' }]}>
                  • Starts: {formatToIST(quiz.scheduledDate)}
                </Text>
              )}
              {quiz.expiryDate && (
                <Text style={[styles.noteText, { color: '#1E40AF' }]}>
                  • Ends: {formatToIST(quiz.expiryDate)}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Test Structure */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Test Structure</Text>
          <View style={styles.structureCard}>
            <Text style={styles.structureText}>
              📚 Number of Sections: <Text style={styles.bold}>{sections.length}</Text>
            </Text>
            {sections.map((section, index) => {
              const sectionQuestions = quiz.questions.filter(q =>
                (q.section || 'General') === section
              );
              return (
                <Text key={index} style={styles.structureText}>
                  • {section}: {sectionQuestions.length} questions
                </Text>
              );
            })}
          </View>
        </View>

        {/* General Instructions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>General Instructions</Text>
          <View style={styles.instructionsCard}>
            {instructions.map((instruction, index) => (
              <View key={index} style={styles.instructionItem}>
                <Text style={styles.bullet}>{index + 1}.</Text>
                <Text style={styles.instructionText}>{instruction}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Important Notes */}
        <View style={styles.section}>
          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>⚠️ Important</Text>
            <Text style={styles.noteText}>
              • This quiz can only be attempted once without admin approval{'\n'}
              • The quiz will auto-submit when the timer expires{'\n'}
              • Make sure you have a stable internet connection{'\n'}
              • Do not close the app during the quiz
            </Text>
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Start Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.startButton}
          onPress={handleStartQuiz}
          disabled={quizLoading}
        >
          {quizLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.startButtonText}>Start Test</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#EBF5FF',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    textAlign: 'center',
    marginBottom: 8,
  },
  subject: {
    fontSize: 16,
    color: '#2563EB',
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 12,
  },
  structureCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  structureText: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
  },
  bold: {
    fontWeight: '600',
    color: '#1F2937',
  },
  instructionsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  instructionItem: {
    flexDirection: 'row',
    gap: 8,
  },
  bullet: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
  },
  instructionText: {
    flex: 1,
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
  },
  noteCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  noteTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#92400E',
    marginBottom: 8,
  },
  noteText: {
    fontSize: 14,
    color: '#92400E',
    lineHeight: 20,
  },
  footer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  startButton: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
  },
});
