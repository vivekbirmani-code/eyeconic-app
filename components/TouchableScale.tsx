import React, { useRef, useState } from 'react';
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
 * Press feedback for cards and primary buttons: a quick spring scale-down on
 * press-in and a bouncy release, replacing the default gray flash.
 *
 * IMPORTANT (Android/bridgeless hard lesson): the animated transform/opacity
 * are attached ONLY while a press animation is actually running. Views that
 * carry never-driven native Animated props at rest can paint as NOTHING when
 * remounted (e.g. the folder-content cards after a collapse/reopen), while
 * driving animations work fine. At rest this renders a plain view — immune
 * to that — and the values only attach for the lifetime of a press.
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
  // Animated style nodes exist on the tree only while a press cycle runs.
  const [isPressing, setIsPressing] = useState(false);

  const handlePressIn = (e: any) => {
    if (!disabled) {
      setIsPressing(true);
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
    }).start(({ finished }) => {
      // Detach the animated nodes once the release settles; the view goes
      // back to plain (resting) styling.
      if (finished) setIsPressing(false);
    });
    onPressOut?.(e);
  };

  return (
    <Pressable
      {...pressableProps}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View
        style={[
          styles.inner,
          style,
          isPressing ? { transform: [{ scale }], opacity } : null,
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The card visuals come from the caller's `style`; this wrapper only adds
  // the animated transform while pressing. It stretches like a plain View so
  // full-width buttons and list rows keep their layout.
  inner: {},
});
