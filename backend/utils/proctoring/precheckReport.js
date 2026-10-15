// Pure validation + server-side verdict mapping for client precheck reports
// (plan §8, §24.1). The client reports OBSERVATIONS (check statuses, device
// facts); THIS module decides the verdict. A client can never assert
// "precheck passed" — only an all-required-pass report yields PASS, and the
// device floor / camera-required rules are enforced here, server-side.

const {
  PRECHECK_CHECK_IDS,
  PRECHECK_CHECK_STATUSES,
  PROVISIONAL_DEVICE_FLOOR,
  FACE_READINESS_MIN_FRAMES,
} = require('./defaults');

const MAX_DETAIL_LENGTH = 300;
const MAX_CHECKS = 20;

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validates the report payload shape. Unknown check ids, free-form statuses
 * and oversized junk are rejected (400) — the server owns the vocabulary.
 *
 * @returns {{value: {device, network, checks}}|{error: string}}
 */
const parsePrecheckReport = (raw) => {
  if (!isPlainObject(raw)) return { error: 'Precheck report must be an object' };

  const { device, network, checks } = raw;

  if (!isPlainObject(device)) return { error: 'device is required' };
  const platform = String(device.platform || '');
  if (!['android', 'ios', 'web'].includes(platform)) {
    return { error: 'device.platform must be "android", "ios" or "web"' };
  }
  const osVersionRaw = device.osVersion;
  const osVersion = Number(osVersionRaw);
  if (!Number.isFinite(osVersion)) {
    return { error: 'device.osVersion must be a number' };
  }
  if (osVersion < 0 || osVersion > 1000) {
    return { error: 'device.osVersion is out of range' };
  }
  const model = device.model === undefined || device.model === null
    ? undefined
    : String(device.model).slice(0, 120);
  const ramMb = device.ramMb === undefined || device.ramMb === null
    ? undefined
    : Number(device.ramMb);
  if (ramMb !== undefined && (!Number.isFinite(ramMb) || ramMb <= 0 || ramMb > 65536)) {
    return { error: 'device.ramMb must be a positive number of megabytes' };
  }

  if (!isPlainObject(network)) return { error: 'network is required' };
  if (typeof network.reachable !== 'boolean') {
    return { error: 'network.reachable must be a boolean' };
  }
  const authedPingMs = network.authedPingMs === undefined || network.authedPingMs === null
    ? undefined
    : Number(network.authedPingMs);
  if (authedPingMs !== undefined && (!Number.isFinite(authedPingMs) || authedPingMs < 0 || authedPingMs > 600000)) {
    return { error: 'network.authedPingMs must be a non-negative number of milliseconds' };
  }

  if (!Array.isArray(checks) || checks.length === 0 || checks.length > MAX_CHECKS) {
    return { error: `checks must be a non-empty array (max ${MAX_CHECKS})` };
  }
  const seen = new Set();
  const normalizedChecks = [];
  for (const check of checks) {
    if (!isPlainObject(check)) return { error: 'each check must be an object' };
    const id = String(check.id || '');
    if (!PRECHECK_CHECK_IDS.includes(id)) {
      return { error: `Unknown check id: ${id || '(missing)'}` };
    }
    if (seen.has(id)) return { error: `Duplicate check id: ${id}` };
    seen.add(id);
    const status = String(check.status || '');
    if (!PRECHECK_CHECK_STATUSES.includes(status)) {
      return { error: `check ${id}: status must be one of ${PRECHECK_CHECK_STATUSES.join('|')}` };
    }
    const detail = check.detail === undefined || check.detail === null
      ? undefined
      : String(check.detail).slice(0, MAX_DETAIL_LENGTH);

    // metadata is accepted for face_readiness only (frame agreement facts).
    let metadata;
    if (check.metadata !== undefined && check.metadata !== null) {
      if (id !== 'face_readiness') {
        return { error: `check ${id} must not carry metadata` };
      }
      if (!isPlainObject(check.metadata)) {
        return { error: 'face_readiness metadata must be an object' };
      }
      const frames = Number(check.metadata.frames);
      const agreedFrames = Number(check.metadata.agreedFrames);
      const faceCountClass = String(check.metadata.faceCountClass || '');
      const visibility = String(check.metadata.visibility || '');
      if (!Number.isInteger(frames) || frames < 1 || frames > 50 ||
          !Number.isInteger(agreedFrames) || agreedFrames < 0 || agreedFrames > frames ||
          !['none', 'one', 'multiple'].includes(faceCountClass) ||
          !['none', 'ok', 'partial', 'small', 'multiple'].includes(visibility)) {
        return { error: 'face_readiness metadata is malformed' };
      }
      metadata = { frames, agreedFrames, faceCountClass, visibility };

      // Phase 5 attention baseline (D11 calibration-lite, plan §13.4): the
      // seated nominal head pose derived from the AGREED readiness frames.
      // Optional — its absence is always legal (older clients / fallback
      // sessions proceed with conservative global bands, never blocked).
      const baseline = check.metadata.attentionBaseline;
      if (baseline !== undefined && baseline !== null) {
        if (!isPlainObject(baseline)) {
          return { error: 'face_readiness metadata attentionBaseline must be an object' };
        }
        const yaw = Number(baseline.yaw);
        const pitch = Number(baseline.pitch);
        const roll = Number(baseline.roll);
        const baselineFrames = Number(baseline.frames);
        if (!Number.isFinite(yaw) || Math.abs(yaw) > 180 ||
            !Number.isFinite(pitch) || Math.abs(pitch) > 90 ||
            !Number.isFinite(roll) || Math.abs(roll) > 180 ||
            !Number.isInteger(baselineFrames) || baselineFrames < FACE_READINESS_MIN_FRAMES || baselineFrames > agreedFrames) {
          return { error: 'face_readiness metadata attentionBaseline is malformed' };
        }
        metadata.attentionBaseline = {
          yaw: Math.round(yaw * 10) / 10,
          pitch: Math.round(pitch * 10) / 10,
          roll: Math.round(roll * 10) / 10,
          frames: baselineFrames,
        };
      }
    }

    normalizedChecks.push({ id, status, detail, ...(metadata ? { metadata } : {}) });
  }

  return {
    value: {
      device: { platform, osVersion, ...(model !== undefined ? { model } : {}), ...(ramMb !== undefined ? { ramMb } : {}) },
      network: { reachable: network.reachable, ...(authedPingMs !== undefined ? { authedPingMs } : {}) },
      checks: normalizedChecks,
    },
  };
};

// D10 device-floor verdict. PROVISIONAL values (see defaults.js) — the
// measured floor from the Phase 0 runbook replaces them without any code
// change here. ramMb is enforced only when reported.
const evaluateDeviceFloor = (device) => {
  if (device.platform !== PROVISIONAL_DEVICE_FLOOR.platform) {
    return {
      below: true,
      reason: 'platform_unsupported',
      detail: `Proctored tests are supported on Android only in this version (reported: ${device.platform}).`,
      ramReported: false,
    };
  }
  if (Number(device.osVersion) < PROVISIONAL_DEVICE_FLOOR.minOsApiLevel) {
    return {
      below: true,
      reason: 'os_below_floor',
      detail: `This device's Android version is below the minimum supported for monitored tests.`,
      ramReported: device.ramMb !== undefined,
    };
  }
  if (device.ramMb !== undefined && device.ramMb < PROVISIONAL_DEVICE_FLOOR.minRamMb) {
    return {
      below: true,
      reason: 'ram_below_floor',
      detail: 'This device cannot run the monitoring this test requires.',
      ramReported: true,
    };
  }
  return { below: false, ramReported: device.ramMb !== undefined };
};

/**
 * Maps a VALIDATED report to the server verdict (plan §8):
 *   PASS        — every required check passed (or failed checks are excused
 *                 by camera:'optional'); a precheck token may be issued.
 *   RETRYABLE   — a transient failure only; retry now, nothing consumed.
 *   FAIL        — a required condition is not met (permission denied, camera
 *                 unavailable, one-face not established); fix + retry.
 *   UNSUPPORTED — the device/platform can never pass (floor / platform).
 *
 * @param {{value: object}} parsed result of parsePrecheckReport
 * @param {{camera: 'required'|'optional'}} effectivePolicy
 * @returns {{verdict, reasons: [{check, reasonCode, detail?}], cameraBypassed, deviceFloor}}
 */
const evaluatePrecheckReport = ({ value }, effectivePolicy = {}) => {
  const cameraRequired = (effectivePolicy.camera ?? 'required') === 'required';
  const deviceFloor = evaluateDeviceFloor(value.device);
  const reasons = [];

  if (deviceFloor.below) {
    return {
      verdict: 'UNSUPPORTED',
      reasons: [{ check: 'device_capability', reasonCode: `device_below_floor:${deviceFloor.reason}`, detail: deviceFloor.detail }],
      cameraBypassed: false,
      deviceFloor,
      accommodation: true,
    };
  }

  const byId = new Map(value.checks.map((check) => [check.id, check]));
  const get = (id, fallbackStatus = 'FAIL') => byId.get(id) ?? { id, status: fallbackStatus, detail: 'not reported' };

  const cameraExcused = !cameraRequired;
  let sawRetryable = false;
  let cameraBypassed = false;

  const cameraDependent = ['camera_permission', 'camera_availability', 'face_readiness'];
  for (const id of PRECHECK_CHECK_IDS) {
    const check = get(id);
    if (check.status === 'PASS') continue;

    const isCamera = cameraDependent.includes(id);
    const excused = isCamera && cameraExcused;
    if (excused) {
      cameraBypassed = true; // camera:'optional' — record and proceed (§8.3)
      continue;
    }

    if (check.status === 'RETRYABLE') {
      sawRetryable = true;
      reasons.push({ check: id, reasonCode: `${id}:retryable`, detail: check.detail });
      continue;
    }
    reasons.push({
      check: id,
      reasonCode: check.status === 'UNSUPPORTED' ? `${id}:unsupported` : `${id}:failed`,
      detail: check.detail,
    });
  }

  // A network that cannot reach the server could not have filed this report —
  // but a reported unreachable flag still forces a retry (honesty over trust).
  if (value.network.reachable !== true) {
    sawRetryable = true;
    reasons.push({ check: 'network', reasonCode: 'network:retryable', detail: 'Network check did not complete' });
  }

  if (reasons.length === 0) {
    return { verdict: 'PASS', reasons: [], cameraBypassed, deviceFloor, accommodation: false };
  }
  if (sawRetryable && reasons.every((r) => r.reasonCode.endsWith(':retryable'))) {
    return { verdict: 'RETRYABLE', reasons, cameraBypassed, deviceFloor, accommodation: false };
  }
  return { verdict: 'FAIL', reasons, cameraBypassed, deviceFloor, accommodation: false };
};

module.exports = {
  parsePrecheckReport,
  evaluateDeviceFloor,
  evaluatePrecheckReport,
};
