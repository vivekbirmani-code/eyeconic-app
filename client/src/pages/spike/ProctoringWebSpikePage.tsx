/**
 * Phase 0 browser CV spike — live readout page (DEV-ONLY).
 *
 * Reached at /spike/proctoring in the dev server; the route is registered
 * only when import.meta.env.DEV, so this page (and its MediaPipe import)
 * never enters a production bundle. The page answers the spike questions
 * from docs/web-cv-spike-report.md with numbers: sustained FPS, detector
 * load time, per-frame latency, face count and head pose — plus a scenario
 * label so the recorded log maps readings to the protocol's scenarios.
 *
 * No pixels ever leave the browser: the video element and every detection
 * result stay on this page; the only output is the exportable JSON log.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  closeSpikeDetector,
  detectFrame,
  initSpikeDetector,
  type DetectorDelegate,
  type SpikeDetectorInit,
} from '../../services/proctoringSpike/faceLandmarker';

const PACING_OPTIONS_MS = [150, 250, 500, 1000];
const FPS_WINDOW_MS = 10_000; // sustained-FPS window (mobile spike used 10 min soaks; this is the live readout)
const LATENCY_MEDIAN_N = 20;
const LOG_INTERVAL_MS = 1000;

interface LogRow {
  t: string;
  s: string; // scenario label
  fps: number;
  faces: number;
  yaw: number | null;
  pitch: number | null;
  roll: number | null;
  latencyMs: number;
}

type CamStatus = 'idle' | 'starting' | 'live' | 'error';
type DetStatus = 'idle' | 'loading' | 'ready' | 'error';

const SCENARIOS = [
  'normal-seating',
  'glasses',
  'dim-room',
  'bright-backlight',
  'face-partial',
  'second-person',
  'no-face',
  'camera-covered',
  'aim-small',
  'aim-medium',
  'aim-large',
  'aim-shoulder',
] as const;

export default function ProctoringWebSpikePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopTimerRef = useRef<number | null>(null);
  const logTimerRef = useRef<number | null>(null);
  const frameTimesRef = useRef<number[]>([]);
  const latenciesRef = useRef<number[]>([]);
  const lastRowRef = useRef<LogRow | null>(null);
  const scenarioRef = useRef<string>('normal-seating');
  const sessionStartRef = useRef<number>(0);
  const frameCountRef = useRef(0);

  const [camStatus, setCamStatus] = useState<CamStatus>('idle');
  const [camError, setCamError] = useState<string | null>(null);
  const [detStatus, setDetStatus] = useState<DetStatus>('idle');
  const [detError, setDetError] = useState<string | null>(null);
  const [initInfo, setInitInfo] = useState<SpikeDetectorInit | null>(null);
  const [delegate, setDelegate] = useState<DetectorDelegate>('GPU');
  const [pacingMs, setPacingMs] = useState(250);
  const [running, setRunning] = useState(false);
  const [scenario, setScenario] = useState<string>('normal-seating');
  const [rows, setRows] = useState<LogRow[]>([]);

  const median = (xs: number[]) =>
    xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

  const stopTimers = useCallback(() => {
    if (loopTimerRef.current !== null) {
      window.clearInterval(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    if (logTimerRef.current !== null) {
      window.clearInterval(logTimerRef.current);
      logTimerRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCamStatus('starting');
    setCamError(null);
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
      setCamStatus('live');
    } catch (err) {
      setCamStatus('error');
      setCamError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    }
  }, []);

  const stopCamera = useCallback(() => {
    stopTimers();
    setRunning(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamStatus('idle');
  }, [stopTimers]);

  const initDetector = useCallback(async () => {
    setDetStatus('loading');
    setDetError(null);
    try {
      const info = await initSpikeDetector(delegate);
      setInitInfo(info);
      setDetStatus('ready');
    } catch (err) {
      setDetStatus('error');
      setDetError(err instanceof Error ? err.message : String(err));
    }
  }, [delegate]);

  const startSession = useCallback(() => {
    const video = videoRef.current;
    if (!video || detStatus !== 'ready') return;
    frameTimesRef.current = [];
    latenciesRef.current = [];
    frameCountRef.current = 0;
    sessionStartRef.current = performance.now();
    setRows([]);
    setRunning(true);

    const tick = () => {
      if (video.readyState < 2) return; // no frame yet
      try {
        const result = detectFrame(video);
        frameCountRef.current += 1;
        const now = result.atMs;
        frameTimesRef.current.push(now);
        while (frameTimesRef.current.length > 0 && now - frameTimesRef.current[0] > FPS_WINDOW_MS) {
          frameTimesRef.current.shift();
        }
        latenciesRef.current.push(result.latencyMs);
        if (latenciesRef.current.length > LATENCY_MEDIAN_N) latenciesRef.current.shift();
        lastRowRef.current = {
          t: new Date().toISOString(),
          s: scenarioRef.current,
          fps: frameTimesRef.current.length / (FPS_WINDOW_MS / 1000),
          faces: result.faceCount,
          yaw: result.headPose?.yaw ?? null,
          pitch: result.headPose?.pitch ?? null,
          roll: result.headPose?.roll ?? null,
          latencyMs: result.latencyMs,
        };
      } catch (err) {
        setDetError(err instanceof Error ? err.message : String(err));
      }
    };

    loopTimerRef.current = window.setInterval(tick, pacingMs);
    logTimerRef.current = window.setInterval(() => {
      const row = lastRowRef.current;
      if (!row) return;
      setRows((prev) => [...prev.slice(-3600), row]); // ~1h at 1 row/s
    }, LOG_INTERVAL_MS);
  }, [detStatus, pacingMs]);

  const stopSession = useCallback(() => {
    stopTimers();
    setRunning(false);
  }, [stopTimers]);

  // Repace the loop interval when pacing changes mid-session.
  useEffect(() => {
    if (running) {
      stopSession();
      startSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacingMs]);

  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  useEffect(
    () => () => {
      stopTimers();
      closeSpikeDetector();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [stopTimers],
  );

  const exportLog = useCallback(() => {
    const header = {
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGB: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
      delegate,
      pacingMs,
      initInfo,
      sessionSeconds:
        sessionStartRef.current > 0
          ? Math.round((performance.now() - sessionStartRef.current) / 1000)
          : null,
      totalFrames: frameCountRef.current,
    };
    const blob = new Blob([JSON.stringify({ header, rows }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `web-cv-spike-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [delegate, pacingMs, initInfo]);

  const last = lastRowRef.current;
  const sessionSeconds =
    running && sessionStartRef.current > 0
      ? Math.round((performance.now() - sessionStartRef.current) / 1000)
      : null;
  const medianLatency = median(latenciesRef.current);

  const readout = (label: string, value: string) => (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="font-mono text-lg text-gray-900">{value}</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <header>
          <h1 className="text-xl font-semibold text-gray-900">
            Phase 0 — Browser CV spike (dev-only)
          </h1>
          <p className="text-sm text-gray-600">
            MediaPipe FaceLandmarker viability harness. Protocol &amp; acceptance criteria:{' '}
            <code>docs/web-cv-spike-report.md</code>. Nothing leaves this browser except the JSON
            log you export.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <video
              ref={videoRef}
              muted
              playsInline
              className="aspect-[4/3] w-full rounded-lg bg-black object-cover"
            />
            <div className="flex flex-wrap gap-2">
              {camStatus !== 'live' ? (
                <button
                  onClick={startCamera}
                  disabled={camStatus === 'starting'}
                  className="rounded-md bg-[#01b4ae] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {camStatus === 'starting' ? 'Starting…' : 'Start camera'}
                </button>
              ) : (
                <button
                  onClick={stopCamera}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700"
                >
                  Stop camera
                </button>
              )}
              <select
                value={delegate}
                onChange={(e) => setDelegate(e.target.value as DetectorDelegate)}
                disabled={detStatus === 'loading' || running}
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="GPU">delegate: GPU</option>
                <option value="CPU">delegate: CPU</option>
              </select>
              <button
                onClick={initDetector}
                disabled={camStatus !== 'live' || detStatus === 'loading' || running}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {detStatus === 'loading' ? `Loading ${delegate}…` : 'Init detector'}
              </button>
              {!running ? (
                <button
                  onClick={startSession}
                  disabled={detStatus !== 'ready' || camStatus !== 'live'}
                  className="rounded-md bg-[#01b4ae] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Start session
                </button>
              ) : (
                <button
                  onClick={stopSession}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white"
                >
                  Stop session
                </button>
              )}
              <select
                value={pacingMs}
                onChange={(e) => setPacingMs(Number(e.target.value))}
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
              >
                {PACING_OPTIONS_MS.map((ms) => (
                  <option key={ms} value={ms}>
                    pacing {ms}ms
                  </option>
                ))}
              </select>
              <button
                onClick={exportLog}
                disabled={rows.length === 0}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
              >
                Export JSON log
              </button>
            </div>
            {(camError || detError) && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {camError ?? detError}
              </p>
            )}
            <p className="text-xs text-gray-500">
              cam: {camStatus} · detector: {detStatus}
              {initInfo ? ` (loaded in ${initInfo.loadMs}ms, ${initInfo.delegate})` : ''} ·
              session: {sessionSeconds !== null ? `${sessionSeconds}s` : '—'}
            </p>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {readout('FPS (10s window)', last ? last.fps.toFixed(1) : '—')}
              {readout('Faces', last ? String(last.faces) : '—')}
              {readout('Latency ms', medianLatency ? medianLatency.toFixed(1) : '—')}
              {readout('Yaw °', last?.yaw != null ? last.yaw.toFixed(1) : '—')}
              {readout('Pitch °', last?.pitch != null ? last.pitch.toFixed(1) : '—')}
              {readout('Roll °', last?.roll != null ? last.roll.toFixed(1) : '—')}
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Scenario label (stamps the log)
              </div>
              <div className="flex flex-wrap gap-1">
                {SCENARIOS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setScenario(s)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      scenario === s
                        ? 'bg-[#01b4ae] text-white'
                        : 'border border-gray-300 bg-white text-gray-600'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Live log (1 row/s, latest 12)
              </div>
              <div className="max-h-56 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5 text-gray-700">
                {rows.length === 0 && <div className="text-gray-400">no rows yet</div>}
                {[...rows]
                  .slice(-12)
                  .reverse()
                  .map((r, i) => (
                    <div key={i}>
                      {r.t.slice(11, 19)} {r.s.padEnd(16)} fps={r.fps.toFixed(1)} f={r.faces}{' '}
                      y={r.yaw ?? '—'} p={r.pitch ?? '—'} r={r.roll ?? '—'} l={r.latencyMs}
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
