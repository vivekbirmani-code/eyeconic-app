/**
 * MonitoringStatusDot — the compact proctoring indicator in the quiz header
 * (Phase 9 redesign), rendered immediately left of the quiz timer. Replaces
 * the rectangular camera PiP + status row: the visual truth now comes from
 * utils/proctoringStatus.ts (the engine's runtime state — green only when
 * genuinely monitoring), and a tap opens a small popover with the current
 * status label + detail.
 *
 * Popover mechanics: a transparent Modal (no inputs → none of the RN-Modal
 * keyboard/safe-area pitfalls apply). The full-screen backdrop catches any
 * outside tap (including over the dot itself → toggle-closes naturally);
 * the popover card swallows taps inside itself; Android back closes via
 * onRequestClose; unmounting the quiz screen disposes of everything. State
 * changes while open re-render the label/color live from props.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { getMonitoringStatusView } from '@/utils/proctoringStatus';
import { colors } from '@/utils/theme';
import type { ProctoringCameraIssue, ProctoringEngineState } from '@/services/proctoring/engine';

const DOT_SIZE = 10;
const POPOVER_WIDTH = 236;
const SCREEN_MARGIN = 12;
const POPOVER_GAP = 8;

interface MonitoringStatusDotProps {
  status: ProctoringEngineState['status'];
  cameraIssue: ProctoringCameraIssue | null;
}

export function MonitoringStatusDot({ status, cameraIssue }: MonitoringStatusDotProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dotRef = useRef<React.ComponentRef<typeof Pressable> | null>(null);
  const { width: windowWidth } = useWindowDimensions();

  const view = getMonitoringStatusView(status, cameraIssue);

  const openPopover = useCallback(() => {
    dotRef.current?.measure((_x: number, _y: number, w: number, h: number, pageX: number, pageY: number) => {
      setAnchor({ x: pageX, y: pageY, w, h });
      setOpen(true);
    });
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // Preferred: centered under the dot; clamped so the card never leaves the
  // screen (works across sizes/orientations — no hardcoded positions).
  const preferredLeft = anchor ? anchor.x + anchor.w / 2 - POPOVER_WIDTH / 2 : 0;
  const popoverLeft = Math.min(
    Math.max(preferredLeft, SCREEN_MARGIN),
    Math.max(SCREEN_MARGIN, windowWidth - POPOVER_WIDTH - SCREEN_MARGIN)
  );
  const popoverTop = anchor ? anchor.y + anchor.h + POPOVER_GAP : 0;

  return (
    <View style={styles.slot}>
      <Pressable
        ref={dotRef}
        onPress={open ? close : openPopover}
        // 10dp visual dot inflated to a 44dp touch target (10 + 17×2) — the
        // sole way to open the monitoring popover mid-attempt.
        hitSlop={17}
        accessibilityRole="button"
        accessibilityLabel={`Monitoring status: ${view.label}`}
        accessibilityHint="Opens a short description of the monitoring status"
        accessibilityState={{ expanded: open }}
        style={[styles.dot, { backgroundColor: view.color }]}
      />

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={close}
        statusBarTranslucent
      >
        {/* Backdrop: any tap outside the card closes (over the dot too — the
            natural toggle). */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityLabel="Close monitoring status"
          accessibilityRole="button"
        >
          {/* The card swallows taps inside itself — a no-op press handler
              stops them from reaching the backdrop. pointerEvents stays
              auto for accessibility. */}
          <Pressable
            onPress={() => { /* intentional no-op — keep the popover open */ }}
            style={[styles.popover, { top: popoverTop, left: popoverLeft }]}
            accessibilityLabel={`${view.label}${view.detail ? `. ${view.detail}` : ''}`}
          >
            <View style={styles.titleRow}>
              <View style={[styles.toneDot, { backgroundColor: view.color }]} />
              <Text style={styles.title} numberOfLines={2}>{view.label}</Text>
            </View>
            {view.detail ? (
              <Text style={styles.detail} numberOfLines={4}>{view.detail}</Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    marginRight: 8, // spacing between the dot and the quiz timer
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
  },
  popover: {
    position: 'absolute',
    width: POPOVER_WIDTH,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    // Subtle elevation on both platforms — present but not loud.
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toneDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
  },
  detail: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
    marginTop: 4,
  },
});
