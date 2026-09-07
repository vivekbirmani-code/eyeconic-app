import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DataTable, DataTableColumn } from '@/components/DataTable';

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

    // The question column is the flexible one — it absorbs leftover width on
    // larger devices; the fixed stat columns are guaranteed enough room for
    // their headers, so "CORRECT" can never break mid-word. When even the
    // minimums exceed the viewport, the table scrolls horizontally inside the
    // card (see DataTable).
    const columns: Array<DataTableColumn<QuestionAnalytic>> = [
        {
            key: 'question',
            header: 'Question',
            width: 110,
            grow: true,
            renderCell: (item) => (
                <View>
                    <Text style={styles.questionNumber}>Q{item.questionNumber}</Text>
                    {item.topicName ? (
                        <Text style={styles.topicName} numberOfLines={2}>
                            {item.topicName}
                        </Text>
                    ) : null}
                    <Text style={styles.counts} numberOfLines={1}>
                        {item.correctCount}C • {item.wrongCount}W • {item.skippedCount}S
                    </Text>
                </View>
            ),
        },
        {
            key: 'correct',
            header: 'Correct',
            width: 60,
            align: 'center',
            renderCell: (item) => (
                <Text style={[styles.percentText, styles.correctText]} numberOfLines={1}>
                    {item.percentCorrect}%
                </Text>
            ),
        },
        {
            key: 'wrong',
            header: 'Wrong',
            width: 60,
            align: 'center',
            renderCell: (item) => (
                <Text style={[styles.percentText, styles.wrongText]} numberOfLines={1}>
                    {item.percentWrong}%
                </Text>
            ),
        },
        {
            key: 'skip',
            header: 'Skip',
            width: 60,
            align: 'center',
            renderCell: (item) => (
                <Text style={[styles.percentText, styles.skippedText]} numberOfLines={1}>
                    {item.percentSkipped}%
                </Text>
            ),
        },
    ];

    return (
        <View style={styles.container}>
            <Text style={styles.sectionTitle}>Question-wise Analytics</Text>
            <Text style={styles.note}>
                Percentages are based on {sampleSize} completed attempt{sampleSize === 1 ? '' : 's'}.
            </Text>
            <DataTable
                columns={columns}
                data={questions}
                keyExtractor={(item) => item.questionNumber.toString()}
                cellPadding={16}
                style={styles.card}
            />
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
        marginHorizontal: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
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
