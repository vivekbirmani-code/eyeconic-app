/**
 * PHASE 0 CV/ML FEASIBILITY SPIKE — ISOLATED TEST SURFACE (AI Proctoring plan §5).
 *
 * This is NOT production proctoring UI. It exists only to validate, on real
 * Android devices, whether the selected CV approach (ML Kit face detection via
 * the local `modules/proctoring-spike` Expo module, fed by expo-camera
 * snapshots) can support the V1 proctoring architecture. Everything here is
 * throwaway instrumentation: debug metrics, manual scenario labeling, and a
 * clipboard export for the Phase 0 report. No images are stored, saved, or
 * transmitted — frames live in memory for one detect call and are discarded.
 *
 * Reachable ONLY in development builds (__DEV__ entry chip in the Tests tab);
 * not linked from any production navigation.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { usePreventScreenCapture } from 'expo-screen-capture';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { Camera, ClipboardCopy, Play, RotateCcw, Square } from 'lucide-react-native';

import { ScreenContainer } from '../../../components/layout/ScreenContainer';
import {
  getProctoringCameraView,
  getProctoringSpikeInfo,
  isProctoringSpikeNativeAvailable,
  nativeDetectFaces,
} from '../../../modules/proctoring-spike/src';
import { CameraLoop } from '../../../services/proctoringSpike/cameraLoop';
import { classifyFrame, DEFAULT_CLASSIFY_THRESHOLDS } from '../../../services/proctoringSpike/classifyFrame';
import { SpikeMetricsTracker } from '../../../services/proctoringSpike/metricsTracker';
import { runScenarioReplay } from '../../../services/proctoringSpike/replay';
import { REPLAY_FRAMES_C2 } from '../../../services/proctoringSpike/replayData/c2';
import { REPLAY_FRAMES_D3 } from '../../../services/proctoringSpike/replayData/d3';
import {
  SPIKE_SCENARIOS,
  type ScenarioRunSummary,
  type SpikeEngineStatus,
  type SpikeFrameResult,
  type SpikeMetricsSummary,
  type SpikeNativeDetectResult,
} from '../../../services/proctoringSpike/types';

type PacingMode = 'max' | '1.5s' | '3s';

const PACING_MS: Record<PacingMode, number> = { max: 0, '1.5s': 1500, '3s': 3000 };

/** Conditional screen-capture prevention (D13 feasibility check). */
function ScreenCaptureGuard({ active }: { active: boolean }) {
  if (!active) return null;
  return <ScreenCaptureActive />;
}
function ScreenCaptureActive() {
  usePreventScreenCapture('proctoring-spike');
  return null;
}

function fmtMs(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)} ms`;
}

function fmtFps(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

function StatusPill({ status }: { status: SpikeEngineStatus | 'permission' | 'module' }) {
  const color =
    status === 'running'
      ? '#10B981'
      : status === 'degraded' || status === 'camera-error' || status === 'native-unavailable'
        ? '#F59E0B'
        : status === 'permission'
          ? '#EF4444'
          : '#64748B';
  return (
    <View style={[styles.pill, { backgroundColor: `${color}1A`, borderColor: `${color}55` }]}>
      <Text style={[styles.pillText, { color }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export default function ProctoringSpikeScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const moduleInfo = useMemo(() => getProctoringSpikeInfo(), []);
  const moduleAvailable = isProctoringSpikeNativeAvailable();

  const cameraRef = useRef<CameraView | null>(null);
  const loopRef = useRef<CameraLoop | null>(null);
  const trackerRef = useRef<SpikeMetricsTracker>(new SpikeMetricsTracker());

  // ===== Track 2 — streaming source (CameraX ImageAnalysis via the native
  // view). The SAME tracker/scenario/export tooling measures both transports
  // so runbook numbers stay comparable across the Phase 0 tables. =====
  const StreamingCameraView = useMemo(
    () => (Platform.OS === 'android' ? getProctoringCameraView() : null),
    []
  );
  const [sourceMode, setSourceMode] = useState<'snapshot' | 'streaming'>('snapshot');
  const [streamRunning, setStreamRunning] = useState(false);
  const [streamPaused, setStreamPaused] = useState(false);
  const streamFrameIndexRef = useRef(0);

  const handleStreamObservation = useCallback((payload: SpikeNativeDetectResult) => {
    const tracker = trackerRef.current;
    streamFrameIndexRef.current += 1;
    // Same sanitizer as the snapshot loop — capture/decode are ~0 by design.
    const frame = classifyFrame(
      { native: payload, captureMs: 0 },
      streamFrameIndexRef.current,
      payload.frameTimestampMs ?? Date.now(),
      DEFAULT_CLASSIFY_THRESHOLDS
    );
    tracker.push(frame);
    setLastFrame(frame);
    setSummary(tracker.summary());
  }, []);

  const handleStreamError = useCallback((error: { code: string; message: string }) => {
    trackerRef.current.recordError();
    setLastError(`stream:${error.code} — ${error.message}`);
  }, []);

  const [engineStatus, setEngineStatus] = useState<SpikeEngineStatus | 'permission' | 'module'>(
    moduleAvailable ? 'idle' : 'native-unavailable'
  );
  const [lastFrame, setLastFrame] = useState<SpikeFrameResult | null>(null);
  const [summary, setSummary] = useState<SpikeMetricsSummary | null>(null);
  const [pacing, setPacing] = useState<PacingMode>('max');
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [scenarioRuns, setScenarioRuns] = useState<ScenarioRunSummary[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [preventCapture, setPreventCapture] = useState(false);
  const [copied, setCopied] = useState(false);

  // Latest streaming-running flag for the AppState listener (no re-subscribe).
  const streamRunningRef = useRef(false);
  useEffect(() => {
    streamRunningRef.current = streamRunning;
  }, [streamRunning]);

  // Pause/resume the loop on app background/foreground transitions
  // (lifecycle behavior is itself a Phase 0 test item).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const loop = loopRef.current;
      if (loop) {
        if (state === 'active') {
          loop.resume();
        } else {
          loop.pause();
        }
      }
      if (streamRunningRef.current) {
        setStreamPaused(state !== 'active');
      }
    });
    return () => subscription.remove();
  }, []);

  // Tear everything down on unmount.
  useEffect(() => {
    return () => {
      loopRef.current?.stop();
      loopRef.current = null;
    };
  }, []);

  const startLoop = useCallback(() => {
    if (loopRef.current) return;
    const tracker = trackerRef.current;
    const loop = new CameraLoop({
      capture: async () => {
        const t0 = Date.now();
        const picture = await cameraRef.current?.takePictureAsync({
          quality: 0.4,
          base64: true,
          // skipProcessing stays false so EXIF orientation is baked into the
          // JPEG — ML Kit receives an upright image.
        });
        return { base64: picture?.base64 ?? null, captureMs: Date.now() - t0 };
      },
      detect: (base64) => nativeDetectFaces(base64, { maxDim: 640 }),
      onFrame: (frame) => {
        tracker.push(frame);
        setLastFrame(frame);
        setSummary(tracker.summary());
        setEngineStatus((prev) => (prev === 'running' || prev === 'degraded' ? loopRef.current?.status ?? 'running' : prev));
      },
      onError: (error, consecutive) => {
        tracker.recordError();
        setLastError(`${error.message} (consecutive: ${consecutive})`);
      },
      onStatus: (status) => {
        setEngineStatus(status);
        if (status === 'running') setLastError(null);
      },
      minIntervalMs: PACING_MS[pacing],
      thresholds: DEFAULT_CLASSIFY_THRESHOLDS,
      maxDim: 640,
    });
    loopRef.current = loop;
    void loop.start();
  }, [pacing]);

  const stopLoop = useCallback((finishScenario: boolean) => {
    if (finishScenario && activeScenarioId) {
      const run = trackerRef.current.finishScenario();
      if (run) setScenarioRuns((prev) => [...prev, run]);
      setActiveScenarioId(null);
    }
    loopRef.current?.stop();
    loopRef.current = null;
    setEngineStatus('stopped');
  }, [activeScenarioId]);

  // Transport-agnostic start/stop: the Start/Stop buttons drive whichever
  // source is selected, and the scenario/export tooling is shared.
  const startAnalysis = useCallback(() => {
    if (sourceMode === 'streaming') {
      setStreamPaused(false);
      setStreamRunning(true); // mounts the native view → binds the camera
      setEngineStatus('running');
      setLastError(null);
      return;
    }
    startLoop();
  }, [sourceMode, startLoop]);

  const stopAnalysis = useCallback((finishScenario: boolean) => {
    if (sourceMode === 'streaming') {
      setStreamRunning(false); // unmounts the view → camera released
      setStreamPaused(false);
      setEngineStatus('stopped');
      if (finishScenario && activeScenarioId) {
        const run = trackerRef.current.finishScenario();
        if (run) setScenarioRuns((prev) => [...prev, run]);
        setActiveScenarioId(null);
      }
      return;
    }
    stopLoop(finishScenario);
  }, [sourceMode, stopLoop, activeScenarioId]);

  const startScenario = useCallback((scenarioId: string) => {
    const scenario = SPIKE_SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) return;
    // Finish any active run first so tallies never mix.
    const previous = trackerRef.current.finishScenario();
    if (previous) setScenarioRuns((prev) => [...prev, previous]);
    trackerRef.current.startScenario(scenario);
    setActiveScenarioId(scenarioId);
  }, []);

  const resetSession = useCallback(() => {
    trackerRef.current = new SpikeMetricsTracker();
    setScenarioRuns([]);
    setLastFrame(null);
    setSummary(null);
    setLastError(null);
    setStreamRunning(false);
    setStreamPaused(false);
    streamFrameIndexRef.current = 0;
  }, []);

  // ---- SYNTHETIC REPLAY (prerecorded footage through the same pipeline) ----
  const [replayStatus, setReplayStatus] = useState<string | null>(null);
  const [replayRunning, setReplayRunning] = useState(false);
  const replayRunningRef = useRef(false);

  const runReplay = useCallback(async (target: 'c2' | 'd3') => {
    if (replayRunningRef.current) return;
    replayRunningRef.current = true;
    setReplayRunning(true);
    setReplayStatus(`Replaying ${target.toUpperCase()}…`);
    try {
      const scenario = SPIKE_SCENARIOS.find((s) =>
        s.id === (target === 'c2' ? 'C_MULTI_FACE_2' : 'D_MULTI_FACE_3')
      );
      if (!scenario) throw new Error('scenario definition missing');
      const frames = target === 'c2' ? REPLAY_FRAMES_C2 : REPLAY_FRAMES_D3;
      if (frames.length === 0) {
        setReplayStatus(
          `No replay footage for ${target.toUpperCase()} — generate it first: node scripts/make-spike-replay.mjs <video.mp4|framesDir> ${target}, then reload Metro.`
        );
        return;
      }
      const result = await runScenarioReplay({
        scenario,
        base64Frames: frames,
        detect: (base64, maxDim) => nativeDetectFaces(base64, { maxDim }),
        onProgress: (done, total) =>
          setReplayStatus(`Replaying ${target.toUpperCase()}… ${done}/${total} frames`),
      });
      setScenarioRuns((prev) => [...prev, result.summary]);
      const episodes = result.summary.episodes;
      setReplayStatus(
        `${target.toUpperCase()} replay done · ${result.summary.frames}f · acc ` +
          `${result.summary.accuracy === null ? '—' : `${(result.summary.accuracy * 100).toFixed(0)}%`} · ` +
          `episodeDetected ${episodes.episodeDetected === null ? '—' : episodes.episodeDetected}` +
          (episodes.firstOpenLatencyMs !== null
            ? ` · first open ~${Math.round(episodes.firstOpenLatencyMs / 1000)}s`
            : '') +
          ` · unexpected ${episodes.unexpectedEpisodeOpens}`
      );
    } catch (error: any) {
      setReplayStatus(`Replay failed: ${error?.message ?? String(error)}`);
    } finally {
      replayRunningRef.current = false;
      setReplayRunning(false);
    }
  }, []);

  const copyResults = useCallback(async () => {
    const payload = {
      phase: 'phase-0-spike',
      // Transport label — snapshot (Phase 0 stills) vs streaming (Track 2
      // CameraX ImageAnalysis). Runbook tables keep the runs separable.
      source: sourceMode,
      module: moduleInfo,
      thresholds: DEFAULT_CLASSIFY_THRESHOLDS,
      summary,
      scenarioRuns,
      lastFrame: lastFrame
        ? {
            faceCountClass: lastFrame.faceCountClass,
            visibility: lastFrame.visibility,
            headPose: lastFrame.headPose,
            landmarkCount: lastFrame.landmarkCount,
            qualityProxy: lastFrame.qualityProxy,
            latencies: lastFrame.latencies,
            sanitized: lastFrame.sanitized,
          }
        : null,
      copiedAt: new Date().toISOString(),
    };
    await Clipboard.setStringAsync(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [moduleInfo, summary, scenarioRuns, lastFrame, sourceMode]);

  const running = engineStatus === 'running' || engineStatus === 'degraded';
  const activeScenario = SPIKE_SCENARIOS.find((s) => s.id === activeScenarioId) ?? null;
  const peek = activeScenario ? trackerRef.current.peekScenario() : null;

  return (
    <ScreenContainer style={styles.container}>
      <ScreenCaptureGuard active={preventCapture} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Phase 0 · CV Spike</Text>
            <Text style={styles.subtitle}>
              {moduleInfo
                ? `${moduleInfo.tier} · ML Kit ${moduleInfo.mlkitVersion}`
                : 'native module unavailable'}
            </Text>
          </View>
          <StatusPill status={engineStatus} />
        </View>
        <Pressable style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>← Back</Text>
        </Pressable>

        {/* Permission gate */}
        {permission === null ? (
          <View style={styles.card}>
            <ActivityIndicator color="#01b4ae" />
            <Text style={styles.cardText}>Checking camera permission…</Text>
          </View>
        ) : !permission.granted ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Camera permission required</Text>
            <Text style={styles.cardText}>
              {permission.canAskAgain
                ? 'Grant camera access to run the spike.'
                : 'Camera permission was permanently denied. Enable it in system settings, then return.'}
            </Text>
            {permission.canAskAgain && (
              <Pressable style={styles.primaryButton} onPress={() => requestPermission()}>
                <Camera color="#FFF" size={16} />
                <Text style={styles.primaryButtonText}>Grant permission</Text>
              </Pressable>
            )}
          </View>
        ) : !moduleAvailable ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Native spike module not loaded</Text>
            <Text style={styles.cardText}>
              The ML Kit wrapper only loads in an Android development build with the{' '}
              {'`modules/proctoring-spike`'} Expo module autolinked. Expo Go cannot run this spike.
            </Text>
          </View>
        ) : (
          <>
            {/* Source mode — snapshot (Phase 0) vs streaming (Track 2) */}
            <View style={styles.controlsRow}>
              <Pressable
                style={[styles.pacingButton, sourceMode === 'snapshot' && styles.pacingActive]}
                onPress={() => {
                  if (running) return;
                  setSourceMode('snapshot');
                }}
              >
                <Text style={styles.pacingText}>Snapshot</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.pacingButton,
                  sourceMode === 'streaming' && styles.pacingActive,
                  (!StreamingCameraView || running) && styles.pacingDisabled,
                ]}
                disabled={!StreamingCameraView || running}
                onPress={() => setSourceMode('streaming')}
              >
                <Text style={styles.pacingText}>
                  {StreamingCameraView ? 'Streaming' : 'Streaming (Android only)'}
                </Text>
              </Pressable>
            </View>

            {/* Camera preview */}
            <View style={styles.cameraWrap}>
              {sourceMode === 'streaming' ? (
                streamRunning && StreamingCameraView ? (
                  <StreamingCameraView
                    style={styles.camera}
                    paused={streamPaused}
                    minIntervalMs={PACING_MS[pacing]}
                    onFrameObservation={(event) => handleStreamObservation(event.nativeEvent)}
                    onCameraError={(event) => handleStreamError(event.nativeEvent)}
                  />
                ) : (
                  <View style={styles.camera} accessibilityLabel="Streaming preview placeholder">
                    <Text style={styles.previewPlaceholder}>
                      Streaming view mounts on Start (Track 2 — CameraX ImageAnalysis)
                    </Text>
                  </View>
                )
              ) : (
                <CameraView
                  ref={cameraRef}
                  style={styles.camera}
                  facing="front"
                  mode="picture"
                />
              )}
              <View style={styles.previewBadge}>
                <Text style={styles.previewBadgeText}>
                  {lastFrame
                    ? `${lastFrame.faceCountClass} · ${lastFrame.visibility} · pose ${lastFrame.headPose.band}`
                    : 'preview — start analysis'}
                </Text>
              </View>
            </View>

            {/* Controls */}
            <View style={styles.controlsRow}>
              {!running ? (
                <Pressable style={styles.primaryButton} onPress={startAnalysis}>
                  <Play color="#FFF" size={16} />
                  <Text style={styles.primaryButtonText}>Start</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.stopButton} onPress={() => stopAnalysis(true)}>
                  <Square color="#FFF" size={16} />
                  <Text style={styles.primaryButtonText}>Stop</Text>
                </Pressable>
              )}
              <Pressable
                style={[styles.pacingButton, pacing === 'max' && styles.pacingActive]}
                onPress={() => setPacing('max')}
              >
                <Text style={styles.pacingText}>Max</Text>
              </Pressable>
              <Pressable
                style={[styles.pacingButton, pacing === '1.5s' && styles.pacingActive]}
                onPress={() => setPacing('1.5s')}
              >
                <Text style={styles.pacingText}>1.5s</Text>
              </Pressable>
              <Pressable
                style={[styles.pacingButton, pacing === '3s' && styles.pacingActive]}
                onPress={() => setPacing('3s')}
              >
                <Text style={styles.pacingText}>3s</Text>
              </Pressable>
            </View>

            {/* Live metrics */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Live metrics</Text>
              <MetricRow label="Faces / visibility" value={lastFrame ? `${lastFrame.faceCountClass} / ${lastFrame.visibility}` : '—'} />
              <MetricRow label="Quality proxy (0–1)" value={lastFrame ? lastFrame.qualityProxy.toFixed(2) : '—'} />
              <MetricRow label="Landmarks (of 10)" value={lastFrame ? String(lastFrame.landmarkCount) : '—'} />
              <MetricRow
                label="Head pose (yaw/pitch/roll)"
                value={
                  lastFrame
                    ? `${fmtNum(lastFrame.headPose.yaw)}/${fmtNum(lastFrame.headPose.pitch)}/${fmtNum(lastFrame.headPose.roll)} (${lastFrame.headPose.band})`
                    : '—'
                }
              />
              <MetricRow label="Capture / decode / inference" value={
                lastFrame
                  ? `${Math.round(lastFrame.latencies.captureMs)} / ${Math.round(lastFrame.latencies.decodeMs)} / ${Math.round(lastFrame.latencies.inferenceMs)} ms`
                  : '—'
              } />
              <MetricRow label="Effective analysis FPS" value={fmtFps(summary?.effectiveFps ?? null)} />
              <MetricRow
                label="FPS · mean / p95 inter-frame"
                value={`${fmtMs(summary?.interFrameMs.mean ?? null)} / ${fmtMs(summary?.interFrameMs.p95 ?? null)}`}
              />
              <MetricRow
                label="Inference · mean / p95"
                value={`${fmtMs(summary?.latency.inferenceMs.mean ?? null)} / ${fmtMs(summary?.latency.inferenceMs.p95 ?? null)}`}
              />
              <MetricRow
                label="Frames / errors / sanitized"
                value={`${summary?.frames ?? 0} / ${summary?.errors ?? 0} / ${summary?.sanitizedFrames ?? 0}`}
              />
              <MetricRow
                label="Class counts (none/one/multi)"
                value={summary ? `${summary.byFaceCountClass.none}/${summary.byFaceCountClass.one}/${summary.byFaceCountClass.multiple}` : '—'}
              />
              {lastError ? <Text style={styles.errorText}>Last error: {lastError}</Text> : null}
              {lastFrame?.sanitized ? (
                <Text style={styles.warnText}>Malformed detector output sanitized on the last frame.</Text>
              ) : null}
            </View>

            {/* Scenario labeling */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Controlled scenario suite</Text>
              <Text style={styles.cardText}>
                Set up the scene, pick its label, run ≥ 15–20 frames, then switch or finish.
              </Text>
              <View style={styles.scenarioGrid}>
                {SPIKE_SCENARIOS.map((scenario) => {
                  const active = activeScenarioId === scenario.id;
                  return (
                    <Pressable
                      key={scenario.id}
                      style={[styles.scenarioChip, active && styles.scenarioChipActive]}
                      onPress={() => startScenario(scenario.id)}
                    >
                      <Text style={[styles.scenarioChipText, active && styles.scenarioChipTextActive]}>
                        {scenario.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {activeScenario && peek ? (
                <View style={styles.scenarioLive}>
                  <Text style={styles.scenarioLiveText}>
                    {activeScenario.id}: {peek.frames} frames · acc{' '}
                    {peek.accuracy === null ? '—' : `${(peek.accuracy * 100).toFixed(0)}%`} · FP{' '}
                    {peek.falsePositives} · FN {peek.falseNegatives}
                  </Text>
                </View>
              ) : null}
              {scenarioRuns.length > 0 ? (
                <View style={styles.runsTable}>
                  {scenarioRuns.map((run, i) => (
                    <Text key={`${run.scenarioId}-${i}`} style={styles.runRow}>
                      {run.scenarioId}
                      {run.source === 'replay' ? ' (REPLAY)' : ''}: {run.frames}f · acc{' '}
                      {run.accuracy === null ? '—' : `${(run.accuracy * 100).toFixed(0)}%`} · FP{' '}
                      {run.falsePositives} · FN {run.falseNegatives}
                      {run.multiFaceFalsePositives > 0 ? ` · multi-FP ${run.multiFaceFalsePositives}` : ''}
                      {run.episodes?.episodeDetected !== undefined && run.episodes?.episodeDetected !== null
                        ? ` · episode ${run.episodes.episodeDetected ? 'YES' : 'no'}`
                        : ''}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>

            {/* Replay validation (SYNTHETIC — prerecorded footage, no camera) */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Replay validation (SYNTHETIC)</Text>
              <Text style={styles.cardText}>
                Runs prerecorded 2/3-person footage through the SAME detector + episode
                pipeline, with device-cadence timestamps (no camera). Results are labeled
                as replay runs and reported separately from live data. Generate footage
                on the PC first: node scripts/make-spike-replay.mjs &lt;video.mp4 | framesDir&gt; c2|d3.
              </Text>
              <View style={styles.scenarioGrid}>
                <Pressable
                  style={[styles.scenarioChip, replayRunning && styles.scenarioChipActive]}
                  disabled={replayRunning}
                  onPress={() => void runReplay('c2')}
                >
                  <Text style={styles.scenarioChipText}>Replay C · 2 people ({REPLAY_FRAMES_C2.length}f)</Text>
                </Pressable>
                <Pressable
                  style={[styles.scenarioChip, replayRunning && styles.scenarioChipActive]}
                  disabled={replayRunning}
                  onPress={() => void runReplay('d3')}
                >
                  <Text style={styles.scenarioChipText}>Replay D · 3 people ({REPLAY_FRAMES_D3.length}f)</Text>
                </Pressable>
              </View>
              {replayRunning ? <ActivityIndicator size="small" color="#2563EB" style={{ marginTop: 8 }} /> : null}
              {replayStatus ? <Text style={styles.scenarioLiveText}>{replayStatus}</Text> : null}
            </View>

            {/* Screen-capture prevention (D13 feasibility toggle) */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Screen-capture prevention (D13 check)</Text>
              <Text style={styles.cardText}>
                Toggle ON, then try a screenshot / check the app switcher. Android should block both;
                iOS cannot block screenshots. This is a manual feasibility check — record the result.
              </Text>
              <Pressable
                style={[styles.toggleButton, preventCapture && styles.toggleActive]}
                onPress={() => setPreventCapture((v) => !v)}
              >
                <Text style={[styles.toggleText, preventCapture && styles.toggleTextActive]}>
                  {preventCapture ? 'Prevention ACTIVE' : 'Prevention OFF'}
                </Text>
              </Pressable>
            </View>

            {/* Session actions */}
            <View style={styles.controlsRow}>
              <Pressable style={styles.secondaryButton} onPress={copyResults}>
                <ClipboardCopy color="#01b4ae" size={16} />
                <Text style={styles.secondaryButtonText}>{copied ? 'Copied!' : 'Copy results JSON'}</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={resetSession}>
                <RotateCcw color="#01b4ae" size={16} />
                <Text style={styles.secondaryButtonText}>Reset session</Text>
              </Pressable>
            </View>
          </>
        )}
        <Text style={styles.footer}>
          Phase 0 spike surface — throwaway instrumentation, not production proctoring UI. Frames are
          processed in memory only; nothing is stored or uploaded.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

function fmtNum(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}°`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '700', color: '#0F172A' },
  subtitle: { fontSize: 13, color: '#64748B', marginTop: 2 },
  backLink: { marginTop: 6, alignSelf: 'flex-start' },
  backLinkText: { color: '#01b4ae', fontSize: 14, fontWeight: '600' },
  pill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  cameraWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    marginTop: 12,
  },
  camera: { width: '100%', aspectRatio: 3 / 4 },
  previewBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    backgroundColor: 'rgba(15,23,42,0.7)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  previewBadgeText: { color: '#FFF', fontSize: 12 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  primaryButton: {
    backgroundColor: '#01b4ae',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  primaryButtonText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  stopButton: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pacingButton: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFF',
  },
  pacingActive: { borderColor: '#01b4ae', backgroundColor: '#F0FDFA' },
  pacingDisabled: { opacity: 0.4 },
  previewPlaceholder: {
    color: '#9CA3AF',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  pacingText: { color: '#0F172A', fontSize: 13, fontWeight: '600' },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(1,180,174,0.15)',
    padding: 14,
    marginTop: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A', marginBottom: 6 },
  cardText: { fontSize: 13, color: '#475569', lineHeight: 18 },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  metricLabel: { fontSize: 13, color: '#64748B' },
  metricValue: { fontSize: 13, color: '#0F172A', fontWeight: '600', fontVariant: ['tabular-nums'] },
  errorText: { color: '#EF4444', fontSize: 12, marginTop: 6 },
  warnText: { color: '#F59E0B', fontSize: 12, marginTop: 6 },
  scenarioGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  scenarioChip: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#FFF',
  },
  scenarioChipActive: { borderColor: '#01b4ae', backgroundColor: '#F0FDFA' },
  scenarioChipText: { fontSize: 12, color: '#334155' },
  scenarioChipTextActive: { color: '#01b4ae', fontWeight: '700' },
  scenarioLive: { marginTop: 8, backgroundColor: '#F0FDFA', borderRadius: 8, padding: 8 },
  scenarioLiveText: { fontSize: 12, color: '#0F766E' },
  runsTable: { marginTop: 8, backgroundColor: '#F8FAFC', borderRadius: 8, padding: 8 },
  runRow: { fontSize: 12, color: '#334155', paddingVertical: 2, fontVariant: ['tabular-nums'] },
  toggleButton: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: '#FFF',
  },
  toggleActive: { borderColor: '#01b4ae', backgroundColor: '#F0FDFA' },
  toggleText: { fontSize: 13, color: '#334155', fontWeight: '600' },
  toggleTextActive: { color: '#01b4ae' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: 'rgba(1,180,174,0.4)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF',
  },
  secondaryButtonText: { color: '#01b4ae', fontSize: 13, fontWeight: '600' },
  footer: { marginTop: 16, fontSize: 11, color: '#94A3B8', lineHeight: 16 },
});
