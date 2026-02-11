import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    Modal,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator
} from 'react-native';
import { X, CheckCircle, XCircle, MinusCircle, Clock } from 'lucide-react-native';
import { api } from '@/services/api';

interface AttemptDetailModalProps {
    attemptId: string | null;
    visible: boolean;
    onClose: () => void;
}

interface AttemptDetail {
    attempt: {
        _id: string;
        status: string;
        startTime: string;
        endTime: string;
        score: number;
        totalQuestions: number;
        marksObtained: number;
        totalMarks: number;
        sectionPerformance: any[];
        tabSwitchCount: number;
    };
    quiz: {
        _id: string;
        title: string;
        subject: any;
        testType: string;
        shareSolution: boolean;
    };
    student: {
        _id: string;
        name: string;
        email: string;
    };
    questions: any[];
}

export default function AttemptDetailModal({ attemptId, visible, onClose }: AttemptDetailModalProps) {
    const [loading, setLoading] = useState(false);
    const [attemptData, setAttemptData] = useState<AttemptDetail | null>(null);

    useEffect(() => {
        if (visible && attemptId) {
            fetchAttemptDetails();
        }
    }, [visible, attemptId]);

    const fetchAttemptDetails = async () => {
        if (!attemptId) return;

        setLoading(true);
        try {
            // Extract quizId from attemptId by finding the quiz
            const attemptRes = await api.get(`/quizzes/attempt/${attemptId}`);
            const quizId = attemptRes.data.quiz;

            const response = await api.get(`/quizzes/${quizId}/attempt/${attemptId}/results`);
            setAttemptData(response.data);
        } catch (error) {
            console.error('Error fetching attempt details:', error);
        } finally {
            setLoading(false);
        }
    };

    if (!visible) return null;

    const calculateStats = () => {
        if (!attemptData) return null;

        const correct = attemptData.attempt.score;
        const total = attemptData.attempt.totalQuestions;
        const answered = attemptData.questions.filter(q =>
            q.userAnswer !== undefined && q.userAnswer !== -1
        ).length;
        const wrong = answered - correct;
        const skipped = total - answered;

        return { correct, wrong, skipped, total };
    };

    const stats = calculateStats();

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
                        <Text style={styles.title}>Attempt Details</Text>
                        <TouchableOpacity onPress={onClose}>
                            <X color="#1F2937" size={24} />
                        </TouchableOpacity>
                    </View>

                    {loading ? (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator color="#01b4ae" size="large" />
                        </View>
                    ) : attemptData ? (
                        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                            {/* Student Info */}
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>Student</Text>
                                <Text style={styles.studentName}>{attemptData.student.name}</Text>
                                <Text style={styles.studentEmail}>{attemptData.student.email}</Text>
                            </View>

                            {/* Quiz Info */}
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>Quiz</Text>
                                <Text style={styles.quizTitle}>{attemptData.quiz.title}</Text>
                                <View style={styles.typeBadge}>
                                    <Text style={styles.typeBadgeText}>{attemptData.quiz.testType}</Text>
                                </View>
                            </View>

                            {/* Score Summary */}
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>Score</Text>
                                <View style={styles.scoreContainer}>
                                    <Text style={styles.scoreText}>
                                        {attemptData.attempt.marksObtained}/{attemptData.attempt.totalMarks}
                                    </Text>
                                    <Text style={styles.percentageText}>
                                        ({Math.round((attemptData.attempt.marksObtained / attemptData.attempt.totalMarks) * 100)}%)
                                    </Text>
                                </View>
                            </View>

                            {/* Statistics */}
                            {stats && (
                                <View style={styles.section}>
                                    <Text style={styles.sectionTitle}>Statistics</Text>
                                    <View style={styles.statsGrid}>
                                        <View style={styles.statCard}>
                                            <CheckCircle color="#10B981" size={20} />
                                            <Text style={styles.statValue}>{stats.correct}</Text>
                                            <Text style={styles.statLabel}>Correct</Text>
                                        </View>
                                        <View style={styles.statCard}>
                                            <XCircle color="#EF4444" size={20} />
                                            <Text style={styles.statValue}>{stats.wrong}</Text>
                                            <Text style={styles.statLabel}>Wrong</Text>
                                        </View>
                                        <View style={styles.statCard}>
                                            <MinusCircle color="#9CA3AF" size={20} />
                                            <Text style={styles.statValue}>{stats.skipped}</Text>
                                            <Text style={styles.statLabel}>Skipped</Text>
                                        </View>
                                        <View style={styles.statCard}>
                                            <Clock color="#F59E0B" size={20} />
                                            <Text style={styles.statValue}>
                                                {Math.round((new Date(attemptData.attempt.endTime).getTime() -
                                                    new Date(attemptData.attempt.startTime).getTime()) / 1000 / 60)}m
                                            </Text>
                                            <Text style={styles.statLabel}>Time</Text>
                                        </View>
                                    </View>
                                </View>
                            )}

                            {/* Date */}
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>Completed</Text>
                                <Text style={styles.dateText}>
                                    {new Date(attemptData.attempt.endTime).toLocaleString('en-US', {
                                        month: 'long',
                                        day: 'numeric',
                                        year: 'numeric',
                                        hour: 'numeric',
                                        minute: '2-digit'
                                    })}
                                </Text>
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
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '85%',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    title: {
        fontSize: 20,
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
    section: {
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6B7280',
        marginBottom: 8,
        textTransform: 'uppercase',
    },
    studentName: {
        fontSize: 18,
        fontWeight: '600',
        color: '#1F2937',
    },
    studentEmail: {
        fontSize: 14,
        color: '#6B7280',
        marginTop: 4,
    },
    quizTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1F2937',
        marginBottom: 8,
    },
    typeBadge: {
        alignSelf: 'flex-start',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: 'rgba(1, 180, 174, 0.1)',
    },
    typeBadgeText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#01b4ae',
        textTransform: 'capitalize',
    },
    scoreContainer: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
    },
    scoreText: {
        fontSize: 32,
        fontWeight: '700',
        color: '#1F2937',
    },
    percentageText: {
        fontSize: 20,
        fontWeight: '600',
        color: '#6B7280',
    },
    statsGrid: {
        flexDirection: 'row',
        gap: 12,
    },
    statCard: {
        flex: 1,
        backgroundColor: '#F9FAFB',
        padding: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    statValue: {
        fontSize: 20,
        fontWeight: '700',
        color: '#1F2937',
        marginTop: 4,
    },
    statLabel: {
        fontSize: 11,
        color: '#6B7280',
        marginTop: 2,
    },
    dateText: {
        fontSize: 16,
        color: '#1F2937',
    },
    warningCard: {
        backgroundColor: '#FEF3C7',
        padding: 16,
        marginHorizontal: 20,
        marginTop: 16,
        borderRadius: 8,
        borderLeftWidth: 4,
        borderLeftColor: '#F59E0B',
    },
    warningText: {
        fontSize: 14,
        color: '#92400E',
        fontWeight: '500',
    },
    errorContainer: {
        padding: 40,
        alignItems: 'center',
    },
    errorText: {
        fontSize: 16,
        color: '#EF4444',
    },
});
