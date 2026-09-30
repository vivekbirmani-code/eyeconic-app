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
const MentorStudentAssignment = require('../models/MentorStudentAssignment');
const { auth, authorize } = require('../middleware/auth');
const { proctoringEventsRateLimit } = require('../middleware/proctoringRateLimit');
const logger = require('../utils/logger');
const { isPastSubmissionWindow, syncExpiredDuration } = require('../utils/proctoring/durationEnforcement');
const { validateEventPayload } = require('../utils/proctoring/eventValidation');
const {
  parseEventBatchEnvelope,
  buildEventRecord,
  computeFloodOutcome,
} = require('../utils/proctoring/eventIngest');
const { ensureProctoringSession } = require('../utils/proctoring/session');
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
 * POST /events — batched, idempotent episode ingest (+ heartbeat piggyback).
 *
 * Order of enforcement mirrors the other attempt-touching routes:
 * ownership → lazy §7.5 duration finalize → attempt/session state → envelope
 * and per-event validation → dedup → insert → session health bookkeeping.
 */
const buildEventsRouter = ({ makeFinalizer }) => {
  const router = express.Router({ mergeParams: true });

  router.post('/events', auth, authorize('student'), proctoringEventsRateLimit, async (req, res) => {
    const { id: quizIdParam, attemptId } = req.params;
    try {
      let attempt = await QuizAttempt.findOne({ _id: attemptId, student: req.user._id });
      if (!attempt) {
        return res.status(404).json({
          success: false, message: 'Attempt not found', code: 'ATTEMPT_NOT_FOUND', requestId: req.requestId,
        });
      }
      if (String(attempt.quiz) !== String(quizIdParam)) {
        // The attempt exists but belongs to a different quiz — a confused or
        // probing client. Do not leak its existence.
        return res.status(404).json({
          success: false, message: 'Attempt not found', code: 'ATTEMPT_NOT_FOUND', requestId: req.requestId,
        });
      }

      // Lazy duration enforcement FIRST (plan §27.2): a past-deadline attempt
      // is finalized through the same CAS path as every other finalize, then
      // this batch is rejected — the session the events belong to is closed.
      if (attempt.status === 'in_progress' && isPastSubmissionWindow(attempt)) {
        const durationSync = await syncExpiredDuration(QuizAttempt, {
          _id: attempt._id, student: req.user._id,
        }, { finalize: makeFinalizer(req) });
        attempt = durationSync.attempt || attempt;
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
          studentId: req.user._id,
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
          studentId: req.user._id,
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
      if (gap) {
        const gapRecord = buildGapEventRecord({ gap, session, attempt, quizId: attempt.quiz });
        try {
          await ProctoringEvent.insertMany([gapRecord], { ordered: false });
          gapRecorded = true;
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

      return res.status(200).json({
        success: true,
        message: 'Monitoring events accepted.',
        accepted: acceptedCount,
        duplicates: duplicateKeys,
        ...(floodFlagged ? { floodFlagged: true } : {}),
        serverNow: now.toISOString(),
        session: { id: session._id, status: session.status },
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
 * GET /session — session state for resume/resync (plan §27.2), used by the
 * taking screen to re-arm the engine after refresh / app restart. Access:
 * owner student, admin, or a mentor actively assigned to the student (the
 * same rule as GET /attempt/:id).
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

      const isOwner = String(attempt.student) === String(req.user._id);
      const isAdmin = req.user.role === 'admin';
      let isAssignedMentor = false;
      if (!isOwner && !isAdmin && req.user.role === 'mentor') {
        isAssignedMentor = Boolean(await MentorStudentAssignment.findOne({
          mentor: req.user._id, student: attempt.student, isActive: true,
        }));
      }
      if (!isOwner && !isAdmin && !isAssignedMentor) {
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

  return router;
};

module.exports = { buildEventsRouter, buildSessionRouter };
