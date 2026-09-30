// Single async entry point for "is proctoring effective for THIS quiz right
// now" (plan §31 precedence: kill switch > feature flag > quiz opt-in).
//
// Both /start (routes/quizzes.js) and the precheck/consent routes
// (routes/proctoring.js) MUST resolve eligibility through this one helper —
// the precedence contract lives here, not in copy-pasted call sites, so
// precheck can never issue tokens for a quiz /start considers unproctored
// (or the reverse).
//
// Short-circuits on the quiz config so the common non-proctored path never
// touches AppSettings.

const { isProctoringEnabled } = require('../appSettings');
const { isFeatureEnabled } = require('../../config/featureAvailability');
const {
  isQuizProctoringEnabled,
  resolveProctoringEligibility,
} = require('./policySnapshot');

const resolveEligibilityForQuiz = async (quiz) =>
  resolveProctoringEligibility({
    quizConfigEnabled: isQuizProctoringEnabled(quiz),
    globalEnabled: isQuizProctoringEnabled(quiz) ? await isProctoringEnabled() : false,
    featureFlagEnabled: isFeatureEnabled('aiProctoring'),
  });

module.exports = { resolveEligibilityForQuiz };
