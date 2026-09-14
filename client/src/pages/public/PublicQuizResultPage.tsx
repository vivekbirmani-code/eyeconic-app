import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  Loader2,
  MailCheck,
  ShieldCheck,
  TimerReset,
} from 'lucide-react';
import { publicQuizApi, usePublicQuiz } from '../../contexts/PublicQuizContext';
import { getErrorData } from '../../services/publicApi';
import DonutChart from '../../components/public/result/DonutChart';
import MetricGrid from '../../components/public/result/MetricGrid';
import ScoreCard from '../../components/public/result/ScoreCard';
import SectionPerformanceTable from '../../components/public/result/SectionPerformanceTable';
import SolutionsReview from '../../components/public/result/SolutionsReview';
import type { GroupByOption, PublicResultPayload } from '../../components/public/result/types';

const GROUP_HEADING: Record<GroupByOption, string> = {
  section: 'Section',
  subject: 'Subject',
  topic: 'Topic',
  tag: 'Tag',
};

/**
 * Public quiz result page — the guest-facing equivalent of the mobile app's
 * authenticated result + review screens. Same payload (backend
 * buildAttemptResults is shared between both flows), same metrics,
 * terminology and visual language: score hero with pass/fail state,
 * six-metric grid, section performance table and a full question-wise
 * solutions review. Adapted for the web: responsive two-column hero, native
 * selects, a question palette and arrow-key navigation.
 */
export default function PublicQuizResultPage() {
  const { token = '', attemptId = '' } = useParams<{ token: string; attemptId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { handleSessionExpired } = usePublicQuiz();

  // Set when the guest was routed here because the one-attempt-per-person
  // restriction stopped a repeat attempt — the banner explains why they are
  // seeing their previous result instead of the quiz.
  const alreadyAttempted =
    (location.state as { alreadyAttempted?: boolean } | null | undefined)?.alreadyAttempted === true;

  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicResultPayload | null>(null);
  const [groupBy, setGroupBy] = useState<GroupByOption>('section');
  const [focusSection, setFocusSection] = useState<string | null>(null);

  // Distinguishes the first load (full-screen spinner) from groupBy refetches
  // (payload stays visible, review dims briefly) without racing state updates.
  const hasResultRef = useRef(false);
  const reviewRef = useRef<HTMLDivElement | null>(null);

  // Initial load + every groupBy switch. A stale in-flight response (the
  // user switched grouping again before it landed) is discarded so the view
  // always matches the selected grouping.
  useEffect(() => {
    let cancelled = false;
    const isRefetch = hasResultRef.current;
    if (isRefetch) setReloading(true);

    (async () => {
      try {
        const response = await publicQuizApi.result(token, attemptId, groupBy);
        if (cancelled) return;
        const payload = response.data as PublicResultPayload;
        hasResultRef.current = true;
        setResult(payload);
        setError(null);
        // NOTE: We intentionally do NOT call forgetAttempt() here. The
        // attempt pointer in localStorage must remain available so that the
        // taking page can always resolve the result URL (e.g. if the guest
        // re-verifies and the taking page calls /start and gets
        // attemptFinalized:true — it needs the stored pointer to navigate to
        // /result/:attemptId). The pointer is naturally overwritten when the
        // student starts a new quiz via rememberAttempt(), so keeping it here
        // causes no harm.
      } catch (err) {
        if (cancelled) return;
        if (getErrorData(err)?.status === 401) {
          handleSessionExpired();
          navigate(`/public-quiz/${token}`, { replace: true });
          return;
        }
        setError('Your result is not available. If you just submitted, try verifying your email again.');
      } finally {
        if (!cancelled) {
          if (!isRefetch) setLoading(false);
          setReloading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, token, attemptId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] flex flex-col items-center justify-center p-4">
        <Loader2 className="w-10 h-10 text-white animate-spin mb-3" aria-hidden="true" />
        <p className="text-white/90 text-sm font-medium">Calculating your result…</p>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] flex flex-col items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 shadow-2xl max-w-md w-full text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" aria-hidden="true" />
          <p className="text-gray-700 font-medium text-sm">{error}</p>
          <button
            onClick={() => navigate(`/public-quiz/${token}`, { replace: true })}
            className="mt-4 bg-[#01b4ae] hover:bg-[#008f8a] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
          >
            Verify email again
          </button>
        </div>
      </div>
    );
  }

  const { summary, attempt, quiz, guest, questions } = result;
  const subjectName = typeof quiz.subject === 'object' && quiz.subject ? quiz.subject.name : quiz.subject;
  const isAutoSubmitted = attempt.status === 'auto_submitted';
  const showSections = result.hasSectionData !== false && attempt.sectionPerformance.length > 0;

  const handleSectionSelect = (sectionName: string) => {
    setFocusSection(sectionName);
    reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header — the app's result header (badge, title, completion stamp)
          plus the verified participant identity the public flow collected. */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-5 sm:py-6">
          <p className="text-xs font-bold text-blue-600 uppercase tracking-[0.05em]">Quiz Completed</p>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mt-1 leading-snug">{quiz.title}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-sm text-gray-500">
            {subjectName ? <span>{subjectName}</span> : null}
            {attempt.endTime ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="w-4 h-4 text-gray-400" aria-hidden="true" />
                {new Date(attempt.endTime).toLocaleDateString()} · {new Date(attempt.endTime).toLocaleTimeString()}
              </span>
            ) : null}
            {isAutoSubmitted ? (
              <span className="font-semibold text-amber-600">Auto-submitted</span>
            ) : null}
          </div>

          {/* Verified participant (lead) — name, OTP-verified email, masked phone */}
          <div className="mt-4 inline-flex flex-wrap items-center gap-x-3 gap-y-1 bg-gray-50 border border-gray-100 rounded-xl px-3.5 py-2">
            <span className="w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center" aria-hidden="true">
              {guest.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <span className="text-sm font-semibold text-gray-800">{guest.name}</span>
            {guest.email ? (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <MailCheck className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
                {guest.email}
              </span>
            ) : null}
            <span className="text-xs text-gray-400 tabular-nums">{guest.phoneMasked}</span>
          </div>
        </div>
      </header>

      {alreadyAttempted && (
        <div className="max-w-4xl mx-auto px-4 pt-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-xs text-amber-800 font-medium leading-relaxed">
              You have already attempted this quiz — each public quiz can be attempted only once. This is your
              existing result.
            </p>
          </div>
        </div>
      )}

      {isAutoSubmitted && (
        <div className="max-w-4xl mx-auto px-4 pt-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
            <TimerReset className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-xs text-amber-800 font-medium leading-relaxed">
              Time expired — this attempt was auto-submitted with whatever was answered. Unattempted questions were
              not penalized.
            </p>
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Hero: score card + question-distribution donut */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ScoreCard summary={summary} />
          <DonutChart summary={summary} />
        </div>

        <MetricGrid summary={summary} />

        {showSections && (
          <SectionPerformanceTable sections={attempt.sectionPerformance} onSelectSection={handleSectionSelect} />
        )}

        <div ref={reviewRef} className="scroll-mt-4">
          <SolutionsReview
            questions={questions}
            shareSolution={quiz.shareSolution}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            reloading={reloading}
            focusSection={focusSection}
            headingLabel={GROUP_HEADING[groupBy]}
          />
        </div>

        <p className="text-center text-gray-400 text-xs pt-2 pb-4">
          Powered by Eyeconic Mentors · Your path to medical excellence
        </p>
      </main>
    </div>
  );
}
