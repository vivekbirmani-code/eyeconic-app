const {
  isFeatureEnabled,
  getQuizWorkflowAllowlist,
} = require('../config/featureAvailability');

/**
 * Compiles an Express-style path ("/role/:role") into a matcher for the
 * middleware-relative path (req.path). Trailing slashes are tolerated.
 * @param {string} path
 * @returns {RegExp}
 */
function compilePath(path) {
  const source = path
    .split('/')
    .map((segment) =>
      segment.startsWith(':')
        ? '[^/]+'
        : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    )
    .join('/');
  return new RegExp(`^${source}/?$`);
}

/**
 * Temporary feature freeze gate. Mounted in front of a router; while the
 * feature is disabled every request answers 503 FEATURE_DISABLED, except the
 * Quiz-workflow dependencies allowlisted in config/featureAvailability.js.
 *
 * @param {string} feature feature key from config/featureAvailability.js
 * @param {string} [routerName] key in QUIZ_WORKFLOW_ALLOWLIST (defaults to
 *        the feature key) — pass the router name when it differs.
 */
function featureGate(feature, routerName = feature) {
  const allowed = getQuizWorkflowAllowlist(routerName).map((entry) => {
    const spaceIndex = entry.indexOf(' ');
    return {
      method: entry.slice(0, spaceIndex).toUpperCase(),
      pathRegex: compilePath(entry.slice(spaceIndex + 1)),
    };
  });

  return (req, res, next) => {
    if (isFeatureEnabled(feature)) {
      return next();
    }

    const isQuizDependency = allowed.some(
      ({ method, pathRegex }) =>
        req.method === method && pathRegex.test(req.path || '/')
    );
    if (isQuizDependency) {
      return next();
    }

    return res.status(503).json({
      message:
        'This feature is temporarily unavailable and will be enabled in a future version.',
      code: 'FEATURE_DISABLED',
      feature,
      requestId: req.requestId,
    });
  };
}

module.exports = featureGate;
