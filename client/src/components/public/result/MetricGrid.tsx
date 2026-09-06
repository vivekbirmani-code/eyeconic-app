import {
  Award,
  CheckCircle2,
  Clock,
  Flag,
  Timer,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { QuizResultSummary } from './types';
import { formatDuration, formatPercentage } from './format';

interface Metric {
  key: string;
  label: string;
  value: string;
  icon: LucideIcon;
  iconColor: string;
}

/**
 * The six-metric grid — web port of the mobile app's PerformanceMetricGrid
 * row (same metrics, icons and colours the authenticated student sees).
 * 2 columns on phones, 3 on tablets, 6 across on desktop.
 */
export default function MetricGrid({ summary }: { summary: QuizResultSummary }) {
  const metrics: Metric[] = [
    { key: 'correct', label: 'Correct', value: String(summary.correct), icon: CheckCircle2, iconColor: '#10B981' },
    { key: 'incorrect', label: 'Incorrect', value: String(summary.incorrect), icon: XCircle, iconColor: '#EF4444' },
    { key: 'skipped', label: 'Unattempted', value: String(summary.skipped), icon: Clock, iconColor: '#F59E0B' },
    { key: 'marked', label: 'Marked for Review', value: String(summary.markedForReviewCount), icon: Flag, iconColor: '#6B7280' },
    { key: 'accuracy', label: 'Accuracy', value: formatPercentage(summary.accuracy), icon: Award, iconColor: '#8B5CF6' },
    { key: 'time', label: 'Time Taken', value: formatDuration(summary.timeTakenSeconds), icon: Timer, iconColor: '#3B82F6' },
  ];

  return (
    <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" aria-label="Performance metrics">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <div
            key={metric.key}
            className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col items-center text-center"
          >
            <Icon className="w-6 h-6" style={{ color: metric.iconColor }} aria-hidden="true" />
            <p className="text-xl font-bold text-gray-900 mt-2 tabular-nums">{metric.value}</p>
            <p className="text-[11px] text-gray-500 mt-1 leading-tight">{metric.label}</p>
          </div>
        );
      })}
    </section>
  );
}
