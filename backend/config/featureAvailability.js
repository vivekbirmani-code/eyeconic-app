/**
 * TEMPORARY FEATURE FREEZE — single source of truth for feature availability.
 *
 * While the app is in quiz-only mode, every feature except the Quiz ecosystem
 * (tests, question bank, public quiz, guest leads/OTP, attempts, results,
 * analytics) is temporarily disabled across all roles.
 *
 * Nothing is deleted: routers stay mounted, models and business logic are
 * untouched, and each feature comes back by flipping its flag to `true` here.
 * The mobile app (utils/featureAvailability.ts) and the web client
 * (client/src/config/features.ts) mirror these flags for their UIs.
 *
 * NOTE: `QUIZ_WORKFLOW_ALLOWLIST` below lists endpoints inside frozen routers
 * that the Quiz workflow itself calls (quiz assignment pickers, share modal,
 * student profile completion, mentor analytics picker, question image upload,
 * login-screen settings probe). Those stay reachable while their parent
 * feature is disabled; everything else on the router answers 503
 * FEATURE_DISABLED via middleware/featureGate.js.
 */

const FEATURE_AVAILABILITY = {
  // Quiz ecosystem — fully enabled.
  quizzes: true,

  // Website (eyeconicneetpg.com) integration — versioned service endpoints
  // (/api/integration/v1/*). Own flag so the quiz-only freeze never touches
  // the website's authentication handoff. Service-authenticated; carries no
  // student data by itself.
  integration: true,

  // Temporarily disabled features — flip to true to re-enable.
  chat: false, // groups management, group chat, messages, calls, chat uploads
  mentorship: false, // assignments, mentor "My Students" CRUD, student tasks
  userManagement: false, // admin user CRUD, admin settings screen
  adminOverview: false, // admin mentorship overview dashboard
};

/**
 * @param {keyof typeof FEATURE_AVAILABILITY} feature
 * @returns {boolean} true only when the feature is explicitly enabled.
 */
function isFeatureEnabled(feature) {
  return FEATURE_AVAILABILITY[feature] === true;
}

/**
 * Endpoints inside otherwise-frozen routers that the Quiz workflow depends on.
 * Keys are router names passed to featureGate(); entries are "METHOD /path"
 * with `:param` path segments ( Express-style ). Query strings are ignored.
 */
const QUIZ_WORKFLOW_ALLOWLIST = {
  users: [
    'GET /', // student/mentor pickers: quiz assignment, share modal, analytics
    'GET /role/:role', // mobile create-quiz student/mentor pickers
    'GET /search', // mentor picker for quiz assignedMentors
    'PUT /profile', // mandatory student profile completion on the dashboard
    'POST /profile-picture', // profile UI on the home screen
    'DELETE /profile-picture',
    'POST /push-token', // quiz assignment/submit push notifications
    'POST /fcm-token',
  ],
  groups: [
    'GET /', // group picker when assigning/sharing quizzes + unread badges
  ],
  assignments: [
    'GET /mentor/:mentorId/students', // mentor Test Analytics student picker
  ],
  upload: [
    'POST /', // question/option image uploads from question bank screens
  ],
  settings: [
    'GET /public', // login screen signUpEnabled probe (fail-closed)
  ],
};

/**
 * @param {string} routerName name used in QUIZ_WORKFLOW_ALLOWLIST
 * @returns {string[]} allowlisted "METHOD /path" entries (empty if none)
 */
function getQuizWorkflowAllowlist(routerName) {
  return QUIZ_WORKFLOW_ALLOWLIST[routerName] || [];
}

module.exports = {
  FEATURE_AVAILABILITY,
  isFeatureEnabled,
  QUIZ_WORKFLOW_ALLOWLIST,
  getQuizWorkflowAllowlist,
};
