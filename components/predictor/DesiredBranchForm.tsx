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
import { colors } from '@/utils/theme';
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
import shared from '@/components/predictor/shared';
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
 * Reads as a short planning flow: branch → category → current level → one
 * primary action.
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
      <View style={shared.card}>
        <Text style={[shared.cardTitle, { marginBottom: 4 }]}>The branch you want</Text>
        {catalogLoading ? (
          <View style={styles.catalogLoadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
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
            <ChevronDown size={20} color={colors.textSecondary} />
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
      <View style={shared.card}>
        <View style={styles.categoryHeader}>
          <Text style={shared.cardTitle}>Your category</Text>
          <Text style={styles.categoryRequired}>required</Text>
        </View>
        <View style={styles.categoryRow}>
          {CATEGORIES.map((c) => {
            const active = category === c;
            return (
              <TouchableOpacity
                key={c}
                style={[shared.chip, active ? shared.chipActive : null]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setCategory((prev) => (prev === c ? '' : c));
                }}
                activeOpacity={0.7}
                accessibilityLabel={CATEGORY_LABELS[c]}
                accessibilityState={{ selected: active }}
              >
                <Text style={[shared.chipText, active ? shared.chipTextActive : null]}>
                  {CATEGORY_LABELS[c]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {category ? (
          <View style={styles.pwdRow}>
            <Text style={styles.pwdText}>PwD (benchmark disability)</Text>
            <Switch
              value={pwd}
              onValueChange={setPwd}
              trackColor={{ false: colors.border, true: 'rgba(1, 180, 174, 0.4)' }}
              thumbColor={pwd ? colors.primary : colors.textMuted}
            />
          </View>
        ) : null}

        <Text style={styles.quotaText}>
          {isIniCet ? 'Single counselling pool (all INIs)' : 'Quota: All India Quota'} · closing
          ranks are category-specific
        </Text>
      </View>

      <GtInputSection
        gt={gt}
        title="Your Grand Tests"
        subtitle={`Add recent corrects (out of ${maxCorrects}) to see the gap to the target — optional.`}
      />

      {formError ? (
        <View style={shared.formErrorBox}>
          <Text style={shared.formErrorText}>{formError}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[shared.primaryButton, (!canSubmit || submitting) ? shared.primaryButtonDisabled : null]}
        onPress={submit}
        disabled={!canSubmit || submitting}
        activeOpacity={0.8}
      >
        {submitting ? (
          <>
            <ActivityIndicator color="#FFF" size="small" />
            <Text style={shared.primaryButtonText}>Working out the target…</Text>
          </>
        ) : (
          <>
            <Target size={16} color="#FFF" />
            <Text style={shared.primaryButtonText}>Show my target</Text>
          </>
        )}
      </TouchableOpacity>

      <Text style={shared.footnote}>
        Historical closing ranks as a range — actual cutoffs move every year.
      </Text>

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
 * pattern as Analytics' TestDropdown): fixed-height sheet, search field,
 * FlatList.
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
              <X color={colors.text} size={24} />
            </TouchableOpacity>
          </View>

          <View style={styles.pickerSearchRow}>
            <Search color={colors.textSecondary} size={20} />
            <TextInput
              style={styles.pickerSearchInput}
              placeholder="Search branches…"
              placeholderTextColor={colors.textMuted}
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
                  {selected ? <Check size={18} color={colors.primary} /> : null}
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
  catalogLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  catalogLoadingText: {
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  catalogErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: colors.dangerTint,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.2)',
    borderRadius: 10,
    padding: 12,
    marginTop: 6,
  },
  catalogErrorText: {
    flex: 1,
    fontSize: 12.5,
    color: colors.dangerDark,
  },
  catalogRetryButton: {
    backgroundColor: colors.dangerDark,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  catalogRetryText: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '600',
  },
  // Trigger — Analytics' TestDropdown selector treatment (white, r12, p16).
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  pickerTriggerText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  pickerPlaceholder: {
    color: colors.textMuted,
    fontWeight: '500',
  },
  branchContext: {
    fontSize: 11.5,
    color: colors.textSecondary,
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
    color: colors.textSecondary,
  },
  suggestionChip: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.primaryTintBorder,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.primaryTint,
  },
  suggestionChipText: {
    fontSize: 12,
    color: colors.primaryDark,
    fontWeight: '600',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 12,
  },
  categoryRequired: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pwdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.bg,
  },
  pwdText: {
    fontSize: 13.5,
    color: colors.textBody,
    flex: 1,
  },
  quotaText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 10,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: colors.surface,
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
    borderBottomColor: colors.border,
  },
  pickerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  pickerSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    margin: 16,
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  pickerSearchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
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
    borderBottomColor: colors.bg,
    minHeight: 52,
  },
  pickerItemSelected: {
    backgroundColor: colors.primaryTint,
  },
  pickerItemText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  pickerItemTextSelected: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  pickerEmpty: {
    textAlign: 'center',
    color: colors.textMuted,
    padding: 20,
  },
});
