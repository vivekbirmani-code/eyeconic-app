import { Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { FEATURE_LABELS, isFeatureEnabled } from '../config/features';
import type { FeatureKey } from '../config/features';

interface ComingSoonProps {
  /** Feature whose availability is being reported. */
  feature: FeatureKey;
}

/**
 * Professional "Coming Soon" state for temporarily disabled features
 * (see config/features.ts). Rendered by FeatureGate instead of disabled
 * pages so the app never shows a broken or empty screen.
 */
export default function ComingSoon({ feature }: ComingSoonProps) {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-md w-full text-center bg-white rounded-2xl border border-gray-100 shadow-sm p-10">
        <div className="mx-auto w-16 h-16 rounded-full bg-[#01b4ae]/10 flex items-center justify-center mb-5">
          <Clock size={28} className="text-[#01b4ae]" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#01b4ae] mb-1">
          {FEATURE_LABELS[feature]}
        </p>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Coming Soon</h2>
        <p className="text-sm text-gray-500 leading-relaxed mb-8">
          This feature is temporarily unavailable and will be enabled in a
          future version.
        </p>
        {isFeatureEnabled('quizzes') && user?.role === 'admin' && (
          <button
            onClick={() => navigate('/quizzes')}
            className="inline-flex items-center justify-center px-7 py-3 bg-[#01b4ae] text-white text-sm font-semibold rounded-xl hover:bg-[#01a19c] transition-colors"
          >
            Go to Tests
          </button>
        )}
      </div>
    </div>
  );
}
