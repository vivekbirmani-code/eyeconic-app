import React, { useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

interface SectionTabsProps {
  sections: string[];
  currentSection: string;
  onSectionChange: (section: string) => void;
  questionCounts?: { [section: string]: number };
}

export const SectionTabs: React.FC<SectionTabsProps> = ({
  sections,
  currentSection,
  onSectionChange,
  questionCounts
}) => {
  const scrollViewRef = useRef<ScrollView>(null);

  // Auto-scroll to active tab
  useEffect(() => {
    const index = sections.indexOf(currentSection);
    if (index !== -1 && scrollViewRef.current) {
      scrollViewRef.current.scrollTo({
        x: index * 120,
        animated: true
      });
    }
  }, [currentSection, sections]);

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Overview/All tab */}
        <TouchableOpacity
          style={[
            styles.tab,
            currentSection === 'All' && styles.activeTab
          ]}
          onPress={() => onSectionChange('All')}
        >
          <Text style={[
            styles.tabText,
            currentSection === 'All' && styles.activeTabText
          ]}>
            Overview
          </Text>
        </TouchableOpacity>

        {/* Section tabs */}
        {sections.map((section) => (
          <TouchableOpacity
            key={section}
            style={[
              styles.tab,
              currentSection === section && styles.activeTab
            ]}
            onPress={() => onSectionChange(section)}
          >
            <Text style={[
              styles.tabText,
              currentSection === section && styles.activeTabText
            ]}>
              {section}
            </Text>
            {questionCounts && questionCounts[section] && (
              <Text style={[
                styles.countText,
                currentSection === section && styles.activeCountText
              ]}>
                {questionCounts[section]}
              </Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    paddingVertical: 12,
  },
  tab: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activeTab: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  activeTabText: {
    color: '#FFFFFF',
  },
  countText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  activeCountText: {
    color: '#FFFFFF',
  },
});
