/**
 * Pure result-summary helpers shared by the predictor result UI — ported
 * from the eyeconic-main website client (BranchResults bandCounts,
 * ResultView share text, MethodologySection note de-duplication) so the app
 * renders the same numbers and copy the website does.
 */

import type { DesiredBranchResult, PredictionResult } from '@/types/predictor';
import { ASSUMPTION_TEXT, DUPLICATED_ENGINE_NOTES, EXAM_LABELS, GAP_META, isBranchSummary } from './constants';
import { fmtPct, fmtRank } from './format';

/** Branch summary with a real category attached (not the CATEGORY_REQUIRED state). */
export type NonCategoryBranchSummary = Exclude<
  PredictionResult['branches'],
  { coverage: 'CATEGORY_REQUIRED' }
>;

/**
 * Total options per band across every counselling year/session, plus the
 * grand total — the numbers on the filter chips.
 */
export function bandCounts(summary: NonCategoryBranchSummary): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const y of summary.years) {
    for (const [key, count] of Object.entries(y.counts || {})) {
      if (key === 'total') continue;
      totals[key] = (totals[key] || 0) + count;
    }
  }
  totals.total = summary.years.reduce((acc, y) => acc + (y.counts?.total ?? 0), 0);
  return totals;
}

/** Website parity: ANY covered year with aboveAllClosings shows the banner. */
export function aboveAllClosings(summary: NonCategoryBranchSummary): boolean {
  return summary.years.some((y) => y.aboveAllClosings);
}

/** Share text — same lines as the website's share builder; the link is the
 *  website predictor page (the share sheet is user-initiated, never in-app). */
export function buildShareText(result: PredictionResult): string {
  const examName = result.exam === 'INI_CET' ? 'INI-CET' : 'NEET PG';
  return [
    `Eyeconic Rank Predictor — ${examName}`,
    `Estimated percentile: ${fmtPct(result.estimate.percentile.range[0])} – ${fmtPct(
      result.estimate.percentile.range[1]
    )}`,
    `Predicted AIR: ${fmtRank(result.rank.bestRank)} – ${fmtRank(
      result.rank.worstRank,
      result.rank.beyondLastRecordedRank
    )}`,
    `Based on ${result.aggregation.n} Grand Test${result.aggregation.n === 1 ? '' : 's'}`,
    'Estimate based on historical data — actual results may vary.',
    'https://www.eyeconicneetpg.com/predictor',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Engine notes, de-duplicated, with the no-skip + disclaimer strings removed
 * (both already render outside Methodology) — exact website rule.
 */
export function dedupedMethodologyNotes(result: PredictionResult): string[] {
  const branchSummary = isBranchSummary(result.branches) ? result.branches : null;
  const seen = new Set<string>();
  const collect = (list: string[]) =>
    list.filter((note) => {
      if (DUPLICATED_ENGINE_NOTES.includes(note) || seen.has(note)) return false;
      seen.add(note);
      return true;
    });

  return [
    ...collect(result.estimate.notes || []),
    ...collect((result.estimate.warnings || []).map((w) => w.note)),
    ...(branchSummary ? collect(branchSummary.notes || []) : []),
  ];
}

/** Assumption ids → plain-language sentences (unknown ids dropped). */
export function methodologyAssumptions(result: PredictionResult): string[] {
  return (result.method.assumptions || [])
    .map((id) => ASSUMPTION_TEXT[id])
    .filter((text): text is string => Boolean(text));
}

// ---- Desired Branch Predictor (reverse flow — same share builder as the site) ----

const fmtCorrects = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : n.toLocaleString('en-IN');

/** Share text — same lines as the website's DesiredBranchResult builder; the
 *  link is the website predictor page (the share sheet is user-initiated). */
export function buildDesiredShareText(result: DesiredBranchResult): string {
  const safe = result.required?.perClosing[0]?.corrects ?? null;
  const likely = result.required?.perClosing[1]?.corrects ?? null;
  return [
    `Eyeconic Desired Branch — ${result.input.branch.display} (${
      EXAM_LABELS[result.exam] ?? result.exam
    }, ${result.input.category.value}${result.input.category.pwd ? ' PwD' : ''})`,
    `Historical closing rank: ${fmtRank(result.target.targetRankRange?.[0] ?? null)} – ${fmtRank(
      result.target.targetRankRange?.[1] ?? null
    )}`,
    safe !== null ? `Aim for ≈ ${safe} corrects (safe end)` : 'Safe end: beyond the data',
    likely !== null ? `Historically enough: ≈ ${likely} corrects` : '',
    result.current && result.gap && result.gap.status !== 'NO_CURRENT_DATA'
      ? `My average: ${fmtCorrects(result.current.meanCorrects)} corrects — ${
          GAP_META[result.gap.status]?.label ?? result.gap.status
        }`
      : '',
    'Historical estimate — cutoffs move every year.',
    'https://www.eyeconicneetpg.com/predictor',
  ]
    .filter(Boolean)
    .join('\n');
}
