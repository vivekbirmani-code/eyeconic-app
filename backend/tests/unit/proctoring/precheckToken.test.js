// Precheck attestation tokens — owner-generalized payload (public-quiz
// proctoring Phase 1, 2026-10-23). The token binds {ownerId, ownerKind,
// quizId, policyHash}; everything else (TTL, summary transport) is unchanged
// behavior already locked by the integration suites (proctoringLifecycle).

const {
  issuePrecheckToken,
  verifyPrecheckToken,
  PRECHECK_TOKEN_KIND,
} = require('../../../utils/proctoring/precheckToken');

// jwt.sign requires a secret at call time — same default the integration
// harness uses (tests/helpers/testApp.js).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const QUIZ_ID = '507f1f77bcf86cd799439011';
const OWNER_ID = '507f1f77bcf86cd799439022';
const OTHER_OWNER_ID = '507f1f77bcf86cd799439033';
const OTHER_QUIZ_ID = '507f1f77bcf86cd799439044';
const POLICY_HASH = 'sha256-abc123';

const issue = (overrides = {}) => issuePrecheckToken({
  ownerId: OWNER_ID,
  ownerKind: 'user',
  quizId: QUIZ_ID,
  policyHash: POLICY_HASH,
  policyVersion: 3,
  ...overrides,
});

describe('issuePrecheckToken / verifyPrecheckToken — owner payload', () => {
  it('round-trips a user-owner token and returns the payload', () => {
    const { token } = issue();
    const verified = verifyPrecheckToken(token, {
      ownerId: OWNER_ID, ownerKind: 'user', quizId: QUIZ_ID, policyHash: POLICY_HASH,
    });
    expect(verified.ok).toBe(true);
    expect(verified.payload.kind).toBe(PRECHECK_TOKEN_KIND);
    expect(verified.payload.ownerId).toBe(OWNER_ID);
    expect(verified.payload.ownerKind).toBe('user');
    expect(verified.payload.quizId).toBe(QUIZ_ID);
  });

  it('round-trips a guest-owner token bound to the lead id', () => {
    const { token } = issue({ ownerKind: 'guest' });
    expect(verifyPrecheckToken(token, {
      ownerId: OWNER_ID, ownerKind: 'guest', quizId: QUIZ_ID, policyHash: POLICY_HASH,
    }).ok).toBe(true);
  });

  it('rejects a token verified against a different owner id (WRONG_STUDENT)', () => {
    const { token } = issue();
    const verified = verifyPrecheckToken(token, {
      ownerId: OTHER_OWNER_ID, ownerKind: 'user', quizId: QUIZ_ID, policyHash: POLICY_HASH,
    });
    expect(verified).toMatchObject({ ok: false, reason: 'WRONG_STUDENT' });
  });

  it('rejects a token verified against a different owner KIND (guest vs user)', () => {
    const userToken = issue({ ownerKind: 'user' }).token;
    expect(verifyPrecheckToken(userToken, {
      ownerId: OWNER_ID, ownerKind: 'guest', quizId: QUIZ_ID, policyHash: POLICY_HASH,
    })).toMatchObject({ ok: false, reason: 'WRONG_STUDENT' });

    const guestToken = issue({ ownerKind: 'guest' }).token;
    expect(verifyPrecheckToken(guestToken, {
      ownerId: OWNER_ID, ownerKind: 'user', quizId: QUIZ_ID, policyHash: POLICY_HASH,
    })).toMatchObject({ ok: false, reason: 'WRONG_STUDENT' });
  });

  it('rejects wrong quiz and stale policy hash with the specific reasons', () => {
    const { token } = issue();
    expect(verifyPrecheckToken(token, {
      ownerId: OWNER_ID, ownerKind: 'user', quizId: OTHER_QUIZ_ID, policyHash: POLICY_HASH,
    })).toMatchObject({ ok: false, reason: 'WRONG_QUIZ' });
    expect(verifyPrecheckToken(token, {
      ownerId: OWNER_ID, ownerKind: 'user', quizId: QUIZ_ID, policyHash: 'sha256-other',
    })).toMatchObject({ ok: false, reason: 'POLICY_CHANGED' });
  });

  it('rejects malformed and foreign-kind tokens', () => {
    expect(verifyPrecheckToken('', { ownerId: OWNER_ID })).toMatchObject({ ok: false, reason: 'MALFORMED' });
    expect(verifyPrecheckToken('not-a-jwt', { ownerId: OWNER_ID })).toMatchObject({ ok: false, reason: 'MALFORMED' });
    // A guest session token must never pass as a precheck attestation.
    const jwt = require('jsonwebtoken');
    const guestToken = jwt.sign({ kind: 'guest', guestId: OWNER_ID }, process.env.JWT_SECRET, { expiresIn: '1h' });
    expect(verifyPrecheckToken(guestToken, { ownerId: OWNER_ID })).toMatchObject({ ok: false, reason: 'WRONG_KIND' });
  });

  it('carries the compact summary through the signed payload', () => {
    const { token } = issue({
      summary: {
        deviceClass: 'web:120',
        cameraBypassed: false,
        checks: [{ id: 'camera_permission', pass: true }],
        attentionBaseline: { yaw: -1.6, pitch: 2.1, roll: 0.4, frames: 4 },
      },
    });
    const verified = verifyPrecheckToken(token, {
      ownerId: OWNER_ID, ownerKind: 'user', quizId: QUIZ_ID, policyHash: POLICY_HASH,
    });
    expect(verified.payload.summary.deviceClass).toBe('web:120');
    expect(verified.payload.summary.attentionBaseline).toMatchObject({ yaw: -1.6, frames: 4 });
  });
});
