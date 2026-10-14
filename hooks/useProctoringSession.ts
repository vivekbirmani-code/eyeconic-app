/**
 * useProctoringSession — React glue for the Phase 3 proctoring engine
 * (plan §6.3, §10.1, §14.3). Owns exactly one ProctoringEngine per attempt:
 *   - arms it when the taking screen mounts for a proctored attempt
 *     (currentAttempt.proctoringSessionId present — non-proctored attempts
 *     never touch the camera, plan §32 Phase 3 AC 6);
 *   - pauses/resumes on AppState background/foreground (app lifecycle — the
 *     engine drops stale frames) and feeds the same transitions to the
 *     Phase 4 FocusTracker (APP_BACKGROUND episodes, plan §14/§20.5);
 *   - stops it on unmount (submit/finalize/navigation) so native resources
 *     are released and no second engine instance can exist;
 *   - exposes status for the technical banner + PiP preview, plus the
 *     EXIT_ATTEMPTED recorder for the taking screen's back handler.
 *
 * ALL expo/native imports live here and below — the engine itself stays pure.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { Camera, type CameraView } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/services/api';
import { useNotifications } from '@/context/NotificationContext';
import {
  createProctoringFrameDetector,
} from '@/services/proctoring/detector';
import {
  ProctoringEngine,
  type ProctoringBatchPayload,
  type ProctoringCameraIssue,
  type ProctoringEngineState,
} from '@/services/proctoring/engine';
import { StreamingCameraSource } from '@/services/proctoring/streamingCameraSource';
import { isProctoringSpikeNativeAvailable } from '@/modules/proctoring-spike/src';
import { FocusTracker } from '@/services/proctoring/focusTracker';
import { resolveScreenCaptureDeterrence } from '@/services/proctoring/screenCapture';
import type { EventBufferStorage } from '@/services/proctoring/eventBuffer';
import type { ProctoringPolicy, ProctoringSendOutcome } from '@/services/proctoring/types';

/** A server-decided policy action from the rules engine (plan §27.2). */
export interface ProctoringServerAction {
  kind: 'WARN' | 'FINAL_WARN';
  code: string;
  warnId: string;
  ruleId?: string;
}

export interface UseProctoringSessionParams {
  quizId: string;
  attemptId?: string;
  /** Present only for proctored attempts (frozen snapshot at /start). */
  sessionId?: string;
  policy?: Record<string, unknown> | null;
  /** 'start' = fresh /start this app session; 'resume' = restored/relaunched. */
  arm?: 'start' | 'resume';
  cameraRef: React.RefObject<CameraView | null>;
}

export interface UseProctoringSessionResult {
  /** True when monitoring is armed for this attempt (PiP should render). */
  active: boolean;
  status: ProctoringEngineState['status'];
  cameraIssue: ProctoringCameraIssue;
  /**
   * Records an EXIT_ATTEMPTED point event (informational, plan §14.3) — call
   * from the taking screen's back-handler interception. No-op unless the
   * engine is armed for a proctored attempt.
   */
  recordExitAttempted: () => void;
  /**
   * The latest undelivered-yet policy warning (Phase 6, §20.2) — rendered by
   * the banner from the centralized copy module. WARN variants auto-dismiss;
   * FINAL_WARN persists until replaced or the attempt ends.
   */
  warning: ProctoringServerAction | null;
  /** True once the server policy-auto-submitted this attempt (§20.3/§20.6). */
  autoSubmitted: boolean;
}

const bufferStorageFor = (attemptId: string): EventBufferStorage => ({
  async load() {
    try {
      const raw = await AsyncStorage.getItem(`proctoring_event_buffer_${attemptId}`);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
  async persist(events) {
    try {
      await AsyncStorage.setItem(`proctoring_event_buffer_${attemptId}`, JSON.stringify(events));
    } catch {
      // Storage pressure must never break monitoring — events still flush.
    }
  },
  async clear() {
    try {
      await AsyncStorage.removeItem(`proctoring_event_buffer_${attemptId}`);
    } catch {
      /* ignore */
    }
  },
});

/** Maps the axios outcome onto the engine's transport contract. */
const sendBatch = async (
  quizId: string,
  attemptId: string,
  payload: ProctoringBatchPayload,
  onServerSignal?: (signal: {
    actions?: ProctoringServerAction[];
    attemptFinalized?: boolean;
  }) => void
): Promise<ProctoringSendOutcome> => {
  try {
    const response = await api.post(
      `/quizzes/${quizId}/attempt/${attemptId}/proctoring/events`,
      payload
    );
    const duplicates = Array.isArray(response.data?.duplicates)
      ? response.data.duplicates.length
      : 0;
    // Phase 6 side-channel: the batch response carries the server-decided
    // policy outcome (§27.2) — warnings for the banner and the terminal
    // auto-submit flag. The engine's transport contract is untouched; this
    // is display plumbing only (every decision stays server-side).
    if (onServerSignal) {
      onServerSignal({
        actions: Array.isArray(response.data?.actions) ? response.data.actions : undefined,
        attemptFinalized: response.data?.attemptFinalized === true,
      });
    }
    return {
      kind: 'accepted',
      duplicates,
      ...(response.data?.floodFlagged ? { floodFlagged: true } : {}),
    };
  } catch (error: any) {
    const status = error?.response?.status;
    const code = error?.response?.data?.code;
    if (status === 409 && code === 'SESSION_NOT_ACTIVE') {
      return { kind: 'session_closed' };
    }
    if (status === 400) {
      return { kind: 'permanent_reject', reason: code ?? 'validation' };
    }
    return { kind: 'retryable', reason: code ?? String(status ?? 'network') };
  }
};

export function useProctoringSession({
  quizId,
  attemptId,
  sessionId,
  policy,
  arm,
  cameraRef,
}: UseProctoringSessionParams): UseProctoringSessionResult {
  const [state, setState] = useState<ProctoringEngineState>({
    status: 'idle',
    cameraIssue: null,
  });
  const [warning, setWarning] = useState<ProctoringServerAction | null>(null);
  const [autoSubmitted, setAutoSubmitted] = useState(false);

  const { socket } = useNotifications();

  const engineRef = useRef<ProctoringEngine | null>(null);
  const focusTrackerRef = useRef<FocusTracker | null>(null);
  // Latest engine status without re-subscribing listeners — gates the public
  // recording helpers until arming is complete (enqueuing into a buffer whose
  // restore() has not settled yet would lose the event).
  const statusRef = useRef<ProctoringEngineState['status']>('idle');
  /** Delivered warn ids — dedupes batch responses against socket nudges. */
  const deliveredWarnIdsRef = useRef<Set<string>>(new Set());
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = Boolean(sessionId && attemptId);

  /**
   * Single ingestion point for server-decided policy outcomes (§20.2): batch
   * responses AND the socket nudge funnel here, so delivery is idempotent by
   * warnId and the banner shows exactly what the rules engine decided — the
   * client never derives its own warnings.
   */
  const handleServerSignal = useCallback((signal: {
    actions?: ProctoringServerAction[];
    attemptFinalized?: boolean;
  }) => {
    if (signal.attemptFinalized) {
      setAutoSubmitted(true);
      setWarning(null);
      return;
    }
    const next = (signal.actions || []).find(
      (action) => action?.warnId && !deliveredWarnIdsRef.current.has(action.warnId)
    );
    if (!next) return;
    deliveredWarnIdsRef.current.add(next.warnId);
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    setWarning(next);
    // WARN banners auto-dismiss; FINAL_WARN persists until replaced or the
    // attempt ends — it is the student's last chance message (§20.3).
    if (next.kind !== 'FINAL_WARN') {
      warningTimerRef.current = setTimeout(() => {
        setWarning((current) => (current?.warnId === next.warnId ? null : current));
      }, 10_000);
    }
  }, []);

  useEffect(() => {
    if (!sessionId || !attemptId) return;
    let cancelled = false;
    // Per-attempt warning bookkeeping resets with the attempt.
    deliveredWarnIdsRef.current = new Set();

    const armEngine = async () => {
      const detector = createProctoringFrameDetector();

      // When the frozen policy is not already in hand (app relaunch →
      // loadAttempt carries only the session id), resync through the session
      // endpoint: confirms the session is ACTIVE server-side (self-healing
      // included) and returns the frozen policy. Best-effort — the engine's
      // policy fallbacks keep thresholds sane if this fails.
      let effectivePolicy: ProctoringPolicy | undefined =
        (policy as ProctoringPolicy | undefined) ?? undefined;
      if (!effectivePolicy) {
        try {
          const resync = await api.get(`/quizzes/attempt/${attemptId}/proctoring/session`);
          const session = resync.data?.session;
          if (cancelled) return;
          if (session && (session.status === 'CLOSED' || session.status === 'CLOSED_FAILED')) {
            // Attempt finalized while away — nothing to monitor. The taking
            // screen's own resync routes to results.
            return;
          }
          effectivePolicy = resync.data?.policy ?? undefined;
        } catch {
          // Offline: arm with defaults; events buffer and retry anyway.
        }
      }
      if (cancelled) return;

      // Track 2b — the headless streaming transport (§43/§43.3): the native
      // MODULE owns the camera (ImageAnalysis alone) and the engine subscribes
      // to module events directly — NO React view sits on the frame path, so a
      // late/missing/remounted/failing PiP can never stall analysis (Preview
      // is an optional attachment). Falls back to the snapshot path when the
      // module is absent (non-Android; precheck reports camera UNSUPPORTED
      // there, so this is defensive).
      const useStreamingSource = Platform.OS === 'android' && isProctoringSpikeNativeAvailable();

      const engine = new ProctoringEngine({
        session: { quizId, attemptId, sessionId },
        policy: effectivePolicy,
        detectorTier: 'headpose',
        ...(useStreamingSource
          ? {
            frameSource: (hooks) => new StreamingCameraSource(hooks),
          }
          : {
            capture: async () => {
              try {
                const picture = await cameraRef.current?.takePictureAsync({
                  quality: 0.4,
                  base64: true,
                  // skipProcessing stays false so EXIF orientation is baked in
                  // (Phase 0 finding — the detector needs an upright image).
                });
                return { base64: picture?.base64 ?? null };
              } catch {
                return { base64: null };
              }
            },
            detectRaw: (base64) => detector.detectRaw(base64),
          }),
        transport: (payload) => sendBatch(quizId, attemptId, payload, (signal) => {
          if (!cancelled) handleServerSignal(signal);
        }),
        storage: bufferStorageFor(attemptId),
        checkPermission: async () => {
          try {
            const permissions = await Camera.getCameraPermissionsAsync();
            return permissions.granted;
          } catch {
            return true; // probe failure must not mislabel a camera error
          }
        },
        heartbeatIntervalMs:
          effectivePolicy?.sessionHealth?.heartbeatIntervalMs ?? 30000,
        // §15.2: the honest deterrence label rides SESSION_STARTED/RESUMED
        // metadata → server-side set-once review stamp on the session.
        deterrence: resolveScreenCaptureDeterrence(
          Platform.OS,
          effectivePolicy?.screenCapturePrevention?.enabled !== false
        ),
        onStateChange: (next) => {
          statusRef.current = next.status;
          if (!cancelled) setState(next);
        },
      });

      engineRef.current = engine;
      focusTrackerRef.current = new FocusTracker({ policy: effectivePolicy });
      await engine.start({ resumed: arm !== 'start' });
      if (cancelled) {
        void engine.stop();
      }
    };

    void armEngine();

    // Teardown covers unmount (submit/finalize/navigation) AND attempt or
    // session changes: exactly one engine lives at a time, and the previous
    // one is always stopped (loop released, episodes closed, final flush).
    return () => {
      cancelled = true;
      const engine = engineRef.current;
      engineRef.current = null;
      const focusTracker = focusTrackerRef.current;
      focusTrackerRef.current = null;
      // Close any open focus excursion first so it rides the engine's final
      // flush (§23) instead of vanishing.
      if (engine && focusTracker) {
        engine.recordEpisodes(focusTracker.closeAll());
      }
      if (engine) void engine.stop();
      statusRef.current = 'idle';
      setState({ status: 'idle', cameraIssue: null });
    };
    // The engine arms once per attempt+session identity; `policy`/`arm`
    // only shape the initial arming (a re-render with the same ids is a no-op
    // because the effect deps are unchanged).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, sessionId]);

  // App lifecycle: pause analysis cleanly on background, resume on foreground
  // (plan §10.1 PAUSED state), and feed the same transitions to the Phase 4
  // FocusTracker — a real backgrounding becomes an APP_BACKGROUND episode
  // (blips dropped, §20.5); Android 'inactive' (permission dialogs) never
  // opens one. A backgrounded app cannot flush: the closed episode sits in
  // the persisted buffer and rides the first flush after resume (§23).
  useEffect(() => {
    if (!active) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const engine = engineRef.current;
      const focusTracker = focusTrackerRef.current;
      if (!engine) return;
      if (nextState === 'active') {
        const episodes = focusTracker ? focusTracker.onAppStateChange('active') : [];
        engine.resume();
        engine.recordEpisodes(episodes);
      } else if (nextState === 'background' || (Platform.OS === 'ios' && nextState === 'inactive')) {
        if (focusTracker) focusTracker.onAppStateChange(nextState);
        // Android 'inactive' is transient (permission dialogs) — only a real
        // backgrounding pauses; iOS inactive covers control-center pulls.
        engine.pause();
      }
    });
    return () => subscription.remove();
  }, [active]);

  const recordExitAttempted = useCallback(() => {
    const engine = engineRef.current;
    const focusTracker = focusTrackerRef.current;
    if (!engine || !focusTracker) return;
    if (statusRef.current !== 'monitoring' && statusRef.current !== 'degraded'
      && statusRef.current !== 'paused') {
      return; // not armed yet (or already stopped) — nothing to record into
    }
    engine.recordEpisodes(focusTracker.onExitAttempted());
  }, []);

  // Instant warning delivery (§20.2): the socket nudge carries no payload
  // data beyond the action identity — the same funnel as batch responses, so
  // the banner is deduped by warnId and never trusts socket data beyond the
  // server-decided action codes.
  useEffect(() => {
    if (!active || !socket) return;
    const listener = (payload: ProctoringServerAction & { attemptId?: string }) => {
      if (payload?.attemptId && attemptId && payload.attemptId !== attemptId) return;
      handleServerSignal({ actions: [payload] });
    };
    socket.on('proctoring_warning', listener);
    return () => {
      socket.off('proctoring_warning', listener);
    };
  }, [active, socket, attemptId, handleServerSignal]);

  // Clear any pending banner timer on unmount.
  useEffect(() => () => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
  }, []);

  return {
    active,
    status: state.status,
    cameraIssue: state.cameraIssue,
    recordExitAttempted,
    warning,
    autoSubmitted,
  };
}
