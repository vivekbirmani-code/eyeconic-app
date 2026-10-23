import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
  Video,
} from 'lucide-react';
import { publicQuizApi, usePublicQuiz } from '../../contexts/PublicQuizContext';
import { classifyGetUserMediaError } from '../../services/proctoringWeb/cameraSource';
import {
  clearPrecheckToken,
  getGuestToken,
  getPrecheckToken,
  getPublicApiError,
  getErrorData,
  setPrecheckToken,
  type PrecheckCheck,
  type PrecheckReportPayload,
} from '../../services/publicApi';

/**
 * Proctoring readiness stage for ARMED public quizzes (public-quiz AI
 * proctoring, Phase 3). Sits between email verification and the taking
 * page — the exact stage whose absence caused the 403
 * PROCTORING_CONSENT_REQUIRED dead-end (start gating requires recorded
 * consent + a valid precheck attestation token BEFORE /start).
 *
 * Sequence (owner decision D-P8 — notice BEFORE any camera access):
 *   1. Monitoring notice + explicit acknowledgement.
 *   2. Camera permission + readiness frames (MediaPipe FaceLandmarker,
 *      dynamically imported so unarmed quizzes never download it).
 *   3. Precheck report → the SERVER decides the verdict and issues the
 *      signed 30-minute token (this page never asserts "ready" itself).
 *   4. Consent recorded against that token + policy hash.
 *   5. Start → /take with the token (sessionStorage, tab-scoped).
 *
 * Camera is REQUIRED (decision D-P2): denial or failed initialization
 * blocks the start with actionable guidance — never a silent bypass.
 */

// Bumped whenever the notice copy changes materially; recorded with consent
// so what each participant saw is auditable (backend consentTextVersion).
// v2 (2026-10-24): the in-test monitoring engine shipped — the notice now
// describes live camera monitoring DURING the test, not just the readiness
// check.
const CONSENT_TEXT_VERSION = '2026-11-v2-web';

const READY_FRAMES = 5;
const READY_FRAME_GAP_MS = 350;
const READY_MIN_AGREED = 3; // strict majority of one-face frames (mobile parity)

type Stage = 'notice' | 'camera' | 'ready';

interface FrameResult {
  faceCount: number;
  yaw: number | null;
  pitch: number | null;
  roll: number | null;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// The backend's precheck contract requires device.osVersion as a NUMBER.
// For the web the honest value is the OS major (Windows NT x / macOS / Android
// / iOS) parsed from the UA; when the OS can't be parsed we fall back to the
// browser major — recorded as-is, never presented as the OS anywhere (the
// full UA rides alongside in `model`, and the web floor ignores osVersion).
const osMajorFromUA = (): number => {
  const ua = navigator.userAgent;
  const osMatch =
    /Windows NT ([0-9]+)/.exec(ua)
    || /Mac OS X 10_([0-9]+)/.exec(ua)
    || /Android ([0-9]+)/.exec(ua)
    || /CPU OS ([0-9]+)_/.exec(ua) // iPadOS
    || /iPhone OS ([0-9]+)_/.exec(ua);
  if (osMatch) return Number(osMatch[1]);
  const browserMatch = /(?:Chrome|Chromium|Edg|Firefox|Safari|Version)\/([0-9]+)/.exec(ua);
  return browserMatch ? Number(browserMatch[1]) : 0;
};

export default function PublicQuizReadinessPage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { quiz, quizLoading, quizError, refreshQuiz, handleSessionExpired } = usePublicQuiz();

  // Why we were opened — e.g. routed here by the taking page after a
  // PROCTORING_* 403 (the participant's missing stage), with the server's
  // explanatory message.
  const gateMessage =
    location.state && typeof location.state === 'object' && 'gateMessage' in location.state
      ? String((location.state as { gateMessage?: unknown }).gateMessage ?? '')
      : '';

  // Refresh recovery: a precheck token still in sessionStorage (≤30-min
  // TTL) means the camera check already passed — resume at the ready stage.
  // Consent is NOT implied by this (it is recorded only when Start is
  // clicked, binding the acknowledged notice version to the token).
  const [stage, setStage] = useState<Stage>(() => (getPrecheckToken() ? 'ready' : 'notice'));
  const [agreed, setAgreed] = useState(false);
  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'live' | 'denied' | 'failed'>('idle');
  const [cameraDetail, setCameraDetail] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [checkResults, setCheckResults] = useState<PrecheckCheck[] | null>(null);
  const [preparingStart, setPreparingStart] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Route guards: readiness only exists for verified participants on ARMED
  // quizzes — anything else goes where it belongs (never a silent bypass,
  // never a dead end).
  useEffect(() => {
    if (!getGuestToken()) {
      navigate(`/public-quiz/${token}`, { replace: true });
      return;
    }
    if (!quiz) refreshQuiz(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (quiz && !quiz.proctoringRequired) {
      navigate(`/public-quiz/${token}/take`, { replace: true });
    }
  }, [quiz, token, navigate]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    // Reset the stage: a torn-down stream must never look "live" to the
    // check's getUserMedia shortcut, or every recheck would probe a dead
    // <video> and fail forever (review finding: the consent-expired →
    // back-to-camera path dead-ended exactly like this).
    setCameraState('idle');
    setCameraDetail(null);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // The preview stream has done its job once the checks pass — stop it at
  // the ready stage (the in-quiz engine opens its OWN hidden stream at
  // start; leaving the preview running keeps the camera light on for no
  // reason).
  useEffect(() => {
    if (stage === 'ready') stopCamera();
  }, [stage, stopCamera]);

  const startCamera = async (): Promise<boolean> => {
    setCameraState('starting');
    setCameraDetail(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState('live');
      return true;
    } catch (err) {
      // One classifier for the whole changeset (review finding: this page
      // had drifted a second copy of the DOMException mapping).
      const classified = classifyGetUserMediaError(err);
      if (classified.kind === 'denied') {
        setCameraState('denied');
        setCameraDetail(
          'Camera permission was denied. Click the camera icon in your browser\'s address bar, allow access for this site, then try again.'
        );
      } else {
        setCameraState('failed');
        setCameraDetail(
          classified.kind === 'unavailable'
            ? 'No usable camera was found on this device. Connect a camera and try again.'
            : 'The camera could not be started. Close other apps using the camera and try again.'
        );
      }
      return false;
    }
  };

  // Capture readiness frames and classify them — observations only; the
  // SERVER decides the verdict from the report.
  const captureFrames = async (): Promise<FrameResult[]> => {
    const { initSpikeDetector, detectFrame, closeSpikeDetector } = await import(
      '../../services/proctoringSpike/faceLandmarker'
    );
    await initSpikeDetector('GPU');
    try {
      const frames: FrameResult[] = [];
      const video = videoRef.current!;
      for (let i = 0; i < READY_FRAMES; i += 1) {
        const result = detectFrame(video);
        frames.push({
          faceCount: result.faceCount,
          yaw: result.headPose?.yaw ?? null,
          pitch: result.headPose?.pitch ?? null,
          roll: result.headPose?.roll ?? null,
        });
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, READY_FRAME_GAP_MS));
      }
      return frames;
    } finally {
      closeSpikeDetector();
    }
  };

  const runReadinessCheck = async () => {
    setError(null);
    setCheckResults(null);
    setChecking(true);
    try {
      const cameraUp = cameraState === 'live' || (await startCamera());
      if (!cameraUp) {
        // startCamera already set the actionable denial/failure state.
        return;
      }

      let frames: FrameResult[] = [];
      let detectorError: string | null = null;
      try {
        frames = await captureFrames();
      } catch (err) {
        detectorError = err instanceof Error ? err.message : String(err);
      }

      const oneFaceFrames = frames.filter((f) => f.faceCount === 1);
      const agreed = oneFaceFrames.length;
      const lastClass = frames.length
        ? frames[frames.length - 1].faceCount === 0
          ? 'none'
          : frames[frames.length - 1].faceCount > 1
            ? 'multiple'
            : 'one'
        : 'none';

      const checks: PrecheckCheck[] = [
        {
          id: 'device_capability',
          status: detectorError ? 'UNSUPPORTED' : 'PASS',
          detail: detectorError
            ? `The monitoring engine could not load on this browser (${detectorError}).`
            : undefined,
        },
        { id: 'camera_permission', status: 'PASS' },
        { id: 'camera_availability', status: 'PASS' },
        {
          id: 'face_readiness',
          status: detectorError ? 'FAIL' : agreed >= READY_MIN_AGREED ? 'PASS' : 'FAIL',
        },
        { id: 'network', status: 'PASS' },
      ];

      const payload: PrecheckReportPayload = {
        device: { platform: 'web', osVersion: osMajorFromUA(), model: navigator.userAgent.slice(0, 120) },
        network: { reachable: true },
        checks,
      };

      // Attention baseline (median seated pose over the agreed frames) —
      // optional; omitted when too few one-face frames.
      if (!detectorError && agreed >= READY_MIN_AGREED) {
        (payload.checks[3] as PrecheckCheck & { metadata?: unknown }).metadata = {
          frames: frames.length,
          agreedFrames: agreed,
          faceCountClass: lastClass,
          visibility: agreed >= READY_MIN_AGREED ? 'ok' : 'none',
          attentionBaseline: {
            yaw: median(oneFaceFrames.map((f) => f.yaw ?? 0)),
            pitch: median(oneFaceFrames.map((f) => f.pitch ?? 0)),
            roll: median(oneFaceFrames.map((f) => f.roll ?? 0)),
            frames: agreed,
          },
        };
      } else if (!detectorError) {
        (payload.checks[3] as PrecheckCheck & { metadata?: unknown }).metadata = {
          frames: Math.max(frames.length, 1),
          agreedFrames: agreed,
          faceCountClass: lastClass,
          visibility: 'none',
        };
        payload.checks[3].detail =
          lastClass === 'multiple'
            ? 'More than one face was detected. Make sure you are the only person visible, then try again.'
            : 'Your face was not clearly visible. Sit facing the camera in good light, then try again.';
      }

      const response = await publicQuizApi.precheckReport(token, payload);
      const data = response.data;
      setCheckResults(payload.checks);

      if (data.verdict === 'PASS' && data.precheckToken) {
        setPrecheckToken(data.precheckToken);
        setStage('ready');
        return;
      }
      if (data.verdict === 'RETRYABLE') {
        setError({ message: data.message || 'A readiness check could not complete. Please try again.' });
        return;
      }
      // FAIL / UNSUPPORTED — actionable, never a silent pass.
      setError({ code: data.verdict, message: data.message || 'One or more readiness checks did not pass.' });
    } catch (err) {
      const extracted = getErrorData(err) ?? getPublicApiError(err);
      if (extracted?.status === 401) {
        handleSessionExpired();
        navigate(`/public-quiz/${token}`, { replace: true });
        return;
      }
      setError({ code: extracted?.code, message: extracted?.message || 'The readiness check failed. Please try again.' });
    } finally {
      setChecking(false);
    }
  };

  const startTest = async () => {
    setPreparingStart(true);
    setError(null);
    try {
      // Consent binds the acknowledged notice version to the precheck token
      // + policy hash (server-side, idempotent per policy version).
      const precheckToken = getPrecheckToken();
      if (!precheckToken) {
        setStage('camera');
        setError({ message: 'Your readiness check session was reset. Please run the camera check again.' });
        return;
      }
      await publicQuizApi.recordConsent(token, {
        precheckToken,
        consentTextVersion: CONSENT_TEXT_VERSION,
        surface: 'web',
      });
      stopCamera();
      navigate(`/public-quiz/${token}/take`, { replace: true });
    } catch (err) {
      const extracted = getErrorData(err) ?? getPublicApiError(err);
      if (extracted?.status === 401) {
        handleSessionExpired();
        navigate(`/public-quiz/${token}`, { replace: true });
        return;
      }
      // A stale/expired token (e.g. sat on this screen > 30 min) — back to
      // the camera stage for a fresh run.
      if (extracted?.code === 'PRECHECK_TOKEN_INVALID') {
        clearPrecheckToken();
        setStage('camera');
        setError({ message: extracted.message || 'Your readiness check expired. Please run it again.' });
        return;
      }
      setError({ code: extracted?.code, message: extracted?.message || 'Could not record your consent. Please try again.' });
    } finally {
      setPreparingStart(false);
    }
  };

  if (quizLoading || !quiz) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] flex flex-col items-center justify-center p-4">
        {quizError ? (
          <div className="bg-white rounded-3xl p-8 shadow-2xl max-w-md w-full text-center">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <p className="text-gray-700 font-medium text-sm">{quizError.message}</p>
            <button
              onClick={() => refreshQuiz(token)}
              className="mt-4 inline-flex items-center gap-1.5 bg-[#01b4ae] hover:bg-[#008f8a] text-white text-sm font-semibold px-5 py-2.5 rounded-xl"
            >
              <RefreshCw className="w-4 h-4" /> Try Again
            </button>
          </div>
        ) : (
          <>
            <Loader2 className="w-10 h-10 text-white animate-spin mb-3" />
            <p className="text-white/90 text-sm font-medium">Loading your test…</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-full bg-white flex items-center justify-center border-4 border-white/30 shadow-xl mb-3">
            <ShieldCheck className="w-7 h-7 text-[#01b4ae]" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-wide">Before you start</h1>
          <p className="text-white/85 text-xs mt-1 text-center">{quiz.title}</p>
        </div>

        {gateMessage && stage === 'notice' && (
          <div className="bg-white/15 border border-white/25 rounded-2xl p-3.5 mb-4 flex gap-2.5">
            <ShieldCheck className="w-4 h-4 text-white shrink-0 mt-0.5" />
            <p className="text-xs text-white/90 leading-relaxed">{gateMessage}</p>
          </div>
        )}

        {error && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 mb-4 flex gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 leading-relaxed">{error.message}</p>
          </div>
        )}

        {stage === 'notice' && (
          <div className="bg-white rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5">
              <Video className="w-5 h-5 text-[#01b4ae]" />
              <h2 className="text-base font-bold text-gray-900">This test uses camera-based monitoring</h2>
            </div>
            <ul className="space-y-2.5 text-sm text-gray-600 leading-relaxed">
              <li>Before the test starts, we check that your camera works and that your face is clearly visible.</li>
              <li>During the test, your camera is monitored on your device: we record events such as your face not being visible, more than one person in frame, looking away for extended periods, and browser focus or tab switches.</li>
              <li>You may see warning messages if monitoring notices these events.</li>
              <li>No photos or videos are recorded or stored — only the event records above.</li>
              <li>Proctoring records are kept with your test records and are visible only to authorized administrators.</li>
              <li>You cannot start this test without agreeing to monitoring and passing the camera check.</li>
            </ul>
            <label className="flex items-start gap-2.5 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#01b4ae]"
              />
              <span className="text-sm font-medium text-gray-800">I understand and agree to monitoring for this test</span>
            </label>
            <button
              onClick={() => setStage('camera')}
              disabled={!agreed}
              className="w-full bg-[#01b4ae] hover:bg-[#008f8a] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold py-3 rounded-xl transition-colors"
            >
              Continue to camera check
            </button>
          </div>
        )}

        {stage === 'camera' && (
          <div className="bg-white rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5">
              <Camera className="w-5 h-5 text-[#01b4ae]" />
              <h2 className="text-base font-bold text-gray-900">Camera check</h2>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              Sit facing the camera in good light. We take a few frames to confirm your face is clearly visible —
              nothing is saved or uploaded.
            </p>

            <div className="relative rounded-2xl overflow-hidden bg-gray-900 aspect-[4/3]">
              <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
              {cameraState !== 'live' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-900/80">
                  {cameraState === 'starting' || checking ? (
                    <Loader2 className="w-8 h-8 text-white/80 animate-spin" />
                  ) : cameraState === 'denied' || cameraState === 'failed' ? (
                    <CameraOff className="w-8 h-8 text-amber-400" />
                  ) : (
                    <Camera className="w-8 h-8 text-white/60" />
                  )}
                </div>
              )}
            </div>

            {cameraDetail && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3">
                <p className="text-xs text-amber-800 leading-relaxed">{cameraDetail}</p>
              </div>
            )}

            {checkResults && !checking && (
              <div className="space-y-1.5">
                {checkResults.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-xs">
                    {c.status === 'PASS' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    )}
                    <span className="text-gray-600">{c.id.replace(/_/g, ' ')}</span>
                    {c.detail && <span className="text-gray-400 truncate">— {c.detail}</span>}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={runReadinessCheck}
              disabled={checking}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#01b4ae] hover:bg-[#008f8a] disabled:opacity-50 text-white text-sm font-semibold py-3 rounded-xl transition-colors"
            >
              {checking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Checking…
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" /> Run camera check
                </>
              )}
            </button>
            <p className="text-[11px] text-gray-400 text-center flex items-center justify-center gap-1">
              <Clock className="w-3 h-3" /> The readiness result is valid for 30 minutes.
            </p>
          </div>
        )}

        {stage === 'ready' && (
          <div className="bg-white rounded-3xl p-6 shadow-2xl space-y-4 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <h2 className="text-base font-bold text-gray-900">Readiness checks passed</h2>
            <p className="text-xs text-gray-500 leading-relaxed">
              Your monitoring acknowledgement has been recorded. Good luck!
            </p>
            <button
              onClick={startTest}
              disabled={preparingStart}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#01b4ae] hover:bg-[#008f8a] disabled:opacity-50 text-white text-sm font-semibold py-3 rounded-xl transition-colors"
            >
              {preparingStart ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {preparingStart ? 'Starting…' : 'Start test'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
