import React, { useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Check } from 'lucide-react-native';

export type SectionTabStatus = 'locked' | 'active' | 'upcoming';

interface SectionTabsProps {
  sections: string[];
  currentSection: string;
  onSectionChange: (section: string) => void;
  questionCounts?: { [section: string]: number };
  // Optional per-section status (section locking). Absent = every tab is
  // tappable, exactly as before the feature existed.
  sectionStatuses?: { [section: string]: SectionTabStatus };
}

export const SectionTabs: React.FC<SectionTabsProps> = ({
  sections,
  currentSection,
  onSectionChange,
  questionCounts,
  sectionStatuses
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


        {/* Section tabs */}
        {sections.map((section) => {
          const status = sectionStatuses?.[section];
          const isLocked = status === 'locked';
          const isUpcoming = status === 'upcoming';

          return (
            <TouchableOpacity
              key={section}
              style={[
                styles.tab,
                currentSection === section && styles.activeTab,
                isLocked && styles.lockedTab,
                isUpcoming && styles.upcomingTab
              ]}
              onPress={() => onSectionChange(section)}
              disabled={isLocked || isUpcoming}
              accessibilityLabel={
                isLocked ? `${section} — submitted` :
                isUpcoming ? `${section} — opens after the current section is submitted` :
                section
              }
            >
              {isLocked && <Check size={14} color="#9CA3AF" strokeWidth={2.5} />}
              <Text style={[
                styles.tabText,
                currentSection === section && styles.activeTabText,
                (isLocked || isUpcoming) && styles.mutedTabText
              ]}>
                {section}
              </Text>
              {isLocked && (
                <Text style={styles.submittedLabel}>Submitted</Text>
              )}
              {questionCounts && (questionCounts[section] || 0) > 0 && (
                <Text style={[
                  styles.countText,
                  currentSection === section && styles.activeCountText,
                  (isLocked || isUpcoming) && styles.mutedTabText
                ]}>
                  {questionCounts[section]}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
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
  lockedTab: {
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
    opacity: 0.85,
  },
  upcomingTab: {
    opacity: 0.55,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  activeTabText: {
    color: '#FFFFFF',
  },
  mutedTabText: {
    color: '#9CA3AF',
  },
  submittedLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
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
