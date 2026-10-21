import React, { useState, useRef, useEffect, useCallback } from 'react';
import { withFeatureGate } from '@/components/withFeatureGate';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { useFocusEffect } from '@react-navigation/native';
import { Menu, BarChart2, TrendingUp, Info, Percent, Activity } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from '@/utils/haptics';
import FreeUserSidebar from '@/components/FreeUserSidebar';
import { useAuth } from '@/context/AuthContext';
import {
  CHART_Y_AXIS_MAX,
  GtChartEntry,
  getBarHeightPercent,
  loadGtLogs,
  toChartEntries,
} from '@/utils/gtTracker';

const subjectAccuracy = [
  { name: 'Anatomy', accuracy: 72, color: '#10B981' },
  { name: 'Biochemistry', accuracy: 84, color: '#01b4ae' },
  { name: 'Pharmacology', accuracy: 68, color: '#F59E0B' },
  { name: 'Microbiology', accuracy: 79, color: '#8B5CF6' },
  { name: 'General Medicine', accuracy: 82, color: '#EC4899' }
];

function Graphs() {
  const { user } = useAuth();
  const { fontScale } = useWindowDimensions();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [gtChartData, setGtChartData] = useState<GtChartEntry[]>([]);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  const refreshGtChart = useCallback(async () => {
    if (!user?._id) {
      setGtChartData([]);
      return;
    }

    const logs = await loadGtLogs(user._id);
    setGtChartData(toChartEntries(logs));
  }, [user?._id]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      })
    ]).start();
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshGtChart();
    }, [refreshGtChart])
  );

  const handleSidebarClose = () => {
    setSidebarOpen(false);
    refreshGtChart();
  };

  return (
    <ScreenContainer style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient
        colors={['rgba(1, 180, 174, 0.15)', 'rgba(1, 180, 174, 0.05)', '#FFFFFF']}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setSidebarOpen(true);
          }}
          style={styles.menuButton}
          activeOpacity={0.7}
        >
          <Menu color="#111827" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Analytics Tracker</Text>
        <BarChart2 color="#01b4ae" size={22} />
      </View>

      <ScrollView 
        style={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          
          {/* Target Banner */}
          <View style={styles.targetBanner}>
            <TrendingUp color="#01b4ae" size={24} style={styles.bannerIcon} />
            <View style={styles.bannerTextContainer}>
              <Text style={styles.bannerTitle}>Target Score: 150+ Corrects</Text>
              <Text style={styles.bannerDesc}>Track your progression towards securing a top MD/MS branch seat.</Text>
            </View>
          </View>

          {/* Grand Test Progression Chart */}
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>GT Corrects progression</Text>
            <Text style={styles.chartSubtitle}>Progress across your logged mock tests</Text>

            {gtChartData.length === 0 ? (
              <View style={styles.emptyChartCard}>
                <Activity color="#CBD5E1" size={36} />
                <Text style={styles.emptyChartTitle}>No GT logs yet</Text>
                <Text style={styles.emptyChartText}>
                  Open the menu and use GT Tracker to log your mock test corrects. Your bars will appear here automatically.
                </Text>
              </View>
            ) : (
              <View style={[styles.chartContainer, { height: Math.ceil(180 * Math.max(fontScale, 1)) }]}>
                <View style={styles.yAxis}>
                  <Text style={styles.axisText}>{CHART_Y_AXIS_MAX}</Text>
                  <Text style={styles.axisText}>120</Text>
                  <Text style={styles.axisText}>80</Text>
                  <Text style={styles.axisText}>40</Text>
                </View>

                <View style={styles.barsContainer}>
                  {gtChartData.map((gt) => {
                    const barHeight = getBarHeightPercent(gt.corrects);
                    return (
                      <View key={gt.id} style={styles.barColumn}>
                        <View style={styles.barTrack}>
                          <LinearGradient
                            colors={['#01b4ae', 'rgba(1, 180, 174, 0.4)']}
                            style={[styles.barFill, { height: `${barHeight}%` }]}
                          >
                            <Text style={styles.barValueText}>{gt.corrects}</Text>
                          </LinearGradient>
                        </View>
                        <Text style={styles.barLabel} numberOfLines={2} maxFontSizeMultiplier={1.3}>{gt.testName}</Text>
                        <Text style={styles.barDate} numberOfLines={1} maxFontSizeMultiplier={1.3}>{gt.date}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </View>

          {/* Subject Strengths & Weaknesses */}
          <View style={styles.chartCard}>
            <View style={styles.accuracyHeader}>
              <Text style={styles.chartTitle}>Subject Accuracy</Text>
              <Percent color="#01b4ae" size={18} />
            </View>
            <Text style={styles.chartSubtitle}>Accuracy breakdown from recent tests</Text>

            <View style={styles.accuracyList}>
              {subjectAccuracy.map((subject, index) => (
                <View key={index} style={styles.accuracyItem}>
                  <View style={styles.accuracyTextRow}>
                    <Text style={styles.subjectName}>{subject.name}</Text>
                    <Text style={[styles.subjectValue, { color: subject.color }]}>{subject.accuracy}%</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View 
                      style={[
                        styles.progressFill, 
                        { width: `${subject.accuracy}%`, backgroundColor: subject.color }
                      ]} 
                    />
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* Info Banner */}
          <View style={styles.infoCard}>
            <Info color="#6B7280" size={18} />
            <Text style={styles.infoCardText}>
              Log your Grand Test scores in GT Tracker to update this chart. Quizzes assigned by Eyeconic Mentors admins also refine your subject accuracy over time.
            </Text>
          </View>

        </Animated.View>
      </ScrollView>

      <FreeUserSidebar isOpen={sidebarOpen} onClose={handleSidebarClose} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.05)',
    backgroundColor: '#FFFFFF',
    zIndex: 10,
  },
  menuButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: 0.3,
  },
  scrollContainer: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
    gap: 20,
  },
  targetBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDFA',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.2)',
  },
  bannerIcon: {
    marginRight: 14,
  },
  bannerTextContainer: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f766e',
  },
  bannerDesc: {
    fontSize: 12,
    color: '#0d9488',
    marginTop: 2,
    lineHeight: 16,
  },
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(229, 231, 235, 0.7)',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  chartSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    marginBottom: 20,
  },
  emptyChartCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  emptyChartTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
    marginTop: 4,
  },
  emptyChartText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  chartContainer: {
    flexDirection: 'row',
    // Height is set inline (fontScale-aware): the label/date zone below the
    // 120dp track must grow with the user's font scale or the date clips.
    paddingTop: 10,
  },
  yAxis: {
    justifyContent: 'space-between',
    paddingBottom: 24,
    paddingRight: 10,
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
  },
  axisText: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
    textAlign: 'right',
  },
  barsContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    paddingLeft: 10,
  },
  barColumn: {
    alignItems: 'center',
    flex: 1,
    maxWidth: 72,
    // No minWidth: six columns must be able to compress down to the fixed
    // 24dp barTrack width on narrow phones — a 44dp floor overflowed the card
    // at ≤340dp with no wrap or scroll to catch it.
  },
  barTrack: {
    height: 120,
    width: 24,
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: 6,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 4,
  },
  barValueText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  barLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#334155',
    marginTop: 6,
    textAlign: 'center',
  },
  barDate: {
    fontSize: 9,
    color: '#94A3B8',
    marginTop: 1,
    textAlign: 'center',
  },
  accuracyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  accuracyList: {
    gap: 16,
  },
  accuracyItem: {
    width: '100%',
  },
  accuracyTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  subjectName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  subjectValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  progressTrack: {
    height: 8,
    width: '100%',
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  infoCardText: {
    flex: 1,
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
  },
});
// TEMPORARY FEATURE FREEZE — quiz-only availability (utils/featureAvailability.ts).
export default withFeatureGate('freeUserContent')(Graphs);
