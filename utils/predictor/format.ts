/**
 * Shared formatting helpers for the predictor surfaces (form, result,
 * history). Ported verbatim from the eyeconic-main website client
 * (client/src/pages/predictor/format.ts).
 */

export const fmtRank = (rank: number | null | undefined, beyond?: number | null): string => {
  if (rank === null || rank === undefined) {
    return beyond ? `beyond ${beyond.toLocaleString('en-IN')}` : '—';
  }
  return rank.toLocaleString('en-IN');
};

export const fmtPct = (value: number): string => `${value.toFixed(1)}%`;

/** INI-CET session helpers: counselling blocks are tagged YYYYMM. */
export const sessionLabel = (tag: number): string => {
  const s = String(tag);
  const month = s.slice(4, 6) === '01' ? 'Jan' : 'Jul';
  return `${month} ${s.slice(0, 4)}`;
};

export const isSessionTag = (year: number): boolean => year > 200000;

export const yearFilterLabel = (year: number): string =>
  isSessionTag(year) ? sessionLabel(year) : String(year);

export const dateLabel = (value?: string | number | null): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export type AttemptLike = { endedAt?: string | number | null };

/** Latest attempt by end time (the engine's one-per-GT dedup mirrors this). */
export function latestAttempt<T extends AttemptLike>(attempts: T[]): T {
  return [...attempts].sort((a, b) => {
    const ta = typeof a.endedAt === 'string' ? Date.parse(a.endedAt) : (a.endedAt ?? 0);
    const tb = typeof b.endedAt === 'string' ? Date.parse(b.endedAt) : (b.endedAt ?? 0);
    return (tb as number) - (ta as number);
  })[0];
}
