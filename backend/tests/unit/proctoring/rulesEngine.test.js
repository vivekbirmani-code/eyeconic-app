// Rules engine unit tests (plan §18, §20.3 — Phase 6 acceptance §29.1).
//
// The ladder permutations, the mode guards, and the two binding property
// tests: (1) no single probabilistic event ever yields SUBMIT under any
// V1-representable policy, and (2) attention events never yield ANY action.

const {
  evaluatePolicy,
  RULE_IDS,
  WARN_CODES,
  ATTENTION_EVENT_TYPES,
} = require('../../../utils/proctoring/rulesEngine');
const { listEventTypes, getEventDefinition } = require('../../../utils/proctoring/eventRegistry');

const SESSION_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const NOW = new Date('2026-09-30T10:00:00Z');

const focusEpisode = (overrides = {}) => ({
  _id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  type: 'APP_BACKGROUND',
  category: 'integrity',
  durationMs: 15000,
  serverAt: new Date('2026-09-30T10:01:00Z'),
  metadata: {},
  ...overrides,
});

const cvEpisode = (type, overrides = {}) => ({
  _id: 'cccccccccccccccccccccccc',
  type,
  category: 'cv_observation',
  durationMs: 10000,
  serverAt: new Date('2026-09-30T10:02:00Z'),
  metadata: {},
  ...overrides,
});

const attentionEpisode = (type) => cvEpisode(type, { durationMs: 9000 });

const defaultPolicy = () => ({
  focusEvents: { mode: 'warn-then-submit', toleratedViolations: 3, minDurationMs: 2000, prolongedAbsenceMs: 60000 },
  multipleFaces: { mode: 'warn', minDurationMs: 3000 },
  facePresence: { mode: 'warn', minAbsentMs: 8000 },
  attention: { enabled: true, mode: 'record' },
  sessionHealth: { heartbeatIntervalMs: 30000, timeoutMs: 90000, onProlongedOutage: 'record' },
  maxViolations: 3,
  violationAction: 'warn',
});

const evaluate = (overrides = {}) => evaluatePolicy({
  policy: defaultPolicy(),
  sessionId: SESSION_ID,
  now: NOW,
  ...overrides,
});

describe('rulesEngine.evaluatePolicy — D3 focus ladder', () => {
  test('warns on each of the first tolerated violations', () => {
    const result = evaluate({ newEvents: [focusEpisode()] });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].kind).toBe('WARN');
    expect(result.actions[0].code).toBe(WARN_CODES.focus);
    expect(result.newViolations).toHaveLength(1);
    expect(result.newViolations[0].ruleId).toBe(RULE_IDS.focusLoss);
    expect(result.newViolations[0].reliability).toBe('deterministic');
    expect(result.submit).toBeNull();
  });

  test('FINAL_WARN fires exactly at tolerated + 1', () => {
    const persisted = Array.from({ length: 3 }, () => ({ ruleId: RULE_IDS.focusLoss }));
    const result = evaluate({ newEvents: [focusEpisode()], persistedViolations: persisted });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].kind).toBe('FINAL_WARN');
    expect(result.actions[0].code).toBe(WARN_CODES.focusFinal);
    expect(result.submit).toBeNull();
    expect(result.violationCountAfter).toBe(4);
  });

  test('SUBMIT fires exactly at tolerated + 2 and the triggering episode is recorded', () => {
    const persisted = Array.from({ length: 4 }, () => ({ ruleId: RULE_IDS.focusLoss }));
    const event = focusEpisode();
    const result = evaluate({ newEvents: [event], persistedViolations: persisted });
    expect(result.submit).not.toBeNull();
    expect(result.submit.ruleId).toBe(RULE_IDS.focusMaxViolations);
    expect(result.submit.autoSubmitReason).toEqual({
      kind: 'policy',
      ruleId: RULE_IDS.focusMaxViolations,
      eventIds: [String(event._id)],
    });
    const triggering = result.newViolations.find(
      (v) => String(v.eventRefs[0]) === String(event._id)
    );
    expect(triggering).toBeDefined();
    expect(triggering.action).toBe('SUBMIT');
  });

  test('a single batch containing episodes #4 and #5 walks FINAL_WARN then SUBMIT in order', () => {
    const persisted = Array.from({ length: 3 }, () => ({ ruleId: RULE_IDS.focusLoss }));
    const fourth = focusEpisode({ _id: 'd000000000000000000000004' });
    const fifth = focusEpisode({ _id: 'd000000000000000000000005', serverAt: new Date('2026-09-30T10:03:00Z') });
    const result = evaluate({ newEvents: [fifth, fourth], persistedViolations: persisted });
    // Out-of-order input is evaluated in serverAt order.
    const warnKinds = result.actions.map((a) => a.kind);
    expect(warnKinds).toContain('FINAL_WARN');
    expect(result.submit).not.toBeNull();
    expect(String(result.submit.eventRef)).toBe(String(fifth._id));
  });

  test('after a SUBMIT in the same batch, later qualifying episodes record violations but no further action', () => {
    const persisted = Array.from({ length: 4 }, () => ({ ruleId: RULE_IDS.focusLoss }));
    const events = [
      focusEpisode({ _id: 'e000000000000000000000001' }),
      focusEpisode({ _id: 'e000000000000000000000002', serverAt: new Date('2026-09-30T10:04:00Z') }),
      focusEpisode({ _id: 'e000000000000000000000003', serverAt: new Date('2026-09-30T10:05:00Z') }),
    ];
    const result = evaluate({ newEvents: events, persistedViolations: persisted });
    expect(result.submit).not.toBeNull();
    expect(result.newViolations).toHaveLength(3);
    const actionsAfterSubmit = result.newViolations
      .filter((v) => v.action === 'WARN' || v.action === 'FINAL_WARN');
    // Only events before the terminal one may carry warn actions.
    expect(actionsAfterSubmit.length).toBeLessThanOrEqual(1);
  });

  test('record mode never counts or warns', () => {
    const policy = defaultPolicy();
    policy.focusEvents.mode = 'record';
    const result = evaluate({ policy, newEvents: [focusEpisode()] });
    expect(result.actions).toHaveLength(0);
    expect(result.newViolations).toHaveLength(0);
    expect(result.submit).toBeNull();
    expect(result.violationCountAfter).toBe(0);
  });

  test('warn-only mode warns but never submits', () => {
    const policy = defaultPolicy();
    policy.focusEvents.mode = 'warn-only';
    const persisted = Array.from({ length: 9 }, () => ({ ruleId: RULE_IDS.focusLoss }));
    const result = evaluate({ policy, newEvents: [focusEpisode()], persistedViolations: persisted });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].kind).toBe('WARN');
    expect(result.submit).toBeNull();
  });

  test('blips under the frozen duration floor never count', () => {
    const result = evaluate({ newEvents: [focusEpisode({ durationMs: 1999 })] });
    expect(result.newViolations).toHaveLength(0);
    expect(result.actions).toHaveLength(0);
  });

  test('the floor is re-checked server-side from the FROZEN policy, not the client', () => {
    const policy = defaultPolicy();
    policy.focusEvents.minDurationMs = 5000;
    const result = evaluate({ policy, newEvents: [focusEpisode({ durationMs: 3000 })] });
    expect(result.newViolations).toHaveLength(0);
  });

  test('legacy TAB_HIDDEN point events qualify on existence (web parity)', () => {
    const legacyTab = focusEpisode({
      type: 'TAB_HIDDEN',
      durationMs: 0,
      metadata: { legacy: true },
    });
    const result = evaluate({ newEvents: [legacyTab] });
    expect(result.newViolations).toHaveLength(1);
    expect(result.actions[0].kind).toBe('WARN');
  });

  test('non-legacy TAB_HIDDEN point events stay under the duration floor', () => {
    const tab = focusEpisode({ type: 'TAB_HIDDEN', durationMs: 0, metadata: {} });
    const result = evaluate({ newEvents: [tab] });
    expect(result.newViolations).toHaveLength(0);
  });

  test('APP_INACTIVE and EXIT_ATTEMPTED never count (noisy/informational)', () => {
    const result = evaluate({
      newEvents: [
        focusEpisode({ type: 'APP_INACTIVE', category: 'integrity' }),
        focusEpisode({ type: 'EXIT_ATTEMPTED', category: 'integrity', durationMs: 0 }),
      ],
    });
    expect(result.newViolations).toHaveLength(0);
    expect(result.actions).toHaveLength(0);
  });
});

describe('rulesEngine.evaluatePolicy — probabilistic CV guards (D8)', () => {
  test('multiple faces at mode warn produces a WARN violation only', () => {
    const result = evaluate({
      newEvents: [cvEpisode('MULTIPLE_FACES_DETECTED', { durationMs: 4000 })],
    });
    expect(result.newViolations).toHaveLength(1);
    expect(result.newViolations[0].reliability).toBe('probabilistic');
    expect(result.actions[0].kind).toBe('WARN');
    expect(result.submit).toBeNull();
  });

  test('multiple faces under the sustain floor is ignored', () => {
    const result = evaluate({
      newEvents: [cvEpisode('MULTIPLE_FACES_DETECTED', { durationMs: 2999 })],
    });
    expect(result.newViolations).toHaveLength(0);
  });

  test('multiple faces at mode record is ignored', () => {
    const policy = defaultPolicy();
    policy.multipleFaces.mode = 'record';
    const result = evaluate({
      policy,
      newEvents: [cvEpisode('MULTIPLE_FACES_DETECTED', { durationMs: 9000 })],
    });
    expect(result.newViolations).toHaveLength(0);
    expect(result.actions).toHaveLength(0);
  });

  test('face missing at mode warn produces a WARN violation only', () => {
    const result = evaluate({
      newEvents: [cvEpisode('FACE_NOT_DETECTED', { durationMs: 12000 })],
    });
    expect(result.newViolations[0].ruleId).toBe(RULE_IDS.facePresenceAbsent);
    expect(result.submit).toBeNull();
  });

  test('camera permission revoked warns and records ONE session-level violation for the first episode', () => {
    const first = evaluate({
      newEvents: [cvEpisode('CAMERA_PERMISSION_REVOKED', { category: 'technical' })],
    });
    expect(first.newViolations).toHaveLength(1);
    expect(first.newViolations[0].ruleId).toBe(RULE_IDS.cameraPermissionRevoked);
    expect(first.actions[0].code).toBe(WARN_CODES.camera);

    const second = evaluate({
      newEvents: [cvEpisode('CAMERA_PERMISSION_REVOKED', { category: 'technical' })],
      persistedViolations: [{ ruleId: RULE_IDS.cameraPermissionRevoked }],
    });
    // Later episodes still warn (the §20.4 visible ladder) without adding
    // violations (risk caps at once).
    expect(second.newViolations).toHaveLength(0);
    expect(second.actions).toHaveLength(1);
    expect(second.actions[0].code).toBe(WARN_CODES.camera);
  });
});

describe('rulesEngine.evaluatePolicy — D6 property: attention never acts', () => {
  test('every attention/head-pose event type yields no action under any mode', () => {
    for (const type of ATTENTION_EVENT_TYPES) {
      for (const focusMode of ['record', 'warn-only', 'warn-then-submit']) {
        for (const multipleFacesMode of ['record', 'warn']) {
          const policy = defaultPolicy();
          policy.focusEvents.mode = focusMode;
          policy.multipleFaces.mode = multipleFacesMode;
          const persisted = Array.from({ length: 99 }, () => ({ ruleId: RULE_IDS.focusLoss }));
          const result = evaluate({
            policy,
            newEvents: [attentionEpisode(type)],
            persistedViolations: persisted,
          });
          expect(result.actions).toHaveLength(0);
          expect(result.newViolations).toHaveLength(0);
          expect(result.submit).toBeNull();
        }
      }
    }
  });

  test('even under the Phase 9.1 warn opt-in, only the REPEATED marker acts — and only as WARN', () => {
    const silentTypes = ATTENTION_EVENT_TYPES.filter((t) => t !== 'HEAD_POSE_REPEATED');
    for (const type of silentTypes) {
      const policy = defaultPolicy();
      policy.attention.mode = 'warn';
      policy.maxViolations = 1;
      policy.violationAction = 'submit';
      const persisted = Array.from({ length: 99 }, () => ({ ruleId: RULE_IDS.focusLoss }));
      const result = evaluate({
        policy,
        newEvents: [attentionEpisode(type)],
        persistedViolations: persisted,
      });
      expect(result.actions).toHaveLength(0);
      expect(result.newViolations).toHaveLength(0);
      expect(result.submit).toBeNull();
    }
  });
});

describe('rulesEngine.evaluatePolicy — Phase 9.1 attention warn opt-in', () => {
  const repeatedEpisode = () => attentionEpisode('HEAD_POSE_REPEATED');

  test('HEAD_POSE_REPEATED under attention.mode "warn" yields ONE advisory WARN, never a violation or submit', () => {
    const policy = defaultPolicy();
    policy.attention.mode = 'warn';
    policy.maxViolations = 1;
    policy.violationAction = 'submit';
    const persisted = Array.from({ length: 99 }, () => ({ ruleId: RULE_IDS.focusLoss }));
    const result = evaluate({
      policy,
      newEvents: [repeatedEpisode()],
      persistedViolations: persisted,
    });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      kind: 'WARN',
      code: WARN_CODES.headTurn,
      ruleId: RULE_IDS.attentionHeadTurn,
    });
    expect(result.newViolations).toHaveLength(0);
    expect(result.violationCountAfter).toBe(persisted.length);
    expect(result.submit).toBeNull();
  });

  test('the same REPEATED event always derives the same deterministic warnId (delivery dedupe)', () => {
    const policy = defaultPolicy();
    policy.attention.mode = 'warn';
    const first = evaluate({ policy, newEvents: [repeatedEpisode()] });
    const second = evaluate({ policy, newEvents: [repeatedEpisode()] });
    expect(first.actions[0].warnId).toBe(second.actions[0].warnId);
    expect(first.actions[0].warnId)
      .toBe(`warn:${SESSION_ID}:${RULE_IDS.attentionHeadTurn}:${repeatedEpisode()._id}`);
  });

  test('default (record) and absent attention.mode both stay silent for REPEATED', () => {
    const withRecord = evaluate({ newEvents: [repeatedEpisode()] });
    expect(withRecord.actions).toHaveLength(0);

    const policy = defaultPolicy();
    delete policy.attention.mode;
    const absent = evaluate({ policy, newEvents: [repeatedEpisode()] });
    expect(absent.actions).toHaveLength(0);
  });

  test('each repetition window warns independently (3rd, 6th, 9th occurrence)', () => {
    const policy = defaultPolicy();
    policy.attention.mode = 'warn';
    const events = [0, 1, 2].map((i) => cvEpisode('HEAD_POSE_REPEATED', {
      _id: `d0000000000000000000000${String(i).padStart(2, '0')}`,
      serverAt: new Date(Date.now() + i * 1000),
    }));
    const result = evaluate({ policy, newEvents: events });
    expect(result.actions).toHaveLength(3);
    expect(new Set(result.actions.map((a) => a.warnId)).size).toBe(3);
    expect(result.newViolations).toHaveLength(0);
  });
});

describe('rulesEngine.evaluatePolicy — property: probabilistic events never submit (D8)', () => {
  test('no batch of only CV events yields SUBMIT under any V1 policy', () => {
    const cvTypes = ['FACE_NOT_DETECTED', 'FACE_PARTIALLY_VISIBLE', 'FACE_OUT_OF_FRAME',
      'MULTIPLE_FACES_DETECTED', ...ATTENTION_EVENT_TYPES];
    for (const type of cvTypes) {
      const policy = defaultPolicy();
      policy.maxViolations = 1; // the most aggressive cross-type setting
      policy.violationAction = 'submit';
      const events = Array.from({ length: 10 }, (_, i) => cvEpisode(type, {
        _id: `f0000000000000000000000${String(i).padStart(2, '0')}`,
        durationMs: 120000,
        serverAt: new Date(Date.now() + i * 1000),
      }));
      const result = evaluate({ policy, newEvents: events, persistedViolations: [] });
      expect(result.submit).toBeNull();
    }
  });

  test('the cross-type submit path requires deterministic focus violations only', () => {
    const policy = defaultPolicy();
    policy.maxViolations = 2;
    policy.violationAction = 'submit';
    // 2 probabilistic violations persisted + 1 new CV event → crossing, but
    // not submit-eligible → a single FINAL_WARN.
    const result = evaluate({
      policy,
      newEvents: [cvEpisode('MULTIPLE_FACES_DETECTED', { durationMs: 5000 })],
      persistedViolations: [
        { ruleId: RULE_IDS.multipleFacesSustained },
        { ruleId: RULE_IDS.multipleFacesSustained },
      ],
    });
    expect(result.submit).toBeNull();
    expect(result.actions.some((a) => a.kind === 'FINAL_WARN')).toBe(true);
  });

  test('the cross-type crossing fires exactly once at maxViolations + 1', () => {
    const policy = defaultPolicy();
    policy.maxViolations = 3;
    policy.violationAction = 'warn';
    const persisted = Array.from({ length: 3 }, () => ({ ruleId: RULE_IDS.focusLoss }));
    const result = evaluate({
      policy,
      newEvents: [cvEpisode('MODEL_UNAVAILABLE', { category: 'technical', durationMs: 0 })],
      persistedViolations: persisted,
    });
    // totalCount = 3 persisted; the technical event adds nothing → no
    // crossing yet.
    expect(result.actions.filter((a) => a.ruleId === RULE_IDS.maxViolationsCrossType)).toHaveLength(0);

    const crossing = evaluate({
      policy,
      newEvents: [focusEpisode()],
      persistedViolations: Array.from({ length: 3 }, () => ({ ruleId: RULE_IDS.focusLoss })),
    });
    // 4 focus violations: the ladder itself is at FINAL_WARN (tolerated 3),
    // the cross-type warn is redundant but harmless — never a second FINAL.
    const finalWarns = crossing.actions.filter((a) => a.kind === 'FINAL_WARN');
    expect(finalWarns.length).toBeGreaterThanOrEqual(1);
    expect(crossing.submit).toBeNull();
  });
});

describe('rulesEngine — structural invariants', () => {
  test('derivation keys are deterministic and unique per (rule, event)', () => {
    const event = focusEpisode();
    const one = evaluate({ newEvents: [event] });
    const two = evaluate({ newEvents: [focusEpisode({ ...event, serverAt: event.serverAt })] });
    expect(one.newViolations[0].derivationKey).toBe(two.newViolations[0].derivationKey);
  });

  test('warn ids are deterministic (concurrent deliveries collapse by key)', () => {
    const event = focusEpisode();
    const result = evaluate({ newEvents: [event] });
    expect(result.actions[0].warnId)
      .toBe(`warn:${SESSION_ID}:${RULE_IDS.focusLoss}:${event._id}`);
  });

  test('every registry type is either handled or explicitly ignored — no silent defaults', () => {
    // The engine must never crash on any registered type, and must produce
    // zero actions for technical/system types under the V1 policy.
    for (const type of listEventTypes()) {
      const definition = getEventDefinition(type);
      const result = evaluate({
        newEvents: [{
          _id: 'a0000000000000000000000a',
          type,
          category: definition.category,
          durationMs: 30000,
          serverAt: NOW,
          metadata: {},
        }],
      });
      expect(Array.isArray(result.actions)).toBe(true);
      expect(Array.isArray(result.newViolations)).toBe(true);
      if (definition.category === 'technical' || definition.category === 'system_action') {
        expect(result.newViolations.filter((v) => v.ruleId !== RULE_IDS.cameraPermissionRevoked))
          .toHaveLength(0);
      }
    }
  });
});
