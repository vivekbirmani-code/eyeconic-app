import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  FileText,
} from 'lucide-react-native';

export type ExportFormat = 'excel' | 'csv';

interface OptionRowProps {
  icon: React.ReactNode;
  label: string;
  selected: boolean;
  onPress: () => void;
}

/**
 * Radio-style option card for the export dialog's format section.
 * Selected state mirrors the app's teal selection convention (teal border +
 * pale teal fill). The indicator keeps a fixed size in both states so picking
 * an option never shifts the row's layout.
 */
function OptionRow({ icon, label, selected, onPress }: OptionRowProps) {
  return (
    <TouchableOpacity
      style={[styles.optionRow, selected && styles.optionRowSelected]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
    >
      {icon}
      <View style={styles.optionText}>
        <Text style={styles.optionLabel}>{label}</Text>
      </View>
      <View style={[styles.radioIndicator, selected && styles.radioIndicatorSelected]}>
        {selected ? <Check color="#FFFFFF" size={13} /> : null}
      </View>
    </TouchableOpacity>
  );
}

export interface ExportLeaderboardDialogProps {
  visible: boolean;
  /** Current format selection (selection state stays with the caller). */
  format: ExportFormat;
  /** True while an export download is in flight. */
  exporting: boolean;
  /** Participants on the live board — drives the empty-selection notice.
   * Admins' boards rank internal + external participants together, so this
   * one count is the whole eligibility check for the combined export. */
  participantCount: number;
  onFormatChange: (format: ExportFormat) => void;
  onCancel: () => void;
  onExport: () => void;
}

/**
 * Format chooser for the Live Leaderboard export. The file itself is ONE
 * combined leaderboard (internal + external participants, exactly what the
 * board ranks) — the dialog only picks between Excel and CSV. The audience
 * selector that used to live here was removed with it.
 *
 * Rendered as a transparent React Native Modal (like AttemptDetailModal and
 * DeleteQuizModal), NOT the in-tree KeyboardAvoidingDialog overlay: this
 * chooser has no text inputs, so the Android Modal keyboard pitfalls don't
 * apply, and only a host-level Modal can scrim and center over the whole
 * viewport from inside the analytics ScrollView — an in-tree absoluteFill
 * overlay anchors to the leaderboard card's own bounds instead.
 */
export default function ExportLeaderboardDialog(props: ExportLeaderboardDialogProps) {
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!props.exporting) props.onCancel();
      }}
      statusBarTranslucent={Platform.OS === 'android'}
      navigationBarTranslucent={Platform.OS === 'android'}
    >
      {/* RN re-parents Modal content into a separate presentation container on
          iOS, detaching it from the root SafeAreaProvider — the nested provider
          re-establishes inset context so the margins below stay real there. */}
      <SafeAreaProvider>
        <ExportLeaderboardDialogBody {...props} />
      </SafeAreaProvider>
    </Modal>
  );
}

function ExportLeaderboardDialogBody({
  format,
  exporting,
  participantCount,
  onFormatChange,
  onCancel,
  onExport,
}: ExportLeaderboardDialogProps) {
  const insets = useSafeAreaInsets();
  const nothingToExport = participantCount === 0;

  return (
    <TouchableWithoutFeedback onPress={exporting ? undefined : onCancel}>
      <View
        style={[
          styles.overlay,
          {
            // Safe-area margins keep the card clear of notches/Dynamic Island
            // (the dim background still bleeds under them — padding constrains
            // the card, not the scrim's own paint).
            paddingTop: Math.max(insets.top, OVERLAY_MARGIN),
            paddingBottom: Math.max(insets.bottom, OVERLAY_MARGIN),
            paddingLeft: Math.max(insets.left, OVERLAY_MARGIN),
            paddingRight: Math.max(insets.right, OVERLAY_MARGIN),
          },
        ]}
      >
        <TouchableWithoutFeedback>
          <View style={styles.card}>
            <View style={styles.header}>
              <Download color="#01b4ae" size={18} />
              <Text style={styles.title}>Export Leaderboard</Text>
            </View>

            <ScrollView
              style={styles.content}
              contentContainerStyle={styles.contentContainer}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.sectionLabel}>Format</Text>
              <OptionRow
                icon={
                  <FileSpreadsheet color={format === 'excel' ? '#0F766E' : '#374151'} size={18} />
                }
                label="Excel (.xlsx)"
                selected={format === 'excel'}
                onPress={() => onFormatChange('excel')}
              />
              <OptionRow
                icon={<FileText color={format === 'csv' ? '#0F766E' : '#374151'} size={18} />}
                label="CSV (.csv)"
                selected={format === 'csv'}
                onPress={() => onFormatChange('csv')}
              />
            </ScrollView>

            <View style={styles.footer}>
              {nothingToExport && (
                <View style={styles.emptyNotice}>
                  <AlertTriangle color="#D97706" size={14} />
                  <Text style={styles.emptyNoticeText}>
                    No participants have completed this test yet, so there is no leaderboard to
                    export.
                  </Text>
                </View>
              )}
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={onCancel}
                  activeOpacity={0.7}
                  disabled={exporting}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel export"
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.exportButton,
                    (exporting || nothingToExport) && styles.exportButtonDisabled,
                  ]}
                  onPress={onExport}
                  activeOpacity={0.7}
                  disabled={exporting || nothingToExport}
                  accessibilityRole="button"
                  accessibilityLabel="Export leaderboard"
                  accessibilityState={{ disabled: exporting || nothingToExport }}
                >
                  {exporting ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Download color="#FFFFFF" size={16} />
                  )}
                  <Text style={styles.exportButtonText}>
                    {exporting ? 'Exporting…' : 'Export'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </View>
    </TouchableWithoutFeedback>
  );
}

const OVERLAY_MARGIN = 20;

const styles = StyleSheet.create({
  // Full-viewport scrim; the Modal host window sizes it, so it covers the
  // screen (and the tab bar) no matter where in the tree this is mounted.
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Width adapts to the viewport (fills the gutters, capped on larger
  // screens); maxHeight + the scrolling content area below keep short
  // landscape viewports from clipping the actions.
  card: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1F2937',
  },
  // Natural height while space allows; shrinks (and scrolls) once the card
  // hits its maxHeight.
  content: {
    flexShrink: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
    minHeight: 56,
  },
  optionRowSelected: {
    borderColor: '#01b4ae',
    backgroundColor: '#E0FBF9',
  },
  optionText: {
    flex: 1,
    minWidth: 0,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  radioIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioIndicatorSelected: {
    borderColor: '#01b4ae',
    backgroundColor: '#01b4ae',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  emptyNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 12,
  },
  emptyNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    color: '#92400E',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  exportButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    backgroundColor: '#01b4ae',
    paddingHorizontal: 16,
  },
  exportButtonDisabled: {
    opacity: 0.5,
  },
  exportButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
