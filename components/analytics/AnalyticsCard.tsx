import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LucideIcon } from 'lucide-react-native';

interface AnalyticsCardProps {
    icon: LucideIcon;
    value: string | number;
    label: string;
    color?: string;
}

export default function AnalyticsCard({ icon: Icon, value, label, color = '#01b4ae' }: AnalyticsCardProps) {
    return (
        <View style={styles.card}>
            <Icon color={color} size={24} />
            <Text style={styles.value}>{value}</Text>
            <Text style={styles.label}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        flex: 1,
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(1, 180, 174, 0.15)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 3,
        minWidth: 100,
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
