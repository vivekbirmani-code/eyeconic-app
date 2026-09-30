// Unit tests for utils/proctoring/precheckReport.js (plan §8) — the
// server-side verdict mapping for client precheck observations.

const {
  parsePrecheckReport,
  evaluateDeviceFloor,
  evaluatePrecheckReport,
} = require('../../../utils/proctoring/precheckReport');

const androidDevice = { platform: 'android', osVersion: 33 };
const passingNetwork = { reachable: true, authedPingMs: 120 };

const passCheck = (id, extra = {}) => ({ id, status: 'PASS', ...extra });
const allPassChecks = () => ([
  passCheck('device_capability'),
  passCheck('camera_permission'),
  passCheck('camera_availability'),
  passCheck('face_readiness', {
    metadata: { frames: 5, agreedFrames: 4, faceCountClass: 'one', visibility: 'ok' },
  }),
  passCheck('network'),
]);

const validReport = () => ({
  device: { ...androidDevice },
  network: { ...passingNetwork },
  checks: allPassChecks(),
});

describe('parsePrecheckReport — schema validation (server owns the vocabulary)', () => {
  it('accepts a well-formed all-pass report', () => {
    const result = parsePrecheckReport(validReport());
    expect(result.error).toBeUndefined();
    expect(result.value.device.platform).toBe('android');
    expect(result.value.checks).toHaveLength(5);
  });

  it('accepts optional model and ramMb within sane ranges', () => {
    const result = parsePrecheckReport({
      ...validReport(),
      device: { platform: 'android', osVersion: 33, model: 'Pixel 8', ramMb: 8192 },
    });
    expect(result.error).toBeUndefined();
    expect(result.value.device.ramMb).toBe(8192);
  });

  it.each([
    ['non-object payload', 'not-a-report'],
    ['missing device', { network: passingNetwork, checks: allPassChecks() }],
    ['bad platform enum', { ...validReport(), device: { platform: 'tizen', osVersion: 1 } }],
    ['non-numeric osVersion', { ...validReport(), device: { platform: 'android', osVersion: 'abc' } }],
    ['out-of-range osVersion', { ...validReport(), device: { platform: 'android', osVersion: 9999 } }],
    ['absurd ramMb', { ...validReport(), device: { platform: 'android', osVersion: 33, ramMb: 999999 } }],
    ['missing network', { device: androidDevice, checks: allPassChecks() }],
    ['non-boolean reachable', { ...validReport(), network: { reachable: 'yes' } }],
    ['empty checks', { ...validReport(), checks: [] }],
    ['unknown check id', { ...validReport(), checks: [...allPassChecks(), passCheck('sneaky_check')] }],
    ['duplicate check id', { ...validReport(), checks: [...allPassChecks(), passCheck('network')] }],
    ['bad status enum', () => {
      const checks = allPassChecks();
      checks[1] = { id: 'camera_permission', status: 'SKIPPED' };
      return { ...validReport(), checks };
    }],
    ['face metadata on wrong check', () => {
      const checks = allPassChecks();
      checks[1] = { id: 'camera_permission', status: 'PASS', metadata: { frames: 1 } };
      return { ...validReport(), checks };
    }],
    ['malformed face metadata', () => {
      const checks = allPassChecks();
      checks[3] = passCheck('face_readiness', { metadata: { frames: 9, agreedFrames: 2 } });
      return { ...validReport(), checks };
    }],
    ['bad faceCountClass', () => {
      const checks = allPassChecks();
      checks[3] = passCheck('face_readiness', {
        metadata: { frames: 5, agreedFrames: 5, faceCountClass: 'two', visibility: 'ok' },
      });
      return { ...validReport(), checks };
    }],
  ])('rejects %s', (_name, payload) => {
    const raw = typeof payload === 'function' ? payload() : payload;
    const result = parsePrecheckReport(raw);
    expect(result.error).toBeDefined();
    expect(result.value).toBeUndefined();
  });
});

describe('evaluateDeviceFloor — PROVISIONAL D10 floor', () => {
  it('passes an Android device at/above the floor', () => {
    expect(evaluateDeviceFloor({ platform: 'android', osVersion: 26 })).toMatchObject({ below: false });
    expect(evaluateDeviceFloor({ platform: 'android', osVersion: 33, ramMb: 4096 })).toMatchObject({ below: false });
  });

  it('refuses non-Android platforms (V1 surface)', () => {
    expect(evaluateDeviceFloor({ platform: 'ios', osVersion: 17 }).below).toBe(true);
    expect(evaluateDeviceFloor({ platform: 'web', osVersion: 1 }).below).toBe(true);
  });

  it('refuses below-floor OS and (when reported) RAM', () => {
    expect(evaluateDeviceFloor({ platform: 'android', osVersion: 24 }).below).toBe(true);
    expect(evaluateDeviceFloor({ platform: 'android', osVersion: 33, ramMb: 2048 }).below).toBe(true);
    // RAM unreported → not guessed, floor judged on what IS reported.
    expect(evaluateDeviceFloor({ platform: 'android', osVersion: 33 }).below).toBe(false);
  });
});

describe('evaluatePrecheckReport — verdict mapping', () => {
  it('PASS on an all-pass report', () => {
    const evaluation = evaluatePrecheckReport(parsePrecheckReport(validReport()), {});
    expect(evaluation.verdict).toBe('PASS');
    expect(evaluation.reasons).toEqual([]);
    expect(evaluation.cameraBypassed).toBe(false);
  });

  it('FAIL when a required check failed (camera permission denied)', () => {
    const report = validReport();
    report.checks[1] = { id: 'camera_permission', status: 'FAIL', detail: 'permission_denied' };
    const evaluation = evaluatePrecheckReport(parsePrecheckReport(report), {});
    expect(evaluation.verdict).toBe('FAIL');
    expect(evaluation.reasons[0].reasonCode).toBe('camera_permission:failed');
  });

  it('FAIL when the one-face condition was not established (zero or multiple faces)', () => {
    for (const faceCountClass of ['none', 'multiple']) {
      const report = validReport();
      report.checks[3] = {
        id: 'face_readiness',
        status: 'FAIL',
        detail: faceCountClass === 'none' ? 'face_not_detected' : 'multiple_faces',
        metadata: { frames: 5, agreedFrames: 0, faceCountClass, visibility: faceCountClass === 'none' ? 'none' : 'multiple' },
      };
      const evaluation = evaluatePrecheckReport(parsePrecheckReport(report), {});
      expect(evaluation.verdict).toBe('FAIL');
      expect(evaluation.reasons.some((r) => r.check === 'face_readiness')).toBe(true);
    }
  });

  it('RETRYABLE when every non-passing check is transient', () => {
    const report = validReport();
    report.checks[2] = { id: 'camera_availability', status: 'RETRYABLE', detail: 'camera_busy' };
    const evaluation = evaluatePrecheckReport(parsePrecheckReport(report), {});
    expect(evaluation.verdict).toBe('RETRYABLE');
    expect(evaluation.reasons[0].reasonCode).toBe('camera_availability:retryable');
  });

  it('FAIL (not retryable) when a hard and a soft failure coexist', () => {
    const report = validReport();
    report.checks[1] = { id: 'camera_permission', status: 'FAIL' };
    report.checks[4] = { id: 'network', status: 'RETRYABLE' };
    const evaluation = evaluatePrecheckReport(parsePrecheckReport(report), {});
    expect(evaluation.verdict).toBe('FAIL');
  });

  it('retries a reported-unreachable network even though the report arrived', () => {
    const report = validReport();
    report.network.reachable = false;
    const evaluation = evaluatePrecheckReport(parsePrecheckReport(report), {});
    expect(evaluation.verdict).toBe('RETRYABLE');
    expect(evaluation.reasons.some((r) => r.reasonCode === 'network:retryable')).toBe(true);
  });

  it('UNSUPPORTED for a below-floor device (D10)', () => {
    const report = validReport();
    report.device = { platform: 'android', osVersion: 24 };
    const evaluation = evaluatePrecheckReport(parsePrecheckReport(report), {});
    expect(evaluation.verdict).toBe('UNSUPPORTED');
    expect(evaluation.accommodation).toBe(true);
    expect(evaluation.reasons[0].reasonCode).toMatch(/^device_below_floor:/);
  });

  it("excuses camera failures when the quiz configures camera:'optional' (§8.3)", () => {
    const report = validReport();
    report.checks[1] = { id: 'camera_permission', status: 'FAIL' };
    report.checks[2] = { id: 'camera_availability', status: 'FAIL' };
    report.checks[3] = { id: 'face_readiness', status: 'FAIL' };
    const evaluation = evaluatePrecheckReport(parsePrecheckReport(report), { camera: 'optional' });
    expect(evaluation.verdict).toBe('PASS');
    expect(evaluation.cameraBypassed).toBe(true);
  });

  it('does NOT excuse device/network failures under camera:optional', () => {
    const report = validReport();
    report.checks[0] = { id: 'device_capability', status: 'FAIL' };
    const evaluation = evaluatePrecheckReport(parsePrecheckReport(report), { camera: 'optional' });
    expect(evaluation.verdict).toBe('FAIL');
  });
});
