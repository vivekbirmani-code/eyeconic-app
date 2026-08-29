import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LucideIcon } from 'lucide-react-native';

export interface MetricItem {
  key: string;
  label: string;
  value: string | number;
  icon: LucideIcon;
  iconColor: string;
  accessibilityLabel?: string;
}

interface PerformanceMetricGridProps {
  metrics: MetricItem[];
  columns?: 2 | 3;
}

export function PerformanceMetricGrid({ metrics, columns = 3 }: PerformanceMetricGridProps) {
  const rows: MetricItem[][] = [];
  for (let i = 0; i < metrics.length; i += columns) {
    rows.push(metrics.slice(i, i + columns));
  }

  return (
    <View style={styles.container}>
      {rows.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={styles.row}>
          {row.map((metric) => {
            const Icon = metric.icon;
            return (
              <View
                key={metric.key}
                style={[styles.card, columns === 2 && styles.cardTwoCol]}
                accessible
                accessibilityRole="text"
                accessibilityLabel={metric.accessibilityLabel || `${metric.label}: ${metric.value}`}
              >
                <Icon color={metric.iconColor} size={24} />
                <Text style={styles.value}>{metric.value}</Text>
                <Text style={styles.label}>{metric.label}</Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  card: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  cardTwoCol: {
    minWidth: '46%',
  },
  value: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
    marginTop: 8,
  },
  label: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
    textAlign: 'center',
  },
});
