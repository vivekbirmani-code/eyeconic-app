import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  Animated,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { ScreenContainer, FullScreenContainer } from '@/components/layout';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';
import { LogOut, AlertTriangle, Check, MessageCircle, BookOpen, Users, LayoutDashboard, Menu, Sparkles, ChevronLeft, Globe } from 'lucide-react-native';
import { openWebDashboard } from '@/services/webDashboard';
import * as Haptics from '@/utils/haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import FreeUserSidebar from '@/components/FreeUserSidebar';
import ProfilePictureManager from '@/components/ProfilePictureManager';
import UserAvatar from '@/components/UserAvatar';
import { isFeatureEnabled } from '@/utils/featureAvailability';

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
  const { user, logout, refreshUser, updateUser } = useAuth();
  const router = useRouter();
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);
  
  // Free User States
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [freeUserStep, setFreeUserStep] = useState(1);
  const [freeYear, setFreeYear] = useState('First year');
  const [freeIssues, setFreeIssues] = useState('Stuck');
  const [freeResources, setFreeResources] = useState<string[]>([]);
  const [freeIsReady, setFreeIsReady] = useState(false);
  
  // Animation States
  const [showOnboardingAnimation, setShowOnboardingAnimation] = useState(false);
  const [animationMessage, setAnimationMessage] = useState('Analyzing your prep profile...');
  const animOpacity = useRef(new Animated.Value(0)).current;
  const animScale = useRef(new Animated.Value(0.9)).current;

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

  // App → Website: open eyeconicneetpg.com already signed in via a one-time
  // handoff code (see services/webDashboard.ts).
  const [openingWebsite, setOpeningWebsite] = useState(false);
  const handleOpenWebsite = async () => {
    if (openingWebsite) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpeningWebsite(true);
    try {
      await openWebDashboard('/dashboard');
    } catch (error: any) {
      const message =
        error?.response?.data?.message ||
        error?.message ||
        'Could not open the website right now. Please try again.';
      Alert.alert('Eyeconic Website', message);
    } finally {
      setOpeningWebsite(false);
    }
  };

  // The profile-completion modal is mandatory — there is no in-app screen to
  // go "back" to until the profile is filled. Its only escape hatch is the
  // login screen, which requires ending the session (otherwise auth routing
  // would land the student right back here).
  const handleBackToLogin = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Log out?',
      'You need to complete your profile to continue using the app. Do you want to return to the login screen?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: () => {
            setShowProfileModal(false);
            logout();
            router.replace('/login');
          },
        },
      ]
    );
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

  const toggleFreeResource = (res: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (freeResources.includes(res)) {
      setFreeResources(freeResources.filter(r => r !== res));
    } else {
      setFreeResources([...freeResources, res]);
    }
  };

  const handleSubmitFreeProfile = async () => {
    if (!freeYear || !freeIssues || freeResources.length === 0) {
      Alert.alert('Error', 'Please complete all questions and select at least one resource.');
      return;
    }
    if (!freeIsReady) {
      Alert.alert('Transform Journey', 'Please confirm that you are ready to transform your NEET PG journey.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.put('/users/profile', {
        year: freeYear,
        issues: freeIssues,
        resources: freeResources,
        isReadyToTransform: freeIsReady
      });

      // Play premium reveal/onboarding animation
      setShowProfileModal(false);
      setShowOnboardingAnimation(true);
      
      // Animated entrance
      Animated.parallel([
        Animated.timing(animOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(animScale, { toValue: 1, tension: 40, friction: 6, useNativeDriver: true })
      ]).start();

      // Cycle motivational statements
      setTimeout(() => setAnimationMessage('Mapping your customized mentorship path...'), 1000);
      setTimeout(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setAnimationMessage('Eyeconic Mentors track initialized! 🚀');
      }, 2000);

      setTimeout(async () => {
        // Animated exit
        Animated.parallel([
          Animated.timing(animOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.timing(animScale, { toValue: 0.9, duration: 300, useNativeDriver: true })
        ]).start(async () => {
          setShowOnboardingAnimation(false);
          // Sync new state with auth context
          if (refreshUser) {
            await refreshUser();
          }
        });
      }, 3500);

    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to save profile';
      Alert.alert('Error', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const batchTypes = ['FOUNDATION', 'REGULAR', 'CRASH COURSE', 'TEST SERIES'];

  return (
    <ScreenContainer style={styles.container}>
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
            {user?.isFreeUser && (
              <TouchableOpacity
                style={[styles.logoutButton, { marginRight: 12 }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSidebarOpen(true);
                }}
                activeOpacity={0.7}
              >
                <Menu color="#FFFFFF" size={20} />
              </TouchableOpacity>
            )}
            <View style={styles.headerTextContainer}>
              <Text style={styles.title}>{user?.isFreeUser ? 'Eyeconic Mentors' : 'Eyeconic Dashboard'}</Text>
              <Text style={styles.subtitle}>Hi, {user?.name} 👋</Text>
            </View>
            <Pressable
              style={styles.logoutButton}
              onPress={handleOpenWebsite}
              disabled={openingWebsite}
              android_ripple={{ color: 'rgba(255, 255, 255, 0.3)' }}
              accessibilityLabel="Open the Eyeconic website"
              accessibilityRole="button"
            >
              <Globe color="#FFFFFF" size={20} />
            </Pressable>
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
                <View style={styles.welcomeCardContent}>
                  <View style={styles.welcomeCardInfo}>
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
                  </View>

                  {user && (user.role === 'student' || user.role === 'mentor') && (
                    <UserAvatar
                      name={user.name}
                      role={user.role}
                      imageUrl={user.profilePicture}
                      size={88}
                    />
                  )}
                </View>

                {user && (user.role === 'student' || user.role === 'mentor') && (
                  <View style={styles.profilePictureSection}>
                    <Text style={styles.profilePictureSectionTitle}>Profile Picture</Text>
                    <ProfilePictureManager
                      name={user.name}
                      role={user.role}
                      imageUrl={user.profilePicture}
                      size={72}
                      editable
                      onUpdated={(profilePicture) => {
                        updateUser({ profilePicture });
                        refreshUser();
                      }}
                    />
                  </View>
                )}
              </Animated.View>
            )}
          </Pressable>
        </Animated.View>

        {/* Enhanced Quick Actions Card */}
        {!user?.isFreeUser && (
          <Animated.View
            style={[
              {
                opacity: card2Opacity,
                transform: [{ translateY: card2TranslateY }],
              },
            ]}
          >
            <View style={styles.card}>
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

                  <View style={styles.quickActionsGrid}>
                    {/* Groups button - all roles */}
                    <TouchableOpacity
                      style={[
                        styles.quickActionButton,
                        !isFeatureEnabled('chat') && styles.quickActionDisabled,
                      ]}
                      disabled={!isFeatureEnabled('chat')}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        router.push('/(tabs)/groups');
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(37, 99, 235, 0.1)' }]}>
                        <MessageCircle color="#2563EB" size={22} />
                      </View>
                      <Text style={styles.quickActionLabel}>Groups</Text>
                    </TouchableOpacity>

                    {/* Tests button - all roles */}
                    <TouchableOpacity
                      style={styles.quickActionButton}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        router.push('/(tabs)/quizzes');
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(16, 185, 129, 0.1)' }]}>
                        <BookOpen color="#10B981" size={22} />
                      </View>
                      <Text style={styles.quickActionLabel}>Tests</Text>
                    </TouchableOpacity>

                    {/* My Tasks - student only */}
                    {user?.role === 'student' && (
                      <TouchableOpacity
                        style={[
                          styles.quickActionButton,
                          !isFeatureEnabled('mentorship') && styles.quickActionDisabled,
                        ]}
                        disabled={!isFeatureEnabled('mentorship')}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          router.push('/(tabs)/student-assignments');
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(245, 158, 11, 0.1)' }]}>
                          <LayoutDashboard color="#F59E0B" size={22} />
                        </View>
                        <Text style={styles.quickActionLabel}>My Tasks</Text>
                      </TouchableOpacity>
                    )}

                    {/* Users - admin only */}
                    {user?.role === 'admin' && (
                      <TouchableOpacity
                        style={[
                          styles.quickActionButton,
                          !isFeatureEnabled('userManagement') && styles.quickActionDisabled,
                        ]}
                        disabled={!isFeatureEnabled('userManagement')}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          router.push('/(tabs)/users');
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(139, 92, 246, 0.1)' }]}>
                          <Users color="#8B5CF6" size={22} />
                        </View>
                        <Text style={styles.quickActionLabel}>Users</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </Animated.View>
              )}
            </View>
          </Animated.View>
        )}
      </ScrollView>

      {/* Student Profile Completion Modal */}
      <Modal
        visible={showProfileModal}
        animationType="slide"
        transparent={false}
        onRequestClose={handleBackToLogin}
      >
        <FullScreenContainer style={styles.modalContainer}>
          {/* Escape hatch, shared by both profile variants: the modal is
              mandatory, so keep a visible way back to the login screen. Fixed
              outside the ScrollView so it stays visible at any scroll offset. */}
          <View style={styles.backToLoginBar}>
            <TouchableOpacity
              style={styles.backToLoginButton}
              onPress={handleBackToLogin}
              accessibilityRole="button"
              accessibilityLabel="Back to login"
              accessibilityHint="Log out and return to the login screen"
              hitSlop={{ top: 8, bottom: 8, right: 12 }}
            >
              <ChevronLeft color="#6B7280" size={20} />
              <Text style={styles.backToLoginText}>Back to Login</Text>
            </TouchableOpacity>
          </View>
          {user?.isFreeUser ? (
            // FREE USER PERSONA QUESTIONNAIRE
            <View style={{ flex: 1 }}>
              <View style={[styles.modalHeader, { backgroundColor: '#F0FDFA' }]}>
                <View style={styles.urgentBanner}>
                  <Sparkles color="#01b4ae" size={24} />
                  <Text style={[styles.urgentText, { color: '#01b4ae' }]}>Iconic Onboarding</Text>
                </View>
                <Text style={styles.modalSubtitle}>
                  Help us customize your NEET PG journey. Question {freeUserStep} of 4
                </Text>
              </View>

              <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
                {freeUserStep === 1 && (
                  <View style={styles.stepContainer}>
                    <Text style={styles.sectionTitle}>Question 1: Which year of MBBS are you in?</Text>
                    {['First year', 'Second year', 'Third year', 'Final year', 'Intern', 'MBBS completed'].map((yr) => (
                      <TouchableOpacity
                        key={yr}
                        style={[
                          styles.optionCard,
                          freeYear === yr && styles.optionCardActive
                        ]}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setFreeYear(yr);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[
                          styles.optionText,
                          freeYear === yr && styles.optionTextActive
                        ]}>{yr}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {freeUserStep === 2 && (
                  <View style={styles.stepContainer}>
                    <Text style={styles.sectionTitle}>Question 2: What issues are you facing currently?</Text>
                    {['Stuck', 'GT corrects', 'Lack of consistency', 'Want study schedule', 'Just exploring'].map((issue) => (
                      <TouchableOpacity
                        key={issue}
                        style={[
                          styles.optionCard,
                          freeIssues === issue && styles.optionCardActive
                        ]}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setFreeIssues(issue);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[
                          styles.optionText,
                          freeIssues === issue && styles.optionTextActive
                        ]}>{issue}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {freeUserStep === 3 && (
                  <View style={styles.stepContainer}>
                    <Text style={styles.sectionTitle}>Question 3: Which resources are you using currently? (Multiple select)</Text>
                    {['Marrow', 'PrepLadder', 'Cerebrum', 'DAMS', 'DBMCI', 'others'].map((res) => {
                      const isSelected = freeResources.includes(res);
                      return (
                        <TouchableOpacity
                          key={res}
                          style={[
                            styles.optionCard,
                            isSelected && styles.optionCardActive
                          ]}
                          onPress={() => toggleFreeResource(res)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.checkboxRowOnboarding}>
                            <View style={[
                              styles.checkboxOnboarding,
                              isSelected && styles.checkboxOnboardingChecked
                            ]}>
                              {isSelected && <Check color="#FFFFFF" size={12} />}
                            </View>
                            <Text style={[
                              styles.optionText,
                              isSelected && styles.optionTextActive,
                              { marginLeft: 10 }
                            ]}>{res}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {freeUserStep === 4 && (
                  <View style={styles.stepContainer}>
                    <Text style={styles.sectionTitle}>Question 4: Are you ready to transform your NEET PG journey?</Text>
                    <TouchableOpacity
                      style={[
                        styles.optionCard,
                        freeIsReady && styles.optionCardActive,
                        { paddingVertical: 24, alignItems: 'center' }
                      ]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        setFreeIsReady(!freeIsReady);
                      }}
                      activeOpacity={0.7}
                    >
                      <Sparkles color={freeIsReady ? '#01b4ae' : '#9CA3AF'} size={32} style={{ marginBottom: 10 }} />
                      <Text style={[
                        styles.optionText,
                        freeIsReady && styles.optionTextActive,
                        { fontSize: 16, fontWeight: '700', textAlign: 'center' }
                      ]}>
                        {freeIsReady ? 'YES, I AM 100% READY! 🚀' : 'Click to confirm your readiness'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Step navigation buttons */}
                <View style={styles.stepNavigationRow}>
                  {freeUserStep > 1 && (
                    <TouchableOpacity
                      style={styles.backStepBtn}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setFreeUserStep(freeUserStep - 1);
                      }}
                    >
                      <Text style={styles.backStepBtnText}>Back</Text>
                    </TouchableOpacity>
                  )}
                  
                  {freeUserStep < 4 ? (
                    <TouchableOpacity
                      style={[
                        styles.nextStepBtn,
                        freeUserStep === 3 && freeResources.length === 0 && styles.nextStepBtnDisabled
                      ]}
                      disabled={freeUserStep === 3 && freeResources.length === 0}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setFreeUserStep(freeUserStep + 1);
                      }}
                    >
                      <Text style={styles.nextStepBtnText}>Next Question</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.submitOnboardingBtn,
                        (!freeIsReady || isSubmitting) && styles.submitButtonDisabled
                      ]}
                      disabled={!freeIsReady || isSubmitting}
                      onPress={handleSubmitFreeProfile}
                    >
                      {isSubmitting ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <>
                          <Check color="#FFFFFF" size={20} />
                          <Text style={styles.submitOnboardingBtnText}>Transform Now!</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>

                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          ) : (
            // ORIGINAL STUDENT PROFILE COMPLETION MODAL
            <View style={{ flex: 1 }}>
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
            </View>
          )}
        </FullScreenContainer>
      </Modal>

      {/* Free User Sidebar Panel */}
      {user?.isFreeUser && (
        <FreeUserSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      )}

      {/* Onboarding Transition Animation Overlay */}
      {showOnboardingAnimation && (
        <Modal transparent visible={true} animationType="fade">
          <View style={styles.animationOverlay}>
            <LinearGradient
              colors={['#01b4ae', '#007f7c']}
              style={StyleSheet.absoluteFillObject}
            />
            <Animated.View style={[styles.animationContent, { opacity: animOpacity, transform: [{ scale: animScale }] }]}>
              <Sparkles color="#FFFFFF" size={60} style={{ marginBottom: 20 }} />
              <Text style={styles.animationTitle}>Initiating Onboarding...</Text>
              <Text style={styles.animationMessage}>{animationMessage}</Text>
              <ActivityIndicator color="#FFFFFF" size="large" style={{ marginTop: 25 }} />
            </Animated.View>
          </View>
        </Modal>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF', // Clean white background
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
  // Icon buttons sit directly on the header gradient — no background fill
  // (the old rgba white box read as a grey chip) and no shadow, which would
  // outline a transparent view on iOS. Touch feedback still comes from the
  // white android_ripple / activeOpacity on each button.
  logoutButton: {
    backgroundColor: 'transparent',
    borderRadius: 12,
    padding: 12,
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
  welcomeCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  welcomeCardInfo: {
    flex: 1,
  },
  profilePictureSection: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(1, 180, 174, 0.12)',
    alignItems: 'center',
  },
  profilePictureSectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
    alignSelf: 'flex-start',
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
    marginBottom: 16,
  },
  // Quick action buttons
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickActionButton: {
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 12,
    minWidth: 90,
    flex: 1,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  // TEMPORARY FEATURE FREEZE — visually de-emphasized, non-tappable quick
  // actions for disabled features (utils/featureAvailability.ts).
  quickActionDisabled: {
    opacity: 0.5,
  },
  quickActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  quickActionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
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
  // Escape hatch above the mandatory profile header. Secondary styling on
  // purpose: completing the profile stays the primary action.
  backToLoginBar: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  backToLoginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingRight: 12,
  },
  backToLoginText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7280',
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
  stepContainer: {
    padding: 16,
    gap: 12,
  },
  optionCard: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 2,
    elevation: 1,
  },
  optionCardActive: {
    borderColor: '#01b4ae',
    backgroundColor: '#F0FDFA',
  },
  optionText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#374151',
  },
  optionTextActive: {
    fontWeight: '700',
    color: '#01b4ae',
  },
  checkboxRowOnboarding: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkboxOnboarding: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxOnboardingChecked: {
    backgroundColor: '#01b4ae',
    borderColor: '#01b4ae',
  },
  stepNavigationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    gap: 12,
    paddingHorizontal: 16,
  },
  backStepBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backStepBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4B5563',
  },
  nextStepBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#01b4ae',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  nextStepBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  nextStepBtnDisabled: {
    backgroundColor: '#D1D5DB',
    opacity: 0.6,
  },
  submitOnboardingBtn: {
    flex: 2,
    flexDirection: 'row',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  submitOnboardingBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  animationOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  animationContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  animationTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 16,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  animationMessage: {
    fontSize: 16,
    fontWeight: '500',
    color: '#E0F2FE',
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 22,
  },
});