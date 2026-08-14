import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Users, CheckCircle, TrendingUp, Award, Target } from 'lucide-react-native';
import AnalyticsKpiGrid from '../AnalyticsKpiGrid';
import { TestOverviewData, formatPercent } from '@/types/analytics';

interface TestOverviewProps {
    overview: TestOverviewData;
    totalMarks: number;
}

export default function TestOverview({ overview, totalMarks }: TestOverviewProps) {
    const items = [
        {
            icon: Users,
            value: String(overview.totalAssigned),
            label: 'Assigned',
            color: '#6366F1',
        },
        {
            icon: CheckCircle,
            value: String(overview.totalAttempted),
            label: 'Completed',
            color: '#01b4ae',
        },
        {
            icon: TrendingUp,
            value: `${overview.completionRate}%`,
            label: 'Completion',
            color: '#10B981',
        },
        {
            icon: Target,
            value: formatPercent(overview.avgScorePercentage),
            label: 'Avg Score %',
            color: '#2563EB',
            sublabel: 'marks-based',
        },
        {
            icon: Target,
            value: formatPercent(overview.avgAccuracy, 'N/A'),
            label: 'Avg Accuracy',
            color: '#7C3AED',
            sublabel: overview.avgAccuracy === null ? 'No attempted questions' : 'correct / attempted',
        },
        {
            icon: TrendingUp,
            value: `${overview.avgScore}/${totalMarks}`,
            label: 'Avg Marks',
            color: '#F59E0B',
        },
        {
            icon: Award,
            value: `${overview.highestScore}/${totalMarks}`,
            label: 'Highest Marks',
            color: '#10B981',
        },
        {
            icon: Award,
            value: `${overview.lowestScore}/${totalMarks}`,
            label: 'Lowest Marks',
            color: '#EF4444',
        },
    ];

    return (
        <View style={styles.container}>
            <AnalyticsKpiGrid items={items} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 8,
    },
});
