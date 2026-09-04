const logger = require('../utils/logger');

const PRODUCTION_WEB_ORIGIN = 'https://eyeconicmentors.vercel.app';

const DEFAULT_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const DEFAULT_PROD_ORIGINS = [PRODUCTION_WEB_ORIGIN];

const parseAllowedOrigins = () => {
  const envOrigins = process.env.ALLOWED_ORIGINS?.trim();
  if (envOrigins) {
    return appendPublicWebOrigin(
      envOrigins
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    );
  }

  if (process.env.NODE_ENV === 'production') {
    return appendPublicWebOrigin(DEFAULT_PROD_ORIGINS);
  }

  return appendPublicWebOrigin([...DEFAULT_PROD_ORIGINS, ...DEFAULT_DEV_ORIGINS]);
};

/**
 * The backend itself sends guests to WEB_APP_URL (public quiz share links),
 * so that origin must always be CORS-allowed — a mismatch there would break
 * the entire public flow. Derived from the env var so the Render static site
 * (or any future custom domain) is trusted without listing hosts twice.
 * Accepts a bare host as pasted from the Render dashboard (scheme-less).
 */
const appendPublicWebOrigin = (origins) => {
  const raw = process.env.WEB_APP_URL?.trim();
  if (!raw) {
    return origins;
  }
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const webAppOrigin = new URL(withScheme).origin;
    return origins.includes(webAppOrigin) ? origins : [...origins, webAppOrigin];
  } catch {
    // Unparseable WEB_APP_URL — leave the explicit list untouched; the boot
    // log surfaces the resolved URL for diagnosis.
    return origins;
  }
};

const getAllowedOrigins = () => parseAllowedOrigins();

const createCorsOptions = () => {
  const allowedOrigins = getAllowedOrigins();

  return {
    origin(origin, callback) {
      // Allow non-browser clients (curl, mobile native, server-to-server).
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      logger.warn('CORS request rejected for origin', {
        origin,
        allowedOrigins,
      });
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    credentials: false,
    maxAge: 86400,
  };
};

const createSocketCorsOptions = () => ({
  origin: getAllowedOrigins(),
  methods: ['GET', 'POST'],
});

module.exports = {
  PRODUCTION_WEB_ORIGIN,
  getAllowedOrigins,
  createCorsOptions,
  createSocketCorsOptions,
};
