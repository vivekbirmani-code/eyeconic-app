/**
 * Intern Mode API client. Mirrors backend/routes/intern.js:
 *  - Students: status (/me), time slicer (/time), task list (/tasks),
 *    mark watched (/tasks/:id/watched).
 *  - Mentors/admins: catalog pickers (/catalog/summary), per-student config
 *    (/config/:studentId), interns overview (/students).
 */
import { api } from '@/services/api';

export interface InternScopeEntry {
  _id?: string;
  source: string; // display spelling (e.g. "MARROW6.5")
  sourceKey: string; // normalized key (e.g. "marrow6.5")
  subjects: string[];
}

export interface InternTask {
  _id: string;
  video: string;
  title: string;
  subject: string;
  source: string;
  type: string;
  durationMin: number;
  sheetRow: number;
  status: 'pending' | 'watched';
  firstAllottedAt: string;
  watchedAt?: string | null;
}

export interface InternPlanTask extends InternTask {}

export interface InternStatus {
  isIntern: boolean;
  scope?: InternScopeEntry[];
  today?: {
    date: string;
    minutes: number | null;
    totalMinutes: number;
    plan: InternPlanTask[];
  };
  finishedAll?: boolean;
}

export interface InternNextVideo {
  _id: string;
  title: string;
  subject: string;
  source: string;
  type: string;
  durationMin: number;
  sheetRow: number;
}

export interface SetInternTimeResult {
  date: string;
  minutes: number;
  totalMinutes: number;
  plan: InternPlanTask[];
  reason: 'NEXT_VIDEO_LONGER_THAN_TIME' | 'PLAYLIST_FINISHED' | null;
  nextVideo: InternNextVideo | null;
}

export interface InternTasksResponse {
  tasks: InternTask[];
  today: { date: string; minutes: number; videoIds: string[] } | null;
}

/* ---------------- student surface ---------------- */

export async function getInternStatus(): Promise<InternStatus> {
  const response = await api.get<InternStatus>('/intern/me');
  return response.data;
}

export async function setInternTime(minutes: number): Promise<SetInternTimeResult> {
  const response = await api.post<SetInternTimeResult>('/intern/time', { minutes });
  return response.data;
}

export async function getInternTasks(): Promise<InternTasksResponse> {
  const response = await api.get<InternTasksResponse>('/intern/tasks');
  return response.data;
}

export async function markInternTaskWatched(taskId: string): Promise<InternTask> {
  const response = await api.post<InternTask>(`/intern/tasks/${taskId}/watched`);
  return response.data;
}

/* ---------------- mentor/admin surface (Phase 4) ---------------- */

export interface CatalogSubjectSummary {
  subject: string;
  videos: number;
  minutes: number;
}

export interface CatalogSourceSummary {
  source: string;
  sourceKey: string;
  videos: number;
  minutes: number;
  subjects: CatalogSubjectSummary[];
}

export async function getInternCatalogSummary(): Promise<CatalogSourceSummary[]> {
  const response = await api.get<{ sources: CatalogSourceSummary[] }>('/intern/catalog/summary');
  return response.data.sources;
}

export interface InternConfigPayload {
  isIntern: boolean;
  scope: { sourceKey: string; subjects: string[] }[];
}

export interface InternConfigResponse {
  studentId: string;
  name?: string;
  email?: string;
  isIntern: boolean;
  scope: InternScopeEntry[];
  today?: { date: string; minutes: number; planCount: number } | null;
  progress?: {
    watchedCount: number;
    watchedMinutes: number;
    pendingCount: number;
    pendingMinutes: number;
    scopeVideos: number;
    finishedAll: boolean;
  };
}

export async function getInternConfig(studentId: string): Promise<InternConfigResponse> {
  const response = await api.get<InternConfigResponse>(`/intern/config/${studentId}`);
  return response.data;
}

export async function saveInternConfig(
  studentId: string,
  payload: InternConfigPayload
): Promise<InternConfigResponse> {
  const response = await api.put<InternConfigResponse>(`/intern/config/${studentId}`, payload);
  return response.data;
}

export interface InternStudentRow {
  studentId: string;
  name: string;
  email: string;
  scope: InternScopeEntry[];
  today: { minutes: number; planCount: number } | null;
  progress: {
    watchedCount: number;
    watchedMinutes: number;
    pendingCount: number;
    pendingMinutes: number;
    scopeVideos: number;
    finishedAll: boolean;
  };
}

export async function getInternStudents(): Promise<{ date: string; interns: InternStudentRow[] }> {
  const response = await api.get<{ date: string; interns: InternStudentRow[] }>('/intern/students');
  return response.data;
}
