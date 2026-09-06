import type { QuizResultSummary } from './types';
import { formatMarks } from './format';

const SLICES = [
  { key: 'correct', label: 'Correct', color: '#10B981', count: (s: QuizResultSummary) => s.correct },
  { key: 'wrong', label: 'Wrong', color: '#EF4444', count: (s: QuizResultSummary) => s.incorrect },
  { key: 'skipped', label: 'Skipped', color: '#F59E0B', count: (s: QuizResultSummary) => s.skipped },
];

/**
 * Question-distribution donut — web port of the mobile app's review-screen
 * "Overall Performance" pie (react-native-svg circles, stroke-dasharray
 * math kept identical: r=90, strokeWidth=20, rotated -90° so the first
 * slice starts at 12 o'clock, marks in the white hub).
 */
export default function DonutChart({ summary }: { summary: QuizResultSummary }) {
  const total = summary.correct + summary.incorrect + summary.skipped;
  const circumference = 2 * Math.PI * 90;

  // Pure slice math (no render-time accumulation): each slice's offset is
  // the sum of the fractions before it, so arcs always start at 12 o'clock.
  const fractions = SLICES.map((slice) => (total > 0 ? slice.count(summary) / total : 0));
  const arcs = SLICES.map((slice, i) => ({
    ...slice,
    fraction: fractions[i],
    offset: fractions.slice(0, i).reduce((sum, f) => sum + f, 0),
  }));

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6" aria-label="Question distribution">
      <h2 className="text-base font-bold text-gray-900 mb-4">Overall Performance</h2>

      {total === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">No question data available.</p>
      ) : (
        <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
          <svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label={`Correct ${summary.correct}, wrong ${summary.incorrect}, skipped ${summary.skipped}`} className="shrink-0">
            <g transform="rotate(-90 100 100)">
              {arcs.map((arc) =>
                arc.fraction > 0 ? (
                  <circle
                    key={arc.key}
                    cx="100"
                    cy="100"
                    r="90"
                    fill="transparent"
                    stroke={arc.color}
                    strokeWidth="20"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - arc.fraction)}
                    transform={`rotate(${arc.offset * 360} 100 100)`}
                  />
                ) : null
              )}
            </g>
            <circle cx="100" cy="100" r="70" fill="white" />
            <text x="100" y="96" textAnchor="middle" fontWeight="700" fontSize="24" fill="#1F2937">
              {formatMarks(summary.marksObtained)}
            </text>
            <text x="100" y="120" textAnchor="middle" fontSize="14" fill="#6B7280">
              Marks
            </text>
          </svg>

          <ul className="flex flex-row sm:flex-col flex-wrap justify-center gap-x-5 gap-y-2.5">
            {SLICES.map((slice) => (
              <li key={slice.key} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: slice.color }} aria-hidden="true" />
                <span className="text-sm text-gray-600">
                  {slice.label}{' '}
                  <span className="font-bold text-gray-900 tabular-nums">{slice.count(summary)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
