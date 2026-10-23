/**
 * Monitoring status indicator + banners for the public taking page — the
 * web counterparts of the mobile MonitoringStatusDot/ProctoringBanner.
 * Colors follow the engine-truth discipline: green ONLY for genuine
 * monitoring; amber for degraded/paused; red for permission/model trouble;
 * grey when not armed.
 */

import { AlertTriangle, Camera, CameraOff, ShieldAlert } from 'lucide-react';
import type { WebCameraIssue } from '../../../services/proctoringWeb/engine';
import type { WebProctoringWarning } from '../../../hooks/useWebProctoring';

const dotClass = (status: string, cameraIssue: WebCameraIssue) => {
  if (status === 'monitoring' && !cameraIssue) return 'bg-emerald-500';
  if (status === 'starting') return 'bg-amber-400';
  if (status === 'paused' || cameraIssue === 'dark' || cameraIssue === 'frozen') return 'bg-amber-500';
  if (cameraIssue === 'permission' || cameraIssue === 'model' || cameraIssue === 'camera-error' || cameraIssue === 'camera-startup') {
    return 'bg-red-500';
  }
  return 'bg-gray-400';
};

const label = (status: string, cameraIssue: WebCameraIssue): string => {
  if (status === 'monitoring' && !cameraIssue) return 'Monitoring active';
  if (status === 'starting') return 'Starting monitoring…';
  if (cameraIssue === 'permission') return 'Camera permission needed';
  if (cameraIssue === 'model') return 'Monitoring engine unavailable';
  if (cameraIssue === 'dark') return 'Camera very dark';
  if (cameraIssue === 'frozen') return 'Camera feed not changing';
  if (cameraIssue) return 'Camera trouble — recording';
  if (status === 'paused') return 'Monitoring paused';
  return 'Monitoring';
};

export function MonitoringStatusDot({
  status,
  cameraIssue,
}: {
  status: string;
  cameraIssue: WebCameraIssue;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={label(status, cameraIssue)}
      aria-label={label(status, cameraIssue)}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${dotClass(status, cameraIssue)}`} />
      <span className="text-[11px] font-medium text-white/80 hidden sm:inline">
        {label(status, cameraIssue)}
      </span>
    </span>
  );
}

const CAMERA_BANNERS: Record<NonNullable<WebCameraIssue>, { title: string; body: string }> = {
  permission: {
    title: 'Camera access was lost',
    body: 'Allow camera access for this site (camera icon in the address bar) so monitoring can resume. Your quiz is not affected.',
  },
  model: {
    title: 'Monitoring engine issue',
    body: 'The monitoring engine stopped working. Keep taking your test — this is recorded for review.',
  },
  'camera-startup': { title: 'Camera trouble', body: 'The camera could not be started. Keep taking your test — this is recorded for review.' },
  'camera-error': { title: 'Camera trouble', body: 'The camera stopped unexpectedly. Keep taking your test — this is recorded for review.' },
  dark: { title: 'Very dark camera image', body: 'Your camera image is too dark to monitor. Improve your lighting if possible — your quiz continues normally.' },
  frozen: { title: 'Camera image not changing', body: 'The camera feed appears frozen. Your quiz continues normally and this is recorded.' },
};

export function ProctoringBanner({
  warning,
  cameraIssue,
  onDismissWarning,
}: {
  warning: WebProctoringWarning | null;
  cameraIssue: WebCameraIssue;
  onDismissWarning: () => void;
}) {
  // Server warning takes precedence (policy-triggered); camera banners are
  // display-only technical state (owner decision: record + warn, never block).
  if (warning) {
    const final = warning.final;
    const copy =
      warning.code === 'warn.headTurn'
        ? 'Heads-up: please focus on the screen.'
        : warning.code === 'warn.focus'
          ? 'Please stay on this test — switching away is recorded.'
          : 'Please stay on this test — switching away is recorded.';
    return (
      <div
        className={`rounded-xl border px-4 py-3 flex items-start gap-2.5 ${
          final ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
        }`}
        role="alert"
      >
        <ShieldAlert className={`w-5 h-5 shrink-0 mt-0.5 ${final ? 'text-red-600' : 'text-amber-600'}`} />
        <div className="flex-1">
          <p className={`text-sm font-semibold ${final ? 'text-red-800' : 'text-amber-800'}`}>
            {final ? 'Final warning' : 'Warning'}
          </p>
          <p className={`text-xs mt-0.5 ${final ? 'text-red-700' : 'text-amber-700'}`}>{copy}</p>
        </div>
        {!final && (
          <button onClick={onDismissWarning} className="text-xs text-amber-600 hover:text-amber-800 shrink-0 mt-1">
            Dismiss
          </button>
        )}
      </div>
    );
  }

  if (cameraIssue && CAMERA_BANNERS[cameraIssue]) {
    const banner = CAMERA_BANNERS[cameraIssue];
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5" role="status">
        {cameraIssue === 'permission' || cameraIssue === 'model' ? (
          <CameraOff className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        ) : (
          <Camera className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        )}
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-800">{banner.title}</p>
          <p className="text-xs mt-0.5 text-amber-700">{banner.body}</p>
        </div>
      </div>
    );
  }

  return null;
}

/** Shown when another tab already holds the monitoring lock. */
export function OtherTabOverlay() {
  return (
    <div className="fixed inset-0 z-50 bg-gray-900/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 shadow-2xl max-w-md w-full text-center">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900">This test is already open in another tab</h2>
        <p className="text-sm text-gray-600 mt-2 leading-relaxed">
          Close the other tab or window and refresh here to continue. Monitoring runs in only one
          tab at a time.
        </p>
      </div>
    </div>
  );
}
