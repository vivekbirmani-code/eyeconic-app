import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ScoreDistributionBucket } from '@/types/analytics';

interface ScoreDistributionProps {
  distribution: ScoreDistributionBucket[];
  totalAttempts: number;
}

export default function ScoreDistribution({ distribution, totalAttempts }: ScoreDistributionProps) {
  if (!distribution || totalAttempts === 0) {
    return <Text style={styles.empty}>No completed attempts to show distribution.</Text>;
  }

  const maxCount = Math.max(...distribution.map((b) => b.count), 1);

  return (
    <View style={styles.container}>
      {distribution.map((bucket) => {
        const widthPct = (bucket.count / maxCount) * 100;
        return (
          <View key={bucket.label} style={styles.row}>
            <Text style={styles.label}>{bucket.label}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.max(widthPct, bucket.count > 0 ? 4 : 0)}%` }]} />
            </View>
            <Text style={styles.count}>{bucket.count}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Same white card the other analytics sections use, so the bars sit on a
  // surface instead of the page background.
  container: {
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 16,
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  label: {
    width: 62,
    fontSize: 12,
    color: '#374151',
    fontWeight: '600',
  },
  barTrack: {
    flex: 1,
    height: 12,
    backgroundColor: '#F3F4F6',
    borderRadius: 6,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#6366F1',
    borderRadius: 6,
  },
  count: {
    width: 28,
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2937',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  empty: {
    color: '#9CA3AF',
    textAlign: 'center',
    fontSize: 13,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
});
