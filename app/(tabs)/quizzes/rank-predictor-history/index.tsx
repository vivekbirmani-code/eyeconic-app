import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react-native';
import { colors } from '@/utils/theme';
import { withFeatureGate } from '@/components/withFeatureGate';
import { predictorEndpoints, predictorErrorMessage } from '@/services/predictor';
import type { PredictionHistoryItem } from '@/types/predictor';
import { EXAM_LABELS } from '@/utils/predictor/constants';
import { fmtPct, fmtRank } from '@/utils/predictor/format';

/**
 * Rank & Branch Predictor — prediction history list.
 *
 * Same server-side records the website's /predictor/history lists (every
 * served prediction is persisted before it is served). Tapping a record
 * opens the full detail ([id].tsx) — the stored result re-rendered exactly
 * as it was served, integrity-checked, with branch browsing and outcome
 * capture still live off the stored predictionId.
 */

const PAGE_SIZE = 10;

function PredictorHistoryScreen() {
  const router = useRouter();

  const [items, setItems] = useState<PredictionHistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (pageToLoad: 1 | 'next') => {
    const isFirst = pageToLoad === 1;
    if (isFirst) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const target = isFirst ? 1 : page + 1;
      const data = await predictorEndpoints.history(target, PAGE_SIZE);
      setItems((prev) => (isFirst ? data.predictions : [...prev, ...data.predictions]));
      setPage(data.pagination.page);
      setTotalPages(data.pagination.totalPages);
    } catch (err) {
      setError(
        predictorErrorMessage(err, 'Could not load your prediction history right now.')
      );
    } finally {
      if (isFirst) setLoading(false);
      else setLoadingMore(false);
    }
  }, [page]);

  useEffect(() => {
    load(1);
    // load is stable per page change; initial fetch intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const rangeLabel = (item: PredictionHistoryItem): string => {
    const parts: string[] = [];
    if (item.percentileRange) parts.push(`${fmtPct(item.percentileRange[0])}–${fmtPct(item.percentileRange[1])} %ile`);
    if (item.rankRange) {
      const best = fmtRank(item.rankRange[0]);
      const worst = fmtRank(item.rankRange[1]);
      parts.push(`AIR ${best}–${worst}`);
    }
    return parts.join(' · ');
  };

  return (
    <ScreenContainer style={styles.container}>
      {/* Header — the Analytics module-header treatment */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Go back"
        >
          <ChevronLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Prediction History</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {loading && (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateText}>Loading your predictions…</Text>
          </View>
        )}

        {!loading && error !== null && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => load(1)}>
              <RefreshCw color="#FFF" size={16} />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && error === null && items.length === 0 && (
          <View style={styles.stateCard}>
            <Text style={styles.emptyTitle}>No predictions yet</Text>
            <Text style={styles.stateText}>
              Run your first prediction from the Rank Predictor — it takes a minute.
            </Text>
          </View>
        )}

        {!loading && error === null && items.length > 0 && (
          <>
            <Text style={styles.countText}>{items.length} prediction{items.length === 1 ? '' : 's'} loaded</Text>
            {items.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.historyCard}
                onPress={() =>
                  router.push(`/(tabs)/quizzes/rank-predictor-history/${item.id}`)
                }
                activeOpacity={0.8}
                accessibilityLabel={`Open prediction from ${formatDate(item.createdAt)}`}
              >
                <View style={styles.historyTop}>
                  <View style={styles.examChip}>
                    <Text style={styles.examChipText}>
                      {EXAM_LABELS[item.exam] ?? item.exam}
                    </Text>
                  </View>
                  <View style={styles.historyDateRow}>
                    <Text style={styles.historyDate}>{formatDate(item.createdAt)}</Text>
                    <ChevronRight size={16} color={colors.textMuted} />
                  </View>
                </View>
                <Text style={styles.historyRange}>{rangeLabel(item) || 'Rank range unavailable'}</Text>
                <View style={styles.historyMeta}>
                  <Text style={styles.historyMetaText}>
                    {item.gtsUsed ?? '—'} Grand Test{item.gtsUsed === 1 ? '' : 's'}
                  </Text>
                  <Text style={styles.historyMetaTextRight}>
                    {item.branchesCoverage && item.branchesCoverage !== 'CATEGORY_REQUIRED'
                      ? 'Branch predictions included'
                      : 'No category selected — rank only'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}

            {page < totalPages && (
              <TouchableOpacity
                style={styles.loadMoreButton}
                onPress={() => load('next')}
                disabled={loadingMore}
                activeOpacity={0.8}
              >
                {loadingMore ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Text style={styles.loadMoreText}>Load more</Text>
                )}
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.primary,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  stateCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 28,
    alignItems: 'center',
    gap: 8,
  },
  stateText: {
    fontSize: 13.5,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  errorCard: {
    backgroundColor: colors.dangerTint,
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.2)',
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    fontSize: 14,
    color: colors.dangerDark,
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.dangerDark,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  retryText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  countText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  historyTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  examChip: {
    backgroundColor: colors.primaryTint,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  examChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  historyDate: {
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  historyDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  historyRange: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  historyMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  historyMetaText: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  historyMetaTextRight: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
    textAlign: 'right',
  },
  loadMoreButton: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 46,
    justifyContent: 'center',
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primaryDark,
  },
});

export default withFeatureGate('rankPredictor')(PredictorHistoryScreen);
