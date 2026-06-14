import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { Eye, EyeOff, ShieldCheck, Mail, Phone, User, Lock, ChevronLeft, Check } from 'lucide-react-native';
import * as Haptics from '@/utils/haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '@/services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Signup() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  
  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  // Focus states
  const [nameFocused, setNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmPasswordFocused, setConfirmPasswordFocused] = useState(false);

  // Processing states
  const [isLoading, setIsLoading] = useState(false);
  
  // OTP Modal states
  const [otpModalVisible, setOtpModalVisible] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpFocused, setOtpFocused] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // Animations
  const buttonScale = useRef(new Animated.Value(1)).current;
  const otpButtonScale = useRef(new Animated.Value(1)).current;

  const handleButtonPressIn = (scaleVar: Animated.Value) => {
    Animated.spring(scaleVar, {
      toValue: 0.98,
      useNativeDriver: true,
    }).start();
  };

  const handleButtonPressOut = (scaleVar: Animated.Value) => {
    Animated.spring(scaleVar, {
      toValue: 1,
      tension: 100,
      friction: 5,
      useNativeDriver: true,
    }).start();
  };

  // Submit signup details to request OTP
  const handleRequestOtp = async () => {
    if (!name || !email || !phone || !password || !confirmPassword) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (password.length < 6) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    if (!acceptedTerms) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Terms & Conditions', 'Please accept the Terms and Conditions to proceed.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsLoading(true);

    try {
      // Send OTP request to backend
      const response = await api.post('/auth/send-otp', { email: email.trim().toLowerCase() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Code Sent', response.data.message || 'Verification code sent to your email.');
      setOtpModalVisible(true);
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message = error?.response?.data?.message || 'Failed to send verification email. Please check the address.';
      Alert.alert('Error', message);
    } finally {
      setIsLoading(false);
    }
  };

  // Submit OTP and complete signup registration
  const handleVerifyAndSignup = async () => {
    if (otp.length !== 6) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Invalid OTP', 'Verification code must be 6 digits');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsVerifying(true);

    try {
      const response = await api.post('/auth/signup', {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        password: password.trim(),
        otp: otp.trim()
      });

      const { token } = response.data;
      
      // Save credentials locally
      await AsyncStorage.setItem('authToken', token);
      api.defaults.headers.Authorization = `Bearer ${token}`;
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOtpModalVisible(false);
      
      // Refresh Auth Context state
      if (refreshUser) {
        await refreshUser();
      }

      // Route directly to tabs
      router.replace('/(tabs)/dashboard');
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message = error?.response?.data?.message || 'Invalid or expired OTP code. Please try again.';
      Alert.alert('Verification Failed', message);
    } finally {
      setIsVerifying(false);
    }
  };

  // Re-request OTP
  const handleResendOtp = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const response = await api.post('/auth/send-otp', { email: email.trim().toLowerCase() });
      Alert.alert('Code Resent', response.data.message || 'A new verification code has been emailed.');
      setOtp('');
    } catch (error: any) {
      Alert.alert('Error', error?.response?.data?.message || 'Failed to resend code');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Background Gradient */}
      <LinearGradient
        colors={['#01b4ae', '#008f8a', '#01b4ae']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContentContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          {/* Back Button */}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            style={styles.backButton}
            activeOpacity={0.7}
          >
            <ChevronLeft color="#FFFFFF" size={24} />
            <Text style={styles.backText}>Login</Text>
          </TouchableOpacity>

          {/* Title Section */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>Join Eyeconic</Text>
            <Text style={styles.tagline}>Create your free student account</Text>
          </View>

          {/* Form Card */}
          <View style={styles.card}>
            <Text style={styles.cardHeader}>Register Now</Text>

            <View style={styles.form}>
              {/* Full Name */}
              <View>
                <Text style={styles.label}>Full Name</Text>
                <View style={styles.inputWrapper}>
                  <User color="#9CA3AF" size={20} style={styles.inputIcon} />
                  <TextInput
                    style={[
                      styles.input,
                      nameFocused && styles.inputFocused
                    ]}
                    placeholder="Enter your name"
                    placeholderTextColor="#9CA3AF"
                    value={name}
                    onChangeText={setName}
                    onFocus={() => setNameFocused(true)}
                    onBlur={() => setNameFocused(false)}
                    autoCapitalize="words"
                    autoCorrect={false}
                    editable={!isLoading}
                  />
                </View>
              </View>

              {/* Email Address */}
              <View>
                <Text style={styles.label}>Email Address</Text>
                <View style={styles.inputWrapper}>
                  <Mail color="#9CA3AF" size={20} style={styles.inputIcon} />
                  <TextInput
                    style={[
                      styles.input,
                      emailFocused && styles.inputFocused
                    ]}
                    placeholder="Enter your email"
                    placeholderTextColor="#9CA3AF"
                    value={email}
                    onChangeText={setEmail}
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setEmailFocused(false)}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                  />
                </View>
              </View>

              {/* Mobile Number */}
              <View>
                <Text style={styles.label}>Mobile Number</Text>
                <View style={styles.inputWrapper}>
                  <Phone color="#9CA3AF" size={20} style={styles.inputIcon} />
                  <TextInput
                    style={[
                      styles.input,
                      phoneFocused && styles.inputFocused
                    ]}
                    placeholder="e.g. +91 98765 43210"
                    placeholderTextColor="#9CA3AF"
                    value={phone}
                    onChangeText={setPhone}
                    onFocus={() => setPhoneFocused(true)}
                    onBlur={() => setPhoneFocused(false)}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                  />
                </View>
              </View>

              {/* Password */}
              <View>
                <Text style={styles.label}>Password</Text>
                <View style={styles.inputWrapper}>
                  <Lock color="#9CA3AF" size={20} style={styles.inputIcon} />
                  <TextInput
                    style={[
                      styles.input,
                      styles.passwordInput,
                      passwordFocused && styles.inputFocused
                    ]}
                    placeholder="Create a password"
                    placeholderTextColor="#9CA3AF"
                    value={password}
                    onChangeText={setPassword}
                    onFocus={() => setPasswordFocused(true)}
                    onBlur={() => setPasswordFocused(false)}
                    secureTextEntry={!isPasswordVisible}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                  />
                  <TouchableOpacity
                    onPress={() => setIsPasswordVisible(!isPasswordVisible)}
                    style={styles.eyeIcon}
                    activeOpacity={0.7}
                  >
                    {isPasswordVisible ? (
                      <EyeOff color="#9CA3AF" size={20} />
                    ) : (
                      <Eye color="#9CA3AF" size={20} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Confirm Password */}
              <View>
                <Text style={styles.label}>Confirm Password</Text>
                <View style={styles.inputWrapper}>
                  <Lock color="#9CA3AF" size={20} style={styles.inputIcon} />
                  <TextInput
                    style={[
                      styles.input,
                      styles.passwordInput,
                      confirmPasswordFocused && styles.inputFocused
                    ]}
                    placeholder="Re-enter password"
                    placeholderTextColor="#9CA3AF"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    onFocus={() => setConfirmPasswordFocused(true)}
                    onBlur={() => setConfirmPasswordFocused(false)}
                    secureTextEntry={!isPasswordVisible}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                  />
                </View>
              </View>

              {/* Terms Checkbox */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setAcceptedTerms(!acceptedTerms);
                }}
                style={styles.checkboxRow}
              >
                <View style={[
                  styles.checkbox,
                  acceptedTerms && styles.checkboxChecked
                ]}>
                  {acceptedTerms && <Check color="#FFFFFF" size={14} />}
                </View>
                <Text style={styles.checkboxLabel}>
                  I agree to the <Text style={styles.termsLink}>Terms & Conditions</Text> and Privacy Policy.
                </Text>
              </Pressable>

              {/* Register Button */}
              <Pressable
                onPressIn={() => handleButtonPressIn(buttonScale)}
                onPressOut={() => handleButtonPressOut(buttonScale)}
                onPress={handleRequestOtp}
                disabled={isLoading}
              >
                <Animated.View
                  style={[
                    styles.submitBtn,
                    isLoading && styles.btnDisabled,
                    { transform: [{ scale: buttonScale }] }
                  ]}
                >
                  {isLoading ? (
                    <View style={styles.loadingWrapper}>
                      <ActivityIndicator color="#FFFFFF" size="small" />
                      <Text style={styles.submitBtnText}>Sending OTP...</Text>
                    </View>
                  ) : (
                    <Text style={styles.submitBtnText}>Sign Up</Text>
                  )}
                </Animated.View>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* OTP Verification Modal */}
      <Modal
        visible={otpModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setOtpModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalContainer}
          >
            <View style={styles.modalCard}>
              <View style={styles.modalBadge}>
                <ShieldCheck color="#01b4ae" size={32} />
              </View>

              <Text style={styles.modalTitle}>Verification Required</Text>
              <Text style={styles.modalSubtitle}>
                We've sent a 6-digit confirmation code to:
              </Text>
              <Text style={styles.modalEmail}>{email}</Text>

              {/* OTP Input */}
              <View style={styles.otpInputWrapper}>
                <TextInput
                  style={[
                    styles.otpInput,
                    otpFocused && styles.otpInputFocused
                  ]}
                  placeholder="Enter 6-digit code"
                  placeholderTextColor="#9CA3AF"
                  value={otp}
                  onChangeText={(text) => setOtp(text.replace(/[^0-9]/g, ''))}
                  onFocus={() => setOtpFocused(true)}
                  onBlur={() => setOtpFocused(false)}
                  keyboardType="numeric"
                  maxLength={6}
                  autoFocus={true}
                  editable={!isVerifying}
                />
              </View>

              {/* Verify Button */}
              <Pressable
                onPressIn={() => handleButtonPressIn(otpButtonScale)}
                onPressOut={() => handleButtonPressOut(otpButtonScale)}
                onPress={handleVerifyAndSignup}
                disabled={isVerifying}
              >
                <Animated.View
                  style={[
                    styles.verifyBtn,
                    isVerifying && styles.btnDisabled,
                    { transform: [{ scale: otpButtonScale }] }
                  ]}
                >
                  {isVerifying ? (
                    <View style={styles.loadingWrapper}>
                      <ActivityIndicator color="#FFFFFF" size="small" />
                      <Text style={styles.verifyBtnText}>Creating Account...</Text>
                    </View>
                  ) : (
                    <Text style={styles.verifyBtnText}>Verify & Sign Up</Text>
                  )}
                </Animated.View>
              </Pressable>

              {/* Resend and Cancel */}
              <View style={styles.modalFooter}>
                <TouchableOpacity onPress={handleResendOtp} disabled={isVerifying}>
                  <Text style={styles.resendText}>Resend Code</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  onPress={() => setOtpModalVisible(false)} 
                  disabled={isVerifying}
                  style={styles.cancelLink}
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#01b4ae',
  },
  scrollContentContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 40,
  },
  content: {
    paddingHorizontal: 20,
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 20,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  backText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
    marginLeft: 4,
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
    marginBottom: 6,
  },
  tagline: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  cardHeader: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 20,
  },
  form: {
    gap: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  inputIcon: {
    position: 'absolute',
    left: 14,
    zIndex: 1,
  },
  input: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 14,
    paddingLeft: 44,
    paddingRight: 16,
    fontSize: 15,
    backgroundColor: '#F9FAFB',
    color: '#111827',
  },
  passwordInput: {
    paddingRight: 50,
  },
  inputFocused: {
    borderColor: '#01b4ae',
    backgroundColor: '#FFFFFF',
  },
  eyeIcon: {
    position: 'absolute',
    right: 4,
    padding: 12,
    zIndex: 10,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 6,
    paddingRight: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: '#01b4ae',
    borderColor: '#01b4ae',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 12,
    color: '#4B5563',
    lineHeight: 18,
  },
  termsLink: {
    color: '#01b4ae',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  submitBtn: {
    backgroundColor: '#01b4ae',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  loadingWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 400,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 10,
  },
  modalBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  modalEmail: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '700',
    marginTop: 2,
    marginBottom: 20,
  },
  otpInputWrapper: {
    width: '100%',
    marginBottom: 20,
  },
  otpInput: {
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    fontSize: 22,
    textAlign: 'center',
    fontWeight: 'bold',
    backgroundColor: '#F9FAFB',
    color: '#111827',
    letterSpacing: 4,
  },
  otpInputFocused: {
    borderColor: '#01b4ae',
    backgroundColor: '#FFFFFF',
  },
  verifyBtn: {
    backgroundColor: '#01b4ae',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  verifyBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
    paddingHorizontal: 8,
  },
  resendText: {
    color: '#01b4ae',
    fontSize: 14,
    fontWeight: '600',
  },
  cancelLink: {},
  cancelText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '600',
  },
});
