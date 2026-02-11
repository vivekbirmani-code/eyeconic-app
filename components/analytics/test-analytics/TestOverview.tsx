import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Users, CheckCircle, TrendingUp, TrendingDown, Award } from 'lucide-react-native';
import AnalyticsCard from '../AnalyticsCard';

interface Overview {
    totalAssigned: number;
    totalAttempted: number;
    completionRate: number;
    avgScore: number;
    highestScore: number;
    lowestScore: number;
}

interface TestOverviewProps {
    overview: Overview;
    totalMarks: number;
}

export default function TestOverview({ overview, totalMarks }: TestOverviewProps) {
    return (
        <View style={styles.container}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
            >
                <AnalyticsCard
                    icon={Users}
                    value={overview.totalAssigned}
                    label="Assigned"
                    color="#6366F1"
                />
                <AnalyticsCard
                    icon={CheckCircle}
                    value={overview.totalAttempted}
                    label="Attempted"
                    color="#01b4ae"
                />
                <AnalyticsCard
                    icon={TrendingUp}
                    value={`${overview.completionRate}%`}
                    label="Completion"
                    color="#10B981"
                />
                <AnalyticsCard
                    icon={TrendingUp}
                    value={`${overview.avgScore}/${totalMarks}`}
                    label="Avg Score"
                    color="#F59E0B"
                />
                <AnalyticsCard
                    icon={Award}
                    value={`${overview.highestScore}/${totalMarks}`}
                    label="Highest"
                    color="#10B981"
                />
                <AnalyticsCard
                    icon={TrendingDown}
                    value={`${overview.lowestScore}/${totalMarks}`}
                    label="Lowest"
                    color="#EF4444"
                />
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 20,
    },
    scrollContent: {
        paddingHorizontal: 16,
        gap: 12,
    },
});
