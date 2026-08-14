import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LucideIcon } from 'lucide-react-native';

export interface KpiItem {
  icon?: LucideIcon;
  value: string;
  label: string;
  color?: string;
  sublabel?: string;
}

interface AnalyticsKpiGridProps {
  items: KpiItem[];
}

export default function AnalyticsKpiGrid({ items }: AnalyticsKpiGridProps) {
  return (
    <View style={styles.grid}>
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <View key={`${item.label}-${index}`} style={styles.card}>
            {Icon ? <Icon color={item.color || '#01b4ae'} size={22} /> : null}
            <Text style={styles.value} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
              {item.value}
            </Text>
            <Text style={styles.label}>{item.label}</Text>
            {item.sublabel ? <Text style={styles.sublabel}>{item.sublabel}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 16,
  },
  card: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    minHeight: 100,
  },
  value: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1F2937',
    marginTop: 6,
    textAlign: 'center',
  },
  label: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
    textAlign: 'center',
  },
  sublabel: {
    fontSize: 10,
    color: '#9CA3AF',
    marginTop: 2,
    textAlign: 'center',
  },
});
