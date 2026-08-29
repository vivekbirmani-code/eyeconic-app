import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { WrongQuestion } from '@/types/quiz-result';

interface WrongQuestionSectionProps {
  questions: WrongQuestion[];
  shareSolution: boolean;
}

export function WrongQuestionSection({ questions, shareSolution }: WrongQuestionSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(
    questions.length === 1 ? questions[0].questionId : null
  );

  if (questions.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Review Your Mistakes</Text>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>You did not answer any questions incorrectly in this quiz.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Review Your Mistakes</Text>
      <Text style={styles.subtitle}>
        {questions.length} incorrect {questions.length === 1 ? 'question' : 'questions'} in this attempt
      </Text>

      {questions.map((item) => {
        const isExpanded = expandedId === item.questionId;
        const previousIncorrect = item.history?.previousIncorrectAttempts || 0;
        const sectionLabel = item.section || item.subjectName || item.topicName;

        return (
          <View key={item.questionId} style={styles.card}>
            <TouchableOpacity
              style={styles.cardHeader}
              onPress={() => setExpandedId(isExpanded ? null : item.questionId)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isExpanded }}
            >
              <View style={styles.headerText}>
                <Text style={styles.questionNumber}>Question {item.displayNumber}</Text>
                {sectionLabel ? (
                  <Text style={styles.sectionTag} numberOfLines={1}>{sectionLabel}</Text>
                ) : null}
                <Text style={styles.questionPreview} numberOfLines={isExpanded ? undefined : 2}>
                  {item.question}
                </Text>
              </View>
              {isExpanded ? (
                <ChevronUp color="#6B7280" size={20} />
              ) : (
                <ChevronDown color="#6B7280" size={20} />
              )}
            </TouchableOpacity>

            {isExpanded && (
              <View style={styles.cardBody}>
                {item.questionImage ? (
                  <Image source={{ uri: item.questionImage }} style={styles.questionImage} resizeMode="contain" />
                ) : null}

                <View style={styles.answerBlock}>
                  <Text style={styles.answerLabel}>Your answer</Text>
                  <Text style={styles.answerWrong}>
                    {item.selectedAnswerLabel}
                    {item.selectedAnswerText && item.selectedAnswerText !== item.selectedAnswerLabel
                      ? `. ${item.selectedAnswerText}`
                      : ''}
                  </Text>
                </View>

                {shareSolution && item.correctAnswerLabel ? (
                  <View style={styles.answerBlock}>
                    <Text style={styles.answerLabel}>Correct answer</Text>
                    <Text style={styles.answerCorrect}>
                      {item.correctAnswerLabel}
                      {item.correctAnswerText && item.correctAnswerText !== item.correctAnswerLabel
                        ? `. ${item.correctAnswerText}`
                        : ''}
                    </Text>
                  </View>
                ) : null}

                {previousIncorrect > 0 ? (
                  <Text style={styles.historyText}>
                    Previously answered incorrectly {previousIncorrect}{' '}
                    {previousIncorrect === 1 ? 'time' : 'times'} across other quizzes.
                  </Text>
                ) : (
                  <Text style={styles.historyMuted}>First time answering this question incorrectly.</Text>
                )}

                {shareSolution && item.explanation ? (
                  <View style={styles.explanationBlock}>
                    <Text style={styles.answerLabel}>Explanation</Text>
                    <Text style={styles.explanationText}>{item.explanation}</Text>
                    {item.explanationImage ? (
                      <Image source={{ uri: item.explanationImage }} style={styles.questionImage} resizeMode="contain" />
                    ) : null}
                  </View>
                ) : null}
              </View>
            )}
          </View>
        );
      })}
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
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 12,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#FEE2E2',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: 16,
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  questionNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#EF4444',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  sectionTag: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 6,
  },
  questionPreview: {
    fontSize: 15,
    color: '#1F2937',
    lineHeight: 22,
  },
  cardBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  questionImage: {
    width: '100%',
    height: 160,
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
  },
  answerBlock: {
    gap: 4,
  },
  answerLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
  },
  answerWrong: {
    fontSize: 14,
    color: '#B91C1C',
    fontWeight: '600',
  },
  answerCorrect: {
    fontSize: 14,
    color: '#047857',
    fontWeight: '600',
  },
  historyText: {
    fontSize: 13,
    color: '#92400E',
    backgroundColor: '#FFFBEB',
    padding: 10,
    borderRadius: 8,
  },
  historyMuted: {
    fontSize: 13,
    color: '#6B7280',
  },
  explanationBlock: {
    gap: 6,
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 8,
  },
  explanationText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
});
