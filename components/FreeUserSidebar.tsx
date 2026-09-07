import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  ScrollView,
  TextInput,
  Alert,
  Share,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ModalScreenLayout } from '@/components/layout';
import { useAuth } from '@/context/AuthContext';
import { GtLog, loadGtLogs, saveGtLogs } from '@/utils/gtTracker';
import ProfilePictureManager from '@/components/ProfilePictureManager';
import { 
  User, 
  HelpCircle, 
  Activity, 
  FileText, 
  BookOpen, 
  LogOut, 
  Scale, 
  Plus, 
  ChevronDown, 
  ChevronUp, 
  Trash2, 
  Share2, 
  Calendar,
  Sparkles
} from 'lucide-react-native';
import * as Haptics from '@/utils/haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { isFeatureEnabled } from '@/utils/featureAvailability';

const SIDEBAR_WIDTH = 290;

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FreeUserSidebar({ isOpen, onClose }: SidebarProps) {
  const insets = useSafeAreaInsets();
  const { user, logout, refreshUser, updateUser } = useAuth();
  
  // Navigation modal states
  const [activeModal, setActiveModal] = useState<string | null>(null);
  
  // Slide animation for drawer
  const slideAnim = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  // FAQ Accordion state
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  // GT Tracker States
  const [gtHistory, setGtHistory] = useState<GtLog[]>([]);
  const [gtName, setGtName] = useState('');
  const [gtCorrects, setGtCorrects] = useState('');
  const [gtScore, setGtScore] = useState('');
  const [gtRank, setGtRank] = useState('');

  // Resources state
  const resourcesList = [
    { title: 'NEET PG High-Yield Subject Weightage', size: '2.4 MB', type: 'PDF' },
    { title: 'Revision Checklist - Last 45 Days', size: '1.8 MB', type: 'PDF' },
    { title: 'Biochemistry High-Yield Tables', size: '3.1 MB', type: 'PDF' },
    { title: 'Microbiology Mnemonics Handbook', size: '4.5 MB', type: 'PDF' }
  ];

  // Free Content feed
  const freeContentFeed = [
    { title: 'Anatomy: Image-Based Questions Strategy', category: 'High-Yield Article', readTime: '5 min read' },
    { title: 'How to boost your GT Corrects from 90 to 130', category: 'Mentorship Video', readTime: '12 min video' },
    { title: 'Pharmacology: Essential Drug of Choice List', category: 'Revision Flashcard', readTime: '8 min read' },
    { title: 'Daily MCQ Challenge: Anatomy & Physiology', category: 'Practice Set', readTime: '10 Questions' }
  ];

  // FAQs
  const faqs = [
    { q: 'What is Eyeconic Mentors App?', a: 'Eyeconic Mentors is a specialized exam preparation mentorship platform for MBBS graduates preparing for NEET PG and INI-CET.' },
    { q: 'How do I upgrade to the paid plan?', a: 'Please contact support at admissions@eyeconicmentors.com or WhatsApp +91 99999 88888 to talk to a mentor and unlock premium calls & custom daily tasks.' },
    { q: 'What is the GT Tracker?', a: 'It is a performance tool allowing you to log your Grand Test scores, correct counts, and ranks to see a progression graph.' },
    { q: 'Are these study PDF resources free?', a: 'Yes, the resources in this section are 100% free and curated by top medical mentors to help you start your preparation.' }
  ];

  useEffect(() => {
    if (isOpen) {
      // Load GT tracker logs
      loadGtLogsFromStorage();

      // Animate sidebar open
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0.5,
          duration: 300,
          useNativeDriver: true,
        })
      ]).start();
    } else {
      // Animate sidebar closed
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -SIDEBAR_WIDTH,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        })
      ]).start();
    }
  }, [isOpen]);

  const closeSidebar = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  const handleLogout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    logout();
    closeSidebar();
  };

  const openSectionModal = (section: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveModal(section);
  };

  // GT Tracker functions
  const loadGtLogsFromStorage = async () => {
    if (!user?._id) {
      setGtHistory([]);
      return;
    }
    const logs = await loadGtLogs(user._id);
    setGtHistory(logs);
  };

  const saveGtLog = async () => {
    if (!gtName || !gtCorrects || !gtScore) {
      Alert.alert('Error', 'Please enter at least GT Name, Correct Answers, and Score.');
      return;
    }
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!user?._id) {
      Alert.alert('Error', 'Please sign in to save GT logs.');
      return;
    }

    const newLog: GtLog = {
      id: Date.now().toString(),
      name: gtName.trim(),
      corrects: parseInt(gtCorrects) || 0,
      score: parseInt(gtScore) || 0,
      rank: gtRank ? parseInt(gtRank) : '-',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    };

    const updated = [newLog, ...gtHistory];
    setGtHistory(updated);
    try {
      await saveGtLogs(user._id, updated);
      Alert.alert('Success', 'Grand Test details saved successfully!');
      // Clear inputs
      setGtName('');
      setGtCorrects('');
      setGtScore('');
      setGtRank('');
    } catch (e) {
      Alert.alert('Error', 'Failed to save log details');
    }
  };

  const deleteGtLog = async (id: string) => {
    if (!user?._id) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = gtHistory.filter(item => item.id !== id);
    setGtHistory(updated);
    try {
      await saveGtLogs(user._id, updated);
    } catch (e) {
      console.log('Error deleting log:', e);
    }
  };

  const shareResource = async (title: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        message: `Check out this revision resource from Eyeconic Mentors: "${title}". Download the app to access all free materials!`,
      });
    } catch (error) {
      console.log('Error sharing:', error);
    }
  };

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="none"
      onRequestClose={closeSidebar}
    >
      <View style={styles.overlayContainer}>
        {/* Backdrop overlay */}
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSidebar}>
          <Animated.View style={[styles.backdrop, { opacity: overlayOpacity }]} />
        </Pressable>

        {/* Sidebar Drawer Panel */}
        <Animated.View style={[styles.sidebarPanel, { transform: [{ translateX: slideAnim }] }]}>
          <LinearGradient
            colors={['#01b4ae', '#008f8a']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.sidebarHeader, { paddingTop: insets.top + 24 }]}
          >
            <View style={styles.logoRow}>
              <Sparkles color="#FFFFFF" size={24} />
              <Text style={styles.headerTitle}>EYECONIC MENTORS</Text>
            </View>
            <View style={styles.userProfile}>
              <View style={styles.avatar}>
                <Text style={styles.avatarLetter}>{user?.name?.charAt(0).toUpperCase() || 'U'}</Text>
              </View>
              <View style={styles.profileText}>
                <Text style={styles.userName} numberOfLines={1}>{user?.name}</Text>
                <Text style={styles.userEmail} numberOfLines={1}>{user?.email}</Text>
              </View>
            </View>
          </LinearGradient>

          <ScrollView style={styles.menuItems} showsVerticalScrollIndicator={false}>
            {/* 1. My Profile */}
            <TouchableOpacity style={styles.menuItem} onPress={() => openSectionModal('profile')}>
              <User size={20} color="#01b4ae" />
              <Text style={styles.menuItemText}>My Profile</Text>
            </TouchableOpacity>

            {/* 2. FAQs */}
            <TouchableOpacity style={styles.menuItem} onPress={() => openSectionModal('faqs')}>
              <HelpCircle size={20} color="#01b4ae" />
              <Text style={styles.menuItemText}>FAQs</Text>
            </TouchableOpacity>

            {/* 3. GT Tracker — TEMPORARY FEATURE FREEZE */}
            <TouchableOpacity
              style={[styles.menuItem, !isFeatureEnabled('freeUserContent') && styles.menuItemDisabled]}
              disabled={!isFeatureEnabled('freeUserContent')}
              onPress={() => openSectionModal('gt-tracker')}
            >
              <Activity size={20} color="#01b4ae" />
              <Text style={styles.menuItemText}>GT Tracker</Text>
              {!isFeatureEnabled('freeUserContent') && (
                <Text style={styles.menuItemBadge}>Soon</Text>
              )}
            </TouchableOpacity>

            {/* 4. Resources — TEMPORARY FEATURE FREEZE */}
            <TouchableOpacity
              style={[styles.menuItem, !isFeatureEnabled('freeUserContent') && styles.menuItemDisabled]}
              disabled={!isFeatureEnabled('freeUserContent')}
              onPress={() => openSectionModal('resources')}
            >
              <FileText size={20} color="#01b4ae" />
              <Text style={styles.menuItemText}>Resources</Text>
              {!isFeatureEnabled('freeUserContent') && (
                <Text style={styles.menuItemBadge}>Soon</Text>
              )}
            </TouchableOpacity>

            {/* 5. Free Content — TEMPORARY FEATURE FREEZE */}
            <TouchableOpacity
              style={[styles.menuItem, !isFeatureEnabled('freeUserContent') && styles.menuItemDisabled]}
              disabled={!isFeatureEnabled('freeUserContent')}
              onPress={() => openSectionModal('free-content')}
            >
              <BookOpen size={20} color="#01b4ae" />
              <Text style={styles.menuItemText}>Free Content</Text>
              {!isFeatureEnabled('freeUserContent') && (
                <Text style={styles.menuItemBadge}>Soon</Text>
              )}
            </TouchableOpacity>

            {/* 7. Terms & Conditions */}
            <TouchableOpacity style={styles.menuItem} onPress={() => openSectionModal('terms')}>
              <Scale size={20} color="#01b4ae" />
              <Text style={styles.menuItemText}>Terms & Conditions</Text>
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.menuDivider} />

            {/* 6. Logout */}
            <TouchableOpacity style={[styles.menuItem, styles.logoutItem]} onPress={handleLogout}>
              <LogOut size={20} color="#EF4444" />
              <Text style={[styles.menuItemText, styles.logoutText]}>Logout</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={[styles.sidebarFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Text style={styles.footerVersion}>Version 1.0.0 (Free Account)</Text>
            <Text style={styles.footerCopyright}>© Eyeconic Mentors</Text>
          </View>
        </Animated.View>
      </View>

      {/* Sub-Section Modals */}
      
      {/* 1. My Profile Modal */}
      <Modal visible={activeModal === 'profile'} animationType="slide" transparent={false}>
        <ModalScreenLayout title="My Profile" onClose={() => setActiveModal(null)}>
          <ProfilePictureManager
            name={user?.name || 'User'}
            role={user?.role}
            imageUrl={user?.profilePicture}
            size={96}
            editable
            onUpdated={(profilePicture) => {
              updateUser({ profilePicture });
              refreshUser();
            }}
          />
          <Text style={styles.profileTitleName}>{user?.name}</Text>

          <View style={styles.profileDetailsList}>
            <View style={styles.detailCard}>
              <Text style={styles.detailLabel}>Email Address</Text>
              <Text style={styles.detailValue}>{user?.email}</Text>
            </View>
            {user?.phone && (
              <View style={styles.detailCard}>
                <Text style={styles.detailLabel}>Mobile Number</Text>
                <Text style={styles.detailValue}>{user?.phone}</Text>
              </View>
            )}

            <Text style={styles.sectionHeaderSub}>Personal Information</Text>

            <View style={styles.detailCard}>
              <Text style={styles.detailLabel}>Current MBBS Year</Text>
              <Text style={styles.detailValue}>{user?.freeUserProfile?.year || 'Not Set'}</Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailLabel}>Current Challenge/Issue</Text>
              <Text style={styles.detailValue}>{user?.freeUserProfile?.issues || 'Not Set'}</Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailLabel}>Current Platforms/Resources</Text>
              <View style={styles.badgeRow}>
                {user?.freeUserProfile?.resources && user.freeUserProfile.resources.length > 0 ? (
                  user.freeUserProfile.resources.map((res: string, idx: number) => (
                    <View key={idx} style={styles.resourceBadgeChip}>
                      <Text style={styles.resourceBadgeChipText}>{res}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.detailValue}>None</Text>
                )}
              </View>
            </View>
          </View>
        </ModalScreenLayout>
      </Modal>

      {/* 2. FAQs Modal */}
      <Modal visible={activeModal === 'faqs'} animationType="slide" transparent={false}>
        <ModalScreenLayout title="FAQs" onClose={() => setActiveModal(null)}>
          <Text style={styles.faqSubtitle}>Frequently Asked Questions</Text>
          {faqs.map((faq, idx) => (
            <View key={idx} style={styles.faqCard}>
              <TouchableOpacity
                style={styles.faqQuestionRow}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setExpandedFaq(expandedFaq === idx ? null : idx);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.faqQuestionText}>{faq.q}</Text>
                {expandedFaq === idx ? <ChevronUp size={20} color="#01b4ae" /> : <ChevronDown size={20} color="#6B7280" />}
              </TouchableOpacity>
              {expandedFaq === idx && (
                <View style={styles.faqAnswerContainer}>
                  <Text style={styles.faqAnswerText}>{faq.a}</Text>
                </View>
              )}
            </View>
          ))}
        </ModalScreenLayout>
      </Modal>

      {/* 3. GT Tracker Modal */}
      <Modal visible={activeModal === 'gt-tracker'} animationType="slide" transparent={false}>
        <ModalScreenLayout title="GT Tracker" onClose={() => setActiveModal(null)}>
          {/* Input Log Card */}
          <View style={styles.loggerCard}>
            <Text style={styles.loggerTitle}>Log New Mock Score</Text>

            <View style={styles.loggerForm}>
              <TextInput
                style={styles.loggerInput}
                placeholder="GT Name (e.g. Marrow GT 10)"
                placeholderTextColor="#9CA3AF"
                value={gtName}
                onChangeText={setGtName}
              />
              <View style={styles.loggerFormRow}>
                <TextInput
                  style={[styles.loggerInput, { flex: 1, marginRight: 8 }]}
                  placeholder="Corrects (e.g. 110)"
                  placeholderTextColor="#9CA3AF"
                  value={gtCorrects}
                  onChangeText={setGtCorrects}
                  keyboardType="numeric"
                />
                <TextInput
                  style={[styles.loggerInput, { flex: 1, marginLeft: 8 }]}
                  placeholder="Score (e.g. 440)"
                  placeholderTextColor="#9CA3AF"
                  value={gtScore}
                  onChangeText={setGtScore}
                  keyboardType="numeric"
                />
              </View>
              <TextInput
                style={styles.loggerInput}
                placeholder="Rank (e.g. 2500, optional)"
                placeholderTextColor="#9CA3AF"
                value={gtRank}
                onChangeText={setGtRank}
                keyboardType="numeric"
              />

              <TouchableOpacity style={styles.loggerSubmitBtn} onPress={saveGtLog}>
                <Plus size={18} color="#FFFFFF" />
                <Text style={styles.loggerSubmitBtnText}>Add Log Details</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Logs History */}
          <Text style={styles.loggerSectionTitle}>Test History Logs</Text>
          {gtHistory.length === 0 ? (
            <View style={styles.emptyLogsCard}>
              <Activity size={36} color="#CBD5E1" />
              <Text style={styles.emptyLogsText}>No tests logged yet. Enter score details above.</Text>
            </View>
          ) : (
            gtHistory.map(item => (
              <View key={item.id} style={styles.gtLogItem}>
                <View style={styles.gtLogDetails}>
                  <Text style={styles.gtLogTitle}>{item.name}</Text>
                  <View style={styles.gtLogStatsRow}>
                    <Text style={styles.gtLogStatText}>Corrects: <Text style={styles.gtLogStatHighlight}>{item.corrects}</Text></Text>
                    <Text style={styles.gtLogStatText}>Score: <Text style={styles.gtLogStatHighlight}>{item.score}</Text></Text>
                    <Text style={styles.gtLogStatText}>Rank: <Text style={styles.gtLogStatHighlight}>{item.rank}</Text></Text>
                  </View>
                  <View style={styles.gtLogDateRow}>
                    <Calendar size={12} color="#9CA3AF" />
                    <Text style={styles.gtLogDate}>{item.date}</Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.deleteLogBtn} onPress={() => deleteGtLog(item.id)}>
                  <Trash2 size={18} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </ModalScreenLayout>
      </Modal>

      {/* 4. Resources Modal */}
      <Modal visible={activeModal === 'resources'} animationType="slide" transparent={false}>
        <ModalScreenLayout title="Free Resources" onClose={() => setActiveModal(null)}>
          <Text style={styles.faqSubtitle}>Curated Study Materials & Guides</Text>
          {resourcesList.map((res, idx) => (
            <View key={idx} style={styles.resourceCard}>
              <View style={styles.resourceInfo}>
                <Text style={styles.resourceTitle}>{res.title}</Text>
                <View style={styles.resourceMetaRow}>
                  <View style={styles.docTypeBadge}>
                    <Text style={styles.docTypeBadgeText}>{res.type}</Text>
                  </View>
                  <Text style={styles.resourceSizeText}>{res.size}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.shareButton} onPress={() => shareResource(res.title)}>
                <Share2 size={18} color="#01b4ae" />
              </TouchableOpacity>
            </View>
          ))}
        </ModalScreenLayout>
      </Modal>

      {/* 5. Free Content Modal */}
      <Modal visible={activeModal === 'free-content'} animationType="slide" transparent={false}>
        <ModalScreenLayout title="Free Content" onClose={() => setActiveModal(null)}>
          <Text style={styles.faqSubtitle}>Tips, Articles & High-Yield Information</Text>
          {freeContentFeed.map((item, idx) => (
            <View key={idx} style={styles.feedCard}>
              <Text style={styles.feedCategoryText}>{item.category}</Text>
              <Text style={styles.feedTitleText}>{item.title}</Text>
              <View style={styles.feedMetaRow}>
                <Text style={styles.feedTimeText}>{item.readTime}</Text>
                <TouchableOpacity
                  style={styles.readMoreBtn}
                  onPress={() => Alert.alert('Premium Mentorship Content', 'Upgrade to our Premium Mentorship plan to fully unlock video breakdowns and targeted high-yield study documents.')}
                >
                  <Text style={styles.readMoreBtnText}>View Content</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ModalScreenLayout>
      </Modal>

      {/* 7. Terms & Conditions Modal */}
      <Modal visible={activeModal === 'terms'} animationType="slide" transparent={false}>
        <ModalScreenLayout title="Terms & Conditions" onClose={() => setActiveModal(null)}>
          <Text style={styles.termsParagraphBold}>Terms of Service & Rules of Engagement</Text>
          <Text style={styles.termsText}>
            Welcome to Eyeconic Mentors. By utilizing our mobile application, you agree to comply with our Terms & Conditions.
            The study schedules, quiz questions, and guidance resources are copyrighted properties and must not be distributed without written permission.
          </Text>
          <Text style={styles.termsText}>
            1. **User Account Security**: Unregistered/free accounts are for personal medical licensing exam preparation. Sharing login details with other users will result in account lock constraints.
          </Text>
          <Text style={styles.termsText}>
            2. **Content Ownership**: Question banks, flashcards, visual revision PDF charts are properties of Eyeconic Mentors. Unauthorized copying is prohibited.
          </Text>
          <Text style={styles.termsText}>
            3. **Fair Usage Constraints**: Continuous tab switching or running scripts during test taking will invalidate your exam results, and might result in temporary bans from quiz panels.
          </Text>
          <Text style={styles.termsText}>
            Please contact team@eyeconicmentors.com if you have questions regarding the terms of service.
          </Text>
        </ModalScreenLayout>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  sidebarPanel: {
    width: SIDEBAR_WIDTH,
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
  sidebarHeader: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  userProfile: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  avatarLetter: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  profileText: {
    marginLeft: 12,
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  userEmail: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 2,
  },
  menuItems: {
    flex: 1,
    paddingVertical: 15,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    gap: 14,
  },
  // TEMPORARY FEATURE FREEZE — disabled learning-tool entries
  // (utils/featureAvailability.ts).
  menuItemDisabled: {
    opacity: 0.5,
  },
  menuItemBadge: {
    marginLeft: 'auto',
    fontSize: 11,
    fontWeight: '700',
    color: '#01b4ae',
    backgroundColor: 'rgba(1, 180, 174, 0.12)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  menuItemText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 10,
    marginHorizontal: 20,
  },
  logoutItem: {
    marginTop: 5,
  },
  logoutText: {
    color: '#EF4444',
  },
  sidebarFooter: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    alignItems: 'center',
  },
  footerVersion: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  footerCopyright: {
    fontSize: 10,
    color: '#D1D5DB',
    marginTop: 2,
  },
  // Profile Submodal
  profileBadgeBig: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#01b4ae',
  },
  avatarLetterBig: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#01b4ae',
  },
  profileTitleName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 24,
  },
  profileDetailsList: {
    gap: 14,
  },
  detailCard: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 16,
  },
  detailLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    flexShrink: 1,
  },
  sectionHeaderSub: {
    fontSize: 16,
    fontWeight: '700',
    color: '#01b4ae',
    marginTop: 10,
    marginBottom: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  resourceBadgeChip: {
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.3)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  resourceBadgeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#01b4ae',
  },
  // FAQ Submodal
  faqSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
  },
  faqCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  faqQuestionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F9FAFB',
  },
  faqQuestionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    flex: 1,
    paddingRight: 10,
  },
  faqAnswerContainer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  faqAnswerText: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
  },
  // GT Tracker Submodal
  loggerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.2)',
    marginBottom: 20,
  },
  loggerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#01b4ae',
    marginBottom: 14,
  },
  loggerForm: {
    gap: 12,
  },
  loggerInput: {
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#F9FAFB',
    color: '#000000',
  },
  loggerFormRow: {
    flexDirection: 'row',
  },
  loggerSubmitBtn: {
    flexDirection: 'row',
    backgroundColor: '#01b4ae',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
  },
  loggerSubmitBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  loggerSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
  },
  emptyLogsCard: {
    padding: 30,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyLogsText: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 18,
  },
  gtLogItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  gtLogDetails: {
    flex: 1,
  },
  gtLogTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1F2937',
  },
  gtLogStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 6,
  },
  gtLogStatText: {
    fontSize: 12,
    color: '#6B7280',
  },
  gtLogStatHighlight: {
    fontWeight: '700',
    color: '#111827',
  },
  gtLogDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  gtLogDate: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  deleteLogBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
    marginLeft: 10,
  },
  // Resources Submodal
  resourceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  resourceInfo: {
    flex: 1,
    paddingRight: 10,
  },
  resourceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 6,
  },
  resourceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  docTypeBadge: {
    backgroundColor: '#E0F2FE',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  docTypeBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#0369A1',
  },
  resourceSizeText: {
    fontSize: 11,
    color: '#6B7280',
  },
  shareButton: {
    padding: 10,
    backgroundColor: '#F0FDFA',
    borderRadius: 8,
  },
  // Free Content Feed Submodal
  feedCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  feedCategoryText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#01b4ae',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  feedTitleText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1F2937',
    lineHeight: 20,
    marginBottom: 12,
  },
  feedMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feedTimeText: {
    fontSize: 12,
    color: '#6B7280',
  },
  readMoreBtn: {
    backgroundColor: '#F3F4F6',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  readMoreBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  // Terms & Conditions
  termsParagraphBold: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 10,
  },
  termsText: {
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 18,
    marginBottom: 14,
  },
});
