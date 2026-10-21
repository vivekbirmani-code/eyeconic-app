/**
 * ProctoringTimelineSection — the reviewer-facing proctoring block inside
 * AttemptDetailModal (AI Proctoring plan §25.3/§25.4; redesign approved
 * 2026-10-21). Extracted from AttemptDetailModal so it can live between
 * Section Performance and the Question-Level Report and stay independently
 * testable.
 *
 * Structure: header (title + stat chips, visible collapsed AND expanded) →
 * session meta → rail timeline of serverAt-ordered episode rows (capped for
 * long histories) → structured violations → review-of-record trail → admin
 * review decision (Confirm / Dismiss / Escalate + optional display-only
 * adjusted score). Lazy by design in one way only: the section never mounts
 * for non-proctored attempts (hasProctoring gates it in the parent).
 *
 * Stays INLINE in the parent modal — never a nested RN Modal (children of a
 * visible Modal are broken on both platforms) and never a nested scroll
 * container. Reviewer-facing copy lives in
 * utils/proctoringTimelineAdminFormat.ts; colors in utils/theme.ts.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { ChevronDown, ShieldAlert } from 'lucide-react-native';
import { api } from '@/services/api';
import { colors } from '@/utils/theme';
import { humanizeDuration } from '@/utils/proctoringSummaryFormat';
import {
    AdminEventRow,
    AdminSummaryChip,
    AdminTimelineEvent,
    AdminTimelineViolation,
    AdminViolationRow,
    TimelineEventClass,
    TimelineTone,
    buildAdminEventRows,
    buildSummaryChips,
    buildViolationRows,
    timestampValid,
    validateAdjustedScore,
} from '@/utils/proctoringTimelineAdminFormat';

/** Long histories render the first rows only — the timeline never eats the modal. */
const EVENT_ROW_CAP = 12;

/** Chip tones → theme tokens (one place; no per-chip hex). */
const TONE_BG: Record<TimelineTone, string> = {
    danger: colors.dangerTint,
    warning: colors.warningTint,
    success: colors.successTint,
    info: colors.primaryTint,
    neutral: colors.surfaceMuted,
};
const TONE_TEXT: Record<TimelineTone, string> = {
    danger: colors.dangerDark,
    warning: colors.warningDark,
    success: colors.successDark,
    info: colors.primaryDark,
    neutral: colors.textSecondary,
};
const TONE_BORDER: Record<TimelineTone, string> = {
    danger: '#FECACA',
    warning: '#FDE68A',
    success: '#A7F3D0',
    info: colors.primaryTintBorder,
    neutral: '#F3F4F6',
};

/** Rail node color per event class — the dots carry the color, labels stay calm. */
const EVENT_DOT: Record<TimelineEventClass, string> = {
    warning: colors.warning,
    terminal: colors.dangerDark,
    integrity: colors.danger,
    observation: colors.primary,
    technical: colors.textMuted,
};

interface TimelinePayload {
    session?: {
        status?: string;
        startedAt?: string | null;
        integrityStatus?: string;
        review?: { status?: string; reviewedAt?: string; note?: string | null } | null;
        reviewAdjustedScore?: { score?: number; totalMarks?: number } | null;
    } | null;
    autoSubmitReason?: string | null;
    summary?: {
        monitoredMs?: number | null;
        violationCount?: number | null;
        riskCategory?: string | null;
    } | null;
    events?: AdminTimelineEvent[];
    violations?: AdminTimelineViolation[];
}

interface ProctoringTimelineSectionProps {
    attemptId: string | null;
    /** Viewer role — Phase 7 (§25.4): only admins see the review actions. */
    userRole?: string;
}

const formatRowTime = (row: AdminEventRow) =>
    new Date(row.serverAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

export default function ProctoringTimelineSection({ attemptId, userRole }: ProctoringTimelineSectionProps) {
    const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
    const [timelineLoading, setTimelineLoading] = useState(false);
    const [showTimeline, setShowTimeline] = useState(false);
    const [showAllEvents, setShowAllEvents] = useState(false);
    // Phase 7 (§25.4) review state — admin actions on the closed session.
    const [reviewNote, setReviewNote] = useState('');
    const [adjustedScore, setAdjustedScore] = useState('');
    const [adjustedTotal, setAdjustedTotal] = useState('');
    const [reviewSubmitting, setReviewSubmitting] = useState(false);
    const [reviewError, setReviewError] = useState<string | null>(null);
    const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);
    const [showAdjustInputs, setShowAdjustInputs] = useState(false);

    const fetchTimeline = useCallback(async () => {
        if (!attemptId) return;
        setTimelineLoading(true);
        try {
            const response = await api.get(`/quizzes/attempt/${attemptId}/proctoring/timeline`);
            setTimeline(response.data?.timeline ?? null);
        } catch {
            // 400 = not a proctored attempt — the section stays hidden anyway.
            setTimeline(null);
        } finally {
            setTimelineLoading(false);
        }
    }, [attemptId]);

    // Fetch on mount so the collapsed header's stat chips are real without
    // forcing an expand (non-proctored attempts never mount this section).
    useEffect(() => {
        fetchTimeline();
    }, [fetchTimeline]);

    if (!attemptId) return null;

    const session = timeline?.session ?? null;
    const chips: AdminSummaryChip[] = timeline
        ? buildSummaryChips(timeline.summary ?? null, session?.integrityStatus)
        : [];
    const eventRows = timeline ? buildAdminEventRows(timeline.events ?? []) : [];
    const visibleEventRows = showAllEvents ? eventRows : eventRows.slice(0, EVENT_ROW_CAP);
    const violationRows: AdminViolationRow[] = timeline ? buildViolationRows(timeline.violations ?? []) : [];

    const monitored = humanizeDuration(timeline?.summary?.monitoredMs ?? undefined);
    const startedAtValid = Boolean(session?.startedAt) && timestampValid(session?.startedAt);
    const sessionMeta = [
        session?.status ? `Session ${session.status}` : null,
        monitored ? `${monitored} monitored` : null,
        startedAtValid
            ? `started ${new Date(session!.startedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : null,
        timeline?.autoSubmitReason ? 'auto-submitted (policy)' : null,
    ].filter(Boolean).join(' · ');

    // Client mirror of the server's /review rules — blocks submit with an
    // inline hint instead of a round-trip 400.
    const scoreValidation = showAdjustInputs
        ? validateAdjustedScore(adjustedScore, adjustedTotal)
        : { valid: true, error: null as string | null, value: null };
    const actionsDisabled = reviewSubmitting || !scoreValidation.valid;

    // Phase 7 (§25.4): record the human review decision of record. Marks are
    // NEVER altered — an optional adjusted score is stored display-only.
    const submitReview = async (decision: 'confirm' | 'dismiss' | 'escalate') => {
        if (reviewSubmitting) return;
        const validation = validateAdjustedScore(adjustedScore, adjustedTotal);
        if (!validation.valid) {
            setReviewError(validation.error);
            return;
        }
        setReviewSubmitting(true);
        setReviewError(null);
        setReviewSuccess(null);
        try {
            await api.post(`/quizzes/attempt/${attemptId}/proctoring/review`, {
                decision,
                ...(reviewNote.trim() ? { note: reviewNote.trim() } : {}),
                ...(validation.value ?? {}),
            });
            await fetchTimeline();
            setReviewNote('');
            setAdjustedScore('');
            setAdjustedTotal('');
            setShowAdjustInputs(false);
            setReviewSuccess(
                decision === 'confirm' ? 'Review recorded — concern confirmed'
                    : decision === 'dismiss' ? 'Review recorded — concerns dismissed'
                        : 'Review recorded — escalated'
            );
        } catch (error: any) {
            setReviewError(error?.response?.data?.message ?? 'Could not record the review.');
        } finally {
            setReviewSubmitting(false);
        }
    };

    return (
        <View style={styles.container}>
            <TouchableOpacity
                style={styles.header}
                onPress={() => setShowTimeline((prev) => !prev)}
                accessibilityRole="button"
                accessibilityLabel="Toggle proctoring timeline"
                accessibilityState={{ expanded: showTimeline }}
            >
                <View style={styles.headerRow}>
                    <ShieldAlert size={16} color={colors.primaryDark} />
                    <Text style={styles.title}>Proctoring Timeline</Text>
                    <ChevronDown
                        size={16}
                        color={colors.textMuted}
                        style={[styles.chevron, showTimeline && styles.chevronUp]}
                    />
                </View>
                {timelineLoading && !timeline ? (
                    <ActivityIndicator size="small" color={colors.primary} style={styles.headerLoader} />
                ) : chips.length > 0 ? (
                    <View style={styles.chipRow}>
                        {chips.map((chip) => (
                            <View
                                key={chip.key}
                                style={[
                                    styles.chip,
                                    { backgroundColor: TONE_BG[chip.tone], borderColor: TONE_BORDER[chip.tone] },
                                ]}
                            >
                                <Text style={[styles.chipText, { color: TONE_TEXT[chip.tone] }]} numberOfLines={1}>
                                    {chip.label}
                                </Text>
                            </View>
                        ))}
                    </View>
                ) : null}
            </TouchableOpacity>

            {showTimeline && (
                <View style={styles.body}>
                    {timelineLoading && !timeline && (
                        <ActivityIndicator size="small" color={colors.primaryDark} style={styles.bodyLoader} />
                    )}
                    {!timelineLoading && !timeline && (
                        <Text style={styles.empty}>No proctoring timeline available for this attempt.</Text>
                    )}
                    {timeline && (
                        <>
                            {sessionMeta ? <Text style={styles.metaLine}>{sessionMeta}</Text> : null}

                            {eventRows.length === 0 ? (
                                <Text style={styles.empty}>No events recorded for this session.</Text>
                            ) : (
                                <View>
                                    {visibleEventRows.map((row, index) => (
                                        <View
                                            key={row.id}
                                            style={styles.eventRow}
                                            accessible
                                            accessibilityRole="text"
                                            accessibilityLabel={`${row.label}${row.duration ? `, ${row.duration}` : ''}${row.timeValid ? `, ${formatRowTime(row)}` : ''}`}
                                        >
                                            <Text style={styles.eventTime}>
                                                {row.timeValid ? formatRowTime(row) : '—'}
                                            </Text>
                                            <View style={styles.rail}>
                                                <View style={[styles.dot, { backgroundColor: EVENT_DOT[row.eventClass] }]} />
                                                {index < visibleEventRows.length - 1 && <View style={styles.railLine} />}
                                            </View>
                                            <View style={styles.eventMain}>
                                                <View style={styles.eventLabelRow}>
                                                    <Text
                                                        style={[
                                                            styles.eventLabel,
                                                            row.eventClass === 'warning' && styles.eventLabelWarn,
                                                            row.eventClass === 'terminal' && styles.eventLabelFinal,
                                                        ]}
                                                        numberOfLines={2}
                                                    >
                                                        {row.label}
                                                    </Text>
                                                    {row.duration ? (
                                                        <View style={styles.durationChip}>
                                                            <Text style={styles.durationText}>{row.duration}</Text>
                                                        </View>
                                                    ) : null}
                                                </View>
                                                {row.subLabel ? <Text style={styles.subLabel}>{row.subLabel}</Text> : null}
                                            </View>
                                        </View>
                                    ))}
                                    {eventRows.length > EVENT_ROW_CAP && (
                                        <TouchableOpacity
                                            style={styles.showAllToggle}
                                            onPress={() => setShowAllEvents((prev) => !prev)}
                                            accessibilityRole="button"
                                            accessibilityLabel={showAllEvents ? 'Show fewer events' : `Show all ${eventRows.length} events`}
                                        >
                                            <Text style={styles.showAllText}>
                                                {showAllEvents ? 'Show fewer' : `Show all (${eventRows.length})`}
                                            </Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            )}

                            {violationRows.length > 0 && (
                                <View style={styles.block}>
                                    <Text style={styles.blockTitle}>Violations</Text>
                                    {violationRows.map((row) => (
                                        <View key={row.id} style={styles.violationRow}>
                                            <Text style={styles.violationRule} numberOfLines={1}>{row.ruleId}</Text>
                                            <Text style={styles.violationMeta}>
                                                {[
                                                    row.reliability,
                                                    row.action ? `action ${row.action}` : null,
                                                    row.reviewStatus ? `review ${row.reviewStatus}` : null,
                                                ].filter(Boolean).join(' · ')}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            )}

                            {/* §25.4 review trail — the decision of record. */}
                            {session?.review?.status && (
                                <View style={styles.trailCard}>
                                    <Text style={styles.blockTitle}>Review of record</Text>
                                    <Text style={styles.trailLine}>
                                        {session.review.status}
                                        {session.review.reviewedAt && timestampValid(session.review.reviewedAt)
                                            ? ` · ${new Date(session.review.reviewedAt).toLocaleString([], {
                                                dateStyle: 'medium',
                                                timeStyle: 'short',
                                            })}`
                                            : ''}
                                    </Text>
                                    {session.review.note ? (
                                        <Text style={styles.trailNote}>"{session.review.note}"</Text>
                                    ) : null}
                                    {session.reviewAdjustedScore && (
                                        <Text style={styles.trailAdjusted}>
                                            Adjusted score (display only): {session.reviewAdjustedScore.score}
                                            {' / '}{session.reviewAdjustedScore.totalMarks}
                                        </Text>
                                    )}
                                </View>
                            )}

                            {/* §25.4 review actions — admins only, closed sessions only. */}
                            {userRole === 'admin'
                                && session?.status
                                && !['ACTIVE', 'DEGRADED'].includes(session.status) && (
                                <View style={styles.reviewPanel}>
                                    <View style={styles.reviewTitleRow}>
                                        <Text style={styles.reviewTitle}>Review decision</Text>
                                        {reviewSubmitting && (
                                            <ActivityIndicator size="small" color={colors.primaryDark} />
                                        )}
                                    </View>
                                    {reviewError && <Text style={styles.reviewError}>{reviewError}</Text>}
                                    {reviewSuccess && <Text style={styles.reviewSuccess}>{reviewSuccess}</Text>}
                                    <TextInput
                                        style={styles.noteInput}
                                        placeholder="Note (optional, e.g. sibling walked by)"
                                        placeholderTextColor="#9CA3AF"
                                        value={reviewNote}
                                        onChangeText={(text) => { setReviewNote(text); setReviewSuccess(null); }}
                                        multiline
                                        maxLength={1000}
                                    />
                                    <TouchableOpacity
                                        style={styles.adjustToggle}
                                        onPress={() => setShowAdjustInputs((prev) => !prev)}
                                    >
                                        <Text style={styles.adjustToggleText}>
                                            {showAdjustInputs ? '- Hide adjusted score' : '+ Record adjusted score (optional)'}
                                        </Text>
                                    </TouchableOpacity>
                                    {showAdjustInputs && (
                                        <View>
                                            <View style={styles.adjustRow}>
                                                <TextInput
                                                    style={styles.adjustInput}
                                                    placeholder="Score"
                                                    placeholderTextColor="#9CA3AF"
                                                    value={adjustedScore}
                                                    onChangeText={(text) => { setAdjustedScore(text); setReviewSuccess(null); }}
                                                    keyboardType="numeric"
                                                />
                                                <Text style={styles.adjustSlash}>/</Text>
                                                <TextInput
                                                    style={styles.adjustInput}
                                                    placeholder="Total"
                                                    placeholderTextColor="#9CA3AF"
                                                    value={adjustedTotal}
                                                    onChangeText={(text) => { setAdjustedTotal(text); setReviewSuccess(null); }}
                                                    keyboardType="numeric"
                                                />
                                            </View>
                                            {scoreValidation.error && (
                                                <Text style={styles.adjustError}>{scoreValidation.error}</Text>
                                            )}
                                        </View>
                                    )}
                                    <Text style={styles.adjustHint}>
                                        Display only — the original marks are never changed.
                                    </Text>
                                    <View style={styles.buttonRow}>
                                        <TouchableOpacity
                                            style={[styles.button, styles.buttonConfirm, actionsDisabled && styles.buttonDisabled]}
                                            onPress={() => submitReview('confirm')}
                                            disabled={actionsDisabled}
                                            accessibilityRole="button"
                                            accessibilityLabel="Confirm proctoring concerns"
                                        >
                                            <Text style={[styles.buttonText, styles.buttonTextConfirm]}>Confirm</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.button, styles.buttonDismiss, actionsDisabled && styles.buttonDisabled]}
                                            onPress={() => submitReview('dismiss')}
                                            disabled={actionsDisabled}
                                            accessibilityRole="button"
                                            accessibilityLabel="Dismiss proctoring concerns"
                                        >
                                            <Text style={[styles.buttonText, styles.buttonTextDismiss]}>Dismiss</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.button, styles.buttonEscalate, actionsDisabled && styles.buttonDisabled]}
                                            onPress={() => submitReview('escalate')}
                                            disabled={actionsDisabled}
                                            accessibilityRole="button"
                                            accessibilityLabel="Escalate proctoring concerns"
                                        >
                                            <Text style={[styles.buttonText, styles.buttonTextEscalate]}>Escalate</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}
                        </>
                    )}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        // Same page grid as the modal's sibling sections (score card,
        // metrics, tables): margin 16 keeps the section-card rhythm.
        margin: 16,
        overflow: 'hidden',
    },
    header: {
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {
        fontSize: 13,
        fontWeight: '700',
        color: colors.primaryDark,
        marginLeft: 6,
        flex: 1,
    },
    chevron: {},
    chevronUp: { transform: [{ rotate: '180deg' }] },
    headerLoader: { marginTop: 8, alignSelf: 'flex-start' },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 8,
    },
    chip: {
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    chipText: { fontSize: 11, fontWeight: '700' },
    body: {
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    bodyLoader: { paddingVertical: 12 },
    metaLine: { fontSize: 11, color: colors.textSecondary, marginBottom: 8 },
    empty: { fontSize: 12, color: colors.textSecondary, paddingVertical: 6 },
    eventRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    eventTime: {
        fontSize: 10.5,
        color: colors.textMuted,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        width: 56,
        marginTop: 2,
        textAlign: 'right',
        marginRight: 8,
    },
    rail: {
        width: 14,
        alignItems: 'center',
        alignSelf: 'stretch',
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginTop: 4,
    },
    railLine: {
        width: 2,
        flex: 1,
        backgroundColor: '#E5E7EB',
        marginTop: 2,
    },
    eventMain: {
        flex: 1,
        paddingBottom: 10,
    },
    eventLabelRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },
    eventLabel: {
        fontSize: 12,
        color: colors.textBody,
        flex: 1,
        lineHeight: 16,
    },
    eventLabelWarn: { color: '#92400E', fontWeight: '600' },
    eventLabelFinal: { color: '#B91C1C', fontWeight: '700' },
    durationChip: {
        backgroundColor: '#F3F4F6',
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
        marginTop: 1,
        flexShrink: 0,
    },
    durationText: { fontSize: 10.5, fontWeight: '600', color: colors.textMuted },
    subLabel: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
    showAllToggle: { alignItems: 'center', paddingVertical: 8, paddingLeft: 78 },
    showAllText: { fontSize: 12, fontWeight: '700', color: colors.primaryDark },
    block: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
    blockTitle: { fontSize: 12.5, fontWeight: '700', color: colors.text, marginBottom: 6 },
    violationRow: { paddingVertical: 4 },
    violationRule: { fontSize: 12, fontWeight: '600', color: colors.textBody },
    violationMeta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
    trailCard: {
        backgroundColor: colors.surfaceMuted,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 10,
        marginTop: 10,
    },
    trailLine: { fontSize: 12, color: colors.textBody, textTransform: 'capitalize' },
    trailNote: { fontSize: 12, color: colors.textSecondary, marginTop: 4, fontStyle: 'italic' },
    trailAdjusted: { fontSize: 12, color: colors.primaryDark, marginTop: 4, fontWeight: '600' },
    reviewPanel: {
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        marginTop: 12,
        paddingTop: 12,
    },
    reviewTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 6,
    },
    reviewTitle: { fontSize: 12.5, fontWeight: '700', color: colors.text },
    reviewError: { fontSize: 12, color: colors.dangerDark, marginBottom: 6 },
    reviewSuccess: { fontSize: 12, color: colors.successDark, marginBottom: 6, fontWeight: '600' },
    noteInput: {
        borderWidth: 1,
        borderColor: colors.borderStrong,
        borderRadius: 8,
        padding: 8,
        backgroundColor: '#FFF',
        fontSize: 12.5,
        color: colors.text,
        minHeight: 36,
        textAlignVertical: 'top',
    },
    adjustToggle: { marginTop: 8, alignSelf: 'flex-start' },
    adjustToggleText: { fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
    adjustRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
    adjustInput: {
        borderWidth: 1,
        borderColor: colors.borderStrong,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        fontSize: 12.5,
        color: colors.text,
        backgroundColor: '#FFF',
        width: 90,
    },
    adjustSlash: { fontSize: 13, color: colors.textMuted, marginHorizontal: 8 },
    adjustError: { fontSize: 11, color: colors.dangerDark, marginTop: 4 },
    adjustHint: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
    buttonRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    button: {
        flex: 1,
        borderRadius: 8,
        paddingVertical: 9,
        alignItems: 'center',
        borderWidth: 1,
    },
    buttonDisabled: { opacity: 0.5 },
    buttonConfirm: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
    buttonDismiss: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
    buttonEscalate: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
    buttonText: { fontSize: 12.5, fontWeight: '700' },
    buttonTextConfirm: { color: colors.dangerDark },
    buttonTextDismiss: { color: colors.successDark },
    buttonTextEscalate: { color: colors.warningDark },
});
