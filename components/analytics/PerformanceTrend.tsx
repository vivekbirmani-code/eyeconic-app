import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TrendPoint, formatPercent } from '@/types/analytics';

interface PerformanceTrendProps {
  trend: TrendPoint[];
}

export default function PerformanceTrend({ trend }: PerformanceTrendProps) {
  if (!trend || trend.length === 0) {
    return <Text style={styles.empty}>No trend data available for this period.</Text>;
  }

  const maxScore = Math.max(
    ...trend.map((t) => (t.scorePercentage ?? 0)),
    1
  );

  return (
    <View style={styles.container}>
      {trend.map((point) => {
        const widthPct = point.scorePercentage !== null
          ? Math.max(4, (point.scorePercentage / maxScore) * 100)
          : 0;
        return (
          <View key={point.attemptId} style={styles.row}>
            <View style={styles.meta}>
              <Text style={styles.title} numberOfLines={1}>{point.quizTitle}</Text>
              <Text style={styles.date}>
                {new Date(point.date).toLocaleDateString()}
              </Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${widthPct}%` }]} />
            </View>
            <View style={styles.values}>
              <Text style={styles.score}>{formatPercent(point.scorePercentage)}</Text>
              <Text style={styles.accuracy}>{formatPercent(point.accuracy, '—')}</Text>
            </View>
          </View>
        );
      })}
      {trend.length === 1 ? (
        <Text style={styles.hint}>Only one test in this period — trend comparison needs more data.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  row: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  meta: {
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  date: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  barTrack: {
    height: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  barFill: {
    height: '100%',
    backgroundColor: '#01b4ae',
    borderRadius: 4,
  },
  values: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  score: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F2937',
  },
  accuracy: {
    fontSize: 12,
    color: '#6B7280',
  },
  empty: {
    color: '#9CA3AF',
    textAlign: 'center',
    fontSize: 13,
  },
  hint: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 4,
  },
});
