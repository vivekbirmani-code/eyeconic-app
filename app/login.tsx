import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  Modal,
} from 'react-native';
import { FullScreenContainer } from '@/components/layout';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { Eye, EyeOff, Mail, Lock, ShieldCheck } from 'lucide-react-native';
import * as Haptics from '@/utils/haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { api, getUserMessage } from '@/services/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  // Forgot Password states
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotPassword, setForgotPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotStep, setForgotStep] = useState(1); // 1: Send OTP, 2: Reset
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotPasswordVisible, setForgotPasswordVisible] = useState(false);

  // Focus states for forgot modal
  const [forgotEmailFocused, setForgotEmailFocused] = useState(false);
  const [forgotOtpFocused, setForgotOtpFocused] = useState(false);
  const [forgotPasswordFocused, setForgotPasswordFocused] = useState(false);
  const [forgotConfirmPasswordFocused, setForgotConfirmPasswordFocused] = useState(false);

  // Animation values
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.95)).current;
  const cardTranslateY = useRef(new Animated.Value(15)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const eyeIconOpacity = useRef(new Animated.Value(1)).current;

  // Entry animations on mount
  useEffect(() => {
    // Logo animation
    Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();

    // Card animation (slightly delayed)
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.spring(cardTranslateY, {
          toValue: 0,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();
    }, 200);
  }, []);

  // Password toggle animation
  const togglePasswordVisibility = () => {
    // Haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Fade out, change state, fade in
    Animated.sequence([
      Animated.timing(eyeIconOpacity, {
        toValue: 0.3,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(eyeIconOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    setIsPasswordVisible(!isPasswordVisible);
  };

  // Button press animation
  const handleButtonPressIn = () => {
    Animated.spring(buttonScale, {
      toValue: 0.98,
      useNativeDriver: true,
    }).start();
  };

  const handleButtonPressOut = () => {
    Animated.spring(buttonScale, {
      toValue: 1,
      tension: 100,
      friction: 5,
      useNativeDriver: true,
    }).start();
  };

  const handleLogin = async () => {
    if (!email || !password) {
      // Error haptic
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    // Success haptic on button tap
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    setIsLoading(true);
    try {
      // Trim inputs to remove accidental spaces added by mobile keyboards
      await login(email.trim(), password.trim());
      // Navigate to dashboard explicitly
      router.replace('/(tabs)/dashboard');
    } catch (error: any) {
      // Error haptic on login failure
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message = error?.message || getUserMessage(error);
      Alert.alert('Unable to Sign In', message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setForgotEmail(email); // Prefill with whatever is in the email field
    setForgotOtp('');
    setForgotPassword('');
    setForgotConfirmPassword('');
    setForgotStep(1);
    setForgotModalVisible(true);
  };

  const handleForgotPasswordSendOtp = async () => {
    if (!forgotEmail) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setForgotLoading(true);

    try {
      const response = await api.post('/auth/forgot-password-send-otp', {
        email: forgotEmail.trim().toLowerCase(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Code Sent', response.data.message || 'Verification code sent to your email.');
      setForgotStep(2);
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', getUserMessage(error));
    } finally {
      setForgotLoading(false);
    }
  };

  const handleForgotPasswordReset = async () => {
    if (!forgotOtp || !forgotPassword || !forgotConfirmPassword) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (forgotOtp.length !== 6) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Invalid OTP', 'Verification code must be 6 digits');
      return;
    }

    if (forgotPassword.length < 6) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    if (forgotPassword !== forgotConfirmPassword) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setForgotLoading(true);

    try {
      const response = await api.post('/auth/forgot-password-reset', {
        email: forgotEmail.trim().toLowerCase(),
        otp: forgotOtp.trim(),
        newPassword: forgotPassword.trim(),
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Success', response.data.message || 'Password reset successful!');
      setForgotModalVisible(false);
      setEmail(forgotEmail);
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message = getUserMessage(error);
      Alert.alert('Error', message);
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <FullScreenContainer>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      {/* Gradient Background */}
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
          {/* Logo with entry animation */}
          <Animated.View
            style={[
              styles.logoContainer,
              {
                opacity: logoOpacity,
                transform: [{ scale: logoScale }],
              },
            ]}
          >
            <View style={styles.logoBadge}>
              <Image
                source={require('@/assets/images/Logo.png')}
                style={styles.logo}
                resizeMode="cover"
              />
            </View>
          </Animated.View>

          {/* Title Section */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>EYECONIC</Text>
            <Text style={styles.tagline}>Your path to medical excellence</Text>
          </View>

          {/* Login Card with entry animation */}
          <Animated.View
            style={[
              styles.card,
              {
                opacity: cardOpacity,
                transform: [{ translateY: cardTranslateY }],
              },
            ]}
          >
            <Text style={styles.welcomeText}>Welcome Back</Text>

            <View style={styles.form}>
              {/* Email Input */}
              <View>
                <Text style={styles.label}>Email Address</Text>
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

              {/* Password Input */}
              <View>
                <Text style={styles.label}>Password</Text>
                <View style={styles.passwordWrapper}>
                  <TextInput
                    style={[
                      styles.input,
                      styles.passwordInputField,
                      passwordFocused && styles.inputFocused
                    ]}
                    placeholder="Enter your password"
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
                    onPress={togglePasswordVisibility}
                    style={styles.eyeIconAbsolute}
                    activeOpacity={0.7}
                    disabled={isLoading}
                  >
                    <Animated.View style={{ opacity: eyeIconOpacity }}>
                      {isPasswordVisible ? (
                        <EyeOff color="#9CA3AF" size={22} />
                      ) : (
                        <Eye color="#9CA3AF" size={22} />
                      )}
                    </Animated.View>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Sign In Button with press animation */}
              <Pressable
                onPressIn={handleButtonPressIn}
                onPressOut={handleButtonPressOut}
                onPress={handleLogin}
                disabled={isLoading}
              >
                <Animated.View
                  style={[
                    styles.button,
                    isLoading && styles.buttonDisabled,
                    {
                      transform: [{ scale: buttonScale }],
                    },
                  ]}
                >
                  {isLoading ? (
                    <View style={styles.loadingContainer}>
                      <ActivityIndicator color="#FFFFFF" size="small" />
                      <Text style={styles.buttonText}>Signing in...</Text>
                    </View>
                  ) : (
                    <Text style={styles.buttonText}>Sign In</Text>
                  )}
                </Animated.View>
              </Pressable>

              {/* Password Help */}
              <TouchableOpacity
                onPress={handleForgotPassword}
                style={styles.helpLinkContainer}
                activeOpacity={0.7}
              >
                <Text style={styles.helpLinkText}>Forgot password?</Text>
              </TouchableOpacity>
            </View>

            {/* Footer */}
            <View style={styles.loginFooter}>
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/signup');
                }}
                style={styles.signUpLinkContainer}
              >
                <Text style={styles.footerText}>
                  Don't have an account? <Text style={styles.signUpLinkText}>Sign Up</Text>
                </Text>
              </TouchableOpacity>

              <Text style={[styles.footerText, { marginTop: 12 }]}>
                Contact your administrator if you need login credentials
              </Text>
              
              <TouchableOpacity 
                onPress={() => {
                  Alert.alert('Terms & Conditions', 'You have already accepted the Terms & Conditions when starting the app.');
                }}
                style={{ marginTop: 8 }}
              >
                <Text style={styles.termsLink}>Terms & Conditions</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </ScrollView>

      {/* Forgot Password Modal */}
      <Modal
        visible={forgotModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setForgotModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalContainer}
          >
            <View style={styles.modalCard}>
              {forgotStep === 1 ? (
                <>
                  <View style={styles.modalBadge}>
                    <Mail color="#01b4ae" size={32} />
                  </View>
                  <Text style={styles.modalTitle}>Forgot Password?</Text>
                  <Text style={styles.modalSubtitle}>
                    Enter your registered email address to receive a verification code.
                  </Text>

                  <View style={styles.forgotInputWrapper}>
                    <Mail color="#9CA3AF" size={20} style={styles.forgotInputIcon} />
                    <TextInput
                      style={[
                        styles.forgotInput,
                        forgotEmailFocused && styles.forgotInputFocused
                      ]}
                      placeholder="Enter your email"
                      placeholderTextColor="#9CA3AF"
                      value={forgotEmail}
                      onChangeText={setForgotEmail}
                      onFocus={() => setForgotEmailFocused(true)}
                      onBlur={() => setForgotEmailFocused(false)}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!forgotLoading}
                    />
                  </View>

                  <TouchableOpacity
                    style={[styles.forgotBtn, forgotLoading && styles.buttonDisabled]}
                    onPress={handleForgotPasswordSendOtp}
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.forgotBtnText}>Send Reset Code</Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={styles.modalBadge}>
                    <ShieldCheck color="#01b4ae" size={32} />
                  </View>
                  <Text style={styles.modalTitle}>Verification Required</Text>
                  <Text style={styles.modalSubtitle}>
                    We've sent a 6-digit confirmation code to:
                  </Text>
                  <Text style={{ color: '#01b4ae', fontWeight: 'bold', marginBottom: 16 }}>{forgotEmail}</Text>

                  {/* OTP Code */}
                  <View style={styles.forgotInputWrapper}>
                    <ShieldCheck color="#9CA3AF" size={20} style={styles.forgotInputIcon} />
                    <TextInput
                      style={[
                        styles.forgotInput,
                        forgotOtpFocused && styles.forgotInputFocused
                      ]}
                      placeholder="Enter 6-digit code"
                      placeholderTextColor="#9CA3AF"
                      value={forgotOtp}
                      onChangeText={(text) => setForgotOtp(text.replace(/[^0-9]/g, ''))}
                      onFocus={() => setForgotOtpFocused(true)}
                      onBlur={() => setForgotOtpFocused(false)}
                      keyboardType="numeric"
                      maxLength={6}
                      editable={!forgotLoading}
                    />
                  </View>

                  {/* New Password */}
                  <View style={styles.forgotInputWrapper}>
                    <Lock color="#9CA3AF" size={20} style={styles.forgotInputIcon} />
                    <TextInput
                      style={[
                        styles.forgotInput,
                        styles.forgotPasswordInput,
                        forgotPasswordFocused && styles.inputFocused
                      ]}
                      placeholder="Enter new password"
                      placeholderTextColor="#9CA3AF"
                      value={forgotPassword}
                      onChangeText={setForgotPassword}
                      onFocus={() => setForgotPasswordFocused(true)}
                      onBlur={() => setForgotPasswordFocused(false)}
                      secureTextEntry={!forgotPasswordVisible}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!forgotLoading}
                    />
                    <TouchableOpacity
                      onPress={() => setForgotPasswordVisible(!forgotPasswordVisible)}
                      style={styles.forgotEyeIcon}
                      activeOpacity={0.7}
                      disabled={forgotLoading}
                    >
                      {forgotPasswordVisible ? (
                        <EyeOff color="#9CA3AF" size={20} />
                      ) : (
                        <Eye color="#9CA3AF" size={20} />
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Confirm Password */}
                  <View style={styles.forgotInputWrapper}>
                    <Lock color="#9CA3AF" size={20} style={styles.forgotInputIcon} />
                    <TextInput
                      style={[
                        styles.forgotInput,
                        forgotConfirmPasswordFocused && styles.inputFocused
                      ]}
                      placeholder="Confirm new password"
                      placeholderTextColor="#9CA3AF"
                      value={forgotConfirmPassword}
                      onChangeText={setForgotConfirmPassword}
                      onFocus={() => setForgotConfirmPasswordFocused(true)}
                      onBlur={() => setForgotConfirmPasswordFocused(false)}
                      secureTextEntry={!forgotPasswordVisible}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!forgotLoading}
                    />
                  </View>

                  <TouchableOpacity
                    style={[styles.forgotBtn, forgotLoading && styles.buttonDisabled]}
                    onPress={handleForgotPasswordReset}
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.forgotBtnText}>Reset Password</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  onPress={() => setForgotModalVisible(false)}
                  disabled={forgotLoading}
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
    </FullScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#01b4ae',
  },
  content: {
    paddingHorizontal: 20,
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
  },
  scrollContentContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 40,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoBadge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(1, 180, 174, 0.25)',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
    overflow: 'hidden',
  },
  logo: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 2,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.95,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  welcomeText: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 22,
  },
  form: {
    gap: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  input: {
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
    color: '#111827',
  },
  inputFocused: {
    borderColor: '#01b4ae',
    backgroundColor: '#FFFFFF',
    shadowColor: '#01b4ae',
    shadowOffset: {
      width: 0,
      height: 0,
    },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  passwordWrapper: {
    position: 'relative',
  },
  passwordInputField: {
    paddingRight: 50, // Make room for the eye icon
  },
  eyeIconAbsolute: {
    position: 'absolute',
    right: 4,
    top: 8,
    padding: 12,
    zIndex: 10,
  },
  button: {
    backgroundColor: '#01b4ae',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#01b4ae',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  loginFooter: {
    marginTop: 24,
    alignItems: 'center',
    gap: 8,
  },
  footerText: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
  },
  termsLink: {
    fontSize: 13,
    color: '#01b4ae',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  helpLinkContainer: {
    marginTop: 4,
    alignItems: 'center',
    padding: 4,
  },
  helpLinkText: {
    fontSize: 14,
    color: '#01b4ae',
    fontWeight: '600',
  },
  signUpLinkContainer: {
    paddingVertical: 8,
    width: '100%',
    alignItems: 'center',
  },
  signUpLinkText: {
    color: '#01b4ae',
    fontWeight: '700',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
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
    marginBottom: 20,
  },
  forgotInputWrapper: {
    width: '100%',
    marginBottom: 16,
    position: 'relative',
  },
  forgotInputIcon: {
    position: 'absolute',
    left: 14,
    top: 15,
    zIndex: 1,
  },
  forgotInput: {
    width: '100%',
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
  forgotInputFocused: {
    borderColor: '#01b4ae',
    backgroundColor: '#FFFFFF',
  },
  forgotPasswordInput: {
    paddingRight: 50,
  },
  forgotEyeIcon: {
    position: 'absolute',
    right: 4,
    top: 3,
    padding: 12,
    zIndex: 10,
  },
  forgotBtn: {
    backgroundColor: '#01b4ae',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  forgotBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
    marginTop: 20,
  },
  cancelText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '600',
  },
});
