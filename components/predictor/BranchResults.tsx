import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView as RSScrollView,
} from 'react-native';
import { colors } from '@/utils/theme';
import { Award, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { predictorEndpoints, predictorErrorMessage } from '@/services/predictor';
import type { BranchBand, BranchesResponse, PredictionResult } from '@/types/predictor';
import { BAND_META, BAND_COLORS, BRANCH_COVERAGE_TEXT } from '@/utils/predictor/constants';
import { fmtPct, fmtRank, yearFilterLabel } from '@/utils/predictor/format';
import { aboveAllClosings, bandCounts, type NonCategoryBranchSummary } from '@/utils/predictor/summary';

/**
 * Branch & college results — native port of the website's BranchResults:
 * band/year filters (chips instead of a select), paginated rows (25/page)
 * with band badges and en-IN closing ranks, final-state framing, and the
 * "everything comfortably within reach" banner. Rows are re-derived and
 * integrity-verified server-side on every page.
 */

const PAGE_SIZE = 25;
const BAND_ORDER: BranchBand[] = ['COMFORTABLE', 'WITHIN_RANGE', 'BORDERLINE', 'ASPIRATIONAL'];

interface Props {
  predictionId: string;
  summary: NonCategoryBranchSummary;
  result: PredictionResult;
}

export default function BranchResults({ predictionId, summary, result }: Props) {
  const [band, setBand] = useState<BranchBand | ''>('');
  const [year, setYear] = useState<number | ''>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BranchesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const years = summary.dataCoverage.years;
  const isIniCet = result.exam === 'INI_CET';

  const counts = useMemo(() => bandCounts(summary), [summary]);
  const aboveAll = useMemo(() => aboveAllClosings(summary), [summary]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await predictorEndpoints.branches(predictionId, {
        ...(band ? { band } : {}),
        ...(year ? { year } : {}),
        page,
        limit: PAGE_SIZE,
      });
      setData(res);
    } catch (err) {
      setError(predictorErrorMessage(err, 'Could not load branch results.'));
    } finally {
      setLoading(false);
    }
  }, [predictionId, band, year, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Website parity: tapping the active band chip again clears the filter.
  const setFilterBand = (next: BranchBand) => {
    setBand((prev) => (prev === next ? '' : next));
    setPage(1);
  };
  const setFilterYear = (next: number) => {
    setYear((prev) => (prev === next ? '' : next));
    setPage(1);
  };

  const rows = data?.rows ?? [];

  return (
    <View style={styles.card}>
      {/* constant context — stated once here, not on every row */}
      <View style={styles.contextBox}>
        <View style={styles.contextTitleRow}>
          <Award size={14} color={colors.primary} />
          <Text style={styles.contextTitle}>Possible branches &amp; colleges</Text>
        </View>
        <Text style={styles.contextRanges}>
          Percentile {fmtPct(result.estimate.percentile.range[0])}–
          {fmtPct(result.estimate.percentile.range[1])} · AIR{' '}
          {fmtRank(result.rank.bestRank)}–{fmtRank(result.rank.worstRank, result.rank.beyondLastRecordedRank)}
        </Text>
        <Text style={styles.contextCategory}>
          {summary.category.value}
          {summary.category.pwd ? ' · PwD' : ''} ·{' '}
          {summary.quota === 'INI' ? 'INI pool' : `${summary.quota} quota`}
        </Text>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18 }}>
        <Text style={styles.coverageText}>
          {BRANCH_COVERAGE_TEXT[summary.coverage] ?? ''} Closing ranks are{' '}
          <Text style={styles.coverageStrong}>final-state (end of counselling)</Text> for{' '}
          {years.map(yearFilterLabel).join(' · ')}.
        </Text>

        {aboveAll ? (
          <View style={styles.aboveAllBox}>
            <Text style={styles.aboveAllText}>
              Your range sits at or above the top of the historical admissions data — every listed
              option is comfortably within reach historically.
            </Text>
          </View>
        ) : null}

        {/* filters — horizontal chip rows (band toggle + year/session) */}
        <RSScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <TouchableOpacity
            style={[styles.chip, band === '' ? styles.chipAllActive : null]}
            onPress={() => setBand('')}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, band === '' ? styles.chipAllTextActive : null]}>
              All bands ({counts.total ?? 0})
            </Text>
          </TouchableOpacity>
          {BAND_ORDER.map((key) => {
            const active = band === key;
            const color = BAND_COLORS[key];
            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.chip,
                  active ? { borderColor: color, backgroundColor: `${color}1A` } : null,
                ]}
                onPress={() => setFilterBand(key)}
                activeOpacity={0.7}
                accessibilityLabel={`${BAND_META[key].label} — ${BAND_META[key].hint}`}
              >
                <Text style={[styles.chipText, active ? { color } : null]}>
                  {BAND_META[key].label} ({counts[key] ?? 0})
                </Text>
              </TouchableOpacity>
            );
          })}
        </RSScrollView>

        <RSScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <TouchableOpacity
            style={[styles.chip, year === '' ? styles.chipAllActive : null]}
            onPress={() => setYear('')}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, year === '' ? styles.chipAllTextActive : null]}>
              All {isIniCet ? 'sessions' : 'years'}
            </Text>
          </TouchableOpacity>
          {years.map((y) => {
            const active = year === y;
            return (
              <TouchableOpacity
                key={y}
                style={[styles.chip, active ? styles.chipAllActive : null]}
                onPress={() => setFilterYear(y)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, active ? styles.chipAllTextActive : null]}>
                  {yearFilterLabel(y)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </RSScrollView>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Loading branch results…</Text>
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={load} activeOpacity={0.7}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : rows.length === 0 ? (
          <Text style={styles.emptyText}>
            No options for this filter — try another band or {isIniCet ? 'session' : 'year'}.
          </Text>
        ) : (
          <>
            <View style={{ gap: 8, marginTop: 4 }}>
              {rows.map((row, i) => {
                const color = BAND_COLORS[row.band];
                return (
                  <View
                    key={`${row.year}-${row.institute}-${row.branch}-${i}`}
                    style={styles.rowCard}
                  >
                    <View style={styles.rowTop}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.rowInstitute} numberOfLines={2}>
                          {row.institute}
                        </Text>
                        <Text style={styles.rowBranch} numberOfLines={1}>
                          {row.branch}
                        </Text>
                      </View>
                      <View style={[styles.bandBadge, { backgroundColor: `${color}1A` }]}>
                        <Text style={[styles.bandBadgeText, { color }]}>{BAND_META[row.band].label}</Text>
                      </View>
                    </View>
                    <Text style={styles.rowMeta}>
                      Closing rank{' '}
                      <Text style={styles.rowMetaStrong}>
                        {row.closingRank.toLocaleString('en-IN')}
                      </Text>{' '}
                      · {yearFilterLabel(row.year)}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* pagination */}
            <View style={styles.paginationRow}>
              <Text style={styles.paginationText}>
                Page {data?.filters.page ?? 1} of {Math.max(1, data?.totalPages ?? 1)} ·{' '}
                {(data?.total ?? 0).toLocaleString('en-IN')} options
              </Text>
              <View style={styles.paginationButtons}>
                <TouchableOpacity
                  style={[styles.pageButton, page <= 1 ? styles.pageButtonDisabled : null]}
                  disabled={page <= 1}
                  onPress={() => setPage(page - 1)}
                  accessibilityLabel="Previous page"
                >
                  <ChevronLeft size={16} color={page <= 1 ? colors.borderStrong : colors.textBody} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pageButton,
                    page >= (data?.totalPages ?? 1) ? styles.pageButtonDisabled : null,
                  ]}
                  disabled={page >= (data?.totalPages ?? 1)}
                  onPress={() => setPage(page + 1)}
                  accessibilityLabel="Next page"
                >
                  <ChevronRight size={16} color={page >= (data?.totalPages ?? 1) ? colors.borderStrong : colors.textBody} />
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        {/* §12/§14 framing — one line, next to the results */}
        <Text style={styles.framingText}>
          Historical possibility, not a guarantee — cutoffs move every year with seat matrices,
          candidate behaviour, and exam difficulty.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  contextBox: {
    backgroundColor: colors.surfaceMuted,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    padding: 14,
    gap: 3,
  },
  contextTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  contextTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.textBody,
  },
  contextRanges: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  contextCategory: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  coverageText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  coverageStrong: {
    color: colors.textBody,
    fontWeight: '600',
  },
  aboveAllBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: 10,
    padding: 11,
    marginTop: 10,
  },
  aboveAllText: {
    fontSize: 12,
    color: '#067A47',
    lineHeight: 16,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    marginTop: 6,
  },
  chip: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  // "All …" chips take the Analytics active-filter treatment (teal); band
  // chips stay band-colored when active — semantic colors stay semantic.
  chipAllActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  chipText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  chipAllTextActive: {
    color: colors.primaryDark,
    fontWeight: '600',
  },
  loadingBox: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 28,
  },
  loadingText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  errorBox: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  errorText: {
    fontSize: 13,
    color: colors.dangerDark,
    textAlign: 'center',
  },
  retryButton: {
    borderRadius: 10,
    backgroundColor: colors.dangerDark,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  retryText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 28,
  },
  rowCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 8,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowInstitute: {
    fontSize: 13.5,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 18,
  },
  rowBranch: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  bandBadge: {
    borderRadius: 99,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  bandBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rowMeta: {
    fontSize: 11.5,
    color: colors.textSecondary,
  },
  rowMetaStrong: {
    color: colors.textBody,
    fontWeight: '600',
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 14,
  },
  paginationText: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  paginationButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  pageButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 7,
    minWidth: 38,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageButtonDisabled: {
    opacity: 0.5,
  },
  framingText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    lineHeight: 15,
  },
});
