import AsyncStorage from '@react-native-async-storage/async-storage';

export interface GtLog {
  id: string;
  name: string;
  corrects: number;
  score: number;
  rank: number | string;
  date: string;
}

export interface GtChartEntry {
  id: string;
  testName: string;
  corrects: number;
  date: string;
}

const MAX_CHART_ENTRIES = 6;
export const CHART_Y_AXIS_MAX = 160;

export function getGtLogsStorageKey(userId: string): string {
  return `gt_logs_${userId}`;
}

export async function loadGtLogs(userId: string): Promise<GtLog[]> {
  try {
    const stored = await AsyncStorage.getItem(getGtLogsStorageKey(userId));
    if (stored) {
      return JSON.parse(stored) as GtLog[];
    }
  } catch (e) {
    console.log('Error loading GT logs:', e);
  }
  return [];
}

export async function saveGtLogs(userId: string, logs: GtLog[]): Promise<void> {
  await AsyncStorage.setItem(getGtLogsStorageKey(userId), JSON.stringify(logs));
}

function truncateTestName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 9)}…`;
}

function formatChartDate(dateStr: string): string {
  const [monthDay] = dateStr.split(',');
  return monthDay.trim();
}

export function toChartEntries(logs: GtLog[]): GtChartEntry[] {
  return logs
    .slice(0, MAX_CHART_ENTRIES)
    .reverse()
    .map((log) => ({
      id: log.id,
      testName: truncateTestName(log.name),
      corrects: log.corrects,
      date: formatChartDate(log.date),
    }));
}

export function getBarHeightPercent(corrects: number): number {
  return Math.min((corrects / CHART_Y_AXIS_MAX) * 100, 100);
}
