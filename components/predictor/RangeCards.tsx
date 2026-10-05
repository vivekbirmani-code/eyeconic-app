import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Info, Sparkles } from 'lucide-react-native';
import type { PredictionResult } from '@/types/predictor';
import { fmtPct, fmtRank, sessionLabel } from '@/utils/predictor/format';
import { RANK_COVERAGE_TEXT, TRANSFER_PLAIN } from '@/utils/predictor/constants';

/**
 * The result hero — native port of the website's RangeHero: the percentile
 * range on its true 0–100 axis, the AIR range on a log axis anchored to the
 * interval itself (widths honest, no invented external scale), and the
 * range-width context strip. Null ends render as "beyond N" — never a number.
 */

const logPos = (value: number, min: number, max: number): number => {
  if (value <= min) return 0;
  if (value >= max) return 100;
  return ((Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))) * 100;
};

const iniSessionLabel = (rank: PredictionResult['rank']): string =>
  rank.session ? sessionLabel(Number(rank.session.replace('-', ''))) : String(rank.examYear);

function PercentileCard({ result }: { result: PredictionResult }) {
  const [lo, hi] = result.estimate.percentile.range;
  const left = Math.max(0, Math.min(100, lo));
  const width = Math.max(0.75, Math.min(100 - left, hi - lo)); // ≥0.75% so a tight range stays visible
  const source =
    result.exam === 'INI_CET'
      ? `Official AIIMS ${iniSessionLabel(result.rank)} results`
      : `Official NEET PG ${result.rank.examYear} results`;

  return (
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <Text style={styles.cardLabel}>Estimated percentile</Text>
        <View style={styles.sourceChip}>
          <Text style={styles.sourceChipText}>{source}</Text>
        </View>
      </View>
      <View style={styles.bigNumberRow}>
        <Text style={styles.bigNumber}>{fmtPct(lo)}</Text>
        <Text style={styles.bigNumberDash}>–</Text>
        <Text style={styles.bigNumber}>{fmtPct(hi)}</Text>
      </View>
      {/* true 0–100 axis */}
      <View style={styles.track}>
        <View
          style={[
            styles.trackSegment,
            { left: `${left}%`, width: `${width}%` },
          ]}
        />
        <View style={[styles.trackTick, { left: `${(left + width) / 2}%` }]} />
      </View>
      <View style={styles.axisLabels}>
        <Text style={styles.axisLabelText}>0</Text>
        <Text style={styles.axisLabelText}>50</Text>
        <Text style={styles.axisLabelText}>100</Text>
      </View>
      <View style={styles.coverageRow}>
        <Info size={13} color="#01b4ae" />
        <Text style={styles.coverageText}>
          {RANK_COVERAGE_TEXT[result.estimate.percentile.coverage] ?? ''}
        </Text>
      </View>
    </View>
  );
}

function RankCard({ result }: { result: PredictionResult }) {
  const { rank } = result;
  const isIniCet = result.exam === 'INI_CET';
  const beyond = rank.beyondLastRecordedRank;

  // Log axis anchored to the interval itself: communicates relative width and
  // center honestly without claiming an external scale.
  const axisMax = rank.worstRank ?? (rank.bestRank ? rank.bestRank * 2 : null);
  const segLeft = rank.bestRank && axisMax ? logPos(rank.bestRank, 1, axisMax) : 0;
  const segWidth = axisMax ? Math.max(2, 100 - segLeft) : 0;

  return (
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <Text style={styles.cardLabel}>
          Predicted AIR ·{' '}
          {isIniCet ? `INI-CET ${iniSessionLabel(rank)} session` : `NEET PG ${rank.examYear}`}
        </Text>
        <View style={styles.sourceChip}>
          <Text style={styles.sourceChipText}>All India Rank</Text>
        </View>
      </View>
      <View style={styles.bigNumberRow}>
        <Text style={styles.bigNumber}>{fmtRank(rank.bestRank)}</Text>
        <Text style={styles.bigNumberDash}>–</Text>
        <Text style={styles.bigNumber}>{fmtRank(rank.worstRank, beyond)}</Text>
      </View>
      <View style={styles.track}>
        {axisMax ? (
          <>
            <View style={[styles.trackSegment, { left: `${segLeft}%`, width: `${segWidth}%` }]} />
            <View style={[styles.trackTick, { left: `${Math.min(97, (segLeft + segWidth) / 2)}%` }]} />
          </>
        ) : (
          <View style={[styles.trackFaded, { left: `${segLeft}%`, right: 0 }]} />
        )}
      </View>
      <View style={styles.coverageRow}>
        <Info size={13} color="#01b4ae" />
        <Text style={styles.coverageText}>{RANK_COVERAGE_TEXT[rank.coverage] ?? ''}</Text>
      </View>
      {beyond === null ? null : (
        <Text style={styles.beyondText}>
          Cautious end beyond the last recorded rank ({beyond.toLocaleString('en-IN')}).
        </Text>
      )}
    </View>
  );
}

export default function RangeCards({ result }: { result: PredictionResult }) {
  const { estimate, aggregation } = result;
  const lowData = aggregation.lowDataCaution;

  return (
    <View style={{ gap: 12 }}>
      <PercentileCard result={result} />
      <RankCard result={result} />

      {/* range-width context (§11: width must be visible; 1-GT looks less confident) */}
      <View style={[styles.widthStrip, lowData ? styles.widthStripLow : undefined]}>
        <Text style={[styles.widthStripText, lowData ? styles.widthStripTextLow : undefined]}>
          Based on <Text style={styles.widthStripStrong}>{aggregation.n}</Text>{' '}
          {aggregation.n === 1 ? 'Grand Test' : 'Grand Tests'} · range ±
          {estimate.performance.halfWidthCorrects} marks
        </Text>
        <Text style={[styles.widthStripText, lowData ? styles.widthStripTextLow : undefined]}>
          GT spread (SD): {estimate.performance.dispersion.sdCorrects}
        </Text>
        <Text style={[styles.widthStripText, lowData ? styles.widthStripTextLow : undefined]}>
          {TRANSFER_PLAIN[result.exam] ?? ''}
        </Text>
        {lowData ? (
          <View style={styles.lowDataRow}>
            <Sparkles size={12} color="#F59E0B" />
            <Text style={styles.lowDataText}>Add more GTs for a narrower, more reliable estimate.</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    flex: 1,
  },
  sourceChip: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  sourceChipText: {
    fontSize: 10,
    color: '#6B7280',
  },
  bigNumberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  bigNumber: {
    fontSize: 30,
    fontWeight: '700',
    color: '#111827',
    fontVariant: ['tabular-nums'],
  },
  bigNumberDash: {
    fontSize: 24,
    fontWeight: '600',
    color: '#01b4ae',
  },
  track: {
    height: 10,
    borderRadius: 99,
    backgroundColor: '#F3F4F6',
    marginTop: 16,
    overflow: 'hidden',
  },
  trackSegment: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: '#01b4ae',
    borderRadius: 99,
  },
  trackFaded: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(1, 180, 174, 0.25)',
  },
  trackTick: {
    position: 'absolute',
    top: -3,
    height: 16,
    width: 3,
    borderRadius: 99,
    backgroundColor: '#111827',
    marginLeft: -1.5,
  },
  axisLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  axisLabelText: {
    fontSize: 10.5,
    color: '#9CA3AF',
  },
  coverageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 10,
  },
  coverageText: {
    flex: 1,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  beyondText: {
    fontSize: 11.5,
    color: '#6B7280',
    marginTop: 5,
  },
  widthStrip: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    padding: 14,
    gap: 5,
  },
  widthStripLow: {
    backgroundColor: 'rgba(245, 158, 11, 0.07)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  widthStripText: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  widthStripTextLow: {
    color: '#92600A',
  },
  widthStripStrong: {
    fontWeight: '700',
    color: '#111827',
  },
  lowDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  lowDataText: {
    fontSize: 12,
    color: '#92600A',
    fontWeight: '600',
  },
});
