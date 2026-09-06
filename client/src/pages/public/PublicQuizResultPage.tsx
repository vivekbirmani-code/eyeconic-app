import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  XCircle,
} from 'lucide-react';
import { publicQuizApi, usePublicQuiz } from '../../contexts/PublicQuizContext';
import { forgetAttempt, getErrorData } from '../../services/publicApi';

interface ResultPayload {
  success: boolean;
  summary: {
    correct: number;
    incorrect: number;
    skipped: number;
    attempted: number;
    totalQuestions: number;
    marksObtained: number;
    totalMarks: number;
    scorePercentage: number;
    accuracy: number;
    timeTakenSeconds: number;
  };
  attempt: {
    _id: string;
    status: string;
    endTime: string;
    sectionPerformance: {
      sectionName: string;
      correct: number;
      incorrect: number;
      skipped: number;
      timeSpent: number;
      accuracy: number;
      total?: number;
    }[];
    tabSwitchCount?: number;
  };
  quiz: { _id: string; title: string; shareSolution: boolean };
  guest: { _id: string; name: string; email: string | null; phoneMasked: string };
  questions?: {
    _id: string;
    question: string;
    questionImage?: string | null;
    userAnswer: unknown;
    isCorrect: boolean | null;
    correctAnswer?: unknown;
    explanation?: string;
    explanationImage?: string | null;
    section: string;
    questionType: string;
  }[];
  hasSectionData?: boolean;
}

const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  }
  return `${mins}m ${secs}s`;
};

export default function PublicQuizResultPage() {
  const { token = '', attemptId = '' } = useParams<{ token: string; attemptId: string }>();
  const navigate = useNavigate();
  const { handleSessionExpired } = usePublicQuiz();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultPayload | null>(null);
  const [showSolutions, setShowSolutions] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const response = await publicQuizApi.result(token, attemptId, 'section');
        if (!cancelled) {
          setResult(response.data as ResultPayload);
          // The attempt is finished — clear the mid-quiz pointer.
          forgetAttempt();
        }
      } catch (err) {
        if (cancelled) return;
        if (getErrorData(err)?.status === 401) {
          handleSessionExpired();
          navigate(`/public-quiz/${token}`, { replace: true });
          return;
        }
        setError('Your result is not available. If you just submitted, try verifying your email again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, attemptId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] flex flex-col items-center justify-center p-4">
        <Loader2 className="w-10 h-10 text-white animate-spin mb-3" />
        <p className="text-white/90 text-sm font-medium">Calculating your result…</p>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] flex flex-col items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 shadow-2xl max-w-md w-full text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
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
  const hasSolutions = Boolean(questions && questions.length > 0 && quiz.shareSolution);

  return (
    <div className="min-h-screen bg-gray-100 pb-10">
      {/* Score hero */}
      <div className="bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] px-4 pt-10 pb-16 rounded-b-[2.5rem]">
        <div className="max-w-2xl mx-auto text-center">
          <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-3">
            <Award className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-white text-2xl font-bold drop-shadow-sm">{quiz.title}</h1>
          <p className="text-white/80 text-xs mt-1">
            {guest.name}
            {guest.email ? ` · ${guest.email}` : ''} · {guest.phoneMasked}
          </p>

          <div className="mt-6 bg-white rounded-3xl shadow-2xl p-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Your Score</p>
            <p className="text-5xl font-extrabold text-[#01b4ae] mt-1 tabular-nums">
              {summary.scorePercentage}%
            </p>
            <p className="text-sm text-gray-600 font-medium mt-1">
              {summary.marksObtained} / {summary.totalMarks} marks
            </p>

            <div className="grid grid-cols-4 gap-2 mt-5">
              <div className="bg-emerald-50 rounded-xl py-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto mb-0.5" />
                <p className="text-base font-bold text-emerald-700">{summary.correct}</p>
                <p className="text-[10px] text-emerald-600 uppercase">Correct</p>
              </div>
              <div className="bg-red-50 rounded-xl py-2.5">
                <XCircle className="w-4 h-4 text-red-400 mx-auto mb-0.5" />
                <p className="text-base font-bold text-red-600">{summary.incorrect}</p>
                <p className="text-[10px] text-red-500 uppercase">Wrong</p>
              </div>
              <div className="bg-gray-100 rounded-xl py-2.5">
                <div className="w-4 h-4 mx-auto mb-0.5 rounded border-2 border-gray-400" />
                <p className="text-base font-bold text-gray-600">{summary.skipped}</p>
                <p className="text-[10px] text-gray-500 uppercase">Skipped</p>
              </div>
              <div className="bg-[#01b4ae]/10 rounded-xl py-2.5">
                <Clock className="w-4 h-4 text-[#01b4ae] mx-auto mb-0.5" />
                <p className="text-base font-bold text-[#008f8a]">{formatDuration(summary.timeTakenSeconds)}</p>
                <p className="text-[10px] text-[#008f8a] uppercase">Time</p>
              </div>
            </div>

            <div className="mt-4 bg-gray-50 rounded-xl px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">Accuracy (of attempted)</span>
              <span className="text-sm font-bold text-gray-800">{summary.accuracy}%</span>
            </div>
            {attempt.status === 'auto_submitted' && (
              <p className="text-[11px] text-amber-600 font-medium mt-3">
                This attempt was auto-submitted when the timer expired.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Section performance */}
      <div className="max-w-2xl mx-auto px-4 -mt-8">
        {attempt.sectionPerformance.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Performance by subject</h2>
            <div className="space-y-2">
              {attempt.sectionPerformance.map((section) => (
                <div key={section.sectionName} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold text-gray-800">{section.sectionName}</span>
                    <span className="text-xs font-bold text-[#008f8a]">{section.accuracy}% accuracy</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#01b4ae] rounded-full transition-all"
                      style={{ width: `${section.accuracy}%` }}
                    />
                  </div>
                  <div className="flex gap-3 mt-1.5 text-[11px] text-gray-500">
                    <span>✓ {section.correct}</span>
                    <span>✗ {section.incorrect}</span>
                    <span>— {section.skipped}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Solutions */}
        {hasSolutions ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <button
              type="button"
              onClick={() => setShowSolutions((v) => !v)}
              className="w-full flex items-center justify-between"
            >
              <h2 className="text-sm font-bold text-gray-900 inline-flex items-center gap-2">
                {showSolutions ? <Eye className="w-4 h-4 text-[#01b4ae]" /> : <EyeOff className="w-4 h-4 text-gray-400" />}
                Review solutions ({questions!.length} questions)
              </h2>
              <span className="text-xs font-semibold text-[#008f8a]">{showSolutions ? 'Hide' : 'Show'}</span>
            </button>

            {showSolutions && (
              <div className="mt-4 space-y-3">
                {questions!.map((q, index) => (
                  <div
                    key={q._id}
                    className={`rounded-xl border-2 p-3.5 ${
                      q.isCorrect === true
                        ? 'border-emerald-100 bg-emerald-50/50'
                        : q.isCorrect === false
                          ? 'border-red-100 bg-red-50/40'
                          : 'border-gray-100 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      <span
                        className={`w-5 h-5 shrink-0 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5 ${
                          q.isCorrect === true
                            ? 'bg-emerald-200 text-emerald-700'
                            : q.isCorrect === false
                              ? 'bg-red-200 text-red-700'
                              : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {index + 1}
                      </span>
                      <p className="text-sm text-gray-800 leading-relaxed">{q.question}</p>
                    </div>
                    {q.questionImage && (
                      <img src={q.questionImage} alt="Question" className="max-w-full rounded-lg mb-2 border border-gray-100" />
                    )}
                    {q.explanation && (
                      <p className="text-xs text-gray-600 bg-white/70 rounded-lg p-2.5 border border-gray-100 leading-relaxed">
                        <span className="font-semibold text-gray-700">Explanation: </span>
                        {q.explanation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 text-center">
            <EyeOff className="w-6 h-6 text-gray-300 mx-auto mb-2" />
            <p className="text-xs text-gray-500">
              Solutions are not shared for this test. Your score has been saved.
            </p>
          </div>
        )}

        <p className="text-center text-gray-400 text-[11px] mt-6">
          Powered by Eyeconic Mentors · Your path to medical excellence
        </p>
      </div>
    </div>
  );
}
