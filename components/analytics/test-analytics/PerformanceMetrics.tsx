import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
            {/* Wrap grid, not a horizontal carousel: the four metrics are a
                2×2 block that fills the row evenly on every phone width
                (same geometry as the TestOverview KPI grid). */}
            <View style={styles.grid}>
                {metricCards.map((metric, index) => {
                    const Icon = metric.icon;
                    return (
                        <View
                            key={index}
                            style={[styles.card, { backgroundColor: metric.bgColor }]}
                        >
                            <Icon color={metric.color} size={22} />
                            <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                                {metric.value}
                            </Text>
                            <Text style={styles.label}>{metric.label}</Text>
                        </View>
                    );
                })}
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
        marginBottom: 12,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        paddingHorizontal: 16,
    },
    // '47%' + flexGrow pairs fill each row; two cards + the 12 gap always fit
    // because the gap is absolute and the widths are relative.
    card: {
        width: '47%',
        flexGrow: 1,
        minHeight: 104,
        padding: 14,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.05)',
    },
    value: {
        fontSize: 22,
        fontWeight: '700',
        color: '#1F2937',
        marginTop: 6,
    },
    label: {
        fontSize: 12,
        color: '#6B7280',
        textAlign: 'center',
    },
});
