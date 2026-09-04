import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Flag,
  Loader2,
  Send,
} from 'lucide-react';
import {
  publicQuizApi,
  usePublicQuiz,
} from '../../contexts/PublicQuizContext';
import {
  getErrorData,
  getGuestToken,
  recallAttemptId,
  rememberAttempt,
  type GuestAnswer,
  type PublicQuestion,
  type SectionState,
  type StartAttemptResponse,
} from '../../services/publicApi';

const AUTOSAVE_DEBOUNCE_MS = 3000;
const AUTOSAVE_HEARTBEAT_MS = 15000;

type AnswerMap = Record<number, GuestAnswer>;

const formatClock = (totalSeconds: number) => {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

const isAnswered = (value: unknown): boolean =>
  value !== -1 && value !== null && value !== undefined &&
  !(Array.isArray(value) && value.length === 0) &&
  !(typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);

export default function PublicQuizTakingPage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { guestId, handleSessionExpired } = usePublicQuiz();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [session, setSession] = useState<StartAttemptResponse | null>(null);
  const [sectionStates, setSectionStates] = useState<SectionState[]>([]);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [current, setCurrent] = useState(0);
  const [markedForReview, setMarkedForReview] = useState<Record<number, boolean>>({});
  const [nowMs, setNowMs] = useState(Date.now());
  const [serverClockOffset, setServerClockOffset] = useState(0);
  const [confirmSection, setConfirmSection] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const answersRef = useRef<AnswerMap>({});
  const markedRef = useRef<Record<number, boolean>>({});
  const tabSwitchRef = useRef({ count: 0, log: [] as string[] });
  const dirtyRef = useRef(false);
  const submittingRef = useRef(false);
  const lastAutoSubmitRef = useRef(0);
  const questionStartRef = useRef<number>(Date.now());
  const currentRef = useRef(0);
  answersRef.current = answers;
  markedRef.current = markedForReview;
  currentRef.current = current;

  const quiz = session?.quiz;
  const attempt = session?.attempt;
  const sectionLockEnabled = attempt?.sectionLockEnabled === true;
  const questions = quiz?.questions ?? [];

  // ---------- mount: (re)start the attempt — the authoritative resume channel ----------

  useEffect(() => {
    if (!getGuestToken()) {
      navigate(`/public-quiz/${token}`, { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const response = await publicQuizApi.start(token, guestId);
        if (cancelled) return;
        const data = response.data;
        if (data.attemptFinalized) {
          const attemptId = recallAttemptId(token);
          if (attemptId) {
            navigate(`/public-quiz/${token}/result/${attemptId}`, { replace: true });
          } else {
            setLoadError('This attempt has already ended.');
            setLoading(false);
          }
          return;
        }
        if (!data.attempt || !data.quiz) {
          setLoadError(data.message || 'Unable to start this quiz.');
          setLoading(false);
          return;
        }

        rememberAttempt(token, data.attempt._id);
        if (data.attempt.serverNow) {
          setServerClockOffset(Date.now() - new Date(data.attempt.serverNow).getTime());
        }
        setSession(data);
        setSectionStates(data.attempt.sectionStates ?? []);

        const restored: AnswerMap = {};
        (data.attempt.answers ?? []).forEach((a) => {
          restored[a.questionIndex] = a;
        });
        setAnswers(restored);
        const restoredMarked: Record<number, boolean> = {};
        (data.attempt.answers ?? []).forEach((a) => {
          if (a.markedForReview) restoredMarked[a.questionIndex] = true;
        });
        setMarkedForReview(restoredMarked);

        // Start (or resume) at the first question of the active section.
        const activeIndex = data.attempt.sectionStates?.find((s) => s.status === 'in_progress')?.index;
        const defs = data.attempt.sectionDefinitions ?? [];
        if (typeof activeIndex === 'number' && defs[activeIndex]?.questionIds?.length) {
          const qid = String(defs[activeIndex].questionIds[0]);
          const idx = data.quiz.questions.findIndex((q) => String(q._id) === qid);
          setCurrent(idx >= 0 ? idx : 0);
        } else {
          const firstUnanswered = data.quiz.questions.findIndex(
            (_, i) => !isAnswered(restored[i]?.selectedAnswer)
          );
          setCurrent(firstUnanswered >= 0 ? firstUnanswered : 0);
        }
        questionStartRef.current = Date.now();
      } catch (error) {
        if (cancelled) return;
        const extracted = getErrorData(error);
        if (extracted?.status === 401) {
          handleSessionExpired();
          navigate(`/public-quiz/${token}`, { replace: true });
          return;
        }
        setLoadError(extracted?.message || 'Unable to start this quiz.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, guestId, retryNonce]);

  // ---------- ticking clock ----------

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ---------- tab-switch tracking (visibilitychange, parity with the app) ----------

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        tabSwitchRef.current = {
          count: tabSwitchRef.current.count + 1,
          log: [...tabSwitchRef.current.log, new Date().toISOString()],
        };
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // ---------- derived quiz state ----------

  const questionIndexToSection = useMemo(() => {
    const map = new Map<string, number>();
    (attempt?.sectionDefinitions ?? []).forEach((def) => {
      def.questionIds.forEach((qid) => map.set(String(qid), def.index));
    });
    return map;
  }, [attempt?.sectionDefinitions]);

  const activeSectionState = useMemo(
    () => sectionStates.find((s) => s.status === 'in_progress') ?? null,
    [sectionStates]
  );

  const currentSectionIndex = useMemo(() => {
    if (!sectionLockEnabled || !quiz) return null;
    const q = questions[current];
    return q ? questionIndexToSection.get(String(q._id)) ?? null : null;
  }, [sectionLockEnabled, quiz, questions, current, questionIndexToSection]);

  const activeSectionQuestionIndexes = useMemo(() => {
    if (!sectionLockEnabled || !quiz) return questions.map((_, i) => i);
    const defs = attempt?.sectionDefinitions ?? [];
    const idx = activeSectionState?.index;
    if (typeof idx !== 'number' || !defs[idx]) return [];
    const ids = new Set(defs[idx].questionIds.map(String));
    return questions.map((q, i) => (ids.has(String(q._id)) ? i : -1)).filter((i) => i !== -1);
  }, [sectionLockEnabled, quiz, questions, attempt?.sectionDefinitions, activeSectionState]);

  const isQuestionLocked = useCallback(
    (index: number) => {
      if (!sectionLockEnabled || !quiz) return false;
      const q = questions[index];
      if (!q) return true;
      const secIdx = questionIndexToSection.get(String(q._id));
      if (typeof secIdx !== 'number') return false;
      const state = sectionStates.find((s) => s.index === secIdx);
      return !state || state.status !== 'in_progress';
    },
    [sectionLockEnabled, quiz, questions, questionIndexToSection, sectionStates]
  );
  void isQuestionLocked; // reserved for locked-section palette styling

  const secondsLeft = useMemo(() => {
    if (!quiz) return 0;
    // All deadlines are SERVER timestamps; serverClockOffset (client - server
    // at response time) converts the ticking client clock to server time so
    // device clock skew cannot extend or shrink either timer shape.
    if (sectionLockEnabled) {
      const endsAt = activeSectionState?.endsAt;
      if (!endsAt) return 0;
      return (new Date(endsAt).getTime() - (nowMs - serverClockOffset)) / 1000;
    }
    if (!attempt?.startTime) return 0;
    const deadline = new Date(attempt.startTime).getTime() + quiz.duration * 60 * 1000;
    return (deadline - (nowMs - serverClockOffset)) / 1000;
  }, [quiz, sectionLockEnabled, activeSectionState, attempt?.startTime, nowMs, serverClockOffset]);

  // ---------- answers ----------

  const buildAnswerPayload = useCallback((): GuestAnswer[] => {
    if (!questions.length) return [];
    return questions.map((q, index) => {
      const stored = answersRef.current[index];
      return {
        questionIndex: index,
        questionId: q._id,
        selectedAnswer: stored ? stored.selectedAnswer : -1,
        markedForReview: Boolean(markedRef.current[index]),
        timeSpent: stored?.timeSpent ?? 0,
      };
    });
  }, [questions]);

  const setAnswer = (value: unknown) => {
    const index = currentRef.current;
    const existing = answersRef.current[index];
    const elapsed = Math.round((Date.now() - questionStartRef.current) / 1000);
    setAnswers((prev) => ({
      ...prev,
      [index]: {
        questionIndex: index,
        questionId: questions[index]?._id,
        selectedAnswer: value,
        markedForReview: Boolean(markedRef.current[index]),
        timeSpent: (existing?.timeSpent ?? 0) + Math.min(elapsed, 600),
      },
    }));
    questionStartRef.current = Date.now();
    dirtyRef.current = true;
  };

  // Multi-select helper: toggle an index inside the current array value.
  const toggleMultiOption = (optionIndex: number) => {
    const currentAnswer = answersRef.current[currentRef.current]?.selectedAnswer;
    const arr = Array.isArray(currentAnswer) ? (currentAnswer as number[]) : [];
    const next = arr.includes(optionIndex)
      ? arr.filter((i) => i !== optionIndex)
      : [...arr, optionIndex].sort((a, b) => a - b);
    setAnswer(next);
  };

  const setMatchPair = (aIndex: number, bIndex: number) => {
    const currentAnswer = answersRef.current[currentRef.current]?.selectedAnswer;
    const obj =
      currentAnswer && typeof currentAnswer === 'object' && !Array.isArray(currentAnswer)
        ? { ...(currentAnswer as Record<string, number>) }
        : {};
    if (bIndex === -1) {
      delete obj[String(aIndex)];
    } else {
      obj[String(aIndex)] = bIndex;
    }
    setAnswer(Object.keys(obj).length > 0 ? obj : {});
  };

  // ---------- autosave ----------

  const saveProgress = useCallback(async () => {
    if (!attempt || submittingRef.current) return;
    try {
      await publicQuizApi.saveProgress(token, {
        guestId,
        attemptId: attempt._id,
        answers: buildAnswerPayload(),
        tabSwitchCount: tabSwitchRef.current.count,
        tabSwitchLog: tabSwitchRef.current.log,
      });
    } catch {
      // fire-and-forget — the next beat or submit retries
    }
  }, [attempt, token, guestId, buildAnswerPayload]);

  useEffect(() => {
    if (!attempt) return;
    const flush = () => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        saveProgress();
      }
    };
    const debounce = setInterval(flush, AUTOSAVE_DEBOUNCE_MS);
    const heartbeat = setInterval(saveProgress, AUTOSAVE_HEARTBEAT_MS);
    const onHide = () => {
      if (document.hidden) flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(debounce);
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [attempt, saveProgress]);

  // ---------- submissions ----------

  const goToResult = useCallback(
    (attemptId: string) => {
      submittingRef.current = true;
      navigate(`/public-quiz/${token}/result/${attemptId}`, { replace: true });
    },
    [navigate, token]
  );

  const finalizeWholeQuiz = useCallback(
    async (isAuto: boolean) => {
      if (!attempt || submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const response = await publicQuizApi.submit(token, {
          guestId,
          attemptId: attempt._id,
          answers: buildAnswerPayload(),
          tabSwitchCount: tabSwitchRef.current.count,
          tabSwitchLog: tabSwitchRef.current.log,
        });
        const attemptId = response.data.attemptId || attempt._id;
        goToResult(attemptId);
      } catch (error) {
        submittingRef.current = false;
        setSubmitting(false);
        if (getErrorData(error)?.status === 401) {
          handleSessionExpired();
          navigate(`/public-quiz/${token}`, { replace: true });
          return;
        }
        setBanner(isAuto ? 'Time is up — submitting failed, retrying…' : 'Submission failed. Please try again.');
      }
    },
    [attempt, token, guestId, buildAnswerPayload, goToResult, handleSessionExpired, navigate]
  );

  const submitCurrentSection = useCallback(
    async (isAuto: boolean) => {
      if (!attempt || submittingRef.current) return;
      const sectionIndex = activeSectionState?.index;
      if (typeof sectionIndex !== 'number') return;
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const response = await publicQuizApi.submitSection(token, sectionIndex, {
          guestId,
          attemptId: attempt._id,
          isAutoSubmit: isAuto,
          answers: buildAnswerPayload(),
        });
        const data = response.data;

        if (data.attemptFinalized || (!data.nextSection && !data.sectionStates)) {
          const attemptId = data.attemptId || attempt._id;
          goToResult(attemptId);
          return;
        }

        if (data.sectionStates) {
          setSectionStates(data.sectionStates);
        }
        dirtyRef.current = false;
        setBanner(
          isAuto
            ? 'Time for this section is up — it was submitted automatically.'
            : `Section submitted.${data.nextSection ? ` Next: ${data.nextSection.name}.` : ''}`
        );
        // Jump to the first question of the newly active section.
        if (data.nextSection) {
          const defs = attempt.sectionDefinitions ?? [];
          const def = defs[data.nextSection.index];
          const qid = def?.questionIds?.[0] ? String(def.questionIds[0]) : null;
          const idx = qid ? questions.findIndex((q) => String(q._id) === qid) : -1;
          setCurrent(idx >= 0 ? idx : currentRef.current);
          questionStartRef.current = Date.now();
        }
      } catch (error) {
        if (getErrorData(error)?.status === 401) {
          handleSessionExpired();
          navigate(`/public-quiz/${token}`, { replace: true });
          return;
        }
        setBanner('Submitting this section failed. Please try again.');
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [attempt, activeSectionState, token, guestId, buildAnswerPayload, goToResult, handleSessionExpired, navigate, questions]
  );

  // Timer auto-submit — throttled so a failing submit endpoint is retried at
  // most every few seconds instead of on every clock tick.
  useEffect(() => {
    if (loading || !attempt || submittingRef.current) return;
    if (secondsLeft > 0) return;
    if (Date.now() - lastAutoSubmitRef.current < 5000) return;
    lastAutoSubmitRef.current = Date.now();
    if (sectionLockEnabled && activeSectionState) {
      submitCurrentSection(true);
    } else if (!sectionLockEnabled) {
      finalizeWholeQuiz(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, loading, attempt, sectionLockEnabled, activeSectionState]);

  // ---------- render helpers ----------

  const currentQuestion: PublicQuestion | undefined = questions[current];
  const currentAnswerValue = answers[current]?.selectedAnswer;
  const answeredCount = activeSectionQuestionIndexes.filter((i) => isAnswered(answers[i]?.selectedAnswer)).length;
  const unansweredCount = activeSectionQuestionIndexes.length - answeredCount;

  const paletteIndexes = sectionLockEnabled ? activeSectionQuestionIndexes : questions.map((_, i) => i);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] flex flex-col items-center justify-center p-4">
        <Loader2 className="w-10 h-10 text-white animate-spin mb-3" />
        <p className="text-white/90 text-sm font-medium">Preparing your quiz…</p>
      </div>
    );
  }

  if (loadError || !quiz || !attempt || !currentQuestion) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] flex flex-col items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 shadow-2xl max-w-md w-full text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <p className="text-gray-700 font-medium text-sm">{loadError || 'This quiz is unavailable.'}</p>
          <div className="mt-4 flex gap-2.5 justify-center">
            <button
              onClick={() => {
                setLoadError(null);
                setRetryNonce((n) => n + 1);
              }}
              className="inline-flex items-center gap-1.5 border-2 border-gray-200 text-gray-600 text-sm font-semibold px-5 py-2.5 rounded-xl"
            >
              Try Again
            </button>
            <button
              onClick={() => navigate(`/public-quiz/${token}`, { replace: true })}
              className="bg-[#01b4ae] hover:bg-[#008f8a] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              Back to start
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderQuestionBody = () => {
    const q = currentQuestion;
    switch (q.questionType) {
      case 'multiple_correct': {
        const selected = Array.isArray(currentAnswerValue) ? (currentAnswerValue as number[]) : [];
        return (
          <div className="space-y-2.5">
            <p className="text-xs text-gray-500 mb-2">Select all correct options</p>
            {(q.options ?? []).map((option, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleMultiOption(i)}
                disabled={submitting}
                className={`w-full text-left border-2 rounded-xl p-3.5 flex items-start gap-3 transition-all ${
                  selected.includes(i)
                    ? 'border-[#01b4ae] bg-[#01b4ae]/5'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <span
                  className={`w-6 h-6 shrink-0 rounded-md border-2 flex items-center justify-center text-xs font-bold ${
                    selected.includes(i) ? 'border-[#01b4ae] bg-[#01b4ae] text-white' : 'border-gray-300 text-gray-500'
                  }`}
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="text-sm text-gray-800 leading-relaxed">{option}</span>
              </button>
            ))}
          </div>
        );
      }
      case 'match_the_following': {
        const pairs =
          currentAnswerValue && typeof currentAnswerValue === 'object' && !Array.isArray(currentAnswerValue)
            ? (currentAnswerValue as Record<string, number>)
            : {};
        return (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 mb-1">Match each item in Column A with Column B</p>
            <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
              <span>Column A</span>
              <span />
              <span>Column B</span>
            </div>
            {(q.columnA ?? []).map((leftItem, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_1fr] gap-x-3 items-center">
                <div className="text-sm text-gray-800 bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                  {leftItem}
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300" />
                <select
                  value={pairs[String(i)] ?? ''}
                  onChange={(e) => setMatchPair(i, e.target.value === '' ? -1 : Number(e.target.value))}
                  disabled={submitting}
                  className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:border-[#01b4ae] outline-none"
                >
                  <option value="">Select…</option>
                  {(q.columnB ?? []).map((rightItem, j) => (
                    <option key={j} value={j}>
                      {String.fromCharCode(65 + j)}. {rightItem}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        );
      }
      case 'numerical':
        return (
          <div>
            <p className="text-xs text-gray-500 mb-2">Enter your numerical answer</p>
            <input
              type="number"
              inputMode="decimal"
              value={currentAnswerValue === -1 || currentAnswerValue === undefined || currentAnswerValue === null ? '' : String(currentAnswerValue)}
              onChange={(e) => setAnswer(e.target.value === '' ? -1 : Number(e.target.value))}
              disabled={submitting}
              placeholder="Your answer"
              className="w-full border-2 border-gray-200 rounded-xl p-3.5 text-lg font-semibold bg-gray-50 focus:bg-white focus:border-[#01b4ae] focus:ring-4 focus:ring-[#01b4ae]/20 outline-none transition-all"
            />
          </div>
        );
      default: {
        // mcq_single (and any unknown type degrades to single choice)
        const selected = typeof currentAnswerValue === 'number' ? currentAnswerValue : -1;
        return (
          <div className="space-y-2.5">
            {(q.options ?? []).map((option, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setAnswer(i)}
                disabled={submitting}
                className={`w-full text-left border-2 rounded-xl p-3.5 flex items-start gap-3 transition-all ${
                  selected === i
                    ? 'border-[#01b4ae] bg-[#01b4ae]/5'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <span
                  className={`w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center text-xs font-bold ${
                    selected === i ? 'border-[#01b4ae] bg-[#01b4ae] text-white' : 'border-gray-300 text-gray-500'
                  }`}
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="text-sm text-gray-800 leading-relaxed">{option}</span>
              </button>
            ))}
          </div>
        );
      }
    }
  };

  const activeSectionDef = typeof currentSectionIndex === 'number'
    ? attempt.sectionDefinitions?.[currentSectionIndex]
    : null;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Sticky header: timer + progress */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate">{quiz.title}</p>
            {activeSectionDef?.name && (
              <p className="text-[11px] text-[#008f8a] font-semibold">
                {activeSectionDef.name} · {answeredCount}/{activeSectionQuestionIndexes.length} answered
              </p>
            )}
          </div>
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono font-bold text-sm tabular-nums ${
              secondsLeft <= 60 ? 'bg-red-50 text-red-600' : 'bg-[#01b4ae]/10 text-[#008f8a]'
            }`}
          >
            <Clock className="w-4 h-4" />
            {formatClock(secondsLeft)}
          </div>
        </div>
      </header>

      {banner && (
        <div className="max-w-3xl mx-auto w-full px-4 pt-3">
          <div className="bg-[#01b4ae]/10 border border-[#01b4ae]/20 rounded-xl p-3 flex items-start gap-2">
            <Eye className="w-4 h-4 text-[#008f8a] mt-0.5 shrink-0" />
            <p className="text-xs text-[#008f8a] flex-1">{banner}</p>
            <button onClick={() => setBanner(null)} className="text-xs text-[#008f8a] font-semibold">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Question card */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-4 pb-40">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-400">
              Question {current + 1} of {questions.length}
            </span>
            <button
              type="button"
              onClick={() => {
                setMarkedForReview((prev) => {
                  const next = { ...prev, [current]: !prev[current] };
                  markedRef.current = next;
                  if (answersRef.current[current]) {
                    setAnswers((a) => ({
                      ...a,
                      [current]: { ...a[current], markedForReview: next[current] },
                    }));
                  }
                  return next;
                });
                dirtyRef.current = true;
              }}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                markedForReview[current]
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              <Flag className="w-3.5 h-3.5" />
              {markedForReview[current] ? 'Marked' : 'Mark for review'}
            </button>
          </div>

          {currentQuestion.questionImage && (
            <img
              src={currentQuestion.questionImage}
              alt="Question"
              className="max-w-full rounded-xl border border-gray-100 mb-3"
            />
          )}

          {currentQuestion.assertion && (
            <div className="bg-gray-50 rounded-xl p-3 mb-2 text-sm text-gray-700 leading-relaxed">
              <span className="font-semibold text-gray-500 text-xs uppercase tracking-wide block mb-1">Assertion</span>
              {currentQuestion.assertion}
            </div>
          )}
          {currentQuestion.reason && (
            <div className="bg-gray-50 rounded-xl p-3 mb-2 text-sm text-gray-700 leading-relaxed">
              <span className="font-semibold text-gray-500 text-xs uppercase tracking-wide block mb-1">Reason</span>
              {currentQuestion.reason}
            </div>
          )}

          <p className="text-base text-gray-900 font-medium leading-relaxed whitespace-pre-line mb-4">
            {currentQuestion.questionText}
          </p>

          {renderQuestionBody()}
        </div>

        {/* Palette */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mt-4">
          <p className="text-xs font-semibold text-gray-500 mb-2.5">
            {sectionLockEnabled ? 'This section' : 'Question palette'}
          </p>
          <div className="flex flex-wrap gap-2">
            {paletteIndexes.map((index) => {
              const answered = isAnswered(answers[index]?.selectedAnswer);
              const marked = markedForReview[index];
              const isCurrent = index === current;
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    setCurrent(index);
                    questionStartRef.current = Date.now();
                  }}
                  className={`w-9 h-9 rounded-lg text-xs font-bold transition-all border-2 ${
                    isCurrent
                      ? 'border-[#01b4ae] bg-[#01b4ae] text-white'
                      : marked
                        ? 'border-amber-300 bg-amber-50 text-amber-700'
                        : answered
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 bg-white text-gray-500'
                  }`}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[10px] text-gray-400">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-200 inline-block" /> Answered</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-200 inline-block" /> Marked</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-gray-200 inline-block" /> Not answered</span>
          </div>
        </div>
      </main>

      {/* Sticky bottom action bar */}
      <footer className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-20 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setCurrent((c) => Math.max(0, c - 1));
              questionStartRef.current = Date.now();
            }}
            disabled={current === 0}
            className="inline-flex items-center gap-1 text-sm font-semibold text-gray-600 disabled:text-gray-300 px-3 py-2.5"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>

          <div className="flex-1" />

          {sectionLockEnabled ? (
            <button
              type="button"
              onClick={() => setConfirmSection(true)}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 bg-[#01b4ae] hover:bg-[#008f8a] disabled:bg-gray-300 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bookmark className="w-4 h-4" />}
              Submit Section
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmSubmit(true)}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 bg-[#01b4ae] hover:bg-[#008f8a] disabled:bg-gray-300 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit Test
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setCurrent((c) => Math.min(questions.length - 1, c + 1));
              questionStartRef.current = Date.now();
            }}
            disabled={current === questions.length - 1}
            className="inline-flex items-center gap-1 text-sm font-semibold text-gray-600 disabled:text-gray-300 px-3 py-2.5"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </footer>

      {/* Section submit confirmation */}
      {confirmSection && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Submit this section?</h3>
            <p className="text-sm text-gray-600 mb-1">
              {unansweredCount > 0
                ? `You have ${unansweredCount} unanswered question${unansweredCount > 1 ? 's' : ''} in this section.`
                : 'All questions in this section are answered.'}
            </p>
            <p className="text-xs text-amber-600 font-medium mb-5">
              This section locks after submission — you cannot return to it.
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmSection(false)}
                className="flex-1 border-2 border-gray-200 text-gray-600 text-sm font-semibold py-2.5 rounded-xl"
              >
                Keep working
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmSection(false);
                  submitCurrentSection(false);
                }}
                className="flex-1 bg-[#01b4ae] hover:bg-[#008f8a] text-white text-sm font-semibold py-2.5 rounded-xl"
              >
                Submit section
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Whole-test submit confirmation */}
      {confirmSubmit && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Submit your test?</h3>
            <p className="text-sm text-gray-600 mb-5">
              {unansweredCount > 0
                ? `You have ${unansweredCount} unanswered question${unansweredCount > 1 ? 's' : ''}. Once submitted, answers cannot be changed.`
                : 'All questions are answered. Once submitted, answers cannot be changed.'}
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmSubmit(false)}
                className="flex-1 border-2 border-gray-200 text-gray-600 text-sm font-semibold py-2.5 rounded-xl"
              >
                Keep working
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmSubmit(false);
                  finalizeWholeQuiz(false);
                }}
                className="flex-1 bg-[#01b4ae] hover:bg-[#008f8a] text-white text-sm font-semibold py-2.5 rounded-xl"
              >
                Submit test
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
