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
