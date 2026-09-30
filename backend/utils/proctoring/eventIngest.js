// Pure helpers for the proctoring event-batch ingest (plan §17, §24, §27.2).
//
// The route (routes/proctoringEvents.js) owns I/O; everything decidable from
// the payload alone lives here so it is exhaustively unit-testable, mirroring
// utils/sectionLocking.js. Server-authority contract: per-event payload
// validation is delegated to eventValidation.js (Phase 1); this layer adds the
// batch envelope, the server-owned record shaping (serverAt, severity,
// durationMs, detectorTier, category) and the flood outcome.

const {
  EVENT_BATCH_MAX_EVENTS,
  EVENT_FLOOD_SESSION_CAP,
  PROVISIONAL_EVENT_SEVERITIES,
} = require('./defaults');
const { getEventDefinition, EVENT_CATEGORIES } = require('./eventRegistry');

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validates the batch envelope around the per-event payloads.
 *
 * Expected body: { sessionId?, seq?, heartbeat?, bufferOverflow?, events: [] }
 *  - sessionId: client echo of the session id — checked against the derived
 *    session at the route (403 SESSION_MISMATCH on divergence).
 *  - seq: transport ordering hint (the last event's clientSeq). NOT enforced
 *    strictly — out-of-order and delayed batches MUST be accepted (plan §7.3:
 *    events are ordered by serverAt) — but the envelope must be internally
 *    consistent (seq == last event's clientSeq).
 *  - heartbeat: true marks a piggyback/standalone heartbeat; empty batches
 *    are legal only in that case.
 *  - bufferOverflow: honest client report of locally dropped episodes
 *    (plan §23) — logged, never stored as events (the type registry is
 *    enum-locked; a BUFFER_OVERFLOW marker event cannot exist by design).
 *
 * @returns {{valid: boolean, error?: string, value?: object}}
 */
const parseEventBatchEnvelope = (body) => {
  if (!isPlainObject(body)) {
    return { valid: false, error: 'Request body must be an object' };
  }

  const { sessionId, seq, heartbeat, bufferOverflow, events } = body;

  if (sessionId !== undefined && sessionId !== null
    && (typeof sessionId !== 'string' || !/^[0-9a-fA-F]{8,64}$/.test(sessionId))) {
    return { valid: false, error: 'sessionId must be a hexadecimal id string' };
  }

  if (seq !== undefined && seq !== null
    && (!Number.isInteger(seq) || seq < 0)) {
    return { valid: false, error: 'seq must be a non-negative integer' };
  }

  if (heartbeat !== undefined && heartbeat !== null && typeof heartbeat !== 'boolean') {
    return { valid: false, error: 'heartbeat must be a boolean' };
  }

  if (bufferOverflow !== undefined && bufferOverflow !== null
    && (!Number.isInteger(bufferOverflow) || bufferOverflow < 0 || bufferOverflow > 100000)) {
    return { valid: false, error: 'bufferOverflow must be a non-negative integer' };
  }

  if (!Array.isArray(events)) {
    return { valid: false, error: 'events must be an array' };
  }
  if (events.length > EVENT_BATCH_MAX_EVENTS) {
    return { valid: false, error: `events exceeds the batch bound of ${EVENT_BATCH_MAX_EVENTS}` };
  }
  if (events.length === 0 && heartbeat !== true) {
    return { valid: false, error: 'events must not be empty unless heartbeat is true' };
  }

  // Envelope consistency: seq, when present, must equal the last event's
  // clientSeq (corruption detection, not ordering enforcement).
  if (seq !== undefined && seq !== null && events.length > 0) {
    const lastSeq = events[events.length - 1]?.clientSeq;
    if (!Number.isInteger(lastSeq) || lastSeq !== seq) {
      return { valid: false, error: 'seq must match the last event\'s clientSeq' };
    }
  }

  return {
    valid: true,
    value: {
      ...(sessionId ? { sessionId } : {}),
      ...(seq !== undefined && seq !== null ? { seq } : {}),
      heartbeat: heartbeat === true,
      bufferOverflow: Number.isInteger(bufferOverflow) ? bufferOverflow : 0,
      events,
    },
  };
};

/**
 * Shapes one validated client claim into its stored record. Server-owned
 * fields are computed here and ONLY here — a client can never influence
 * serverAt, severity, category, durationMs or ownership fields (plan §24.1).
 *
 * @param {object} validated the sanitized value from validateEventPayload
 * @param {object} context {type (already checked), session, attempt, quizId, now}
 * @returns {object} the ProctoringEvent document to insert
 */
const buildEventRecord = (validated, { type, session, attempt, quizId, now }) => {
  const definition = getEventDefinition(type);
  const openedAt = new Date(validated.openedAt);
  const closedAt = validated.closedAt !== undefined && validated.closedAt !== null
    ? new Date(validated.closedAt)
    : openedAt; // point events (closedAt = openedAt, plan §17.3)

  const isCv = definition.category === 'cv_observation';
  const detectorTier = isCv
    ? (validated.detectorTier === 'iris' ? 'iris' : 'headpose')
    : undefined;

  return {
    session: session._id,
    attempt: attempt._id,
    quiz: quizId,
    category: definition.category,
    type,
    source: validated.source,
    ...(detectorTier ? { detectorTier } : {}),
    ...(validated.confidence !== undefined && validated.confidence !== null
      ? { confidence: validated.confidence }
      : {}),
    openedAt,
    closedAt,
    durationMs: Math.max(0, closedAt.getTime() - openedAt.getTime()),
    severity: PROVISIONAL_EVENT_SEVERITIES[type] || 'info',
    ...(validated.metadata !== undefined && validated.metadata !== null
      ? { metadata: validated.metadata }
      : {}),
    ...(validated.idempotencyKey ? { idempotencyKey: validated.idempotencyKey } : {}),
    ...(validated.clientSeq !== undefined && validated.clientSeq !== null
      ? { clientSeq: validated.clientSeq }
      : {}),
    clientAt: closedAt,
    serverAt: now,
  };
};

/**
 * Flood outcome for a session after accepting `newCount` more events
 * (plan §18.6: rate floors with quarantine — accepted-but-flagged, never
 * silently dropped).
 *
 * @returns {{floodFlagged: boolean, overCap: boolean}}
 */
const computeFloodOutcome = (storedEventCount, newCount) => {
  const total = (Number(storedEventCount) || 0) + (Number(newCount) || 0);
  return {
    overCap: total >= EVENT_FLOOD_SESSION_CAP,
    floodFlagged: total >= EVENT_FLOOD_SESSION_CAP,
  };
};

// Category list re-exported for route-side assertions (keeps one import site).
module.exports = {
  EVENT_BATCH_MAX_EVENTS,
  EVENT_FLOOD_SESSION_CAP,
  parseEventBatchEnvelope,
  buildEventRecord,
  computeFloodOutcome,
  EVENT_CATEGORIES,
};
