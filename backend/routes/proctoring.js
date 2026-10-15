// Proctoring lifecycle routes — Phase 2 (plan §27.2): precheck reporting
// (issues the short-TTL attestation token) and consent recording. Mounted as
// a sub-router of the quizzes router at /:id/proctoring, so req.params.id is
// the quiz id.
//
// Lifecycle guarantees (plan §7.1):
//   - These routes NEVER create a quiz attempt or a proctoring session.
//   - Precheck failure consumes nothing: the student may retry any number of
//     times within the quiz window (bounded only by the report rate limit).
//   - Consent is keyed {quiz, student, policyVersion} and idempotent.
//   /start enforces both (utils/proctoring/startGating.js) before creating
//   anything — gating cannot be bypassed by calling /start directly.
//
// Response shape follows the public-route discipline {success, message,
// code, requestId} (plan §2.2): this is a new, safety-relevant surface.

const express = require('express');
const Quiz = require('../models/Quiz');
const ProctoringConsent = require('../models/ProctoringConsent');
const { auth, authorize } = require('../middleware/auth');
const { precheckReportRateLimit } = require('../middleware/proctoringRateLimit');
const logger = require('../utils/logger');
const { buildEffectiveProctoringPolicy } = require('../utils/proctoring/policySnapshot');
const { resolveEligibilityForQuiz } = require('../utils/proctoring/rollout');
const { parsePrecheckReport, evaluatePrecheckReport } = require('../utils/proctoring/precheckReport');
const { issuePrecheckToken, verifyPrecheckToken } = require('../utils/proctoring/precheckToken');

const router = express.Router({ mergeParams: true });

const CONSENT_SURFACES = ['app-android', 'app-ios', 'web'];

/**
 * Shared preconditions for both routes: quiz exists, the student is assigned,
 * and proctoring is fully effective right now (kill switch > feature flag >
 * quiz opt-in — resolved through the SAME shared helper /start uses, so the
 * client can never see a precheck flow for a quiz that /start would start
 * unproctored).
 * Sends the error response itself and returns null on failure.
 */
const loadEligibleProctoredQuiz = async (req, res) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz || !quiz.isActive || quiz.isDeleted) {
    res.status(404).json({
      success: false,
      message: 'This test was deleted by the administrator and is no longer available.',
      code: 'QUIZ_NOT_FOUND',
      requestId: req.requestId,
    });
    return null;
  }
  if (!quiz.assignedStudents.includes(req.user._id)) {
    res.status(403).json({
      success: false,
      message: 'You are not assigned to this quiz',
      code: 'NOT_ASSIGNED',
      requestId: req.requestId,
    });
    return null;
  }

  const eligibility = await resolveEligibilityForQuiz(quiz);
  if (!eligibility.enabled) {
    // Rollout gates off → the quiz behaves exactly like a non-proctored one;
    // there is nothing to pre-check or consent to (full rollback, plan §31).
    const { blockers } = eligibility;
    if (blockers.includes('quiz_config_disabled')) {
      res.status(400).json({
        success: false,
        message: 'Proctoring is not enabled for this quiz.',
        code: 'PROCTORING_NOT_ENABLED_FOR_QUIZ',
        requestId: req.requestId,
      });
    } else {
      res.status(503).json({
        success: false,
        message: 'This feature is temporarily unavailable and will be enabled in a future version.',
        code: 'PROCTORING_DISABLED',
        requestId: req.requestId,
      });
    }
    return null;
  }

  const effective = buildEffectiveProctoringPolicy(quiz);
  if (!effective) {
    // Defensive: eligibility said yes but the policy builder says no.
    res.status(400).json({
      success: false,
      message: 'Proctoring is not enabled for this quiz.',
      code: 'PROCTORING_NOT_ENABLED_FOR_QUIZ',
      requestId: req.requestId,
    });
    return null;
  }

  return { quiz, effective };
};

/**
 * POST /api/quizzes/:id/proctoring/precheck-report
 *
 * Submits client-side readiness observations. The SERVER decides the verdict
 * (utils/proctoring/precheckReport.js); only PASS issues the signed
 * short-TTL precheck token that /start requires. No attempt, no session, and
 * nothing quota-consuming is ever created here.
 */
router.post('/precheck-report', auth, authorize('student'), precheckReportRateLimit, async (req, res) => {
  try {
    const loaded = await loadEligibleProctoredQuiz(req, res);
    if (!loaded) return;
    const { quiz, effective } = loaded;

    const parsed = parsePrecheckReport(req.body);
    if (parsed.error) {
      return res.status(400).json({
        success: false,
        message: parsed.error,
        code: 'VALIDATION_ERROR',
        requestId: req.requestId,
      });
    }

    const evaluation = evaluatePrecheckReport(parsed, effective.policy);

    // Support analytics (plan §8.8): structured aggregate log, no PII beyond ids.
    logger.info('Proctoring precheck report', {
      requestId: req.requestId,
      quizId: quiz._id,
      studentId: req.user._id,
      verdict: evaluation.verdict,
      reasons: evaluation.reasons.map((r) => r.reasonCode),
      ramReported: evaluation.deviceFloor?.ramReported === true,
    });

    if (evaluation.verdict === 'UNSUPPORTED') {
      // D10: a device below the floor must not start a proctored attempt —
      // refuse with the accommodation path, never as an accusation.
      return res.status(403).json({
        success: false,
        verdict: 'UNSUPPORTED',
        message: evaluation.reasons[0]?.detail || 'This device cannot run the monitoring this test requires.',
        code: 'DEVICE_BELOW_FLOOR',
        reasons: evaluation.reasons,
        accommodation: true,
        requestId: req.requestId,
      });
    }

    if (evaluation.verdict !== 'PASS') {
      // FAIL / RETRYABLE: the report itself is valid — answer with the
      // verdict so the client can show the fix path and retry. No token.
      return res.status(200).json({
        success: true,
        verdict: evaluation.verdict,
        message: evaluation.verdict === 'RETRYABLE'
          ? 'A readiness check could not complete. Please try again.'
          : 'One or more readiness checks did not pass. Follow the guidance and try again.',
        reasons: evaluation.reasons,
        accommodation: evaluation.accommodation === true,
        requestId: req.requestId,
      });
    }

    const { token, expiresAt, issuedAt } = issuePrecheckToken({
      studentId: req.user._id,
      quizId: quiz._id,
      policyHash: effective.hash,
      policyVersion: effective.version,
      summary: {
        deviceClass: `${parsed.value.device.platform}:${parsed.value.device.osVersion}`,
        cameraBypassed: evaluation.cameraBypassed === true,
        checks: parsed.value.checks.map((check) => ({
          id: check.id,
          pass: check.status === 'PASS' || (evaluation.cameraBypassed && check.id !== 'device_capability' && check.id !== 'network'),
          detail: check.detail,
        })),
        // Phase 5 (D11): the server-validated baseline from the face_readiness
        // metadata, when the client captured one — absent for older clients
        // (fallback sessions proceed without it, never blocked).
        ...(() => {
          const baseline = parsed.value.checks.find((c) => c.id === 'face_readiness')?.metadata?.attentionBaseline;
          return baseline ? { attentionBaseline: baseline } : {};
        })(),
      },
    });

    return res.status(200).json({
      success: true,
      verdict: 'PASS',
      message: 'Readiness checks passed.',
      precheckToken: token,
      precheckTokenExpiresAt: expiresAt,
      policyVersion: effective.version,
      policyHash: effective.hash,
      cameraBypassed: evaluation.cameraBypassed === true,
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error('Proctoring precheck report failed', {
      requestId: req.requestId,
      errorMessage: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: 'Server error',
      code: 'INTERNAL_ERROR',
      requestId: req.requestId,
    });
  }
});

/**
 * POST /api/quizzes/:id/proctoring/consent
 *
 * Records explicit consent against the precheck token (so consent is only
 * ever given for a readiness-verified session) and the CURRENT policy hash.
 * Idempotent upsert keyed {quiz, student, policyVersion}; replays and
 * re-consents update the same row (§7.3, §21.4).
 */
router.post('/consent', auth, authorize('student'), async (req, res) => {
  try {
    const loaded = await loadEligibleProctoredQuiz(req, res);
    if (!loaded) return;
    const { quiz, effective } = loaded;

    const { precheckToken, consentTextVersion, surface } = req.body || {};
    if (typeof consentTextVersion !== 'string' || !consentTextVersion.trim() || consentTextVersion.length > 40) {
      return res.status(400).json({
        success: false,
        message: 'consentTextVersion is required.',
        code: 'VALIDATION_ERROR',
        requestId: req.requestId,
      });
    }
    if (surface !== undefined && !CONSENT_SURFACES.includes(surface)) {
      return res.status(400).json({
        success: false,
        message: `surface must be one of ${CONSENT_SURFACES.join('|')}.`,
        code: 'VALIDATION_ERROR',
        requestId: req.requestId,
      });
    }

    const verified = verifyPrecheckToken(precheckToken, {
      studentId: req.user._id,
      quizId: quiz._id,
      policyHash: effective.hash,
    });
    if (!verified.ok) {
      return res.status(403).json({
        success: false,
        message: verified.reason === 'EXPIRED'
          ? 'Your readiness check expired. Please run it again before accepting.'
          : 'Your readiness check is not valid for this test. Please run it again.',
        code: 'PRECHECK_TOKEN_INVALID',
        requestId: req.requestId,
      });
    }

    const consentDoc = {
      quiz: quiz._id,
      student: req.user._id,
      policyVersion: effective.version,
      policyHash: effective.hash,
      consentTextVersion,
      grantedAt: new Date(),
      precheckSummary: {
        deviceClass: verified.payload.summary?.deviceClass ?? null,
        // Compact review context from the precheck run (plan §26.3).
        networkProbe: {
          cameraBypassed: verified.payload.summary?.cameraBypassed === true,
        },
        // Phase 5 (D11): the precheck-captured attention baseline, persisted
        // from the SIGNED token summary so /start can freeze it onto the
        // session without trusting a fresh client claim.
        ...(verified.payload.summary?.attentionBaseline ? {
          attentionBaseline: verified.payload.summary.attentionBaseline,
        } : {}),
      },
      ...(surface ? { surface } : {}),
    };

    let consent;
    try {
      consent = await ProctoringConsent.findOneAndUpdate(
        { quiz: quiz._id, student: req.user._id, policyVersion: effective.version },
        { $set: consentDoc },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (upsertError) {
      // Concurrent first-time consents can race the unique index — converge.
      if (upsertError?.code === 11000 || upsertError?.codeName === 'DuplicateKey') {
        consent = await ProctoringConsent.findOneAndUpdate(
          { quiz: quiz._id, student: req.user._id, policyVersion: effective.version },
          { $set: consentDoc },
          { new: true }
        );
      } else {
        throw upsertError;
      }
    }

    logger.info('Proctoring consent recorded', {
      requestId: req.requestId,
      quizId: quiz._id,
      studentId: req.user._id,
      policyVersion: effective.version,
      policyHash: effective.hash,
    });

    return res.status(200).json({
      success: true,
      message: 'Consent recorded.',
      consent: {
        policyVersion: consent.policyVersion,
        policyHash: consent.policyHash,
        consentTextVersion: consent.consentTextVersion,
        grantedAt: consent.grantedAt,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error('Proctoring consent failed', {
      requestId: req.requestId,
      errorMessage: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: 'Server error',
      code: 'INTERNAL_ERROR',
      requestId: req.requestId,
    });
  }
});

module.exports = router;
