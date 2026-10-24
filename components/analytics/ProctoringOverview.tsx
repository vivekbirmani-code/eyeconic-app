/**
 * ProctoringOverview — the 'proctoring' tab of student-analytics
 * (AI Proctoring plan §25.2/§25.3, Phase 7; mobile-first layout Phase 9.1).
 * Renders the per-test proctoring rollup (KPIs + flagged-attempt list) from
 * the SAME /quizzes/analytics/test/:testId payload the Test tab uses — one
 * response, one cohort, no separate fetch. Rows join the ranked student list
 * for names; tapping a row opens the existing AttemptDetailModal (timeline,
 * violations, review).
 *
 * Layout: below MOBILE_BREAKPOINT the 9-column reviewer table becomes an
 * attempt-card list (name + risk chip + review status + compact metric
 * chips) — a phone shows whole attempts, not 2.5 table columns. Wide
 * viewports keep the shared DataTable (which h-scrolls only if fonts grow).
 *
 * Reviewer-facing labels live here (the D7 centralized-copy rule applies to
 * STUDENT-facing strings only); colors come from the teal design system
 * (utils/theme.ts — Analytics is the reference).
 */

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react-native';
import StatCardGrid, { type StatCardItem } from '@/components/StatCardGrid';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { colors } from '@/utils/theme';

/** Below this width the table becomes attempt cards (phones/small tablets). */
const MOBILE_BREAKPOINT = 600;

/**
 * Rows mounted on first render. Long cohorts (public quizzes can carry
 * hundreds of guest sessions) render the highest-risk rows first and reveal
 * the rest on demand — mounting every row re-renders the whole table on each
 * live-refresh nudge (the screen's coalesced quiz_leaderboard_updated
 * refetch), and at ~400 rows that measured ~650ms of blocked main thread PER
 * NUDGE on a fast desktop, freezing the tab during submission bursts (phones
 * are far worse). Same pattern as the timeline's EVENT_ROW_CAP below and
 * QuestionAnalytics' show-more. KPIs and the flagged callout always aggregate
 * EVERY attempt — they read the rollup, never the rendered rows.
 */
const ROWS_INITIAL = 25;

export interface ProctoringAttemptRow {
  attemptId: string;
  sessionId: string;
  sessionStatus: string;
  riskScore: number;
  riskCategory: string;
  totalViolations: number;
  integrityStatus: string;
  focusLossExits: number;
  lookAwayEvents: number;
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
  lookAwayEvents: number;
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
  /**
   * Admin-only unranked public-quiz guests (attemptId → lead identity join).
   * Since public-quiz proctoring Phase 4 the rollup includes guest sessions;
   * this join replaces the generic "Student" fallback with the lead's real
   * name (owner requirement §1) and a Guest badge.
   */
  guestParticipants?: Array<{ attemptId: string; name: string; email: string | null }> | null;
  loading?: boolean;
  onAttemptClick?: (attemptId: string) => void;
}

const RISK_CHIP_COLORS: Record<string, string> = {
  normal: colors.success,
  low: colors.primaryDark,
  moderate: colors.warningDark,
  high: colors.dangerDark,
  critical: colors.dangerDark,
};

const INTEGRITY_LABELS: Record<string, string> = {
  pending: 'Pending review',
  clean: 'Clean',
  reviewed_ok: 'Reviewed — OK',
  reviewed_concern: 'Reviewed — concern',
};

const INTEGRITY_COLORS: Record<string, string> = {
  pending: colors.textSecondary,
  clean: colors.successDark,
  reviewed_ok: colors.successDark,
  reviewed_concern: colors.dangerDark,
};

interface AttemptRow extends ProctoringAttemptRow {
  studentName: string;
  /** True for public-quiz guest attempts (rendered with a Guest badge). */
  isGuest: boolean;
}

/** One mobile attempt card — a whole readable attempt, tap to drill in. */
const AttemptCard: React.FC<{
  row: AttemptRow;
  onPress?: () => void;
}> = ({ row, onPress }) => {
  const riskColor = RISK_CHIP_COLORS[row.riskCategory] ?? colors.primaryDark;
  const metrics: Array<{ label: string; value: number; alert?: boolean }> = [
    { label: 'Violations', value: row.totalViolations, alert: row.totalViolations > 0 },
    { label: 'Exits', value: row.focusLossExits },
    { label: 'Look-aways', value: row.lookAwayEvents },
    { label: 'Faces', value: row.multipleFaceEvents },
    { label: 'Absent', value: row.faceAbsentTotal },
    { label: 'Camera', value: row.cameraIncidents },
    { label: 'Gaps', value: row.heartbeatGaps },
  ];
  const body = (
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <View style={styles.cardNameWrap}>
          <Text style={styles.cardName} numberOfLines={1}>{row.studentName}</Text>
          {row.isGuest && <Text style={styles.guestBadge}>Guest</Text>}
        </View>
        <View style={[styles.riskChip, { backgroundColor: `${riskColor}1A` }]}>
          <Text style={[styles.riskChipText, { color: riskColor }]}>
            {row.riskCategory}
          </Text>
        </View>
      </View>
      <Text
        style={[styles.cardReview, { color: INTEGRITY_COLORS[row.integrityStatus] ?? colors.textSecondary }]}
        numberOfLines={1}
      >
        {INTEGRITY_LABELS[row.integrityStatus] ?? row.integrityStatus}
      </Text>
      <View style={styles.cardMetrics}>
        {metrics.map((metric) => (
          <View
            key={metric.label}
            style={[styles.metricChip, metric.alert && styles.metricChipAlert]}
          >
            <Text style={styles.metricLabel}>{metric.label}</Text>
            <Text style={[styles.metricValue, metric.alert && styles.metricValueAlert]}>
              {metric.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open proctoring timeline for ${row.studentName}`}
    >
      {body}
    </Pressable>
  );
};

const ProctoringOverview: React.FC<ProctoringOverviewProps> = ({
  proctoring,
  studentPerformance,
  guestParticipants,
  loading,
  onAttemptClick,
}) => {
  const { width } = useWindowDimensions();
  // Survives live refreshes of the SAME test (a shown-all list must not snap
  // back to the cap mid-burst); the host resets it on test switch via `key`.
  const [showAllRows, setShowAllRows] = useState(false);

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={styles.loader} />;
  }

  if (!proctoring || proctoring.rollup.proctoredAttempts === 0) {
    return (
      <View style={styles.emptyCard}>
        <ShieldCheck color={colors.textMuted} size={44} />
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
  // Guest identity join (owner requirement §1): a rollup row that matches a
  // public participant renders the lead's REAL name + Guest badge — never
  // the generic "Student" fallback. Rows matching neither join are legacy
  // anonymous attempts (pre-verification era) and say so honestly.
  const guestByAttempt = new Map(
    (guestParticipants ?? []).map((row) => [String(row.attemptId), row])
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
      iconColor: rollup.flaggedAttempts > 0 ? colors.dangerDark : colors.success,
      backgroundColor: rollup.flaggedAttempts > 0 ? colors.dangerTint : colors.successTint,
    },
    {
      value: rollup.totalViolations,
      label: 'Total Violations',
      valueColor: rollup.totalViolations > 0 ? colors.dangerDark : undefined,
    },
    {
      value: rollup.focusLossExits,
      label: 'Focus-loss Exits',
    },
    {
      value: rollup.lookAwayEvents,
      label: 'Look-aways',
    },
    {
      value: rollup.multipleFaceEvents,
      label: 'Multiple-face Events',
    },
    {
      value: rollup.faceAbsentTotal,
      label: 'Face Absent',
    },
    {
      value: rollup.cameraIncidents,
      label: 'Camera Incidents',
    },
  ];

  const rows: AttemptRow[] = [...proctoring.attempts]
    .sort((a, b) => b.riskScore - a.riskScore || b.totalViolations - a.totalViolations)
    .map((row) => {
      const student = nameByAttempt.get(row.attemptId);
      if (student) return { ...row, studentName: student.studentName, isGuest: false };
      const guest = guestByAttempt.get(row.attemptId);
      if (guest) return { ...row, studentName: guest.name, isGuest: true };
      // Legacy anonymous attempt (pre-OTP-verification era) — never invent
      // an identity (owner decision 8).
      return { ...row, studentName: 'Anonymous (pre-verification)', isGuest: true };
    });

  // Triage view: only the top rows mount until the reviewer asks for the rest.
  const visibleRows = showAllRows ? rows : rows.slice(0, ROWS_INITIAL);

  const columns: Array<DataTableColumn<AttemptRow>> = [
    {
      key: 'student',
      header: 'Student',
      width: 150,
      grow: true,
      renderCell: (row) => (
        <View style={styles.cellNameWrap}>
          <Text style={styles.cellName} numberOfLines={1}>{row.studentName}</Text>
          {row.isGuest && <Text style={styles.guestBadge}>Guest</Text>}
        </View>
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
      key: 'lookaways',
      header: 'Look-aways',
      width: 82,
      align: 'center',
      renderCell: (row) => <Text style={styles.cellValue}>{row.lookAwayEvents}</Text>,
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
      {/* Page content grid: the host ScrollView carries NO horizontal padding
          (every section owns its margins — the screen-wide convention is 16).
          StatCardGrid's contentInsets is MATH-ONLY (it shrinks the cards; it
          never pads) — the REAL 16/16 inset comes from this wrapper, exactly
          like quiz-hub's and instructions' padded statsContainer. */}
      <View style={styles.kpiWrap}>
        <StatCardGrid items={kpis} width={width} contentInsets={32} gap={12} />
      </View>

      {reviewQueue > 0 && (
        <View style={styles.calloutCard}>
          <AlertTriangle color={colors.warningDark} size={18} />
          <Text style={styles.calloutText}>
            {reviewQueue} attempt{reviewQueue === 1 ? '' : 's'} flagged (violations or moderate+ risk)
            {pending > 0 ? ` · ${pending} awaiting review` : ''}
            {' — '}open a row to review the full timeline.
          </Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>
        Attempts (highest risk first){rows.length > visibleRows.length ? ` · showing ${visibleRows.length} of ${rows.length}` : ''}
      </Text>
      {width < MOBILE_BREAKPOINT ? (
        <View>
          {visibleRows.map((row) => (
            <AttemptCard
              key={row.attemptId}
              row={row}
              onPress={onAttemptClick ? () => onAttemptClick(row.attemptId) : undefined}
            />
          ))}
        </View>
      ) : (
        <DataTable
          columns={columns}
          data={visibleRows}
          keyExtractor={(row) => row.attemptId}
          onRowPress={onAttemptClick ? (row) => onAttemptClick(row.attemptId) : undefined}
          rowAccessibilityLabel={(row) => `Open proctoring timeline for ${row.studentName}`}
          style={styles.tableCard}
        />
      )}

      {rows.length > ROWS_INITIAL && (
        <TouchableOpacity
          style={styles.showAllToggle}
          onPress={() => setShowAllRows((prev) => !prev)}
          accessibilityRole="button"
          accessibilityLabel={showAllRows ? 'Show fewer attempts' : `Show all ${rows.length} attempts`}
        >
          <Text style={styles.showAllText}>
            {showAllRows ? 'Show fewer' : `Show all ${rows.length} attempts`}
          </Text>
        </TouchableOpacity>
      )}

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
    borderColor: colors.border,
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
    marginHorizontal: 16,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 10 },
  emptyText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 19,
  },
  calloutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningTint,
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
    marginHorizontal: 16,
  },
  kpiWrap: { paddingHorizontal: 16 },
  calloutText: { fontSize: 12.5, color: '#92400E', marginLeft: 8, flex: 1, lineHeight: 17 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginTop: 22,
    marginBottom: 10,
    marginHorizontal: 16,
  },
  tableCard: { marginBottom: 4, marginHorizontal: 16 },
  showAllToggle: { alignItems: 'center', paddingVertical: 10, marginHorizontal: 16 },
  showAllText: { fontSize: 12, fontWeight: '700', color: colors.primaryDark },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
    marginHorizontal: 16,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    marginRight: 8,
  },
  cardReview: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  cardMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  metricChip: {
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 5,
    alignItems: 'center',
    minWidth: 58,
  },
  metricChipAlert: {
    backgroundColor: colors.dangerTint,
    borderColor: '#FECACA',
  },
  metricLabel: { fontSize: 10, fontWeight: '600', color: colors.textMuted },
  metricValue: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 1 },
  metricValueAlert: { color: colors.dangerDark },
  riskChip: {
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  riskChipText: { fontSize: 11.5, fontWeight: '700', textTransform: 'capitalize' },
  cellName: { fontSize: 13, fontWeight: '600', color: colors.text },
  cellNameWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardNameWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  guestBadge: {
    fontSize: 9.5,
    fontWeight: '700',
    color: colors.primaryDark,
    backgroundColor: colors.primaryTint,
    borderRadius: 6,
    paddingVertical: 1.5,
    paddingHorizontal: 5,
    overflow: 'hidden',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cellValue: { fontSize: 12.5, color: colors.textBody },
  cellValueAlert: { color: colors.dangerDark, fontWeight: '700' },
  cellValueOk: { color: colors.successDark, fontWeight: '600' },
  footnote: { fontSize: 11.5, color: colors.textMuted, marginTop: 12, marginBottom: 8, marginHorizontal: 16, lineHeight: 16 },
});

export default ProctoringOverview;
