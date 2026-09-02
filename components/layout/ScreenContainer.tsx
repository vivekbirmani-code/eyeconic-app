import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Edge, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

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
 *
 * Also used as the content of full-screen React Native `Modal`s. RN re-parents
 * Modal content into a separate presentation container on iOS, which detaches
 * it from the root `SafeAreaProvider`'s view hierarchy — the native
 * `SafeAreaView` then finds no provider and silently applies zero insets
 * (content renders under the status bar / Dynamic Island). The nested
 * `SafeAreaProvider` re-establishes that context inside the Modal container,
 * and is a no-op for regular screen usage (it measures the same full-screen
 * frame as the root provider).
 */
export function FullScreenContainer({
  children,
  style,
}: Omit<ScreenContainerProps, 'edges'>) {
  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={[{ flex: 1 }, style]}
        edges={['top', 'bottom', 'left', 'right']}
      >
        {children}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
