// Risk scoring unit tests (plan §19 — Phase 6 acceptance §29.1): weight
// arithmetic, caps, explainability (breakdown sums EXACTLY to the score),
// attention contributes 0 (D6), determinism, category bands.

const {
  computeRiskScore,
  categorizeRisk,
  buildEventTypeAggregatePipeline,
  CAMERA_SUSTAINED_LOSS_MS,
} = require('../../../utils/proctoring/riskScore');
const { DEFAULT_RISK_WEIGHTS } = require('../../../utils/proctoring/defaults');

const agg = (type, durations) => ({
  _id: type,
  count: durations.length,
  durationsMs: durations,
});

const defaultPolicy = () => ({
  focusEvents: { prolongedAbsenceMs: 60000 },
});

describe('riskScore.computeRiskScore — weight arithmetic', () => {
  test('empty session scores 0 / normal', () => {
    const result = computeRiskScore({ policy: defaultPolicy(), typeAggregates: [], violations: [] });
    expect(result.riskScore).toBe(0);
    expect(result.riskCategory).toBe('normal');
  });

  test('multiple faces: 50 per event, max 2 scored', () => {
    const result = computeRiskScore({
      policy: defaultPolicy(),
      // Durations above the prompt-recovery window isolate this arithmetic.
      typeAggregates: [agg('MULTIPLE_FACES_DETECTED', [16000, 17000, 18000])],
      violations: [],
    });
    // 2 scored × 50 = 100 despite 3 events.
    expect(result.riskScore).toBe(100);
  });

  test('focus-loss violations: 30 per violation, max 3 scored', () => {
    const violations = Array.from({ length: 5 }, () => ({ ruleId: 'focus.loss' }));
    const result = computeRiskScore({
      policy: defaultPolicy(), typeAggregates: [], violations,
    });
    expect(result.riskScore).toBe(90);
  });

  test('prolonged focus absence counts only episodes at/above the frozen threshold', () => {
    const result = computeRiskScore({
      policy: { focusEvents: { prolongedAbsenceMs: 60000 } },
      typeAggregates: [agg('APP_BACKGROUND', [59000, 60000, 120000])],
      violations: [],
    });
    // 2 qualifying episodes × 15 = 30 (also 2 × 30 focus violations? No —
    // violations come from the violation set, not the durations).
    expect(result.riskScore).toBe(30);
  });

  test('face missing is scored per started 30s of accumulated absence, capped at 75', () => {
    const result = computeRiskScore({
      policy: defaultPolicy(),
      typeAggregates: [agg('FACE_NOT_DETECTED', [20000, 25000, 50000])],
      violations: [],
    });
    // 95s total → 3 started blocks × 25 = 75 (cap reached).
    expect(result.riskScore).toBe(75);

    const huge = computeRiskScore({
      policy: defaultPolicy(),
      typeAggregates: [agg('FACE_NOT_DETECTED', [300000])],
      violations: [],
    });
    expect(huge.riskScore).toBe(75); // 10 blocks × 25 = 250 → capped at 75.
  });

  test('camera permission revoked scores once regardless of episode count', () => {
    const result = computeRiskScore({
      policy: defaultPolicy(),
      typeAggregates: [agg('CAMERA_PERMISSION_REVOKED', [0, 0, 0])],
      violations: [],
    });
    expect(result.riskScore).toBe(50);
  });
});

describe('riskScore.computeRiskScore — D6: attention always contributes 0', () => {
  test('attention events add a visible ZERO contribution and never change the score', () => {
    const without = computeRiskScore({
      policy: defaultPolicy(),
      typeAggregates: [agg('APP_BACKGROUND', [15000])],
      violations: [{ ruleId: 'focus.loss' }],
    });
    const withAttention = computeRiskScore({
      policy: defaultPolicy(),
      typeAggregates: [
        agg('APP_BACKGROUND', [15000]),
        agg('ATTENTION_DEVIATION_SUSTAINED', [6000, 7000, 8000]),
        agg('HEAD_POSE_EXTREME', [9000]),
      ],
      violations: [{ ruleId: 'focus.loss' }],
    });
    expect(withAttention.riskScore).toBe(without.riskScore);
    const attentionRow = withAttention.riskBreakdown.find((r) => r.input === 'attentionEvent');
    expect(attentionRow).toBeDefined();
    expect(attentionRow.contribution).toBe(0);
  });
});

describe('riskScore.computeRiskScore — explainability (§19.3)', () => {
  test('breakdown contributions sum EXACTLY to the score for a mixed session', () => {
    const result = computeRiskScore({
      policy: defaultPolicy(),
      typeAggregates: [
        agg('APP_BACKGROUND', [15000, 70000]),
        agg('MULTIPLE_FACES_DETECTED', [4000, 5000, 6000]),
        agg('FACE_NOT_DETECTED', [45000]),
        agg('CAMERA_PERMISSION_REVOKED', [0]),
        agg('CAMERA_FEED_DARK', [70000, 5000]),
        agg('HEARTBEAT_GAP', [120000, 130000]),
      ],
      violations: [
        { ruleId: 'focus.loss' },
        { ruleId: 'focus.loss' },
        { ruleId: 'multipleFaces.sustained' },
      ],
    });
    const sum = result.riskBreakdown.reduce((acc, row) => acc + row.contribution, 0);
    expect(result.riskScore).toBe(Math.max(0, sum));
    expect(sum).toBeGreaterThan(0);
    // Every row carries its points and a count.
    for (const row of result.riskBreakdown) {
      expect(typeof row.points).toBe('number');
      expect(typeof row.contribution).toBe('number');
    }
  });

  test('prompt recovery credit is negative and capped at -20', () => {
    const result = computeRiskScore({
      policy: defaultPolicy(),
      typeAggregates: [
        agg('FACE_NOT_DETECTED', [5000, 6000, 7000, 8000, 9000, 10000, 12000]),
      ],
      violations: [],
    });
    const recovery = result.riskBreakdown.find((r) => r.input === 'promptRecovery');
    expect(recovery.contribution).toBeGreaterThanOrEqual(DEFAULT_RISK_WEIGHTS.promptRecovery.maxTotal);
    expect(recovery.contribution).toBe(-20);
  });

  test('score never goes below 0', () => {
    const result = computeRiskScore({
      policy: defaultPolicy(),
      typeAggregates: [agg('FACE_NOT_DETECTED', [3000])],
      violations: [],
    });
    expect(result.riskScore).toBe(0);
  });
});

describe('riskScore.computeRiskScore — determinism + camera sustained threshold', () => {
  test('identical inputs produce identical outputs', () => {
    const input = {
      policy: defaultPolicy(),
      typeAggregates: [agg('CAMERA_FEED_FROZEN', [CAMERA_SUSTAINED_LOSS_MS, 10000])],
      violations: [{ ruleId: 'camera.permissionRevoked' }],
    };
    expect(computeRiskScore(input)).toEqual(computeRiskScore(input));
  });

  test('camera sustained loss counts only episodes ≥ 60s', () => {
    const result = computeRiskScore({
      policy: defaultPolicy(),
      typeAggregates: [agg('CAMERA_FEED_FROZEN', [59999, 60000])],
      violations: [],
    });
    const row = result.riskBreakdown.find((r) => r.input === 'cameraSustainedLoss');
    expect(row.events).toBe(1);
    expect(row.contribution).toBe(40);
  });
});

describe('riskScore.categorizeRisk — advisory bands (§19.4)', () => {
  test.each([
    [0, 'normal'], [20, 'normal'], [21, 'low'], [40, 'low'],
    [41, 'moderate'], [60, 'moderate'], [61, 'high'], [80, 'high'],
    [81, 'critical'], [500, 'critical'],
  ])('%p → %p', (score, category) => {
    expect(categorizeRisk(score)).toBe(category);
  });

  test('negative inputs clamp to normal', () => {
    expect(categorizeRisk(-10)).toBe('normal');
  });
});

describe('riskScore.buildEventTypeAggregatePipeline', () => {
  test('matches by session and groups durations by type', () => {
    const pipeline = buildEventTypeAggregatePipeline('sess');
    expect(pipeline[0]).toEqual({ $match: { session: 'sess' } });
    expect(pipeline[1].$group._id).toBe('$type');
    expect(pipeline[1].$group.durationsMs).toEqual({ $push: '$durationMs' });
  });
});
