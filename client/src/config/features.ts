/**
 * TEMPORARY FEATURE FREEZE — single source of truth for feature availability
 * in the web client. While the app is in quiz-only mode, every feature except
 * the Quiz ecosystem (Tests hub, question bank, create/import, analytics,
 * retests, and the public quiz guest flow) is temporarily disabled for all
 * roles.
 *
 * Nothing is deleted: routes, pages and navigation stay in place and each
 * feature comes back by flipping its flag to `true` here. The backend
 * (backend/config/featureAvailability.js) and the mobile app
 * (utils/featureAvailability.ts) mirror these flags.
 *
 * Gating layers:
 *  - Sidebar: disabled items stay visible but are not clickable
 *    (see layouts/MainLayout.tsx).
 *  - Routes: <FeatureGate feature="..."> renders the ComingSoon page for
 *    disabled features, covering direct URLs, refreshes and history
 *    navigation (see App.tsx).
 *  - The public quiz routes (/public-quiz/...) are intentionally ungated.
 */

export type FeatureKey = 'quizzes' | 'dashboard' | 'chat' | 'userManagement';

export const FEATURE_AVAILABILITY: Record<FeatureKey, boolean> = {
  // Quiz ecosystem — fully enabled.
  quizzes: true,

  // Temporarily disabled features — flip to true to re-enable.
  dashboard: false, // admin dashboard overview page
  chat: false, // groups list, group chat
  userManagement: false, // admin Users page
};

/** @returns true only when the feature is explicitly enabled. */
export function isFeatureEnabled(feature: FeatureKey): boolean {
  return FEATURE_AVAILABILITY[feature] === true;
}

/** Friendly names used by the Coming Soon page. */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  quizzes: 'Tests',
  dashboard: 'Dashboard',
  chat: 'Groups & Chat',
  userManagement: 'User Management',
};
