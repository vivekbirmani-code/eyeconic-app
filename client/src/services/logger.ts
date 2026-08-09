type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogMeta {
  requestId?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  userId?: string;
  errorCode?: string;
  [key: string]: unknown;
}

const SENSITIVE_KEYS = ['password', 'token', 'authorization', 'secret'];

const redact = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
        return [key, '[REDACTED]'];
      }
      return [key, typeof entry === 'object' ? redact(entry) : entry];
    })
  );
};

const writeLog = (level: LogLevel, message: string, meta: LogMeta = {}) => {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    userAgent: navigator.userAgent,
    ...(redact(meta) as Record<string, unknown>),
  };

  const serialized = JSON.stringify(payload);

  if (level === 'error') {
    console.error(serialized);
    return;
  }
  if (level === 'warn') {
    console.warn(serialized);
    return;
  }
  if (level === 'debug' && import.meta.env.DEV) {
    console.debug(serialized);
    return;
  }
  if (level === 'info') {
    console.log(serialized);
  }
};

export const apiLogger = {
  debug: (message: string, meta?: LogMeta) => writeLog('debug', message, meta),
  info: (message: string, meta?: LogMeta) => writeLog('info', message, meta),
  warn: (message: string, meta?: LogMeta) => writeLog('warn', message, meta),
  error: (message: string, meta?: LogMeta) => writeLog('error', message, meta),
};
