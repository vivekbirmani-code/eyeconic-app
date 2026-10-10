import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { CheckCircle2, AlertTriangle, Image as ImageIcon, X } from 'lucide-react-native';
import { colors } from '@/utils/theme';

/**
 * Shape of backend `imageSummary` (utils/importImageSummary.js) returned by
 * both Excel import endpoints. `type` maps to the popup's display labels.
 */
export interface ImageImportFailure {
  row: number;
  type: 'question' | 'solution';
  reason?: string;
}

export interface ImageImportSummary {
  total: number;
  uploaded: number;
  failed: number;
  failures: ImageImportFailure[];
}

const TYPE_LABELS: Record<ImageImportFailure['type'], string> = {
  question: 'Question Image',
  solution: 'Solution Image',
};

interface ImageUploadSummaryModalProps {
  visible: boolean;
  summary: ImageImportSummary | null;
  onClose: () => void;
}

/**
 * Post-import image report shown after an Excel import finishes: total
 * question/solution images in the file, how many ended up stored and linked,
 * and — for every failure — the sheet row and image type. All-success and
 * no-image states render as clear status banners instead of a failure list.
 *
 * Render this inside the parent modal's tree when stacked on another modal
 * (iOS child-dialog placement); at screen root otherwise.
 */
export default function ImageUploadSummaryModal({ visible, summary, onClose }: ImageUploadSummaryModalProps) {
  if (!summary) return null;

  const allUploaded = summary.failed === 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <ImageIcon color={colors.primary} size={20} />
            <Text style={styles.title}>Image Upload Summary</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X color="#6B7280" size={22} />
            </TouchableOpacity>
          </View>

          {summary.total === 0 ? (
            <View style={styles.noteBox}>
              <Text style={styles.noteText}>No images were found in this file.</Text>
            </View>
          ) : (
            <>
              <View style={[styles.statusBanner, allUploaded ? styles.bannerSuccess : styles.bannerWarning]}>
                {allUploaded ? (
                  <CheckCircle2 color={colors.successDark} size={18} />
                ) : (
                  <AlertTriangle color={colors.warningDark} size={18} />
                )}
                <Text style={[styles.bannerText, allUploaded ? styles.bannerTextSuccess : styles.bannerTextWarning]}>
                  {allUploaded
                    ? `All ${summary.total} image${summary.total === 1 ? '' : 's'} uploaded successfully.`
                    : `${summary.failed} of ${summary.total} image${summary.total === 1 ? '' : 's'} could not be uploaded.`}
                </Text>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{summary.total}</Text>
                  <Text style={styles.statLabel}>Total in Excel</Text>
                </View>
                <View style={[styles.statBox, { backgroundColor: colors.successTint }]}>
                  <Text style={[styles.statValue, { color: colors.successDark }]}>{summary.uploaded}</Text>
                  <Text style={styles.statLabel}>Uploaded</Text>
                </View>
                <View style={[styles.statBox, { backgroundColor: colors.dangerTint }]}>
                  <Text style={[styles.statValue, { color: colors.danger }]}>{summary.failed}</Text>
                  <Text style={styles.statLabel}>Failed</Text>
                </View>
              </View>
            </>
          )}

          {summary.failures.length > 0 && (
            <View style={styles.failureSection}>
              <Text style={styles.failureTitle}>Failed images</Text>
              <ScrollView style={styles.failureList} contentContainerStyle={styles.failureListContent}>
                {summary.failures.map((failure) => (
                  <View key={`${failure.row}-${failure.type}`} style={styles.failureRow}>
                    <Text style={styles.failureRowLabel}>Row {failure.row}</Text>
                    <View style={styles.failureTypeBadge}>
                      <Text style={styles.failureTypeText}>
                        {TYPE_LABELS[failure.type] || 'Image'}
                      </Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          <TouchableOpacity style={styles.doneButton} onPress={onClose}>
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: 'bold',
    color: colors.text,
  },
  noteBox: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  noteText: {
    fontSize: 14,
    color: colors.textBody,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    padding: 10,
  },
  bannerSuccess: {
    backgroundColor: colors.successTint,
  },
  bannerWarning: {
    backgroundColor: colors.warningTint,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  bannerTextSuccess: {
    color: colors.successDark,
  },
  bannerTextWarning: {
    color: colors.warningDark,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  failureSection: {
    marginTop: 14,
  },
  failureTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  failureList: {
    maxHeight: 180,
  },
  failureListContent: {
    gap: 6,
  },
  failureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.dangerTint,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  failureRowLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.dangerDark,
  },
  failureTypeBadge: {
    backgroundColor: colors.surface,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  failureTypeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.dangerDark,
  },
  doneButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    alignItems: 'center',
    padding: 14,
    marginTop: 14,
  },
  doneButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
});
