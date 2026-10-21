/**
 * Monitoring Summary display helpers (utils/proctoringSummaryFormat.ts) —
 * pure logic only: duration humanizing, category bucketing, stat-chip
 * aggregation and detail-row shaping. Component rendering is verified on
 * device (no RN renderer exists in this harness).
 */

import {
  eventCategory,
  humanizeDuration,
  buildStatChips,
  buildDetailRows,
  eventLabelFor,
} from '../proctoringSummaryFormat';

describe('humanizeDuration', () => {
  test.each([
    [undefined, null],
    [null, null],
    [0, null],
    [999, null],
    [NaN, null],
    [1000, '1s'],
    [44_500, '45s'], // Math.round — 44.5s rounds up
    [59_400, '59s'],
    [59_999, '1m'], // rounds to 60s → the minutes branch
    [60_000, '1m'],
    [139_000, '2m 19s'],
    [780_000, '13m'],
    [3_661_000, '1h 1m'],
    [7_200_000, '2h 0m'],
  ])('%p -> %p', (input, expected) => {
    expect(humanizeDuration(input as number | null | undefined)).toBe(expected);
  });
});

describe('eventCategory', () => {
  test('warnings (the only row-tinted category)', () => {
    expect(eventCategory('WARNING_DELIVERED')).toBe('warning');
    expect(eventCategory('AUTO_SUBMITTED')).toBe('warning');
  });

  test('attention observations', () => {
    for (const type of [
      'HEAD_POSE_TURNED', 'HEAD_POSE_EXTREME', 'HEAD_POSE_REPEATED',
      'ATTENTION_DEVIATION_SUSTAINED', 'ATTENTION_DEVIATION_REPEATED',
    ]) {
      expect(eventCategory(type)).toBe('attention');
    }
  });

  test('everything else — integrity, camera, connectivity, unknown types', () => {
    for (const type of [
      'APP_BACKGROUND', 'EXIT_ATTEMPTED', 'FACE_NOT_DETECTED',
      'CAMERA_FEED_DARK', 'HEARTBEAT_GAP', 'SESSION_DEGRADED',
      'SOME_FUTURE_TYPE',
    ]) {
      expect(eventCategory(type)).toBe('other');
    }
  });
});

describe('buildStatChips', () => {
  test('empty counts -> no chips (clean session)', () => {
    expect(buildStatChips({})).toEqual([]);
    expect(buildStatChips({ APP_BACKGROUND: 0, HEAD_POSE_TURNED: 0 })).toEqual([]);
  });

  test('suppresses zeros, keeps stable order, aggregates camera bucket', () => {
    const chips = buildStatChips({
      APP_BACKGROUND: 3,
      HEAD_POSE_TURNED: 6,
      CAMERA_FEED_DARK: 2,
      MODEL_UNAVAILABLE: 1,
      HEARTBEAT_GAP: 1,
      FACE_NOT_DETECTED: 0,
    });
    expect(chips).toEqual([
      { key: 'leftApp', count: 3 },
      { key: 'headTurns', count: 6 },
      { key: 'cameraIssues', count: 3 },
      { key: 'connectionGaps', count: 1 },
    ]);
  });

  test('head-turn occurrences stay separate from aggregate attention notes (no double counting)', () => {
    const chips = buildStatChips({
      HEAD_POSE_TURNED: 5,
      HEAD_POSE_REPEATED: 1,
      ATTENTION_DEVIATION_SUSTAINED: 1,
    });
    expect(chips).toEqual([
      { key: 'headTurns', count: 5 },
      { key: 'attentionNotes', count: 2 },
    ]);
  });

  test('every chip key has copy (chip labels can never render undefined)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PROCTORING_COPY } = require('../proctoringCopy');
    const chips = buildStatChips({
      APP_BACKGROUND: 1, FACE_NOT_DETECTED: 1, MULTIPLE_FACES_DETECTED: 1,
      HEAD_POSE_TURNED: 1, CAMERA_UNAVAILABLE: 1, HEAD_POSE_REPEATED: 1,
      HEARTBEAT_GAP: 1,
    });
    for (const chip of chips) {
      expect(typeof PROCTORING_COPY.studentSummary.chipLabels[chip.key]).toBe('string');
    }
    expect(chips).toHaveLength(7);
  });
});

describe('buildDetailRows', () => {
  const baseEvent = (overrides: Record<string, unknown>) => ({
    _id: `id-${Math.random().toString(36).slice(2, 8)}`,
    type: 'APP_BACKGROUND',
    serverAt: '2026-10-21T14:00:00.000Z',
    ...overrides,
  });

  test('hides session bookkeeping types', () => {
    const rows = buildDetailRows([
      baseEvent({ type: 'SESSION_STARTED' }),
      baseEvent({ type: 'SESSION_RESUMED' }),
      baseEvent({ type: 'SESSION_CLOSED' }),
      baseEvent({ type: 'APP_BACKGROUND' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('APP_BACKGROUND');
  });

  test('resolves labels from the copy module with an honest fallback', () => {
    const rows = buildDetailRows([
      baseEvent({ type: 'HEAD_POSE_TURNED' }),
      baseEvent({ type: 'SOME_FUTURE_TYPE' }),
    ]);
    expect(rows[0].label).toBe('Turned head away from the screen');
    expect(rows[1].label).toBe('Some future type');
  });

  test('WARNING_DELIVERED rows say WHICH warning (metadata.code), with a generic fallback', () => {
    const rows = buildDetailRows([
      baseEvent({ type: 'WARNING_DELIVERED', metadata: { code: 'warn.headTurn' } }),
      baseEvent({ type: 'WARNING_DELIVERED', metadata: { code: 'warn.final' } }),
      baseEvent({ type: 'WARNING_DELIVERED' }),
      baseEvent({ type: 'WARNING_DELIVERED', metadata: { code: 'warn.unknown-future' } }),
    ]);
    expect(rows[0].label).toBe('Heads-up: focus on the screen');
    expect(rows[0].category).toBe('warning');
    expect(rows[1].label).toBe('Final warning');
    expect(rows[2].label).toBe('Heads-up shown during the test');
    expect(rows[3].label).toBe('Heads-up shown during the test');
  });

  test('carries duration and category through untouched (display decides chips)', () => {
    const rows = buildDetailRows([baseEvent({ type: 'HEAD_POSE_TURNED', durationMs: 3200 })]);
    expect(rows[0].durationMs).toBe(3200);
    expect(rows[0].category).toBe('attention');
  });
});

describe('eventLabelFor', () => {
  test('copy-first, prettified-code fallback, never a raw code with underscores', () => {
    expect(eventLabelFor('FACE_PARTIALLY_VISIBLE')).toBe('Face partly visible');
    expect(eventLabelFor('NEW_KIND_OF_EVENT')).toBe('New kind of event');
  });
});
