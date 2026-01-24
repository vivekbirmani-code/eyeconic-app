import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image, Animated, Dimensions, Easing, StatusBar } from 'react-native';
import { useRouter, useRootNavigationState } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';

const { width } = Dimensions.get('window');

// Keep splash screen visible until we are ready
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function CinematicSplash() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const rootNavigationState = useRootNavigationState();
  const [animationComplete, setAnimationComplete] = useState(false);

  // Animation Values
  // Logo Logic: 
  // Final State (Flex Centered) -> translateX: 0
  // Initial State (Visually Centered) -> translateX: ~110 (Half of Text Width + Gap)
  // Animation: 110 -> 160 (Anticipation) -> 0 (Reveal)
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.3)).current;
  const logoTranslateX = useRef(new Animated.Value(110)).current; // Start shifted right to compensate for text space
  
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateX = useRef(new Animated.Value(-20)).current; 
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const taglineTranslateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});

    const runAnimation = async () => {
      // Phase 1: Logo Enter (Fade In + Scale Up in Center)
      // It starts at translateX: 110, which visually centers it because the hidden text is ~220px wide
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 6,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start(async () => {
        // Short pause
        await new Promise(r => setTimeout(r, 400));

        // Phase 2: Anticipation (Move slightly MORE right)
        Animated.timing(logoTranslateX, {
          toValue: 150, // Move 40px right
          duration: 600,
          useNativeDriver: true,
          easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        }).start(() => {
          // Phase 3: The Reveal (Power Move Left to 0)
          Animated.parallel([
            Animated.timing(logoTranslateX, {
              toValue: 0, // Natural flex position
              duration: 900,
              useNativeDriver: true,
              easing: Easing.out(Easing.exp),
            }),
            Animated.stagger(100, [
              Animated.parallel([
                Animated.timing(textOpacity, {
                  toValue: 1,
                  duration: 600,
                  useNativeDriver: true,
                }),
                Animated.spring(textTranslateX, {
                  toValue: 0,
                  friction: 8,
                  tension: 40,
                  useNativeDriver: true,
                }),
              ]),
              Animated.timing(taglineOpacity, {
                toValue: 1,
                duration: 600,
                delay: 200,
                useNativeDriver: true,
              }),
              Animated.timing(taglineTranslateY, {
                toValue: 0,
                duration: 600,
                delay: 200,
                useNativeDriver: true,
                easing: Easing.out(Easing.cubic),
              }),
            ])
          ]).start(() => {
             // Animation Complete
             setTimeout(() => {
              setAnimationComplete(true);
            }, 1200);
          });
        });
      });
    };

    runAnimation();
  }, []);

  // Navigation Logic
  useEffect(() => {
    if (animationComplete && !isLoading && rootNavigationState?.key) {
      if (user) {
        // If profile incomplete, dashboard handles redirection, so safe to go there
        router.replace('/(tabs)/dashboard');
      } else {
        router.replace('/login');
      }
    }
  }, [animationComplete, isLoading, user, rootNavigationState?.key]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      
      {/* Background Gradient */}
      <LinearGradient
        colors={['#01b4ae', '#008f8a', '#01b4ae']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={styles.content}>
        <View style={styles.row}>
          {/* Logo */}
          <Animated.View
            style={[
              styles.logoContainer,
              {
                opacity: logoOpacity,
                transform: [
                  { scale: logoScale },
                  { translateX: logoTranslateX }
                ]
              }
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

          {/* Text Container */}
          <View style={styles.textContainer}>
            <Animated.View
              style={{
                opacity: textOpacity,
                transform: [{ translateX: textTranslateX }]
              }}
            >
              <Text style={styles.title}>EYECONIC</Text>
            </Animated.View>
            
            <Animated.View
              style={{
                opacity: taglineOpacity,
                transform: [{ translateY: taglineTranslateY }]
              }}
            >
              <Text style={styles.tagline}>Your path to success</Text>
            </Animated.View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#01b4ae',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Width set to ensure logo and text have space relative to center
    width: width, 
    paddingHorizontal: 20,
  },
  logoContainer: {
    zIndex: 10, // Ensure logo is above text if they overlap
  },
  logoBadge: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  logo: {
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  textContainer: {
    marginLeft: 20,
    justifyContent: 'center',
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 3,
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  tagline: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    letterSpacing: 1,
    marginTop: 4,
    fontWeight: '500',
  },
});