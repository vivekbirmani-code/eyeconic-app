/**
 * MonitoringSummaryCard — the student's OWN proctoring transparency card on
 * the result screen (AI Proctoring plan §25.1, Phase 7; UI overhaul
 * approved 2026-10-21). Fetches the owner-scoped timeline (the server
 * already allows the attempt owner) and renders a collapsed at-a-glance
 * summary (status chip + stat chips) with an expandable, capped event
 * history. All copy lives in utils/proctoringCopy.ts (D7); display shaping
 * lives in utils/proctoringSummaryFormat.ts; colors in utils/theme.ts.
 *
 * Renders nothing for non-proctored attempts (the 400 collapses the card)
 * and shows nothing about any other student — the payload is the owner's
 * session alone.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ShieldCheck } from 'lucide-react-native';
import { api } from '@/services/api';
import { colors } from '@/utils/theme';
import { PROCTORING_COPY } from '@/utils/proctoringCopy';
import {
  buildDetailRows,
  buildStatChips,
  humanizeDuration,
} from '@/utils/proctoringSummaryFormat';

/** Long histories render the first rows only — the card never eats the page. */
const DETAIL_ROW_CAP = 10;

/** Category dot colors (warning rows additionally tint their whole row). */
const CATEGORY_DOT: Record<string, string> = {
  warning: colors.warningDark,
  attention: colors.primaryDark,
  other: colors.textMuted,
};

interface MonitoringSummaryCardProps {
  quizId: string;
  attemptId: string;
}

interface TimelinePayload {
  session?: {
    status?: string;
    integrityStatus?: string;
  };
  summary?: {
    monitoredMs?: number;
    eventCounts?: Record<string, number>;
  };
  events?: Array<{
    _id: string;
    type: string;
    serverAt: string;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  }>;
}

const MonitoringSummaryCard: React.FC<MonitoringSummaryCardProps> = ({ quizId, attemptId }) => {
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get(
          `/quizzes/attempt/${attemptId}/proctoring/timeline`
        );
        if (!cancelled) setTimeline(response.data?.timeline ?? null);
      } catch {
        // 400 = not a proctored attempt (or not finalized yet) — stay hidden.
        if (!cancelled) setTimeline(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [attemptId]);

  if (loading) {
    return <ActivityIndicator size="small" color={colors.primary} style={styles.loader} />;
  }
  if (!timeline?.summary) return null; // non-proctored attempt — no card

  const copy = PROCTORING_COPY.studentSummary;
  const chips = buildStatChips(timeline.summary.eventCounts ?? {});
  const detailRows = buildDetailRows(timeline.events ?? []);
  const monitoredMinutes = Math.max(1, Math.round((timeline.summary.monitoredMs ?? 0) / 60000));
  const closedNormally = timeline.session?.status === 'CLOSED';
  const integrity = timeline.session?.integrityStatus;
  const visibleRows = showAllEvents ? detailRows : detailRows.slice(0, DETAIL_ROW_CAP);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <ShieldCheck color={colors.primaryDark} size={18} />
        <Text style={styles.title}>{copy.title}</Text>
        <View style={[styles.statusChip, closedNormally ? styles.statusChipOk : styles.statusChipWarn]}>
          <Text style={[styles.statusChipText, closedNormally ? styles.statusChipTextOk : styles.statusChipTextWarn]}>
            {closedNormally ? copy.statusClosed : copy.statusInterrupted}
          </Text>
        </View>
      </View>
      <Text style={styles.subtitle}>{copy.subtitle}</Text>

      {chips.length > 0 ? (
        <>
          <View style={styles.chipRow}>
            {chips.map((chip) => (
              <View
                key={chip.key}
                style={styles.chip}
                accessible
                accessibilityRole="text"
                accessibilityLabel={`${copy.chipLabels[chip.key]}: ${chip.count}`}
              >
                <Text style={styles.chipCount}>{chip.count}</Text>
                <Text style={styles.chipLabel}>{copy.chipLabels[chip.key]}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.metaLine}>
            {copy.monitored.replace('{minutes}', String(monitoredMinutes))}
          </Text>
        </>
      ) : (
        <Text style={styles.cleanLine}>{copy.noNotes}</Text>
      )}

      {integrity && copy.reviewed[integrity] ? (
        <Text style={styles.reviewedLine}>{copy.reviewed[integrity]}</Text>
      ) : null}

      {detailRows.length > 0 && (
        <TouchableOpacity
          style={styles.toggle}
          onPress={() => setShowDetails((prev) => !prev)}
          accessibilityRole="button"
          accessibilityLabel={showDetails ? copy.hideDetails : copy.showDetails}
          accessibilityState={{ expanded: showDetails }}
        >
          <Text style={styles.toggleText}>
            {showDetails ? copy.hideDetails : copy.showDetails}
            {' ('}{detailRows.length}{')'}
          </Text>
          <ChevronDown
            size={16}
            color={colors.textMuted}
            style={[styles.chevron, showDetails && styles.chevronUp]}
          />
        </TouchableOpacity>
      )}

      {showDetails && (
        <View style={styles.detailsWrap}>
          {visibleRows.map((row) => {
            const duration = humanizeDuration(row.durationMs);
            const isWarning = row.category === 'warning';
            const time = new Date(row.serverAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <View
                key={row.id}
                style={[styles.eventRow, isWarning && styles.eventRowWarning]}
                accessible
                accessibilityRole="text"
                accessibilityLabel={`${row.label}${duration ? `, ${duration}` : ''}, ${time}`}
              >
                <Text style={styles.eventTime}>{time}</Text>
                <View
                  style={[
                    styles.eventDot,
                    { backgroundColor: CATEGORY_DOT[row.category] ?? colors.textMuted },
                  ]}
                />
                <Text
                  style={[styles.eventLabel, isWarning && styles.eventLabelWarning]}
                  numberOfLines={2}
                >
                  {row.label}
                </Text>
                {duration ? <Text style={styles.eventDuration}>{duration}</Text> : null}
              </View>
            );
          })}
          {detailRows.length > DETAIL_ROW_CAP && (
            <TouchableOpacity
              style={styles.showAllToggle}
              onPress={() => setShowAllEvents((prev) => !prev)}
              accessibilityRole="button"
              accessibilityLabel={
                showAllEvents
                  ? copy.showFewerEvents
                  : copy.showAllEvents.replace('{count}', String(detailRows.length))
              }
            >
              <Text style={styles.showAllText}>
                {showAllEvents
                  ? copy.showFewerEvents
                  : copy.showAllEvents.replace('{count}', String(detailRows.length))}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  loader: { marginVertical: 12 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
    // Keeps the KPI grid below from touching the card (matches the screen's
    // 16px card-separation rhythm; constant whether collapsed or expanded).
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: { fontSize: 14, fontWeight: '700', color: colors.text, marginLeft: 8, flex: 1 },
  statusChip: {
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginLeft: 8,
    flexShrink: 0,
  },
  statusChipOk: { backgroundColor: colors.successTint },
  statusChipWarn: { backgroundColor: colors.warningTint },
  statusChipText: { fontSize: 11, fontWeight: '700' },
  statusChipTextOk: { color: colors.successDark },
  statusChipTextWarn: { color: colors.warningDark },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 17 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipCount: { fontSize: 15, fontWeight: '800', color: colors.text },
  chipLabel: { fontSize: 10.5, fontWeight: '600', color: colors.textMuted, marginLeft: 5 },
  metaLine: { fontSize: 12, color: colors.textSecondary, marginTop: 10 },
  cleanLine: { fontSize: 12.5, color: colors.successDark, marginTop: 10, fontWeight: '600' },
  reviewedLine: { fontSize: 12.5, color: colors.textBody, marginTop: 6 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    marginTop: 12,
    paddingVertical: 12,
  },
  toggleText: { fontSize: 12, color: colors.textSecondary, fontWeight: '700' },
  chevron: {},
  chevronUp: { transform: [{ rotate: '180deg' }] },
  detailsWrap: {
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 4,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  eventRowWarning: {
    backgroundColor: colors.warningTint,
    borderBottomWidth: 0,
  },
  eventTime: {
    fontSize: 11,
    color: colors.textMuted,
    width: 62,
    marginTop: 2,
  },
  eventDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
    marginRight: 8,
    flexShrink: 0,
  },
  eventLabel: {
    fontSize: 12.5,
    color: colors.textBody,
    flex: 1,
    lineHeight: 17,
  },
  eventLabelWarning: { color: '#92400E', fontWeight: '600' },
  eventDuration: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    marginLeft: 8,
    marginTop: 2,
    flexShrink: 0,
  },
  showAllToggle: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  showAllText: { fontSize: 12, fontWeight: '700', color: colors.primaryDark },
});

export default MonitoringSummaryCard;
