import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  PressableProps,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';

interface TouchableScaleProps extends PressableProps {
  /** Scale factor while pressed. Default 0.97. */
  scaleTo?: number;
  /** Slight dim while pressed (opacity). Default 0.9. */
  dimTo?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * Press feedback for cards and primary buttons: a quick native-driven spring
 * scale-down on press-in and a bouncy release, replacing the default gray
 * flash. Purely visual — the press/pressOut/press handlers come from
 * Pressable untouched.
 */
export default function TouchableScale({
  scaleTo = 0.97,
  dimTo = 0.9,
  style,
  children,
  disabled,
  onPressIn,
  onPressOut,
  ...pressableProps
}: TouchableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const handlePressIn = (e: any) => {
    if (!disabled) {
      Animated.spring(scale, {
        toValue: scaleTo,
        speed: 40,
        bounciness: 0,
        useNativeDriver: true,
      }).start();
      Animated.timing(opacity, {
        toValue: dimTo,
        duration: 80,
        useNativeDriver: true,
      }).start();
    }
    onPressIn?.(e);
  };

  const handlePressOut = (e: any) => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 200,
      useNativeDriver: true,
    }).start();
    Animated.timing(opacity, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
    onPressOut?.(e);
  };

  return (
    <Pressable
      {...pressableProps}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View style={[styles.inner, style, { transform: [{ scale }], opacity }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The card visuals come from the caller's `style`; this wrapper only adds
  // the animated transform. It stretches like a plain View so full-width
  // buttons and list rows keep their layout.
  inner: {},
});
