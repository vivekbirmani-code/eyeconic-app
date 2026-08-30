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
    return envOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  if (process.env.NODE_ENV === 'production') {
    return DEFAULT_PROD_ORIGINS;
  }

  return [...DEFAULT_PROD_ORIGINS, ...DEFAULT_DEV_ORIGINS];
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
