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
    StatusBar
} from 'react-native';
import { X, CheckCircle, XCircle, MinusCircle, Clock, Award, BarChart3, FileText, ChevronDown } from 'lucide-react-native';
import { api } from '@/services/api';

interface AttemptDetailModalProps {
    attemptId: string | null;
    visible: boolean;
    onClose: () => void;
}

type GroupBy = 'section' | 'subject' | 'topic' | 'tag';

const GROUP_BY_OPTIONS: Array<{ value: GroupBy; label: string; rowLabel: string }> = [
    { value: 'section', label: 'By Section', rowLabel: 'Section' },
    { value: 'subject', label: 'By Subject', rowLabel: 'Subject' },
    { value: 'topic', label: 'By Topic', rowLabel: 'Topic' },
    { value: 'tag', label: 'By Tag', rowLabel: 'Tag' },
];

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

export default function AttemptDetailModal({ attemptId, visible, onClose }: AttemptDetailModalProps) {
    const [loading, setLoading] = useState(false);
    const [attemptData, setAttemptData] = useState<AttemptDetail | null>(null);
    const [groupBy, setGroupBy] = useState<GroupBy>('section');
    const [showDropdown, setShowDropdown] = useState(false);

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
                        <Text style={styles.title}>
                             {attemptData ? attemptData.student.name : 'Attempt Details'}
                        </Text>
                        <TouchableOpacity onPress={onClose}>
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
                                <View style={styles.tableContainer}>
                                    {/* Table Header */}
                                    <View style={styles.tableHeader}>
                                        <Text style={[styles.tableHeaderText, styles.colSection]}>{activeGroupOption.rowLabel}</Text>
                                        <Text style={[styles.tableHeaderText, styles.colStat]}>Correct</Text>
                                        <Text style={[styles.tableHeaderText, styles.colStat]}>Wrong</Text>
                                        <Text style={[styles.tableHeaderText, styles.colStat]}>Skip</Text>
                                        <Text style={[styles.tableHeaderText, styles.colStat]}>Acc%</Text>
                                        <Text style={[styles.tableHeaderText, styles.colTime]}>Time</Text>
                                    </View>

                                    {/* Table Rows */}
                                    {sectionPerformanceWithAccuracy.map((section, index) => (
                                        <View key={index} style={styles.tableRow}>
                                            <Text style={[styles.tableCell, styles.colSection]} numberOfLines={1}>
                                                {section.sectionName}
                                            </Text>
                                            <Text style={[styles.tableCell, styles.colStat, styles.correctText]}>
                                                {section.correct}
                                            </Text>
                                            <Text style={[styles.tableCell, styles.colStat, styles.incorrectText]}>
                                                {section.incorrect}
                                            </Text>
                                            <Text style={[styles.tableCell, styles.colStat, styles.skippedText]}>
                                                {section.skipped}
                                            </Text>
                                            <Text style={[styles.tableCell, styles.colStat]}>
                                                {section.accuracy}%
                                            </Text>
                                            <Text style={[styles.tableCell, styles.colTime]}>
                                                {formatTime(section.timeSpent)}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            </View>

                            {/* Tab Switch Warning */}
                            {attemptData.attempt.tabSwitchCount > 0 && (
                                <View style={styles.warningCard}>
                                    <Text style={styles.warningText}>
                                        ⚠️ {attemptData.attempt.tabSwitchCount} tab switches detected
                                    </Text>
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
    tableContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    tableHeader: {
        flexDirection: 'row',
        backgroundColor: '#F9FAFB',
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    tableHeaderText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#4B5563',
    },
    tableRow: {
        flexDirection: 'row',
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    tableCell: {
        fontSize: 12,
        color: '#4B5563',
    },
    colSection: {
        flex: 2,
    },
    colStat: {
        flex: 1,
        textAlign: 'center',
    },
    colTime: {
        flex: 1.2,
        textAlign: 'right',
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
