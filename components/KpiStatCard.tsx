import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { LucideIcon } from 'lucide-react-native';

interface KpiStatCardProps {
  icon: LucideIcon;
  value: string | number;
  label: string;
  backgroundColor: string;
  iconColor: string;
  valueColor: string;
  labelColor: string;
  width: number;
  style?: ViewStyle;
}

export function KpiStatCard({
  icon: Icon,
  value,
  label,
  backgroundColor,
  iconColor,
  valueColor,
  labelColor,
  width,
  style,
}: KpiStatCardProps) {
  return (
    <View style={[styles.card, { backgroundColor, width }, style]}>
      <Icon color={iconColor} size={22} />

      <Text
        style={[styles.value, { color: valueColor }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.65}
      >
        {value}
      </Text>

      <Text style={[styles.label, { color: labelColor }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 16,
    alignItems: 'center',
    gap: 6,
  },
  value: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
    lineHeight: 28,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    width: '100%',
  },
});
