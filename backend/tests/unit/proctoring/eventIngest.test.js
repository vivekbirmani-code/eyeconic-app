// Unit tests for the Phase 3 event-ingest helpers (plan §17, §24, §27.2):
// batch envelope validation, server-owned record shaping and the flood
// outcome. Pure module — no DB.

const {
  EVENT_BATCH_MAX_EVENTS,
  EVENT_FLOOD_SESSION_CAP,
  parseEventBatchEnvelope,
  buildEventRecord,
  computeFloodOutcome,
} = require('../../../utils/proctoring/eventIngest');
const { PROVISIONAL_EVENT_SEVERITIES } = require('../../../utils/proctoring/defaults');

const validEvent = (overrides = {}) => ({
  type: 'FACE_NOT_DETECTED',
  source: 'cv',
  openedAt: 1700000000000,
  closedAt: 1700000009000,
  confidence: 0.91,
  idempotencyKey: 'key-1',
  clientSeq: 0,
  metadata: { basis: 'detection_health' },
  ...overrides,
});

describe('parseEventBatchEnvelope (plan §27.2)', () => {
  it('accepts a well-formed batch', () => {
    const result = parseEventBatchEnvelope({
      sessionId: '507f1f77bcf86cd799439011',
      seq: 3,
      heartbeat: true,
      bufferOverflow: 0,
      events: [
        validEvent(),
        validEvent({ idempotencyKey: 'key-2', clientSeq: 3 }),
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.value.heartbeat).toBe(true);
    expect(result.value.events).toHaveLength(2);
  });

  it('accepts a heartbeat-only batch (empty events + heartbeat flag)', () => {
    const result = parseEventBatchEnvelope({ heartbeat: true, events: [] });
    expect(result.valid).toBe(true);
    expect(result.value.events).toHaveLength(0);
  });

  it('rejects an empty batch without the heartbeat flag', () => {
    const result = parseEventBatchEnvelope({ events: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/heartbeat/);
  });

  it('rejects a missing/non-array events field', () => {
    expect(parseEventBatchEnvelope({}).valid).toBe(false);
    expect(parseEventBatchEnvelope({ events: 'nope' }).valid).toBe(false);
  });

  it('rejects a batch over the size bound', () => {
    const events = Array.from({ length: EVENT_BATCH_MAX_EVENTS + 1 }, (_, i) =>
      validEvent({ idempotencyKey: `k${i}`, clientSeq: i })
    );
    const result = parseEventBatchEnvelope({ events });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/batch bound/);
  });

  it('rejects a non-hexadecimal sessionId', () => {
    const result = parseEventBatchEnvelope({ sessionId: "Robert'); DROP TABLE", events: [validEvent()] });
    expect(result.valid).toBe(false);
  });

  it('rejects a negative/fractional seq and a non-integer bufferOverflow', () => {
    expect(parseEventBatchEnvelope({ seq: -1, events: [validEvent({ clientSeq: -1 })] }).valid).toBe(false);
    expect(parseEventBatchEnvelope({ seq: 1.5, events: [validEvent()] }).valid).toBe(false);
    expect(parseEventBatchEnvelope({ bufferOverflow: -3, events: [validEvent()] }).valid).toBe(false);
    expect(parseEventBatchEnvelope({ bufferOverflow: 'many', events: [validEvent()] }).valid).toBe(false);
  });

  it('rejects an envelope whose seq disagrees with the last event clientSeq', () => {
    const result = parseEventBatchEnvelope({
      seq: 7,
      events: [validEvent({ clientSeq: 0 }), validEvent({ idempotencyKey: 'k2', clientSeq: 1 })],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/seq must match/);
  });
});

describe('buildEventRecord — server-owned field shaping (plan §17.3, §24.1)', () => {
  const session = { _id: 'sess1' };
  const attempt = { _id: 'att1', quiz: 'quiz1' };
  const now = new Date('2026-09-15T10:00:00Z');

  it('computes durationMs, serverAt, category, severity and detectorTier for a CV episode', () => {
    const record = buildEventRecord(validEvent(), { type: 'FACE_NOT_DETECTED', session, attempt, quizId: 'quiz1', now });
    expect(record).toMatchObject({
      session: 'sess1',
      attempt: 'att1',
      quiz: 'quiz1',
      category: 'cv_observation',
      type: 'FACE_NOT_DETECTED',
      source: 'cv',
      detectorTier: 'headpose',
      confidence: 0.91,
      durationMs: 9000,
      severity: PROVISIONAL_EVENT_SEVERITIES.FACE_NOT_DETECTED,
      serverAt: now,
    });
  });

  it('defaults closedAt to openedAt for point events (SESSION_STARTED)', () => {
    const record = buildEventRecord(
      { type: 'SESSION_STARTED', source: 'system', openedAt: 1700000000000, idempotencyKey: 'k', clientSeq: 0 },
      { type: 'SESSION_STARTED', session, attempt, quizId: 'quiz1', now }
    );
    expect(record.durationMs).toBe(0);
    expect(record.closedAt.getTime()).toBe(record.openedAt.getTime());
    expect(record.category).toBe('technical');
    expect(record.confidence).toBeUndefined();
    expect(record.detectorTier).toBeUndefined();
  });

  it('never derives ownership from the payload — context only', () => {
    const forged = validEvent({ session: 'evil', attempt: 'evil', quiz: 'evil', severity: 'major' });
    const record = buildEventRecord(forged, { type: 'FACE_NOT_DETECTED', session, attempt, quizId: 'quiz1', now });
    expect(record.session).toBe('sess1');
    expect(record.attempt).toBe('att1');
    expect(record.quiz).toBe('quiz1');
    expect(record.severity).toBe(PROVISIONAL_EVENT_SEVERITIES.FACE_NOT_DETECTED);
  });

  it('respects an iris detector tier claim but nothing else', () => {
    const record = buildEventRecord(
      validEvent({ detectorTier: 'iris' }),
      { type: 'FACE_NOT_DETECTED', session, attempt, quizId: 'quiz1', now }
    );
    expect(record.detectorTier).toBe('iris');
  });
});

describe('computeFloodOutcome (plan §18.6/§24.5)', () => {
  it('flags exactly at the cap, never before', () => {
    expect(computeFloodOutcome(EVENT_FLOOD_SESSION_CAP - 1, 0).floodFlagged).toBe(false);
    expect(computeFloodOutcome(EVENT_FLOOD_SESSION_CAP - 5, 5).floodFlagged).toBe(true);
    expect(computeFloodOutcome(0, EVENT_FLOOD_SESSION_CAP).floodFlagged).toBe(true);
    expect(computeFloodOutcome(10, 20).floodFlagged).toBe(false);
  });
});
