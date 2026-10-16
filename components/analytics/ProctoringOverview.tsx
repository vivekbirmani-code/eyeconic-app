/**
 * ProctoringOverview — the 'proctoring' tab of student-analytics
 * (AI Proctoring plan §25.2/§25.3, Phase 7). Renders the per-test proctoring
 * rollup (KPIs + flagged-attempt table) from the SAME
 * /quizzes/analytics/test/:testId payload the Test tab uses — one response,
 * one cohort, no separate fetch. Rows join the ranked student list for
 * names; tapping a row opens the existing AttemptDetailModal (timeline,
 * violations, review).
 *
 * Reviewer-facing labels live here (the D7 centralized-copy rule applies to
 * STUDENT-facing strings only); colors come from the teal design system
 * (utils/theme.ts — Analytics is the reference).
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react-native';
import StatCardGrid, { type StatCardItem } from '@/components/StatCardGrid';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { colors } from '@/utils/theme';

export interface ProctoringAttemptRow {
  attemptId: string;
  sessionId: string;
  sessionStatus: string;
  riskScore: number;
  riskCategory: string;
  totalViolations: number;
  integrityStatus: string;
  focusLossExits: number;
  multipleFaceEvents: number;
  faceAbsentTotal: number;
  cameraIncidents: number;
  heartbeatGaps: number;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ProctoringRollup {
  proctoredAttempts: number;
  riskDistribution: Record<string, number>;
  totalViolations: number;
  focusLossExits: number;
  multipleFaceEvents: number;
  faceAbsentTotal: number;
  cameraIncidents: number;
  heartbeatGaps: number;
  flaggedAttempts: number;
  integrityCounts: Record<string, number>;
}

interface ProctoringOverviewProps {
  proctoring?: { attempts: ProctoringAttemptRow[]; rollup: ProctoringRollup } | null;
  /** Ranked student rows (attemptId → studentName/email join). */
  studentPerformance?: Array<{ _id: string; studentName: string; studentEmail: string }> | null;
  loading?: boolean;
  onAttemptClick?: (attemptId: string) => void;
}

const RISK_CHIP_COLORS: Record<string, string> = {
  normal: colors.success,
  low: colors.primaryDark,
  moderate: '#D97706',
  high: '#DC2626',
  critical: '#DC2626',
};

const INTEGRITY_LABELS: Record<string, string> = {
  pending: 'Pending review',
  clean: 'Clean',
  reviewed_ok: 'Reviewed — OK',
  reviewed_concern: 'Reviewed — concern',
};

const ProctoringOverview: React.FC<ProctoringOverviewProps> = ({
  proctoring,
  studentPerformance,
  loading,
  onAttemptClick,
}) => {
  const { width } = useWindowDimensions();

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={styles.loader} />;
  }

  if (!proctoring || proctoring.rollup.proctoredAttempts === 0) {
    return (
      <View style={styles.emptyCard}>
        <ShieldCheck color="#9CA3AF" size={44} />
        <Text style={styles.emptyTitle}>No proctored attempts</Text>
        <Text style={styles.emptyText}>
          This test has no camera-monitoring sessions yet. Proctoring data appears here
          when a proctored attempt is started.
        </Text>
      </View>
    );
  }

  const { rollup } = proctoring;
  const nameByAttempt = new Map(
    (studentPerformance ?? []).map((row) => [String(row._id), row])
  );

  const kpis: StatCardItem[] = [
    {
      value: rollup.proctoredAttempts,
      label: 'Proctored Attempts',
      icon: ShieldCheck,
      iconColor: colors.primaryDark,
      backgroundColor: colors.primaryTint,
    },
    {
      value: rollup.flaggedAttempts,
      label: 'Flagged for Review',
      icon: rollup.flaggedAttempts > 0 ? ShieldAlert : ShieldCheck,
      iconColor: rollup.flaggedAttempts > 0 ? '#DC2626' : colors.success,
      backgroundColor: rollup.flaggedAttempts > 0 ? '#FEF2F2' : '#ECFDF5',
    },
    {
      value: rollup.totalViolations,
      label: 'Total Violations',
      valueColor: rollup.totalViolations > 0 ? '#DC2626' : undefined,
    },
    {
      value: rollup.focusLossExits,
      label: 'Focus-loss Exits',
    },
    {
      value: rollup.multipleFaceEvents,
      label: 'Multiple-face Events',
    },
    {
      value: rollup.cameraIncidents,
      label: 'Camera Incidents',
    },
  ];

  const rows = [...proctoring.attempts]
    .sort((a, b) => b.riskScore - a.riskScore || b.totalViolations - a.totalViolations)
    .map((row) => ({
      ...row,
      studentName: nameByAttempt.get(row.attemptId)?.studentName ?? 'Student',
    }));

  const columns: Array<DataTableColumn<typeof rows[number]>> = [
    {
      key: 'student',
      header: 'Student',
      width: 150,
      grow: true,
      renderCell: (row) => (
        <Text style={styles.cellName} numberOfLines={1}>{row.studentName}</Text>
      ),
    },
    {
      key: 'risk',
      header: 'Risk',
      width: 96,
      renderCell: (row) => (
        <View style={[styles.riskChip, { backgroundColor: `${RISK_CHIP_COLORS[row.riskCategory] ?? colors.primaryDark}1A` }]}>
          <Text style={[styles.riskChipText, { color: RISK_CHIP_COLORS[row.riskCategory] ?? colors.primaryDark }]}>
            {row.riskCategory}
          </Text>
        </View>
      ),
    },
    {
      key: 'violations',
      header: 'Violations',
      width: 84,
      align: 'center',
      renderCell: (row) => (
        <Text style={[styles.cellValue, row.totalViolations > 0 && styles.cellValueAlert]}>
          {row.totalViolations}
        </Text>
      ),
    },
    {
      key: 'integrity',
      header: 'Review',
      width: 140,
      renderCell: (row) => (
        <Text
          style={[
            styles.cellValue,
            row.integrityStatus === 'reviewed_concern' && styles.cellValueAlert,
            row.integrityStatus === 'clean' && styles.cellValueOk,
          ]}
          numberOfLines={1}
        >
          {INTEGRITY_LABELS[row.integrityStatus] ?? row.integrityStatus}
        </Text>
      ),
    },
    {
      key: 'exits',
      header: 'Exits',
      width: 60,
      align: 'center',
      renderCell: (row) => <Text style={styles.cellValue}>{row.focusLossExits}</Text>,
    },
    {
      key: 'faces',
      header: 'Faces',
      width: 60,
      align: 'center',
      renderCell: (row) => <Text style={styles.cellValue}>{row.multipleFaceEvents}</Text>,
    },
    {
      key: 'absent',
      header: 'Absent',
      width: 64,
      align: 'center',
      renderCell: (row) => <Text style={styles.cellValue}>{row.faceAbsentTotal}</Text>,
    },
    {
      key: 'camera',
      header: 'Camera',
      width: 70,
      align: 'center',
      renderCell: (row) => <Text style={styles.cellValue}>{row.cameraIncidents}</Text>,
    },
    {
      key: 'gaps',
      header: 'Gaps',
      width: 60,
      align: 'center',
      renderCell: (row) => <Text style={styles.cellValue}>{row.heartbeatGaps}</Text>,
    },
  ];

  const reviewQueue = rollup.flaggedAttempts;
  const pending = rollup.integrityCounts?.pending ?? 0;

  return (
    <View>
      <StatCardGrid items={kpis} width={width} contentInsets={32} />

      {reviewQueue > 0 && (
        <View style={styles.calloutCard}>
          <AlertTriangle color="#D97706" size={18} />
          <Text style={styles.calloutText}>
            {reviewQueue} attempt{reviewQueue === 1 ? '' : 's'} flagged (violations or moderate+ risk)
            {pending > 0 ? ` · ${pending} awaiting review` : ''}
            {' — '}open a row to review the full timeline.
          </Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Attempts (highest risk first)</Text>
      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={(row) => row.attemptId}
        onRowPress={onAttemptClick ? (row) => onAttemptClick(row.attemptId) : undefined}
        rowAccessibilityLabel={(row) => `Open proctoring timeline for ${row.studentName}`}
        style={styles.tableCard}
      />

      <Text style={styles.footnote}>
        Observations are estimates for review context — they are never automatic mark
        changes. Risk bands are advisory triage only.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  loader: { marginTop: 40 },
  emptyCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#1F2937', marginTop: 10 },
  emptyText: { fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 4, lineHeight: 18 },
  calloutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
  },
  calloutText: { fontSize: 12.5, color: '#92400E', marginLeft: 8, flex: 1, lineHeight: 17 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
    marginTop: 18,
    marginBottom: 8,
  },
  tableCard: { marginBottom: 4 },
  riskChip: {
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  riskChipText: { fontSize: 11.5, fontWeight: '700', textTransform: 'capitalize' },
  cellName: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  cellValue: { fontSize: 12.5, color: '#374151' },
  cellValueAlert: { color: '#DC2626', fontWeight: '700' },
  cellValueOk: { color: colors.success, fontWeight: '600' },
  footnote: { fontSize: 11.5, color: '#9CA3AF', marginTop: 10, lineHeight: 16 },
});

export default ProctoringOverview;
