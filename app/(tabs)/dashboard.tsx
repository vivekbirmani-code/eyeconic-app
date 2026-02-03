import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  Platform,
  StatusBar,
  Animated,
  Pressable
} from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';
import { LogOut, AlertTriangle, Check } from 'lucide-react-native';
import * as Haptics from '@/utils/haptics';
import { LinearGradient } from 'expo-linear-gradient';

interface StudentProfile {
  mbbsBatch: string;
  collegeName: string;
  attemptNo: string;
  batchType: string;
  grandTestsGiven: string;
  averageCorrects: string;
  averageScore: string;
  weakestSubjects: string;
  targetBranch: string;
  subscriptions: string;
}

export default function Dashboard() {
  const { user, logout, refreshUser } = useAuth();
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [profile, setProfile] = useState<StudentProfile>({
    mbbsBatch: '',
    collegeName: '',
    attemptNo: '1',
    batchType: 'FOUNDATION',
    grandTestsGiven: '',
    averageCorrects: '',
    averageScore: '',
    weakestSubjects: '',
    targetBranch: '',
    subscriptions: ''
  });

  // Animation refs
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const card1TranslateY = useRef(new Animated.Value(20)).current;
  const card1Opacity = useRef(new Animated.Value(0)).current;
  const card2TranslateY = useRef(new Animated.Value(20)).current;
  const card2Opacity = useRef(new Animated.Value(0)).current;
  const navOpacity = useRef(new Animated.Value(0)).current;

  // Skeleton to content fade
  const contentOpacity = useRef(new Animated.Value(0)).current;

  // Entry animations on mount
  useEffect(() => {
    // Simulate data loading (replace with actual data fetching if needed)
    const loadData = setTimeout(() => {
      setIsDataLoading(false);

      // Fade in actual content
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }, 800);

    // Header animation
    Animated.timing(headerOpacity, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    // Card 1 animation (delayed)
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(card1Opacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.spring(card1TranslateY, {
          toValue: 0,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();
    }, 200);

    // Card 2 animation (more delayed)
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(card2Opacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.spring(card2TranslateY, {
          toValue: 0,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();
    }, 350);

    // Bottom nav animation
    setTimeout(() => {
      Animated.timing(navOpacity, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }, 500);

    return () => clearTimeout(loadData);
  }, []);

  // Check if student needs to complete profile
  useEffect(() => {
    // Show modal if student and profile is not complete (includes undefined)
    if (user?.role === 'student' && user?.isProfileComplete !== true) {
      setShowProfileModal(true);
    }
  }, [user]);

  const handleLogout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    logout();
  };

  const getRoleDisplayName = (role: string) => {
    switch (role) {
      case 'admin': return 'Administrator';
      case 'mentor': return 'Mentor';
      case 'student': return 'Student';
      default: return 'User';
    }
  };

  const handleSubmitProfile = async () => {
    if (!profile.mbbsBatch || !profile.collegeName || !profile.batchType) {
      Alert.alert('Error', 'Please fill in all required fields (MBBS Batch, College Name, Batch Type)');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.put('/users/profile', {
        ...profile,
        attemptNo: parseInt(profile.attemptNo) || 1,
        averageScore: parseInt(profile.averageScore) || 0
      });

      // Refresh user data to update isProfileComplete
      if (refreshUser) {
        await refreshUser();
      }

      setShowProfileModal(false);
      Alert.alert('Success', 'Profile completed successfully!');
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to save profile';
      Alert.alert('Error', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const batchTypes = ['FOUNDATION', 'REGULAR', 'CRASH COURSE', 'TEST SERIES'];

  return (
    <SafeAreaView style={styles.container}>
      {/* Minimal premium top glow effect */}
      <LinearGradient
        colors={[
          'rgba(1, 180, 174, 0.18)',
          'rgba(1, 180, 174, 0.08)',
          'rgba(255, 255, 255, 0)'
        ]}
        locations={[0, 0.5, 1]}
        style={styles.topGlow}
      />

      {/* Enhanced Animated Header with gradient */}
      <Animated.View style={[{ opacity: headerOpacity }]}>
        <LinearGradient
          colors={['#01b4ae', '#009d99', '#01b4ae']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.headerGradient}
        >
          <View style={styles.headerContent}>
            <View style={styles.headerTextContainer}>
              <Text style={styles.title}>Eyeconic Dashboard</Text>
              <Text style={styles.subtitle}>Hi, {user?.name} 👋</Text>
            </View>
            <Pressable
              style={styles.logoutButton}
              onPress={handleLogout}
              android_ripple={{ color: 'rgba(255, 255, 255, 0.3)' }}
            >
              <LogOut color="#FFFFFF" size={20} />
            </Pressable>
          </View>
        </LinearGradient>
      </Animated.View>

      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Enhanced Welcome Card with label/value formatting */}
        <Animated.View
          style={[
            {
              opacity: card1Opacity,
              transform: [{ translateY: card1TranslateY }],
            },
          ]}
        >
          <Pressable
            style={({ pressed }) => [
              styles.card,
              pressed && styles.cardPressed,
            ]}
            onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          >
            <Text style={styles.cardTitle}>Welcome Back!</Text>

            {isDataLoading ? (
              // Enhanced skeleton loading
              <>
                <View style={[styles.skeleton, styles.skeletonText, { marginBottom: 12 }]} />
                <View style={[styles.skeleton, styles.skeletonText, { marginBottom: 12 }]} />
                <View style={[styles.skeleton, styles.skeletonTextSmall]} />
              </>
            ) : (
              <Animated.View style={{ opacity: contentOpacity }}>
                {/* Label/Value styling for better readability */}
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Name</Text>
                  <Text style={styles.infoValue}>{user?.name}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Email</Text>
                  <Text style={styles.infoValueEmail}>{user?.email}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Role</Text>
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleBadgeText}>{getRoleDisplayName(user?.role || '')}</Text>
                  </View>
                </View>
              </Animated.View>
            )}
          </Pressable>
        </Animated.View>

        {/* Enhanced Quick Actions Card */}
        <Animated.View
          style={[
            {
              opacity: card2Opacity,
              transform: [{ translateY: card2TranslateY }],
            },
          ]}
        >
          <Pressable
            style={({ pressed }) => [
              styles.card,
              pressed && styles.cardPressed,
            ]}
            onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          >
            <Text style={styles.cardTitle}>Quick Actions</Text>

            {isDataLoading ? (
              // Skeleton loading
              <View style={[styles.skeleton, styles.skeletonText]} />
            ) : (
              <Animated.View style={{ opacity: contentOpacity }}>
                <Text style={styles.cardDescription}>
                  {user?.role === 'admin' && 'Manage users, groups, and quizzes'}
                  {user?.role === 'mentor' && 'View your groups and interact with students'}
                  {user?.role === 'student' && 'Join groups and attempt quizzes'}
                </Text>
              </Animated.View>
            )}
          </Pressable>
        </Animated.View>
      </ScrollView>

      {/* Student Profile Completion Modal */}
      <Modal visible={showProfileModal} animationType="slide" transparent={false}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <View style={styles.urgentBanner}>
              <AlertTriangle color="#DC2626" size={24} />
              <Text style={styles.urgentText}>Complete Your Profile</Text>
            </View>
            <Text style={styles.modalSubtitle}>
              Please fill in your details to continue using the app
            </Text>
          </View>

          <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
            {/* Basic Info */}
            <Text style={styles.sectionTitle}>Basic Information</Text>

            <Text style={styles.inputLabel}>MBBS Batch *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 2019"
              placeholderTextColor="#9CA3AF"
              value={profile.mbbsBatch}
              onChangeText={(text) => setProfile({ ...profile, mbbsBatch: text })}
            />

            <Text style={styles.inputLabel}>College Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., AIIMS Delhi"
              placeholderTextColor="#9CA3AF"
              value={profile.collegeName}
              onChangeText={(text) => setProfile({ ...profile, collegeName: text })}
            />

            <Text style={styles.inputLabel}>Attempt Number</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 2"
              placeholderTextColor="#9CA3AF"
              value={profile.attemptNo}
              onChangeText={(text) => setProfile({ ...profile, attemptNo: text })}
              keyboardType="numeric"
            />

            <Text style={styles.inputLabel}>Batch Type *</Text>
            <View style={styles.batchTypeContainer}>
              {batchTypes.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.batchTypeButton,
                    profile.batchType === type && styles.batchTypeButtonActive
                  ]}
                  onPress={() => setProfile({ ...profile, batchType: type })}
                >
                  <Text style={[
                    styles.batchTypeText,
                    profile.batchType === type && styles.batchTypeTextActive
                  ]}>{type}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Performance Info */}
            <Text style={styles.sectionTitle}>Performance Data</Text>

            <Text style={styles.inputLabel}>No. of Grand Tests Given</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 7-8"
              placeholderTextColor="#9CA3AF"
              value={profile.grandTestsGiven}
              onChangeText={(text) => setProfile({ ...profile, grandTestsGiven: text })}
            />

            <Text style={styles.inputLabel}>Average Corrects</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 90-110"
              placeholderTextColor="#9CA3AF"
              value={profile.averageCorrects}
              onChangeText={(text) => setProfile({ ...profile, averageCorrects: text })}
            />

            <Text style={styles.inputLabel}>Average Score</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 420"
              placeholderTextColor="#9CA3AF"
              value={profile.averageScore}
              onChangeText={(text) => setProfile({ ...profile, averageScore: text })}
              keyboardType="numeric"
            />

            {/* Target Info */}
            <Text style={styles.sectionTitle}>Targets & Preferences</Text>

            <Text style={styles.inputLabel}>Weakest Subjects</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Biochem, Pharma, Opthal"
              placeholderTextColor="#9CA3AF"
              value={profile.weakestSubjects}
              onChangeText={(text) => setProfile({ ...profile, weakestSubjects: text })}
            />

            <Text style={styles.inputLabel}>Target Branch</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Radio, Orthopedics"
              placeholderTextColor="#9CA3AF"
              value={profile.targetBranch}
              onChangeText={(text) => setProfile({ ...profile, targetBranch: text })}
            />

            <Text style={styles.inputLabel}>Subscriptions</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Marrow, PrepLadder"
              placeholderTextColor="#9CA3AF"
              value={profile.subscriptions}
              onChangeText={(text) => setProfile({ ...profile, subscriptions: text })}
            />

            <TouchableOpacity
              style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
              onPress={handleSubmitProfile}
              disabled={isSubmitting}
            >
              <Check color="#FFFFFF" size={20} />
              <Text style={styles.submitButtonText}>
                {isSubmitting ? 'Saving...' : 'Complete Profile'}
              </Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF', // Clean white background
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  // Minimal premium top glow effect
  topGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 250,
    zIndex: 0,
  },
  // Enhanced Header with gradient
  headerGradient: {
    paddingTop: 20,
    paddingBottom: 16,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
    zIndex: 1,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTextContainer: {
    flex: 1,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.9)',
    letterSpacing: 0.2,
  },
  logoutButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  // Content
  scrollContent: {
    flex: 1,
    zIndex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
    gap: 18,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.15)',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#01b4ae',
    marginBottom: 16,
    letterSpacing: 0.3,
  },
  // Enhanced info row styling (label/value pairs)
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    width: 60,
    letterSpacing: 0.2,
  },
  infoValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  infoValueEmail: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#4B5563',
  },
  // Role badge
  roleBadge: {
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.3)',
  },
  roleBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#01b4ae',
    letterSpacing: 0.2,
  },
  // Card description text
  cardDescription: {
    fontSize: 15,
    color: '#4B5563',
    lineHeight: 22,
    fontWeight: '400',
  },
  // Legacy cardText (for backward compatibility)
  cardText: {
    fontSize: 15,
    color: '#374151',
    marginBottom: 8,
    lineHeight: 22,
  },
  // Skeleton loading
  skeleton: {
    backgroundColor: '#E5E7EB',
    borderRadius: 8,
    marginBottom: 8,
  },
  skeletonText: {
    height: 20,
    width: '85%',
  },
  skeletonTextSmall: {
    height: 20,
    width: '60%',
  },
  // Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  modalHeader: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#FEF2F2',
  },
  urgentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  urgentText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#DC2626',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2563EB',
    marginTop: 20,
    marginBottom: 15,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
    color: '#000000',
    marginBottom: 15,
  },
  batchTypeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 15,
  },
  batchTypeButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  batchTypeButtonActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  batchTypeText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6B7280',
  },
  batchTypeTextActive: {
    color: '#FFFFFF',
  },
  submitButton: {
    flexDirection: 'row',
    backgroundColor: '#10B981',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    gap: 10,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});