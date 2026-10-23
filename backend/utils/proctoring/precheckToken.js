// Short-lived precheck attestation tokens (plan §8.8, §27.2).
//
// The precheck-report endpoint issues this token on an all-pass report; /start
// requires it for proctored quizzes. It is a server-SIGNED JWT bound to
// {owner, quiz, policyHash}: a client can never forge or reuse one for
// another participant, quiz, or policy version — the same secret-based
// discipline as the guest token. The owner is a registered student
// (ownerKind 'user', ownerId = User id) or an OTP-verified public-quiz lead
// (ownerKind 'guest', ownerId = Guest id). Payload carries the compact
// precheck summary that the consent record later persists (§26.3
// precheckSummary).

const jwt = require('jsonwebtoken');
const { PRECHECK_TOKEN_TTL_MS } = require('./defaults');

const PRECHECK_TOKEN_KIND = 'proctoring_precheck';

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * @param {object} binding values the token is bound to (all required)
 * @param {string} binding.ownerId User id (ownerKind 'user') or Guest id
 *                 (ownerKind 'guest')
 * @param {'user'|'guest'} binding.ownerKind
 * @param {string} binding.quizId
 * @param {string} binding.policyHash effective-policy hash at precheck time
 * @param {number} binding.policyVersion
 * @param {{deviceClass?: string, cameraBypassed?: boolean,
 *          checks?: Array<{id: string, pass: boolean, detail?: string}>}} binding.summary
 * @returns {{token: string, expiresAt: Date, issuedAt: Date}}
 */
const issuePrecheckToken = ({ ownerId, ownerKind, quizId, policyHash, policyVersion, summary = {} }) => {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + PRECHECK_TOKEN_TTL_MS);
  const token = jwt.sign(
    {
      kind: PRECHECK_TOKEN_KIND,
      ownerId: String(ownerId),
      ownerKind: ownerKind === 'guest' ? 'guest' : 'user',
      quizId: String(quizId),
      policyHash: String(policyHash),
      policyVersion: Number(policyVersion),
      summary: {
        deviceClass: summary.deviceClass ?? null,
        cameraBypassed: summary.cameraBypassed === true,
        checks: Array.isArray(summary.checks) ? summary.checks.slice(0, 20) : [],
        // Phase 5 (D11): the precheck-captured attention baseline rides the
        // SIGNED token so the consent record and /start can carry it without
        // ever trusting an unsigned client claim.
        ...(isPlainObject(summary.attentionBaseline) ? {
          attentionBaseline: summary.attentionBaseline,
        } : {}),
      },
    },
    process.env.JWT_SECRET,
    { expiresIn: Math.floor(PRECHECK_TOKEN_TTL_MS / 1000) }
  );
  return { token, expiresAt, issuedAt };
};

/**
 * Verifies a precheck token against everything it must match.
 *
 * @returns {{ok: true, payload: object}}
 *          | {{ok: false, reason: 'MALFORMED'|'EXPIRED'|'WRONG_KIND'|'WRONG_STUDENT'|'WRONG_QUIZ'|'POLICY_CHANGED'}}
 *            ('WRONG_STUDENT' is the historical reason name — it means
 *            wrong OWNER: a different user or guest than expected.)
 */
const verifyPrecheckToken = (token, { ownerId, ownerKind, quizId, policyHash } = {}) => {
  if (typeof token !== 'string' || !token.trim()) {
    return { ok: false, reason: 'MALFORMED' };
  }
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return { ok: false, reason: error?.name === 'TokenExpiredError' ? 'EXPIRED' : 'MALFORMED' };
  }
  if (payload?.kind !== PRECHECK_TOKEN_KIND) return { ok: false, reason: 'WRONG_KIND' };
  if (ownerKind !== undefined && payload.ownerKind !== ownerKind) {
    return { ok: false, reason: 'WRONG_STUDENT' };
  }
  if (ownerId !== undefined && String(payload.ownerId) !== String(ownerId)) {
    return { ok: false, reason: 'WRONG_STUDENT' };
  }
  if (quizId !== undefined && String(payload.quizId) !== String(quizId)) {
    return { ok: false, reason: 'WRONG_QUIZ' };
  }
  if (policyHash !== undefined && String(payload.policyHash) !== String(policyHash)) {
    return { ok: false, reason: 'POLICY_CHANGED' };
  }
  return { ok: true, payload };
};

module.exports = {
  PRECHECK_TOKEN_KIND,
  issuePrecheckToken,
  verifyPrecheckToken,
};
