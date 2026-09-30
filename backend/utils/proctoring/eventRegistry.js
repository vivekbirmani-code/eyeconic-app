// Structured event type registry (plan §17.6) — the single source of truth
// for which proctoring event types exist, their category and their
// reliability class. Signals → events → rules → policy: the registry is the
// "events" vocabulary every later phase (ingest, rules engine, timeline)
// validates against, so unknown types are rejected at the boundary.
//
// Banned identifiers: CHEATING / FRAUD / IMPERSONATION and synonyms never
// appear anywhere — events are observations, never verdicts (plan §6.5.1,
// enforced by tests/unit/proctoring/eventRegistry.test.js). There is also
// deliberately NO fullscreen event type (plan D2 — fullscreen removed).

const EVENT_CATEGORIES = ['technical', 'cv_observation', 'integrity', 'system_action'];
const EVENT_SOURCES = ['cv', 'browser', 'os', 'system'];
const EVENT_RELIABILITY_CLASSES = ['deterministic', 'probabilistic'];
const EVENT_SEVERITIES = ['info', 'minor', 'moderate', 'major'];

// Identifiers that must never exist in the registry (or in any event type
// string a client submits) — "verdict" language is banned by design.
const BANNED_EVENT_IDENTIFIER_PATTERN = /CHEAT|FRAUD|IMPERSONAT|PLAGIAR|DECEIV|DISHONEST|GUILT/i;

const EVENT_REGISTRY = {
  // ---- technical: session / camera / network / system health ----
  SESSION_STARTED: { category: 'technical', reliability: 'deterministic', sources: ['system'] },
  SESSION_RESUMED: { category: 'technical', reliability: 'deterministic', sources: ['system'] },
  SESSION_CLOSED: { category: 'technical', reliability: 'deterministic', sources: ['system'] },
  SESSION_DEGRADED: { category: 'technical', reliability: 'deterministic', sources: ['system'] },
  MODEL_UNAVAILABLE: { category: 'technical', reliability: 'deterministic', sources: ['cv'] },
  HEARTBEAT_GAP: { category: 'technical', reliability: 'deterministic', sources: ['system'] },
  CAMERA_UNAVAILABLE: { category: 'technical', reliability: 'deterministic', sources: ['cv'] },
  CAMERA_PERMISSION_REVOKED: { category: 'technical', reliability: 'deterministic', sources: ['cv', 'os'] },
  CAMERA_TRACK_ENDED: { category: 'technical', reliability: 'deterministic', sources: ['cv', 'os'] },
  CAMERA_FEED_DARK: { category: 'technical', reliability: 'deterministic', sources: ['cv'] },
  CAMERA_FEED_FROZEN: { category: 'technical', reliability: 'deterministic', sources: ['cv'] },

  // ---- cv_observation: probabilistic computer-vision observations ----
  FACE_NOT_DETECTED: { category: 'cv_observation', reliability: 'probabilistic', sources: ['cv'] },
  FACE_PARTIALLY_VISIBLE: { category: 'cv_observation', reliability: 'probabilistic', sources: ['cv'] },
  FACE_OUT_OF_FRAME: { category: 'cv_observation', reliability: 'probabilistic', sources: ['cv'] },
  MULTIPLE_FACES_DETECTED: { category: 'cv_observation', reliability: 'probabilistic', sources: ['cv'] },
  HEAD_POSE_EXTREME: { category: 'cv_observation', reliability: 'probabilistic', sources: ['cv'] },
  HEAD_POSE_REPEATED: { category: 'cv_observation', reliability: 'probabilistic', sources: ['cv'] },
  ATTENTION_DEVIATION_SUSTAINED: { category: 'cv_observation', reliability: 'probabilistic', sources: ['cv'] },
  ATTENTION_DEVIATION_REPEATED: { category: 'cv_observation', reliability: 'probabilistic', sources: ['cv'] },

  // ---- integrity: browser/OS/app focus & context (platform-caveated facts) ----
  TAB_HIDDEN: { category: 'integrity', reliability: 'deterministic', sources: ['browser'] },
  WINDOW_BLUR: { category: 'integrity', reliability: 'deterministic', sources: ['browser'] },
  APP_BACKGROUND: { category: 'integrity', reliability: 'deterministic', sources: ['os'] },
  APP_INACTIVE: { category: 'integrity', reliability: 'deterministic', sources: ['os'] },
  EXIT_ATTEMPTED: { category: 'integrity', reliability: 'deterministic', sources: ['browser', 'os'] },

  // ---- system_action: server-generated records of actions taken ----
  WARNING_DELIVERED: { category: 'system_action', reliability: 'deterministic', sources: ['system'] },
  AUTO_SUBMITTED: { category: 'system_action', reliability: 'deterministic', sources: ['system'] },
  POLICY_ACTION_SKIPPED: { category: 'system_action', reliability: 'deterministic', sources: ['system'] },
};

/**
 * @param {string} type
 * @returns {boolean} true only for types explicitly present in the registry.
 */
const isKnownEventType = (type) =>
  typeof type === 'string' && Object.prototype.hasOwnProperty.call(EVENT_REGISTRY, type);

/**
 * @param {string} type
 * @returns {{category: string, reliability: string, sources: string[]}|null}
 *          the registry definition, or null for unknown/banned types.
 */
const getEventDefinition = (type) => (isKnownEventType(type) ? EVENT_REGISTRY[type] : null);

const listEventTypes = () => Object.keys(EVENT_REGISTRY);

module.exports = {
  EVENT_CATEGORIES,
  EVENT_SOURCES,
  EVENT_RELIABILITY_CLASSES,
  EVENT_SEVERITIES,
  BANNED_EVENT_IDENTIFIER_PATTERN,
  EVENT_REGISTRY,
  isKnownEventType,
  getEventDefinition,
  listEventTypes,
};
