import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { CheckCircle, XCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react-native';
import { QuestionPerformanceItem, WrongQuestion } from '@/types/quiz-result';

interface QuestionPerformanceListProps {
  items: QuestionPerformanceItem[];
  wrongQuestionDetails: WrongQuestion[];
  shareSolution: boolean;
  onViewSolutions?: () => void;
}

function StatusIcon({ status }: { status: QuestionPerformanceItem['status'] }) {
  if (status === 'correct') {
    return <CheckCircle color="#10B981" size={18} />;
  }
  if (status === 'incorrect') {
    return <XCircle color="#EF4444" size={18} />;
  }
  return <Clock color="#F59E0B" size={18} />;
}

function statusLabel(status: QuestionPerformanceItem['status']): string {
  if (status === 'correct') return 'Correct';
  if (status === 'incorrect') return 'Incorrect';
  return 'Unattempted';
}

export function QuestionPerformanceList({
  items,
  wrongQuestionDetails,
  shareSolution,
  onViewSolutions,
}: QuestionPerformanceListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const wrongById = new Map(
    wrongQuestionDetails.map((question) => [question.questionId, question])
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Question Performance</Text>

      {items.map((item) => {
        const displayNumber = item.questionIndex + 1;
        const isExpanded = expandedId === item.questionId;
        const wrongDetail = wrongById.get(item.questionId);

        return (
          <View key={item.questionId} style={styles.card}>
            <TouchableOpacity
              style={styles.row}
              onPress={() => setExpandedId(isExpanded ? null : item.questionId)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isExpanded }}
            >
              <StatusIcon status={item.status} />
              <View style={styles.rowContent}>
                <Text style={styles.questionLabel}>Question {displayNumber}</Text>
                <Text style={styles.statusText}>{statusLabel(item.status)}</Text>
                {item.markedForReview ? (
                  <Text style={styles.reviewTag}>Marked for review</Text>
                ) : null}
              </View>
              {isExpanded ? (
                <ChevronUp color="#9CA3AF" size={18} />
              ) : (
                <ChevronDown color="#9CA3AF" size={18} />
              )}
            </TouchableOpacity>

            {isExpanded && (
              <View style={styles.detail}>
                {item.section ? (
                  <Text style={styles.meta}>Section: {item.section}</Text>
                ) : null}

                {item.status === 'incorrect' && wrongDetail ? (
                  <>
                    <Text style={styles.detailText} numberOfLines={4}>{wrongDetail.question}</Text>
                    <Text style={styles.detailLabel}>Your answer: {wrongDetail.selectedAnswerLabel}</Text>
                    {shareSolution && wrongDetail.correctAnswerLabel ? (
                      <Text style={styles.detailCorrect}>Correct answer: {wrongDetail.correctAnswerLabel}</Text>
                    ) : null}
                    {(item.history?.previousIncorrectAttempts || 0) > 0 ? (
                      <Text style={styles.history}>
                        Previously incorrect {item.history.previousIncorrectAttempts} times
                      </Text>
                    ) : null}
                  </>
                ) : item.status === 'correct' ? (
                  <Text style={styles.detailMuted}>You answered this question correctly.</Text>
                ) : (
                  <Text style={styles.detailMuted}>This question was not attempted.</Text>
                )}

                {!shareSolution && item.status === 'incorrect' && onViewSolutions ? (
                  <Text style={styles.solutionHint}>
                    Solutions are not currently shared for this quiz.
                  </Text>
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
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  rowContent: {
    flex: 1,
  },
  questionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  statusText: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  reviewTag: {
    fontSize: 11,
    color: '#7C3AED',
    marginTop: 4,
    fontWeight: '600',
  },
  detail: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  meta: {
    fontSize: 12,
    color: '#6B7280',
  },
  detailText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  detailLabel: {
    fontSize: 13,
    color: '#B91C1C',
    fontWeight: '600',
  },
  detailCorrect: {
    fontSize: 13,
    color: '#047857',
    fontWeight: '600',
  },
  detailMuted: {
    fontSize: 13,
    color: '#6B7280',
  },
  history: {
    fontSize: 12,
    color: '#92400E',
  },
  solutionHint: {
    fontSize: 12,
    color: '#6B7280',
    fontStyle: 'italic',
  },
});
