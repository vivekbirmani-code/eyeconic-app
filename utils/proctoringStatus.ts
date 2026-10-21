/**
 * Pure mapping from the proctoring engine's runtime state to the status-dot
 * view (color + label + detail) used by the quiz header indicator (Phase 9
 * redesign). Kept UI-free so every state → color/label pair is unit-testable
 * and the component can never invent its own truth: green ONLY when the
 * engine genuinely reports 'monitoring'.
 *
 * State model (services/proctoring/engine.ts §10.1):
 *   idle → starting → monitoring ⇄ degraded ⇄ paused → stopped
 * plus the not-armed case (proctoring.active false → grey).
 */
import { PROCTORING_COPY } from './proctoringCopy';
import { colors } from '@/utils/theme';
import type { ProctoringCameraIssue, ProctoringEngineState } from '@/services/proctoring/engine';

export type MonitoringTone = 'active' | 'intermediate' | 'failure' | 'inactive';

export interface MonitoringStatusView {
  tone: MonitoringTone;
  /** Theme color for the dot. */
  color: string;
  /** Short status label (popover title + accessibility). */
  label: string;
  /** Optional one-line explanation (popover body). */
  detail?: string;
}

/**
 * Camera issues that mean monitoring CANNOT do its job (camera dead or the
 * analyzer down) — the red tier. Environmental/transient issues (dark frame,
 * frozen feed, startup) keep the amber tier: the engine is alive and will
 * record the issue.
 */
const FAILURE_CAMERA_ISSUES: ReadonlySet<ProctoringCameraIssue> = new Set([
  'permission',
  'camera-error',
  'model',
]);

export function getMonitoringStatusView(
  status: ProctoringEngineState['status'],
  cameraIssue: ProctoringCameraIssue | null,
  active = true
): MonitoringStatusView {
  const copy = PROCTORING_COPY.monitoring;

  if (!active) {
    return { tone: 'inactive', color: colors.textMuted, label: 'Monitoring off' };
  }

  switch (status) {
    case 'monitoring':
      return {
        tone: 'active',
        color: colors.success,
        label: copy.statusCaptions.monitoring,
        detail: 'Camera monitoring is running. Activity is recorded for review.',
      };
    case 'starting':
    case 'idle':
      return {
        tone: 'intermediate',
        color: colors.warning,
        label: copy.statusCaptions.starting,
        detail: 'Monitoring is starting up.',
      };
    case 'paused':
      return {
        tone: 'intermediate',
        color: colors.warning,
        label: copy.statusCaptions.paused,
        detail: 'Monitoring resumes automatically when you return to the test.',
      };
    case 'degraded':
      if (cameraIssue && FAILURE_CAMERA_ISSUES.has(cameraIssue)) {
        return {
          tone: 'failure',
          color: colors.danger,
          label: 'Monitoring issue',
          detail: copy.bannerBodies[cameraIssue],
        };
      }
      return {
        tone: 'intermediate',
        color: colors.warning,
        label: copy.statusCaptions.degraded,
        detail: (cameraIssue ? copy.bannerBodies[cameraIssue] : undefined),
      };
    case 'stopped':
      return {
        tone: 'inactive',
        color: colors.textMuted,
        label: copy.statusCaptions.stopped,
        detail: 'Monitoring has ended for this test.',
      };
    default:
      // Unknown future status — never claim active.
      return { tone: 'inactive', color: colors.textMuted, label: copy.statusCaptions.stopped };
  }
}
