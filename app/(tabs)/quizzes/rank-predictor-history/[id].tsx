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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, RefreshCw } from 'lucide-react-native';
import { withFeatureGate } from '@/components/withFeatureGate';
import { predictorEndpoints, predictorErrorMessage } from '@/services/predictor';
import type { PredictionResult, StoredPredictionRecord } from '@/types/predictor';
import PredictResult from '@/components/predictor/PredictResult';
import { EXAM_LABELS } from '@/utils/predictor/constants';

/**
 * Rank & Branch Predictor — one stored prediction, reopened exactly as it
 * was served. Native port of the website's history detail: the record is
 * re-fetched with its integrity hash (recomputed vs stored — a later method
 * or data change surfaces a warning banner, never a silent mismatch) and
 * rendered through the SAME result view a fresh prediction uses, read-only.
 * Branch browsing and outcome capture stay live off the stored
 * predictionId.
 */

function PredictorHistoryDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [record, setRecord] = useState<StoredPredictionRecord | null>(null);
  const [integrityMatches, setIntegrityMatches] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await predictorEndpoints.historyItem(id);
      setRecord(data.prediction);
      setIntegrityMatches(data.integrity.matches);
    } catch (err) {
      setError(predictorErrorMessage(err, 'Could not load this prediction.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const result: PredictionResult | null = record
    ? { ...record, examLabel: EXAM_LABELS[record.exam] ?? record.exam }
    : null;

  return (
    <ScreenContainer style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Prediction History</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {loading && (
          <View style={styles.stateCard}>
            <ActivityIndicator color="#2563EB" />
            <Text style={styles.stateText}>Loading this prediction…</Text>
          </View>
        )}

        {!loading && error !== null && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={load}>
              <RefreshCw color="#FFF" size={16} />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && error === null && result ? (
          <PredictResult
            result={result}
            predictionId={id}
            onBack={() => router.back()}
            backLabel="Back to history"
            integrityWarning={!integrityMatches}
            readonly
          />
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#2563EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 12,
  },
  stateCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    gap: 8,
  },
  stateText: {
    fontSize: 13.5,
    color: '#6B7280',
    textAlign: 'center',
  },
  errorCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.2)',
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#DC2626',
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DC2626',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  retryText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
});

export default withFeatureGate('rankPredictor')(PredictorHistoryDetailScreen);
