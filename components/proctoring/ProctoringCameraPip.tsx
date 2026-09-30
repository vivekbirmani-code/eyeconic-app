/**
 * ProctoringCameraPip — the student-visible camera preview during a proctored
 * attempt (plan §10.1: student-visible preview with an active indicator).
 *
 * Track 2: on Android the preview is the NATIVE streaming view
 * (ProctoringCameraView) — preview and analysis frames are ONE camera session
 * (CameraX Preview + ImageAnalysis in a single bind). The sanitized
 * observations it emits are forwarded to the engine's StreamingCameraSource
 * through the module bus; nothing is ever recorded or stored. The expo-camera
 * snapshot fallback remains only as a defensive branch for platforms where
 * the native view is unavailable (precheck reports camera UNSUPPORTED there —
 * a proctored attempt cannot be in flight in that state).
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { CameraView } from 'expo-camera';
import { PROCTORING_COPY } from '@/utils/proctoringCopy';
import { getProctoringCameraView } from '@/modules/proctoring-spike/src';
import {
  emitProctoringObservation,
  emitProctoringCameraError,
  subscribeProctoringAnalysisPaused,
} from '@/services/proctoring/streamingCameraSource';

const NativeCameraView = Platform.OS === 'android' ? getProctoringCameraView() : null;

interface ProctoringCameraPipProps {
  dimmed?: boolean;
}

export const ProctoringCameraPip = React.forwardRef<CameraView, ProctoringCameraPipProps>(
  function ProctoringCameraPip({ dimmed }, ref) {
    // The engine's pause/resume drives the native analysis pause through the
    // bus (the view lives in React, the engine does not).
    const [analysisPaused, setAnalysisPaused] = useState(false);
    useEffect(() => subscribeProctoringAnalysisPaused(setAnalysisPaused), []);

    return (
      <View style={[styles.wrap, dimmed && styles.dimmed]} pointerEvents="none">
        {NativeCameraView ? (
          <NativeCameraView
            style={styles.camera}
            paused={analysisPaused}
            minIntervalMs={250}
            onFrameObservation={(event) => emitProctoringObservation(event.nativeEvent)}
            onCameraError={(event) => emitProctoringCameraError(event.nativeEvent)}
          />
        ) : (
          // Defensive fallback only — unreachable for an armed proctored
          // attempt (precheck requires the native module on Android).
          <CameraView ref={ref} style={styles.camera} facing="front" mode="picture" />
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
