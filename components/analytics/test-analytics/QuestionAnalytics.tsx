import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';

interface QuestionAnalytic {
    questionNumber: number;
    questionText: string;
    topicName?: string;
    percentCorrect: number;
    percentWrong: number;
    percentSkipped: number;
    correctCount: number;
    wrongCount: number;
    skippedCount: number;
    sampleSize?: number;
}

interface QuestionAnalyticsProps {
    questions: QuestionAnalytic[];
}

export default function QuestionAnalytics({ questions }: QuestionAnalyticsProps) {
    if (!questions || questions.length === 0) {
        return (
            <View style={styles.container}>
                <Text style={styles.sectionTitle}>Question-wise Analytics</Text>
                <Text style={styles.empty}>No question analytics available.</Text>
            </View>
        );
    }

    const sampleSize = questions[0]?.sampleSize ?? 0;

    return (
        <View style={styles.container}>
            <Text style={styles.sectionTitle}>Question-wise Analytics</Text>
            <Text style={styles.note}>
                Percentages are based on {sampleSize} completed attempt{sampleSize === 1 ? '' : 's'}.
            </Text>
            <View style={styles.card}>
                <View style={styles.header}>
                    <Text style={[styles.headerText, styles.questionCol]}>Question</Text>
                    <Text style={[styles.headerText, styles.percentCol]}>Correct</Text>
                    <Text style={[styles.headerText, styles.percentCol]}>Wrong</Text>
                    <Text style={[styles.headerText, styles.percentCol]}>Skip</Text>
                </View>

                <FlatList
                    data={questions}
                    keyExtractor={(item) => item.questionNumber.toString()}
                    renderItem={({ item }) => (
                        <View style={styles.row}>
                            <View style={styles.questionCol}>
                                <Text style={styles.questionNumber}>Q{item.questionNumber}</Text>
                                {item.topicName ? (
                                    <Text style={styles.topicName}>{item.topicName}</Text>
                                ) : null}
                                <Text style={styles.counts}>
                                    {item.correctCount}C • {item.wrongCount}W • {item.skippedCount}S
                                </Text>
                            </View>
                            <View style={styles.percentCol}>
                                <Text style={[styles.percentText, styles.correctText]}>
                                    {item.percentCorrect}%
                                </Text>
                            </View>
                            <View style={styles.percentCol}>
                                <Text style={[styles.percentText, styles.wrongText]}>
                                    {item.percentWrong}%
                                </Text>
                            </View>
                            <View style={styles.percentCol}>
                                <Text style={[styles.percentText, styles.skippedText]}>
                                    {item.percentSkipped}%
                                </Text>
                            </View>
                        </View>
                    )}
                    scrollEnabled={false}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 20,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1F2937',
        marginHorizontal: 16,
        marginBottom: 4,
    },
    note: {
        fontSize: 12,
        color: '#6B7280',
        marginHorizontal: 16,
        marginBottom: 12,
    },
    empty: {
        color: '#9CA3AF',
        textAlign: 'center',
        marginHorizontal: 16,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        marginHorizontal: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        backgroundColor: '#F9FAFB',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    headerText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#6B7280',
        textTransform: 'uppercase',
    },
    row: {
        flexDirection: 'row',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    questionCol: {
        flex: 2,
        justifyContent: 'center',
    },
    percentCol: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    questionNumber: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1F2937',
    },
    topicName: {
        fontSize: 12,
        color: '#6B7280',
        marginTop: 2,
    },
    counts: {
        fontSize: 11,
        color: '#9CA3AF',
        marginTop: 4,
    },
    percentText: {
        fontSize: 14,
        fontWeight: '600',
    },
    correctText: {
        color: '#10B981',
    },
    wrongText: {
        color: '#EF4444',
    },
    skippedText: {
        color: '#9CA3AF',
    },
});
