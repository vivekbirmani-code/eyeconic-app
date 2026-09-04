import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  StyleSheet,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';

type DialogAnimation = 'none' | 'fade' | 'slide';

interface KeyboardAvoidingDialogProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Whether the Android hardware back button closes the dialog (mirrors
   * RN Modal's onRequestClose). Leave enabled for in-screen dialogs; disable
   * when the dialog fills a route that already handles back navigation.
   */
  dismissable?: boolean;
  animationType?: DialogAnimation;
  /** Style of the centered card (background, radius, width, ...). */
  cardStyle?: StyleProp<ViewStyle>;
  /** Overlay scrim override (defaults to the app's dark dim). */
  overlayStyle?: StyleProp<ViewStyle>;
  /**
   * Android drawing order. In-tree overlays must exceed the elevation of the
   * content they cover (e.g. the User Details card sits at elevation 12) —
   * on Android a lower elevation hides behind it regardless of child order.
   */
  elevation?: number;
  zIndex?: number;
  children: React.ReactNode;
}

const SLIDE_DURATION = 250;
const FADE_DURATION = 200;

/**
 * Centered-card dialog rendered in the MAIN window instead of a React Native
 * `Modal`.
 *
 * Why: on Android (Expo SDK 54 edge-to-edge enforced, worst on Android 15+)
 * RN Modal content lives in its own Dialog window which is neither resized by
 * the soft keyboard nor emits keyboard events — so keyboards overlap the lower
 * half of the dialog and no KeyboardAvoidingView can help. Rendering here in
 * the main window keeps the standard keyboard pipeline working: keyboard
 * events fire and `behavior="padding"` lifts the card above the keyboard.
 *
 * Also handles the Android back button (which the native Modal provided) and
 * plays an entrance/exit animation so callers keep RN Modal's visuals.
 */
export function KeyboardAvoidingDialog({
  visible,
  onClose,
  dismissable = true,
  animationType = 'none',
  cardStyle,
  overlayStyle,
  elevation = 24,
  zIndex = 100,
  children,
}: KeyboardAvoidingDialogProps) {
  // Keep the tree mounted while the close animation plays (like RN Modal).
  const [shouldRender, setShouldRender] = useState(visible);
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      Animated.timing(anim, {
        toValue: 1,
        duration:
          animationType === 'slide' ? SLIDE_DURATION
            : animationType === 'fade' ? FADE_DURATION
              : 0,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      // If the dialog was never opened, skip the animation entirely.
      Animated.timing(anim, {
        toValue: 0,
        duration:
          animationType === 'slide' ? SLIDE_DURATION
            : animationType === 'fade' ? FADE_DURATION
              : 0,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setShouldRender(false);
      });
    }
  }, [visible, animationType, anim]);

  // Android hardware back closes the dialog instead of the screen behind it.
  useEffect(() => {
    if (!visible || !dismissable) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [visible, dismissable, onClose]);

  if (!shouldRender) return null;

  const animatedStyle =
    animationType === 'slide'
      ? {
        opacity: anim,
        transform: [
          {
            translateY: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [Dimensions.get('window').height, 0],
            }),
          },
        ],
      }
      : animationType === 'fade'
        ? { opacity: anim }
        : undefined;

  return (
    <Animated.View
      style={[styles.overlay, overlayStyle, animatedStyle, { zIndex, elevation }]}
    >
      <KeyboardAvoidingView behavior="padding" style={styles.avoid} pointerEvents="box-none">
        <View style={cardStyle}>{children}</View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  avoid: {
    width: '100%',
    alignItems: 'center',
    // Caps the card at a fraction of whatever height is left above the
    // keyboard, so fixed card heights can never run under the keyboard.
    maxHeight: '85%',
  },
});
