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

// ===== Phase 7 (§25.4/§26.5) — accommodation overrides, admin CRUD =====
//
// Accessibility accommodations (e.g. attention observations disabled or
// thresholds relaxed for a student). ADMIN ONLY. Stored overrides are
// interpreted by a STRICT WHITELIST at /start snapshot-freeze time (see
// utils/proctoring/policySnapshot.js applyProctoringOverrides) — unlisted
// reasonCodes store but never apply (fail-closed). Expiry is honored at
// application time, not by background deletion (rows are small + auditable).
const ProctoringOverride = require('../models/ProctoringOverride');
const User = require('../models/User');

const OVERRIDE_REASONS = ['attention_disabled', 'relaxed_thresholds'];

// Malformed ids must fail as 400/404, never as a CastError 500.
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

const overridesRouter = require('express').Router();

overridesRouter.use(auth, authorize('admin'));

// List: all overrides, or one student's (?studentId=), newest first.
overridesRouter.get('/', async (req, res) => {
  try {
    const query = {};
    if (req.query.studentId) {
      if (!OBJECT_ID_PATTERN.test(String(req.query.studentId))) {
        return res.status(400).json({
          success: false, message: 'studentId must be a valid id.',
          code: 'VALIDATION_ERROR', requestId: req.requestId,
        });
      }
      query.student = req.query.studentId;
    }
    const overrides = await ProctoringOverride.find(query)
      .populate('student', 'name email')
      .populate('grantedBy', 'name email')
      .populate('quiz', 'title')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return res.status(200).json({ success: true, overrides, requestId: req.requestId });
  } catch (error) {
    logger.error('Proctoring overrides list failed', {
      requestId: req.requestId, errorMessage: error?.message,
    });
    return res.status(500).json({
      success: false, message: 'Server error', code: 'INTERNAL_ERROR', requestId: req.requestId,
    });
  }
});

// Create. Body: { studentId, quizId?, reasonCode, overrides?, expiresAt? }.
overridesRouter.post('/', async (req, res) => {
  try {
    const { studentId, quizId, reasonCode, overrides, expiresAt } = req.body || {};
    if (!studentId || !String(studentId).match(/^[0-9a-fA-F]{12,32}$/)) {
      return res.status(400).json({
        success: false, message: 'studentId is required.',
        code: 'VALIDATION_ERROR', requestId: req.requestId,
      });
    }
    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(404).json({
        success: false, message: 'Student not found.',
        code: 'STUDENT_NOT_FOUND', requestId: req.requestId,
      });
    }
    if (!OVERRIDE_REASONS.includes(reasonCode)) {
      return res.status(400).json({
        success: false,
        message: `reasonCode must be one of ${OVERRIDE_REASONS.join('|')}.`,
        code: 'VALIDATION_ERROR', requestId: req.requestId,
      });
    }
    // A quiz-scoped override must reference a real quiz — anything malformed
    // or unknown stores inert, so refuse it loudly instead.
    if (quizId !== undefined && quizId !== null && quizId !== '') {
      if (!OBJECT_ID_PATTERN.test(String(quizId))) {
        return res.status(400).json({
          success: false, message: 'quizId must be a valid id.',
          code: 'VALIDATION_ERROR', requestId: req.requestId,
        });
      }
      const scopedQuiz = await Quiz.findById(quizId).select('_id').lean();
      if (!scopedQuiz) {
        return res.status(404).json({
          success: false, message: 'Quiz not found.',
          code: 'QUIZ_NOT_FOUND', requestId: req.requestId,
        });
      }
    }
    if (overrides !== undefined && overrides !== null && typeof overrides !== 'object') {
      return res.status(400).json({
        success: false, message: 'overrides must be an object.',
        code: 'VALIDATION_ERROR', requestId: req.requestId,
      });
    }
    let expiry = null;
    if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
      expiry = new Date(expiresAt);
      if (Number.isNaN(expiry.getTime())) {
        return res.status(400).json({
          success: false, message: 'expiresAt must be a parseable date.',
          code: 'VALIDATION_ERROR', requestId: req.requestId,
        });
      }
    }
    const created = await ProctoringOverride.create({
      student: student._id,
      ...(quizId ? { quiz: quizId } : {}),
      reasonCode,
      grantedBy: req.user._id,
      ...(expiry ? { expiresAt: expiry } : {}),
      ...(overrides ? { overrides } : {}),
    });
    logger.info('Proctoring override granted', {
      requestId: req.requestId,
      overrideId: created._id,
      studentId: student._id,
      reasonCode,
    });
    return res.status(201).json({ success: true, override: created, requestId: req.requestId });
  } catch (error) {
    logger.error('Proctoring override create failed', {
      requestId: req.requestId, errorMessage: error?.message,
    });
    return res.status(500).json({
      success: false, message: 'Server error', code: 'INTERNAL_ERROR', requestId: req.requestId,
    });
  }
});

// Revoke (hard delete — the doc is small and the audit trail lives in logs;
// history of revoked accommodations is not a §25.4 requirement).
overridesRouter.delete('/:overrideId', async (req, res) => {
  try {
    if (!OBJECT_ID_PATTERN.test(String(req.params.overrideId || ''))) {
      return res.status(404).json({
        success: false, message: 'Override not found.',
        code: 'OVERRIDE_NOT_FOUND', requestId: req.requestId,
      });
    }
    const deleted = await ProctoringOverride.findByIdAndDelete(req.params.overrideId);
    if (!deleted) {
      return res.status(404).json({
        success: false, message: 'Override not found.',
        code: 'OVERRIDE_NOT_FOUND', requestId: req.requestId,
      });
    }
    logger.info('Proctoring override revoked', {
      requestId: req.requestId, overrideId: deleted._id,
    });
    return res.status(200).json({ success: true, requestId: req.requestId });
  } catch (error) {
    logger.error('Proctoring override delete failed', {
      requestId: req.requestId, errorMessage: error?.message,
    });
    return res.status(500).json({
      success: false, message: 'Server error', code: 'INTERNAL_ERROR', requestId: req.requestId,
    });
  }
});

module.exports = router;
module.exports.overridesRouter = overridesRouter;
module.exports.OVERRIDE_REASONS = OVERRIDE_REASONS;

// ===== Phase 8 (§30.2, WS-A) — observability metrics digest, admin only =====
//
// On-demand window aggregation of the nine §30.2 monitoring-quality
// dimensions (utils/proctoring/metricsDigest.js). Every dimension renders an
// honest verdict — measured / partial / not captured — including at zero
// data; that IS the AC-5 property. The daily-email half of this feature is
// dormant server-side machinery (server.js interval) until
// PROCTORING_DIGEST_RECIPIENTS is configured; this endpoint needs no flag.
const { buildProctoringMetricsDigest } = require('../utils/proctoring/metricsDigest');

const digestRouter = require('express').Router();

digestRouter.use(auth, authorize('admin'));

// GET /api/quizzes/proctoring-metrics/digest?days=N (default 1, clamp 1–30):
// window = [startOfDay(now − (days−1) days), now].
digestRouter.get('/digest', async (req, res) => {
  try {
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 1));
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const digest = await buildProctoringMetricsDigest({ from: start, to: now });
    return res.status(200).json({ success: true, digest, requestId: req.requestId });
  } catch (error) {
    logger.error('Proctoring metrics digest failed', {
      requestId: req.requestId, errorMessage: error?.message,
    });
    return res.status(500).json({
      success: false, message: 'Server error', code: 'INTERNAL_ERROR', requestId: req.requestId,
    });
  }
});

module.exports.digestRouter = digestRouter;
