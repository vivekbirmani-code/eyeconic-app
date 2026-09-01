/**
 * Date/time helpers for quiz scheduling.
 *
 * The quiz time window is minute-granular: users pick a date and a time, never
 * seconds, so every committed value is normalized with seconds/ms zeroed.
 * This keeps the displayed value, the validation and the API payload in exact
 * agreement regardless of platform.
 */

/** Returns a copy of `date` with seconds and milliseconds zeroed. */
export const startOfMinute = (date: Date): Date => {
  const normalized = new Date(date.getTime());
  normalized.setSeconds(0, 0);
  return normalized;
};

/**
 * Combines the calendar date of `datePart` with the time-of-day of `timePart`
 * (seconds zeroed). Used when a date picker and a time picker contribute
 * separate parts: changing one part must never disturb the other.
 */
export const combineDateAndTime = (datePart: Date, timePart: Date): Date => {
  const combined = new Date(datePart.getTime());
  combined.setHours(timePart.getHours(), timePart.getMinutes(), 0, 0);
  return combined;
};

/**
 * Business rule shared by the apps and the backend: when both ends of the
 * quiz window are set, the end must be strictly after the start. Each end is
 * individually optional.
 */
export const isValidQuizWindow = (start?: Date | null, end?: Date | null): boolean => {
  if (!start || !end) return true;
  return end.getTime() > start.getTime();
};
