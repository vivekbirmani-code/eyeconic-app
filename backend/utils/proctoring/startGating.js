// Server-side /start prerequisites for proctored quizzes (plan §7.1 step 2,
// §9.3, §27.4). Runs ONLY on the create-new-attempt path — an existing
// in_progress attempt resumes without re-gating (a mid-attempt student must
// never be blocked by a re-consent demand; §7.2).
//
// Order of checks (each failure maps to a plan error code):
//   1. consent record for the CURRENT policy version+hash — else 403
//      PROCTORING_CONSENT_REQUIRED (config changes require re-consent, §21.4)
//   2. precheck token present + valid + bound to {student, quiz, hash} —
//      else 403 PROCTORING_PRECHECK_REQUIRED / PRECHECK_TOKEN_INVALID
//
// Gating failures must leave ZERO attempt/session rows behind.

const ProctoringConsent = require('../../models/ProctoringConsent');
const { verifyPrecheckToken } = require('./precheckToken');

/**
 * @param {object} quiz quiz document (proctoring-eligible)
 * @param {object} effective {version, hash} from buildEffectiveProctoringPolicy
 * @param {string} studentId
 * @param {string|undefined} precheckToken raw token from the /start body
 * @returns {{ok: true}}
 *          | {{ok: false, status: 403, code: string, message: string}}
 */
const assertProctoringStartPrerequisites = async (quiz, effective, studentId, precheckToken) => {
  // 1. Consent — must exist for the CURRENT policy and match its hash.
  const consent = await ProctoringConsent.findOne({
    quiz: quiz._id,
    student: studentId,
    policyVersion: effective.version,
  });
  if (!consent || consent.policyHash !== effective.hash) {
    return {
      ok: false,
      status: 403,
      code: 'PROCTORING_CONSENT_REQUIRED',
      message: consent
        ? 'This test\'s monitoring settings changed. Please review and accept them before starting.'
        : 'This test uses camera-based monitoring. Please complete the readiness checks and accept the monitoring notice before starting.',
    };
  }

  // 2. Precheck attestation token — signed by us, bound to this student +
  //    quiz + the exact policy hash consent was given for.
  if (!precheckToken) {
    return {
      ok: false,
      status: 403,
      code: 'PROCTORING_PRECHECK_REQUIRED',
      message: 'Please complete the readiness checks before starting this test.',
    };
  }
  const verified = verifyPrecheckToken(precheckToken, {
    studentId,
    quizId: quiz._id,
    policyHash: effective.hash,
  });
  if (!verified.ok) {
    return {
      ok: false,
      status: 403,
      code: 'PRECHECK_TOKEN_INVALID',
      message: verified.reason === 'EXPIRED'
        ? 'Your readiness check expired. Please run it again.'
        : 'Your readiness check is no longer valid. Please run it again.',
    };
  }

  return { ok: true, precheck: verified.payload };
};

module.exports = { assertProctoringStartPrerequisites };
