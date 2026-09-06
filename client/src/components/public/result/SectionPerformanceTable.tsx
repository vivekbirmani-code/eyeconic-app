import type { SectionPerformance } from './types';
import { formatDuration } from './format';

/**
 * Section-wise performance — web port of the mobile app's result-screen
 * table (Section | Correct | Wrong | Skip | Acc% | Time) with the same
 * colour-coded counts, plus the review screen's accuracy bars.
 *
 * A real table from sm up; below that each section becomes a stacked card so
 * nothing is horizontally scrolled on phones. Tapping a row jumps into the
 * solutions review pre-filtered to that section (same intent as the app's
 * row → review?section= navigation).
 */
export default function SectionPerformanceTable({
  sections,
  onSelectSection,
}: {
  sections: SectionPerformance[];
  onSelectSection?: (sectionName: string) => void;
}) {
  if (sections.length === 0) return null;

  const barColor = (pct: number) => (pct > 70 ? 'bg-emerald-500' : pct > 40 ? 'bg-amber-500' : 'bg-red-500');

  return (
    <section aria-label="Section performance">
      <h2 className="text-lg font-bold text-gray-900 mb-3">Section Performance</h2>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Table (sm and up) */}
        <table className="hidden sm:table w-full text-sm" aria-label="Section-wise performance table">
          <thead>
            <tr className="bg-gray-50 text-gray-900 border-b border-gray-200">
              <th scope="col" className="text-left font-bold text-xs uppercase tracking-wide px-4 py-3">Section</th>
              <th scope="col" className="text-center font-bold text-xs uppercase tracking-wide px-2 py-3">Correct</th>
              <th scope="col" className="text-center font-bold text-xs uppercase tracking-wide px-2 py-3">Wrong</th>
              <th scope="col" className="text-center font-bold text-xs uppercase tracking-wide px-2 py-3">Skip</th>
              <th scope="col" className="text-center font-bold text-xs uppercase tracking-wide px-2 py-3">Acc%</th>
              <th scope="col" className="text-right font-bold text-xs uppercase tracking-wide px-4 py-3">Time</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <tr
                key={section.sectionName}
                onClick={onSelectSection ? () => onSelectSection(section.sectionName) : undefined}
                className={`border-b border-gray-50 last:border-b-0 ${onSelectSection ? 'cursor-pointer hover:bg-blue-50/40' : ''}`}
              >
                <th scope="row" className="text-left font-medium text-gray-700 px-4 py-3 max-w-[220px]">
                  <span className="block truncate" title={section.sectionName}>{section.sectionName}</span>
                  <span
                    className="block h-1.5 rounded-full bg-gray-100 mt-1.5 overflow-hidden"
                    aria-hidden="true"
                  >
                    <span
                      className={`block h-full rounded-full ${barColor(section.accuracy)}`}
                      style={{ width: `${Math.min(100, Math.max(0, section.accuracy))}%` }}
                    />
                  </span>
                </th>
                <td className="text-center px-2 py-3 font-semibold text-emerald-600 tabular-nums">{section.correct}</td>
                <td className="text-center px-2 py-3 font-semibold text-red-500 tabular-nums">{section.incorrect}</td>
                <td className="text-center px-2 py-3 font-semibold text-amber-500 tabular-nums">{section.skipped}</td>
                <td className="text-center px-2 py-3 text-gray-700 tabular-nums">{section.accuracy}%</td>
                <td className="text-right px-4 py-3 text-gray-600 tabular-nums">{formatDuration(section.timeSpent)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Stacked cards (below sm) */}
        <div className="sm:hidden divide-y divide-gray-50">
          {sections.map((section) => (
            <div
              key={section.sectionName}
              role={onSelectSection ? 'button' : undefined}
              tabIndex={onSelectSection ? 0 : undefined}
              onClick={onSelectSection ? () => onSelectSection(section.sectionName) : undefined}
              onKeyDown={
                onSelectSection
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectSection(section.sectionName);
                      }
                    }
                  : undefined
              }
              className={`p-4 ${onSelectSection ? 'active:bg-gray-50' : ''}`}
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-sm font-semibold text-gray-800 leading-snug">{section.sectionName}</p>
                <p className="text-xs font-bold text-gray-700 shrink-0 tabular-nums">{section.accuracy}%</p>
              </div>
              <span className="block h-1.5 rounded-full bg-gray-100 overflow-hidden mb-2.5" aria-hidden="true">
                <span
                  className={`block h-full rounded-full ${barColor(section.accuracy)}`}
                  style={{ width: `${Math.min(100, Math.max(0, section.accuracy))}%` }}
                />
              </span>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 tabular-nums">
                <span><span className="font-semibold text-emerald-600">{section.correct}</span> correct</span>
                <span><span className="font-semibold text-red-500">{section.incorrect}</span> wrong</span>
                <span><span className="font-semibold text-amber-500">{section.skipped}</span> skipped</span>
                <span className="ml-auto">{formatDuration(section.timeSpent)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
