import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Linking,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CheckCircle2, XCircle, Loader2, ChevronLeft, Settings, RotateCcw } from 'lucide-react-native';
import { ScreenContainer } from '@/components/layout';
import { api } from '@/services/api';
import { useQuiz } from '@/context/QuizContext';
import { PROCTORING_COPY, CONSENT_TEXT_VERSION } from '@/utils/proctoringCopy';
import {
  createDefaultFaceReadinessDetector,
  type FaceReadinessFrame,
} from '@/services/proctoring/detector';
import {
  aggregateFaceFrames,
  buildPrecheckReport,
  PRECHECK_CHECK_IDS,
  type PrecheckCheckResult,
} from '@/services/proctoring/precheck';

/**
 * Proctoring precheck + consent (AI Proctoring plan §8–§9, Phase 2).
 *
 * Sits BETWEEN instructions and /start. Creates nothing by itself: the
 * attempt/session are only ever created by the server-authoritative /start
 * after the consent + precheck gates pass. All copy comes from
 * utils/proctoringCopy.ts (D7) — no inline student-facing strings.
 */

type StepState = 'waiting' | 'running' | 'pass' | 'fail' | 'retryable' | 'unsupported';

interface StepStatus {
  state: StepState;
  detail?: string;
}

type StepsMap = Record<string, StepStatus>;

const INITIAL_STEPS: StepsMap = PRECHECK_CHECK_IDS.reduce((acc, id) => {
  acc[id] = { state: 'waiting' };
  return acc;
}, {} as StepsMap);

const CAMERA_FRAMES_TARGET = 5;

const STATUS_ICON_COLOR: Record<StepState, string> = {
  waiting: '#94A3B8',
  running: '#2563EB',
  pass: '#16A34A',
  fail: '#DC2626',
  retryable: '#D97706',
  unsupported: '#DC2626',
};

export default function ProctoringPrecheck() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { startQuiz } = useQuiz();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  // Re-entrancy guard as a ref: state updates are async, so a racing tap or
  // a StrictMode double-mount would otherwise run runChecks twice
  // concurrently (interleaved camera mount/unmount + double report POSTs).
  const runningRef = useRef(false);
  const hasAutoRunRef = useRef(false);

  const [steps, setSteps] = useState<StepsMap>(INITIAL_STEPS);
  const [running, setRunning] = useState(false);
  const [verdictMessage, setVerdictMessage] = useState<string | null>(null);
  const [accommodation, setAccommodation] = useState(false);
  const [precheckToken, setPrecheckToken] = useState<string | null>(null);
  const [cameraNeeded, setCameraNeeded] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [starting, setStarting] = useState(false);

  const setStep = useCallback((stepId: string, status: StepStatus) => {
    setSteps((prev) => ({ ...prev, [stepId]: status }));
  }, []);

  // ---- individual checks -------------------------------------------------

  const checkDeviceCapability = useCallback(async (): Promise<PrecheckCheckResult> => {
    // Honest client-side floor signal; the SERVER re-verifies against the
    // authoritative floor (plan §8.2) — this only shapes the message early.
    const supported = Platform.OS === 'android' && Number(Platform.Version) >= 26;
    return {
      id: 'device_capability',
      status: supported ? 'PASS' : 'UNSUPPORTED',
      detail: supported ? undefined : 'proctored-tests-android-only',
    };
  }, []);

  const checkCameraPermission = useCallback(async (): Promise<PrecheckCheckResult> => {
    // Permission state not resolved yet → transient, never a hard failure.
    if (!permission) return { id: 'camera_permission', status: 'RETRYABLE', detail: 'permission_pending' };
    if (permission.granted) return { id: 'camera_permission', status: 'PASS' };
    if (permission.canAskAgain) {
      const result = await requestPermission();
      return { id: 'camera_permission', status: result.granted ? 'PASS' : 'FAIL', detail: 'permission_denied' };
    }
    return { id: 'camera_permission', status: 'FAIL', detail: 'permission_permanently_denied' };
  }, [permission, requestPermission]);

  const checkCameraAndFace = useCallback(async (): Promise<PrecheckCheckResult[]> => {
    const results: PrecheckCheckResult[] = [];

    // The detector boundary (Phase 0 integration, swappable tier). When the
    // native module is unavailable on this runtime, readiness is honestly
    // UNSUPPORTED — results are never faked.
    const detector = createDefaultFaceReadinessDetector();
    if (!detector) {
      results.push({ id: 'camera_availability', status: 'UNSUPPORTED', detail: 'detector_unavailable' });
      results.push({ id: 'face_readiness', status: 'UNSUPPORTED', detail: 'detector_unavailable' });
      return results;
    }

    // Camera must be mounted (permission granted) before frames can be taken.
    setCameraNeeded(true);
    await new Promise((resolve) => setTimeout(resolve, 600)); // let the preview settle

    const frames: FaceReadinessFrame[] = [];
    let captureFailures = 0;
    for (let i = 0; i < CAMERA_FRAMES_TARGET; i++) {
      try {
        const picture = await cameraRef.current?.takePictureAsync({
          quality: 0.4,
          base64: true,
          // skipProcessing stays false so EXIF orientation is baked in — the
          // detector receives an upright image (spike finding).
        });
        if (!picture?.base64) {
          captureFailures += 1;
          continue;
        }
        const frame = await detector.detectFrame(picture.base64);
        frames.push(frame);
      } catch {
        captureFailures += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    setCameraNeeded(false);

    if (frames.length === 0) {
      results.push({
        id: 'camera_availability',
        status: captureFailures > 0 ? 'RETRYABLE' : 'FAIL',
        detail: 'camera_did_not_produce_frames',
      });
      results.push({ id: 'face_readiness', status: 'RETRYABLE', detail: 'no_frames' });
      return results;
    }

    results.push({ id: 'camera_availability', status: 'PASS' });
    const aggregated = aggregateFaceFrames(frames, 3);
    results.push({
      id: 'face_readiness',
      status: aggregated.status,
      detail: aggregated.reasonCode ?? aggregated.detail,
      ...(aggregated.metadata ? { metadata: aggregated.metadata } : {}),
    });
    return results;
  }, []);

  const checkNetwork = useCallback(async (): Promise<PrecheckCheckResult> => {
    const startedAt = Date.now();
    try {
      // Unauthed reachability probe + one authenticated call (proves auth too).
      await api.get('/health');
      await api.get(`/quizzes/${id}`);
      return {
        id: 'network',
        status: 'PASS',
        detail: `${Date.now() - startedAt}`,
      };
    } catch {
      return { id: 'network', status: 'RETRYABLE', detail: 'network_unreachable' };
    }
  }, [id]);

  // ---- orchestration -----------------------------------------------------

  const navigateAfterStart = useCallback((result: any) => {
    if (result?.attemptFinalized) {
      router.replace(`/quizzes/${id}/result/${result.attemptId}`);
      return;
    }
    router.replace(`/quizzes/${id}/taking`);
  }, [id, router]);

  // Rollback path: when the rollout gates turned off under us, /start no
  // longer gates — start directly instead of looping on a 503-ing precheck.
  const tryUngatedStart = useCallback(async (): Promise<boolean> => {
    try {
      const result = await startQuiz(String(id));
      navigateAfterStart(result);
      return true;
    } catch {
      return false;
    }
  }, [id, startQuiz, navigateAfterStart]);

  const runChecks = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setVerdictMessage(null);
    setAccommodation(false);
    setPrecheckToken(null);
    setAcknowledged(false);
    setSteps(INITIAL_STEPS);

    try {
      const collected: PrecheckCheckResult[] = [];

      setStep('device_capability', { state: 'running' });
      const deviceResult = await checkDeviceCapability();
      collected.push(deviceResult);
      setStep('device_capability', { state: mapStatus(deviceResult.status), detail: deviceResult.detail });

      setStep('camera_permission', { state: 'running' });
      const permissionResult = await checkCameraPermission();
      collected.push(permissionResult);
      setStep('camera_permission', { state: mapStatus(permissionResult.status), detail: permissionResult.detail });

      if (permissionResult.status === 'PASS') {
        setStep('camera_availability', { state: 'running' });
        setStep('face_readiness', { state: 'running' });
        const cameraResults = await checkCameraAndFace();
        for (const result of cameraResults) {
          collected.push(result);
          setStep(result.id, { state: mapStatus(result.status), detail: result.detail });
        }
      } else {
        // Camera checks could not run. Mirror the permission shape EXACTLY —
        // a denied permission is a hard FAIL, but an unresolved permission
        // state is RETRYABLE: reporting a hard fail for a student whose
        // permission already exists would show a spurious "checks did not
        // pass" and burn one of the rate-limited reports.
        const status = permissionResult.status === 'RETRYABLE' ? 'RETRYABLE' : 'FAIL';
        const detail = permissionResult.status === 'RETRYABLE' ? 'permission_pending' : 'permission_denied';
        collected.push({ id: 'camera_availability', status, detail });
        collected.push({ id: 'face_readiness', status, detail });
        setStep('camera_availability', { state: mapStatus(status), detail });
        setStep('face_readiness', { state: mapStatus(status), detail });
      }

      setStep('network', { state: 'running' });
      const networkResult = await checkNetwork();
      collected.push(networkResult);
      setStep('network', { state: mapStatus(networkResult.status) });

      // Report to the server — the SERVER decides the verdict and issues the
      // attestation token; nothing above is trusted on its own.
      const payload = buildPrecheckReport({
        device: {
          platform: Platform.OS,
          osVersion: Number(Platform.Version),
        },
        network: {
          reachable: networkResult.status === 'PASS',
          ...(networkResult.status === 'PASS' && networkResult.detail && Number.isFinite(Number(networkResult.detail))
            ? { authedPingMs: Number(networkResult.detail) }
            : {}),
        },
        checks: collected,
      });

      const response = await api.post(`/quizzes/${id}/proctoring/precheck-report`, payload);
      const body = response.data ?? {};
      if (body.verdict === 'PASS' && body.precheckToken) {
        setPrecheckToken(body.precheckToken as string);
      } else if (body.verdict === 'RETRYABLE') {
        setVerdictMessage(PROCTORING_COPY.precheck.retryableMessage);
      } else if (body.verdict === 'FAIL') {
        setVerdictMessage(PROCTORING_COPY.precheck.failMessage);
      }
    } catch (error: any) {
      const data = error?.response?.data;
      if (data?.code === 'PROCTORING_DISABLED') {
        // Rollback: the quiz is now effectively unproctored — /start no
        // longer gates. Skip the dead-end retry loop and start directly.
        if (await tryUngatedStart()) return;
        setVerdictMessage(PROCTORING_COPY.consent.startError);
      } else if (data?.code === 'DEVICE_BELOW_FLOOR' || data?.verdict === 'UNSUPPORTED') {
        setAccommodation(true);
        setVerdictMessage(PROCTORING_COPY.precheck.unsupportedMessage);
      } else if (data?.code === 'RATE_LIMITED') {
        setVerdictMessage(data?.message ?? PROCTORING_COPY.precheck.retryableMessage);
      } else {
        setVerdictMessage(PROCTORING_COPY.precheck.retryableMessage);
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [checkDeviceCapability, checkCameraPermission, checkCameraAndFace, checkNetwork, setStep, id, tryUngatedStart]);

  // Auto-run once the camera permission state has resolved (permission ===
  // null means the OS query is still in flight — running before it settles
  // would mis-report the camera checks).
  useEffect(() => {
    if (permission === null || hasAutoRunRef.current) return;
    hasAutoRunRef.current = true;
    void runChecks();
  }, [permission, runChecks]);

  // ---- consent + start ---------------------------------------------------

  const handleConsentAndStart = useCallback(async () => {
    if (!precheckToken || !acknowledged || starting) return;
    setStarting(true);
    try {
      await api.post(`/quizzes/${id}/proctoring/consent`, {
        precheckToken,
        consentTextVersion: CONSENT_TEXT_VERSION,
        surface: 'app-android',
      });

      const result = await startQuiz(String(id), { precheckToken });
      navigateAfterStart(result);
    } catch (error: any) {
      const code = error?.response?.data?.errorCode ?? error?.response?.data?.code;
      if (code === 'PROCTORING_PRECHECK_REQUIRED' || code === 'PRECHECK_TOKEN_INVALID') {
        // Token expired/invalidated mid-flow — rerun the checks.
        setPrecheckToken(null);
        setAcknowledged(false);
        void runChecks();
        return;
      }
      if (code === 'PROCTORING_CONSENT_REQUIRED') {
        // Policy changed under us — full rerun (new consent binds new hash).
        setPrecheckToken(null);
        setAcknowledged(false);
        void runChecks();
        return;
      }
      if (code === 'PROCTORING_DISABLED') {
        // Rollback made the quiz effectively unproctored — start ungated.
        if (await tryUngatedStart()) return;
      }
      setVerdictMessage(PROCTORING_COPY.consent.startError);
    } finally {
      setStarting(false);
    }
  }, [precheckToken, acknowledged, starting, id, startQuiz, navigateAfterStart, runChecks, tryUngatedStart]);

  const permissionPermanentlyDenied = steps.camera_permission?.detail === 'permission_permanently_denied';
  const faceFailed = steps.face_readiness?.state === 'fail';
  const copy = PROCTORING_COPY;

  const stepOrder = useMemo(() => [...PRECHECK_CHECK_IDS], []);

  return (
    <ScreenContainer style={styles.container}>
      <View style={styles.headerRow}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft color="#475569" size={22} />
        </Pressable>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>
            {precheckToken ? copy.consent.title : copy.precheck.title}
          </Text>
          <Text style={styles.subtitle}>
            {precheckToken ? copy.consent.acknowledge : copy.precheck.subtitle}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Camera preview — student-visible whenever the camera is used (§8.1). */}
        {cameraNeeded && (
          <View style={styles.cameraWrap}>
            <CameraView ref={cameraRef} style={styles.camera} facing="front" mode="picture" />
          </View>
        )}

        {!precheckToken && (
          <View style={styles.card}>
            {stepOrder.map((stepId) => {
              const step = steps[stepId] ?? { state: 'waiting' as StepState };
              return (
                <View key={stepId} style={styles.stepRow}>
                  <View style={styles.stepIconWrap}>
                    {step.state === 'running' ? (
                      <Loader2 color={STATUS_ICON_COLOR[step.state]} size={20} />
                    ) : step.state === 'pass' ? (
                      <CheckCircle2 color={STATUS_ICON_COLOR[step.state]} size={20} />
                    ) : step.state === 'waiting' ? (
                      <View style={styles.waitingDot} />
                    ) : (
                      <XCircle color={STATUS_ICON_COLOR[step.state]} size={20} />
                    )}
                  </View>
                  <View style={styles.stepTextWrap}>
                    <Text style={styles.stepTitle}>{copy.precheck.steps[stepId as keyof typeof copy.precheck.steps]}</Text>
                    {step.state === 'pass' && <Text style={styles.stepPassed}>{copy.precheck.statusPassed}</Text>}
                    {step.state === 'running' && <Text style={styles.stepWaiting}>{copy.precheck.statusWaiting}</Text>}
                    {(step.state === 'fail' || step.state === 'retryable' || step.state === 'unsupported') && (
                      <Text style={styles.stepFailed}>{copy.precheck.statusFailed}</Text>
                    )}
                    {stepId === 'camera_permission' && step.state !== 'pass' && permissionPermanentlyDenied && (
                      <Pressable style={styles.inlineAction} onPress={() => Linking.openSettings()}>
                        <Settings color="#2563EB" size={14} />
                        <Text style={styles.inlineActionText}>{copy.precheck.cameraSettingsAction}</Text>
                      </Pressable>
                    )}
                    {stepId === 'face_readiness' && step.state !== 'pass' && step.state !== 'waiting' && (
                      <Text style={styles.hint}>{faceFailed ? copy.precheck.faceHint : copy.precheck.lightingHint}</Text>
                    )}
                    {stepId === 'network' && (step.state === 'retryable' || step.state === 'fail') && (
                      <Text style={styles.hint}>{copy.precheck.networkHint}</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {verdictMessage && (
          <View style={[styles.messageCard, accommodation ? styles.messageCardUnsupported : null]}>
            <Text style={[styles.messageTitle, accommodation ? styles.messageTitleUnsupported : null]}>
              {accommodation ? copy.precheck.unsupportedTitle : copy.precheck.title}
            </Text>
            <Text style={[styles.messageText, accommodation ? styles.messageTextUnsupported : null]}>
              {verdictMessage}
            </Text>
          </View>
        )}

        {!precheckToken && !running && !accommodation && (
          <Pressable style={styles.primaryButton} onPress={() => void runChecks()}>
            <RotateCcw color="#FFF" size={16} />
            <Text style={styles.primaryButtonText}>{copy.precheck.retryAction}</Text>
          </Pressable>
        )}

        {precheckToken && (
          <View style={styles.card}>
            {copy.consent.lines.map((line) => (
              <View key={line} style={styles.consentLineRow}>
                <View style={styles.consentBullet} />
                <Text style={styles.consentLine}>{line}</Text>
              </View>
            ))}

            <Pressable style={styles.consentCheckRow} onPress={() => setAcknowledged((prev) => !prev)}>
              <View style={[styles.checkbox, acknowledged ? styles.checkboxChecked : null]}>
                {acknowledged && <CheckCircle2 color="#FFF" size={18} />}
              </View>
              <Text style={styles.consentCheckLabel}>{copy.consent.acknowledge}</Text>
            </Pressable>
          </View>
        )}

        {(running || starting) && (
          <ActivityIndicator size="small" color="#2563EB" style={styles.loader} />
        )}
      </ScrollView>

      {precheckToken && (
        <Pressable
          style={[styles.primaryButton, (!acknowledged || starting) ? styles.primaryButtonDisabled : null]}
          disabled={!acknowledged || starting}
          onPress={() => void handleConsentAndStart()}
        >
          <Text style={styles.primaryButtonText}>
            {starting ? copy.consent.starting : copy.consent.start}
          </Text>
        </Pressable>
      )}
    </ScreenContainer>
  );
}

function mapStatus(status: PrecheckCheckResult['status']): StepState {
  if (status === 'PASS') return 'pass';
  if (status === 'RETRYABLE') return 'retryable';
  if (status === 'UNSUPPORTED') return 'unsupported';
  return 'fail';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backButton: { padding: 8 },
  headerTextWrap: { flex: 1, marginLeft: 4 },
  title: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  subtitle: { fontSize: 13, color: '#64748B', marginTop: 2 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 24 },
  cameraWrap: {
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    marginBottom: 12,
  },
  camera: { flex: 1 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10 },
  stepIconWrap: { width: 28, alignItems: 'center', marginRight: 4 },
  waitingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#CBD5E1',
    marginTop: 5,
  },
  stepTextWrap: { flex: 1 },
  stepTitle: { fontSize: 15, fontWeight: '600', color: '#1E293B' },
  stepPassed: { fontSize: 12, color: '#16A34A', marginTop: 2 },
  stepWaiting: { fontSize: 12, color: '#64748B', marginTop: 2 },
  stepFailed: { fontSize: 12, color: '#DC2626', marginTop: 2 },
  hint: { fontSize: 12, color: '#475569', marginTop: 4, lineHeight: 17 },
  inlineAction: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  inlineActionText: { color: '#2563EB', fontSize: 13, fontWeight: '600', marginLeft: 4 },
  messageCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  messageCardUnsupported: { backgroundColor: '#FEE2E2' },
  messageTitle: { fontSize: 14, fontWeight: '700', color: '#7C2D12' },
  messageTitleUnsupported: { color: '#7F1D1D' },
  messageText: { fontSize: 13, color: '#78350F', marginTop: 4, lineHeight: 18 },
  messageTextUnsupported: { color: '#7F1D1D' },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: '#FFF', fontSize: 15, fontWeight: '700', marginLeft: 6 },
  consentLineRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6 },
  consentBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2563EB',
    marginTop: 7,
    marginRight: 10,
  },
  consentLine: { flex: 1, fontSize: 14, color: '#334155', lineHeight: 20 },
  consentCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  consentCheckLabel: { flex: 1, marginLeft: 12, fontSize: 14, fontWeight: '600', color: '#0F172A' },
  loader: { marginTop: 12 },
});
