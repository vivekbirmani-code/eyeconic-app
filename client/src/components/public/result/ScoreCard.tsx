import { Award, CheckCircle2, XCircle } from 'lucide-react';
import type { QuizResultSummary } from './types';
import { formatMarks, formatPercentage, pluralize } from './format';

/**
 * The score hero card — web port of the mobile app's result score card
 * (app/(tabs)/quizzes/[id]/result/[attemptId].tsx): pass/fail icon,
 * correct/total, "N Questions Correct", purple marks pill, and the Overall
 * Score percentage coloured by the app's 50% pass threshold.
 */
export default function ScoreCard({ summary }: { summary: QuizResultSummary }) {
  const hasPercentage = summary.scorePercentage !== null && Number.isFinite(summary.scorePercentage);
  const isPassing = hasPercentage && (summary.scorePercentage as number) >= 50;
  const questionLabel = pluralize(summary.correct, 'Question');

  return (
    <section
      className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 flex flex-col items-center text-center"
      aria-label="Overall score"
    >
      <div className="mb-4" aria-hidden="true">
        {isPassing ? (
          <CheckCircle2 className="w-16 h-16 text-emerald-500" strokeWidth={1.75} />
        ) : (
          <XCircle className="w-16 h-16 text-red-500" strokeWidth={1.75} />
        )}
      </div>

      <p className="text-5xl font-bold text-gray-900 tabular-nums leading-none">
        {summary.correct}/{summary.totalQuestions}
      </p>
      <p className="text-base text-gray-500 mt-2">{questionLabel} Correct</p>

      <div className="mt-4 inline-flex items-center gap-1.5 bg-violet-50 text-gray-700 px-4 py-2 rounded-full">
        <Award className="w-[18px] h-[18px] text-violet-500" aria-hidden="true" />
        <span className="text-base">
          Score:{' '}
          <span className="text-lg font-bold text-violet-500 tabular-nums">
            {formatMarks(summary.marksObtained)}
          </span>
          <span className="text-sm text-gray-500">/{formatMarks(summary.totalMarks)} marks</span>
        </span>
      </div>

      <div className="mt-4">
        <p
          className={`text-3xl font-bold tabular-nums ${
            !hasPercentage ? 'text-gray-400' : isPassing ? 'text-emerald-500' : 'text-red-500'
          }`}
        >
          {formatPercentage(summary.scorePercentage)}
        </p>
        <p className="text-[13px] text-gray-500 mt-1">Overall Score</p>
      </div>
    </section>
  );
}
