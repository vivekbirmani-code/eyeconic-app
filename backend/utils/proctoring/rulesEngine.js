// Rules engine — pure policy evaluation over episode events (plan §18, §20 —
// Phase 6).
//
// The engine NEVER re-detects anything. It consumes already-validated, stored
// episode events plus the persisted violation set and decides what the SERVER
// does next: CONTINUE | WARN | FINAL_WARN | SUBMIT. Deterministic integrity
// episodes drive the D3 ladder (warn each of the first `toleratedViolations`
// qualifying episodes → final warning → auto-submit); probabilistic CV
// observations can at most WARN in V1 (the strict-CV gate is OFF — D8);
// attention/head-pose events can NEVER trigger any action (D6 — record-only,
// structural, property-tested).
//
// Evaluation scope (bounded): THIS batch's fresh events + the persisted
// violation set — never a full-session replay per batch. Concurrency
// semantics: two racing batches can both read a stale-low violation count,
// under-enforcing temporarily (never over-enforcing) and self-healing on the
// next batch; the SUBMIT execution itself is CAS-protected downstream.

const { getEventDefinition } = require('./eventRegistry');

// Integrity episode types that feed the focus ladder (plan §14.2/§14.5).
// APP_INACTIVE (noisy iOS transient) and EXIT_ATTEMPTED (informational back
// interception) never count.
const FOCUS_EVENT_TYPES = ['APP_BACKGROUND', 'TAB_HIDDEN', 'WINDOW_BLUR'];

// Camera-loss technical types that may warn (§20.4 ladder's visible steps —
// the submit step needs a strict cameraHealth policy no V1 quiz carries).
const CAMERA_WARN_EVENT_TYPES = ['CAMERA_PERMISSION_REVOKED'];

// CV observation types that may WARN under their policy modes (probabilistic —
// never any submit path in V1, D8).
const MULTIPLE_FACES_EVENT = 'MULTIPLE_FACES_DETECTED';
const FACE_MISSING_EVENT = 'FACE_NOT_DETECTED';

// Attention/head-pose types — record-only, ALWAYS ignored here (D6). Listed
// explicitly so the property test can assert over the full registry.
const ATTENTION_EVENT_TYPES = [
  'HEAD_POSE_EXTREME',
  'HEAD_POSE_REPEATED',
  'ATTENTION_DEVIATION_SUSTAINED',
  'ATTENTION_DEVIATION_REPEATED',
];

const RULE_IDS = {
  focusLoss: 'focus.loss',
  focusMaxViolations: 'focus.maxViolations',
  multipleFacesSustained: 'multipleFaces.sustained',
  facePresenceAbsent: 'facePresence.absent',
  cameraPermissionRevoked: 'camera.permissionRevoked',
  maxViolationsCrossType: 'maxViolations.crossType',
};

// Student-facing warning codes — the client renders the centralized copy
// module keyed by these (plan §9.2); the backend never ships prose.
const WARN_CODES = {
  focus: 'warn.focus',
  focusFinal: 'warn.final',
  multipleFaces: 'warn.multipleFaces',
  faceMissing: 'warn.faceMissing',
  camera: 'warn.camera',
};

const numberOr = (value, fallback) =>
  (Number.isFinite(value) ? value : fallback);

/**
 * Does this stored episode qualify as a focus-loss violation input?
 *
 * The duration floor is re-checked server-side (the client already drops
 * blips, but the server never trusts that — §24.1). ONE exception: legacy
 * TAB_HIDDEN dual-write events are POINT events (the web route observes the
 * switch fact, not the return). They carry metadata.legacy and qualify on
 * existence, matching the pre-proctoring tab-switch counter semantics.
 */
const isQualifyingFocusEvent = (event, focusPolicy) => {
  if (!FOCUS_EVENT_TYPES.includes(event.type)) return false;
  if (event.metadata?.legacy === true) return true;
  const floor = numberOr(focusPolicy?.minDurationMs, 2000);
  return numberOr(event.durationMs, 0) >= floor;
};

/**
 * Deterministic warnId / WARNING_DELIVERED idempotency key — concurrent or
 * replayed deliveries of the same warning collapse onto one stored event via
 * the unique {session, idempotencyKey} index (the hbgap key doctrine).
 */
const buildWarnId = (sessionId, ruleId, eventRef) =>
  `warn:${sessionId}:${ruleId}:${eventRef}`;

/**
 * Pure policy evaluation.
 *
 * @param {object} input
 * @param {object} input.policy the FROZEN policy (attempt.proctoringSnapshot.policy)
 * @param {Array<object>} input.newEvents this batch's freshly inserted events
 *   (stored shape: {_id, type, category, durationMs, serverAt, metadata}),
 *   evaluated in serverAt order regardless of arrival order
 * @param {Array<object>} input.persistedViolations the session's existing
 *   violations (only {ruleId} is read — they are the replay-derived counter)
 * @param {string} input.sessionId
 * @param {boolean} [input.strictCvEnabled=false] the AppSettings strict-CV gate
 *   (D8) — OFF for the entire V1 rollout; when false, CV observations can
 *   never reach SUBMIT no matter what follows
 * @param {Date} [input.now]
 * @returns {{newViolations: Array, actions: Array, submit: null|object,
 *            violationCountAfter: number}}
 */
const evaluatePolicy = ({
  policy = {},
  newEvents = [],
  persistedViolations = [],
  sessionId,
  strictCvEnabled = false,
  now = new Date(),
}) => {
  const focusPolicy = policy.focusEvents || {};
  const focusMode = focusPolicy.mode || 'warn-then-submit';
  const tolerated = Math.max(1, numberOr(focusPolicy?.toleratedViolations, 3));
  const maxViolations = Math.max(1, numberOr(policy.maxViolations, 3));
  const violationAction = policy.violationAction === 'submit' ? 'submit' : 'warn';

  const sorted = [...newEvents].sort(
    (a, b) => new Date(a.serverAt) - new Date(b.serverAt) || String(a._id).localeCompare(String(b._id))
  );

  const newViolations = [];
  const actions = [];
  let submit = null;

  const persistedByRule = {};
  for (const violation of persistedViolations) {
    persistedByRule[violation.ruleId] = (persistedByRule[violation.ruleId] || 0) + 1;
  }
  let focusCount = persistedByRule[RULE_IDS.focusLoss] || 0;
  let totalCount = persistedViolations.length;
  let cameraRevokedRecorded = (persistedByRule[RULE_IDS.cameraPermissionRevoked] || 0) > 0;

  const addViolation = ({ ruleId, eventRefs, reliability, action, code, eventRef }) => {
    const warnId = action ? buildWarnId(sessionId, ruleId, eventRef) : null;
    newViolations.push({
      ruleId,
      eventRefs,
      reliability,
      derivationKey: `${sessionId}|${ruleId}|${eventRefs.join(',')}`,
      action: action || null,
      ...(warnId ? { warnId } : {}),
      countedAt: now,
    });
    if (action === 'WARN' || action === 'FINAL_WARN') {
      actions.push({
        kind: action,
        code,
        warnId,
        ruleId,
        eventRef,
      });
    }
    totalCount += 1;
    return warnId;
  };

  for (const event of sorted) {
    const definition = getEventDefinition(event.type);
    if (!definition) continue;

    // ===== D6 structural lock: attention/head-pose NEVER act =====
    if (ATTENTION_EVENT_TYPES.includes(event.type)) continue;

    // ===== D3 focus ladder (deterministic integrity episodes) =====
    if (isQualifyingFocusEvent(event, focusPolicy)) {
      focusCount += 1;
      if (focusMode === 'record') {
        // Timeline only — not counted, not warned (§14.5).
        continue;
      }
      let action = null;
      let code = WARN_CODES.focus;
      if (focusMode === 'warn-only') {
        action = 'WARN';
      } else if (focusMode === 'warn-then-submit') {
        if (focusCount <= tolerated) {
          action = 'WARN';
        } else if (focusCount === tolerated + 1 && !submit) {
          action = 'FINAL_WARN';
          code = WARN_CODES.focusFinal;
        } else if (!submit) {
          // The ladder's terminal step — exactly once per evaluation. The
          // triggering episode is still recorded as its violation (with
          // actionTaken SUBMIT); later qualifying episodes in the same batch
          // count as violations but carry no further action — the session is
          // being closed.
          addViolation({
            ruleId: RULE_IDS.focusLoss,
            eventRefs: [event._id],
            reliability: 'deterministic',
            action: null,
            code: null,
            eventRef: event._id,
          });
          submit = {
            ruleId: RULE_IDS.focusMaxViolations,
            eventRef: event._id,
            autoSubmitReason: {
              kind: 'policy',
              ruleId: RULE_IDS.focusMaxViolations,
              eventIds: [String(event._id)],
            },
            eventIds: [event._id],
          };
          continue;
        }
      }
      addViolation({
        ruleId: RULE_IDS.focusLoss,
        eventRefs: [event._id],
        reliability: 'deterministic',
        action,
        code,
        eventRef: event._id,
      });
      continue;
    }

    // ===== Multiple faces (probabilistic — WARN at most in V1, D8) =====
    if (event.type === MULTIPLE_FACES_EVENT
      && numberOr(event.durationMs, 0) >= numberOr(policy.multipleFaces?.minDurationMs, 3000)
      && (policy.multipleFaces?.mode || 'warn') === 'warn') {
      addViolation({
        ruleId: RULE_IDS.multipleFacesSustained,
        eventRefs: [event._id],
        reliability: 'probabilistic',
        action: strictCvEnabled ? 'WARN' : 'WARN',
        code: WARN_CODES.multipleFaces,
        eventRef: event._id,
      });
      continue;
    }

    // ===== Face missing (probabilistic — WARN at most in V1, D8) =====
    if (event.type === FACE_MISSING_EVENT
      && numberOr(event.durationMs, 0) >= numberOr(policy.facePresence?.minAbsentMs, 8000)
      && (policy.facePresence?.mode || 'warn') === 'warn') {
      addViolation({
        ruleId: RULE_IDS.facePresenceAbsent,
        eventRefs: [event._id],
        reliability: 'probabilistic',
        action: 'WARN',
        code: WARN_CODES.faceMissing,
        eventRef: event._id,
      });
      continue;
    }

    // ===== Camera loss (technical — banner warn per §20.4's visible steps;
    // the submit step needs a strict cameraHealth policy no V1 quiz carries,
    // and camera problems must NEVER auto-submit by default — degrade, don't
    // destroy). One session-level violation; every episode still warns. =====
    if (CAMERA_WARN_EVENT_TYPES.includes(event.type)) {
      if (!cameraRevokedRecorded) {
        cameraRevokedRecorded = true;
        addViolation({
          ruleId: RULE_IDS.cameraPermissionRevoked,
          eventRefs: [event._id],
          reliability: 'deterministic',
          action: 'WARN',
          code: WARN_CODES.camera,
          eventRef: event._id,
        });
      } else {
        actions.push({
          kind: 'WARN',
          code: WARN_CODES.camera,
          warnId: buildWarnId(sessionId, 'camera.episode', event._id),
          ruleId: 'camera.episode',
          eventRef: event._id,
        });
      }
      continue;
    }

    // HEARTBEAT_GAP and every other technical/system event: record + risk
    // only under the V1 'record' sessionHealth policy — no action here.
  }

  // ===== Cross-type maxViolations counter (§21.2) =====
  // Fires once, exactly at the crossing — and NEVER duplicates a FINAL_WARN
  // the focus ladder already delivered this evaluation (one final warning,
  // not two). SUBMIT only when the quiz explicitly chose violationAction
  // 'submit' AND every counted violation is deterministic — probabilistic
  // observations can never feed a submit (D8). Camera revocations are
  // excluded from the submit-eligible mix (§20.4: a broken camera must never
  // cost the student their attempt).
  const alreadyFinalWarned = actions.some((a) => a.kind === 'FINAL_WARN');
  if (!submit && !alreadyFinalWarned && totalCount === maxViolations + 1) {
    const submitEligible = persistedViolations.concat(newViolations)
      .filter((v) => v.ruleId === RULE_IDS.focusLoss).length === totalCount;
    if (violationAction === 'submit' && submitEligible) {
      const focusViolation = [...newViolations]
        .reverse()
        .find((v) => v.ruleId === RULE_IDS.focusLoss);
      submit = {
        ruleId: RULE_IDS.maxViolationsCrossType,
        eventRef: focusViolation?.eventRefs?.[0] || null,
        autoSubmitReason: {
          kind: 'policy',
          ruleId: RULE_IDS.maxViolationsCrossType,
          eventIds: (focusViolation?.eventRefs || []).map(String),
        },
        eventIds: focusViolation?.eventRefs || [],
      };
    } else {
      actions.push({
        kind: 'FINAL_WARN',
        code: WARN_CODES.focusFinal,
        warnId: buildWarnId(sessionId, RULE_IDS.maxViolationsCrossType, 'crossing'),
        ruleId: RULE_IDS.maxViolationsCrossType,
        eventRef: null,
      });
    }
  }

  // Stamp the SUBMIT action onto the triggering violation when it came from
  // this evaluation's new violations (audit parity with WARN/FINAL_WARN).
  if (submit) {
    const triggering = newViolations.find(
      (v) => v.ruleId !== null && String(v.eventRefs?.[0]) === String(submit.eventRef)
    );
    if (triggering) triggering.action = 'SUBMIT';
  }

  return {
    newViolations,
    actions,
    submit,
    violationCountAfter: totalCount,
  };
};

module.exports = {
  FOCUS_EVENT_TYPES,
  ATTENTION_EVENT_TYPES,
  RULE_IDS,
  WARN_CODES,
  isQualifyingFocusEvent,
  buildWarnId,
  evaluatePolicy,
};
