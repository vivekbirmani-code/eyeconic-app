import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { colors } from '@/utils/theme';
import { CheckCircle2, Plus, Trash2, Check, AlertTriangle } from 'lucide-react-native';
import type {
  OutcomeRecordResponse,
  OutcomeSubmission,
  PredictionResult,
} from '@/types/predictor';
import {
  errorField,
  predictorEndpoints,
  predictorErrorMessage,
} from '@/services/predictor';
import { OUTCOME_MAX_SCORE } from '@/utils/predictor/constants';
import {
  COUNSELLING_ROUND_MAX,
  COUNSELLING_TEXT_MAX,
  OUTCOME_CONSENT_NOTE,
  OUTCOME_CONSENT_REASK,
  outcomeFieldErrors,
  outcomeIntroNote,
} from '@/utils/predictor/outcome';
import { fmtRank } from '@/utils/predictor/format';
import * as Haptics from '@/utils/haptics';
import shared from './shared';

/**
 * Outcome capture (§15, §18 Phases 10a+10b) — native port of the website's
 * OutcomeCard: the consent-based post-exam self-report (actual score /
 * percentile / rank + counselling outcome + allotted branch). Voluntary,
 * re-consent on every submission (including edits), editable, withdrawable.
 * Renders wherever a stored predictionId exists — fresh results AND history
 * details both work off the same endpoints.
 */

type CounsellingStatus = '' | 'ALLOTTED' | 'NOT_ALLOTTED';

interface Props {
  predictionId: string;
  result: PredictionResult;
}

export default function OutcomeCard({ predictionId, result }: Props) {
  const [record, setRecord] = useState<OutcomeRecordResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [score, setScore] = useState('');
  const [percentile, setPercentile] = useState('');
  const [rank, setRank] = useState('');
  const [counsellingStatus, setCounsellingStatus] = useState<CounsellingStatus>('');
  const [allottedInstitute, setAllottedInstitute] = useState('');
  const [allottedBranch, setAllottedBranch] = useState('');
  const [round, setRound] = useState('');
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverField, setServerField] = useState<string | null>(null);

  // The prediction's own pattern echo is authoritative: a stored
  // pre-migration NEET PG result was on the 800-mark scale and must keep
  // showing /800; new results show the current pattern's maximum.
  const maxScore =
    result.estimate?.performance?.pattern?.maxMarks ?? OUTCOME_MAX_SCORE[result.exam] ?? 800;

  const load = useCallback(async () => {
    try {
      const data = await predictorEndpoints.outcome(predictionId);
      setRecord(data.recorded ? data.outcomeRecord : null);
    } catch {
      setRecord(null); // transient — the card is optional and must never block
    } finally {
      setLoaded(true);
    }
  }, [predictionId]);

  useEffect(() => {
    setLoaded(false);
    setFormOpen(false);
    setEditing(false);
    load();
  }, [load]);

  const fieldErrors = useMemo(
    () =>
      outcomeFieldErrors(
        score, percentile, rank, counsellingStatus, allottedInstitute, allottedBranch, round, maxScore
      ),
    [score, percentile, rank, counsellingStatus, allottedInstitute, allottedBranch, round, maxScore]
  );
  const anyValue =
    score !== '' || percentile !== '' || rank !== '' || counsellingStatus !== '';
  const canSubmit =
    consent && anyValue && !saving && Object.keys(fieldErrors).length === 0;

  const openForm = (from?: OutcomeRecordResponse) => {
    setScore(from && from.outcome.score !== null ? String(from.outcome.score) : '');
    setPercentile(from && from.outcome.percentile !== null ? String(from.outcome.percentile) : '');
    setRank(from && from.outcome.rank !== null ? String(from.outcome.rank) : '');
    setCounsellingStatus(from && from.counselling ? from.counselling.status : '');
    setAllottedInstitute(
      from && from.counselling && from.counselling.allottedInstitute
        ? from.counselling.allottedInstitute
        : ''
    );
    setAllottedBranch(
      from && from.counselling && from.counselling.allottedBranch
        ? from.counselling.allottedBranch
        : ''
    );
    setRound(from && from.counselling && from.counselling.round ? from.counselling.round : '');
    setConsent(false); // every submission re-consents (§15)
    setError(null);
    setServerField(null);
    setConfirmWithdraw(false);
    setEditing(Boolean(from));
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(false);
    setError(null);
    setServerField(null);
  };

  const submit = async () => {
    if (!consent) {
      setError('Sharing is voluntary — tick the consent box to submit.');
      return;
    }
    if (!anyValue) {
      setError(
        'Enter at least one value: actual score, percentile, rank or your counselling outcome.'
      );
      return;
    }
    if (Object.keys(fieldErrors).length) {
      setError('Fix the highlighted values first.');
      return;
    }
    setSaving(true);
    setError(null);
    setServerField(null);
    try {
      const body: OutcomeSubmission = { consent: true };
      if (score !== '') body.score = Number(score);
      if (percentile !== '') body.percentile = Number(percentile);
      if (rank !== '') body.rank = Number(rank);
      if (counsellingStatus) {
        const counselling: NonNullable<OutcomeSubmission['counselling']> = {
          status: counsellingStatus,
        };
        if (counsellingStatus === 'ALLOTTED') {
          if (allottedInstitute.trim()) counselling.allottedInstitute = allottedInstitute.trim();
          if (allottedBranch.trim()) counselling.allottedBranch = allottedBranch.trim();
          if (round.trim()) counselling.round = round.trim();
        }
        body.counselling = counselling;
      }
      await predictorEndpoints.saveOutcome(predictionId, body);
      closeForm();
      await load();
    } catch (err) {
      setError(predictorErrorMessage(err, 'Could not save your result. Please try again.'));
      setServerField(errorField(err));
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async () => {
    setWithdrawing(true);
    try {
      await predictorEndpoints.withdrawOutcome(predictionId);
      setRecord(null);
      closeForm();
    } catch (err) {
      setError(predictorErrorMessage(err, 'Could not withdraw. Please try again.'));
    } finally {
      setWithdrawing(false);
      setConfirmWithdraw(false);
    }
  };

  if (!loaded) return null;

  // Server field paths ('counselling.status') map onto the local input keys
  // so the right control highlights on a server-side validation error.
  const serverFieldLocal: string | null =
    serverField === 'counselling.status'
      ? 'counsellingStatus'
      : serverField === 'counselling.allottedInstitute'
      ? 'allottedInstitute'
      : serverField === 'counselling.allottedBranch'
      ? 'allottedBranch'
      : serverField === 'counselling.round'
      ? 'round'
      : serverField;

  const fieldStyle = (name: keyof typeof fieldErrors) => [
    styles.input,
    ((serverFieldLocal === name && !fieldErrors[name]) || fieldErrors[name])
      ? styles.inputError
      : null,
  ];

  // ---- the form (share / edit) --------------------------------------------------

  const renderForm = () => (
    <View style={{ gap: 14 }}>
      {!editing ? <Text style={styles.hint}>{outcomeIntroNote(result.exam)}</Text> : null}
      <View style={styles.valueRow}>
        <View style={styles.valueField}>
          <Text style={styles.inputLabel}>Actual score (/{maxScore})</Text>
          <TextInput
            style={fieldStyle('score')}
            keyboardType="number-pad"
            value={score}
            onChangeText={setScore}
            maxLength={4}
            placeholder={result.exam === 'INI_CET' ? 'e.g. 118' : 'e.g. 480'}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={`Actual score out of ${maxScore}`}
          />
          {fieldErrors.score ? <Text style={styles.fieldError}>{fieldErrors.score}</Text> : null}
        </View>
        <View style={styles.valueField}>
          <Text style={styles.inputLabel}>Percentile</Text>
          <TextInput
            style={fieldStyle('percentile')}
            keyboardType="decimal-pad"
            value={percentile}
            onChangeText={setPercentile}
            maxLength={6}
            placeholder="e.g. 81.2"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Actual percentile"
          />
          {fieldErrors.percentile ? (
            <Text style={styles.fieldError}>{fieldErrors.percentile}</Text>
          ) : null}
        </View>
        <View style={styles.valueField}>
          <Text style={styles.inputLabel}>AIR (rank)</Text>
          <TextInput
            style={fieldStyle('rank')}
            keyboardType="number-pad"
            value={rank}
            onChangeText={setRank}
            maxLength={7}
            placeholder="e.g. 42000"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Actual All India Rank"
          />
          {fieldErrors.rank ? <Text style={styles.fieldError}>{fieldErrors.rank}</Text> : null}
        </View>
      </View>

      {/* counselling outcome (Phase 10b, §15) — allotted status + branch */}
      <View style={styles.counsellingBox}>
        <Text style={styles.inputLabel}>
          Counselling outcome (optional — share whenever you know it)
        </Text>
        <View style={styles.statusChipRow}>
          {(['ALLOTTED', 'NOT_ALLOTTED'] as const).map((s) => {
            const active = counsellingStatus === s;
            return (
              <TouchableOpacity
                key={s}
                style={[shared.chip, active ? shared.chipActive : null]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setCounsellingStatus((prev) => (prev === s ? '' : s));
                }}
                activeOpacity={0.7}
                accessibilityLabel={s === 'ALLOTTED' ? 'Allotted a seat' : 'Not allotted'}
                accessibilityState={{ selected: active }}
              >
                <Text style={[shared.chipText, active ? shared.chipTextActive : null]}>
                  {s === 'ALLOTTED' ? 'Allotted a seat' : 'Not allotted'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {fieldErrors.counsellingStatus ? (
          <Text style={styles.fieldError}>{fieldErrors.counsellingStatus}</Text>
        ) : null}

        {counsellingStatus === 'ALLOTTED' ? (
          <View style={{ gap: 10 }}>
            <View>
              <Text style={styles.inputLabel}>Allotted college / institute</Text>
              <TextInput
                style={fieldStyle('allottedInstitute')}
                value={allottedInstitute}
                onChangeText={setAllottedInstitute}
                maxLength={COUNSELLING_TEXT_MAX}
                placeholder="e.g. AIIMS New Delhi"
                placeholderTextColor={colors.textMuted}
              />
              {fieldErrors.allottedInstitute ? (
                <Text style={styles.fieldError}>{fieldErrors.allottedInstitute}</Text>
              ) : null}
            </View>
            <View>
              <Text style={styles.inputLabel}>Allotted branch / specialty</Text>
              <TextInput
                style={fieldStyle('allottedBranch')}
                value={allottedBranch}
                onChangeText={setAllottedBranch}
                maxLength={COUNSELLING_TEXT_MAX}
                placeholder="e.g. Radiodiagnosis"
                placeholderTextColor={colors.textMuted}
              />
              {fieldErrors.allottedBranch ? (
                <Text style={styles.fieldError}>{fieldErrors.allottedBranch}</Text>
              ) : null}
            </View>
            <View>
              <Text style={styles.inputLabel}>Round</Text>
              <TextInput
                style={fieldStyle('round')}
                value={round}
                onChangeText={setRound}
                maxLength={COUNSELLING_ROUND_MAX}
                placeholder="e.g. R2 / mop-up"
                placeholderTextColor={colors.textMuted}
              />
              {fieldErrors.round ? <Text style={styles.fieldError}>{fieldErrors.round}</Text> : null}
            </View>
          </View>
        ) : null}
        {counsellingStatus === 'NOT_ALLOTTED' ? (
          <Text style={styles.hint}>
            A “not allotted” outcome is just as useful for calibration — nothing else needed.
          </Text>
        ) : null}
      </View>

      {/* consent — re-confirmed on every save (§15) */}
      <TouchableOpacity
        style={[styles.consentRow, serverField === 'consent' ? styles.consentRowError : null]}
        onPress={() => {
          Haptics.selectionAsync();
          setConsent((v) => !v);
        }}
        activeOpacity={0.8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consent }}
      >
        <View style={[styles.consentBox, consent ? styles.consentBoxChecked : null]}>
          {consent ? <Check size={14} color="#FFF" /> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.consentText}>{OUTCOME_CONSENT_NOTE}</Text>
          {editing ? <Text style={styles.consentReask}>{OUTCOME_CONSENT_REASK}</Text> : null}
          {serverField === 'consent' ? (
            <Text style={styles.fieldError}>Please tick the consent box first.</Text>
          ) : null}
        </View>
      </TouchableOpacity>

      {error !== null ? (
        <View style={styles.errorRow}>
          <AlertTriangle size={13} color={colors.dangerDark} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.formActions}>
        <TouchableOpacity
          style={[shared.primaryButton, !canSubmit ? shared.primaryButtonDisabled : null, styles.saveButton]}
          onPress={submit}
          disabled={!canSubmit}
          activeOpacity={0.8}
        >
          <CheckCircle2 size={14} color="#FFF" />
          <Text style={[shared.primaryButtonText, styles.saveButtonText]}>
            {editing ? 'Update result' : 'Share my result'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={closeForm} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ---- recorded view -------------------------------------------------------------

  if (record && !formOpen) {
    const o = record.outcome;
    const c = record.counselling;
    return (
      <View style={[shared.card, styles.cardRecorded, { gap: 10 }]}>
        <View style={styles.cardTitleRow}>
          <CheckCircle2 size={16} color={colors.primary} />
          <Text style={shared.cardTitle}>Your actual result — recorded, thank you</Text>
        </View>
        <View style={styles.recordedValues}>
          {o.score !== null ? (
            <Text style={styles.recordedValue}>
              Score <Text style={styles.recordedStrong}>{o.score}</Text>/{maxScore}
            </Text>
          ) : null}
          {o.percentile !== null ? (
            <Text style={styles.recordedValue}>
              Percentile <Text style={styles.recordedStrong}>{o.percentile}</Text>
            </Text>
          ) : null}
          {o.rank !== null ? (
            <Text style={styles.recordedValue}>
              AIR <Text style={styles.recordedStrong}>{o.rank.toLocaleString('en-IN')}</Text>
            </Text>
          ) : null}
        </View>
        {c ? (
          <View style={styles.counsellingRecorded}>
            <Text style={styles.counsellingLabel}>COUNSELLING OUTCOME</Text>
            <Text style={styles.recordedValue}>
              {c.status === 'ALLOTTED'
                ? c.allottedBranch
                  ? ['Allotted — ', c.allottedBranch].join('')
                  : 'Allotted a seat'
                : 'Not allotted'}
              {c.round ? <Text style={styles.hint}> · {c.round}</Text> : null}
            </Text>
            {c.allottedInstitute ? <Text style={styles.hint}>{c.allottedInstitute}</Text> : null}
          </View>
        ) : null}
        {o.rank !== null && result.rank ? (
          <Text style={styles.hint}>
            This prediction said AIR{' '}
            {fmtRank(result.rank.bestRank, result.rank.beyondLastRecordedRank)} –{' '}
            {fmtRank(result.rank.worstRank, result.rank.beyondLastRecordedRank)} · your pair is
            saved to calibrate future ranges.
          </Text>
        ) : (
          <Text style={styles.hint}>
            Linked to this prediction — the pair is saved to calibrate future ranges.
          </Text>
        )}
        <View style={styles.recordedActions}>
          <TouchableOpacity
            style={styles.outlineButton}
            onPress={() => openForm(record)}
            activeOpacity={0.7}
          >
            <Text style={styles.outlineButtonText}>Edit</Text>
          </TouchableOpacity>
          {confirmWithdraw ? (
            <View style={styles.withdrawRow}>
              <TouchableOpacity
                style={styles.withdrawConfirmButton}
                onPress={withdraw}
                disabled={withdrawing}
                activeOpacity={0.7}
              >
                <Text style={styles.withdrawConfirmText}>
                  {withdrawing ? 'Withdrawing…' : 'Confirm withdraw'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setConfirmWithdraw(false)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.cancelText}>Keep it</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.withdrawButton}
              onPress={() => setConfirmWithdraw(true)}
              activeOpacity={0.7}
            >
              <Trash2 size={12} color={colors.textSecondary} />
              <Text style={styles.withdrawButtonText}>Withdraw</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  if (formOpen) {
    return (
      <View style={[shared.card, { gap: 10 }]}>
        <View style={styles.cardTitleRow}>
          <CheckCircle2 size={16} color={colors.primary} />
          <Text style={shared.cardTitle}>
            {editing ? 'Edit your actual result' : 'Share your actual result (optional)'}
          </Text>
        </View>
        {renderForm()}
      </View>
    );
  }

  // ---- collapsed intro (nothing recorded yet) -------------------------------------

  return (
    <View style={[shared.card, { gap: 10 }]}>
      <View style={styles.cardTitleRow}>
        <CheckCircle2 size={16} color={colors.primary} />
        <Text style={shared.cardTitle}>Result out? Make the next prediction better</Text>
      </View>
      <Text style={styles.hint}>{outcomeIntroNote(result.exam)}</Text>
      <TouchableOpacity
        style={styles.outlineButton}
        onPress={() => openForm()}
        activeOpacity={0.7}
      >
        <Plus size={14} color={colors.textBody} />
        <Text style={styles.outlineButtonText}>Add my actual result</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  cardRecorded: {
    borderColor: colors.primaryTintBorder,
    backgroundColor: '#F0FBFA',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hint: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  // form fields
  valueRow: {
    flexDirection: 'row',
    gap: 10,
  },
  valueField: {
    flex: 1,
    gap: 5,
  },
  inputLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14.5,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.dangerDark,
    backgroundColor: '#FEF2F2',
  },
  fieldError: {
    fontSize: 11.5,
    color: colors.dangerDark,
    marginTop: 2,
  },
  counsellingBox: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  statusChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
  },
  consentRowError: {
    borderColor: 'rgba(220, 38, 38, 0.4)',
  },
  consentBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  consentBoxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  consentText: {
    fontSize: 12,
    color: colors.textBody,
    lineHeight: 16,
  },
  consentReask: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 4,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: colors.dangerDark,
    lineHeight: 16,
  },
  formActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  saveButton: {
    paddingVertical: 11,
    paddingHorizontal: 18,
  },
  saveButtonText: {
    fontSize: 14,
  },
  cancelText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  // recorded view
  recordedValues: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 20,
    rowGap: 6,
  },
  recordedValue: {
    fontSize: 14,
    color: colors.text,
  },
  recordedStrong: {
    fontWeight: '700',
  },
  counsellingRecorded: {
    borderTopWidth: 1,
    borderTopColor: colors.primaryTintBorder,
    paddingTop: 10,
    gap: 3,
  },
  counsellingLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.8,
  },
  recordedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 2,
  },
  outlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 9,
    paddingHorizontal: 14,
    minHeight: 40,
  },
  outlineButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textBody,
  },
  withdrawButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  withdrawButtonText: {
    fontSize: 12.5,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  withdrawRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  withdrawConfirmButton: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.4)',
    backgroundColor: 'rgba(220, 38, 38, 0.05)',
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  withdrawConfirmText: {
    fontSize: 12.5,
    color: colors.dangerDark,
    fontWeight: '600',
  },
});
