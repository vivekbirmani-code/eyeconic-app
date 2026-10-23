// Proctoring event transport — Phase 3 (plan §16, §17, §27.2).
//
// Two attempt-scoped routers, mounted by routes/quizzes.js:
//   eventsRouter  → POST /api/quizzes/:id/attempt/:attemptId/proctoring/events
//   sessionRouter → GET  /api/quizzes/attempt/:attemptId/proctoring/session
//
// Server-authority contract (plan §24):
//   - Clients submit episode observations ONLY. serverAt, severity, category,
//     durationMs, detectorTier and all ownership fields are computed here —
//     forged server-owned fields are stripped by eventValidation.js before
//     anything is persisted.
//   - Ownership is embedded in every query ({_id, student}); the client-echoed
//     sessionId must match the derived session (1:1 with the attempt), so one
//     student can never write into another student's session and one attempt
//     can never reference a foreign session.
//   - Duplicate batches are no-ops (idempotency keys, §7.3); out-of-order and
//     delayed batches are ACCEPTED — events are ordered by serverAt, never by
//     arrival.
//   - Events on finalized attempts are rejected SESSION_NOT_ACTIVE; the counts
//     are logged as post-close telemetry (audit), never stored as events.
//   - Floods are accepted-but-flagged (session.integrity.floodFlagged), never
//     silently dropped.
//
// Exported as a factory because the lazy §7.5 duration finalizer wraps
// finalizeQuizAttempt, which lives in the quizzes.js closure.

const express = require('express');
const QuizAttempt = require('../models/QuizAttempt');
const ProctoringSession = require('../models/ProctoringSession');
const ProctoringEvent = require('../models/ProctoringEvent');
const ProctoringViolation = require('../models/ProctoringViolation');
const MentorStudentAssignment = require('../models/MentorStudentAssignment');
const { auth, authorize } = require('../middleware/auth');
const { proctoringEventsRateLimit } = require('../middleware/proctoringRateLimit');
const logger = require('../utils/logger');
const { emitToUser } = require('../utils/socket-helpers');
const Quiz = require('../models/Quiz');
const { validateEventPayload } = require('../utils/proctoring/eventValidation');
const {
  parseEventBatchEnvelope,
  buildEventRecord,
  computeFloodOutcome,
} = require('../utils/proctoring/eventIngest');
const { evaluatePolicy } = require('../utils/proctoring/rulesEngine');
const {
  buildEventTypeAggregatePipeline,
  computeRiskScore,
} = require('../utils/proctoring/riskScore');
const { assembleProctoringTimeline } = require('../utils/proctoring/timeline');
const { ensureProctoringSession, shapeAttentionBaseline } = require('../utils/proctoring/session');
const {
  computeHeartbeatGap,
  buildGapEventRecord,
  buildGapTransitions,
} = require('../utils/proctoring/sessionHealth');

const CLOSED_STATUSES = ['CLOSED', 'CLOSED_FAILED'];

// Mirrors the ProctoringSession deterrence enum — the only values a client's
// SESSION_STARTED/RESUMED metadata may stamp (set-once, review context only).
const DETERRENCE_VALUES = ['android-flagsecure', 'ios-detect-only', 'unsupported', 'disabled'];

/**
 * Owner adapter — the per-surface seam of the event ingest. Everything the
 * pipeline does between ownership resolution and the response is
 * owner-agnostic (validation, dedup, insert, heartbeat, rules, risk); the
 * adapter supplies only the identity mechanics:
 *   middleware         — auth chain for the route (registered: user JWT;
 *                        public: guest token + ownership)
 *   ownerId(req)       — identity for structured logs
 *   resolveAttempt     — ownership-checked attempt lookup that ALSO verifies
 *                        the attempt belongs to this route's quiz scope
 *                        (registered: the :id path param; public: the
 *                        shareToken-resolved quiz). Returns null for any
 *                        miss — the route answers a bare 404 so a probing
 *                        client learns nothing.
 *   attemptStillActive — re-check right before a policy auto-submit (racing-
 *                        finalize guard), same ownership rule
 *   deliverWarning     — the live channel for warnings (socket lane)
 *
 * This default adapter is the registered-student behavior the route had
 * before the seam existed; public-quiz proctoring adds a guest adapter
 * (routes/publicProctoring.js) that reuses the identical pipeline through it.
 */
const registeredEventOwner = {
  middleware: [auth, authorize('student'), proctoringEventsRateLimit],
  ownerId: (req) => req.user._id,
  resolveAttempt: async (req, attemptId, quizIdParam) => {
    const attempt = await QuizAttempt.findOne({ _id: attemptId, student: req.user._id });
    if (!attempt) return null;
    // The attempt exists but belongs to a different quiz — a confused or
    // probing client. Do not leak its existence.
    if (String(attempt.quiz) !== String(quizIdParam)) return null;
    return attempt;
  },
  attemptStillActive: async (req, attempt) =>
    (await QuizAttempt.countDocuments({
      _id: attempt._id, student: req.user._id, status: 'in_progress',
    })) > 0,
  deliverWarning: (session, payload) => {
    emitToUser(String(session.student), 'proctoring_warning', payload);
  },
};

/**
 * POST /events — batched, idempotent episode ingest (+ heartbeat piggyback).
 *
 * Order of enforcement mirrors the other attempt-touching routes:
 * ownership → lazy §7.5 duration finalize → attempt/session state → envelope
 * and per-event validation → dedup → insert → session health bookkeeping.
 */
const buildEventsRouter = ({ makeFinalizer, makePolicySubmitter, enforceDeadlines, owner = registeredEventOwner }) => {
  const router = express.Router({ mergeParams: true });

  router.post('/events', ...owner.middleware, async (req, res) => {
    const { id: quizIdParam, attemptId } = req.params;
    try {
      // Ownership + quiz-scope resolution lives in the adapter (see
      // registeredEventOwner) — a null answer is a bare 404, no information.
      let attempt = await owner.resolveAttempt(req, attemptId, quizIdParam);
      if (!attempt) {
        return res.status(404).json({
          success: false, message: 'Attempt not found', code: 'ATTEMPT_NOT_FOUND', requestId: req.requestId,
        });
      }

      // Lazy duration + quiz-window enforcement FIRST (plan §27.2): a
      // past-deadline attempt — individual duration, the section cascade, or
      // the quiz's availability window, whichever closed first — is finalized
      // through the same CAS path as every other finalize, then this batch is
      // rejected: the session the events belong to is closed.
      // enforceDeadlines is the shared orchestrator injected by quizzes.js
      // (same one every quiz route uses; injected to avoid a require cycle).
      if (attempt.status === 'in_progress' && typeof enforceDeadlines === 'function') {
        const quizForWindow = await Quiz.findById(attempt.quiz).select('expiryDate');
        if (quizForWindow) {
          attempt = (await enforceDeadlines(attempt, quizForWindow, { req })).attempt || attempt;
        }
      }

      if (attempt.status !== 'in_progress') {
        // Post-close telemetry (plan §7.5): count + structured log only. The
        // payload itself is never stored — a hostile client must not be able
        // to append rows to a closed session.
        await ProctoringSession.updateOne(
          { attempt: attempt._id, status: { $in: CLOSED_STATUSES } },
          { $inc: { 'integrity.batchesRejected': 1 } }
        ).exec();
        logger.warn('Proctoring batch rejected — session not active', {
          requestId: req.requestId,
          attemptId: attempt._id,
          ownerId: String(owner.ownerId(req)),
          attemptStatus: attempt.status,
        });
        return res.status(409).json({
          success: false,
          message: 'This test has ended; monitoring events are no longer accepted.',
          code: 'SESSION_NOT_ACTIVE',
          attemptFinalized: true,
          requestId: req.requestId,
        });
      }

      if (!attempt.proctoringSnapshot) {
        // Legacy/non-proctored attempt — there is no session to write to.
        return res.status(400).json({
          success: false,
          message: 'Proctoring is not enabled for this quiz.',
          code: 'PROCTORING_NOT_ENABLED_FOR_QUIZ',
          requestId: req.requestId,
        });
      }

      // Crash-window self-heal (plan §7.2): a snapshot-carrying attempt always
      // has a session by the time events flow.
      const session = await ensureProctoringSession(attempt, {
        policySnapshot: attempt.proctoringSnapshot,
        reason: 'events_selfheal',
      });
      if (!session) {
        return res.status(503).json({
          success: false, message: 'Server error', code: 'INTERNAL_ERROR', requestId: req.requestId,
        });
      }
      if (CLOSED_STATUSES.includes(session.status)) {
        await ProctoringSession.updateOne(
          { _id: session._id },
          { $inc: { 'integrity.batchesRejected': 1 } }
        ).exec();
        logger.warn('Proctoring batch rejected — closed session', {
          requestId: req.requestId,
          sessionId: session._id,
          ownerId: String(owner.ownerId(req)),
        });
        return res.status(409).json({
          success: false,
          message: 'This test has ended; monitoring events are no longer accepted.',
          code: 'SESSION_NOT_ACTIVE',
          requestId: req.requestId,
        });
      }

      const envelope = parseEventBatchEnvelope(req.body);
      if (!envelope.valid) {
        return res.status(400).json({
          success: false, message: envelope.error, code: 'VALIDATION_ERROR', requestId: req.requestId,
        });
      }

      // The client-echoed session id must match the derived session (§24.3:
      // one attempt must never reference another session).
      if (envelope.value.sessionId
        && envelope.value.sessionId !== String(session._id)) {
        return res.status(403).json({
          success: false,
          message: 'Monitoring session mismatch.',
          code: 'SESSION_MISMATCH',
          requestId: req.requestId,
        });
      }

      // Per-event validation (Phase 1 sanitizer): strips server-owned fields,
      // enforces the registry, reliability/confidence rules and interval
      // plausibility. One malformed event rejects the whole batch — the client
      // treats 400 as permanent and drops it (a malformed event is a bug or a
      // probe, never data to salvage).
      const now = new Date();
      const validated = [];
      for (let i = 0; i < envelope.value.events.length; i += 1) {
        const result = validateEventPayload(envelope.value.events[i], {
          now, requireIdempotencyKey: true,
        });
        if (!result.valid) {
          logger.warn('Proctoring batch rejected — invalid event', {
            requestId: req.requestId,
            sessionId: session._id,
            index: i,
            type: envelope.value.events[i]?.type,
            errors: result.errors,
            strippedFields: result.strippedFields,
          });
          await ProctoringSession.updateOne(
            { _id: session._id },
            { $inc: { 'integrity.batchesRejected': 1 } }
          ).exec();
          return res.status(400).json({
            success: false,
            message: `Invalid event at index ${i}: ${result.errors[0]}`,
            code: 'VALIDATION_ERROR',
            errors: result.errors,
            ...(result.strippedFields.length ? { strippedFields: result.strippedFields } : {}),
            requestId: req.requestId,
          });
        }
        validated.push({ raw: envelope.value.events[i], value: result.value });
      }

      // Deduplication (§7.3): replays return duplicate:true and never re-count.
      const keys = validated.map((v) => v.value.idempotencyKey);
      const existing = keys.length
        ? await ProctoringEvent.find({ session: session._id, idempotencyKey: { $in: keys } })
          .select('idempotencyKey').lean()
        : [];
      const existingKeys = new Set(existing.map((e) => e.idempotencyKey));
      const fresh = validated.filter((v) => !existingKeys.has(v.value.idempotencyKey));

      let inserted = [];
      if (fresh.length) {
        const records = fresh.map((v) => buildEventRecord(v.value, {
          type: v.value.type, session, attempt, quizId: attempt.quiz, now,
        }));
        try {
          inserted = await ProctoringEvent.insertMany(records, { ordered: false });
        } catch (insertError) {
          // E11000: a concurrent retry inserted some keys first — those are
          // duplicates by definition; everything else must surface loudly.
          if (insertError?.code === 11000 || insertError?.codeName === 'DuplicateKey') {
            const written = await ProctoringEvent.find({
              session: session._id, idempotencyKey: { $in: keys },
            }).select('idempotencyKey').lean();
            const writtenKeys = new Set(written.map((e) => e.idempotencyKey));
            inserted = records.filter((r) => writtenKeys.has(r.idempotencyKey));
          } else {
            throw insertError;
          }
        }
      }

      const acceptedCount = inserted.length;
      const duplicateKeys = keys.filter((k) => !inserted.some((r) => r.idempotencyKey === k));

      // Session health bookkeeping: heartbeat (any accepted batch proves the
      // client is alive — plan §16.2), denormalized event counts, flood flag.
      //
      // Phase 4 — heartbeat gap (§16.2, lazy doctrine): compute the gap from
      // the PRE-UPDATE lastSeenAt BEFORE this contact moves it forward. The
      // frozen timeout is the line between a temporary transport gap and
      // session degradation; with onProlongedOutage 'record' (the only V1
      // policy) a gap is RECORDED — episode + DEGRADED→ACTIVE transition pair
      // + unmonitored-interval marker — never acted on.
      const gap = computeHeartbeatGap({
        lastSeenAt: session.sessionHealth?.lastSeenAt ?? null,
        timeoutMs: session.sessionHealth?.timeoutMs
          ?? attempt.proctoringSnapshot?.policy?.sessionHealth?.timeoutMs,
        now,
        sessionId: String(session._id),
      });
      let gapRecorded = false;
      let gapInserted = [];
      if (gap) {
        const gapRecord = buildGapEventRecord({ gap, session, attempt, quizId: attempt.quiz });
        try {
          gapInserted = await ProctoringEvent.insertMany([gapRecord], { ordered: false });
          gapRecorded = gapInserted.length > 0;
          logger.info('Proctoring heartbeat gap recorded', {
            requestId: req.requestId,
            sessionId: session._id,
            durationMs: gap.durationMs,
            timeoutMs: gap.timeoutMs,
          });
        } catch (gapError) {
          // E11000: a concurrent batch already recorded this same gap (the
          // deterministic key collided) — IT owns the transitions; this
          // request only refreshes lastSeenAt. Anything else surfaces loudly.
          if (gapError?.code !== 11000 && gapError?.codeName !== 'DuplicateKey') {
            throw gapError;
          }
        }
      }

      const storedCount = await ProctoringEvent.countDocuments({ session: session._id });
      const { floodFlagged } = computeFloodOutcome(storedCount - acceptedCount, acceptedCount);
      const policy = attempt.proctoringSnapshot?.policy || {};
      const countInc = {};
      for (const record of inserted) {
        countInc[`eventCounts.${record.type}`] = (countInc[`eventCounts.${record.type}`] || 0) + 1;
      }
      if (gapRecorded) {
        countInc['eventCounts.HEARTBEAT_GAP'] = (countInc['eventCounts.HEARTBEAT_GAP'] || 0) + 1;
      }

      // One merged $inc / $push per operator (duplicate operator paths in a
      // single update would collide): the gap's counters and transition pair
      // ride the same update as the event counts.
      const incOps = { ...countInc };
      const pushOps = {};
      if (gapRecorded) {
        incOps['sessionHealth.missedIntervals'] = (incOps['sessionHealth.missedIntervals'] || 0) + 1;
        incOps['integrity.heartbeatsMissed'] = (incOps['integrity.heartbeatsMissed'] || 0) + 1;
        pushOps.transitions = { $each: buildGapTransitions(gap) };
        pushOps['integrity.unmonitoredIntervals'] = {
          from: gap.openedAt, to: gap.closedAt, cause: 'heartbeat_gap',
        };
      }

      // Deterrence stamping (§15.2): SESSION_STARTED/RESUMED may carry the
      // client's honest report of which prevention was applied. Set-once,
      // review context only — never policy, never client-assertable state.
      let deterrenceApplied = null;
      if (!session.deterrence?.screenCapturePrevention) {
        for (const record of inserted) {
          if ((record.type === 'SESSION_STARTED' || record.type === 'SESSION_RESUMED')
            && DETERRENCE_VALUES.includes(record.metadata?.screenCapturePrevention)) {
            deterrenceApplied = record.metadata.screenCapturePrevention;
            break;
          }
        }
      }

      await ProctoringSession.updateOne(
        { _id: session._id },
        {
          $set: {
            'sessionHealth.lastSeenAt': now,
            // Set-once heartbeat parameters from the FROZEN policy (never the
            // mutable quiz config — in-flight attempts keep their snapshot).
            ...(session.sessionHealth?.heartbeatIntervalMs ? {} : {
              'sessionHealth.heartbeatIntervalMs': policy.sessionHealth?.heartbeatIntervalMs ?? 30000,
              'sessionHealth.timeoutMs': policy.sessionHealth?.timeoutMs ?? 90000,
            }),
            ...(floodFlagged ? { 'integrity.floodFlagged': true } : {}),
            ...(deterrenceApplied ? { 'deterrence.screenCapturePrevention': deterrenceApplied } : {}),
          },
          ...(Object.keys(incOps).length ? { $inc: incOps } : {}),
          ...(Object.keys(pushOps).length ? { $push: pushOps } : {}),
        }
      ).exec();

      if (floodFlagged && !session.integrity?.floodFlagged) {
        logger.warn('Proctoring session flood-flagged', {
          requestId: req.requestId, sessionId: session._id, storedCount,
        });
      }
      if (envelope.value.bufferOverflow > 0) {
        // Honest client report of locally dropped episodes (plan §23) — logged
        // for delivery-reliability metrics, never stored as events.
        logger.warn('Proctoring client buffer overflow reported', {
          requestId: req.requestId, sessionId: session._id, dropped: envelope.value.bufferOverflow,
        });
      }
      logger.info('Proctoring events ingested', {
        requestId: req.requestId,
        sessionId: session._id,
        accepted: acceptedCount,
        duplicates: duplicateKeys.length,
        heartbeat: envelope.value.heartbeat,
      });

      // ===== Phase 6 — rules engine evaluation (plan §18, §20) =====
      //
      // Bounded scope: THIS batch's fresh events (incl. a recorded gap) + the
      // persisted violation set — never a full-session replay per batch.
      // Duplicate-only batches skip evaluation entirely (no fresh events →
      // nothing to re-count; replays can never re-warn or re-submit).
      const responseActions = [];
      let submittedOutcome = null;
      const freshForEvaluation = [...inserted, ...gapInserted];
      if (freshForEvaluation.length) {
        const persistedViolations = await ProctoringViolation
          .find({ session: session._id }).select('ruleId').lean();

        const evaluation = evaluatePolicy({
          policy,
          newEvents: freshForEvaluation,
          persistedViolations,
          sessionId: String(session._id),
          now,
        });

        // --- persist new violations (deterministic derivationKey upsert;
        // a racing batch that wrote one first simply owns it) ---
        if (evaluation.newViolations.length) {
          const violationRecords = evaluation.newViolations.map((v) => ({
            session: session._id,
            attempt: attempt._id,
            quiz: attempt.quiz,
            ruleId: v.ruleId,
            derivationKey: v.derivationKey,
            eventRefs: v.eventRefs,
            reliability: v.reliability,
            countedAt: v.countedAt,
            ...(v.action
              ? {
                actionTaken: {
                  action: v.action,
                  at: now,
                  // SUBMIT delivery is the finalize itself, not a banner.
                  deliveredToStudent: v.action !== 'SUBMIT',
                },
              }
              : {}),
          }));
          try {
            await ProctoringViolation.insertMany(violationRecords, { ordered: false });
          } catch (violationError) {
            if (violationError?.code !== 11000 && violationError?.codeName !== 'DuplicateKey') {
              throw violationError;
            }
          }
          // Stamp the policy outcome onto the triggering episode events.
          for (const v of evaluation.newViolations) {
            if (!v.action) continue;
            await ProctoringEvent.updateOne(
              { _id: v.eventRefs[0] },
              {
                $set: {
                  actionTaken: {
                    action: v.action, ruleId: v.ruleId, at: now, deliveredToStudent: true,
                  },
                },
              }
            ).exec();
          }
        }

        // --- deliver warnings: WARNING_DELIVERED system event (deterministic
        // key collapses concurrent/racing deliveries) + response actions +
        // socket nudge for instant banner delivery (offline students get the
        // queued warning on their next successful batch, §20.2) ---
        for (const action of evaluation.actions) {
          const warnRecord = buildEventRecord(
            {
              source: 'system',
              openedAt: now,
              closedAt: now,
              metadata: {
                kind: action.kind,
                code: action.code,
                ruleId: action.ruleId,
                ...(action.eventRef ? { eventRef: String(action.eventRef) } : {}),
              },
              idempotencyKey: action.warnId,
            },
            { type: 'WARNING_DELIVERED', session, attempt, quizId: attempt.quiz, now }
          );
          try {
            await ProctoringEvent.insertMany([warnRecord], { ordered: false });
          } catch (warnError) {
            if (warnError?.code !== 11000 && warnError?.codeName !== 'DuplicateKey') {
              throw warnError;
            }
          }
          try {
            owner.deliverWarning(session, {
              warnId: action.warnId,
              kind: action.kind,
              code: action.code,
              quizId: String(attempt.quiz),
              attemptId: String(attempt._id),
            });
          } catch (emitError) {
            logger.warn('Proctoring warning socket nudge failed', {
              requestId: req.requestId, warnId: action.warnId,
              errorMessage: emitError?.message,
            });
          }
          responseActions.push({
            kind: action.kind,
            code: action.code,
            warnId: action.warnId,
            ruleId: action.ruleId,
          });
        }

        // --- policy auto-submit (§20.3/§20.6): decision event FIRST (so the
        // close-time summary includes it), then the SAME finalize path as
        // manual/duration submits. CAS downstream makes a racing manual
        // submit converge to exactly one winner. ---
        if (evaluation.submit) {
          const attemptStillActive = attempt.status === 'in_progress'
            && (await owner.attemptStillActive(req, attempt));
          if (attemptStillActive && !CLOSED_STATUSES.includes(session.status)) {
            const autoRecord = buildEventRecord(
              {
                source: 'system',
                openedAt: now,
                closedAt: now,
                metadata: {
                  ruleId: evaluation.submit.ruleId,
                  autoSubmitReason: evaluation.submit.autoSubmitReason,
                },
                idempotencyKey: `autosubmit:${attempt._id}`,
              },
              { type: 'AUTO_SUBMITTED', session, attempt, quizId: attempt.quiz, now }
            );
            try {
              await ProctoringEvent.insertMany([autoRecord], { ordered: false });
            } catch (autoError) {
              if (autoError?.code !== 11000 && autoError?.codeName !== 'DuplicateKey') {
                throw autoError;
              }
            }
            const submitResult = await makePolicySubmitter(req)(attempt, {
              autoSubmitReason: evaluation.submit.autoSubmitReason,
            });
            submittedOutcome = submitResult;
            logger.warn('Proctoring policy auto-submit executed', {
              requestId: req.requestId,
              sessionId: session._id,
              attemptId: attempt._id,
              ruleId: evaluation.submit.ruleId,
              finalizeKind: submitResult?.kind,
            });
          } else {
            // A straggler batch racing a finalize must never warn/submit into
            // a closed session (validator finding) — record the skip.
            logger.info('Proctoring policy submit skipped — attempt/session no longer active', {
              requestId: req.requestId,
              sessionId: session._id,
              attemptStatus: attempt.status,
              sessionStatus: session.status,
            });
          }
        }

        // --- recompute + persist risk (replayable derivation, §19.1) ---
        try {
          const [typeAggregates, violationsAfter] = await Promise.all([
            ProctoringEvent.aggregate(buildEventTypeAggregatePipeline(session._id)),
            ProctoringViolation.find({ session: session._id }).select('ruleId').lean(),
          ]);
          const risk = computeRiskScore({ policy, typeAggregates, violations: violationsAfter });
          await ProctoringSession.updateOne(
            { _id: session._id },
            {
              $set: {
                riskScore: risk.riskScore,
                riskCategory: risk.riskCategory,
                riskBreakdown: risk.riskBreakdown,
                violationsCount: violationsAfter.length,
              },
            }
          ).exec();
        } catch (riskError) {
          // Risk is review context, never enforcement state — a scoring
          // failure must not fail the batch.
          logger.error('Proctoring risk recompute failed', {
            requestId: req.requestId, sessionId: session._id,
            errorMessage: riskError?.message,
          });
        }
      }

      // Post-submit session state (the finalize's close hook may have closed
      // the session and frozen the summary while this response was building).
      let sessionForResponse = session;
      if (submittedOutcome?.ok) {
        sessionForResponse = await ProctoringSession.findById(session._id)
          .select('status riskCategory') || session;
      }

      return res.status(200).json({
        success: true,
        message: 'Monitoring events accepted.',
        accepted: acceptedCount,
        duplicates: duplicateKeys,
        ...(floodFlagged ? { floodFlagged: true } : {}),
        ...(responseActions.length ? { actions: responseActions } : {}),
        ...(sessionForResponse.riskCategory ? { riskCategory: sessionForResponse.riskCategory } : {}),
        ...(submittedOutcome?.ok ? { attemptFinalized: true, autoSubmitted: true } : {}),
        serverNow: now.toISOString(),
        session: { id: session._id, status: sessionForResponse.status },
        requestId: req.requestId,
      });
    } catch (error) {
      logger.error('Proctoring events ingest failed', {
        requestId: req.requestId, errorMessage: error?.message,
      });
      return res.status(500).json({
        success: false, message: 'Server error', code: 'INTERNAL_ERROR', requestId: req.requestId,
      });
    }
  });

  return router;
};

/**
 * Attempt-scoped read access (the GET /attempt/:id rule, D14): owner student,
 * admin, or a mentor actively assigned to the student. Shared by the session
 * resync and the timeline reads so the two can never disagree.
 */
const assertAttemptReadAccess = async (req, attempt) => {
  const isOwner = String(attempt.student) === String(req.user._id);
  const isAdmin = req.user.role === 'admin';
  if (isOwner || isAdmin) return true;
  if (req.user.role === 'mentor') {
    return Boolean(await MentorStudentAssignment.findOne({
      mentor: req.user._id, student: attempt.student, isActive: true,
    }));
  }
  return false;
};

/**
 * GET /session — session state for resume/resync (plan §27.2), used by the
 * taking screen to re-arm the engine after refresh / app restart.
 */
const buildSessionRouter = () => {
  const router = express.Router({ mergeParams: true });

  router.get('/session', auth, async (req, res) => {
    const { attemptId } = req.params;
    try {
      const attempt = await QuizAttempt.findById(attemptId);
      if (!attempt) {
        return res.status(404).json({
          success: false, message: 'Attempt not found', code: 'ATTEMPT_NOT_FOUND', requestId: req.requestId,
        });
      }

      if (!(await assertAttemptReadAccess(req, attempt))) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to view this session',
          code: 'FORBIDDEN',
          requestId: req.requestId,
        });
      }

      if (!attempt.proctoringSnapshot) {
        return res.status(400).json({
          success: false,
          message: 'Proctoring is not enabled for this quiz.',
          code: 'PROCTORING_NOT_ENABLED_FOR_QUIZ',
          requestId: req.requestId,
        });
      }

      // Self-heal the crash window for in-flight attempts only; finalized
      // attempts keep whatever session state the finalize hook left.
      let session = await ProctoringSession.findOne({ attempt: attempt._id });
      if (!session && attempt.status === 'in_progress') {
        session = await ensureProctoringSession(attempt, {
          policySnapshot: attempt.proctoringSnapshot,
          reason: 'resync_selfheal',
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
        // The FROZEN policy snapshot drives client-side episode thresholds —
        // it is data the student already consented to, and the server never
        // trusts client conclusions derived from it.
        policy: attempt.proctoringSnapshot?.policy || null,
        // Phase 5 (D11): the session's frozen attention baseline (null for
        // older/self-healed sessions → client arms with global bands +
        // calibration:'fallback', never blocked).
        proctoringAttentionBaseline: shapeAttentionBaseline(session),
        attemptStatus: attempt.status,
        serverNow: new Date().toISOString(),
        requestId: req.requestId,
      });
    } catch (error) {
      logger.error('Proctoring session fetch failed', {
        requestId: req.requestId, errorMessage: error?.message,
      });
      return res.status(500).json({
        success: false, message: 'Server error', code: 'INTERNAL_ERROR', requestId: req.requestId,
      });
    }
  });

  /**
   * GET /timeline — the chronological review surface (plan §25.3, Phase
   * 7-lite): serverAt-ordered episode rows (one per episode, never per
   * frame), the derived violations, warnings/auto-submit system actions, and
   * the session summary (frozen copy for closed sessions, live rollup
   * otherwise). Structured observations only — no images exist anywhere
   * (§4.4).
   */
  router.get('/timeline', auth, async (req, res) => {
    const { attemptId } = req.params;
    try {
      const attempt = await QuizAttempt.findById(attemptId);
      if (!attempt) {
        return res.status(404).json({
          success: false, message: 'Attempt not found', code: 'ATTEMPT_NOT_FOUND', requestId: req.requestId,
        });
      }
      if (!(await assertAttemptReadAccess(req, attempt))) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to view this timeline',
          code: 'FORBIDDEN',
          requestId: req.requestId,
        });
      }
      if (!attempt.proctoringSnapshot) {
        return res.status(400).json({
          success: false,
          message: 'Proctoring is not enabled for this quiz.',
          code: 'PROCTORING_NOT_ENABLED_FOR_QUIZ',
          requestId: req.requestId,
        });
      }

      const session = await ProctoringSession.findOne({ attempt: attempt._id });
      if (!session) {
        return res.status(200).json({
          success: true,
          timeline: null,
          attemptStatus: attempt.status,
          requestId: req.requestId,
        });
      }

      // Assembly is shared with every other timeline reader (public
      // guest-owner route) — utils/proctoring/timeline.js.
      const timeline = await assembleProctoringTimeline(attempt, session);

      return res.status(200).json({
        success: true,
        timeline,
        requestId: req.requestId,
      });
    } catch (error) {
      logger.error('Proctoring timeline fetch failed', {
        requestId: req.requestId, errorMessage: error?.message,
      });
      return res.status(500).json({
        success: false, message: 'Server error', code: 'INTERNAL_ERROR', requestId: req.requestId,
      });
    }
  });

  /**
   * POST /review — the Phase 7 human review decision of record (plan §25.4).
   * ADMIN ONLY: mentors and students read timelines but never write review
   * outcomes. Confirm / Dismiss / Escalate + note; an optional adjusted score
   * is recorded DISPLAY-ONLY alongside the original (§25.4: the platform
   * never alters marks). Every violation of the session is stamped with the
   * same decision, the session's integrityStatus updates, and the attempt's
   * §26.5 mirror follows. Re-review overwrites (admins correct decisions);
   * the review subdoc always carries the latest reviewer + timestamp.
   */
  router.post('/review', auth, async (req, res) => {
    const { attemptId } = req.params;
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Only administrators can record proctoring review decisions.',
          code: 'FORBIDDEN',
          requestId: req.requestId,
        });
      }

      const attempt = await QuizAttempt.findById(attemptId);
      if (!attempt) {
        return res.status(404).json({
          success: false, message: 'Attempt not found', code: 'ATTEMPT_NOT_FOUND', requestId: req.requestId,
        });
      }
      if (!attempt.proctoringSnapshot) {
        return res.status(400).json({
          success: false,
          message: 'Proctoring is not enabled for this quiz.',
          code: 'PROCTORING_NOT_ENABLED_FOR_QUIZ',
          requestId: req.requestId,
        });
      }

      const session = await ProctoringSession.findOne({ attempt: attempt._id });
      if (!session) {
        return res.status(404).json({
          success: false, message: 'No proctoring session for this attempt',
          code: 'SESSION_NOT_FOUND', requestId: req.requestId,
        });
      }
      // Reviews attach to finished attempts; an in-flight session's story is
      // still being written.
      if (session.status === 'ACTIVE' || session.status === 'DEGRADED') {
        return res.status(409).json({
          success: false,
          message: 'This attempt is still in progress — review it after it finishes.',
          code: 'SESSION_STILL_ACTIVE',
          requestId: req.requestId,
        });
      }

      const { decision, note, adjustedScore, adjustedTotalMarks } = req.body || {};
      if (!['confirm', 'dismiss', 'escalate'].includes(decision)) {
        return res.status(400).json({
          success: false,
          message: 'decision must be "confirm", "dismiss" or "escalate".',
          code: 'VALIDATION_ERROR',
          requestId: req.requestId,
        });
      }
      if (note !== undefined && note !== null && String(note).length > 1000) {
        return res.status(400).json({
          success: false, message: 'note must be at most 1000 characters',
          code: 'VALIDATION_ERROR', requestId: req.requestId,
        });
      }
      const hasScore = adjustedScore !== undefined && adjustedScore !== null;
      const hasTotal = adjustedTotalMarks !== undefined && adjustedTotalMarks !== null;
      if ((hasScore || hasTotal) && !(hasScore && hasTotal)) {
        return res.status(400).json({
          success: false,
          message: 'adjustedScore and adjustedTotalMarks must be provided together.',
          code: 'VALIDATION_ERROR',
          requestId: req.requestId,
        });
      }
      if (hasScore && (!Number.isFinite(Number(adjustedScore)) || Number(adjustedScore) < 0
        || !Number.isFinite(Number(adjustedTotalMarks)) || Number(adjustedTotalMarks) < 0
        || Number(adjustedScore) > Number(adjustedTotalMarks))) {
        return res.status(400).json({
          success: false,
          message: 'adjustedScore must be a number between 0 and adjustedTotalMarks.',
          code: 'VALIDATION_ERROR',
          requestId: req.requestId,
        });
      }

      const reviewedAt = new Date();
      // §25.4: dismissal clears the concern; confirm/escalate record it.
      const integrityStatus = decision === 'dismiss' ? 'reviewed_ok' : 'reviewed_concern';

      await ProctoringSession.updateOne(
        { _id: session._id },
        {
          $set: {
            integrityStatus,
            review: {
              status: decision,
              reviewedBy: req.user._id,
              reviewedAt,
              ...(note ? { note: String(note) } : {}),
            },
            ...(hasScore ? {
              reviewAdjustedScore: {
                score: Number(adjustedScore),
                totalMarks: Number(adjustedTotalMarks),
              },
            } : {}),
          },
          // A re-review without an adjusted score clears any stale one.
          ...(hasScore ? {} : { $unset: { reviewAdjustedScore: 1 } }),
        }
      ).exec();

      // Stamp the session's violations with the same decision (the trail).
      await ProctoringViolation.updateMany(
        { session: session._id },
        {
          $set: {
            review: {
              status: decision === 'confirm' ? 'confirmed' : decision === 'dismiss' ? 'dismissed' : 'escalated',
              reviewedBy: req.user._id,
              reviewedAt,
              ...(note ? { note: String(note) } : {}),
            },
          },
        }
      ).exec();

      // §26.5 mirror on the attempt.
      await QuizAttempt.updateOne(
        { _id: attempt._id },
        { $set: { integrityStatus } }
      ).exec();

      logger.info('Proctoring review recorded', {
        requestId: req.requestId,
        sessionId: session._id,
        attemptId: attempt._id,
        decision,
        integrityStatus,
      });

      return res.status(200).json({
        success: true,
        review: {
          status: decision,
          reviewedAt: reviewedAt.toISOString(),
          integrityStatus,
          ...(hasScore ? {
            reviewAdjustedScore: {
              score: Number(adjustedScore),
              totalMarks: Number(adjustedTotalMarks),
            },
          } : {}),
        },
        requestId: req.requestId,
      });
    } catch (error) {
      logger.error('Proctoring review failed', {
        requestId: req.requestId, errorMessage: error?.message,
      });
      return res.status(500).json({
        success: false, message: 'Server error', code: 'INTERNAL_ERROR', requestId: req.requestId,
      });
    }
  });

  return router;
};

module.exports = { buildEventsRouter, buildSessionRouter };
