/**
 * Centralized plain-English proctoring copy (plan §9, decision D7).
 *
 * EVERY student-facing proctoring string lives here — screens render by key;
 * there are no inline copies in components (Phase 2 acceptance criterion 7).
 * Style rules (binding): short, direct, student-friendly; never legal-formal;
 * never claims "cheating detection", "eye/gaze tracking", "recording" or
 * "photos" — none of those exist (plan §4.4, §9.1, D6).
 *
 * `CONSENT_TEXT_VERSION` travels with every consent record so copy changes
 * are auditable against what the student actually saw (§9.2).
 */

export const CONSENT_TEXT_VERSION = '2026-09-v1';

export const PROCTORING_COPY = {
  precheck: {
    title: 'Before you start',
    subtitle: 'We check a few things so the test can run smoothly.',
    steps: {
      device_capability: 'Device check',
      camera_permission: 'Camera permission',
      camera_availability: 'Camera check',
      face_readiness: 'Face check',
      network: 'Connection check',
    },
    statusWaiting: 'Checking…',
    statusPassed: 'Ready',
    statusFailed: 'Needs attention',
    statusSkipped: 'Not needed for this test',
    retryAction: 'Try again',
    cameraSettingsAction: 'Open settings',
    cameraHint: 'Allow camera access to continue.',
    faceHint: 'Sit so your whole face is visible in the camera. Make sure you are the only person in view.',
    lightingHint: 'Improve the lighting or face a light source, then try again.',
    networkHint: 'Check your internet connection, then try again.',
    retryableMessage: 'A check could not finish. This is usually temporary — try again.',
    failMessage: 'Some checks did not pass. Follow the tips above and try again.',
    unsupportedTitle: 'Device not supported',
    unsupportedMessage:
      'This device cannot run the monitoring this test requires. Please contact your mentor or admin for help with an alternative.',
    backAction: 'Back',
  },
  consent: {
    title: 'About monitoring for this test',
    lines: [
      'This test uses camera-based monitoring.',
      'Your camera is required for this test.',
      'We check that your face is visible during the test.',
      'Leaving the test app or switching windows is recorded.',
      'Screenshots are blocked while the test is open, where supported.',
      'Leaving the test repeatedly may cause your test to be submitted.',
      'No photos or videos are recorded or stored.',
      'Your mentor and admins can review these activity records.',
    ],
    acknowledge: 'I understand and agree to monitoring for this test',
    start: 'Start Test',
    starting: 'Starting…',
    startError: 'Could not start the test. Please try again.',
  },
  monitoring: {
    /** PiP caption under the live camera preview during the test. */
    active: 'Monitoring active',
    /**
     * PiP caption per engine status (Phase 9 fix): the indicator must tell
     * the truth — a dimmed chip reading "Monitoring active" while the
     * engine was stopped was the tell that section submits killed
     * monitoring. Fallback for unknown statuses: `active`.
     */
    statusCaptions: {
      idle: 'Starting monitoring…',
      starting: 'Starting monitoring…',
      monitoring: 'Monitoring active',
      degraded: 'Monitoring active — camera issue recorded',
      paused: 'Monitoring paused',
      stopped: 'Monitoring stopped',
    } as Record<string, string>,
    bannerTitles: {
      'camera-startup': 'Camera problem',
      'camera-error': 'Camera problem',
      permission: 'Camera access lost',
      model: 'Monitoring issue',
      dark: 'Camera too dark',
      frozen: 'Camera not updating',
    },
    bannerBodies: {
      'camera-startup': 'We could not start your camera. Your test continues — this has been recorded. Try reopening the test if your camera does not recover.',
      'camera-error': 'Your camera stopped working. Your test continues — this has been recorded. Check that nothing is blocking the camera.',
      permission: 'Camera access was turned off. Your test continues — this has been recorded. Allow camera access in settings to restore monitoring.',
      model: 'Face monitoring stopped working on this device. Your test continues — this has been recorded.',
      dark: 'The camera image is too dark to check reliably. Improve your lighting — your test continues and this has been recorded.',
      frozen: 'The camera image is not updating. Your test continues — this has been recorded.',
    },
    recovered: 'Monitoring restored',
  },
  /**
   * Student's own monitoring summary on the result screen (Phase 7, §25.1
   * transparency). Plain English only — no risk jargon; students see their
   * own notes and nothing about anyone else.
   */
  studentSummary: {
    title: 'Monitoring summary',
    subtitle: 'How your test monitoring went — for your transparency. It does not change your score.',
    /** Session status chip (header, right) + duration line (collapsed). */
    statusClosed: 'Closed normally',
    statusInterrupted: 'Interrupted',
    monitored: '{minutes} min monitored',
    /**
     * Collapsed-state stat chips — short labels paired with bold counts
     * (rendered by MonitoringSummaryCard; counts always from the server's
     * eventCounts, zero-count chips suppressed).
     */
    chipLabels: {
      leftApp: 'left the app',
      faceNotVisible: 'face not visible',
      multipleFaces: 'extra faces',
      headTurns: 'head turns',
      cameraIssues: 'camera / lighting',
      attentionNotes: 'other attention notes',
      connectionGaps: 'connection gaps',
    } as Record<string, string>,
    /** Clean session (zero recorded events) — positive, never alarming. */
    noNotes: 'No monitoring notes were recorded.',
    reviewed: {
      reviewed_ok: 'A reviewer looked at this test and found no concern.',
      reviewed_concern: 'A reviewer noted a concern with this test — your mentor may contact you.',
    } as Record<string, string>,
    showDetails: 'Show details',
    hideDetails: 'Hide details',
    /** Long-history cap (MonitoringSummaryCard renders the first rows only). */
    showAllEvents: 'Show all {count} events',
    showFewerEvents: 'Show fewer events',
    /**
     * WHICH warning a WARNING_DELIVERED row was (server metadata.code →
     * phrase); generic fallback lives in eventLabels.WARNING_DELIVERED.
     */
    warningDetails: {
      'warn.focus': 'Heads-up: come back to the test',
      'warn.final': 'Final warning',
      'warn.multipleFaces': 'Heads-up: only one person in view',
      'warn.faceMissing': 'Heads-up: face not clearly visible',
      'warn.camera': 'Heads-up: camera access lost',
      'warn.headTurn': 'Heads-up: focus on the screen',
    } as Record<string, string>,
    /**
     * Short plain-English labels for the details list — one line per recorded
     * observation. Students never see event-type codes (those are reviewer
     * vocabulary); unknown future types fall back to a prettified code.
     */
    eventLabels: {
      APP_BACKGROUND: 'Left the app',
      EXIT_ATTEMPTED: 'Tried to leave the test',
      FACE_NOT_DETECTED: 'Face not clearly visible',
      FACE_PARTIALLY_VISIBLE: 'Face partly visible',
      FACE_OUT_OF_FRAME: 'Face moved out of view',
      MULTIPLE_FACES_DETECTED: 'More than one person may have been visible',
      HEAD_POSE_EXTREME: 'Head turned far',
      HEAD_POSE_TURNED: 'Turned head away from the screen',
      HEAD_POSE_REPEATED: 'Repeated head turns',
      ATTENTION_DEVIATION_SUSTAINED: 'Looked away for a while',
      ATTENTION_DEVIATION_REPEATED: 'Looked away several times',
      CAMERA_UNAVAILABLE: 'Camera problem',
      CAMERA_PERMISSION_REVOKED: 'Camera permission lost',
      CAMERA_TRACK_ENDED: 'Camera stopped unexpectedly',
      CAMERA_FEED_DARK: 'Camera image too dark',
      CAMERA_FEED_FROZEN: 'Camera image froze',
      MODEL_UNAVAILABLE: 'Face detection unavailable',
      HEARTBEAT_GAP: 'Connection gap',
      SESSION_DEGRADED: 'Monitoring interrupted',
      WARNING_DELIVERED: 'Heads-up shown during the test',
      AUTO_SUBMITTED: 'Test submitted automatically (policy)',
    } as Record<string, string>,
  },
  /**
   * Server-driven policy warnings (Phase 6, plan §20.2). The rules engine
   * selects the CODE; this module owns the words. Rendered verbatim by the
   * banner — keyed by the server's WARN_CODES so backend and client can
   * never drift silently (mirrored + tested in
   * services/__tests__/proctoringWarnings.test.ts).
   */
  warnings: {
    byCode: {
      'warn.focus': {
        title: 'Please come back to the test',
        body: 'Leaving the test app is recorded. Leaving repeatedly may cause your test to be submitted.',
      },
      'warn.final': {
        title: 'Last warning',
        body: 'You have left the test several times. If you leave again, your test will be submitted.',
      },
      'warn.multipleFaces': {
        title: 'More than one person visible',
        body: 'Please make sure you are the only person the camera can see.',
      },
      'warn.faceMissing': {
        title: 'We cannot see your face',
        body: 'Please sit so your face is clearly visible in the camera.',
      },
      'warn.camera': {
        title: 'Camera access lost',
        body: 'Your test continues — this has been recorded. Allow camera access again to restore monitoring.',
      },
      'warn.headTurn': {
        title: 'Please focus on the screen',
        body: 'Please do not turn your head or look away from the screen. You are being monitored. Please focus on the screen.',
      },
    } as Record<string, { title: string; body: string }>,
    /** Shown when the policy auto-submits the attempt (terminal, §20.3). */
    autoSubmitted: {
      title: 'Test submitted',
      body: 'Your test was submitted automatically because the app was left too many times. If you think this was a mistake, contact your mentor.',
    },
  },
} as const;

export type ProctoringCopy = typeof PROCTORING_COPY;

/** Copy keys the consent/precheck screens render — kept exhaustive for tests. */
export const PROCTORING_COPY_KEYS = {
  precheckSteps: Object.keys(PROCTORING_COPY.precheck.steps),
  consentLines: PROCTORING_COPY.consent.lines.length,
} as const;
