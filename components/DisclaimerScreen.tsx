import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Dimensions,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Shield, ChevronRight, Check } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');

interface DisclaimerScreenProps {
  onComplete: () => void;
}

export default function DisclaimerScreen({ onComplete }: DisclaimerScreenProps) {
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [isAccepted, setIsAccepted] = useState(false);

  const handleAccept = async () => {
    if (!isAccepted) return;
    try {
      await AsyncStorage.setItem('disclaimer_accepted', 'true');
      onComplete();
    } catch (error) {
      console.error('Error saving disclaimer status:', error);
    }
  };

  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const paddingToBottom = 20;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom) {
      setHasScrolledToBottom(true);
    }
  };

  const sections = [
    {
      title: "1. Educational Purpose Only",
      content: "The Platform is intended solely for educational and preparatory purposes for NEET PG aspirants. All content, mentorship, test series, and study materials are designed to assist preparation and do not guarantee any rank, score, or selection."
    },
    {
      title: "2. No Guarantee of Results",
      content: "The User acknowledges that exam performance depends on individual effort, consistency, and external factors. EYECONIC FOR NEET PG makes no representations or warranties regarding results or outcomes."
    },
    {
      title: "3. Mentor Guidance Disclaimer",
      content: "All mentorship and guidance provided are advisory in nature and should not be treated as absolute or binding instruction."
    },
    {
      title: "4. Accuracy & Content Limitation",
      content: "Content may contain errors, omissions, or updates. The Platform is not liable for inaccuracies."
    },
    {
      title: "5. Payment Terms",
      content: "• Fees are communicated prior to purchase\n• Payments must be made in full and in advance\n• Access may be suspended for failed or disputed payments"
    },
    {
      title: "6. Refund & Cancellation Policy",
      content: "• All payments are non-refundable unless stated otherwise\n• No refund for partial or non-usage\n• Refunds, if any, are at sole discretion"
    },
    {
      title: "7. User Responsibility & Conduct",
      content: "• No sharing of login credentials\n• No reproduction or distribution of content"
    },
    {
      title: "8. Intellectual Property Rights",
      content: "All content is the exclusive property of EYECONIC FOR NEET PG."
    },
    {
      title: "9. Data Privacy & Consent",
      content: "User consents to data collection for academic tracking and communication."
    },
    {
      title: "10. Platform Availability",
      content: "No liability for temporary disruptions due to technical issues."
    },
    {
      title: "11. Limitation of Liability",
      content: "No liability for academic outcomes or damages."
    },
    {
      title: "12. Termination of Access",
      content: "Access may be suspended or terminated for violation of terms."
    },
    {
      title: "13. Governing Law",
      content: "Subject to jurisdiction of Rajasthan courts."
    }
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      
      {/* Background Header */}
      <LinearGradient
        colors={['#01b4ae', '#008f8a']}
        style={styles.headerGradient}
      >
        <SafeAreaView style={styles.headerContent}>
          <View style={styles.iconCircle}>
            <Shield color="#01b4ae" size={32} />
          </View>
          <Text style={styles.headerTitle}>Terms & Conditions</Text>
          <Text style={styles.headerSubtitle}>Please review and accept our terms to continue</Text>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentContainer}>
        <ScrollView 
          style={styles.scrollView}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={true}
        >
          <Text style={styles.mainTitle}>EYECONIC FOR NEET PG</Text>
          <Text style={styles.introText}>
            By accessing, registering, purchasing, or using the Platform, you (“User” / “Student”) agree to the following legally binding terms:
          </Text>

          {sections.map((section, index) => (
            <View key={index} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionContent}>{section.content}</Text>
            </View>
          ))}

          <View style={{ height: 40 }} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity 
            style={styles.checkboxContainer}
            onPress={() => setIsAccepted(!isAccepted)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, isAccepted && styles.checkboxActive]}>
              {isAccepted && <Check color="#FFFFFF" size={16} strokeWidth={3} />}
            </View>
            <Text style={styles.checkboxText}>
              I have read and agree to the Terms & Conditions.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.button,
              !isAccepted && styles.buttonDisabled
            ]}
            onPress={handleAccept}
            disabled={!isAccepted}
          >
            <LinearGradient
              colors={isAccepted ? ['#01b4ae', '#007a75'] : ['#E5E7EB', '#D1D5DB']}
              style={styles.buttonGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={[styles.buttonText, !isAccepted && styles.buttonTextDisabled]}>
                Accept & Proceed
              </Text>
              {isAccepted && <ChevronRight color="#FFFFFF" size={20} />}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  headerGradient: {
    height: height * 0.28,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    justifyContent: 'flex-end',
    paddingBottom: 40,
  },
  headerContent: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
  },
  contentContainer: {
    flex: 1,
    marginTop: -20,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 20,
    paddingTop: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 10,
  },
  scrollView: {
    flex: 1,
  },
  mainTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
  },
  introText: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
    marginBottom: 24,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 6,
  },
  sectionContent: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 22,
  },
  footer: {
    paddingVertical: 20,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkboxActive: {
    backgroundColor: '#01b4ae',
    borderColor: '#01b4ae',
  },
  checkboxText: {
    fontSize: 14,
    color: '#374151',
    flex: 1,
  },
  button: {
    borderRadius: 14,
    overflow: 'hidden',
    height: 56,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonGradient: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginRight: 8,
  },
  buttonTextDisabled: {
    color: '#9CA3AF',
  },
});
