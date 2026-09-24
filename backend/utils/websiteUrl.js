const PRODUCTION_WEBSITE_URL = 'https://www.eyeconicneetpg.com';

/**
 * Canonical origin of the Eyeconic marketing website (eyeconic-main repo,
 * eyeconicneetpg.com) — the destination of app → website session handoff
 * links created by POST /api/auth/web-handoff.
 *
 * This is deliberately SEPARATE from WEB_APP_URL (utils/publicWebUrl.js),
 * which points at the public-quiz web console. Two different websites, two
 * different env vars.
 *
 * Resolution order:
 *   1. WEBSITE_URL env var (a bare host is accepted and served over https)
 *   2. production fallback: the live marketing website
 *   3. development: http://localhost:5173 (website client dev server)
 */
const getWebsiteUrl = () => {
  const explicit = process.env.WEBSITE_URL?.trim().replace(/\/+$/, '');
  if (explicit) {
    return /^https?:\/\//i.test(explicit) ? explicit : `https://${explicit}`;
  }
  if (process.env.NODE_ENV === 'production') {
    return PRODUCTION_WEBSITE_URL;
  }
  return 'http://localhost:5173';
};

/**
 * Build the website handoff URL the mobile app opens in a browser:
 *   `${website}/app-link?code=...&dest=...`
 * `dest` must already be a validated website-relative path (see
 * validateWebsiteDest in routes/auth.js) or an empty string.
 */
const buildWebsiteHandoffUrl = (code, dest = '') => {
  const params = new URLSearchParams({ code });
  if (dest) params.set('dest', dest);
  return `${getWebsiteUrl()}/app-link?${params.toString()}`;
};

module.exports = {
  getWebsiteUrl,
  buildWebsiteHandoffUrl,
};
