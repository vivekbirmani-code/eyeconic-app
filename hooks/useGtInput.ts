import { useEffect, useMemo, useRef, useState } from 'react';
import type { GtAttemptInput, GtInput, GtsResponse } from '@/types/predictor';
import { predictorEndpoints } from '@/services/predictor';
import { EXAM_MAX_CORRECTS, SUGGESTION_CHIPS_MAX } from '@/utils/predictor/constants';
import { dateLabel, latestAttempt } from '@/utils/predictor/format';

/**
 * Shared Grand Test input machinery — ported from the eyeconic-main website
 * client (client/src/pages/predictor/useGtInput.ts) so the app's forward form
 * and desired-branch form share ONE implementation, byte-compatible with the
 * website's behavior: dynamic rows, auto-fill from Eyeconic attempts
 * (provenance-tagged, never clobbering user typing), "last time" suggestion
 * chips, and live per-row validation.
 *
 * `optional: true` (the desired-branch form) changes exactly two things:
 *  - an EMPTY row is valid and simply contributes nothing to the payload
 *    (the reverse flow works without current GTs — no gap stage then);
 *  - the low-data note counts only rows that carry a value.
 *
 * `maxCorrects` bounds every row to the SELECTED exam's question count
 * (180 for NEET PG, 200 for INI-CET) — never a global constant.
 */

export interface GtRow {
  key: number;
  value: string;
  origin: 'auto' | 'manual';
  edited: boolean;
  gtId?: string;
  attempts?: GtAttemptInput[];
  title?: string | null;
  dateLabel?: string;
  attemptsNote?: string;
}

export function rowValidationError(
  value: string,
  optional = false,
  maxCorrects = EXAM_MAX_CORRECTS.NEET_PG
): string | null {
  if (value.trim() === '') return optional ? null : 'Enter a score';
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) return 'Whole numbers only (0 or more)';
  if (num > maxCorrects) return `Cannot exceed ${maxCorrects} questions`;
  return null;
}

export function useGtInput({ optional = false, maxCorrects = EXAM_MAX_CORRECTS.NEET_PG } = {}) {
  const keySeq = useRef(1);
  const nextKey = () => keySeq.current++;

  const [rows, setRows] = useState<GtRow[]>([{ key: nextKey(), value: '', origin: 'manual', edited: false }]);
  const [suggestions, setSuggestions] = useState<number[]>([]);
  const [autoFilling, setAutoFilling] = useState(true);
  const [hasAutoGts, setHasAutoGts] = useState(false);
  const [rowErrors, setRowErrors] = useState<Set<number>>(new Set());

  // Auto-fill must never clobber something the student started typing: once
  // any row is touched, a late-arriving feed is ignored (P3 race fix).
  const userTouched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data: GtsResponse = await predictorEndpoints.gts();
        if (cancelled) return;
        setSuggestions(
          (data.selfReported || [])
            .map((s) => (s.attempts?.length ? s.attempts[s.attempts.length - 1].corrects : null))
            .filter((c): c is number => typeof c === 'number')
            .slice(-SUGGESTION_CHIPS_MAX)
        );
        if (data.gts?.length && !userTouched.current) {
          setRows(
            data.gts.map((gt) => {
              const attempts = gt.attempts || [];
              const latest = latestAttempt(attempts);
              return {
                key: nextKey(),
                value: String(latest.corrects),
                origin: 'auto' as const,
                edited: false,
                gtId: gt.gtId,
                attempts,
                title: gt.title,
                dateLabel: dateLabel(latest.endedAt),
                attemptsNote:
                  attempts.length > 1 ? `latest of ${attempts.length} attempts` : undefined,
              };
            })
          );
          setHasAutoGts(true);
        }
      } catch {
        // Auto-fill is a convenience, never a blocker — manual entry works.
      } finally {
        if (!cancelled) setAutoFilling(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only by design (auto-fill must never clobber typing) — the rule
    // is not triggered here because only stable setters are referenced.
  }, []);

  const updateRow = (key: number, value: string) => {
    userTouched.current = true;
    setRows((prev) =>
      prev.map((row) =>
        row.key === key
          ? {
              ...row,
              value,
              edited: row.origin === 'auto' ? row.value !== value || row.edited : row.edited,
            }
          : row
      )
    );
  };

  const addRow = (prefill?: number) => {
    userTouched.current = true;
    setRows((prev) => [
      ...prev,
      { key: nextKey(), value: prefill !== undefined ? String(prefill) : '', origin: 'manual', edited: false },
    ]);
  };

  const removeRow = (key: number) => {
    userTouched.current = true;
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((row) => row.key !== key)));
  };

  // Live per-row validation (errors exist as you type; they only turn red
  // once a row has content or a submit was attempted).
  const validation = useMemo(() => {
    const errors = rows.map((row) => rowValidationError(row.value, optional, maxCorrects));
    return { errors, valid: errors.every((e) => e === null) };
  }, [rows, optional, maxCorrects]);

  const valuedRows = useMemo(() => rows.filter((row) => row.value.trim() !== ''), [rows]);

  // Forward semantics: rows.length ≤ 2. Optional mode: only rows that carry a
  // value count (an untouched empty row is not "one Grand Test").
  const lowGtCount = optional ? valuedRows.length > 0 && valuedRows.length <= 2 : rows.length <= 2;

  /** Flag invalid rows after a submit attempt (drives the red highlights). */
  const markInvalidRows = () => {
    setRowErrors(new Set(validation.errors.map((e, i) => (e ? i : -1)).filter((i) => i >= 0)));
    return validation.valid;
  };

  /** Flag specific row indices (server field errors like gts[2].attempts…). */
  const markRowErrors = (indices: Set<number>) => {
    setRowErrors(new Set(indices));
  };

  /** The engine's per-GT payload: auto rows keep their attempts (server
   *  re-derives), everything else becomes a self-reported single attempt.
   *  In optional mode, empty rows contribute nothing. */
  const buildGtsPayload = (): GtInput[] =>
    rows
      .filter((row) => !optional || row.value.trim() !== '')
      .map((row) =>
        row.origin === 'auto' && !row.edited && row.attempts?.length
          ? { gtId: row.gtId, provenance: 'auto-captured' as const, attempts: row.attempts }
          : {
              provenance: 'self-reported' as const,
              attempts: [{ corrects: Number(row.value), status: 'completed' }],
            }
      );

  /** True when a row's error should render red (content or submit attempt). */
  const isHighlighted = (index: number) => {
    const error = validation.errors[index];
    return Boolean(error) && (rows[index].value !== '' || rowErrors.has(index));
  };

  return {
    rows,
    suggestions,
    autoFilling,
    hasAutoGts,
    lowGtCount,
    validation,
    /** The exam's question count the rows are bounded to (input max attr). */
    maxCorrects,
    hasValues: valuedRows.length > 0,
    updateRow,
    addRow,
    removeRow,
    markInvalidRows,
    markRowErrors,
    buildGtsPayload,
    isHighlighted,
  };
}

export type GtInputApi = ReturnType<typeof useGtInput>;
