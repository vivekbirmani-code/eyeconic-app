/**
 * Date utility for consistent IST formatting across the application.
 * Enforces strict IST (Asia/Kolkata) display regardless of user's local device time.
 */

export const formatToIST = (date: string | Date | undefined): string => {
    if (!date) return '';

    const d = typeof date === 'string' ? new Date(date) : date;

    if (isNaN(d.getTime())) return '';

    return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
    }).format(d) + ' IST';
};

export const getISTTime = (date: Date): string => {
    if (isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
    }).format(date);
};

/**
 * Compact human countdown for schedule badges ("2d 4h", "3h 12m", "45m",
 * "<1m"). Millisecond input; anything non-positive returns "<1m" — callers
 * decide what "zero" means.
 */
export const formatCountdown = (ms: number): string => {
    if (!Number.isFinite(ms) || ms <= 60 * 1000) return '<1m';
    const minutes = Math.floor(ms / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    return `${mins}m`;
};
