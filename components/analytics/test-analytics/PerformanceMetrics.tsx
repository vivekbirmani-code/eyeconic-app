import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { CheckCircle, XCircle, MinusCircle, Clock } from 'lucide-react-native';

interface PerformanceMetrics {
    totalQuestions: number;
    avgCorrect: string | number;
    avgWrong: string | number;
    avgSkipped: string | number;
    avgTime: number;
}

interface PerformanceMetricsProps {
    metrics: PerformanceMetrics;
}

export default function PerformanceMetrics({ metrics }: PerformanceMetricsProps) {
    const metricCards = [
        {
            icon: CheckCircle,
            value: metrics.avgCorrect,
            label: 'Avg Correct',
            color: '#10B981',
            bgColor: 'rgba(16, 185, 129, 0.1)',
        },
        {
            icon: XCircle,
            value: metrics.avgWrong,
            label: 'Avg Wrong',
            color: '#EF4444',
            bgColor: 'rgba(239, 68, 68, 0.1)',
        },
        {
            icon: MinusCircle,
            value: metrics.avgSkipped,
            label: 'Avg Skipped',
            color: '#9CA3AF',
            bgColor: 'rgba(156, 163, 175, 0.1)',
        },
        {
            icon: Clock,
            value: `${metrics.avgTime} min`,
            label: 'Avg Time',
            color: '#F59E0B',
            bgColor: 'rgba(245, 158, 11, 0.1)',
        },
    ];

    return (
        <View style={styles.container}>
            <Text style={styles.sectionTitle}>Performance Metrics</Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
            >
                {metricCards.map((metric, index) => {
                    const Icon = metric.icon;
                    return (
                        <View key={index} style={[styles.card, { backgroundColor: metric.bgColor }]}>
                            <Icon color={metric.color} size={24} />
                            <Text style={styles.value}>{metric.value}</Text>
                            <Text style={styles.label}>{metric.label}</Text>
                        </View>
                    );
                })}
            </ScrollView>
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
        marginBottom: 12,
    },
    scrollContent: {
        paddingHorizontal: 16,
        gap: 12,
    },
    card: {
        width: 140,
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.05)',
    },
    value: {
        fontSize: 24,
        fontWeight: '700',
        color: '#1F2937',
        marginTop: 8,
    },
    label: {
        fontSize: 12,
        color: '#6B7280',
        marginTop: 4,
        textAlign: 'center',
    },
});
