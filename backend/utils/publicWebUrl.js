const { PRODUCTION_WEB_ORIGIN } = require('../config/cors');

const DEV_WEB_APP_URL = 'http://localhost:5173';

/**
 * Canonical web origin for public quiz links — the SINGLE source of truth
 * used by link generation (generate-share-link, share-status) and the
 * legacy /api/public/share redirect.
 *
 * Resolution order:
 *   1. WEB_APP_URL env var (explicit; required in production)
 *      — a bare host ("site.onrender.com") is accepted and served over https
 *   2. development: http://localhost:5173 (client dev server — zero config)
 *   3. production fallback: the deployed web app origin
 *
 * NEVER returns empty — every public share link resolves to a working web
 * URL. There is deliberately NO app-redirect fallback anymore: public quiz
 * links must open in a browser, always, in every environment.
 */
const getPublicWebAppUrl = () => {
  const explicit = process.env.WEB_APP_URL?.trim().replace(/\/+$/, '');
  if (explicit) {
    return /^https?:\/\//i.test(explicit) ? explicit : `https://${explicit}`;
  }
  if (process.env.NODE_ENV === 'production') {
    return PRODUCTION_WEB_ORIGIN.replace(/\/+$/, '');
  }
  return DEV_WEB_APP_URL;
};

/** Full web URL for a quiz's public page, e.g. `${origin}/public-quiz/:token`. */
const buildPublicQuizUrl = (shareToken) =>
  `${getPublicWebAppUrl()}/public-quiz/${shareToken}`;

module.exports = {
  getPublicWebAppUrl,
  buildPublicQuizUrl,
};
