import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export interface ChartSlice {
  key: string;
  label: string;
  count: number;
  color: string;
}

interface PerformanceChartProps {
  data: ChartSlice[];
  title?: string;
}

export function PerformanceChart({ data, title = 'Question Distribution' }: PerformanceChartProps) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  const maxCount = Math.max(...data.map((item) => item.count), 1);

  return (
    <View style={styles.container} accessible accessibilityRole="summary">
      <Text style={styles.title}>{title}</Text>

      {total === 0 ? (
        <Text style={styles.emptyText}>No question data available.</Text>
      ) : (
        <View style={styles.chartArea}>
          {data.map((item) => {
            const widthPercent = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
            return (
              <View key={item.key} style={styles.row} accessibilityLabel={`${item.label}: ${item.count}`}>
                <View style={styles.labelColumn}>
                  <View style={[styles.dot, { backgroundColor: item.color }]} />
                  <Text style={styles.label} numberOfLines={1}>{item.label}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        backgroundColor: item.color,
                        width: `${Math.max(widthPercent, item.count > 0 ? 8 : 0)}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.count}>{item.count}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    paddingVertical: 12,
  },
  chartArea: {
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  labelColumn: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 110,
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  label: {
    fontSize: 13,
    color: '#374151',
    flex: 1,
  },
  barTrack: {
    flex: 1,
    height: 12,
    backgroundColor: '#F3F4F6',
    borderRadius: 6,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 6,
    minWidth: 0,
  },
  count: {
    width: 28,
    fontSize: 15,
    fontWeight: '700',
    color: '#1F2937',
    textAlign: 'right',
  },
});
