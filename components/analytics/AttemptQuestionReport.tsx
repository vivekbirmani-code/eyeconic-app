import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    Image,
    Alert,
} from 'react-native';
import {
    CheckCircle,
    XCircle,
    MinusCircle,
    Download,
    FileSpreadsheet,
    FileText,
    Clock,
    Image as ImageIcon,
} from 'lucide-react-native';
import { api } from '@/services/api';
import { downloadApiReport, getReportDownloadErrorMessage } from '@/services/downloads';

interface AttemptQuestionReportProps {
    /** The exact attempt to report on — every row is scoped to this id. */
    attemptId: string | null;
}

type ReportQuestion = {
    questionNumber: number;
    section: string;
    subjectName: string;
    topicName: string;
    questionTypeLabel: string;
    question: string | null;
    questionUnavailable: boolean;
    questionImage: string | null;
    hasQuestionImage: boolean;
    studentResponseLabel: string;
    studentResponseText: string;
    correctAnswerLabel: string;
    correctAnswerText: string;
    result: 'correct' | 'incorrect' | 'skipped';
    resultLabel: string;
    marks: number;
    timeSpent: number;
};

type QuestionReport = {
    participantType: 'registered' | 'guest';
    student: { name: string; email: string | null };
    quiz: { title: string; testType: string; subjectNames: string[] };
    attempt: {
        status: string;
        endTime: string;
        marksObtained: number;
        totalMarks: number;
        correct: number;
        incorrect: number;
        skipped: number;
        totalQuestions: number;
    };
    marking: { positiveMarks: number; negativeMarks: number };
    questions: ReportQuestion[];
    missingQuestionCount: number;
};

type ResultFilter = 'all' | 'correct' | 'incorrect' | 'skipped';

const FILTERS: { value: ResultFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'correct', label: 'Correct' },
    { value: 'incorrect', label: 'Incorrect' },
    { value: 'skipped', label: 'Skipped' },
];

const formatMarks = (value: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return Number(num.toFixed(2)).toString();
};

const formatSignedMarks = (value: number) => (
    value > 0 ? `+${formatMarks(value)}` : formatMarks(value)
);

const formatTime = (seconds: number) => {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (total >= 60) {
        const minutes = Math.floor(total / 60);
        const secs = total % 60;
        return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
    }
    return `${total}s`;
};

const ResultBadge = ({ result, resultLabel }: { result: ReportQuestion['result']; resultLabel: string }) => {
    const color = result === 'correct' ? '#10B981' : result === 'incorrect' ? '#EF4444' : '#F59E0B';
    const Icon = result === 'correct' ? CheckCircle : result === 'incorrect' ? XCircle : MinusCircle;
    return (
        <View style={[styles.resultBadge, { backgroundColor: result === 'correct' ? '#ECFDF5' : result === 'incorrect' ? '#FEF2F2' : '#FFFBEB' }]}>
            <Icon color={color} size={13} />
            <Text style={[styles.resultBadgeText, { color }]}>{resultLabel}</Text>
        </View>
    );
};

/**
 * Question-level report for one attempt — the admin drill-in under the
 * attempt-detail modal. Data comes from the same server collector that feeds
 * the CSV/Excel exports, so the screen and the downloads can never disagree.
 */
export default function AttemptQuestionReport({ attemptId }: AttemptQuestionReportProps) {
    const [loading, setLoading] = useState(false);
    const [report, setReport] = useState<QuestionReport | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [filter, setFilter] = useState<ResultFilter>('all');
    const [exporting, setExporting] = useState<'excel' | 'csv' | null>(null);

    // Latest-response guard: only the newest request may set state (same
    // pattern as the analytics screen's fetchTestAnalytics).
    const requestSeq = useRef(0);

    const fetchReport = useCallback(async (id: string) => {
        const seq = ++requestSeq.current;
        setLoading(true);
        setLoadError(false);
        try {
            const response = await api.get(`/quizzes/analytics/attempt/${id}/question-report`);
            if (seq !== requestSeq.current) return;
            setReport(response.data);
            setFilter('all');
        } catch (error) {
            if (seq !== requestSeq.current) return;
            console.error('Error fetching question report:', error);
            setReport(null);
            setLoadError(true);
        } finally {
            if (seq === requestSeq.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (attemptId) {
            fetchReport(attemptId);
        }
    }, [attemptId, fetchReport]);

    const counts = useMemo(() => ({
        all: report?.questions.length ?? 0,
        correct: report?.attempt.correct ?? 0,
        incorrect: report?.attempt.incorrect ?? 0,
        skipped: report?.attempt.skipped ?? 0,
    }), [report]);

    const visibleQuestions = useMemo(() => {
        if (!report) return [];
        if (filter === 'all') return report.questions;
        return report.questions.filter((q) => q.result === filter);
    }, [report, filter]);

    const handleDownload = async (format: 'excel' | 'csv') => {
        if (!attemptId || exporting) return;
        setExporting(format);
        try {
            await downloadApiReport(`/quizzes/analytics/attempt/${attemptId}/question-report/${format}`);
        } catch (error) {
            Alert.alert('Download failed', getReportDownloadErrorMessage(error));
        } finally {
            setExporting(null);
        }
    };

    if (!attemptId) return null;

    if (loading) {
        return (
            <View style={styles.container}>
                <View style={styles.headerRow}>
                    <FileText color="#1F2937" size={16} />
                    <Text style={styles.sectionTitle}>Question-Level Report</Text>
                </View>
                <ActivityIndicator color="#01b4ae" size="small" style={styles.stateBlock} />
            </View>
        );
    }

    if (loadError || !report) {
        return (
            <View style={styles.container}>
                <View style={styles.headerRow}>
                    <FileText color="#1F2937" size={16} />
                    <Text style={styles.sectionTitle}>Question-Level Report</Text>
                </View>
                <View style={styles.stateBlock}>
                    <Text style={styles.stateText}>Could not load the question report.</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={() => attemptId && fetchReport(attemptId)}>
                        <Text style={styles.retryText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.headerRow}>
                <FileText color="#1F2937" size={16} />
                <Text style={styles.sectionTitle}>Question-Level Report</Text>
                <Text style={styles.headerMeta}>
                    {report.questions.length} question{report.questions.length === 1 ? '' : 's'}
                    {' · '}+{formatMarks(report.marking.positiveMarks)}/-{formatMarks(report.marking.negativeMarks)}
                </Text>
            </View>

            {/* Filters + exports */}
            <View style={styles.controlsRow}>
                <View style={styles.filterRow}>
                    {FILTERS.map((option) => {
                        const active = filter === option.value;
                        return (
                            <TouchableOpacity
                                key={option.value}
                                style={[styles.filterChip, active && styles.filterChipActive]}
                                onPress={() => setFilter(option.value)}
                                accessibilityRole="button"
                                accessibilityLabel={`Show ${option.label.toLowerCase()} questions`}
                            >
                                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                                    {option.label} ({counts[option.value]})
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                <View style={styles.exportRow}>
                    <TouchableOpacity
                        style={[styles.exportButton, styles.exportButtonPrimary]}
                        onPress={() => handleDownload('excel')}
                        disabled={exporting !== null}
                        accessibilityLabel="Download question report as Excel"
                    >
                        {exporting === 'excel' ? (
                            <ActivityIndicator color="#FFF" size="small" />
                        ) : (
                            <FileSpreadsheet color="#FFF" size={15} />
                        )}
                        <Text style={styles.exportButtonTextPrimary}>Excel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.exportButton}
                        onPress={() => handleDownload('csv')}
                        disabled={exporting !== null}
                        accessibilityLabel="Download question report as CSV"
                    >
                        {exporting === 'csv' ? (
                            <ActivityIndicator color="#01b4ae" size="small" />
                        ) : (
                            <Download color="#01b4ae" size={15} />
                        )}
                        <Text style={styles.exportButtonText}>CSV</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Missing-question honesty note (deleted from the bank) */}
            {report.missingQuestionCount > 0 && (
                <View style={styles.missingNote}>
                    <Text style={styles.missingNoteText}>
                        {report.missingQuestionCount} question{report.missingQuestionCount === 1 ? '' : 's'} could not be
                        shown (removed from the question bank after this attempt).
                    </Text>
                </View>
            )}

            {visibleQuestions.length === 0 ? (
                <View style={styles.stateBlock}>
                    <Text style={styles.stateText}>
                        {filter === 'all' ? 'No questions on this attempt.' : `No ${filter} questions.`}
                    </Text>
                </View>
            ) : (
                visibleQuestions.map((q) => (
                    <View key={q.questionNumber} style={styles.questionCard}>
                        <View style={styles.questionHeader}>
                            <View style={styles.questionNumberBadge}>
                                <Text style={styles.questionNumberText}>Q{q.questionNumber}</Text>
                            </View>
                            <View style={styles.questionHeaderMeta}>
                                <Text style={styles.questionTypeText} numberOfLines={1}>
                                    {q.questionTypeLabel}
                                    {q.topicName ? ` · ${q.topicName}` : ''}
                                </Text>
                                <View style={styles.questionHeaderSub}>
                                    <ResultBadge result={q.result} resultLabel={q.resultLabel} />
                                    <Text style={[
                                        styles.marksText,
                                        { color: q.result === 'correct' ? '#10B981' : q.result === 'incorrect' ? '#EF4444' : '#9CA3AF' },
                                    ]}>
                                        {formatSignedMarks(q.marks)}
                                    </Text>
                                    <View style={styles.timeChip}>
                                        <Clock color="#9CA3AF" size={11} />
                                        <Text style={styles.timeText}>{formatTime(q.timeSpent)}</Text>
                                    </View>
                                </View>
                            </View>
                        </View>

                        {q.questionUnavailable ? (
                            <View style={styles.unavailableCard}>
                                <Text style={styles.unavailableText}>
                                    Question no longer available (removed from the question bank).
                                </Text>
                            </View>
                        ) : (
                            <>
                                <Text style={styles.questionText}>{q.question}</Text>
                                {q.questionImage ? (
                                    <Image
                                        source={{ uri: q.questionImage }}
                                        style={styles.questionImage}
                                        resizeMode="contain"
                                    />
                                ) : null}
                            </>
                        )}

                        <View style={styles.answerBlock}>
                            <Text style={styles.answerLabel}>Student response</Text>
                            <Text style={[
                                styles.answerText,
                                q.result === 'correct' && styles.answerCorrect,
                                q.result === 'incorrect' && styles.answerIncorrect,
                            ]}>
                                {q.studentResponseLabel && q.studentResponseText && q.studentResponseLabel !== q.studentResponseText
                                    ? `${q.studentResponseLabel} — ${q.studentResponseText}`
                                    : (q.studentResponseText || q.studentResponseLabel || 'Not answered')}
                            </Text>
                        </View>

                        <View style={styles.answerBlock}>
                            <Text style={styles.answerLabel}>Correct answer</Text>
                            <Text style={styles.answerTextCorrect}>
                                {q.correctAnswerText || q.correctAnswerLabel || '—'}
                            </Text>
                        </View>

                        {q.hasQuestionImage && !q.questionImage ? (
                            <View style={styles.imageHintRow}>
                                <ImageIcon color="#9CA3AF" size={12} />
                                <Text style={styles.imageHintText}>This question includes an image.</Text>
                            </View>
                        ) : null}
                    </View>
                ))
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        padding: 12,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 10,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1F2937',
        flexShrink: 1,
    },
    headerMeta: {
        fontSize: 11,
        color: '#9CA3AF',
        marginLeft: 'auto',
    },
    controlsRow: {
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        paddingTop: 10,
    },
    filterRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    filterChip: {
        backgroundColor: '#F9FAFB',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 14,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    filterChipActive: {
        backgroundColor: '#01b4ae',
        borderColor: '#01b4ae',
    },
    filterChipText: {
        fontSize: 11.5,
        fontWeight: '600',
        color: '#4B5563',
    },
    filterChipTextActive: {
        color: '#FFF',
    },
    exportRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 10,
    },
    exportButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        flex: 1,
        paddingVertical: 9,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#01b4ae',
        backgroundColor: '#FFF',
    },
    exportButtonPrimary: {
        backgroundColor: '#01b4ae',
        borderColor: '#01b4ae',
    },
    exportButtonText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#01b4ae',
    },
    exportButtonTextPrimary: {
        fontSize: 13,
        fontWeight: '600',
        color: '#FFF',
    },
    missingNote: {
        backgroundColor: '#FFFBEB',
        borderWidth: 1,
        borderColor: '#FDE68A',
        borderRadius: 8,
        padding: 8,
        marginTop: 10,
    },
    missingNoteText: {
        fontSize: 11.5,
        color: '#92400E',
    },
    stateBlock: {
        alignItems: 'center',
        paddingVertical: 18,
        gap: 8,
    },
    stateText: {
        fontSize: 13,
        color: '#6B7280',
        textAlign: 'center',
    },
    retryButton: {
        paddingVertical: 6,
        paddingHorizontal: 14,
    },
    retryText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#01b4ae',
    },
    questionCard: {
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        marginTop: 10,
        paddingTop: 10,
    },
    questionHeader: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 8,
    },
    questionNumberBadge: {
        width: 34,
        height: 24,
        borderRadius: 6,
        backgroundColor: '#F3F4F6',
        alignItems: 'center',
        justifyContent: 'center',
    },
    questionNumberText: {
        fontSize: 11.5,
        fontWeight: '700',
        color: '#374151',
    },
    questionHeaderMeta: {
        flex: 1,
        gap: 4,
    },
    questionTypeText: {
        fontSize: 11,
        color: '#9CA3AF',
    },
    questionHeaderSub: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
    },
    resultBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
    },
    resultBadgeText: {
        fontSize: 11,
        fontWeight: '700',
    },
    marksText: {
        fontSize: 12,
        fontWeight: '700',
    },
    timeChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    timeText: {
        fontSize: 11,
        color: '#9CA3AF',
    },
    questionText: {
        fontSize: 13,
        color: '#1F2937',
        lineHeight: 19,
    },
    questionImage: {
        width: '100%',
        height: 180,
        marginTop: 8,
        borderRadius: 8,
        backgroundColor: '#F3F4F6',
    },
    unavailableCard: {
        backgroundColor: '#F9FAFB',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 8,
        padding: 10,
    },
    unavailableText: {
        fontSize: 12,
        color: '#6B7280',
        fontStyle: 'italic',
    },
    answerBlock: {
        marginTop: 8,
    },
    answerLabel: {
        fontSize: 10.5,
        fontWeight: '700',
        color: '#9CA3AF',
        textTransform: 'uppercase',
        marginBottom: 2,
    },
    answerText: {
        fontSize: 12.5,
        color: '#374151',
        lineHeight: 18,
    },
    answerCorrect: {
        color: '#059669',
        fontWeight: '600',
    },
    answerIncorrect: {
        color: '#DC2626',
        fontWeight: '600',
    },
    answerTextCorrect: {
        fontSize: 12.5,
        color: '#374151',
        lineHeight: 18,
        fontWeight: '600',
    },
    imageHintRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 6,
    },
    imageHintText: {
        fontSize: 11,
        color: '#9CA3AF',
    },
});
