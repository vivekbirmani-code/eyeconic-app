import type { ReactNode } from 'react';
import ComingSoon from './ComingSoon';
import { isFeatureEnabled } from '../config/features';
import type { FeatureKey } from '../config/features';

interface FeatureGateProps {
  /** Feature required by the wrapped page. */
  feature: FeatureKey;
  children: ReactNode;
}

/**
 * Route-level guard for the temporary feature freeze (see config/features.ts).
 * Wrapped pages render the ComingSoon state while their feature is disabled —
 * covering sidebar navigation, direct URLs, refreshes and history navigation —
 * and render normally once the feature is re-enabled.
 */
export function FeatureGate({ feature, children }: FeatureGateProps) {
  if (!isFeatureEnabled(feature)) {
    return <ComingSoon feature={feature} />;
  }
  return <>{children}</>;
}
