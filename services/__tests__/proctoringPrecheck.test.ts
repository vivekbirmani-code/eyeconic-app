/**
 * Unit tests for the client-side proctoring precheck helpers (plan §8) and
 * the centralized copy module (plan §9, D7 — Phase 2 acceptance criterion 7).
 */

import {
  aggregateFaceFrames,
  buildPrecheckReport,
  deriveAttentionBaseline,
  PRECHECK_CHECK_IDS,
} from '../proctoring/precheck';
import { PROCTORING_COPY, CONSENT_TEXT_VERSION } from '../../utils/proctoringCopy';

const frame = (faceCountClass: 'none' | 'one' | 'multiple', visibility: 'none' | 'ok' | 'partial' | 'small' | 'multiple') => ({
  faceCountClass,
  visibility,
  // Phase 5: no usable pose by default (baseline derivation returns null).
  headPose: null,
});

describe('aggregateFaceFrames', () => {
  it('passes on a strict majority of one-well-visible-face frames', () => {
    const result = aggregateFaceFrames([
      frame('one', 'ok'),
      frame('one', 'ok'),
      frame('one', 'partial'),
    ], 3);
    expect(result.status).toBe('PASS');
    expect(result.metadata).toMatchObject({ frames: 3, agreedFrames: 2 });
  });

  it('fails with face_not_detected when no-face dominates', () => {
    const result = aggregateFaceFrames([
      frame('none', 'none'),
      frame('none', 'none'),
      frame('one', 'ok'),
    ], 3);
    expect(result.status).toBe('FAIL');
    expect(result.reasonCode).toBe('face_not_detected');
  });

  it('fails with multiple_faces when a second person dominates the frames', () => {
    const result = aggregateFaceFrames([
      frame('multiple', 'multiple'),
      frame('multiple', 'multiple'),
      frame('one', 'ok'),
    ], 3);
    expect(result.status).toBe('FAIL');
    expect(result.reasonCode).toBe('multiple_faces');
  });

  it('fails with face_visibility when the single face is too small/partial', () => {
    const result = aggregateFaceFrames([
      frame('one', 'small'),
      frame('one', 'partial'),
      frame('one', 'small'),
    ], 3);
    expect(result.status).toBe('FAIL');
    expect(result.reasonCode).toBe('face_visibility');
  });

  it('is retryable when too few usable frames were captured (transient)', () => {
    const result = aggregateFaceFrames([frame('one', 'ok'), frame('one', 'ok')], 3);
    expect(result.status).toBe('RETRYABLE');
    expect(result.reasonCode).toBe('not_enough_frames');
  });

  it('an exact tie does not pass (strict majority required)', () => {
    const result = aggregateFaceFrames([
      frame('one', 'ok'),
      frame('none', 'none'),
    ], 2);
    expect(result.status).toBe('FAIL');
  });
});

describe('buildPrecheckReport', () => {
  it('emits every check id in registry order, defaulting un-run ones to FAIL', () => {
    const payload = buildPrecheckReport({
      device: { platform: 'android', osVersion: 33 },
      network: { reachable: true, authedPingMs: 90 },
      checks: [{ id: 'device_capability', status: 'PASS' }],
    });
    expect(payload.checks.map((c) => c.id)).toEqual([...PRECHECK_CHECK_IDS]);
    expect(payload.checks.find((c) => c.id === 'network')?.status).toBe('FAIL'); // defaulted
    expect(payload.checks.find((c) => c.id === 'device_capability')?.status).toBe('PASS');
  });
});

describe('proctoringCopy (D7 centralized copy)', () => {
  it('carries a consent text version for audit', () => {
    expect(CONSENT_TEXT_VERSION).toMatch(/^\d{4}-\d{2}-v\d+$/);
  });

  it('covers every precheck step the client can run', () => {
    for (const stepId of PRECHECK_CHECK_IDS) {
      expect(PROCTORING_COPY.precheck.steps[stepId as keyof typeof PROCTORING_COPY.precheck.steps]).toBeDefined();
    }
  });

  it('never claims capabilities that do not exist (D7 banned language)', () => {
    // Affirmative claims of non-existent capability are banned. The consent
    // copy explicitly DENIES photos/video, which is required — so the test
    // forbids the banned CLAIM words, not the denial words.
    const everything = JSON.stringify(PROCTORING_COPY).toLowerCase();
    for (const banned of ['cheat', 'fraud', 'gaze', 'eye track', 'identity', 'recognize your face']) {
      expect(everything.includes(banned)).toBe(false);
    }
    // The honesty lines must be present.
    expect(PROCTORING_COPY.consent.lines.join(' ')).toContain('No photos or videos are recorded or stored');
  });

  it('is the single copy source for the precheck screen (criterion 7)', () => {
    // Source-scan (same technique as the feature-flag drift alarm): the
    // screen must render from the copy module, with no stray verdict copy.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const screenPath = path.resolve(__dirname, '../../app/(tabs)/quizzes/[id]/precheck.tsx');
    const source = fs.readFileSync(screenPath, 'utf8');
    expect(source).toContain('PROCTORING_COPY');
    expect(source).toContain("from '@/utils/proctoringCopy'");
  });
});

// ===== Phase 5 — attention baseline derivation (D11 calibration-lite) =====

describe('deriveAttentionBaseline', () => {
  const poseFrame = (yaw: number, pitch: number, roll = 0) => ({
    faceCountClass: 'one' as const,
    visibility: 'ok' as const,
    headPose: { yaw, pitch, roll },
  });

  test('median nominal pose over the agreed frames', () => {
    const baseline = deriveAttentionBaseline([
      poseFrame(4, -2), poseFrame(-8, 3), poseFrame(10, -5), poseFrame(2, 1),
    ]);
    // yaw median of [-8, 2, 4, 10] = 3; pitch median of [-5, -2, 1, 3] = -0.5
    expect(baseline).toEqual({ yaw: 3, pitch: -0.5, roll: 0, frames: 4 });
  });

  test('null when fewer than minFrames agreed frames carried a usable pose', () => {
    expect(deriveAttentionBaseline([poseFrame(1, 1), poseFrame(2, 2)], 3)).toBeNull();
    expect(deriveAttentionBaseline([], 3)).toBeNull();
  });

  test('frames without pose are ignored, not fatal', () => {
    const baseline = deriveAttentionBaseline([
      poseFrame(5, 0), { faceCountClass: 'one', visibility: 'ok', headPose: null },
      poseFrame(7, 0), poseFrame(9, 0),
    ]);
    expect(baseline).toEqual({ yaw: 7, pitch: 0, roll: 0, frames: 3 });
  });

  test('rounds to 0.1° (server-side storage precision parity)', () => {
    const baseline = deriveAttentionBaseline([
      poseFrame(1.234, -2.345), poseFrame(1.222, -2.333), poseFrame(1.238, -2.351),
    ]);
    expect(baseline!.yaw).toBe(1.2);
    expect(baseline!.pitch).toBe(-2.3);
  });
});

describe('aggregateFaceFrames — Phase 5 baseline attachment', () => {
  test('a PASS carries the derived baseline in the face_readiness metadata', () => {
    const result = aggregateFaceFrames([
      { faceCountClass: 'one', visibility: 'ok', headPose: { yaw: 5, pitch: -3, roll: 1 } },
      { faceCountClass: 'one', visibility: 'ok', headPose: { yaw: 7, pitch: -3, roll: 1 } },
      { faceCountClass: 'one', visibility: 'ok', headPose: { yaw: 9, pitch: -3, roll: 1 } },
    ]);
    expect(result.status).toBe('PASS');
    expect(result.metadata!.attentionBaseline).toEqual({ yaw: 7, pitch: -3, roll: 1, frames: 3 });
  });

  test('a PASS without usable poses omits the baseline (fallback path)', () => {
    const result = aggregateFaceFrames([
      frame('one', 'ok'), frame('one', 'ok'), frame('one', 'ok'),
    ]);
    expect(result.status).toBe('PASS');
    expect(result.metadata!.attentionBaseline).toBeUndefined();
  });
});
