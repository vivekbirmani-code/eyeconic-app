import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

interface QuestionStatus {
  answered: boolean;
  markedForReview: boolean;
  visited: boolean;
}

interface QuestionNavigationGridProps {
  totalQuestions: number;
  currentQuestion: number;
  questionStatuses: QuestionStatus[];
  onQuestionSelect: (index: number) => void;
  sections?: string[];
  currentSection?: string;
}

export const QuestionNavigationGrid: React.FC<QuestionNavigationGridProps> = ({
  totalQuestions,
  currentQuestion,
  questionStatuses,
  onQuestionSelect,
  sections,
  currentSection
}) => {
  const getQuestionColor = (index: number): string => {
    const status = questionStatuses[index];
    
    if (!status) return '#E5E7EB'; // Gray - Not visited
    
    if (status.markedForReview) return '#A855F7'; // Purple - Marked for review
    if (status.answered) return '#10B981'; // Green - Answered
    if (status.visited) return '#EF4444'; // Red - Visited but not answered
    
    return '#E5E7EB'; // Gray - Not visited
  };

  const getTextColor = (index: number): string => {
    const status = questionStatuses[index];
    
    if (!status || !status.visited) return '#6B7280';
    
    return '#FFFFFF';
  };

  return (
    <View style={styles.container}>
      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendBox, { backgroundColor: '#10B981' }]} />
          <Text style={styles.legendText}>Answered</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendBox, { backgroundColor: '#EF4444' }]} />
          <Text style={styles.legendText}>Not Answered</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendBox, { backgroundColor: '#A855F7' }]} />
          <Text style={styles.legendText}>Marked</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendBox, { backgroundColor: '#E5E7EB' }]} />
          <Text style={styles.legendText}>Not Visited</Text>
        </View>
      </View>

      {/* Question Grid */}
      <ScrollView 
        style={styles.scrollView}
        showsVerticalScrollIndicator={true}
      >
        <View style={styles.grid}>
          {Array.from({ length: totalQuestions }, (_, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.questionBox,
                {
                  backgroundColor: getQuestionColor(index),
                  borderWidth: index === currentQuestion ? 3 : 1,
                  borderColor: index === currentQuestion ? '#2563EB' : '#D1D5DB'
                }
              ]}
              onPress={() => onQuestionSelect(index)}
            >
              <Text style={[
                styles.questionNumber,
                { color: getTextColor(index) }
              ]} maxFontSizeMultiplier={1.4}>
                {index + 1}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  legend: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendBox: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
    color: '#6B7280',
  },
  scrollView: {
    flex: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 8,
  },
  questionBox: {
    width: 44,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 4,
  },
  questionNumber: {
    fontSize: 14,
    fontWeight: '600',
  },
});
