/**
 * ProctoringCameraPip — the student-visible monitoring indicator during a
 * proctored attempt (plan §10.1: student-visible indicator with an active
 * dot).
 *
 * Track 2b Phase 3 (§43): the native MODULE owns the camera and the engine
 * streams from it headlessly — this PiP is NO LONGER on the frame path and
 * renders no camera on Android (the retired view refuses to bind while the
 * service owns the camera; two owners would fight over the sensor). It is
 * deliberately OPTIONAL: absent, late, remounted, or failed, analysis is
 * unaffected. Nothing is ever recorded or stored. A live preview attachment
 * is future native work, intentionally out of Phase 3 scope (§43 decision).
 * The expo-camera branch survives only for non-Android, where the engine's
 * snapshot fallback path still captures through this CameraView's ref.
 */

import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { CameraView } from 'expo-camera';
import { PROCTORING_COPY } from '@/utils/proctoringCopy';

interface ProctoringCameraPipProps {
  dimmed?: boolean;
}

export const ProctoringCameraPip = React.forwardRef<CameraView, ProctoringCameraPipProps>(
  function ProctoringCameraPip({ dimmed }, ref) {
    return (
      <View style={[styles.wrap, dimmed && styles.dimmed]} pointerEvents="none">
        {Platform.OS !== 'android' ? (
          // Defensive fallback only — unreachable for an armed proctored
          // attempt on Android (module transport); the non-Android snapshot
          // path captures through this CameraView's ref.
          <CameraView ref={ref} style={styles.camera} facing="front" mode="picture" />
        ) : (
          // Android: indicator tile only — the module camera streams to the
          // engine with no view attached (same footprint the preview had).
          <View style={styles.camera} />
        )}
        <View style={styles.statusRow}>
          <View style={[styles.dot, dimmed ? styles.dotIdle : styles.dotLive]} />
          <Text style={styles.caption}>{PROCTORING_COPY.monitoring.active}</Text>
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
    backgroundColor: '#000',
    overflow: 'hidden',
    elevation: 6,
    zIndex: 20,
  },
  dimmed: { opacity: 0.45 },
  camera: {
    width: '100%',
    aspectRatio: 3 / 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  dotLive: { backgroundColor: '#22C55E' },
  dotIdle: { backgroundColor: '#9CA3AF' },
  caption: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '600',
  },
});
