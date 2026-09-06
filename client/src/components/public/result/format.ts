/**
 * Display formatters for the public quiz result page.
 *
 * Ported verbatim from the mobile app (`utils/quizFormat.ts` and the
 * formatResponseForDisplay helper in the app's quiz review screen) so the
 * guest web result shows durations, marks, percentages and answers through
 * exactly the same rules as the authenticated student app. Display only —
 * every correctness/number value comes from the backend payload.
 */

export function pluralize(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural || `${singular}s`);
  return `${count} ${word}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total === 0) return '0s';

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }
  return `${secs}s`;
}

export function formatPercentage(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return `${Math.round(value)}%`;
}

export function formatMarks(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return Number(num.toFixed(2)).toString();
}

/** Mirrors backend isAnswerRecorded: -1 / null / empty array / empty object = skipped. */
export function isAnswerRecorded(selectedAnswer: unknown): boolean {
  if (selectedAnswer === undefined || selectedAnswer === null || selectedAnswer === -1) {
    return false;
  }
  if (Array.isArray(selectedAnswer)) {
    return selectedAnswer.length > 0;
  }
  if (typeof selectedAnswer === 'object') {
    return Object.keys(selectedAnswer as Record<string, unknown>).length > 0;
  }
  return true;
}

const optionLabel = (index: number): string => String.fromCharCode(65 + index);

/**
 * Human display for a student/correct response, per question type — same
 * letter mapping and "Not answered" sentinel as the app's review screen and
 * the backend's formatAnswerForDisplay.
 */
export function formatResponseForDisplay(
  questionType: string | undefined,
  response: unknown,
  columnA?: string[] | null,
  columnB?: string[] | null
): string {
  if (!isAnswerRecorded(response)) return 'Not answered';
  switch (questionType) {
    case 'multiple_correct':
      return Array.isArray(response) && response.length > 0
        ? response.map((i) => optionLabel(Number(i))).join(', ')
        : 'Not answered';
    case 'match_the_following': {
      if (!response || typeof response !== 'object' || Array.isArray(response)) return 'Not answered';
      const entries = Object.entries(response as Record<string, unknown>);
      if (entries.length === 0) return 'Not answered';
      return entries
        .map(([a, b]) => {
          const left = columnA?.[Number(a)] || `Item ${Number(a) + 1}`;
          const right = columnB?.[Number(b)] || optionLabel(Number(b));
          return `${left} → ${right}`;
        })
        .join(', ');
    }
    case 'numerical':
      return String(response);
    default:
      return typeof response === 'number' ? optionLabel(response) : 'Not answered';
  }
}
