import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TouchableWithoutFeedback,
} from 'react-native';
import { AlertTriangle, X } from 'lucide-react-native';

export interface DeleteQuizTarget {
  _id: string;
  title: string;
}

interface DeleteQuizModalProps {
  visible: boolean;
  quiz: DeleteQuizTarget | null;
  deleting: boolean;
  onClose: () => void;
  onConfirmDelete: (quiz: DeleteQuizTarget) => void;
}

export default function DeleteQuizModal({
  visible,
  quiz,
  deleting,
  onClose,
  onConfirmDelete,
}: DeleteQuizModalProps) {
  if (!quiz) return null;

  const handleConfirm = () => {
    if (deleting) return;
    onConfirmDelete(quiz);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={deleting ? undefined : onClose}
    >
      <TouchableWithoutFeedback onPress={deleting ? undefined : onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.dialogCard}>
              {/* Top Row: Warning Icon & Close */}
              <View style={styles.headerRow}>
                <View style={styles.iconCircle}>
                  <AlertTriangle color="#DC2626" size={24} />
                </View>
                {!deleting && (
                  <TouchableOpacity
                    onPress={onClose}
                    style={styles.closeButton}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel="Close dialog"
                  >
                    <X color="#6B7280" size={20} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Title & Description */}
              <Text style={styles.title}>Delete Test?</Text>
              <Text style={styles.message}>
                Are you sure you want to delete <Text style={styles.quizTitle}>"{quiz.title}"</Text>?
              </Text>
              <Text style={styles.subMessage}>
                This action will remove the test and its associated assignments from students. This action cannot be undone.
              </Text>

              {/* Actions Footer */}
              <View style={styles.actionsContainer}>
                <TouchableOpacity
                  style={[styles.button, styles.cancelButton]}
                  onPress={onClose}
                  disabled={deleting}
                  accessibilityLabel="Cancel deletion"
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.button, styles.deleteButton, deleting && styles.disabledButton]}
                  onPress={handleConfirm}
                  disabled={deleting}
                  accessibilityLabel="Confirm delete test"
                >
                  {deleting ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.deleteButtonText}>Delete Test</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    padding: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 22,
    marginBottom: 8,
  },
  quizTitle: {
    fontWeight: '700',
    color: '#111827',
  },
  subMessage: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
    marginBottom: 24,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  deleteButton: {
    backgroundColor: '#DC2626',
  },
  deleteButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  disabledButton: {
    opacity: 0.7,
  },
});
