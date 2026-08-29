import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AlertCircle } from 'lucide-react-native';
import { FrequentlyMissedQuestion } from '@/types/quiz-result';

interface FrequentlyMissedSectionProps {
  questions: FrequentlyMissedQuestion[];
}

export function FrequentlyMissedSection({ questions }: FrequentlyMissedSectionProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Frequently Missed Questions</Text>

      {questions.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Not enough history yet</Text>
          <Text style={styles.emptyText}>
            As you complete more quizzes, questions you often answer incorrectly will appear here to help you focus your revision.
          </Text>
        </View>
      ) : (
        questions.map((item) => {
          const sectionLabel = item.section || item.subjectName || item.topicName;
          return (
            <View key={item.questionId} style={styles.card} accessible accessibilityRole="text">
              <View style={styles.cardHeader}>
                <AlertCircle color="#F59E0B" size={18} />
                <Text style={styles.statsText}>
                  Incorrect {item.incorrectAttempts} {item.incorrectAttempts === 1 ? 'time' : 'times'} out of{' '}
                  {item.totalAttempts} {item.totalAttempts === 1 ? 'attempt' : 'attempts'}
                </Text>
              </View>
              <Text style={styles.questionText} numberOfLines={3}>{item.question}</Text>
              {sectionLabel ? (
                <Text style={styles.metaText} numberOfLines={1}>{sectionLabel}</Text>
              ) : null}
              <Text style={styles.latestText}>
                Latest result: {item.latestResult === 'correct' ? 'Correct' : 'Incorrect'}
              </Text>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 20,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  statsText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B45309',
    flex: 1,
  },
  questionText: {
    fontSize: 14,
    color: '#1F2937',
    lineHeight: 20,
    marginBottom: 6,
  },
  metaText: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  latestText: {
    fontSize: 12,
    color: '#4B5563',
  },
});
