import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
  Modal,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Target, ChevronDown, Search, X, Check } from 'lucide-react-native';
import type {
  BranchCatalog,
  BranchCatalogEntry,
  DesiredBranchResponse,
  PredictorExam,
  PredictorExamId,
} from '@/types/predictor';
import {
  predictorEndpoints,
  predictorErrorMessage,
  errorRowIndices,
  errorField,
  branchSuggestions,
} from '@/services/predictor';
import { useGtInput } from '@/hooks/useGtInput';
import GtInputSection from '@/components/predictor/GtInputSection';
import { CATEGORIES, maxCorrectsFor } from '@/utils/predictor/constants';
import * as Haptics from '@/utils/haptics';

/**
 * Desired Branch Predictor input experience — native port of the website's
 * DesiredBranchForm (Feature 02, reverse direction): exam → desired branch
 * (from GET /branches?exam=) → category (REQUIRED — closing ranks are
 * category-specific, §3.6) → optional current Grand Tests (only the gap
 * stage needs them; useGtInput optional mode — empty rows contribute
 * nothing). UNKNOWN_BRANCH near-misses come back as "Did you mean" chips.
 *
 * The screen owns the exam list and renders it above this form for both
 * modes; the branch catalog follows the selected exam and resets on switch.
 */

const CATEGORY_LABELS: Record<string, string> = {
  UR: 'UR (General)',
  EWS: 'EWS',
  OBC: 'OBC',
  SC: 'SC',
  ST: 'ST',
};

interface Props {
  exams: PredictorExam[];
  selectedExam: PredictorExamId;
  onResult: (response: DesiredBranchResponse) => void;
}

export default function DesiredBranchForm({ exams, selectedExam, onResult }: Props) {
  const [catalog, setCatalog] = useState<BranchCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // Bumped by Retry — re-runs the catalog fetch for the selected exam.
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [branchKey, setBranchKey] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);

  const [category, setCategory] = useState('');
  const [pwd, setPwd] = useState(false);

  const maxCorrects = maxCorrectsFor(exams, selectedExam);
  const gt = useGtInput({ optional: true, maxCorrects });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Branch catalog follows the exam; switching exams resets the selection.
  // A failed fetch is surfaced with its own Retry — a silent empty picker
  // reads as "no branches exist" and dead-ends the whole form.
  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);
    setCatalog(null);
    setBranchKey('');
    setSuggestions([]);
    predictorEndpoints
      .branchCatalog(selectedExam)
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setCatalogError(
            predictorErrorMessage(err, 'Could not load the branch list. Please try again.')
          );
        }
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedExam, catalogAttempt]);

  const selectedBranch = useMemo(
    () => catalog?.branches.find((b) => b.key === branchKey) ?? null,
    [catalog, branchKey]
  );

  // Light context under the picker: where the branch existed (per counselling
  // year/session), so "no data for a year" never surprises later.
  const branchContext = useMemo(() => {
    if (!selectedBranch) return null;
    const years = Object.keys(selectedBranch.perYear);
    if (!years.length) return null;
    const latest = selectedBranch.perYear[years[years.length - 1]];
    return `Offered in ${years.length} counselling ${
      years.length === 1 ? 'cycle' : 'cycles'
    } on record · ${latest.instituteCount} institutes in the latest one.`;
  }, [selectedBranch]);

  const canSubmit = Boolean(branchKey && category) && !catalogLoading && gt.validation.valid;

  const submit = async () => {
    if (submitting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFormError(null);
    setSuggestions([]);
    if (!gt.markInvalidRows()) {
      setFormError(
        'Fix the highlighted Grand Test scores first — or clear those rows to continue without them.'
      );
      return;
    }
    setSubmitting(true);
    try {
      const gts = gt.buildGtsPayload();
      const data = await predictorEndpoints.desiredBranch({
        exam: selectedExam,
        branchKey,
        category,
        pwd,
        ...(gts.length ? { gts } : {}),
      });
      onResult(data);
    } catch (err) {
      setFormError(predictorErrorMessage(err, 'Could not work out the target. Please try again.'));
      const serverRows = errorRowIndices(err);
      if (serverRows.size > 0) gt.markRowErrors(serverRows);
      if (errorField(err) === 'branchKey') setSuggestions(branchSuggestions(err));
    } finally {
      setSubmitting(false);
    }
  };

  const isIniCet = selectedExam === 'INI_CET';

  return (
    <>
      {/* desired branch (D2: branch-only — no institute scoping in V1) */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>The branch you want</Text>
        <Text style={styles.cardSubtitle}>
          Pick the specialty you are aiming for. You will get the rank it historically took — and
          roughly how many corrects that means.
        </Text>
        {catalogLoading ? (
          <View style={styles.catalogLoadingRow}>
            <ActivityIndicator size="small" color="#2563EB" />
            <Text style={styles.catalogLoadingText}>Loading branches…</Text>
          </View>
        ) : catalogError ? (
          <View style={styles.catalogErrorRow}>
            <Text style={styles.catalogErrorText}>{catalogError}</Text>
            <TouchableOpacity
              style={styles.catalogRetryButton}
              onPress={() => setCatalogAttempt((n) => n + 1)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Retry loading branches"
            >
              <Text style={styles.catalogRetryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.pickerTrigger}
            onPress={() => {
              Haptics.selectionAsync();
              setPickerVisible(true);
            }}
            activeOpacity={0.8}
            accessibilityLabel="Desired branch"
            accessibilityHint="Opens the branch list"
          >
            <Text
              style={[styles.pickerTriggerText, !selectedBranch && styles.pickerPlaceholder]}
              numberOfLines={1}
            >
              {selectedBranch ? selectedBranch.display : 'Select a branch…'}
            </Text>
            <ChevronDown size={20} color="#6B7280" />
          </TouchableOpacity>
        )}
        {branchContext ? <Text style={styles.branchContext}>{branchContext}</Text> : null}
        {suggestions.length ? (
          <View style={styles.suggestionRow}>
            <Text style={styles.suggestionLabel}>Did you mean:</Text>
            {suggestions.map((key) => (
              <TouchableOpacity
                key={key}
                style={styles.suggestionChip}
                onPress={() => {
                  setBranchKey(key);
                  setSuggestions([]);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.suggestionChipText}>
                  {catalog?.branches.find((b) => b.key === key)?.display ?? key}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>

      {/* category & quota — REQUIRED here (closing ranks are category-specific) */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your category</Text>
        <Text style={styles.cardSubtitle}>
          Closing ranks differ a lot by category, so this is required — it is never assumed for you.
        </Text>
        <View style={styles.categoryRow}>
          {CATEGORIES.map((c) => {
            const active = category === c;
            return (
              <TouchableOpacity
                key={c}
                style={[styles.categoryChip, active ? styles.categoryChipActive : null]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setCategory((prev) => (prev === c ? '' : c));
                }}
                activeOpacity={0.7}
                accessibilityLabel={CATEGORY_LABELS[c]}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    active ? styles.categoryChipTextActive : null,
                  ]}
                >
                  {CATEGORY_LABELS[c]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {category ? (
          <View style={styles.pwdRow}>
            <Text style={styles.pwdText}>PwD (person with benchmark disability)</Text>
            <Switch
              value={pwd}
              onValueChange={setPwd}
              trackColor={{ false: '#E5E7EB', true: 'rgba(1, 180, 174, 0.4)' }}
              thumbColor={pwd ? '#01b4ae' : '#9CA3AF'}
            />
          </View>
        ) : null}

        <View style={styles.quotaRow}>
          <Text style={styles.quotaText}>
            {isIniCet ? 'Single counselling pool (all INIs)' : 'Quota: All India Quota'}
          </Text>
        </View>
      </View>

      <GtInputSection
        gt={gt}
        title="Where you are now (optional)"
        subtitle={`Add your recent Grand Test corrects (out of ${maxCorrects}) to see the gap to the target. Leave this empty to see just the target.`}
      />

      {formError ? (
        <View style={styles.formErrorBox}>
          <Text style={styles.formErrorText}>{formError}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.submitButton, (!canSubmit || submitting) ? styles.submitDisabled : null]}
        onPress={submit}
        disabled={!canSubmit || submitting}
        activeOpacity={0.8}
      >
        {submitting ? (
          <>
            <ActivityIndicator color="#FFF" size="small" />
            <Text style={styles.submitText}>Working out the target…</Text>
          </>
        ) : (
          <>
            <Target size={16} color="#FFF" />
            <Text style={styles.submitText}>What do I need?</Text>
          </>
        )}
      </TouchableOpacity>

      <Text style={styles.footerNote}>Historical closing ranks as a range — actual cutoffs move every year.</Text>

      <BranchPickerModal
        visible={pickerVisible}
        branches={catalog?.branches ?? []}
        selectedKey={branchKey}
        onClose={() => setPickerVisible(false)}
        onSelect={(key) => {
          setBranchKey(key);
          setSuggestions([]);
          setPickerVisible(false);
        }}
      />
    </>
  );
}

/**
 * Single-select branch picker — the app's bottom-sheet dropdown idiom (same
 * pattern as TestDropdown): fixed-height sheet, search field, FlatList.
 */
function BranchPickerModal({
  visible,
  branches,
  selectedKey,
  onClose,
  onSelect,
}: {
  visible: boolean;
  branches: BranchCatalogEntry[];
  selectedKey: string;
  onClose: () => void;
  onSelect: (key: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const insets = useSafeAreaInsets();

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter(
      (b) => b.display.toLowerCase().includes(q) || b.variants.some((v) => v.toLowerCase().includes(q))
    );
  }, [branches, searchQuery]);

  useEffect(() => {
    if (visible) setSearchQuery('');
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      {/* 'height' behavior is never used on Android (this app runs
          edge-to-edge, where the window is not resized for the keyboard);
          iOS keeps 'padding' so the search field stays visible above the
          keyboard. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.pickerOverlay}
      >
        <View style={[styles.pickerSheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Select a branch</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X color="#1F2937" size={24} />
            </TouchableOpacity>
          </View>

          <View style={styles.pickerSearchRow}>
            <Search color="#6B7280" size={20} />
            <TextInput
              style={styles.pickerSearchInput}
              placeholder="Search branches…"
              placeholderTextColor="#9CA3AF"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => {
              const selected = item.key === selectedKey;
              return (
                <TouchableOpacity
                  style={[styles.pickerItem, selected && styles.pickerItemSelected]}
                  onPress={() => onSelect(item.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pickerItemText, selected && styles.pickerItemTextSelected]}>
                    {item.display}
                  </Text>
                  {selected ? <Check size={18} color="#01b4ae" /> : null}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.pickerEmpty}>No branches found</Text>
            }
            style={styles.pickerList}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 12.5,
    color: '#6B7280',
    marginBottom: 14,
    lineHeight: 17,
  },
  catalogLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  catalogLoadingText: {
    fontSize: 12.5,
    color: '#6B7280',
  },
  catalogErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.2)',
    borderRadius: 12,
    padding: 12,
  },
  catalogErrorText: {
    flex: 1,
    fontSize: 12.5,
    color: '#DC2626',
  },
  catalogRetryButton: {
    backgroundColor: '#DC2626',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  catalogRetryText: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '600',
  },
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerTriggerText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  pickerPlaceholder: {
    color: '#9CA3AF',
    fontWeight: '500',
  },
  branchContext: {
    fontSize: 11.5,
    color: '#6B7280',
    marginTop: 8,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  suggestionLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  suggestionChip: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.35)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(1, 180, 174, 0.07)',
  },
  suggestionChipText: {
    fontSize: 12,
    color: '#0d7a76',
    fontWeight: '600',
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  categoryChipActive: {
    borderColor: '#01b4ae',
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
  },
  categoryChipTextActive: {
    color: '#0d7a76',
    fontWeight: '700',
  },
  pwdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  pwdText: {
    fontSize: 13.5,
    color: '#374151',
    flex: 1,
  },
  quotaRow: {
    marginTop: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 10,
  },
  quotaText: {
    fontSize: 12.5,
    color: '#6B7280',
  },
  formErrorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.25)',
    borderRadius: 12,
    padding: 12,
  },
  formErrorText: {
    fontSize: 13,
    color: '#DC2626',
    textAlign: 'center',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#01b4ae',
    borderRadius: 14,
    paddingVertical: 15,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  submitDisabled: {
    opacity: 0.5,
    elevation: 0,
  },
  submitText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  footerNote: {
    fontSize: 11.5,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 2,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    // A definite height is required: with minHeight/maxHeight the sheet's
    // height depended on the flex-sized FlatList inside it, and that feedback
    // loop made the sheet oscillate (the visible flicker this app hit before).
    height: '60%',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  pickerSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    margin: 16,
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  pickerSearchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    paddingVertical: 0,
  },
  pickerList: {
    flex: 1,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  pickerItemSelected: {
    backgroundColor: 'rgba(1, 180, 174, 0.07)',
  },
  pickerItemText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#1F2937',
  },
  pickerItemTextSelected: {
    color: '#0d7a76',
    fontWeight: '700',
  },
  pickerEmpty: {
    textAlign: 'center',
    color: '#9CA3AF',
    padding: 20,
  },
});
