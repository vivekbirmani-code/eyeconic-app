// Unit tests for the proctoring event registry + validation foundation
// (plan §17, §24.1, decisions D2/D6): banned-verdict identifiers, no
// fullscreen type, server-owned field stripping, payload plausibility.

const {
  EVENT_CATEGORIES,
  EVENT_SOURCES,
  EVENT_RELIABILITY_CLASSES,
  BANNED_EVENT_IDENTIFIER_PATTERN,
  EVENT_REGISTRY,
  listEventTypes,
  getEventDefinition,
  isKnownEventType,
} = require('../../../utils/proctoring/eventRegistry');
const {
  SERVER_OWNED_FIELDS,
  validateEventPayload,
} = require('../../../utils/proctoring/eventValidation');

describe('event registry invariants', () => {
  const types = listEventTypes();

  it('has a non-empty registry of UPPER_SNAKE types', () => {
    expect(types.length).toBeGreaterThan(20);
    for (const type of types) {
      expect(type).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('gives every type a valid category, reliability class and source list', () => {
    for (const [type, definition] of Object.entries(EVENT_REGISTRY)) {
      expect(EVENT_CATEGORIES).toContain(definition.category);
      expect(EVENT_RELIABILITY_CLASSES).toContain(definition.reliability);
      expect(Array.isArray(definition.sources)).toBe(true);
      expect(definition.sources.length).toBeGreaterThan(0);
      for (const source of definition.sources) {
        expect(EVENT_SOURCES).toContain(source);
      }
    }
  });

  it('contains NO verdict identifiers — signals, never "cheating" (§6.5.1)', () => {
    for (const type of types) {
      expect(BANNED_EVENT_IDENTIFIER_PATTERN.test(type)).toBe(false);
    }
    // Directly prove the ban list catches the obvious ones.
    for (const banned of ['CHEATING', 'CHEATING_DETECTED', 'FRAUD_SUSPECTED', 'IMPERSONATION', 'PLAGIARISM']) {
      expect(BANNED_EVENT_IDENTIFIER_PATTERN.test(banned)).toBe(true);
      expect(isKnownEventType(banned)).toBe(false);
    }
  });

  it('contains NO fullscreen event type (D2 — fullscreen removed from scope)', () => {
    expect(types.filter((type) => /FULLSCREEN/i.test(type))).toEqual([]);
  });

  it('classifies attention/head-pose events as probabilistic cv observations (D6)', () => {
    for (const type of [
      'ATTENTION_DEVIATION_SUSTAINED', 'ATTENTION_DEVIATION_REPEATED',
      'HEAD_POSE_EXTREME', 'HEAD_POSE_REPEATED',
    ]) {
      expect(getEventDefinition(type)).toMatchObject({
        category: 'cv_observation', reliability: 'probabilistic',
      });
    }
  });

  it('classifies focus/integrity events as deterministic (D3 ladder inputs)', () => {
    for (const type of ['TAB_HIDDEN', 'WINDOW_BLUR', 'APP_BACKGROUND', 'EXIT_ATTEMPTED']) {
      expect(getEventDefinition(type)).toMatchObject({
        category: 'integrity', reliability: 'deterministic',
      });
    }
  });

  it('rejects unknown types', () => {
    expect(isKnownEventType('MADE_UP_EVENT')).toBe(false);
    expect(getEventDefinition('MADE_UP_EVENT')).toBeNull();
  });
});

describe('validateEventPayload — happy paths', () => {
  const now = new Date('2026-09-15T10:00:00Z');

  it('accepts a well-formed deterministic integrity episode', () => {
    const result = validateEventPayload({
      type: 'APP_BACKGROUND',
      source: 'os',
      openedAt: '2026-09-15T09:59:50Z',
      closedAt: '2026-09-15T09:59:58Z',
      idempotencyKey: 'evt-1',
      clientSeq: 3,
    }, { now });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.value.type).toBe('APP_BACKGROUND');
    expect(result.value.idempotencyKey).toBe('evt-1');
  });

  it('accepts a probabilistic cv observation carrying confidence', () => {
    const result = validateEventPayload({
      type: 'MULTIPLE_FACES_DETECTED',
      source: 'cv',
      confidence: 0.88,
      openedAt: '2026-09-15T09:59:50Z',
      closedAt: '2026-09-15T09:59:56Z',
      metadata: { peakCount: 2, detectorTier: 'headpose' },
    }, { now });
    expect(result.valid).toBe(true);
    expect(result.value.metadata.detectorTier).toBe('headpose');
  });

  it('accepts a point event (closedAt === openedAt)', () => {
    const result = validateEventPayload({
      type: 'SESSION_STARTED',
      source: 'system',
      openedAt: '2026-09-15T09:58:00Z',
      closedAt: '2026-09-15T09:58:00Z',
    }, { now });
    expect(result.valid).toBe(true);
  });
});

describe('validateEventPayload — rejections', () => {
  const now = new Date('2026-09-15T10:00:00Z');
  const base = { type: 'APP_BACKGROUND', source: 'os', openedAt: '2026-09-15T09:59:50Z', closedAt: '2026-09-15T09:59:58Z' };

  it('rejects non-object payloads', () => {
    expect(validateEventPayload(null, { now }).valid).toBe(false);
    expect(validateEventPayload('event', { now }).valid).toBe(false);
    expect(validateEventPayload([], { now }).valid).toBe(false);
  });

  it('rejects unknown and banned event types', () => {
    expect(validateEventPayload({ ...base, type: 'PHONE_DETECTED' }, { now }).errors[0]).toMatch(/Unknown event type/);
    expect(validateEventPayload({ ...base, type: 'CHEATING_DETECTED' }, { now }).errors[0]).toMatch(/Banned event identifier/);
    expect(validateEventPayload({ ...base, type: '' }, { now }).errors.join()).toMatch(/type is required/);
  });

  it('rejects a source not registered for the type', () => {
    const result = validateEventPayload({ ...base, source: 'browser' }, { now });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not valid for type APP_BACKGROUND/);
  });

  it('requires confidence 0..1 on probabilistic events', () => {
    const cv = { type: 'FACE_NOT_DETECTED', source: 'cv', openedAt: base.openedAt, closedAt: base.closedAt };
    expect(validateEventPayload({ ...cv }, { now }).valid).toBe(false); // missing
    expect(validateEventPayload({ ...cv, confidence: 1.2 }, { now }).valid).toBe(false);
    expect(validateEventPayload({ ...cv, confidence: 'high' }, { now }).valid).toBe(false);
    expect(validateEventPayload({ ...cv, confidence: 0.91 }, { now }).valid).toBe(true);
  });

  it('rejects confidence on deterministic events (facts have no confidence)', () => {
    const result = validateEventPayload({ ...base, confidence: 0.9 }, { now });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/must not carry a confidence/);
  });

  it('rejects malformed or inverted intervals', () => {
    expect(validateEventPayload({ ...base, openedAt: 'garbage' }, { now }).valid).toBe(false);
    expect(validateEventPayload({ ...base, closedAt: '2026-09-15T09:59:40Z' }, { now }).valid).toBe(false); // closed before opened
  });

  it('rejects implausible episodes (over a day long, or starting far in the future)', () => {
    const dayLong = validateEventPayload({
      ...base,
      openedAt: '2026-09-13T10:00:00Z',
      closedAt: '2026-09-15T09:00:00Z',
    }, { now });
    expect(dayLong.valid).toBe(false);

    const future = validateEventPayload({
      ...base,
      openedAt: '2026-09-16T10:00:00Z',
      closedAt: '2026-09-16T10:00:05Z',
    }, { now });
    expect(future.valid).toBe(false);
  });

  it('validates idempotencyKey when required', () => {
    const missing = validateEventPayload({ ...base }, { now, requireIdempotencyKey: true });
    expect(missing.valid).toBe(false);
    expect(missing.errors[0]).toMatch(/idempotencyKey/);

    const ok = validateEventPayload({ ...base, idempotencyKey: 'uuid-1' }, { now, requireIdempotencyKey: true });
    expect(ok.valid).toBe(true);

    const tooLong = validateEventPayload({ ...base, idempotencyKey: 'x'.repeat(129) }, { now, requireIdempotencyKey: true });
    expect(tooLong.valid).toBe(false);
  });

  it('validates clientSeq and metadata shape/size', () => {
    expect(validateEventPayload({ ...base, clientSeq: -1 }, { now }).valid).toBe(false);
    expect(validateEventPayload({ ...base, clientSeq: 1.5 }, { now }).valid).toBe(false);
    expect(validateEventPayload({ ...base, metadata: 'text' }, { now }).valid).toBe(false);
    expect(validateEventPayload({ ...base, metadata: { blob: 'x'.repeat(5 * 1024) } }, { now }).valid).toBe(false);
  });
});

describe('validateEventPayload — server-authority stripping (§24.1)', () => {
  const now = new Date('2026-09-15T10:00:00Z');

  it('strips every server-owned field from an otherwise valid event', () => {
    const result = validateEventPayload({
      type: 'APP_BACKGROUND',
      source: 'os',
      openedAt: '2026-09-15T09:59:50Z',
      closedAt: '2026-09-15T09:59:58Z',
      // Client-side tampering attempts — all stripped, none honored:
      severity: 'major',
      serverAt: '2020-01-01T00:00:00Z',
      riskScore: 0,
      riskBreakdown: { fake: true },
      violationsCount: 0,
      actionTaken: { action: 'CONTINUE', at: '2020-01-01T00:00:00Z' },
      review: { status: 'dismissed' },
      session: '000000000000000000000000',
      attempt: '000000000000000000000000',
      quiz: '000000000000000000000000',
      _id: '000000000000000000000000',
    }, { now });

    expect(result.valid).toBe(true);
    for (const field of SERVER_OWNED_FIELDS) {
      expect(result.strippedFields).toContain(field);
      expect(result.value[field]).toBeUndefined();
    }
    // The client's own claim fields survive untouched.
    expect(result.value.type).toBe('APP_BACKGROUND');
    expect(result.value.openedAt).toBe('2026-09-15T09:59:50Z');
  });

  it('lists server-owned fields even when the payload is otherwise invalid', () => {
    const result = validateEventPayload({ type: 'APP_BACKGROUND', source: 'os', riskScore: 5 }, { now });
    expect(result.valid).toBe(false);
    expect(result.strippedFields).toContain('riskScore');
  });
});
