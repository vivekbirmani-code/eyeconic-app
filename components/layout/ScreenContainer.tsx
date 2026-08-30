import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';

export type SafeAreaEdge = Edge;

interface ScreenContainerProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Safe area edges to apply. Tab screens should use top only. */
  edges?: Edge[];
}

const TAB_SCREEN_EDGES: Edge[] = ['top'];

/**
 * Primary screen wrapper for tab and stack screens.
 * Uses react-native-safe-area-context (works on iOS and Android).
 */
export function ScreenContainer({
  children,
  style,
  edges = TAB_SCREEN_EDGES,
}: ScreenContainerProps) {
  return (
    <SafeAreaView style={[{ flex: 1 }, style]} edges={edges}>
      {children}
    </SafeAreaView>
  );
}

/**
 * Full-screen layout outside the tab navigator (auth, calls, guest flows).
 */
export function FullScreenContainer({
  children,
  style,
}: Omit<ScreenContainerProps, 'edges'>) {
  return (
    <SafeAreaView
      style={[{ flex: 1 }, style]}
      edges={['top', 'bottom', 'left', 'right']}
    >
      {children}
    </SafeAreaView>
  );
}
