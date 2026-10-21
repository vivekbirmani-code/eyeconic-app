/**
 * MonitoringSummaryCard — the student's OWN proctoring transparency card on
 * the result screen (AI Proctoring plan §25.1, Phase 7). Fetches the
 * owner-scoped timeline (the server already allows the attempt owner) and
 * renders a plain-English summary from centralized copy (D7 — no inline
 * student-facing strings, no risk jargon). Renders nothing for non-proctored
 * attempts (the 400 collapses the card) and shows nothing about any other
 * student — the payload is the owner's session alone.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ShieldCheck } from 'lucide-react-native';
import { api } from '@/services/api';
import { PROCTORING_COPY } from '@/utils/proctoringCopy';

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
  events?: Array<{ _id: string; type: string; serverAt: string; durationMs?: number }>;
}

/** Student-facing label for one event type — copy module first, prettified code as fallback. */
const eventLabel = (type: string): string =>
  PROCTORING_COPY.studentSummary.eventLabels[type]
  ?? `${type.charAt(0)}${type.slice(1).replace(/_/g, ' ').toLowerCase()}`;

const MonitoringSummaryCard: React.FC<MonitoringSummaryCardProps> = ({ quizId, attemptId }) => {
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

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
    return <ActivityIndicator size="small" color="#6D28D9" style={styles.loader} />;
  }
  if (!timeline?.summary) return null; // non-proctored attempt — no card

  const copy = PROCTORING_COPY.studentSummary;
  const counts = timeline.summary.eventCounts ?? {};
  const monitoredMinutes = Math.max(1, Math.round((timeline.summary.monitoredMs ?? 0) / 60000));

  const lines: Array<[string, number]> = [
    [copy.lines.leftApp, counts.APP_BACKGROUND || 0],
    [copy.lines.faceNotVisible, counts.FACE_NOT_DETECTED || 0],
    [copy.lines.multipleFaces, counts.MULTIPLE_FACES_DETECTED || 0],
    [copy.lines.headTurns, counts.HEAD_POSE_TURNED || 0],
    [copy.lines.cameraIssues,
      (counts.CAMERA_UNAVAILABLE || 0) + (counts.CAMERA_PERMISSION_REVOKED || 0)
      + (counts.CAMERA_TRACK_ENDED || 0) + (counts.CAMERA_FEED_DARK || 0)
      + (counts.CAMERA_FEED_FROZEN || 0) + (counts.MODEL_UNAVAILABLE || 0)],
    // The aggregate attention notes deliberately EXCLUDE HEAD_POSE_TURNED —
    // occurrences have their own line above; no double counting.
    [copy.lines.attentionNotes,
      (counts.HEAD_POSE_EXTREME || 0) + (counts.HEAD_POSE_REPEATED || 0)
      + (counts.ATTENTION_DEVIATION_SUSTAINED || 0) + (counts.ATTENTION_DEVIATION_REPEATED || 0)],
    [copy.lines.connectionGaps, counts.HEARTBEAT_GAP || 0],
  ];
  const hasAnyNote = lines.some(([, count]) => count > 0);
  const integrity = timeline.session?.integrityStatus;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <ShieldCheck color="#0D9488" size={18} />
        <Text style={styles.title}>{copy.title}</Text>
      </View>
      <Text style={styles.subtitle}>{copy.subtitle}</Text>

      <Text style={styles.metaLine}>
        {`${monitoredMinutes} min · `}
        {timeline.session?.status === 'CLOSED' ? copy.closedClean : copy.monitoredPartial}
      </Text>

      {integrity && copy.reviewed[integrity] ? (
        <Text style={styles.reviewedLine}>{copy.reviewed[integrity]}</Text>
      ) : null}

      {hasAnyNote ? (
        <View style={styles.notesWrap}>
          {lines.filter(([, count]) => count > 0).map(([label, count]) => (
            <Text key={label} style={styles.noteLine}>
              · {label}: {count}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={styles.cleanLine}>No monitoring notes were recorded.</Text>
      )}

      <TouchableOpacity
        style={styles.detailsToggle}
        onPress={() => setShowDetails((prev) => !prev)}
        accessibilityRole="button"
        accessibilityLabel={showDetails ? copy.hideDetails : copy.showDetails}
      >
        <Text style={styles.detailsToggleText}>
          {showDetails ? copy.hideDetails : copy.showDetails}
        </Text>
        <ChevronDown
          size={14}
          color="#6B7280"
          style={[styles.chevron, showDetails && { transform: [{ rotate: '180deg' }] }]}
        />
      </TouchableOpacity>

      {showDetails && (
        <View style={styles.detailsWrap}>
          {(timeline.events ?? [])
            .filter((event) => event.type !== 'SESSION_STARTED' && event.type !== 'SESSION_RESUMED')
            .map((event) => (
              <Text key={event._id} style={styles.detailLine}>
                {new Date(event.serverAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {' · '}{eventLabel(event.type)}
                {(event.durationMs ?? 0) > 0 ? ` · ${Math.round((event.durationMs ?? 0) / 1000)}s` : ''}
              </Text>
            ))}
          {(timeline.events ?? []).length === 0 && (
            <Text style={styles.detailLine}>—</Text>
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
    borderColor: '#E5E7EB',
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 14, fontWeight: '700', color: '#1F2937', marginLeft: 8 },
  subtitle: { fontSize: 12, color: '#6B7280', marginTop: 4, lineHeight: 17 },
  metaLine: { fontSize: 12.5, color: '#0D9488', fontWeight: '600', marginTop: 8 },
  reviewedLine: { fontSize: 12.5, color: '#374151', marginTop: 4 },
  notesWrap: { marginTop: 8 },
  noteLine: { fontSize: 12.5, color: '#374151', lineHeight: 19 },
  cleanLine: { fontSize: 12.5, color: '#059669', marginTop: 8, fontWeight: '600' },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  detailsToggleText: { fontSize: 12, color: '#6B7280', fontWeight: '600', marginRight: 4 },
  chevron: {},
  detailsWrap: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 8,
  },
  detailLine: { fontSize: 11.5, color: '#6B7280', lineHeight: 18 },
});

export default MonitoringSummaryCard;
