/**
 * Pure display helpers for the student-facing Monitoring Summary
 * (components/proctoring/MonitoringSummaryCard.tsx, plan approved
 * 2026-10-21). Data-shaping only — no expo/native imports so this stays
 * unit-testable in the root ts-jest (node) environment.
 *
 * Every count and event here comes from the server's timeline payload; this
 * module never re-detects, re-counts, or fabricates anything (§24 spirit —
 * the same discipline as services/proctoring/*).
 */

import { PROCTORING_COPY } from './proctoringCopy';

/** Display buckets for event-history rows (colors live in the component). */
export type MonitoringEventCategory = 'warning' | 'attention' | 'other';

/** Detail rows never render these bookkeeping types (noise for students). */
const HIDDEN_DETAIL_TYPES = new Set(['SESSION_STARTED', 'SESSION_RESUMED', 'SESSION_CLOSED']);

/**
 * One shaped detail row ready for rendering — no React, no Date formatting
 * (the component renders `serverAt` locally).
 */
export interface MonitoringDetailRow {
  id: string;
  type: string;
  serverAt: string;
  durationMs?: number;
  category: MonitoringEventCategory;
  /** Resolved student-facing label (copy module first, prettified fallback). */
  label: string;
}

/** One collapsed-state stat chip (count + copy key; zero-counts suppressed). */
export interface MonitoringStatChip {
  key: keyof typeof PROCTORING_COPY.studentSummary.chipLabels
    | (string & {});
  count: number;
}

/** Buckets an event type for dot/tint styling. Warnings tint the whole row. */
export const eventCategory = (type: string): MonitoringEventCategory => {
  if (type === 'WARNING_DELIVERED' || type === 'AUTO_SUBMITTED') return 'warning';
  if (type.startsWith('HEAD_POSE_') || type.startsWith('ATTENTION_')) return 'attention';
  return 'other';
};

/**
 * Humanizes a duration for row display: "45s", "2m 19s", "1h 2m".
 * Returns null when there is nothing worth showing (absent / under 1s) —
 * the component then omits the chip entirely (never a meaningless "0s").
 */
export const humanizeDuration = (ms?: number | null): string | null => {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 1000) return null;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
};

/**
 * Collapsed-state stat chips from the server's eventCounts — the same
 * categories the summary always showed, now scannable. Zero-count entries
 * are suppressed; order is stable (most action-relevant first).
 * HEAD_POSE_TURNED (occurrences) stays separate from the aggregate attention
 * notes — no double counting.
 */
export const buildStatChips = (counts: Record<string, number>): MonitoringStatChip[] => {
  const cameraIssues =
    (counts.CAMERA_UNAVAILABLE || 0) + (counts.CAMERA_PERMISSION_REVOKED || 0)
    + (counts.CAMERA_TRACK_ENDED || 0) + (counts.CAMERA_FEED_DARK || 0)
    + (counts.CAMERA_FEED_FROZEN || 0) + (counts.MODEL_UNAVAILABLE || 0);
  const otherAttention =
    (counts.HEAD_POSE_EXTREME || 0) + (counts.HEAD_POSE_REPEATED || 0)
    + (counts.ATTENTION_DEVIATION_SUSTAINED || 0) + (counts.ATTENTION_DEVIATION_REPEATED || 0);
  const chips: MonitoringStatChip[] = [
    { key: 'leftApp', count: counts.APP_BACKGROUND || 0 },
    { key: 'faceNotVisible', count: counts.FACE_NOT_DETECTED || 0 },
    { key: 'multipleFaces', count: counts.MULTIPLE_FACES_DETECTED || 0 },
    { key: 'headTurns', count: counts.HEAD_POSE_TURNED || 0 },
    { key: 'cameraIssues', count: cameraIssues },
    { key: 'attentionNotes', count: otherAttention },
    { key: 'connectionGaps', count: counts.HEARTBEAT_GAP || 0 },
  ];
  return chips.filter((chip) => chip.count > 0);
};

/** Student-facing label for one event type — copy module first, honest fallback. */
export const eventLabelFor = (type: string): string =>
  PROCTORING_COPY.studentSummary.eventLabels[type]
  ?? `${type.charAt(0)}${type.slice(1).replace(/_/g, ' ').toLowerCase()}`;

/**
 * Shapes the server's event list into renderable detail rows: hides the
 * bookkeeping types, resolves labels, and enriches WARNING_DELIVERED rows
 * with WHICH warning it was (metadata.code → copy), so a warning row says
 * "Heads-up: focus on the screen" instead of a generic phrase.
 */
export const buildDetailRows = (
  events: Array<{
    _id: string;
    type: string;
    serverAt: string;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  }>
): MonitoringDetailRow[] =>
  events
    .filter((event) => !HIDDEN_DETAIL_TYPES.has(event.type))
    .map((event) => {
      const category = eventCategory(event.type);
      let label = eventLabelFor(event.type);
      if (event.type === 'WARNING_DELIVERED') {
        const code = typeof event.metadata?.code === 'string' ? event.metadata.code : null;
        label = (code && PROCTORING_COPY.studentSummary.warningDetails[code])
          ?? PROCTORING_COPY.studentSummary.eventLabels.WARNING_DELIVERED;
      }
      return {
        id: event._id,
        type: event.type,
        serverAt: event.serverAt,
        durationMs: event.durationMs,
        category,
        label,
      };
    });
