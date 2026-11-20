import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  View,
  StyleSheet,
} from 'react-native';

interface CollapsibleProps {
  visible: boolean;
  children: React.ReactNode;
  /** Open/close fade duration in ms. Default 200 open / 160 close. */
  openDuration?: number;
  closeDuration?: number;
}

/**
 * Expand/collapse for the Groups module (mentor folders, the Create Group
 * type dropdown).
 *
 * Design constraints earned the hard way (two Android-only bugs shipped from
 * JS-animated `height`): this version NEVER animates a layout property
 * through the JS Animated bridge. Instead:
 *  - Height comes from plain mounting/unmounting of the content (auto height
 *    while open; the wrapper collapses to zero when the content is gone).
 *  - The native LayoutAnimation API animates the resulting layout change
 *    (height growth + siblings shifting) ON THE UI THREAD where supported —
 *    Android included. Where it's unsupported (web) it degrades to a no-op.
 *  - Opacity (a transform-safe property) fades through the JS Animated
 *    bridge with the native driver — safe on every renderer, including
 *    bridgeless/Fabric dev builds.
 *
 * Content unmounts only after the close fade completes, so closed folders
 * still cost nothing to keep around.
 */
export default function Collapsible({
  visible,
  children,
  openDuration = 200,
  closeDuration = 160,
}: CollapsibleProps) {
  const [shouldRender, setShouldRender] = useState(visible);
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  // Tracks the latest `visible` so a late fade-out callback can't unmount
  // content that has already been re-opened.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: openDuration,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: closeDuration,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && !visibleRef.current) {
          setShouldRender(false);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Animated.View
      style={[styles.container, { opacity }]}
      // Hide from a11y while collapsed so folders don't read out hidden rows.
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      {shouldRender ? <View collapsable={false}>{children}</View> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    // No height style by design — the container sizes to its (mounted or
    // absent) content, and LayoutAnimation smooths the change natively.
    overflow: 'hidden',
  },
});
