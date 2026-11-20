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
 * the Create Group type dropdown).
 *
 * Robustness rules learned the hard way (folder stayed empty on Android
 * while working on web):
 *  1. The animated height is ONE stable Animated.Value. Never an
 *     interpolation recreated per render — on Android, swapping animated
 *     style nodes mid-lifecycle doesn't re-sync the native view until the
 *     source value changes, so a recreated node can leave the view stuck at
 *     its first-applied height (0).
 *  2. Until the content has been measured once, an OPEN collapsible renders
 *     with auto height — the content is visible immediately, with no
 *     dependency on onLayout having fired.
 *  3. The measuring view is explicitly non-collapsable so the Android view
 *     flattener can never fold it (and its onLayout) away.
 *
 * Content unmounts once fully collapsed, so closed folders cost nothing.
 */
export default function Collapsible({
  visible,
  children,
  openDuration = 220,
  closeDuration = 180,
}: CollapsibleProps) {
  // Stable height driver. Meaningful only once measured (measuredHeight > 0).
  const heightAnim = useRef(new Animated.Value(0)).current;
  const [measuredHeight, setMeasuredHeight] = useState(0);
  // Render content whenever open, or while a close animation is running.
  const [shouldRender, setShouldRender] = useState(visible);
  const hasMeasured = measuredHeight > 0;

  useEffect(() => {
    if (!hasMeasured) {
      // No height to animate yet: plain show/hide. Measurement upgrades us
      // to the animated path (and while open+unmeasured we render auto
      // height, so this only ever covers a pre-measure toggle).
      setShouldRender(visible);
      return;
    }
    if (visible) {
      setShouldRender(true);
      Animated.timing(heightAnim, {
        toValue: measuredHeight,
        duration: openDuration,
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(heightAnim, {
        toValue: 0,
        duration: closeDuration,
        useNativeDriver: false,
      }).start(({ finished }) => {
        // Unmount only if no re-open started while we were closing.
        if (finished) setShouldRender(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, hasMeasured]);

  if (!shouldRender) return null;

  // Unmeasured + open → auto height (content shows immediately). Everything
  // else runs through the stable animated height.
  const heightStyle = hasMeasured ? { height: heightAnim } : visible ? undefined : { height: 0 };

  return (
    <Animated.View
      style={[styles.container, heightStyle]}
      // Hide from a11y while collapsed so folders don't read out hidden rows.
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      <View
        collapsable={false}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          // Never adopt a measurement while collapsed/closing: a shrinking
          // parent can re-measure its child smaller, and adopting that would
          // clip every subsequent open to a fraction of the real height
          // (the "dropdown won't fully reopen" bug). Measurements only count
          // from a full, open layout.
          if (h <= 0 || !visible) return;
          if (h === measuredHeight) return;
          if (!hasMeasured) {
            // First measurement: adopt instantly — while open+unmeasured we
            // render auto height (exactly h), so this is not a jump.
            heightAnim.setValue(h);
          } else {
            // Content genuinely resized while open (e.g. a group refetched
            // in): follow the new size so nothing gets clipped.
            heightAnim.setValue(h);
          }
          setMeasuredHeight(h);
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
