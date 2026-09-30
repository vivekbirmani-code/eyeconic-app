// Session summary unit tests (plan §25.2 — Phase 6): the pure rollup —
// counts by type/category, violations by rule, "rows == summary" discipline.

const { buildSessionSummary } = require('../../../utils/proctoring/summary');

const session = {
  _id: 's',
  startedAt: new Date('2026-09-30T10:00:00Z'),
  endedAt: new Date('2026-09-30T11:00:00Z'),
  status: 'CLOSED',
};

const events = [
  { type: 'SESSION_STARTED', category: 'technical' },
  { type: 'APP_BACKGROUND', category: 'integrity' },
  { type: 'APP_BACKGROUND', category: 'integrity' },
  { type: 'MULTIPLE_FACES_DETECTED', category: 'cv_observation' },
  { type: 'WARNING_DELIVERED', category: 'system_action' },
  { type: 'AUTO_SUBMITTED', category: 'system_action' },
];

const violations = [
  { ruleId: 'focus.loss' },
  { ruleId: 'focus.loss' },
  { ruleId: 'multipleFaces.sustained' },
];

describe('summary.buildSessionSummary', () => {
  const summary = buildSessionSummary({
    session,
    events,
    violations,
    risk: { riskScore: 75, riskCategory: 'high' },
  });

  test('counts events by type', () => {
    expect(summary.eventCounts).toEqual({
      SESSION_STARTED: 1,
      APP_BACKGROUND: 2,
      MULTIPLE_FACES_DETECTED: 1,
      WARNING_DELIVERED: 1,
      AUTO_SUBMITTED: 1,
    });
    expect(summary.totalEvents).toBe(6);
  });

  test('counts events by category', () => {
    expect(summary.byCategory).toEqual({
      technical: 1,
      integrity: 2,
      cv_observation: 1,
      system_action: 2,
    });
  });

  test('counts violations by rule', () => {
    expect(summary.violationCount).toBe(3);
    expect(summary.violationsByRule).toEqual({
      'focus.loss': 2,
      'multipleFaces.sustained': 1,
    });
  });

  test('carries risk and the review-pending status', () => {
    expect(summary.riskScore).toBe(75);
    expect(summary.riskCategory).toBe('high');
    expect(summary.integrityStatus).toBe('pending');
  });

  test('monitored duration derives from the session interval', () => {
    expect(summary.monitoredMs).toBe(60 * 60 * 1000);
    expect(summary.startedAt).toBe('2026-09-30T10:00:00.000Z');
    expect(summary.endedAt).toBe('2026-09-30T11:00:00.000Z');
  });

  test('an open session (no endedAt) still summarizes with a live duration', () => {
    const live = buildSessionSummary({
      session: { ...session, endedAt: null, status: 'ACTIVE' },
      events: [],
      violations: [],
      risk: { riskScore: 0, riskCategory: 'normal' },
    });
    expect(live.endedAt).toBeNull();
    expect(live.monitoredMs).toBeGreaterThanOrEqual(0);
    expect(live.totalEvents).toBe(0);
  });
});
