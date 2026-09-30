/**
 * TEMPORARY FEATURE FREEZE — single source of truth for feature availability
 * in the mobile app. While the app is in quiz-only mode, every feature except
 * the Quiz ecosystem (Tests, question bank, public quiz, attempts, results,
 * analytics) is temporarily disabled for all roles.
 *
 * Nothing is deleted: screens, routes and navigation stay in place and each
 * feature comes back by flipping its flag to `true` here. The backend
 * (backend/config/featureAvailability.js) and the web client
 * (client/src/config/features.ts) mirror these flags.
 *
 * Gating layers:
 *  - Tab bar: disabled tabs stay visible but are non-tappable (see
 *    components/DisabledTabButton.tsx).
 *  - Routes: withFeatureGate(key) renders FeatureComingSoon for disabled
 *    features, covering deep links and direct navigation.
 *  - In-screen entry points (dashboard quick actions, mentor dashboard tabs)
 *    check isFeatureEnabled directly.
 */

export type FeatureKey =
  | 'quizzes'
  | 'chat'
  | 'mentorship'
  | 'userManagement'
  | 'adminOverview'
  | 'freeUserContent'
  | 'aiProctoring';

export const FEATURE_AVAILABILITY: Record<FeatureKey, boolean> = {
  // Quiz ecosystem — fully enabled.
  quizzes: true,

  // Temporarily disabled features — flip to true to re-enable.
  chat: false, // groups, chat screens, calls, group management modals
  mentorship: false, // mentor "My Students" assignments, student tasks
  userManagement: false, // admin Users screen, create/edit user modals
  adminOverview: false, // admin Overview dashboard
  freeUserContent: false, // free-user Transformations, Graphs, learning tools

  // AI proctoring rollout flag — mirrors backend/config/featureAvailability.js
  // and client/src/config/features.ts. False until the staged rollout begins.
  aiProctoring: false,
};

/** @returns true only when the feature is explicitly enabled. */
export function isFeatureEnabled(feature: FeatureKey): boolean {
  return FEATURE_AVAILABILITY[feature] === true;
}

/** Friendly names used by the Coming Soon screen. */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  quizzes: 'Tests',
  chat: 'Chat & Calls',
  mentorship: 'Mentorship',
  userManagement: 'User Management',
  adminOverview: 'Overview',
  freeUserContent: 'Learning Tools',
  aiProctoring: 'Proctoring',
};
