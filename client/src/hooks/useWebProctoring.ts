/**
 * useWebProctoring — the web counterpart of the mobile useProctoringSession.
 *
 * Arms the WebProctoringEngine when a PROCTORED attempt is loaded
 * (/start returned a proctoringSessionId), holds the single-tab lock,
 * merges the two warning channels (live socket + batch-response actions,
 * deduped by warnId), and exposes the bounded flush/stop pair every submit
 * path must call (mobile discipline: flush BEFORE submit, stop only after
 * finalize — monitoring stays armed between sections).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getGuestToken } from '../services/publicApi';
import { WebProctoringEngine, type WebCameraIssue } from '../services/proctoringWeb/engine';
import { createEventsTransport, type TransportAction } from '../services/proctoringWeb/transport';
import { localStorageBufferStorage } from '../services/proctoringWeb/eventBufferStorage';
import { acquireProctoringTabLock } from '../services/proctoringWeb/tabLock';
import {
  connectGuestWarningsSocket,
  type ProctoringWarningPayload,
} from '../services/proctoringWeb/warningsSocket';
import type { ProctoringPolicy } from '@app-services/proctoring/types';

export interface WebProctoringWarning {
  warnId: string;
  kind: string;
  code: string;
  at: number;
  final: boolean;
}

export interface UseWebProctoringArgs {
  shareToken: string;
  attemptId?: string;
  sessionId?: string;
  policy?: ProctoringPolicy | null;
  attentionBaseline?: { yaw: number; pitch: number; roll?: number; calibration: 'captured' | 'fallback' } | null;
  guestId: string;
  /** True when /start resumed an existing attempt (emits SESSION_RESUMED). */
  resumed?: boolean;
  /** Fired when the server reports the attempt finalized (auto-submit path). */
  onFinalized?: () => void;
}

const FLUSH_BOUND_MS = 1500;
const STOP_BOUND_MS = 2500;
const WARN_AUTO_DISMISS_MS = 10000;

const bounded = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

export function useWebProctoring({
  shareToken,
  attemptId,
  sessionId,
  policy,
  attentionBaseline,
  guestId,
  resumed,
  onFinalized,
}: UseWebProctoringArgs) {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<string>('idle');
  const [cameraIssue, setCameraIssue] = useState<WebCameraIssue>(null);
  const [warning, setWarning] = useState<WebProctoringWarning | null>(null);
  const [blockedByOtherTab, setBlockedByOtherTab] = useState(false);

  const engineRef = useRef<WebProctoringEngine | null>(null);
  const warnedRef = useRef<Set<string>>(new Set());
  const dismissTimerRef = useRef<number | null>(null);
  // Latest /start outcome (200 = resume, 201 = create), read at ARM time.
  // Write-through rather than latched-at-mount: the /start response always
  // lands AFTER mount, so a useRef(initial) would freeze at false and every
  // resume would emit SESSION_STARTED instead of SESSION_RESUMED.
  const resumedRef = useRef<boolean>(resumed === true);
  resumedRef.current = resumed === true;

  const pushWarning = useCallback((payload: { warnId: string; kind: string; code: string }) => {
    if (warnedRef.current.has(payload.warnId)) return;
    warnedRef.current.add(payload.warnId);
    const final = payload.kind === 'FINAL_WARN' || payload.code === 'warn.final';
    setWarning({ ...payload, at: Date.now(), final });
    if (!final) {
      if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = window.setTimeout(() => setWarning(null), WARN_AUTO_DISMISS_MS);
    }
  }, []);

  const flushMonitoring = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    await bounded(engine.flushNow(), FLUSH_BOUND_MS);
  }, []);

  const stopMonitoring = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    await bounded(engine.stop(), STOP_BOUND_MS);
  }, []);

  useEffect(() => {
    if (!attemptId || !sessionId) {
      setActive(false);
      return;
    }
    let cancelled = false;
    let releaseLock: (() => void) | null = null;
    let disconnectSocket: (() => void) | null = null;

    (async () => {
      // The engine is created BEFORE the lock so the lock's onLost callback
      // is bound to THIS effect's engine instance. With the previous order
      // (lock → engine), a StrictMode double-mount's leaked first lock
      // could fire onLost against the SHARED engineRef and stop the live
      // engine of the second mount — an unmonitored rest-of-quiz.
      const guestToken = getGuestToken();
      const engine = new WebProctoringEngine({
        session: { shareToken, attemptId, sessionId, guestId },
        policy: policy ?? {},
        attentionBaseline: attentionBaseline ?? null,
        transport: createEventsTransport(shareToken, attemptId, guestId),
        storage: localStorageBufferStorage(attemptId),
        onState: (state) => {
          setStatus(state.status);
          setCameraIssue(state.cameraIssue);
        },
        onWarning: (action: TransportAction) => pushWarning(action),
        onFinalized: () => onFinalized?.(),
      });
      const stopThisEngine = () => { void engine.stop(); };

      // Single-tab lock (best-effort): a second tab must not run a second
      // engine against the same attempt. isCancelled keeps a torn-down
      // mount's acquisition from ever pinging (StrictMode double-mount).
      const lock = await acquireProctoringTabLock(attemptId, stopThisEngine, () => cancelled);
      if (cancelled) {
        lock.release();
        // Never started — nothing armed, nothing to stop.
        return;
      }
      // Release in BOTH outcomes (review finding: the challenger path
      // leaked its BroadcastChannel heartbeat + listener for the page
      // lifetime).
      releaseLock = lock.release;
      if (!lock.held) {
        setBlockedByOtherTab(true);
        return;
      }

      engineRef.current = engine;
      setActive(true);

      if (guestToken) {
        disconnectSocket = connectGuestWarningsSocket(guestToken, (payload: ProctoringWarningPayload) =>
          pushWarning(payload)
        );
      }

      await engine.start({ resumed: resumedRef.current });
    })();

    return () => {
      cancelled = true;
      if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current);
      disconnectSocket?.();
      releaseLock?.();
      const engine = engineRef.current;
      engineRef.current = null;
      // Unmount teardown backstop — the submit paths stop() explicitly.
      if (engine) void engine.stop();
    };
    // Arm once per attempt; policy/baseline ride the frozen /start payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareToken, attemptId, sessionId]);

  return {
    active,
    status,
    cameraIssue,
    warning,
    blockedByOtherTab,
    flushMonitoring,
    stopMonitoring,
    dismissWarning: useCallback(() => setWarning(null), []),
  };
}
