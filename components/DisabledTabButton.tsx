import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Lock } from 'lucide-react-native';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Tab bar button for temporarily disabled features
 * (see utils/featureAvailability.ts). Renders the standard icon + label
 * children with reduced emphasis and a small lock badge, and swallows
 * presses (pointerEvents="none") so the tab stays visible but cannot be
 * tapped. The destination screen is independently gated by withFeatureGate,
 * so deep links to it also land on the Coming Soon state.
 *
 * Layout note: the icon-above-label column layout arrives through
 * `props.style` from @react-navigation/bottom-tabs (tabVerticalUiKit), the
 * same styles the default PlatformPressable button receives — so this
 * container must not override flexDirection or padding, only add the
 * disabled treatment on top.
 */
export function DisabledTabButton(props: BottomTabBarButtonProps) {
  const ariaLabel =
    props.accessibilityLabel ?? (props as any)['aria-label'];

  return (
    <View
      style={[props.style, styles.tab]}
      pointerEvents="none"
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={ariaLabel}
      accessibilityState={{ disabled: true }}
    >
      {props.children}
      <View style={styles.lockBadge} pointerEvents="none">
        <Lock color="#FFFFFF" size={9} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Dimmed, inert replacement for the default pressable tab button.
  tab: {
    opacity: 0.55,
  },
  // Small badge pinned over the icon's top-right corner (the icon is
  // horizontally centred, ~22px wide, starting ~5px from the button's top).
  lockBadge: {
    position: 'absolute',
    top: 3,
    left: '50%',
    marginLeft: 10,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: '#9CA3AF',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
