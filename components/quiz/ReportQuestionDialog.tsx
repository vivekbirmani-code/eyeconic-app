import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAvoidingDialog } from '@/components/KeyboardAvoidingDialog';
import { MessageSquareWarning, CheckCircle, AlertCircle } from 'lucide-react-native';
import { api } from '@/services/api';

const COMMENT_MAX_LENGTH = 1000;

interface ReportQuestionDialogProps {
  visible: boolean;
  onClose: () => void;
  /** Quiz id from the route (attempt binding is verified server-side). */
  quizId: string;
  /** The active attempt the report belongs to. */
  attemptId: string;
  /** Global index of the question being reported. */
  questionIndex: number;
  /** Question id — sent as a consistency check only; the server resolves identity itself. */
  questionId?: string;
  /** Human label for the reported question, e.g. "Question 3". */
  questionLabel: string;
}

/**
 * "Report a question" dialog for the quiz-taking screen.
 *
 * Pure side-channel: submitting never touches the student's answer, question
 * navigation or quiz submission — it only POSTs the report for the question
 * currently on screen. Rendered via KeyboardAvoidingDialog (in-tree overlay,
 * not an RN Modal) so the soft keyboard can never cover the input (SDK 54
 * keyboard architecture).
 */
export function ReportQuestionDialog({
  visible,
  onClose,
  quizId,
  attemptId,
  questionIndex,
  questionId,
  questionLabel,
}: ReportQuestionDialogProps) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  // Guard against a double-fire of the submit handler (fast double-tap).
  const submitInFlight = useRef(false);

  useEffect(() => {
    if (visible) {
      setComment('');
      setError(null);
      setSubmitting(false);
      setSubmitted(false);
      submitInFlight.current = false;
    }
  }, [visible]);

  const trimmed = comment.trim();
  const canSubmit = !submitting && !submitted && trimmed.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/quizzes/${quizId}/attempt/${attemptId}/report-question`, {
        questionIndex,
        comment: trimmed,
        questionId,
      });
      setSubmitted(true);
    } catch (e: any) {
      if (e?.response?.status === 409) {
        // Already reported (double-tap retry / earlier submission landed) —
        // treat as the same successful end state, not a failure.
        setSubmitted(true);
        return;
      }
      setError(e?.response?.data?.message || 'Could not submit your report. Please try again.');
    } finally {
      setSubmitting(false);
      submitInFlight.current = false;
    }
  };

  const remaining = COMMENT_MAX_LENGTH - comment.length;

  return (
    <KeyboardAvoidingDialog visible={visible} onClose={onClose} animationType="fade">
      <View style={styles.card}>
        {submitted ? (
          <View style={styles.successBlock}>
            <CheckCircle color="#10B981" size={40} />
            <Text style={styles.successTitle}>Report Submitted</Text>
            <Text style={styles.successText}>
              Thank you. Your report about {questionLabel} has been recorded and will be
              reviewed.
            </Text>
            <TouchableOpacity style={styles.doneButton} onPress={onClose}>
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.headerRow}>
              <MessageSquareWarning color="#2563EB" size={22} />
              <Text style={styles.title}>Report a Question</Text>
            </View>
            <Text style={styles.subtitle}>
              Reporting <Text style={styles.subtitleBold}>{questionLabel}</Text>. Describe the
              issue you noticed — for example an incorrect option, ambiguous wording or missing
              information.
            </Text>

            <TextInput
              style={styles.input}
              value={comment}
              onChangeText={(text) => {
                setComment(text.slice(0, COMMENT_MAX_LENGTH));
                if (error) setError(null);
              }}
              placeholder="What is the issue with this question?"
              placeholderTextColor="#9CA3AF"
              multiline
              textAlignVertical="top"
              editable={!submitting}
              accessible
              accessibilityLabel="Report comment"
            />
            <Text style={[styles.counter, remaining < 50 && styles.counterLow]}>
              {remaining} characters left
            </Text>

            {error && (
              <View style={styles.errorRow}>
                <AlertCircle color="#EF4444" size={16} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={onClose}
                disabled={submitting}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.submitButton, !canSubmit && styles.buttonDisabled]}
                onPress={handleSubmit}
                disabled={!canSubmit}
                accessible
                accessibilityLabel="Submit report"
                accessibilityHint="Sends your report about this question for review"
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.submitButtonText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </KeyboardAvoidingDialog>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 520,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  subtitle: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
    marginBottom: 14,
  },
  subtitleBold: {
    color: '#374151',
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#1F2937',
    minHeight: 110,
    maxHeight: 180,
  },
  counter: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'right',
    marginTop: 4,
  },
  counterLow: {
    color: '#F59E0B',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    padding: 8,
    marginTop: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: '#EF4444',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  cancelButton: {
    backgroundColor: '#F3F4F6',
  },
  cancelButtonText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '600',
  },
  submitButton: {
    backgroundColor: '#2563EB',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  successBlock: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  successTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1F2937',
    marginTop: 10,
  },
  successText: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  doneButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});

// Re-exported for the taking screen's character-limit parity check.
export const REPORT_COMMENT_MAX_LENGTH = COMMENT_MAX_LENGTH;
