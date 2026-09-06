import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  XCircle,
} from 'lucide-react';
import QuizImage from '../QuizImage';
import type { GroupByOption, ResultQuestion } from './types';
import { formatDuration, formatResponseForDisplay, isAnswerRecorded } from './format';

type QuestionStatus = 'correct' | 'incorrect' | 'skipped';

const statusOf = (q: ResultQuestion): QuestionStatus => {
  if (!isAnswerRecorded(q.userAnswer)) return 'skipped';
  return q.isCorrect ? 'correct' : 'incorrect';
};

const GROUP_LABELS: Record<GroupByOption, string> = {
  section: 'By Section',
  subject: 'By Subject',
  topic: 'By Topic',
  tag: 'By Tag',
};

/**
 * Question-wise solutions review — web port of the mobile app's review
 * screen (app/(tabs)/quizzes/[id]/review/[attemptId].tsx): the same groupBy
 * switcher, section tabs, one-question-at-a-time pager with prev/next, the
 * option cards with Correct Answer / Your Answer / Your Selection badges,
 * assertion-reason blocks, explanation box and per-question time.
 *
 * Web adaptations (not mobile-copies): native select for groupBy, a question
 * palette for direct jumps on large sets, and arrow-key navigation.
 */
export default function SolutionsReview({
  questions,
  shareSolution,
  groupBy,
  onGroupByChange,
  reloading = false,
  focusSection = null,
  headingLabel,
}: {
  questions: ResultQuestion[];
  shareSolution: boolean;
  groupBy: GroupByOption;
  onGroupByChange: (next: GroupByOption) => void;
  reloading?: boolean;
  /** Section to pre-select (e.g. tapped from the section performance table). */
  focusSection?: string | null;
  /** Title for the active grouping ("Section", "Subject", …). */
  headingLabel: string;
}) {
  const groups = useMemo(() => {
    const seen: string[] = [];
    questions.forEach((q) => {
      if (!seen.includes(q.section)) seen.push(q.section);
    });
    return seen;
  }, [questions]);

  const [activeSection, setActiveSection] = useState<string>('all');
  const [index, setIndex] = useState(0);
  const questionTopRef = useRef<HTMLDivElement | null>(null);

  // A new grouping resets the view; an explicit focusSection (row tap from
  // the section table) selects that group when it exists.
  useEffect(() => {
    if (focusSection && groups.includes(focusSection)) {
      setActiveSection(focusSection);
    } else if (!groups.includes(activeSection)) {
      setActiveSection('all');
    }
    setIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, groups.join('|'), focusSection]);

  const filtered = useMemo(
    () => (activeSection === 'all' ? questions : questions.filter((q) => q.section === activeSection)),
    [questions, activeSection]
  );

  const current = filtered[index];
  const perSection = activeSection !== 'all';

  const goTo = useCallback((next: number) => {
    setIndex(Math.min(filtered.length - 1, Math.max(0, next)));
    questionTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [filtered.length]);

  // Arrow-key paging (only when no form control has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') goTo(index + 1);
      if (e.key === 'ArrowLeft') goTo(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, index]);

  if (!shareSolution) {
    return (
      <section aria-label="Solutions">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Solutions &amp; Explanations</h2>
        <div className="bg-amber-50 border border-amber-400 rounded-2xl p-5">
          <p className="font-semibold text-amber-800 flex items-center gap-2">
            <BookOpen className="w-5 h-5 shrink-0" aria-hidden="true" />
            Solutions Not Available
          </p>
          <p className="text-sm text-amber-800/90 mt-1.5 leading-relaxed">
            The instructor has not enabled solution sharing for this quiz. Your score has been saved.
          </p>
        </div>
      </section>
    );
  }

  if (questions.length === 0 || !current) {
    return null;
  }

  return (
    <section aria-label="Solutions and explanations" className={reloading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      {/* Header: title + groupBy switcher */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-bold text-gray-900">Solutions &amp; Explanations</h2>
        <label className="relative text-xs font-semibold text-blue-600">
          <span className="sr-only">Group questions by</span>
          <select
            value={groupBy}
            onChange={(e) => onGroupByChange(e.target.value as GroupByOption)}
            className="appearance-none bg-blue-50 border border-blue-600 rounded-lg pl-3 pr-7 py-1.5 text-blue-600 font-semibold cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {(Object.keys(GROUP_LABELS) as GroupByOption[]).map((option) => (
              <option key={option} value={option}>
                {GROUP_LABELS[option]}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
        </label>
      </div>

      {/* Section tabs with counts */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-3" role="tablist" aria-label={`${headingLabel} filter`}>
        <SectionChip
          label="All Questions"
          count={questions.length}
          active={activeSection === 'all'}
          onClick={() => {
            setActiveSection('all');
            setIndex(0);
          }}
        />
        {groups.map((group) => (
          <SectionChip
            key={group}
            label={group}
            count={questions.filter((q) => q.section === group).length}
            active={activeSection === group}
            onClick={() => {
              setActiveSection(group);
              setIndex(0);
            }}
          />
        ))}
      </div>

      <QuestionCard question={current} perSection={perSection} questionNumber={index + 1} />

      {/* Question palette */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mt-3">
        <p className="text-xs font-semibold text-gray-500 mb-2.5">Questions</p>
        <div className="flex flex-wrap gap-2">
          {filtered.map((q, i) => {
            const status = statusOf(q);
            return (
              <button
                key={q._id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Question ${i + 1} — ${status}`}
                aria-current={i === index}
                className={`w-9 h-9 rounded-lg text-xs font-bold border-2 transition-colors ${
                  i === index
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : status === 'correct'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : status === 'incorrect'
                        ? 'border-red-200 bg-red-50 text-red-600'
                        : 'border-amber-200 bg-amber-50 text-amber-600'
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-gray-400">
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-emerald-300 inline-block" /> Correct</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-red-300 inline-block" /> Incorrect</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-amber-300 inline-block" /> Unattempted</span>
        </div>
      </div>

      {/* Prev / progress / next */}
      <div className="flex items-center justify-between gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 mt-3">
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          className="inline-flex items-center gap-1 text-sm font-semibold text-gray-500 px-3 py-2 rounded-lg hover:bg-gray-50 disabled:text-gray-300 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" /> Previous
        </button>
        <p className="text-sm font-semibold text-gray-600 tabular-nums" aria-live="polite">
          {index + 1} / {filtered.length}
        </p>
        <button
          type="button"
          onClick={() => goTo(index + 1)}
          disabled={index === filtered.length - 1}
          className="inline-flex items-center gap-1 text-sm font-semibold text-gray-500 px-3 py-2 rounded-lg hover:bg-gray-50 disabled:text-gray-300 disabled:hover:bg-transparent"
        >
          Next <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function SectionChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
        active
          ? 'bg-blue-600 border-blue-600 text-white'
          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
      }`}
    >
      <span className="max-w-[160px] truncate">{label}</span>
      <span
        className={`rounded-full px-1.5 py-px text-[10px] tabular-nums ${
          active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function QuestionCard({
  question,
  perSection,
  questionNumber,
}: {
  question: ResultQuestion;
  perSection: boolean;
  questionNumber: number;
}) {
  const status = statusOf(question);
  const answered = isAnswerRecorded(question.userAnswer);
  const isChoiceList = !['multiple_correct', 'match_the_following', 'numerical'].includes(question.questionType || '');

  return (
    <article
      className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 sm:p-6"
      aria-label={`Question ${questionNumber}`}
    >
      {/* Header: number, badges, result icon */}
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-blue-600 mb-2">
            Question {questionNumber}
            {perSection && question.section ? (
              <span className="text-gray-500 font-medium"> · {question.section}</span>
            ) : null}
          </p>
          <div className="flex flex-wrap gap-2">
            {question.section ? (
              <span className="bg-blue-50 text-gray-700 text-xs font-medium px-3 py-1 rounded-full">{question.section}</span>
            ) : null}
            {typeof question.marks === 'number' ? (
              <span className="bg-emerald-100 text-gray-700 text-xs font-medium px-3 py-1 rounded-full">
                {question.marks} marks
              </span>
            ) : null}
            {question.markedForReview ? (
              <span className="bg-violet-100 text-violet-700 text-xs font-semibold px-3 py-1 rounded-full">
                Marked for review
              </span>
            ) : null}
          </div>
        </div>
        <span
          className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
            status === 'correct'
              ? 'bg-emerald-100'
              : status === 'incorrect'
                ? 'bg-red-100'
                : 'bg-amber-100'
          }`}
          aria-hidden="true"
        >
          {status === 'correct' ? (
            <CheckCircle2 className="w-7 h-7 text-emerald-500" />
          ) : status === 'incorrect' ? (
            <XCircle className="w-7 h-7 text-red-500" />
          ) : (
            <Clock className="w-7 h-7 text-amber-500" />
          )}
        </span>
      </header>

      {question.assertion ? (
        <div className="bg-gray-50 rounded-xl p-3 mb-2 text-sm text-gray-700 leading-relaxed">
          <span className="font-semibold text-gray-500 text-[11px] uppercase tracking-wide block mb-1">Assertion</span>
          {question.assertion}
        </div>
      ) : null}
      {question.reason ? (
        <div className="bg-gray-50 rounded-xl p-3 mb-2 text-sm text-gray-700 leading-relaxed">
          <span className="font-semibold text-gray-500 text-[11px] uppercase tracking-wide block mb-1">Reason</span>
          {question.reason}
        </div>
      ) : null}

      <p className="text-base text-gray-900 font-medium leading-relaxed whitespace-pre-line mb-4">{question.question}</p>

      {question.questionImage ? (
        <QuizImage src={question.questionImage} alt={`Question ${questionNumber} image`} className="mb-4" />
      ) : null}

      {/* Answers */}
      {isChoiceList ? (
        <div className="space-y-2.5 mb-4">
          {(question.options || []).map((option, i) => {
            const isSelected = question.userAnswer === i;
            const isCorrectOption = question.correctAnswer === i;
            const isWrongSelection = isSelected && !isCorrectOption;
            const optionImage = question.optionImages?.[i];

            return (
              <div
                key={i}
                className={`border-2 rounded-xl p-3.5 flex items-start gap-3 ${
                  isCorrectOption
                    ? 'border-emerald-500 bg-emerald-50'
                    : isWrongSelection
                      ? 'border-red-500 bg-red-50'
                      : isSelected
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 bg-white'
                }`}
              >
                <span
                  className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                    isCorrectOption
                      ? 'bg-emerald-100 text-emerald-700'
                      : isWrongSelection
                        ? 'bg-red-100 text-red-600'
                        : 'bg-gray-100 text-gray-600'
                  }`}
                  aria-hidden="true"
                >
                  {isCorrectOption ? (
                    <CheckCircle2 className="w-[18px] h-[18px] text-emerald-600" />
                  ) : isWrongSelection ? (
                    <XCircle className="w-[18px] h-[18px] text-red-500" />
                  ) : (
                    String.fromCharCode(65 + i)
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm leading-relaxed ${isCorrectOption || isWrongSelection || isSelected ? 'text-gray-900 font-medium' : 'text-gray-600'}`}>
                    {option}
                  </span>
                  {optionImage ? (
                    <QuizImage src={optionImage} alt={`Option ${String.fromCharCode(65 + i)} image`} className="mt-2 border-0" />
                  ) : null}
                </span>
                {isCorrectOption ? (
                  <span className="bg-emerald-500 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full shrink-0 mt-0.5">
                    Correct Answer
                  </span>
                ) : isWrongSelection ? (
                  <span className="bg-red-500 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full shrink-0 mt-0.5">
                    Your Answer
                  </span>
                ) : isSelected ? (
                  <span className="bg-indigo-500 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full shrink-0 mt-0.5">
                    Your Selection
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2.5 mb-4">
          <div className="border-2 border-gray-200 rounded-xl p-3.5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Your answer</p>
            <p
              className={`text-sm font-semibold ${
                answered && question.isCorrect ? 'text-emerald-700' : 'text-red-600'
              }`}
            >
              {formatResponseForDisplay(question.questionType, question.userAnswer, question.columnA, question.columnB)}
            </p>
          </div>
          <div className="border-2 border-emerald-500 bg-emerald-50 rounded-xl p-3.5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Correct answer</p>
            <p className="text-sm font-semibold text-emerald-700">
              {formatResponseForDisplay(question.questionType, question.correctAnswer, question.columnA, question.columnB)}
            </p>
          </div>
          {question.questionType === 'match_the_following' ? (
            <div className="border-2 border-gray-200 rounded-xl p-3.5 text-sm text-gray-700 space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Columns</p>
              {(question.columnA || []).map((left, i) => (
                <p key={`a-${i}`}>{i + 1}. {left}</p>
              ))}
              {(question.columnB || []).map((right, i) => (
                <p key={`b-${i}`}>{String.fromCharCode(65 + i)}. {right}</p>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {!answered ? (
        <div className="bg-amber-50 border border-amber-400 rounded-xl p-3.5 mb-4 flex items-center gap-2">
          <AlertTriangle className="w-[18px] h-[18px] text-amber-600 shrink-0" aria-hidden="true" />
          <p className="text-sm font-semibold text-amber-800">You did not answer this question</p>
        </div>
      ) : null}

      {question.explanation ? (
        <div className="mb-4">
          <h3 className="text-base font-bold text-gray-900 mb-2">Explanation</h3>
          <div className="bg-blue-50 border-l-4 border-blue-600 rounded-r-xl p-4">
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">{question.explanation}</p>
            {question.explanationImage ? (
              <QuizImage src={question.explanationImage} alt={`Question ${questionNumber} explanation image`} className="mt-3 border-0" />
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <span className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-500">
          Time spent: <span className="font-semibold text-gray-700 tabular-nums">{formatDuration(question.timeSpent || 0)}</span>
        </span>
      </div>
    </article>
  );
}
