/**
 * Pure failure classification shared by the engine loop (Phase 3, §10.2):
 * which side of the pipeline failed — the DETECTOR (native module absent /
 * ML Kit error) or the CAMERA capture. Kept free of expo/native imports so
 * the engine test suite can run in the node jest environment.
 */

export function isDetectorFailureError(error: unknown): boolean {
  const err = error as { name?: string; message?: string } | null;
  return err?.name === 'SpikeModuleUnavailableError' || /ERR_DETECT/.test(err?.message ?? '');
}
