// Unit tests for the Phase 4 session-health helpers (plan §16, §7.4):
// heartbeat-gap computation (startup grace, temporary-gap line, timeout
// crossing, deterministic idempotency key), the server-generated gap event
// record shape, and the DEGRADED→ACTIVE transition pair.

const {
  computeHeartbeatGap,
  buildGapEventRecord,
  buildGapTransitions,
  DEFAULT_TIMEOUT_MS,
} = require('../../../utils/proctoring/sessionHealth');

const MINUTE = 60 * 1000;

describe('computeHeartbeatGap (§16.2/§16.3)', () => {
  const now = new Date('2026-09-16T10:05:00Z');

  it('returns null when lastSeenAt is missing — the startup grace', () => {
    // A crash right after /start leaves no lastSeenAt: nothing to measure a
    // gap FROM, so no spurious gap can ever be recorded (§16.3).
    expect(computeHeartbeatGap({ lastSeenAt: null, timeoutMs: 90000, now, sessionId: 's1' })).toBeNull();
    expect(computeHeartbeatGap({ lastSeenAt: undefined, timeoutMs: 90000, now, sessionId: 's1' })).toBeNull();
  });

  it('returns null while the contact is within the frozen timeout (temporary transport gap)', () => {
    const lastSeenAt = new Date(now.getTime() - 89_999);
    expect(computeHeartbeatGap({ lastSeenAt, timeoutMs: 90000, now, sessionId: 's1' })).toBeNull();
  });

  it('returns null exactly AT the timeout boundary (gap opens only past it)', () => {
    const lastSeenAt = new Date(now.getTime() - 90_000);
    expect(computeHeartbeatGap({ lastSeenAt, timeoutMs: 90000, now, sessionId: 's1' })).toBeNull();
  });

  it('computes the gap past the timeout with the honest degradation timestamp', () => {
    const lastSeenAt = new Date('2026-09-16T10:00:00Z'); // 5 min before now
    const gap = computeHeartbeatGap({ lastSeenAt, timeoutMs: 90_000, now, sessionId: 's1' });
    expect(gap).not.toBeNull();
    expect(gap.openedAt.getTime()).toBe(lastSeenAt.getTime());
    expect(gap.degradedAt.getTime()).toBe(lastSeenAt.getTime() + 90_000);
    expect(gap.closedAt.getTime()).toBe(now.getTime());
    expect(gap.durationMs).toBe(5 * MINUTE);
    expect(gap.timeoutMs).toBe(90_000);
    // Deterministic key: concurrent batches measuring the same gap converge.
    expect(gap.idempotencyKey).toBe(`hbgap:s1:${lastSeenAt.getTime()}`);
    const again = computeHeartbeatGap({ lastSeenAt, timeoutMs: 90_000, now, sessionId: 's1' });
    expect(again.idempotencyKey).toBe(gap.idempotencyKey);
    // Different sessions never collide on the key.
    const other = computeHeartbeatGap({ lastSeenAt, timeoutMs: 90_000, now, sessionId: 's2' });
    expect(other.idempotencyKey).not.toBe(gap.idempotencyKey);
  });

  it('falls back to the frozen default timeout when none is resolvable', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(90_000);
    const lastSeenAt = new Date(now.getTime() - DEFAULT_TIMEOUT_MS - 1);
    expect(computeHeartbeatGap({ lastSeenAt, timeoutMs: undefined, now, sessionId: 's1' })).not.toBeNull();
    const within = new Date(now.getTime() - DEFAULT_TIMEOUT_MS + 1);
    expect(computeHeartbeatGap({ lastSeenAt: within, timeoutMs: 'garbage', now, sessionId: 's1' })).toBeNull();
  });
});

describe('buildGapEventRecord (server-generated HEARTBEAT_GAP)', () => {
  it('shapes a technical/system episode with server-owned fields only', () => {
    const now = new Date('2026-09-16T10:05:00Z');
    const lastSeenAt = new Date('2026-09-16T10:00:00Z');
    const gap = computeHeartbeatGap({ lastSeenAt, timeoutMs: 90_000, now, sessionId: 'abc123' });
    const session = { _id: 'sess-1' };
    const attempt = { _id: 'att-1' };

    const record = buildGapEventRecord({ gap, session, attempt, quizId: 'quiz-9' });

    expect(record).toMatchObject({
      session: 'sess-1',
      attempt: 'att-1',
      quiz: 'quiz-9',
      category: 'technical',
      type: 'HEARTBEAT_GAP',
      source: 'system',
      severity: 'minor', // provisional severity map (defaults.js)
      durationMs: 5 * MINUTE,
      idempotencyKey: gap.idempotencyKey,
      serverAt: now,
      clientAt: now,
    });
    expect(record.openedAt.getTime()).toBe(lastSeenAt.getTime());
    expect(record.metadata).toEqual({ timeoutMs: 90_000 });
    expect(record.confidence).toBeUndefined(); // deterministic — never a confidence
  });
});

describe('buildGapTransitions (§7.4 DEGRADED→ACTIVE)', () => {
  it('returns the audited pair with reasons and honest timestamps', () => {
    const now = new Date('2026-09-16T10:05:00Z');
    const lastSeenAt = new Date('2026-09-16T10:00:00Z');
    const gap = computeHeartbeatGap({ lastSeenAt, timeoutMs: 90_000, now, sessionId: 's1' });

    const transitions = buildGapTransitions(gap);
    expect(transitions).toHaveLength(2);
    expect(transitions[0]).toEqual({
      from: 'ACTIVE', to: 'DEGRADED', reason: 'heartbeat_timeout',
      at: new Date(lastSeenAt.getTime() + 90_000),
    });
    expect(transitions[1]).toEqual({
      from: 'DEGRADED', to: 'ACTIVE', reason: 'heartbeat_recovered', at: now,
    });
  });
});
