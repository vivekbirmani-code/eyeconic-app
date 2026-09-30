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
} as const;

export type ProctoringCopy = typeof PROCTORING_COPY;

/** Copy keys the consent/precheck screens render — kept exhaustive for tests. */
export const PROCTORING_COPY_KEYS = {
  precheckSteps: Object.keys(PROCTORING_COPY.precheck.steps),
  consentLines: PROCTORING_COPY.consent.lines.length,
} as const;
