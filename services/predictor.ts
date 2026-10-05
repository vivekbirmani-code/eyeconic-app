import { isAxiosError } from 'axios';
import { predictorApi } from './predictorApi';
import type {
  BranchCatalog,
  BranchesResponse,
  BranchBand,
  DesiredBranchRequestBody,
  DesiredBranchResponse,
  GtInput,
  GtsResponse,
  OutcomePutResponse,
  OutcomeStatusResponse,
  OutcomeSubmission,
  PredictResponse,
  PredictionsListResponse,
  PredictorExam,
  StoredPredictionResponse,
} from '@/types/predictor';

/**
 * Typed client for the Rank & Branch Predictor endpoints on the Eyeconic
 * website server — the same contract the eyeconicneetpg.com predictor page
 * consumes. Ported from the website's lib/predictorClient.ts; auth is the
 * student's app JWT as a Bearer header (services/predictorApi.ts), so
 * predictions and history are shared with the website under the same
 * App user id.
 *
 * Error envelope on this API is { msg, code, field? } (msg, not message) —
 * use predictorErrorMessage for user-facing text.
 */

/** The engine's request contract (typed end to end — no `as never` casts). */
export interface PredictRequestBody {
  exam: string;
  gts: GtInput[];
  category?: string;
  pwd?: boolean;
}

export const predictorEndpoints = {
  exams: () => predictorApi.get<{ exams: PredictorExam[] }>('/exams').then((r) => r.data.exams),
  gts: () => predictorApi.get<GtsResponse>('/gts').then((r) => r.data),
  predict: (body: PredictRequestBody) =>
    predictorApi.post<PredictResponse>('/predict', body).then((r) => r.data),
  branches: (
    predictionId: string,
    params: { band?: BranchBand; year?: number; page?: number; limit?: number }
  ) =>
    predictorApi
      .get<BranchesResponse>(`/predictions/${predictionId}/branches`, { params })
      .then((r) => r.data),
  history: (page = 1, limit = 10) =>
    predictorApi
      .get<PredictionsListResponse>('/predictions', { params: { page, limit } })
      .then((r) => r.data),
  historyItem: (predictionId: string) =>
    predictorApi.get<StoredPredictionResponse>(`/predictions/${predictionId}`).then((r) => r.data),
  outcome: (predictionId: string) =>
    predictorApi
      .get<OutcomeStatusResponse>(`/predictions/${predictionId}/outcome`)
      .then((r) => r.data),
  saveOutcome: (predictionId: string, body: OutcomeSubmission) =>
    predictorApi
      .put<OutcomePutResponse>(`/predictions/${predictionId}/outcome`, body)
      .then((r) => r.data),
  withdrawOutcome: (predictionId: string) =>
    predictorApi
      .delete<{ predictionId: string; deleted: boolean }>(`/predictions/${predictionId}/outcome`)
      .then((r) => r.data),
  /** Desired Branch Predictor (Feature 02): the selectable branch catalog. */
  branchCatalog: (exam: string) =>
    predictorApi.get<BranchCatalog>('/branches', { params: { exam } }).then((r) => r.data),
  /** Desired Branch Predictor: branch → target rank range → required corrects. */
  desiredBranch: (body: DesiredBranchRequestBody) =>
    predictorApi.post<DesiredBranchResponse>('/desired-branch', body).then((r) => r.data),
};

// ---- Error helpers (the predictor's { msg, code, field } envelope) --------------

/** Human-friendly message for predictor failures (server messages are safe to show). */
export function predictorErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.'
): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as { msg?: string; message?: string } | undefined;
    const message = data?.msg || data?.message;
    if (message) return message;
    if (!error.response) {
      return 'Cannot reach the predictor right now. Please check your connection and try again.';
    }
  }
  return fallback;
}

/** Field path (e.g. "gts[2].attempts[0].corrects") → row index, for inline errors. */
export function errorRowIndices(error: unknown): Set<number> {
  const rows = new Set<number>();
  if (isAxiosError(error)) {
    const field = (error.response?.data as { field?: string } | undefined)?.field || '';
    const match = field.match(/^gts\[(\d+)\]/);
    if (match) rows.add(Number(match[1]));
  }
  return rows;
}

/** Server field name (e.g. "score", "consent") from a validation error, if any. */
export function errorField(error: unknown): string | null {
  if (isAxiosError(error)) {
    const field = (error.response?.data as { field?: string } | undefined)?.field;
    return typeof field === 'string' && field ? field : null;
  }
  return null;
}

/** Near-miss suggestions from an UNKNOWN_BRANCH response, if any. */
export function branchSuggestions(error: unknown): string[] {
  if (isAxiosError(error)) {
    const data = error.response?.data as { code?: string; suggestions?: string[] } | undefined;
    if (data?.code === 'UNKNOWN_BRANCH' && Array.isArray(data.suggestions)) return data.suggestions;
  }
  return [];
}

/** Convenience re-export so screens can guard with the same check the helpers use. */
export { isAxiosError };
