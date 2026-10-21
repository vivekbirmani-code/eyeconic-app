/**
 * Pure display helpers for the ADMIN Proctoring Timeline section
 * (components/analytics/ProctoringTimelineSection.tsx, redesign approved
 * 2026-10-21). Mirrors the student card's discipline
 * (utils/proctoringSummaryFormat.ts): data-shaping only — no expo/native
 * imports, so this stays unit-testable in the root ts-jest (node)
 * environment.
 *
 * Reviewer-facing copy lives HERE, not in utils/proctoringCopy.ts — the D7
 * centralized-copy rule covers STUDENT-facing strings only (same split as
 * ProctoringOverview). Every count, label and classification below comes
 * from the server's timeline payload; this module never re-detects,
 * re-counts, or fabricates anything (§24 spirit).
 */

import { humanizeDuration } from './proctoringSummaryFormat';

/** Semantic tone for chips/accents — the component maps tones to theme tokens. */
export type TimelineTone = 'danger' | 'warning' | 'success' | 'info' | 'neutral';

/** Visual class of one event row (rail dot color + label emphasis). */
export type TimelineEventClass =
  | 'warning'
  | 'terminal'
  | 'integrity'
  | 'observation'
  | 'technical';

/**
 * Admin/mentor labels for proctoring event types (reviewer-facing, plan
 * §25.3 — observations, never verdicts). Unmapped types fall back to the raw
 * registry name — honest rather than guessed. (Moved verbatim from
 * AttemptDetailModal.tsx during the timeline-section extraction.)
 */
export const ADMIN_TIMELINE_LABELS: Record<string, string> = {
    SESSION_STARTED: 'Session started',
    SESSION_RESUMED: 'Session resumed',
    SESSION_CLOSED: 'Session closed',
    SESSION_DEGRADED: 'Session degraded',
    MODEL_UNAVAILABLE: 'Face monitoring unavailable',
    HEARTBEAT_GAP: 'Connection gap',
    CAMERA_UNAVAILABLE: 'Camera unavailable',
    CAMERA_PERMISSION_REVOKED: 'Camera permission lost',
    CAMERA_TRACK_ENDED: 'Camera stopped',
    CAMERA_FEED_DARK: 'Camera too dark',
    CAMERA_FEED_FROZEN: 'Camera frozen',
    FACE_NOT_DETECTED: 'Face not visible',
    FACE_PARTIALLY_VISIBLE: 'Face partly visible',
    FACE_OUT_OF_FRAME: 'Face out of frame',
    MULTIPLE_FACES_DETECTED: 'More than one face',
    HEAD_POSE_EXTREME: 'Head turned away (recorded)',
    HEAD_POSE_TURNED: 'Turned head away (recorded)',
    HEAD_POSE_REPEATED: 'Repeated head turns (recorded)',
    ATTENTION_DEVIATION_SUSTAINED: 'Attention deviation (recorded)',
    ATTENTION_DEVIATION_REPEATED: 'Repeated attention deviation (recorded)',
    TAB_HIDDEN: 'Tab hidden (web)',
    WINDOW_BLUR: 'Window lost focus (web)',
    APP_BACKGROUND: 'Left the test app',
    APP_INACTIVE: 'App inactive',
    EXIT_ATTEMPTED: 'Tried to exit',
    WARNING_DELIVERED: 'Warning shown',
    AUTO_SUBMITTED: 'Submitted automatically (policy)',
    POLICY_ACTION_SKIPPED: 'Policy action skipped',
};

/** §25.4 integrity statuses — full chip labels (title case). */
export const ADMIN_INTEGRITY_LABELS: Record<string, string> = {
    pending: 'Pending review',
    clean: 'Clean',
    reviewed_ok: 'Reviewed — OK',
    reviewed_concern: 'Reviewed — concern',
};

export interface AdminTimelineEvent {
    _id: string;
    type: string;
    category?: string | null;
    severity?: string | null;
    serverAt: string;
    durationMs?: number | null;
    metadata?: Record<string, unknown> | null;
}

export interface AdminEventRow {
    id: string;
    type: string;
    /** Resolved reviewer label (map first, raw type as the honest fallback). */
    label: string;
    serverAt: string;
    /** False for missing/unparseable timestamps — the row renders '—', never drops. */
    timeValid: boolean;
    /** Humanized duration chip text, or null when nothing worth showing. */
    duration: string | null;
    eventClass: TimelineEventClass;
    /** Secondary line (e.g. "Final warning", "Rule: focus.maxViolations"). */
    subLabel: string | null;
}

export interface AdminViolationRow {
    id: string;
    ruleId: string;
    reliability: string | null;
    action: string | null;
    reviewStatus: string | null;
}

export interface AdminTimelineViolation {
    _id?: string;
    ruleId?: string | null;
    reliability?: string | null;
    actionTaken?: { action?: string | null } | null;
    review?: { status?: string | null } | null;
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export const timestampValid = (iso?: string | null): boolean => {
    if (!iso) return false;
    const time = new Date(iso).getTime();
    return Number.isFinite(time);
};

/**
 * Visual class for one event. Type decides the two system actions (they were
 * already emphasized in the old UI); otherwise the server's registry category
 * decides. Unknown/missing categories default to the calm gray class —
 * never a scarier color than the data justifies.
 */
export const eventClassFor = (type: string, category?: string | null): TimelineEventClass => {
    if (type === 'WARNING_DELIVERED') return 'warning';
    if (type === 'AUTO_SUBMITTED') return 'terminal';
    if (category === 'integrity') return 'integrity';
    if (category === 'cv_observation') return 'observation';
    return 'technical'; // technical, remaining system_action, unknown
};

/** Risk band → chip tone. Bands mirror ProctoringOverview's RISK_CHIP_COLORS. */
export const riskTone = (riskCategory?: string | null): TimelineTone => {
    switch (riskCategory) {
        case 'normal': return 'success';
        case 'low': return 'info';
        case 'moderate': return 'warning';
        case 'high':
        case 'critical': return 'danger';
        default: return 'neutral';
    }
};

/** §25.4 integrity status → chip tone (pending stays calm gray). */
export const integrityTone = (integrityStatus?: string | null): TimelineTone => {
    switch (integrityStatus) {
        case 'clean':
        case 'reviewed_ok': return 'success';
        case 'reviewed_concern': return 'danger';
        default: return 'neutral'; // pending + unknown
    }
};

export interface AdminSummaryChip {
    key: 'violations' | 'risk' | 'integrity';
    label: string;
    tone: TimelineTone;
}

/**
 * The three header chips — engine output (violations), advisory triage
 * (risk), and human review state (integrity) stay visually distinct; the
 * section header shows them collapsed AND expanded.
 */
export const buildSummaryChips = (
    summary: { violationCount?: number | null; riskCategory?: string | null } | null | undefined,
    integrityStatus?: string | null
): AdminSummaryChip[] => {
    const violationCount = summary?.violationCount ?? 0;
    const risk = summary?.riskCategory ?? null;
    return [
        {
            key: 'violations',
            label: `${violationCount} violation${violationCount === 1 ? '' : 's'}`,
            tone: violationCount > 0 ? 'danger' : 'success',
        },
        {
            key: 'risk',
            label: `Risk: ${risk ? capitalize(risk) : 'unknown'}`,
            tone: riskTone(risk),
        },
        {
            key: 'integrity',
            label: (integrityStatus && (ADMIN_INTEGRITY_LABELS[integrityStatus] ?? capitalize(integrityStatus))) || 'Unknown',
            tone: integrityTone(integrityStatus),
        },
    ];
};

/**
 * Shapes the server's event list into renderable timeline rows: defensively
 * re-sorted by serverAt (the endpoint already sorts; this is a no-op safety
 * net), labels resolved, durations humanized, and the two metadata sub-lines
 * (final warning / auto-submit rule) promoted out of metadata.
 */
export const buildAdminEventRows = (events: AdminTimelineEvent[]): AdminEventRow[] =>
    (events ?? [])
        .filter((event) => event && event._id && event.type)
        .sort((a, b) => {
            const at = new Date(a.serverAt).getTime() || 0;
            const bt = new Date(b.serverAt).getTime() || 0;
            if (at !== bt) return at - bt;
            return String(a._id).localeCompare(String(b._id));
        })
        .map((event) => {
            let subLabel: string | null = null;
            if (event.type === 'WARNING_DELIVERED' && event.metadata?.code === 'warn.final') {
                subLabel = 'Final warning';
            } else if (event.type === 'AUTO_SUBMITTED' && event.metadata?.ruleId) {
                subLabel = `Rule: ${String(event.metadata.ruleId)}`;
            }
            return {
                id: event._id,
                type: event.type,
                label: ADMIN_TIMELINE_LABELS[event.type] ?? event.type,
                serverAt: event.serverAt,
                timeValid: timestampValid(event.serverAt),
                duration: humanizeDuration(event.durationMs ?? undefined),
                eventClass: eventClassFor(event.type, event.category),
                subLabel,
            };
        });

/** Shapes violation documents into compact rows (all fields payload-sourced). */
export const buildViolationRows = (violations: AdminTimelineViolation[]): AdminViolationRow[] =>
    (violations ?? [])
        .map((violation, index) => ({
            id: violation._id ? String(violation._id) : `violation-${index}`,
            ruleId: violation.ruleId ?? 'unknown rule',
            reliability: violation.reliability ?? null,
            action: violation.actionTaken?.action ?? null,
            reviewStatus: violation.review?.status ?? null,
        }));

export interface AdjustedScoreValidation {
    valid: boolean;
    error: string | null;
    /** Parsed pair to POST — null when nothing was entered (score is optional). */
    value: { adjustedScore: number; adjustedTotalMarks: number } | null;
}

/**
 * Client-side mirror of the server's /review validation (adjustedScore and
 * adjustedTotalMarks together, numeric, ≥ 0, score ≤ total) so mistakes cost
 * an inline hint instead of a server round-trip.
 */
export const validateAdjustedScore = (score: string, total: string): AdjustedScoreValidation => {
    const s = (score ?? '').trim();
    const t = (total ?? '').trim();
    if (!s && !t) return { valid: true, error: null, value: null };
    if (!s || !t) {
        return { valid: false, error: 'Enter both the adjusted score and the total marks.', value: null };
    }
    const scoreNum = Number(s);
    const totalNum = Number(t);
    if (!Number.isFinite(scoreNum) || !Number.isFinite(totalNum)) {
        return { valid: false, error: 'The adjusted score and total must be numbers.', value: null };
    }
    if (scoreNum < 0 || totalNum < 0) {
        return { valid: false, error: 'The adjusted score and total must be 0 or greater.', value: null };
    }
    if (scoreNum > totalNum) {
        return { valid: false, error: 'The adjusted score cannot exceed the total marks.', value: null };
    }
    return { valid: true, error: null, value: { adjustedScore: scoreNum, adjustedTotalMarks: totalNum } };
};
