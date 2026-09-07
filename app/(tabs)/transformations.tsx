import React, { useState, useRef, useEffect } from 'react';
import { withFeatureGate } from '@/components/withFeatureGate';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Animated,
  StatusBar,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { Menu, Sparkles, TrendingUp, Award, Quote } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from '@/utils/haptics';
import FreeUserSidebar from '@/components/FreeUserSidebar';

const { width } = Dimensions.get('window');

const stories = [
  {
    name: 'Dr. Aarav Mehta',
    from: 'GT Rank: 38,000',
    to: 'NEET PG Rank: 480',
    subject: 'Radiology MD',
    quote: 'The study schedules and daily targets kept me consistent. Eyeconic Mentors completely structured my revision cycles when I was feeling lost.',
    color: '#01b4ae'
  },
  {
    name: 'Dr. Sneha Paul',
    from: 'GT Rank: 45,000',
    to: 'NEET PG Rank: 1,120',
    subject: 'General Medicine MD',
    quote: 'GT tracker analytics pointed out my weakest subjects. Once we worked on pharmacology and biochemistry with my mentor, my marks skyrocketed.',
    color: '#8B5CF6'
  },
  {
    name: 'Dr. Vikram Rathore',
    from: 'GT Rank: 25,000',
    to: 'NEET PG Rank: 850',
    subject: 'Orthopedics MS',
    quote: 'Consistency was my main issue. The daily quiz streak and group environment forced me to study even on my low days.',
    color: '#F59E0B'
  }
];

function Transformations() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

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
        <Text style={styles.headerTitle}>Transformations</Text>
        <Sparkles color="#01b4ae" size={22} />
      </View>

      <ScrollView 
        style={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          {/* Intro Card */}
          <View style={styles.introCard}>
            <LinearGradient
              colors={['#01b4ae', '#009d99']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.introGradient}
            >
              <Award color="#FFFFFF" size={32} />
              <Text style={styles.introTitle}>From Lost to Top Rank</Text>
              <Text style={styles.introDesc}>
                Real results from students who transformed their prep using our strategic mentoring systems.
              </Text>
            </LinearGradient>
          </View>

          {/* Stories List */}
          <Text style={styles.sectionTitle}>Hall of Fame</Text>
          {stories.map((story, index) => (
            <View key={index} style={styles.storyCard}>
              <View style={styles.cardHeader}>
                <View style={styles.avatarContainer}>
                  <Text style={styles.avatarText}>{story.name.charAt(4)}</Text>
                </View>
                <View style={styles.nameContainer}>
                  <Text style={styles.studentName}>{story.name}</Text>
                  <Text style={styles.studentSpecialty}>{story.subject}</Text>
                </View>
              </View>

              {/* Transformation Indicator */}
              <View style={styles.rankContainer}>
                <View style={styles.rankBadge}>
                  <Text style={styles.rankLabel}>Before</Text>
                  <Text style={styles.rankValOld}>{story.from.split(': ')[1]}</Text>
                </View>
                <View style={styles.arrowContainer}>
                  <TrendingUp color="#10B981" size={20} />
                  <Text style={styles.arrowText}>Rank Jump</Text>
                </View>
                <View style={[styles.rankBadge, { backgroundColor: 'rgba(16, 185, 129, 0.1)' }]}>
                  <Text style={[styles.rankLabel, { color: '#10B981' }]}>After</Text>
                  <Text style={[styles.rankValNew, { color: '#10B981' }]}>{story.to.split(': ')[1]}</Text>
                </View>
              </View>

              {/* Quote */}
              <View style={styles.quoteContainer}>
                <Quote size={20} color="#CBD5E1" style={styles.quoteIcon} />
                <Text style={styles.quoteText}>{story.quote}</Text>
              </View>
            </View>
          ))}
        </Animated.View>
      </ScrollView>

      {/* Global Free User Sidebar */}
      <FreeUserSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
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
  },
  introCard: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 24,
    elevation: 4,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  introGradient: {
    padding: 24,
    alignItems: 'center',
  },
  introTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 12,
    marginBottom: 6,
  },
  introDesc: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.85)',
    textAlign: 'center',
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 16,
    letterSpacing: 0.2,
  },
  storyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(229, 231, 235, 0.7)',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0FDFA',
    borderWidth: 1.5,
    borderColor: '#01b4ae',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#01b4ae',
  },
  nameContainer: {
    marginLeft: 12,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  studentSpecialty: {
    fontSize: 13,
    color: '#01b4ae',
    fontWeight: '600',
  },
  rankContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  rankBadge: {
    alignItems: 'center',
    flex: 1,
    backgroundColor: 'rgba(107, 114, 128, 0.08)',
    borderRadius: 8,
    paddingVertical: 6,
  },
  rankLabel: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  rankValOld: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4B5563',
  },
  rankValNew: {
    fontSize: 14,
    fontWeight: '800',
  },
  arrowContainer: {
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  arrowText: {
    fontSize: 9,
    color: '#10B981',
    fontWeight: '700',
    marginTop: 2,
  },
  quoteContainer: {
    flexDirection: 'row',
    position: 'relative',
    paddingLeft: 22,
  },
  quoteIcon: {
    position: 'absolute',
    left: 0,
    top: -2,
  },
  quoteText: {
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 18,
    fontStyle: 'italic',
  },
});
// TEMPORARY FEATURE FREEZE — quiz-only availability (utils/featureAvailability.ts).
export default withFeatureGate('freeUserContent')(Transformations);
