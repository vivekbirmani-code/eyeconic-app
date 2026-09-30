// Pure validation for client-submitted proctoring events (plan §17, §24.1).
//
// This is the Phase 1 validation foundation: the event-ingest route (later
// phase) calls validateEventPayload() before persisting anything. It is pure
// (no DB, no clock reads beyond the passed `now`) so it is exhaustively unit
// testable, mirroring the style of utils/sectionLocking.js.
//
// Server-authority contract (plan §24.1): clients submit observation claims
// only. Anything server-computed (severity, risk, actions, authoritative
// timestamps, review state) is STRIPPED on arrival — a client sending those
// fields can never influence them.

const {
  isKnownEventType,
  getEventDefinition,
  BANNED_EVENT_IDENTIFIER_PATTERN,
} = require('./eventRegistry');

// Fields the server owns outright. Present in a client payload → removed and
// reported in `strippedFields` (never an error: an accidental future client
// field must not lose legitimate events).
const SERVER_OWNED_FIELDS = [
  'serverAt',
  'severity',
  'actionTaken',
  'review',
  'riskScore',
  'riskBreakdown',
  'violationsCount',
  'session',
  'attempt',
  'quiz',
  '_id',
];

// Plausibility bounds for client-claimed episode intervals. These are sanity
// floors, not policy: an episode longer than a day or claimed to start in the
// (far) future is a malformed/hostile payload, not an observation.
const MAX_EPISODE_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 60 * 1000; // client clock may run ahead, but not by an hour
const MAX_METADATA_JSON_LENGTH = 4 * 1024;

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseDateClaim = (value) => {
  if (value === undefined || value === null) return { missing: true };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { invalid: true };
  return { date };
};

/**
 * Validates one client-submitted event payload.
 *
 * @param {object} raw the client's event claim
 * @param {{now?: Date, requireIdempotencyKey?: boolean}} [options]
 * @returns {{valid: boolean, errors: string[], strippedFields: string[],
 *            value?: object}} sanitized event value on success. The value
 *            keeps ONLY client-claimable fields; server-owned fields and
 *            derived fields (durationMs) are added server-side at ingest.
 */
const validateEventPayload = (raw, { now = new Date(), requireIdempotencyKey = false } = {}) => {
  const errors = [];
  const strippedFields = [];

  if (!isPlainObject(raw)) {
    return { valid: false, errors: ['Event must be an object'], strippedFields };
  }

  // Type — known registry types only; banned verdict identifiers can never
  // masquerade as unknown-but-accepted custom types.
  const type = raw.type;
  if (typeof type !== 'string' || !type.trim()) {
    errors.push('Event type is required');
  } else if (BANNED_EVENT_IDENTIFIER_PATTERN.test(type)) {
    errors.push(`Banned event identifier: ${type}`);
  } else if (!isKnownEventType(type)) {
    errors.push(`Unknown event type: ${type}`);
  }

  const definition = getEventDefinition(type);

  // Source — must be one of the type's registered sources.
  if (definition) {
    if (raw.source === undefined || raw.source === null || raw.source === '') {
      errors.push('Event source is required');
    } else if (!definition.sources.includes(raw.source)) {
      errors.push(
        `Event source "${raw.source}" is not valid for type ${type} (allowed: ${definition.sources.join(', ')})`
      );
    }
  }

  // Confidence — required 0..1 for probabilistic observations; must be absent
  // for deterministic events (a confidence on a fact is meaningless).
  if (definition) {
    const hasConfidence = raw.confidence !== undefined && raw.confidence !== null;
    if (definition.reliability === 'probabilistic') {
      if (!hasConfidence || typeof raw.confidence !== 'number'
        || raw.confidence < 0 || raw.confidence > 1) {
        errors.push('Probabilistic events require a numeric confidence between 0 and 1');
      }
    } else if (hasConfidence) {
      errors.push(`Deterministic events must not carry a confidence (type ${type})`);
    }
  }

  // Episode interval — point events have closedAt = openedAt.
  const opened = parseDateClaim(raw.openedAt);
  const closed = parseDateClaim(raw.closedAt);
  if (opened.missing) errors.push('openedAt is required');
  else if (opened.invalid) errors.push('openedAt must be a parseable date');

  if (!closed.missing && closed.invalid) errors.push('closedAt must be a parseable date');

  if (!opened.missing && !opened.invalid && !closed.missing && !closed.invalid) {
    if (closed.date.getTime() < opened.date.getTime()) {
      errors.push('closedAt cannot be before openedAt');
    } else if (closed.date.getTime() - opened.date.getTime() > MAX_EPISODE_DURATION_MS) {
      errors.push('Episode duration exceeds the plausibility bound');
    }
    if (opened.date.getTime() - now.getTime() > MAX_FUTURE_SKEW_MS) {
      errors.push('openedAt is implausibly far in the future');
    }
  }

  // Transport fields.
  if (requireIdempotencyKey) {
    if (typeof raw.idempotencyKey !== 'string' || !raw.idempotencyKey.trim()
      || raw.idempotencyKey.length > 128) {
      errors.push('idempotencyKey must be a non-empty string (max 128 chars)');
    }
  } else if (raw.idempotencyKey !== undefined
    && (typeof raw.idempotencyKey !== 'string' || raw.idempotencyKey.length > 128)) {
    errors.push('idempotencyKey must be a string (max 128 chars)');
  }

  if (raw.clientSeq !== undefined && raw.clientSeq !== null) {
    if (!Number.isInteger(raw.clientSeq) || raw.clientSeq < 0) {
      errors.push('clientSeq must be a non-negative integer');
    }
  }

  // Metadata — bounded object; any JSON-serializable detail is accepted here,
  // policy interpretation happens server-side later.
  if (raw.metadata !== undefined && raw.metadata !== null) {
    if (!isPlainObject(raw.metadata)) {
      errors.push('metadata must be an object');
    } else {
      try {
        if (JSON.stringify(raw.metadata).length > MAX_METADATA_JSON_LENGTH) {
          errors.push('metadata exceeds the size bound');
        }
      } catch {
        errors.push('metadata must be JSON-serializable');
      }
    }
  }

  // Strip server-owned fields the client must never assert.
  const value = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (SERVER_OWNED_FIELDS.includes(key)) {
      strippedFields.push(key);
      continue;
    }
    value[key] = entry;
  }

  if (errors.length > 0) {
    return { valid: false, errors, strippedFields };
  }

  return { valid: true, errors: [], strippedFields, value };
};

module.exports = {
  SERVER_OWNED_FIELDS,
  MAX_EPISODE_DURATION_MS,
  MAX_FUTURE_SKEW_MS,
  validateEventPayload,
};
