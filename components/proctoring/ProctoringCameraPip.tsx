/**
 * ProctoringCameraPip — the student-visible picture-in-picture front-camera
 * preview during proctored attempts (Phase 3, plan §10.1: "student-visible
 * PiP preview with an active indicator"). The SAME CameraView doubles as the
 * engine's capture source — the ref is shared with the hook, so the preview
 * and the analysis frames are one stream (no second camera session).
 *
 * The preview is never recorded, transmitted or stored: frames are analyzed
 * on-device and only structured episodes leave the device (plan §4.4).
 */

import React, { forwardRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';
import { PROCTORING_COPY } from '@/utils/proctoringCopy';

interface ProctoringCameraPipProps {
  /** Dim while the engine is paused/degraded — an honest status indicator. */
  dimmed?: boolean;
}

export const ProctoringCameraPip = forwardRef<CameraView, ProctoringCameraPipProps>(
  function ProctoringCameraPip({ dimmed = false }, ref) {
    return (
      <View style={styles.wrap} accessibilityLabel={PROCTORING_COPY.monitoring.active}>
        <View style={[styles.cameraWrap, dimmed ? styles.cameraWrapDimmed : null]}>
          <CameraView ref={ref} style={styles.camera} facing="front" mode="picture" />
        </View>
        <View style={styles.captionWrap}>
          <View style={[styles.dot, dimmed ? styles.dotDimmed : null]} />
          <Text style={styles.caption} numberOfLines={1}>
            {PROCTORING_COPY.monitoring.active}
          </Text>
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 8,
    right: 12,
    width: 104,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    padding: 4,
    // Elevated above question content; Android elevation is required for
    // overlays to stack above elevated cards (repo-wide finding).
    elevation: 6,
    zIndex: 20,
  },
  cameraWrap: {
    height: 120,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
  },
  cameraWrapDimmed: { opacity: 0.45 },
  camera: { flex: 1 },
  captionWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
    marginRight: 5,
  },
  dotDimmed: { backgroundColor: '#94A3B8' },
  caption: { fontSize: 9, color: '#E2E8F0', fontWeight: '600' },
});
