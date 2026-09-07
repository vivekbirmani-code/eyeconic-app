import React from 'react';
import { FeatureComingSoon } from '@/components/FeatureComingSoon';
import { FeatureKey, isFeatureEnabled } from '@/utils/featureAvailability';

/**
 * Route-level guard for the temporary feature freeze
 * (see utils/featureAvailability.ts). Wrapped screens render the
 * FeatureComingSoon state while their feature is disabled — covering tab
 * navigation, direct navigation, deep links and restored routes — and render
 * normally once the feature is re-enabled, with no other code changes.
 *
 * Usage: `export default withFeatureGate('chat')(GroupsScreen)`
 */
export function withFeatureGate<P extends object>(feature: FeatureKey) {
  return (Component: React.ComponentType<P>) => {
    const displayName =
      Component.displayName || Component.name || 'Component';

    function GatedScreen(props: P) {
      if (!isFeatureEnabled(feature)) {
        return <FeatureComingSoon feature={feature} />;
      }
      return <Component {...props} />;
    }

    GatedScreen.displayName = `withFeatureGate(${displayName})`;
    return GatedScreen;
  };
}
