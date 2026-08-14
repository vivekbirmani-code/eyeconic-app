import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';

export default function ScoreLegend() {
  return (
    <View style={styles.container}>
      <Info color="#6B7280" size={16} />
      <View style={styles.textBlock}>
        <Text style={styles.line}>
          <Text style={styles.term}>Score %</Text> = marks obtained ÷ maximum marks
        </Text>
        <Text style={styles.line}>
          <Text style={styles.term}>Accuracy</Text> = correct ÷ attempted (skipped excluded)
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  textBlock: {
    flex: 1,
    gap: 4,
  },
  line: {
    fontSize: 12,
    color: '#374151',
    lineHeight: 18,
  },
  term: {
    fontWeight: '700',
    color: '#1D4ED8',
  },
});
