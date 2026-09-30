/**
 * Phase 0 CV/ML feasibility spike — JS binding for the local Expo module
 * `modules/proctoring-spike` (AI Proctoring plan §5). SPIKE ONLY.
 *
 * The native side wraps Google ML Kit Face Detection (Tier A candidate) and
 * accepts a base64 JPEG from expo-camera's `takePictureAsync`. This file is the
 * ONLY place the native module is touched; the pure spike logic in
 * `services/proctoringSpike/` works on plain data so it stays unit-testable
 * without any native runtime.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';
import type { ComponentType } from 'react';

// Bridge contract types live in their neutral home; re-export them so
// consumers can import everything from one place. (Type-only import added for
// the local return type below — the re-export alone does not bind the name in
// this module's scope; zero runtime change.)
import type { SpikeNativeDetectResult } from '../../../services/proctoringSpike/types';
export type {
  SpikeNativeDetectResult,
  SpikeNativeFace,
} from '../../../services/proctoringSpike/types';

/** Tier identifier mirrored from the native module (plan §5.4 ladder). */
export const PROCTORING_SPIKE_TIER = 'mlkit-face-detection';

export interface SpikeNativeDetectOptions {
  /** Downscale target for the long edge before detection (default 640). */
  maxDim?: number;
}

export class SpikeModuleUnavailableError extends Error {
  constructor() {
    super(
      'ProctoringSpike native module is not available on this runtime ' +
        '(requires an Android development build; Expo Go cannot load local native modules).'
    );
    this.name = 'SpikeModuleUnavailableError';
  }
}

const ProctoringSpike = requireOptionalNativeModule('ProctoringSpike');

/** True when the native spike module is loaded (Android dev/release build only). */
export function isProctoringSpikeNativeAvailable(): boolean {
  return ProctoringSpike !== null;
}

/** Static module info (tier + pinned ML Kit version) or null when unavailable. */
export function getProctoringSpikeInfo(): { tier: string; mlkitVersion: string } | null {
  if (!ProctoringSpike) return null;
  const info = ProctoringSpike.getInfo() as Record<string, unknown>;
  return {
    tier: typeof info?.tier === 'string' ? info.tier : PROCTORING_SPIKE_TIER,
    mlkitVersion: typeof info?.mlkitVersion === 'string' ? info.mlkitVersion : 'unknown',
  };
}

/**
 * Run ML Kit face detection on one base64 JPEG frame.
 * Throws SpikeModuleUnavailableError when the native module is not loaded.
 */
export async function nativeDetectFaces(
  base64Jpeg: string,
  options: SpikeNativeDetectOptions = {}
): Promise<SpikeNativeDetectResult> {
  if (!ProctoringSpike) {
    throw new SpikeModuleUnavailableError();
  }
  return ProctoringSpike.detectFacesJpegBase64(base64Jpeg, {
    maxDim: options.maxDim ?? 640,
  }) as Promise<SpikeNativeDetectResult>;
}

// ===== Track 2 — the streaming camera-analysis view (ProctoringCameraView).
// Preview + ImageAnalysis in one bind; every analyzed frame emits a sanitized
// `onFrameObservation` with the SAME payload shape nativeDetectFaces returns.
// Only sanitized observations cross the bridge — no pixels ever do.

export interface ProctoringCameraViewProps {
  /** View style (dimensions/aspect come from the PiP container). */
  style?: object;
  /** Pause analysis without unbinding the preview (AppState background). */
  paused?: boolean;
  /** Minimum spacing between analyzed frames in ms (default 250; 100–5000). */
  minIntervalMs?: number;
  /** Sanitized per-frame observation (same shape as nativeDetectFaces). */
  onFrameObservation?: (event: { nativeEvent: SpikeNativeDetectResult }) => void;
  /** Camera/detector trouble (codes: no_activity, bind_failed, …). */
  onCameraError?: (event: {
    nativeEvent: { code: string; message: string };
  }) => void;
  /** Camera health phase: binding → bound → open (open = frames imminent). */
  onCameraStatus?: (event: {
    nativeEvent: { phase: 'binding' | 'bound' | 'open' };
  }) => void;
}

let cachedView: ComponentType<ProctoringCameraViewProps> | null | undefined;

/**
 * The streaming view component, or null when the native module is absent
 * (web, iOS, Expo Go). Lazily required so importing this binding never
 * throws on platforms without the module.
 */
export function getProctoringCameraView(): ComponentType<ProctoringCameraViewProps> | null {
  if (cachedView !== undefined) return cachedView;
  if (!ProctoringSpike) {
    cachedView = null;
    return cachedView;
  }
  try {
    // Intentionally lazy: requiring the view manager eagerly would throw at
    // import time on platforms without the module (web, iOS, Expo Go).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireNativeViewManager } = require('expo-modules-core');
    cachedView = requireNativeViewManager('ProctoringSpike') as ComponentType<ProctoringCameraViewProps>;
  } catch {
    cachedView = null;
  }
  return cachedView;
}
