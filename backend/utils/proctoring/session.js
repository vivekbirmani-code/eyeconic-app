// ProctoringSession lifecycle helpers (plan §7, §7.4).
//
// A session belongs 1:1 to an attempt (unique {attempt} index) and is created
// ONLY inside the /start sequence — never earlier. Creation is idempotent:
// the unique index makes concurrent create attempts converge onto one row
// (loser re-fetches), so duplicate/retry/concurrent starts can never produce
// inconsistent state. A session missing because of a crash between the
// attempt save and the session create is self-healed on the next /start
// resume (plan §7.2).
//
// Every state transition is recorded in the session's audit array; state is
// asserted by the server only — clients observe it, they never claim it.

const ProctoringSession = require('../../models/ProctoringSession');
const { freezeSessionSummary } = require('./summary');

const SESSION_STATUSES = ['ACTIVE', 'DEGRADED', 'CLOSED', 'CLOSED_FAILED'];

/**
 * Client-facing shape of the session's D11 attention baseline: null when the
 * session has none (older/self-healed sessions → the client arms with
 * conservative global bands + a calibration:'fallback' marker).
 */
const shapeAttentionBaseline = (session) => {
  const pose = session?.baseline?.nominalHeadPose;
  if (!pose || typeof pose.yaw !== 'number' || typeof pose.pitch !== 'number') return null;
  return {
    yaw: pose.yaw,
    pitch: pose.pitch,
    ...(typeof pose.roll === 'number' ? { roll: pose.roll } : {}),
    calibration: session.baseline.calibration === 'captured' ? 'captured' : 'fallback',
    detectorTier: session.baseline.detectorTier ?? 'headpose',
  };
};

/**
 * Idempotently returns the session for an attempt, creating it (status
 * ACTIVE) when missing. `policySnapshot` is the attempt's frozen policy
 * snapshot ({version, hash}) — the session stores its identity, the full
 * policy lives on the attempt.
 *
 * Phase 5 (D11): `attentionBaseline` ({yaw, pitch, roll, frames} from the
 * signed precheck-token summary) is frozen onto the session at creation so
 * the client can re-arm with the SAME seated baseline after an app restart.
 * Absent on self-heal paths — those sessions fall back to conservative
 * global bands client-side (calibration:'fallback'), never blocked.
 *
 * @returns {Promise<object|null>} the session doc, or null on unexpected
 *          failure (session problems must never block a quiz — plan §7.2).
 */
const ensureProctoringSession = async (attempt, { policySnapshot, reason = 'start', attentionBaseline } = {}) => {
  if (!attempt?._id) return null;

  const existing = await ProctoringSession.findOne({ attempt: attempt._id });
  if (existing) return existing;

  const startedAt = new Date();
  try {
    return await ProctoringSession.create({
      quiz: attempt.quiz,
      attempt: attempt._id,
      student: attempt.student,
      ownerKind: 'user',
      status: 'ACTIVE',
      policy: {
        version: policySnapshot?.version ?? null,
        hash: policySnapshot?.hash ?? null,
      },
      // D11 baseline — captured at precheck, signed into the token, frozen
      // here at session creation (the reserved schema field, plan §26.1).
      ...(attentionBaseline ? {
        baseline: {
          capturedAt: startedAt,
          nominalHeadPose: {
            yaw: attentionBaseline.yaw,
            pitch: attentionBaseline.pitch,
            roll: attentionBaseline.roll,
          },
          detectorTier: 'headpose',
          calibration: 'captured',
        },
      } : {}),
      startedAt,
      transitions: [{ from: null, to: 'ACTIVE', reason, at: startedAt }],
    });
  } catch (error) {
    // E11000: a concurrent /start created the session first — converge onto it.
    if (error?.code === 11000 || error?.codeName === 'DuplicateKey') {
      const concurrent = await ProctoringSession.findOne({ attempt: attempt._id });
      if (concurrent) return concurrent;
    }
    console.error('[ProctoringSession] ensure failed:', error?.message || error);
    return null;
  }
};

/**
 * Closes the attempt's session (if any) on the finalize winner branch —
 * manual submits, section cascades, duration deadlines AND policy
 * auto-submits all converge here (plan §7.5). CAS on a non-terminal status
 * makes concurrent closes converge; the loser simply re-reads. The close
 * also freezes the session summary (risk + rollups, Phase 6) from the
 * attempt's frozen policy. Best-effort by design: a failure here is logged,
 * never propagated — the attempt is already finalized and must not be rolled
 * back.
 */
const closeProctoringSessionForAttempt = async (attempt, { reason } = {}) => {
  if (!attempt?._id) return null;

  const existing = await ProctoringSession.findOne({ attempt: attempt._id });
  if (!existing) return null;
  if (existing.status === 'CLOSED' || existing.status === 'CLOSED_FAILED') return existing;

  const at = new Date();
  const closed = await ProctoringSession.findOneAndUpdate(
    { _id: existing._id, status: { $in: ['ACTIVE', 'DEGRADED'] } },
    {
      $set: { status: 'CLOSED', endedAt: at },
      $push: { transitions: { from: existing.status, to: 'CLOSED', reason: reason || 'attempt_finalized', at } },
    },
    { new: true }
  );
  const target = closed || existing;
  await freezeSessionSummary(target, {
    policy: attempt.proctoringSnapshot?.policy || {},
  });
  return target;
};

module.exports = {
  SESSION_STATUSES,
  ensureProctoringSession,
  shapeAttentionBaseline,
  closeProctoringSessionForAttempt,
};
