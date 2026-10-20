// Proctoring observability digest (plan §30.2, Phase 8 WS-A / AC-5).
//
// ONE aggregation pass over the window answers "what do we actually know
// about monitoring quality?" across the nine §30.2 dimensions. Every
// dimension carries an HONEST verdict:
//
//   measured      — computed from persisted production data
//   partial       — computed, but from a proxy or with a known blind spot
//   not_captured  — no data source exists (stated, never papered over)
//
// Zero-data digests still carry all nine keys with their verdicts — that IS
// the AC-5 property: the surface renders what is and is not known, so "we
// cannot measure this yet" is a first-class answer (§30.2 discipline). No
// number is ever invented; a null value means "not computable from the data".

const ProctoringSession = require('../../models/ProctoringSession');
const ProctoringEvent = require('../../models/ProctoringEvent');
const ProctoringViolation = require('../../models/ProctoringViolation');
const QuizAttempt = require('../../models/QuizAttempt');
const logger = require('../logger');
const { CAMERA_INCIDENT_TYPES } = require('./summary');
const { deliverEmail } = require('../mailer');

// Ordered per §30.2 — renderers and tests iterate this list.
const DIGEST_DIMENSIONS = [
  'falsePositiveRate',
  'detectorReliability',
  'cameraFailureRate',
  'eventAccuracy',
  'appPerformance',
  'crashRate',
  'deliveryReliability',
  'recoverySuccess',
  'autoSubmitCorrectness',
];

const DIMENSION_LABELS = {
  falsePositiveRate: 'False-positive rate',
  detectorReliability: 'Detector reliability',
  cameraFailureRate: 'Camera failure rate',
  eventAccuracy: 'Event accuracy',
  appPerformance: 'App performance',
  crashRate: 'Crash rate',
  deliveryReliability: 'Delivery reliability',
  recoverySuccess: 'Recovery success',
  autoSubmitCorrectness: 'Auto-submit correctness',
};

const VERDICT_LABELS = {
  measured: 'measured',
  partial: 'partial',
  not_captured: 'not captured',
};

const round4 = (value) => (Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null);

/**
 * Builds the nine-dimension digest over [from, to].
 *
 * Reads: ProctoringSession (startedAt window) · ProctoringEvent (aggregate
 * group-by-type on serverAt, one call) · ProctoringViolation (countedAt ≥
 * from, ONE event lookup for eventRefs types) · QuizAttempt (autoSubmitReason
 * of auto-submitted sessions). Pure with respect to writes — never persists.
 *
 * @param {{from: Date, to: Date}} input
 */
const buildProctoringMetricsDigest = async ({ from, to } = {}) => {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate >= toDate) {
    throw new Error('buildProctoringMetricsDigest requires from < to dates');
  }

  const [sessions, eventFacet, violations] = await Promise.all([
    ProctoringSession.find({ startedAt: { $gte: fromDate, $lte: toDate } })
      .select('status baseline.calibration integrity eventCounts violationsCount review transitions')
      .lean(),
    ProctoringEvent.aggregate([
      { $match: { serverAt: { $gte: fromDate, $lte: toDate } } },
      {
        $facet: {
          byType: [
            { $group: { _id: '$type', count: { $sum: 1 } } },
          ],
          perfContext: [
            { $match: { type: 'SESSION_STARTED' } },
            { $group: { _id: '$metadata.analysisIntervalMs' } },
          ],
          detectorTiers: [
            { $match: { detectorTier: { $ne: null } } },
            { $group: { _id: '$detectorTier', count: { $sum: 1 } } },
          ],
          autoSubmitSessions: [
            { $match: { type: 'AUTO_SUBMITTED' } },
            { $group: { _id: null, count: { $sum: 1 }, sessions: { $addToSet: '$session' } } },
          ],
        },
      },
    ]),
    ProctoringViolation.find({ countedAt: { $gte: fromDate, $lte: toDate } })
      .select('ruleId review eventRefs')
      .lean(),
  ]);

  const typeCounts = {};
  let eventsTotal = 0;
  for (const row of eventFacet[0].byType) {
    typeCounts[row._id] = row.count;
    eventsTotal += row.count;
  }
  const sessionCount = sessions.length;

  // ---- Dimension 1: false-positive rate (§19.5 step 3) ----
  // Review dismissals are the available PROXY for "not a real issue": per
  // type, dismissed ÷ total violations. Without reviews it is honestly null.
  let eventTypesById = new Map();
  if (violations.some((v) => (v.eventRefs || []).length > 0)) {
    const refIds = [...new Set(violations.flatMap((v) => v.eventRefs || []).map(String))];
    const refEvents = await ProctoringEvent.find({ _id: { $in: refIds } })
      .select('type')
      .lean();
    eventTypesById = new Map(refEvents.map((e) => [String(e._id), e.type]));
  }
  const fpByType = {};
  let reviewedTotal = 0;
  for (const violation of violations) {
    const status = violation.review?.status || 'pending';
    const types = (violation.eventRefs || []).map((ref) => eventTypesById.get(String(ref)) || 'unknown');
    const typesForKey = types.length > 0 ? types : [violation.ruleId];
    for (const type of typesForKey) {
      fpByType[type] = fpByType[type] || { total: 0, dismissed: 0, confirmed: 0 };
      fpByType[type].total += 1;
      if (status !== 'pending') reviewedTotal += 1;
      if (status === 'dismissed') fpByType[type].dismissed += 1;
      if (status === 'confirmed') fpByType[type].confirmed += 1;
    }
  }
  const perTypeRates = {};
  for (const [type, counts] of Object.entries(fpByType)) {
    perTypeRates[type] = {
      total: counts.total,
      dismissed: counts.dismissed,
      rate: counts.total > 0 ? round4(counts.dismissed / counts.total) : null,
    };
  }
  const reviewedViolations = violations.filter((v) => v.review?.status === 'confirmed' || v.review?.status === 'dismissed').length;
  const falsePositiveRate = {
    verdict: 'partial',
    value: {
      reviewedViolations,
      totalViolations: violations.length,
      perType: perTypeRates,
    },
    basis: '§19.5 step 3: per-type dismissed ÷ total violations, from ProctoringViolation.review → eventRefs → event types.',
    note: reviewedViolations === 0
      ? `Pipeline live, 0/${violations.length} violations reviewed — rate null until human reviews exist (dismissals proxy false positives).`
      : 'Dismissals proxy false positives; a reviewer dismissal is not a measured ground truth.',
  };

  // ---- Dimension 2: detector reliability ----
  const fallbackSessions = sessions.filter((s) =>
    s.baseline?.calibration === 'fallback' || s.integrity?.detectorFallback === true).length;
  const detectorReliability = {
    verdict: 'partial',
    value: {
      fallbackSessions,
      sessions: sessionCount,
      fallbackRate: sessionCount > 0 ? round4(fallbackSessions / sessionCount) : null,
      supervisedAgreement: { verdict: 'not_captured', value: null },
    },
    basis: 'Sessions with baseline.calibration = fallback OR integrity.detectorFallback ÷ sessions in window.',
    note: sessionCount === 0
      ? 'No sessions in the window — fallback rate null.'
      : 'Fallback-rate only. Supervised agreement (detector vs. human labels) is not capturable outside spike fixtures (§45.3).',
  };

  // ---- Dimension 3: camera failure rate ----
  const cameraIncidentEvents = CAMERA_INCIDENT_TYPES.reduce((sum, type) => sum + (typeCounts[type] || 0), 0);
  const cameraFailureRate = {
    verdict: 'partial',
    value: {
      cameraIncidentEvents,
      sessions: sessionCount,
      perSession: sessionCount > 0 ? round4(cameraIncidentEvents / sessionCount) : null,
    },
    basis: `Sum of ${CAMERA_INCIDENT_TYPES.join(', ')} events ÷ sessions in window.`,
    note: 'In-quiz camera incidents only — precheck-stage camera init failures are log-only, never stored.',
  };

  // ---- Dimension 4: event accuracy ----
  const floodFlaggedSessions = sessions.filter((s) => s.integrity?.floodFlagged === true).length;
  const batchesRejectedTotal = sessions.reduce((sum, s) => sum + (s.integrity?.batchesRejected || 0), 0);
  const eventAccuracy = {
    verdict: 'measured',
    value: {
      floodFlaggedSessions,
      batchesRejectedTotal,
      eventsTotal,
      batchesRejectedPer1000Events: eventsTotal > 0 ? round4((batchesRejectedTotal / eventsTotal) * 1000) : null,
    },
    basis: 'integrity.floodFlagged + summed integrity.batchesRejected per 1000 stored events.',
    note: 'batchesRejected conflates 400-validation rejects with 409-post-close rejects — an honest ceiling, not a pure error rate.',
  };

  // ---- Dimension 5: app performance ----
  const detectorTierDistribution = {};
  for (const row of eventFacet[0].detectorTiers) {
    if (row._id) detectorTierDistribution[row._id] = row.count;
  }
  const analysisIntervalsMs = eventFacet[0].perfContext
    .map((row) => row._id)
    .filter((value) => value !== null && value !== undefined);
  const appPerformance = {
    verdict: 'not_captured',
    value: {
      detectorTierDistribution,
      distinctAnalysisIntervalMs: [...new Set(analysisIntervalsMs)],
    },
    basis: 'Configuration context only (detector tiers in use, distinct SESSION_STARTED analysis intervals).',
    note: 'Not a measurement: the client sends no fps/CPU/memory telemetry. Instrumentation deferred to V1.1.',
  };

  // ---- Dimension 6: crash rate ----
  const sessionResumedCount = typeCounts.SESSION_RESUMED || 0;
  const unmonitoredIntervalsTotal = sessions.reduce(
    (sum, s) => sum + (Array.isArray(s.integrity?.unmonitoredIntervals) ? s.integrity.unmonitoredIntervals.length : 0),
    0
  );
  const crashRate = {
    verdict: 'not_captured',
    value: { sessionResumedCount, unmonitoredIntervalsTotal },
    basis: 'Proxies only: SESSION_RESUMED count + integrity.unmonitoredIntervals total.',
    note: 'Proxies, not crash rates — no crash/ANR signal is persisted anywhere in the pipeline today.',
  };

  // ---- Dimension 7: delivery reliability ----
  const deliveryReliability = {
    verdict: 'not_captured',
    value: null,
    basis: 'By design: bufferOverflow is logged at ingest (routes/proctoringEvents.js, ~357–363) and never stored (§23); batch retries are idempotent no-ops; duplicates are not persisted.',
    note: 'Delivery health would need persisted counters — deliberately absent since events are append-only.',
  };

  // ---- Dimension 8: recovery success ----
  const heartbeatGaps = typeCounts.HEARTBEAT_GAP || 0;
  const heartbeatRecovered = sessions.reduce(
    (sum, s) => sum + (Array.isArray(s.transitions)
      ? s.transitions.filter((t) => t.reason === 'heartbeat_recovered').length
      : 0),
    0
  );
  const recoverySuccess = {
    verdict: 'partial',
    value: {
      heartbeatGaps,
      heartbeatRecovered,
      recoveryRate: heartbeatGaps > 0 ? round4(heartbeatRecovered / heartbeatGaps) : null,
    },
    basis: 'HEARTBEAT_GAP events + transitions[] heartbeat_timeout→heartbeat_recovered pairs ÷ gaps.',
    note: heartbeatGaps === 0
      ? 'No heartbeat gaps in the window — recovery rate null.'
      : 'Heartbeat recovery is measured; camera-loss re-acquisition is only inferable (no explicit re-acquire transition).',
  };

  // ---- Dimension 9: auto-submit correctness ----
  const autoSubmitFacetRow = eventFacet[0].autoSubmitSessions[0] || { count: 0, sessions: [] };
  let autoSubmitDetails = {
    autoSubmittedEvents: autoSubmitFacetRow.count,
    sessions: autoSubmitFacetRow.sessions.length,
    reviewStatusDistribution: {},
    attemptReasonKinds: {},
    upheldRate: null,
  };
  if (autoSubmitFacetRow.sessions.length > 0) {
    const autoSessions = await ProctoringSession.find({ _id: { $in: autoSubmitFacetRow.sessions } })
      .select('review.status attempt')
      .lean();
    const attemptIds = autoSessions.map((s) => s.attempt);
    const attempts = await QuizAttempt.find({ _id: { $in: attemptIds } })
      .select('autoSubmitReason')
      .lean();
    let confirmed = 0;
    let dismissed = 0;
    for (const session of autoSessions) {
      const status = session.review?.status || 'pending';
      autoSubmitDetails.reviewStatusDistribution[status] = (autoSubmitDetails.reviewStatusDistribution[status] || 0) + 1;
      if (status === 'confirmed') confirmed += 1;
      if (status === 'dismissed') dismissed += 1;
    }
    for (const attempt of attempts) {
      const kind = attempt.autoSubmitReason?.kind || 'none';
      autoSubmitDetails.attemptReasonKinds[kind] = (autoSubmitDetails.attemptReasonKinds[kind] || 0) + 1;
    }
    autoSubmitDetails.upheldRate = (confirmed + dismissed) > 0 ? round4(confirmed / (confirmed + dismissed)) : null;
  }
  const autoSubmitCorrectness = {
    verdict: 'measured',
    value: autoSubmitDetails,
    basis: 'AUTO_SUBMITTED events → owning sessions review.status + attempts autoSubmitReason.kind distribution; upheldRate = confirmed ÷ (confirmed + dismissed).',
    note: autoSubmitDetails.upheldRate === null
      ? 'No reviewed auto-submitted sessions yet — upheld rate null (0/0).'
      : 'Upheld rate reflects reviewer decisions on auto-submitted sessions.',
  };

  const dimensions = {
    falsePositiveRate,
    detectorReliability,
    cameraFailureRate,
    eventAccuracy,
    appPerformance,
    crashRate,
    deliveryReliability,
    recoverySuccess,
    autoSubmitCorrectness,
  };
  // Defensive ordering guarantee: the nine keys always exist in §30.2 order
  // even if the object above is edited out of order later.
  const orderedDimensions = {};
  for (const key of DIGEST_DIMENSIONS) {
    orderedDimensions[key] = dimensions[key];
  }

  return {
    window: { from: fromDate.toISOString(), to: toDate.toISOString() },
    totals: {
      sessions: sessionCount,
      events: eventsTotal,
      violations: violations.length,
      autoSubmits: autoSubmitFacetRow.count,
    },
    dimensions: orderedDimensions,
  };
};

const renderValue = (value) => {
  if (value === null || value === undefined) return 'not computable from current data';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/** Plain-text renderer: nine labeled sections, one line each of verdict + value. */
const renderDigestText = (digest) => {
  const lines = [
    `Proctoring metrics digest — ${digest.window.from} to ${digest.window.to}`,
    `Sessions: ${digest.totals.sessions} · Events: ${digest.totals.events} · Violations: ${digest.totals.violations} · Auto-submits: ${digest.totals.autoSubmits}`,
    '',
  ];
  for (const key of DIGEST_DIMENSIONS) {
    const dimension = digest.dimensions[key];
    lines.push(`${DIMENSION_LABELS[key]} [${VERDICT_LABELS[dimension.verdict]}]`);
    lines.push(`  Value: ${renderValue(dimension.value)}`);
    lines.push(`  Basis: ${dimension.basis}`);
    lines.push(`  Note: ${dimension.note}`);
    lines.push('');
  }
  return lines.join('\n');
};

/** HTML renderer: same nine sections as a simple definition list. */
const renderDigestHtml = (digest) => {
  const sections = DIGEST_DIMENSIONS.map((key) => {
    const dimension = digest.dimensions[key];
    return `<section><h3>${DIMENSION_LABELS[key]} <small>[${VERDICT_LABELS[dimension.verdict]}]</small></h3>`
      + `<p><strong>Value:</strong> ${renderValue(dimension.value)}</p>`
      + `<p><strong>Basis:</strong> ${dimension.basis}</p>`
      + `<p><strong>Note:</strong> ${dimension.note}</p></section>`;
  }).join('\n');
  return `<html><body>`
    + `<h2>Proctoring metrics digest</h2>`
    + `<p>${digest.window.from} to ${digest.window.to} — `
    + `${digest.totals.sessions} sessions, ${digest.totals.events} events, `
    + `${digest.totals.violations} violations, ${digest.totals.autoSubmits} auto-submits.</p>`
    + sections
    + `</body></html>`;
};

/**
 * Sends the last-24 h digest to PROCTORING_DIGEST_RECIPIENTS (comma-separated
 * emails). Dormant by design: no recipients → one log line, no email.
 * Failures are logged, never thrown (runs on a bare setInterval).
 *
 * @param {{now?: Date}} input
 */
const sendProctoringMetricsDigest = async ({ now = new Date() } = {}) => {
  const recipients = (process.env.PROCTORING_DIGEST_RECIPIENTS || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    logger.info('Proctoring digest skipped — no recipients configured');
    return { skipped: true };
  }

  const to = new Date(now);
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  let digest;
  try {
    digest = await buildProctoringMetricsDigest({ from, to });
  } catch (error) {
    logger.error('Proctoring digest build failed', { errorMessage: error?.message });
    return { skipped: false, sent: 0, failed: recipients.length };
  }

  const subject = `Proctoring metrics digest — ${to.toISOString().slice(0, 10)}`;
  const text = renderDigestText(digest);
  const html = renderDigestHtml(digest);

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    try {
      await deliverEmail(recipient, subject, html, text, 'PROCTORING DIGEST', 'proctoring-digest', {});
      sent += 1;
    } catch (error) {
      failed += 1;
      logger.error('Proctoring digest delivery failed', {
        recipient,
        errorMessage: error?.message,
      });
    }
  }
  return { skipped: false, sent, failed };
};

module.exports = {
  DIGEST_DIMENSIONS,
  DIMENSION_LABELS,
  buildProctoringMetricsDigest,
  renderDigestText,
  renderDigestHtml,
  sendProctoringMetricsDigest,
};
