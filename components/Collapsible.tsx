import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, StyleSheet } from 'react-native';

interface CollapsibleProps {
  visible: boolean;
  children: React.ReactNode;
  /** Open/close duration in ms. Default 220 open / 180 close. */
  openDuration?: number;
  closeDuration?: number;
}

/**
 * Height-animated expand/collapse used by the Groups module (mentor folders,
 * the Create Group type dropdown). Content measures itself with onLayout;
 * the wrapper animates height 0 ↔ measured and fades alongside. Height can't
 * use the native driver, so this runs on JS — folder contents are small, and
 * the content unmounts once fully collapsed so collapsed folders cost
 * nothing to keep around.
 */
export default function Collapsible({
  visible,
  children,
  openDuration = 220,
  closeDuration = 180,
}: CollapsibleProps) {
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [contentHeight, setContentHeight] = useState(0);
  // Render content whenever open, or while a close animation is running.
  const [shouldRender, setShouldRender] = useState(visible);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: openDuration,
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: closeDuration,
        useNativeDriver: false,
      }).start(({ finished }) => {
        // Unmount only if no re-open started while we were closing.
        if (finished) setShouldRender(false);
      });
    }
  }, [visible, progress, openDuration, closeDuration]);

  if (!shouldRender) return null;

  const animatedHeight =
    contentHeight > 0
      ? progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, contentHeight],
        })
      : 0;

  return (
    <Animated.View
      style={[styles.container, { height: animatedHeight, opacity: progress }]}
      // Hide from a11y while collapsed so folders don't read out hidden rows.
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      <View
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0) setContentHeight(h);
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});
