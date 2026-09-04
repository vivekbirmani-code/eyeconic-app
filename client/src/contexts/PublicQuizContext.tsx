import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  publicApi,
  getGuestToken,
  clearGuestToken,
  guestSessionExpiredEventName,
  getErrorData,
  type PublicQuizSummary,
  type GuestLead,
  type StartAttemptResponse,
  type GuestAnswer,
} from '../services/publicApi';

// Device identity + guest-session plumbing for the public quiz flow.
// Plain hooks + localStorage (the client has no state library by design).
// The device UUID mirrors the mobile app's GuestQuizContext approach; the
// server uses it for resume and legacy-compatible attempt ownership.

const GUEST_ID_KEY = 'eyeconic_public_guest_id';

const getOrCreateGuestId = (): string => {
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(GUEST_ID_KEY, id);
  }
  return id;
};

const getDeviceInfo = (): string =>
  `${navigator.userAgent} | ${window.innerWidth}x${window.innerHeight}`;

interface PublicQuizContextValue {
  guestId: string;
  lead: GuestLead | null;
  hasGuestSession: boolean;
  sessionExpired: boolean;
  quiz: PublicQuizSummary | null;
  quizError: { status?: number; code?: string; message: string } | null;
  quizLoading: boolean;
  refreshQuiz: (shareToken: string) => Promise<void>;
  setLead: (lead: GuestLead | null) => void;
  handleSessionExpired: () => void;
}

const PublicQuizContext = createContext<PublicQuizContextValue | undefined>(undefined);

export const PublicQuizProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [guestId] = useState(getOrCreateGuestId);
  const [lead, setLead] = useState<GuestLead | null>(null);
  const [hasGuestSession, setHasGuestSession] = useState<boolean>(() => Boolean(getGuestToken()));
  const [sessionExpired, setSessionExpired] = useState(false);
  const [quiz, setQuiz] = useState<PublicQuizSummary | null>(null);
  const [quizError, setQuizError] = useState<PublicQuizContextValue['quizError']>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleSessionExpired = useCallback(() => {
    clearGuestToken();
    setHasGuestSession(false);
    setSessionExpired(true);
  }, []);

  useEffect(() => {
    const onExpired = () => handleSessionExpired();
    window.addEventListener(guestSessionExpiredEventName, onExpired);
    return () => window.removeEventListener(guestSessionExpiredEventName, onExpired);
  }, [handleSessionExpired]);

  const refreshQuiz = useCallback(async (shareToken: string) => {
    setQuizLoading(true);
    setQuizError(null);
    try {
      const response = await publicApi.get<{ success: boolean; quiz: PublicQuizSummary }>(
        `/public/quiz/${shareToken}`
      );
      if (mounted.current) {
        setQuiz(response.data.quiz);
      }
    } catch (error) {
      if (mounted.current) {
        const extracted = getErrorData(error);
        setQuiz(null);
        setQuizError({
          status: extracted?.status,
          code: extracted?.code,
          message: extracted?.message || 'Unable to load this quiz.',
        });
      }
    } finally {
      if (mounted.current) {
        setQuizLoading(false);
      }
    }
  }, []);

  const value = useMemo(
    () => ({
      guestId,
      lead,
      hasGuestSession,
      sessionExpired,
      quiz,
      quizError,
      quizLoading,
      refreshQuiz,
      setLead,
      handleSessionExpired,
    }),
    [guestId, lead, hasGuestSession, sessionExpired, quiz, quizError, quizLoading, refreshQuiz, handleSessionExpired]
  );

  return <PublicQuizContext.Provider value={value}>{children}</PublicQuizContext.Provider>;
};

export const usePublicQuiz = (): PublicQuizContextValue => {
  const context = useContext(PublicQuizContext);
  if (!context) {
    throw new Error('usePublicQuiz must be used within PublicQuizProvider');
  }
  return context;
};

// ---------- thin API wrappers used by the pages ----------

export const publicQuizApi = {
  sendOtp: (shareToken: string, payload: { name: string; phone: string; marketingConsent: boolean; source?: string }) =>
    publicApi.post<{ success: boolean; expiresInSeconds: number; resendAfterSeconds: number }>(
      `/public/quiz/${shareToken}/lead/send-otp`,
      { ...payload, source: 'web' }
    ),

  verifyOtp: (
    shareToken: string,
    payload: { name: string; phone: string; marketingConsent: boolean; otp: string }
  ) =>
    publicApi.post<{ success: boolean; guestToken: string; guest: GuestLead }>(
      `/public/quiz/${shareToken}/lead/verify-otp`,
      payload
    ),

  start: (shareToken: string, guestId: string) =>
    publicApi.post<StartAttemptResponse>(`/public/quiz/${shareToken}/start`, {
      guestId,
      deviceInfo: getDeviceInfo(),
    }),

  saveProgress: (
    shareToken: string,
    payload: {
      guestId: string;
      attemptId: string;
      answers: GuestAnswer[];
      tabSwitchCount: number;
      tabSwitchLog: string[];
    }
  ) => publicApi.post(`/public/quiz/${shareToken}/save-progress`, payload),

  submitSection: (
    shareToken: string,
    sectionIndex: number,
    payload: { guestId: string; attemptId: string; isAutoSubmit: boolean; answers: GuestAnswer[] }
  ) =>
    publicApi.post<{
      success: boolean;
      message: string;
      submittedSectionIndex?: number;
      nextSection?: { index: number; name: string } | null;
      sectionStates?: StartAttemptResponse['attempt']['sectionStates'];
      serverNow?: string;
      attemptFinalized?: boolean;
      isAlreadySubmitted?: boolean;
      attemptId?: string;
    }>(`/public/quiz/${shareToken}/sections/${sectionIndex}/submit`, payload),

  submit: (
    shareToken: string,
    payload: {
      guestId: string;
      attemptId: string;
      answers: GuestAnswer[];
      tabSwitchCount: number;
      tabSwitchLog: string[];
    }
  ) =>
    publicApi.post<{ success: boolean; attemptId: string; submitted: boolean; isAlreadySubmitted?: boolean }>(
      `/public/quiz/${shareToken}/submit`,
      payload
    ),

  result: (shareToken: string, attemptId: string, groupBy: string) =>
    publicApi.get(`/public/quiz/${shareToken}/attempt/${attemptId}/result`, {
      params: { groupBy },
    }),
};
