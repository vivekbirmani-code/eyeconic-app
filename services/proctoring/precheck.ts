/**
 * Pure precheck aggregation helpers (AI Proctoring plan §8). The precheck
 * screen owns the native plumbing (camera, permissions, network); these
 * functions turn raw outcomes into the check statuses the server's
 * precheck-report endpoint validates. Pure on purpose: fully unit-testable in
 * the root ts-jest (node) environment.
 *
 * The SERVER decides the final verdict — nothing here ever asserts
 * "precheck passed" on the student's behalf (plan §24.1).
 */

import type { FaceReadinessFrame } from './detector';

export type PrecheckCheckStatus = 'PASS' | 'RETRYABLE' | 'FAIL' | 'UNSUPPORTED';

export interface PrecheckCheckResult {
  id: string;
  status: PrecheckCheckStatus;
  detail?: string;
  /** Face-readiness frame-agreement facts (validated by the server). */
  metadata?: { frames: number; agreedFrames: number; faceCountClass: string; visibility: string };
}

export const PRECHECK_CHECK_IDS = [
  'device_capability',
  'camera_permission',
  'camera_availability',
  'face_readiness',
  'network',
] as const;

export interface PrecheckReportDevice {
  platform: string;
  osVersion: number;
  model?: string;
  ramMb?: number;
}

export interface PrecheckReportPayload {
  device: PrecheckReportDevice;
  network: { reachable: boolean; authedPingMs?: number };
  checks: PrecheckCheckResult[];
}

/**
 * Face-readiness aggregation (§8.3/§8.4): a strict majority of at least
 * `minFrames` captured frames must classify as exactly one reasonably
 * visible face ('one' + 'ok'). Zero/multiple/partial outcomes map to
 * actionable reasons; too few frames is retryable (transient).
 */
export function aggregateFaceFrames(
  frames: FaceReadinessFrame[],
  minFrames = 3
): { status: PrecheckCheckStatus; reasonCode?: string; detail?: string; metadata?: { frames: number; agreedFrames: number; faceCountClass: string; visibility: string } } {
  const usable = frames.filter(
    (f) => f.faceCountClass !== undefined && f.visibility !== undefined
  );
  if (usable.length < minFrames) {
    return {
      status: 'RETRYABLE',
      reasonCode: 'not_enough_frames',
      detail: 'Camera check did not complete — try again.',
    };
  }

  const agreed = usable.filter(
    (f) => f.faceCountClass === 'one' && f.visibility === 'ok'
  );
  const last = usable[usable.length - 1];
  const metadata = {
    frames: usable.length,
    agreedFrames: agreed.length,
    faceCountClass: last.faceCountClass,
    visibility: last.visibility,
  };

  if (agreed.length > usable.length / 2) {
    return { status: 'PASS', metadata };
  }

  // Failure reason from the dominant non-passing shape — actionable guidance.
  const counts = { none: 0, multiple: 0, visibility: 0 as number };
  for (const f of usable) {
    if (f.faceCountClass === 'none') counts.none += 1;
    else if (f.faceCountClass === 'multiple') counts.multiple += 1;
    else counts.visibility += 1; // one face, but small/partial
  }
  if (counts.none >= counts.multiple && counts.none >= counts.visibility) {
    return { status: 'FAIL', reasonCode: 'face_not_detected', metadata };
  }
  if (counts.multiple >= counts.visibility) {
    return { status: 'FAIL', reasonCode: 'multiple_faces', metadata };
  }
  return { status: 'FAIL', reasonCode: 'face_visibility', metadata };
}

/**
 * Builds the precheck-report payload from the device facts + check outcomes.
 * Kept as data — the screen posts it verbatim; the server re-validates.
 */
export function buildPrecheckReport(input: {
  device: PrecheckReportDevice;
  network: { reachable: boolean; authedPingMs?: number };
  checks: PrecheckCheckResult[];
}): PrecheckReportPayload {
  const checks = PRECHECK_CHECK_IDS.map(
    (id) => input.checks.find((c) => c.id === id) ?? { id, status: 'FAIL' as PrecheckCheckStatus, detail: 'not run' }
  );
  return { device: input.device, network: input.network, checks };
}
