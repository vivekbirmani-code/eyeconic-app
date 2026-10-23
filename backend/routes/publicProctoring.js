// PUBLIC proctoring surface — public-quiz AI proctoring Phase 2 (2026-10-23).
//
// Mounted under /api/public alongside routes/public-quiz.js. Mirrors the
// registered-student surface (routes/proctoring.js + proctoringEvents.js)
// for OTP-verified leads taking PUBLIC quizzes:
//
//   POST /api/public/quiz/:shareToken/proctoring/precheck-report
//   POST /api/public/quiz/:shareToken/proctoring/consent
//   GET  /api/public/quiz/:shareToken/attempt/:attemptId/proctoring/session
//   GET  /api/public/quiz/:shareToken/attempt/:attemptId/proctoring/timeline
//   POST /api/public/quiz/:shareToken/attempt/:attemptId/proctoring/events
//        (the SAME ingest pipeline as registered attempts, through a guest
//         owner adapter — routes/proctoringEvents.js buildEventsRouter)
//
// Lifecycle guarantees mirror the registered surface exactly:
//   - precheck/consent NEVER create attempts or sessions; a failed precheck
//     consumes nothing (rate-limit bounded retries)
//   - consent is keyed {quiz, guest, policyVersion} and idempotent
//   - /start (in public-quiz.js) enforces consent + precheck token before
//     creating anything — gating cannot be bypassed by calling /start direct
//   - the shared rollout resolver (kill switch > flag > quiz opt-in) decides
//     whether ANY of this is active; gates off ⇒ public quizzes run
//     unproctored, exactly like registered ones (§31 semantics)
//
// Access rules: every attempt-scoped route resolves the attempt through the
// SAME ownership rule save-progress uses (verified lead OR the device key
// that created it) — one participant can never read or write another's
// session. The timeline here is the OWNER's own view (parity with the
// internal student card); admin review of guest attempts rides the admin
// routes (Phase 4).

const express = require('express');
const Quiz = require('../models/Quiz');
const GuestAttempt = require('../models/GuestAttempt');
const ProctoringConsent = require('../models/ProctoringConsent');
const ProctoringSession = require('../models/ProctoringSession');
const { guestAuth, optionalGuestAuth } = require('../middleware/guestAuth');
const {
  publicPrecheckRateLimit,
  publicProctoringEventsRateLimit,
} = require('../middleware/publicProctoringRateLimit');
const logger = require('../utils/logger');
const { findActivePublicQuiz, sendPublicQuizError } = require('../utils/publicQuizAccess');
const { emitToGuest } = require('../utils/socket-helpers');
const { buildEffectiveProctoringPolicy } = require('../utils/proctoring/policySnapshot');
const { resolveEligibilityForQuiz } = require('../utils/proctoring/rollout');
const { parsePrecheckReport, evaluatePrecheckReport } = require('../utils/proctoring/precheckReport');
const { issuePrecheckToken, verifyPrecheckToken } = require('../utils/proctoring/precheckToken');
const {
  ensureProctoringSession,
  shapeAttentionBaseline,
} = require('../utils/proctoring/session');
const { assembleProctoringTimeline } = require('../utils/proctoring/timeline');
const { buildEventsRouter } = require('./proctoringEvents');
const {
  gradeAndFinalizeGuestAttempt,
  enforceGuestAttemptDeadlines,
} = require('./public-quiz');

const router = express.Router();

const CONSENT_SURFACES = ['app-android', 'app-ios', 'web'];

/**
 * Shared preconditions for precheck/consent: the link is live, the quiz
 * exists, and proctoring is fully effective right now (kill switch > flag >
 * quiz opt-in — the SAME resolver /start and the internal surface use, so
 * the client can never see a precheck flow for a quiz /start would start
 * unproctored). Sends the error response itself and returns null on failure.
 */
const loadEligibleProctoredPublicQuiz = async (req, res) => {
  const { shareToken } = req.params;
  const access = await findActivePublicQuiz(shareToken, { select: 'title proctoring' });
  if (access.error) {
    sendPublicQuizError(res, access.error);
    return null;
  }
  const quiz = access.quiz;

  const eligibility = await resolveEligibilityForQuiz(quiz);
  if (!eligibility.enabled) {
    // Rollout gates off → the quiz behaves exactly like a non-proctored one
    // (full rollback, plan §31 — same responses as the internal surface).
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
 * POST /api/public/quiz/:shareToken/proctoring/precheck-report
 *
 * Same contract as the registered surface: the client reports observations,
 * the SERVER decides the verdict (utils/proctoring/precheckReport.js), and
 * only PASS issues the signed 30-minute precheck token bound to
 * {ownerId: guest._id, ownerKind: 'guest', quizId, policyHash}. Creates
 * nothing.
 */
router.post('/quiz/:shareToken/proctoring/precheck-report', guestAuth, publicPrecheckRateLimit, async (req, res) => {
  try {
    const loaded = await loadEligibleProctoredPublicQuiz(req, res);
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

    logger.info('Public proctoring precheck report', {
      requestId: req.requestId,
      quizId: quiz._id,
      guestId: req.guest._id,
      verdict: evaluation.verdict,
      reasons: evaluation.reasons.map((r) => r.reasonCode),
    });

    if (evaluation.verdict === 'UNSUPPORTED') {
      return res.status(403).json({
        success: false,
        verdict: 'UNSUPPORTED',
        message: evaluation.reasons[0]?.detail || 'This browser cannot run the monitoring this test requires.',
        code: 'DEVICE_BELOW_FLOOR',
        reasons: evaluation.reasons,
        accommodation: true,
        requestId: req.requestId,
      });
    }

    if (evaluation.verdict !== 'PASS') {
      return res.status(200).json({
        success: true,
        verdict: evaluation.verdict,
        message: evaluation.verdict === 'RETRYABLE'
          ? 'A readiness check could not complete. Please try again.'
          : 'One or more readiness checks did not pass. Follow the guidance and try again.',
        reasons: evaluation.reasons,
        requestId: req.requestId,
      });
    }

    const { token, expiresAt } = issuePrecheckToken({
      ownerId: req.guest._id,
      ownerKind: 'guest',
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
    logger.error('Public proctoring precheck report failed', {
      requestId: req.requestId, errorMessage: error?.message,
    });
    return res.status(500).json({
      success: false, message: 'Server error', code: 'INTERNAL_ERROR', requestId: req.requestId,
    });
  }
});

/**
 * POST /api/public/quiz/:shareToken/proctoring/consent
 *
 * Records the lead's consent against the verified precheck token and the
 * CURRENT policy hash. Idempotent upsert keyed {quiz, guest, policyVersion}.
 */
router.post('/quiz/:shareToken/proctoring/consent', guestAuth, async (req, res) => {
  try {
    const loaded = await loadEligibleProctoredPublicQuiz(req, res);
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
      ownerId: req.guest._id,
      ownerKind: 'guest',
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
      guest: req.guest._id,
      policyVersion: effective.version,
      policyHash: effective.hash,
      consentTextVersion,
      grantedAt: new Date(),
      precheckSummary: {
        deviceClass: verified.payload.summary?.deviceClass ?? null,
        networkProbe: {
          cameraBypassed: verified.payload.summary?.cameraBypassed === true,
        },
        ...(verified.payload.summary?.attentionBaseline ? {
          attentionBaseline: verified.payload.summary.attentionBaseline,
        } : {}),
      },
      ...(surface ? { surface } : {}),
    };

    let consent;
    try {
      consent = await ProctoringConsent.findOneAndUpdate(
        { quiz: quiz._id, guest: req.guest._id, policyVersion: effective.version },
        { $set: consentDoc },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (upsertError) {
      // Concurrent first-time consents can race the partial unique index —
      // converge (same doctrine as the registered surface).
      if (upsertError?.code === 11000 || upsertError?.codeName === 'DuplicateKey') {
        consent = await ProctoringConsent.findOneAndUpdate(
          { quiz: quiz._id, guest: req.guest._id, policyVersion: effective.version },
          { $set: consentDoc },
          { new: true }
        );
      } else {
        throw upsertError;
      }
    }

    logger.info('Public proctoring consent recorded', {
      requestId: req.requestId,
      quizId: quiz._id,
      guestId: req.guest._id,
      policyVersion: effective.version,
      policyHash: effective.hash,
    });

    return res.status(200).json({
      success: true,
      message: 'Consent recorded.',
      consent: {
        policyVersion: consent?.policyVersion,
        policyHash: consent?.policyHash,
        consentTextVersion: consent?.consentTextVersion,
        grantedAt: consent?.grantedAt,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error('Public proctoring consent failed', {
      requestId: req.requestId, errorMessage: error?.message,
    });
    return res.status(500).json({
      success: false, message: 'Server error', code: 'INTERNAL_ERROR', requestId: req.requestId,
    });
  }
});

/**
 * Ownership filter for attempt-scoped public proctoring routes — the
 * save-progress rule, made explicit about the no-device-key case:
 *   - with a verified lead: the lead's own attempts (any device), PLUS
 *     anonymous (guest:null) attempts of THIS device when the device key is
 *     actually supplied (POST bodies carry it). A GET carries no body, so a
 *     lead token alone must NEVER adopt an anonymous attempt — undefined
 *     keys would otherwise strip to a bare {guest:null} quiz-wide match
 *     (cross-participant leak).
 *   - without a lead: the device key alone owns the attempt (legacy flow).
 * Returns null when NO identity basis exists at all.
 */
const ownedGuestAttemptQuery = (attemptId, quizId, guestId, guest) => {
  const quizClause = quizId ? { quiz: quizId } : {};
  if (guest) {
    return typeof guestId === 'string' && guestId
      ? { _id: attemptId, ...quizClause, $or: [{ guest: guest._id }, { guestId, guest: null }] }
      : { _id: attemptId, ...quizClause, guest: guest._id };
  }
  if (typeof guestId !== 'string' || !guestId) return null;
  return { _id: attemptId, ...quizClause, guestId };
};

/**
 * Resolve the caller's OWNED guest attempt for the attempt-scoped routes.
 * Also quiz-scope-checks against the link's quiz when the link is still
 * live — a revoked/expired link does NOT strand an in-flight attempt's
 * monitoring (same grace the submit route gives answers); only ownership
 * decides then. Sends the error response itself and returns null on failure.
 */
const resolveOwnedGuestAttemptOr404 = async (req, res) => {
  const { shareToken, attemptId } = req.params;
  const { guestId } = req.body || {};

  const access = await findActivePublicQuiz(shareToken, { select: '_id' });
  const quiz = access.quiz || null;

  const filter = ownedGuestAttemptQuery(attemptId, quiz?._id, guestId, req.guest);
  const attempt = filter ? await GuestAttempt.findOne(filter) : null;
  if (!attempt || (quiz && String(attempt.quiz) !== String(quiz._id))) {
    res.status(404).json({
      success: false, message: 'Attempt not found', code: 'ATTEMPT_NOT_FOUND', requestId: req.requestId,
    });
    return null;
  }
  return attempt;
};

/**
 * GET /api/public/quiz/:shareToken/attempt/:attemptId/proctoring/session
 *
 * Session state for resume/resync — the guest mirror of the registered
 * surface: heartbeat params from the FROZEN policy, the frozen attention
 * baseline, and crash-window self-heal for in-progress attempts.
 */
router.get('/quiz/:shareToken/attempt/:attemptId/proctoring/session', optionalGuestAuth, async (req, res) => {
  try {
    const attempt = await resolveOwnedGuestAttemptOr404(req, res);
    if (!attempt) return;

    if (!attempt.proctoringSnapshot) {
      return res.status(400).json({
        success: false,
        message: 'Proctoring is not enabled for this quiz.',
        code: 'PROCTORING_NOT_ENABLED_FOR_QUIZ',
        requestId: req.requestId,
      });
    }

    let session = await ProctoringSession.findOne({ attempt: attempt._id, ownerKind: 'guest' });
    if (!session && attempt.status === 'in_progress') {
      session = await ensureProctoringSession(attempt, {
        policySnapshot: attempt.proctoringSnapshot,
        reason: 'resync_selfheal',
        ownerKind: 'guest',
      });
    }

    return res.status(200).json({
      success: true,
      session: session ? {
        id: session._id,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt || null,
        lastSeenAt: session.sessionHealth?.lastSeenAt || null,
        heartbeat: {
          intervalMs: session.sessionHealth?.heartbeatIntervalMs
            ?? attempt.proctoringSnapshot?.policy?.sessionHealth?.heartbeatIntervalMs
            ?? 30000,
          timeoutMs: session.sessionHealth?.timeoutMs
            ?? attempt.proctoringSnapshot?.policy?.sessionHealth?.timeoutMs
            ?? 90000,
        },
        policy: { version: session.policy?.version, hash: session.policy?.hash },
      } : null,
      policy: attempt.proctoringSnapshot?.policy || null,
      proctoringAttentionBaseline: session ? shapeAttentionBaseline(session) : null,
      attemptStatus: attempt.status,
      serverNow: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error('Public proctoring session fetch failed', {
      requestId: req.requestId, errorMessage: error?.message,
    });
    return res.status(500).json({
      success: false, message: 'Server error', code: 'INTERNAL_ERROR', requestId: req.requestId,
    });
  }
});

/**
 * GET /api/public/quiz/:shareToken/attempt/:attemptId/proctoring/timeline
 *
 * The OWNER's own monitoring story (transparency parity with the internal
 * student's result card). Same assembly as every timeline reader
 * (utils/proctoring/timeline.js). Admin/mentor review rides the admin
 * routes — this surface is owner-guest scoped only.
 */
router.get('/quiz/:shareToken/attempt/:attemptId/proctoring/timeline', optionalGuestAuth, async (req, res) => {
  try {
    const attempt = await resolveOwnedGuestAttemptOr404(req, res);
    if (!attempt) return;

    if (!attempt.proctoringSnapshot) {
      return res.status(400).json({
        success: false,
        message: 'Proctoring is not enabled for this quiz.',
        code: 'PROCTORING_NOT_ENABLED_FOR_QUIZ',
        requestId: req.requestId,
      });
    }

    const session = await ProctoringSession.findOne({ attempt: attempt._id, ownerKind: 'guest' });
    if (!session) {
      return res.status(200).json({
        success: true,
        timeline: null,
        attemptStatus: attempt.status,
        requestId: req.requestId,
      });
    }

    const timeline = await assembleProctoringTimeline(attempt, session);
    return res.status(200).json({
      success: true,
      timeline,
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error('Public proctoring timeline fetch failed', {
      requestId: req.requestId, errorMessage: error?.message,
    });
    return res.status(500).json({
      success: false, message: 'Server error', code: 'INTERNAL_ERROR', requestId: req.requestId,
    });
  }
});

// ===== Event ingest — the SAME pipeline as registered attempts =====
//
// The guest owner adapter supplies only the identity mechanics; everything
// between ownership and the response (validation → dedup → insert →
// heartbeat → rules → warnings → risk) is the shared buildEventsRouter code.

const guestEventOwner = {
  middleware: [optionalGuestAuth, publicProctoringEventsRateLimit],
  ownerId: (req) => (req.guest?._id ? req.guest._id : (req.body?.guestId || 'public-device')),
  resolveAttempt: async (req, attemptId) => {
    const { shareToken } = req.params;
    const { guestId } = req.body || {};
    // Link resolution for scope-checking only — a revoked/expired link does
    // not stop an in-flight attempt's monitoring (grace semantics).
    const access = await findActivePublicQuiz(shareToken, { select: '_id' });
    const quiz = access.quiz || null;
    const filter = ownedGuestAttemptQuery(attemptId, quiz?._id, guestId, req.guest);
    const attempt = filter ? await GuestAttempt.findOne(filter) : null;
    if (!attempt) return null;
    if (quiz && String(attempt.quiz) !== String(quiz._id)) return null;
    return attempt;
  },
  attemptStillActive: async (req, attempt) =>
    (await GuestAttempt.countDocuments({
      _id: attempt._id, guestId: attempt.guestId, status: 'in_progress',
    })) > 0,
  deliverWarning: (session, payload) => {
    // Live lane for OTP-verified leads (socket-helpers guest map). The
    // batch-response actions remain the always-on second channel.
    if (session?.guest) {
      emitToGuest(String(session.guest), 'proctoring_warning', payload);
    }
  },
};

// Lazy deadline enforcement for the events route: the shared orchestrator
// from public-quiz.js (min(duration, link expiry) + section cascade), shaped
// to the {attempt} contract the shared pipeline expects.
const guestEnforceDeadlines = async (attempt) => {
  const quiz = await Quiz.findById(attempt.quiz);
  if (!quiz) return { attempt };
  const result = await enforceGuestAttemptDeadlines(attempt, quiz, {});
  return { attempt: result.attempt };
};

// Policy auto-submit executor: the guest finalize path (store-then-grade
// CAS), shaped to the {ok, attempt} contract the shared pipeline reports.
const guestMakePolicySubmitter = () => async (attempt, { autoSubmitReason } = {}) => {
  const finalized = await gradeAndFinalizeGuestAttempt(attempt, {
    isAutoSubmit: true,
    autoSubmitReason: { kind: 'policy', ...(autoSubmitReason || {}) },
  });
  const ok = !!finalized && finalized.status !== 'in_progress';
  return { ok, kind: ok ? 'finalized' : 'already_submitted', attempt: finalized };
};

router.use(
  '/quiz/:shareToken/attempt/:attemptId/proctoring',
  buildEventsRouter({
    owner: guestEventOwner,
    enforceDeadlines: guestEnforceDeadlines,
    makePolicySubmitter: guestMakePolicySubmitter,
  })
);

module.exports = router;
