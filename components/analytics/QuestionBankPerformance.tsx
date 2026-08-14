import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { QUESTION_TYPE_LABELS, DIFFICULTY_LABELS } from '@/types/question';
import { PerformanceBucket, StudentPerformanceBreakdown, formatPercent } from '@/types/analytics';

type DimensionKey = 'bySubject' | 'byTopic' | 'bySubtopic' | 'bySystem' | 'byQuestionType' | 'byTag' | 'byDifficulty';

const DIMENSIONS: { key: DimensionKey; label: string }[] = [
  { key: 'bySubject', label: 'Subject' },
  { key: 'byTopic', label: 'Topic' },
  { key: 'bySubtopic', label: 'Subtopic' },
  { key: 'bySystem', label: 'System' },
  { key: 'byQuestionType', label: 'Question Type' },
  { key: 'byTag', label: 'Tag' },
  { key: 'byDifficulty', label: 'Difficulty' },
];

const formatKey = (dimension: DimensionKey, key: string) => {
  if (dimension === 'byQuestionType') return QUESTION_TYPE_LABELS[key as keyof typeof QUESTION_TYPE_LABELS] || key;
  if (dimension === 'byDifficulty') return DIFFICULTY_LABELS[key as keyof typeof DIFFICULTY_LABELS] || key;
  return key;
};

const accuracyColor = (accuracy: number | null) => {
  if (accuracy === null) return '#9CA3AF';
  if (accuracy >= 60) return '#10B981';
  if (accuracy >= 40) return '#F59E0B';
  return '#EF4444';
};

function BucketRow({
  bucket,
  dimension,
}: {
  bucket: PerformanceBucket;
  dimension: DimensionKey;
}) {
  const label = formatKey(dimension, bucket.key);
  const incorrect = bucket.incorrect ?? Math.max(0, bucket.attempted - bucket.correct);
  const skipped = bucket.skipped ?? 0;
  const smallSample = bucket.attempted > 0 && bucket.attempted < 3;

  return (
    <View style={styles.bucketRow}>
      <View style={styles.bucketHeader}>
        <Text style={styles.bucketKey}>{label}</Text>
        <Text style={[styles.bucketAccuracy, { color: accuracyColor(bucket.accuracy) }]}>
          {formatPercent(bucket.accuracy, 'N/A')}
        </Text>
      </View>
      <View style={styles.progressBarBg}>
        <View style={[
          styles.progressBarFill,
          {
            width: `${Math.min(bucket.accuracy ?? 0, 100)}%`,
            backgroundColor: accuracyColor(bucket.accuracy),
          }
        ]} />
      </View>
      <Text style={styles.bucketMeta}>
        {bucket.correct} correct • {incorrect} incorrect • {skipped} skipped
      </Text>
      <Text style={styles.bucketMeta}>
        {bucket.attempted} attempted{smallSample ? ' • small sample' : ''}
      </Text>
    </View>
  );
}

export default function QuestionBankPerformance({ data }: { data: StudentPerformanceBreakdown | null }) {
  const [dimension, setDimension] = useState<DimensionKey>('bySubject');

  if (!data) {
    return (
      <Text style={styles.emptyText}>No question-level performance data available yet for this student.</Text>
    );
  }

  const buckets = data[dimension] || [];
  const overallAccuracy = data.overall.accuracy;

  return (
    <View>
      <View style={styles.overallRow}>
        <Text style={styles.overallLabel}>Overall accuracy (excluding skipped)</Text>
        <Text style={[styles.overallValue, { color: accuracyColor(overallAccuracy) }]}>
          {formatPercent(overallAccuracy, 'N/A')}
          {overallAccuracy !== null ? ` (${data.overall.correct}/${data.overall.attempted})` : ''}
        </Text>
      </View>

      {(data.strengths?.length || data.weaknesses?.length) ? (
        <View style={styles.insightBlock}>
          {data.strengths?.map((s) => (
            <Text key={`s-${s.key}`} style={styles.insightGood}>
              {s.label}: {s.key} — {formatPercent(s.accuracy)} — {s.correct}/{s.attempted} attempted
            </Text>
          ))}
          {data.weaknesses?.map((w) => (
            <Text key={`w-${w.key}`} style={styles.insightWarn}>
              {w.label}: {w.key} — {formatPercent(w.accuracy)} — {w.correct}/{w.attempted} attempted
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.chipWrap}>
        {DIMENSIONS.map(d => (
          <TouchableOpacity
            key={d.key}
            style={[styles.chip, dimension === d.key && styles.chipActive]}
            onPress={() => setDimension(d.key)}
          >
            <Text style={[styles.chipText, dimension === d.key && styles.chipTextActive]}>{d.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {buckets.length === 0 ? (
        <Text style={styles.emptyText}>No data for this dimension yet.</Text>
      ) : (
        buckets.map((bucket) => (
          <BucketRow key={bucket.key} bucket={bucket} dimension={dimension} />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overallRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 8,
  },
  overallLabel: {
    fontSize: 13,
    color: '#6B7280',
    flex: 1,
  },
  overallValue: {
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
  },
  insightBlock: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  insightGood: {
    fontSize: 12,
    color: '#059669',
  },
  insightWarn: {
    fontSize: 12,
    color: '#DC2626',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  chipActive: {
    backgroundColor: '#01b4ae',
  },
  chipText: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  bucketRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  bucketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
    gap: 8,
  },
  bucketKey: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    flex: 1,
  },
  bucketAccuracy: {
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 0,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  bucketMeta: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 4,
  },
  emptyText: {
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 12,
    fontSize: 13,
  },
});
