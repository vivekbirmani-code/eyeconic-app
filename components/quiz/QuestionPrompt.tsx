import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Check } from 'lucide-react-native';
import { QuestionType, StudentResponse, MappingAnswer } from '@/types/question';
import { QuestionMediaImage } from '@/components/quiz/QuestionMediaImage';

export interface QuestionPromptData {
  questionType?: QuestionType;
  question: string;
  questionImage?: string;
  options?: string[];
  optionImages?: string[];
  assertion?: string;
  reason?: string;
  columnA?: string[];
  columnB?: string[];
}

interface QuestionPromptProps {
  question: QuestionPromptData;
  response: StudentResponse;
  onChange: (response: StudentResponse) => void;
  disabled?: boolean;
}

/**
 * Renders the interactive answer UI for a question, adapting to its
 * questionType. Used by both authenticated quiz taking and guest quiz
 * taking so the six question-type engines are implemented exactly once.
 */
export default function QuestionPrompt({
  question,
  response,
  onChange,
  disabled,
}: QuestionPromptProps) {
  const type = question.questionType || 'mcq_single';

  const renderOptionList = (mode: 'single' | 'multiple') => {
    const selectedSet = mode === 'multiple' && Array.isArray(response) ? new Set(response as number[]) : null;

    return (
      <View style={styles.optionsContainer}>
        {(question.options || []).map((option, index) => {
          const isSelected = mode === 'multiple' ? !!selectedSet?.has(index) : response === index;
          const optionImage = question.optionImages?.[index];

          return (
            <TouchableOpacity
              key={index}
              style={[styles.optionButton, isSelected && styles.selectedOption]}
              onPress={() => {
                if (disabled) return;
                if (mode === 'multiple') {
                  const current = Array.isArray(response) ? [...(response as number[])] : [];
                  const next = current.includes(index) ? current.filter(i => i !== index) : [...current, index];
                  onChange(next);
                } else {
                  onChange(index);
                }
              }}
              activeOpacity={0.7}
              disabled={disabled}
            >
              <View style={[
                mode === 'multiple' ? styles.checkBox : styles.optionRadio,
                isSelected && (mode === 'multiple' ? styles.checkBoxSelected : styles.selectedRadio)
              ]}>
                {mode === 'multiple'
                  ? (isSelected && <Check color="#FFFFFF" size={14} />)
                  : (isSelected && <View style={styles.radioInner} />)}
              </View>
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>{String.fromCharCode(65 + index)}.</Text>
                <View style={{ flex: 1 }}>
                  {option ? (
                    <Text style={[styles.optionText, isSelected && styles.selectedOptionText]}>{option}</Text>
                  ) : null}
                  <QuestionMediaImage
                    source={optionImage}
                    style={styles.optionImage}
                    accessibilityLabel={`Option ${String.fromCharCode(65 + index)} image`}
                  />
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  if (type === 'assertion_reason') {
    return (
      <View>
        <View style={styles.statementBox}>
          <Text style={styles.statementLabel}>Assertion (A)</Text>
          <Text style={styles.statementText}>{question.assertion}</Text>
        </View>
        <View style={styles.statementBox}>
          <Text style={styles.statementLabel}>Reason (R)</Text>
          <Text style={styles.statementText}>{question.reason}</Text>
        </View>
        {renderOptionList('single')}
      </View>
    );
  }

  if (type === 'multiple_correct') {
    return (
      <View>
        <Text style={styles.instructionText}>Select all correct options</Text>
        {renderOptionList('multiple')}
      </View>
    );
  }

  if (type === 'match_the_following') {
    const mapping: MappingAnswer = (response && typeof response === 'object' && !Array.isArray(response)) ? (response as MappingAnswer) : {};
    return (
      <View>
        <Text style={styles.instructionText}>Match each item in Column A to an item in Column B</Text>
        {(question.columnA || []).map((a, aIdx) => (
          <View key={aIdx} style={styles.matchRow}>
            <Text style={styles.matchLabel} numberOfLines={2}>{aIdx + 1}. {a}</Text>
            <View style={styles.matchChips}>
              {(question.columnB || []).map((b, bIdx) => {
                const isSelected = mapping[String(aIdx)] === String(bIdx);
                return (
                  <TouchableOpacity
                    key={bIdx}
                    style={[styles.matchChip, isSelected && styles.matchChipSelected]}
                    onPress={() => {
                      if (disabled) return;
                      onChange({ ...mapping, [String(aIdx)]: String(bIdx) });
                    }}
                    disabled={disabled}
                  >
                    <Text style={[styles.matchChipText, isSelected && styles.matchChipTextSelected]}>
                      {String.fromCharCode(65 + bIdx)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
        <View style={styles.columnBLegend}>
          {(question.columnB || []).map((b, bIdx) => (
            <Text key={bIdx} style={styles.columnBLegendText}>{String.fromCharCode(65 + bIdx)}. {b}</Text>
          ))}
        </View>
      </View>
    );
  }

  if (type === 'numerical') {
    const NumericInput = require('react-native').TextInput;
    const value = response === null || response === undefined ? '' : String(response);
    return (
      <View>
        <Text style={styles.instructionText}>Enter your numerical answer</Text>
        <NumericInput
          style={styles.numericInput}
          keyboardType="numeric"
          placeholder="Enter a number"
          value={value}
          editable={!disabled}
          onChangeText={(text: string) => {
            if (text.trim() === '') {
              onChange(null);
              return;
            }
            const num = Number(text);
            onChange(Number.isNaN(num) ? text as any : num);
          }}
        />
      </View>
    );
  }

  // mcq_single, image_based, and any legacy/unspecified type default to single-select.
  return renderOptionList('single');
}

const styles = StyleSheet.create({
  optionsContainer: {
    gap: 12,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    minHeight: 56,
  },
  selectedOption: {
    borderColor: '#2563EB',
    backgroundColor: '#EBF5FF',
  },
  optionRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  selectedRadio: {
    borderColor: '#2563EB',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#2563EB',
  },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  checkBoxSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#2563EB',
  },
  optionContent: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  optionText: {
    flex: 1,
    fontSize: 16,
    color: '#4B5563',
    lineHeight: 22,
  },
  selectedOptionText: {
    color: '#1F2937',
    fontWeight: '500',
  },
  optionImage: {
    width: '100%',
    height: 150,
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  statementBox: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#2563EB',
  },
  statementLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  statementText: {
    fontSize: 15,
    color: '#1F2937',
    lineHeight: 22,
  },
  instructionText: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 12,
    fontStyle: 'italic',
  },
  matchRow: {
    marginBottom: 16,
  },
  matchLabel: {
    fontSize: 15,
    color: '#1F2937',
    marginBottom: 8,
  },
  matchChips: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  matchChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  matchChipSelected: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  matchChipText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#374151',
  },
  matchChipTextSelected: {
    color: '#FFFFFF',
  },
  columnBLegend: {
    marginTop: 8,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  columnBLegendText: {
    fontSize: 14,
    color: '#4B5563',
  },
  numericInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    color: '#1F2937',
  },
});
