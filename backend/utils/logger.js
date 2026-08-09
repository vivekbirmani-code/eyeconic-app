/**
 * Structured server-side logger.
 * Never logs secrets, tokens, or passwords.
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'authorization',
  'jwt',
  'secret',
  'apikey',
  'api_key',
]);

const redact = (value) => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        return [key, '[REDACTED]'];
      }
      return [key, typeof entry === 'object' ? redact(entry) : entry];
    })
  );
};

const formatMeta = (meta = {}) => {
  const payload = {
    timestamp: new Date().toISOString(),
    ...redact(meta),
  };
  return JSON.stringify(payload);
};

const logger = {
  info(message, meta) {
    console.log(`[INFO] ${message} ${formatMeta(meta)}`);
  },
  warn(message, meta) {
    console.warn(`[WARN] ${message} ${formatMeta(meta)}`);
  },
  error(message, meta) {
    console.error(`[ERROR] ${message} ${formatMeta(meta)}`);
  },
  debug(message, meta) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[DEBUG] ${message} ${formatMeta(meta)}`);
    }
  },
};

module.exports = logger;
