import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    Modal,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    Platform,
    StatusBar,
    TextInput
} from 'react-native';
import { X, CheckCircle, XCircle, MinusCircle, Clock, Award, BarChart3, FileText, ChevronDown, ShieldAlert } from 'lucide-react-native';
import { api } from '@/services/api';
import { DataTable, DataTableColumn } from '@/components/DataTable';

interface AttemptDetailModalProps {
    attemptId: string | null;
    visible: boolean;
    onClose: () => void;
    /** Viewer role — Phase 7 (§25.4): only admins see the review actions. */
    userRole?: string;
}

type GroupBy = 'section' | 'subject' | 'topic' | 'tag';

const GROUP_BY_OPTIONS: Array<{ value: GroupBy; label: string; rowLabel: string }> = [
    { value: 'section', label: 'By Section', rowLabel: 'Section' },
    { value: 'subject', label: 'By Subject', rowLabel: 'Subject' },
    { value: 'topic', label: 'By Topic', rowLabel: 'Topic' },
    { value: 'tag', label: 'By Tag', rowLabel: 'Tag' },
];

/**
 * Admin/mentor labels for proctoring event types (reviewer-facing, plan
 * §25.3 — observations, never verdicts; student-facing copy lives in
 * utils/proctoringCopy.ts instead). Unmapped types fall back to the raw
 * registry name — honest rather than guessed.
 */
const TIMELINE_LABELS: Record<string, string> = {
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

/** §25.4 integrity statuses, chip-length for the timeline header. */
const INTEGRITY_SHORT: Record<string, string> = {
    pending: 'pending review',
    clean: 'clean',
    reviewed_ok: 'reviewed OK',
    reviewed_concern: 'reviewed concern',
};

interface AttemptDetail {
    summary?: {
        correct: number;
        incorrect: number;
        skipped: number;
        attempted: number;
        totalQuestions: number;
        marksObtained: number;
        totalMarks: number;
        scorePercentage: number | null;
        accuracy: number | null;
        markedForReviewCount: number;
        timeTakenSeconds: number;
    };
    attempt: {
        _id: string;
        status: string;
        startTime: string;
        endTime: string;
        score: number;
        totalQuestions: number;
        marksObtained: number;
        totalMarks: number;
        sectionPerformance: Array<{
            sectionName: string;
            correct: number;
            incorrect: number;
            skipped: number;
            timeSpent: number;
            accuracy?: number;
        }>;
        tabSwitchCount: number;
        retestRequested?: boolean;
        retestApproved?: boolean;
    };
    quiz: {
        _id: string;
        title: string;
        subject: any;
        testType: string;
        shareSolution: boolean;
        totalQuestions: number; // Ensure this is available or derived
    };
    student: {
        _id: string;
        name: string;
        email: string | null;
        // Guest-attempt lead fields (admin-only guest fallback)
        phone?: string | null;
        emailVerified?: boolean;
        phoneVerified?: boolean;
        marketingConsent?: boolean;
    };
    // 'guest' when this attempt is a public-quiz participant (admin view)
    participantType?: 'registered' | 'guest';
    questions: any[];
}

export default function AttemptDetailModal({ attemptId, visible, onClose, userRole }: AttemptDetailModalProps) {
    const [loading, setLoading] = useState(false);
    const [attemptData, setAttemptData] = useState<AttemptDetail | null>(null);
    const [groupBy, setGroupBy] = useState<GroupBy>('section');
    const [showDropdown, setShowDropdown] = useState(false);
    // ===== Proctoring timeline (Phase 7-lite) — rendered only for proctored
    // attempts (the resync hint decides) and loaded lazily on first expand. =====
    const [hasProctoring, setHasProctoring] = useState(false);
    const [showTimeline, setShowTimeline] = useState(false);
    const [timelineLoading, setTimelineLoading] = useState(false);
    // Phase 7 (§25.4) review state — admin actions on the closed session.
    const [reviewNote, setReviewNote] = useState('');
    const [adjustedScore, setAdjustedScore] = useState('');
    const [adjustedTotal, setAdjustedTotal] = useState('');
    const [reviewSubmitting, setReviewSubmitting] = useState(false);
    const [reviewError, setReviewError] = useState<string | null>(null);
    const [showAdjustInputs, setShowAdjustInputs] = useState(false);
    const [timeline, setTimeline] = useState<any | null>(null);

    useEffect(() => {
        if (visible && attemptId) {
            fetchAttemptDetails();
        }
    }, [visible, attemptId]);

    useEffect(() => {
        if (visible && attemptId && attemptData) {
            fetchAttemptDetails();
        }
    }, [groupBy]);

    useEffect(() => {
        if (!visible) {
            setReviewNote('');
            setAdjustedScore('');
            setAdjustedTotal('');
            setReviewError(null);
            setShowAdjustInputs(false);
        }
    }, [visible]);

    const fetchTimeline = async () => {
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
    };

    // Phase 7 (§25.4): record the human review decision of record. Marks are
    // NEVER altered — an optional adjusted score is stored display-only.
    const submitReview = async (decision: 'confirm' | 'dismiss' | 'escalate') => {
        if (!attemptId || reviewSubmitting) return;
        setReviewSubmitting(true);
        setReviewError(null);
        try {
            const hasScore = adjustedScore.trim() !== '' && adjustedTotal.trim() !== '';
            await api.post(`/quizzes/attempt/${attemptId}/proctoring/review`, {
                decision,
                ...(reviewNote.trim() ? { note: reviewNote.trim() } : {}),
                ...(hasScore ? {
                    adjustedScore: Number(adjustedScore),
                    adjustedTotalMarks: Number(adjustedTotal),
                } : {}),
            });
            await fetchTimeline();
            setReviewNote('');
            setAdjustedScore('');
            setAdjustedTotal('');
            setShowAdjustInputs(false);
        } catch (error: any) {
            setReviewError(error?.response?.data?.message ?? 'Could not record the review.');
        } finally {
            setReviewSubmitting(false);
        }
    };

    const toggleTimeline = () => {
        const next = !showTimeline;
        setShowTimeline(next);
        if (next && !timeline && !timelineLoading) {
            fetchTimeline();
        }
    };

    const fetchAttemptDetails = async () => {
        if (!attemptId) return;

        setLoading(true);
        try {
            // Extract quizId from attemptId by finding the quiz (if needed, or backend handles it)
            // The previous logic was: get attempt -> get quizId -> get results
            // We'll stick to that to be safe, or just call the result endpoint if it's robust.
            // Following previous pattern:
            const attemptRes = await api.get(`/quizzes/attempt/${attemptId}`);
            const quizId = attemptRes.data.quiz;
            // The resync payload's compact session hint decides whether the
            // proctoring section renders at all.
            setHasProctoring(Boolean(attemptRes.data?.proctoringSession));

            const response = await api.get(`/quizzes/${quizId}/attempt/${attemptId}/results?groupBy=${groupBy}`);
            setAttemptData(response.data);
        } catch (error) {
            console.error('Error fetching attempt details:', error);
        } finally {
            setLoading(false);
        }
    };

    if (!visible) return null;

    // --- Helper Functions from Result Screen ---

    const formatTime = (seconds: number) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        }
        return `${minutes}m ${secs}s`;
    };

    const formatMarks = (value: number) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return '0';
        return Number(num.toFixed(2)).toString();
    };

    const calculateStats = () => {
        if (!attemptData) return null;

        // Prefer the server-computed summary — the same numbers that drive the
        // overall quiz statistics — so the overall tiles always agree with the
        // grouped rows regardless of the selected Group by dimension.
        const summary = attemptData.summary;
        if (summary) {
            const scorePercentage = summary.scorePercentage !== null && summary.scorePercentage !== undefined
                ? summary.scorePercentage
                : (attemptData.attempt.totalMarks
                    ? Math.round((attemptData.attempt.marksObtained / attemptData.attempt.totalMarks) * 10000) / 100
                    : 0);

            return {
                correct: summary.correct,
                wrong: summary.incorrect,
                skipped: summary.skipped,
                total: summary.totalQuestions || attemptData.attempt.totalQuestions || attemptData.quiz.totalQuestions || 0,
                markedCount: summary.markedForReviewCount,
                totalTimeSpent: summary.timeTakenSeconds,
                scorePercentage,
                accuracy: summary.accuracy,
                percentage: scorePercentage,
            };
        }

        // Fallback for payloads without a summary (legacy responses).
        const correct = attemptData.attempt.score;
        const total = attemptData.attempt.totalQuestions || attemptData.quiz.totalQuestions || 0;
        const computedAnswered = attemptData.questions
            ? attemptData.questions.filter(q => q.userAnswer !== undefined && q.userAnswer !== -1).length
            : 0;

        let totalTimeSpent = 0;
        if (attemptData.attempt.sectionPerformance) {
            totalTimeSpent = attemptData.attempt.sectionPerformance.reduce((sum, section) => sum + section.timeSpent, 0);
        }
        if (totalTimeSpent === 0 && attemptData.attempt.startTime && attemptData.attempt.endTime) {
            totalTimeSpent = (new Date(attemptData.attempt.endTime).getTime() - new Date(attemptData.attempt.startTime).getTime()) / 1000;
        }

        const scorePercentage = attemptData.attempt.totalMarks
            ? Math.round((attemptData.attempt.marksObtained / attemptData.attempt.totalMarks) * 10000) / 100
            : 0;
        const attempted = computedAnswered;
        const accuracy = attempted > 0
            ? Math.round((correct / attempted) * 10000) / 100
            : null;

        return {
            correct,
            wrong: Math.max(0, computedAnswered - correct),
            skipped: Math.max(0, total - computedAnswered),
            total,
            markedCount: attemptData.questions ? attemptData.questions.filter(r => r.markedForReview).length : 0,
            totalTimeSpent,
            scorePercentage,
            accuracy,
            percentage: scorePercentage,
        };
    };

    const stats = calculateStats();

    // Prepare grouped performance with accuracy (server sends accuracy; the
    // fallback mirrors the server formula: correct / attempted, skips excluded)
    const sectionPerformanceWithAccuracy = attemptData?.attempt.sectionPerformance ? attemptData.attempt.sectionPerformance.map(section => {
        const attemptedInSection = section.correct + section.incorrect;
        const accuracy = section.accuracy !== undefined
            ? section.accuracy
            : (attemptedInSection > 0 ? Math.round((section.correct / attemptedInSection) * 100) : 0);

        return {
            ...section,
            accuracy
        };
    }) : [];

    const activeGroupOption = GROUP_BY_OPTIONS.find(option => option.value === groupBy) ?? GROUP_BY_OPTIONS[0];

    // Shared responsive table: the name column flexes to fill wide viewports,
    // stat columns keep guaranteed minimum widths so headers ("Correct",
    // "Time") never wrap or clip on narrow phones, and the card scrolls
    // horizontally when even the minimums don't fit.
    const performanceColumns: Array<DataTableColumn<{
        sectionName: string;
        correct: number;
        incorrect: number;
        skipped: number;
        accuracy: number;
        timeSpent: number;
    }>> = [
        {
            key: 'name',
            header: activeGroupOption.rowLabel,
            width: 96,
            grow: true,
            headerStyle: styles.tableHeaderText,
            renderCell: (row) => (
                <Text style={styles.tableCell} numberOfLines={1}>
                    {row.sectionName}
                </Text>
            ),
        },
        {
            key: 'correct',
            header: 'Correct',
            width: 56,
            align: 'center',
            headerStyle: styles.tableHeaderText,
            renderCell: (row) => (
                <Text style={[styles.tableCell, styles.correctText]} numberOfLines={1}>
                    {row.correct}
                </Text>
            ),
        },
        {
            key: 'wrong',
            header: 'Wrong',
            width: 48,
            align: 'center',
            headerStyle: styles.tableHeaderText,
            renderCell: (row) => (
                <Text style={[styles.tableCell, styles.incorrectText]} numberOfLines={1}>
                    {row.incorrect}
                </Text>
            ),
        },
        {
            key: 'skip',
            header: 'Skip',
            width: 42,
            align: 'center',
            headerStyle: styles.tableHeaderText,
            renderCell: (row) => (
                <Text style={[styles.tableCell, styles.skippedText]} numberOfLines={1}>
                    {row.skipped}
                </Text>
            ),
        },
        {
            key: 'acc',
            header: 'Acc%',
            width: 42,
            align: 'center',
            headerStyle: styles.tableHeaderText,
            renderCell: (row) => (
                <Text style={styles.tableCell} numberOfLines={1}>
                    {row.accuracy}%
                </Text>
            ),
        },
        {
            key: 'time',
            header: 'Time',
            width: 66,
            align: 'right',
            headerStyle: styles.tableHeaderText,
            renderCell: (row) => (
                <Text style={styles.tableCell} numberOfLines={1}>
                    {formatTime(row.timeSpent)}
                </Text>
            ),
        },
    ];

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={styles.modal}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
                             {attemptData ? attemptData.student.name : 'Attempt Details'}
                        </Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityLabel="Close attempt details">
                            <X color="#1F2937" size={24} />
                        </TouchableOpacity>
                    </View>

                    {loading ? (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator color="#01b4ae" size="large" />
                        </View>
                    ) : attemptData && stats ? (
                        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                            
                            {/* Student & Quiz Info Header */}
                            <View style={styles.infoSection}>
                                <Text style={styles.quizTitle}>{attemptData.quiz.title}</Text>
                                {attemptData.participantType === 'guest' ? (
                                    <>
                                        <Text style={styles.studentEmail}>
                                            {attemptData.student.email ?? attemptData.student.phone ?? 'Verified guest'}
                                        </Text>
                                        <Text style={styles.guestLeadLine}>
                                            {[
                                                'Public quiz participant',
                                                attemptData.student.emailVerified === true ? 'Email verified' : null,
                                                attemptData.student.phoneVerified === true ? 'Phone verified' : null,
                                                `Marketing consent: ${attemptData.student.marketingConsent === true ? 'Yes' : 'No'}`,
                                            ].filter(Boolean).join(' • ')}
                                        </Text>
                                    </>
                                ) : (
                                    <Text style={styles.studentEmail}>{attemptData.student.email}</Text>
                                )}
                                <Text style={styles.dateText}>
                                     {new Date(attemptData.attempt.endTime).toLocaleString()}
                                </Text>
                            </View>

                            {/* Score Card - Mirrored from Result Screen */}
                            <View style={styles.scoreCard}>
                                <View style={styles.scoreIconContainer}>
                                    {stats.scorePercentage >= 50 ? (
                                        <CheckCircle color="#10B981" size={64} />
                                    ) : (
                                        <XCircle color="#EF4444" size={64} />
                                    )}
                                </View>
                                <Text style={styles.scoreText}>
                                    {stats.correct}/{stats.total}
                                </Text>
                                <Text style={styles.scoreSubtext}>Questions Correct</Text>
                                <View style={styles.percentageContainer}>
                                    <Text style={[
                                        styles.percentageText,
                                        stats.scorePercentage >= 50 ? styles.passPercentage : styles.failPercentage
                                    ]}>
                                        {stats.scorePercentage}%
                                    </Text>
                                </View>
                                <Text style={styles.scoreSubtext}>Score % (marks-based)</Text>
                                <Text style={styles.marksText}>
                                    {formatMarks(attemptData.attempt.marksObtained)} / {formatMarks(attemptData.attempt.totalMarks)} Marks
                                </Text>
                            </View>

                            {/* Metrics Grid 1: Counts */}
                            <View style={styles.metricsContainer}>
                                <View style={styles.metricCard}>
                                    <CheckCircle color="#10B981" size={24} />
                                    <Text style={styles.metricValue}>{stats.correct}</Text>
                                    <Text style={styles.metricLabel}>Correct</Text>
                                </View>
                                <View style={styles.metricCard}>
                                    <XCircle color="#EF4444" size={24} />
                                    <Text style={styles.metricValue}>{stats.wrong}</Text>
                                    <Text style={styles.metricLabel}>Incorrect</Text>
                                </View>
                                <View style={styles.metricCard}>
                                    <MinusCircle color="#F59E0B" size={24} />
                                    <Text style={styles.metricValue}>{stats.skipped}</Text>
                                    <Text style={styles.metricLabel}>Skipped</Text>
                                </View>
                            </View>

                            {/* Metrics Grid 2: Analysis */}
                            <View style={styles.metricsContainer}>
                                <View style={styles.metricCard}>
                                    <BarChart3 color="#6B7280" size={24} />
                                    <Text style={styles.metricValue}>{stats.markedCount}</Text>
                                    <Text style={styles.metricLabel}>Marked</Text>
                                </View>
                                <View style={styles.metricCard}>
                                    <Award color="#8B5CF6" size={24} />
                                    <Text style={styles.metricValue}>
                                        {stats.accuracy !== null ? `${stats.accuracy}%` : 'N/A'}
                                    </Text>
                                    <Text style={styles.metricLabel}>Accuracy</Text>
                                </View>
                                <View style={styles.metricCard}>
                                    <Clock color="#3B82F6" size={24} />
                                    <Text style={styles.metricValue}>{formatTime(stats.totalTimeSpent)}</Text>
                                    <Text style={styles.metricLabel}>Time</Text>
                                </View>
                            </View>

                            {/* Grouped Performance Table */}
                            <View style={styles.filterContainer}>
                                <Text style={styles.filterLabel}>Group by:</Text>
                                <TouchableOpacity
                                    style={styles.dropdown}
                                    onPress={() => setShowDropdown(!showDropdown)}
                                >
                                    <Text style={styles.dropdownText}>
                                        {activeGroupOption.label}
                                    </Text>
                                    <ChevronDown size={16} color="#6B7280" />
                                </TouchableOpacity>
                            </View>

                            {showDropdown && (
                                <View style={styles.dropdownMenu}>
                                    {GROUP_BY_OPTIONS.map(option => (
                                        <TouchableOpacity
                                            key={option.value}
                                            style={styles.dropdownOption}
                                            onPress={() => { setGroupBy(option.value); setShowDropdown(false); }}
                                        >
                                            <Text style={[styles.dropdownOptionText, groupBy === option.value && styles.dropdownOptionTextActive]}>
                                                {option.label}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            )}

                             <View style={styles.sectionContainer}>
                                <Text style={styles.sectionTitle}>{activeGroupOption.rowLabel} Performance</Text>
                                <DataTable
                                    columns={performanceColumns}
                                    data={sectionPerformanceWithAccuracy}
                                    keyExtractor={(_row, index) => `perf-${index}`}
                                    style={styles.tableContainer}
                                />
                            </View>

                            {/* Tab Switch Warning */}
                            {attemptData.attempt.tabSwitchCount > 0 && (
                                <View style={styles.warningCard}>
                                    <Text style={styles.warningText}>
                                        ⚠️ {attemptData.attempt.tabSwitchCount} tab switches detected
                                    </Text>
                                </View>
                            )}

                            {/* Proctoring timeline (Phase 7-lite) — the review
                                surface for proctored attempts only. Structured
                                observations; no images exist anywhere. */}
                            {hasProctoring && (
                                <View style={styles.timelineContainer}>
                                    <TouchableOpacity
                                        style={styles.timelineHeader}
                                        onPress={toggleTimeline}
                                        accessibilityRole="button"
                                        accessibilityLabel="Toggle proctoring timeline"
                                    >
                                        <ShieldAlert size={16} color="#6D28D9" />
                                        <Text style={styles.timelineTitle}>Proctoring timeline</Text>
                                        {timeline?.summary && (
                                            <Text style={styles.timelineChips}>
                                                {timeline.summary.violationCount} violations · risk {timeline.summary.riskCategory}
                                                {timeline.session?.integrityStatus
                                                    ? ` · ${INTEGRITY_SHORT[timeline.session.integrityStatus] ?? timeline.session.integrityStatus}`
                                                    : ''}
                                            </Text>
                                        )}
                                        <ChevronDown
                                            size={16}
                                            color="#6B7280"
                                            style={[styles.timelineChevron, showTimeline && { transform: [{ rotate: '180deg' }] }]}
                                        />
                                    </TouchableOpacity>

                                    {showTimeline && (
                                        <View style={styles.timelineBody}>
                                            {timelineLoading && <ActivityIndicator size="small" color="#6D28D9" />}
                                            {!timelineLoading && !timeline && (
                                                <Text style={styles.timelineEmpty}>
                                                    No proctoring timeline available for this attempt.
                                                </Text>
                                            )}
                                            {!timelineLoading && timeline && (
                                                <>
                                                    <View style={styles.timelineMetaRow}>
                                                        <Text style={styles.timelineMeta}>
                                                            Session {String(timeline.session?.status ?? '—')}
                                                            {' · '}{Math.round((timeline.summary?.monitoredMs ?? 0) / 60000)} min monitored
                                                            {timeline.autoSubmitReason
                                                                ? ' · auto-submitted (policy)'
                                                                : ''}
                                                        </Text>
                                                    </View>
                                                    {(timeline.events ?? []).map((event: any) => (
                                                        <View key={event._id} style={styles.timelineRow}>
                                                            <Text style={styles.timelineTime}>
                                                                {new Date(event.serverAt).toLocaleTimeString([], {
                                                                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                                                                })}
                                                            </Text>
                                                            <View style={styles.timelineRowText}>
                                                                <Text style={[
                                                                    styles.timelineLabel,
                                                                    event.type === 'WARNING_DELIVERED' && styles.timelineLabelWarn,
                                                                    event.type === 'AUTO_SUBMITTED' && styles.timelineLabelFinal,
                                                                ]}>
                                                                    {TIMELINE_LABELS[event.type] ?? event.type}
                                                                    {(event.durationMs ?? 0) > 0 ? ` · ${Math.round(event.durationMs / 1000)}s` : ''}
                                                                </Text>
                                                                {event.type === 'WARNING_DELIVERED' && event.metadata?.code === 'warn.final' && (
                                                                    <Text style={styles.timelineSub}>Final warning</Text>
                                                                )}
                                                                {event.type === 'AUTO_SUBMITTED' && event.metadata?.ruleId && (
                                                                    <Text style={styles.timelineSub}>
                                                                        Rule: {event.metadata.ruleId}
                                                                    </Text>
                                                                )}
                                                            </View>
                                                        </View>
                                                    ))}
                                                    {(timeline.violations ?? []).length > 0 && (
                                                        <Text style={styles.timelineViolations}>
                                                            Violations: {(timeline.violations ?? [])
                                                                .map((v: any) => `${v.ruleId}${v.review?.status ? ` (${v.review.status})` : ''}`)
                                                                .join(', ')}
                                                        </Text>
                                                    )}

                                                    {/* §25.4 review trail — the decision of record. */}
                                                    {timeline.session?.review?.status && (
                                                        <View style={styles.reviewTrailCard}>
                                                            <Text style={styles.reviewTrailTitle}>
                                                                Review: {timeline.session.review.status}
                                                                {' · '}{new Date(timeline.session.review.reviewedAt).toLocaleString([], {
                                                                    dateStyle: 'medium', timeStyle: 'short',
                                                                })}
                                                            </Text>
                                                            {timeline.session.review.note ? (
                                                                <Text style={styles.reviewTrailNote}>
                                                                    "{timeline.session.review.note}"
                                                                </Text>
                                                            ) : null}
                                                            {timeline.session.reviewAdjustedScore ? (
                                                                <Text style={styles.reviewTrailAdjusted}>
                                                                    Adjusted score (display only): {timeline.session.reviewAdjustedScore.score}
                                                                    {' / '}{timeline.session.reviewAdjustedScore.totalMarks}
                                                                </Text>
                                                            ) : null}
                                                        </View>
                                                    )}

                                                    {/* §25.4 review actions — admins only, closed sessions only. */}
                                                    {userRole === 'admin'
                                                        && timeline.session?.status
                                                        && !['ACTIVE', 'DEGRADED'].includes(timeline.session.status) && (
                                                        <View style={styles.reviewPanel}>
                                                            <Text style={styles.reviewPanelTitle}>Review decision</Text>
                                                            {reviewError && (
                                                                <Text style={styles.reviewError}>{reviewError}</Text>
                                                            )}
                                                            <TextInput
                                                                style={styles.reviewNoteInput}
                                                                placeholder="Note (optional, e.g. sibling walked by)"
                                                                placeholderTextColor="#9CA3AF"
                                                                value={reviewNote}
                                                                onChangeText={setReviewNote}
                                                                multiline
                                                                maxLength={1000}
                                                            />
                                                            <TouchableOpacity
                                                                style={styles.reviewAdjustToggle}
                                                                onPress={() => setShowAdjustInputs((prev) => !prev)}
                                                            >
                                                                <Text style={styles.reviewAdjustToggleText}>
                                                                    {showAdjustInputs ? '- Hide adjusted score' : '+ Record adjusted score (optional)'}
                                                                </Text>
                                                            </TouchableOpacity>
                                                            {showAdjustInputs && (
                                                                <View style={styles.reviewAdjustRow}>
                                                                    <TextInput
                                                                        style={styles.reviewAdjustInput}
                                                                        placeholder="Score"
                                                                        placeholderTextColor="#9CA3AF"
                                                                        value={adjustedScore}
                                                                        onChangeText={setAdjustedScore}
                                                                        keyboardType="numeric"
                                                                    />
                                                                    <Text style={styles.reviewAdjustSlash}>/</Text>
                                                                    <TextInput
                                                                        style={styles.reviewAdjustInput}
                                                                        placeholder="Total"
                                                                        placeholderTextColor="#9CA3AF"
                                                                        value={adjustedTotal}
                                                                        onChangeText={setAdjustedTotal}
                                                                        keyboardType="numeric"
                                                                    />
                                                                </View>
                                                            )}
                                                            <Text style={styles.reviewAdjustHint}>
                                                                Display only — the original marks are never changed.
                                                            </Text>
                                                            {reviewSubmitting ? (
                                                                <ActivityIndicator size="small" color="#6D28D9" style={{ marginTop: 8 }} />
                                                            ) : (
                                                                <View style={styles.reviewButtonRow}>
                                                                    <TouchableOpacity
                                                                        style={[styles.reviewButton, styles.reviewButtonConfirm]}
                                                                        onPress={() => submitReview('confirm')}
                                                                        accessibilityRole="button"
                                                                        accessibilityLabel="Confirm proctoring concerns"
                                                                    >
                                                                        <Text style={styles.reviewButtonText}>Confirm</Text>
                                                                    </TouchableOpacity>
                                                                    <TouchableOpacity
                                                                        style={[styles.reviewButton, styles.reviewButtonDismiss]}
                                                                        onPress={() => submitReview('dismiss')}
                                                                        accessibilityRole="button"
                                                                        accessibilityLabel="Dismiss proctoring concerns"
                                                                    >
                                                                        <Text style={[styles.reviewButtonText, styles.reviewButtonTextDismiss]}>Dismiss</Text>
                                                                    </TouchableOpacity>
                                                                    <TouchableOpacity
                                                                        style={[styles.reviewButton, styles.reviewButtonEscalate]}
                                                                        onPress={() => submitReview('escalate')}
                                                                        accessibilityRole="button"
                                                                        accessibilityLabel="Escalate proctoring concerns"
                                                                    >
                                                                        <Text style={[styles.reviewButtonText, styles.reviewButtonTextEscalate]}>Escalate</Text>
                                                                    </TouchableOpacity>
                                                                </View>
                                                            )}
                                                        </View>
                                                    )}
                                                </>
                                            )}
                                        </View>
                                    )}
                                </View>
                            )}

                            <View style={{ height: 20 }} />
                        </ScrollView>
                    ) : (
                        <View style={styles.errorContainer}>
                            <Text style={styles.errorText}>Failed to load attempt details</Text>
                        </View>
                    )}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    reviewTrailCard: {
        backgroundColor: '#F9FAFB',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        padding: 10,
        marginTop: 10,
    },
    reviewTrailTitle: { fontSize: 12, fontWeight: '700', color: '#374151' },
    reviewTrailNote: { fontSize: 12, color: '#6B7280', marginTop: 4, fontStyle: 'italic' },
    reviewTrailAdjusted: { fontSize: 12, color: '#0D9488', marginTop: 4, fontWeight: '600' },
    reviewPanel: {
        borderTopWidth: 1,
        borderTopColor: '#E5E7EB',
        marginTop: 12,
        paddingTop: 12,
    },
    reviewPanelTitle: { fontSize: 12.5, fontWeight: '700', color: '#374151', marginBottom: 6 },
    reviewError: { fontSize: 12, color: '#DC2626', marginBottom: 6 },
    reviewNoteInput: {
        borderWidth: 1,
        borderColor: '#D1D5DB',
        borderRadius: 8,
        padding: 8,
        backgroundColor: '#FFF',
        fontSize: 12.5,
        color: '#1F2937',
        minHeight: 36,
        textAlignVertical: 'top',
    },
    reviewAdjustToggle: { marginTop: 8, alignSelf: 'flex-start' },
    reviewAdjustToggleText: { fontSize: 12, color: '#0D9488', fontWeight: '600' },
    reviewAdjustRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
    reviewAdjustInput: {
        borderWidth: 1,
        borderColor: '#D1D5DB',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        fontSize: 12.5,
        color: '#1F2937',
        backgroundColor: '#FFF',
        width: 90,
    },
    reviewAdjustSlash: { fontSize: 13, color: '#6B7280', marginHorizontal: 8 },
    reviewAdjustHint: { fontSize: 11, color: '#9CA3AF', marginTop: 6 },
    reviewButtonRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    reviewButton: {
        flex: 1,
        borderRadius: 8,
        paddingVertical: 9,
        alignItems: 'center',
        borderWidth: 1,
    },
    reviewButtonConfirm: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
    reviewButtonDismiss: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
    reviewButtonEscalate: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
    reviewButtonText: { fontSize: 12.5, fontWeight: '700', color: '#DC2626' },
    reviewButtonTextDismiss: { color: '#059669' },
    reviewButtonTextEscalate: { color: '#D97706' },
    timelineContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        marginTop: 12,
        overflow: 'hidden',
    },
    timelineHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    timelineTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#6D28D9',
        marginLeft: 6,
    },
    timelineChips: {
        flex: 1,
        fontSize: 11,
        color: '#6B7280',
        textAlign: 'right',
        marginRight: 6,
    },
    timelineChevron: {},
    timelineBody: {
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    timelineMetaRow: {
        marginBottom: 6,
    },
    timelineMeta: {
        fontSize: 11,
        color: '#6B7280',
    },
    timelineRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 4,
    },
    timelineTime: {
        fontSize: 11,
        color: '#9CA3AF',
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        marginRight: 8,
        marginTop: 1,
    },
    timelineRowText: {
        flex: 1,
    },
    timelineLabel: {
        fontSize: 12,
        color: '#374151',
    },
    timelineLabelWarn: {
        color: '#B45309',
        fontWeight: '600',
    },
    timelineLabelFinal: {
        color: '#B91C1C',
        fontWeight: '700',
    },
    timelineSub: {
        fontSize: 11,
        color: '#6B7280',
        marginTop: 1,
    },
    timelineViolations: {
        fontSize: 11,
        color: '#6B7280',
        marginTop: 8,
        paddingTop: 6,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
    timelineEmpty: {
        fontSize: 12,
        color: '#6B7280',
        paddingVertical: 6,
    },
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modal: {
        backgroundColor: '#F3F4F6', // Changed to greyish background for contrast with white cards
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '90%',
        flex: 1, 
        marginTop: 60, // Give some space from top
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1F2937',
        flexShrink: 1,
        marginRight: 12,
    },
    closeButton: {
        padding: 4,
    },
    loadingContainer: {
        padding: 40,
        alignItems: 'center',
    },
    content: {
        flex: 1,
    },
    // ID Card / Info Section
    infoSection: {
        padding: 20,
        backgroundColor: '#FFFFFF',
        marginBottom: 10,
    },
    studentEmail: {
        fontSize: 14,
        color: '#6B7280',
        marginTop: 2,
    },
    guestLeadLine: {
        fontSize: 12,
        color: '#B45309',
        marginTop: 3,
    },
    quizTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1F2937',
    },
    dateText: {
        fontSize: 12,
        color: '#9CA3AF',
        marginTop: 4,
    },
    // Score Card
    scoreCard: {
        margin: 16,
        padding: 24,
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    scoreIconContainer: {
        marginBottom: 16,
    },
    scoreText: {
        fontSize: 40,
        fontWeight: 'bold',
        color: '#1F2937',
    },
    scoreSubtext: {
        fontSize: 14,
        color: '#6B7280',
        marginTop: 4,
    },
    marksText: {
        marginTop: 8,
        fontSize: 14,
        color: '#6B7280',
        fontWeight: '500'
    },
    percentageContainer: {
        marginTop: 12,
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: 20,
        backgroundColor: '#F9FAFB'
    },
    percentageText: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    passPercentage: {
        color: '#10B981',
    },
    failPercentage: {
        color: '#EF4444',
    },
    // Metrics
    metricsContainer: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        gap: 12,
        marginBottom: 12,
    },
    metricCard: {
        flex: 1,
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 12,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    metricValue: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1F2937',
        marginTop: 8,
    },
    metricLabel: {
        fontSize: 11,
        color: '#6B7280',
        marginTop: 2,
        textAlign: 'center',
    },
    // Section Table
    sectionContainer: {
        margin: 16,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#1F2937',
        marginBottom: 12,
        marginLeft: 4,
    },
    // Card chrome for the shared DataTable (background/radius come from the
    // component itself).
    tableContainer: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    tableHeaderText: {
        fontSize: 11,
        color: '#4B5563',
    },
    tableCell: {
        fontSize: 12,
        color: '#4B5563',
    },
    correctText: {
        color: '#10B981',
        fontWeight: '600',
    },
    incorrectText: {
        color: '#EF4444',
        fontWeight: '600',
    },
    skippedText: {
        color: '#F59E0B',
        fontWeight: '600',
    },
    // Warnings & Errors
    warningCard: {
        margin: 16,
        padding: 16,
        backgroundColor: '#FEF2F2',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#FECACA',
    },
    warningText: {
        color: '#991B1B',
        fontSize: 14,
        textAlign: 'center',
        fontWeight: '600',
    },
    errorContainer: {
        padding: 40,
        alignItems: 'center',
    },
    errorText: {
        fontSize: 16,
        color: '#EF4444',
        textAlign: 'center',
    },
    // Filter dropdown styles
    filterContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginBottom: 12,
        gap: 8,
    },
    filterLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#4B5563',
    },
    dropdown: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        gap: 6,
    },
    dropdownText: {
        fontSize: 14,
        color: '#1F2937',
        fontWeight: '500',
    },
    dropdownMenu: {
        backgroundColor: '#FFFFFF',
        marginHorizontal: 16,
        marginBottom: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    dropdownOption: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    dropdownOptionText: {
        fontSize: 14,
        color: '#4B5563',
    },
    dropdownOptionTextActive: {
        color: '#2563EB',
        fontWeight: '600',
    },
});
