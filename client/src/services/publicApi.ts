import axios from 'axios';

/**
 * SEPARATE axios instance for the public quiz guest flow.
 *
 * It must never touch `userToken`: the shared admin instance (services/api.ts)
 * attaches the admin token to every request and its 401 interceptor DELETES
 * that token — an expired guest session on these pages would otherwise log
 * an admin out of the dashboard in another tab. The guest token lives under
 * its own key and clears only itself.
 */

const GUEST_TOKEN_KEY = 'guestToken';
const GUEST_SESSION_EXPIRED_EVENT = 'guestSessionExpired';

export const GUEST_TOKEN_STORAGE_KEY = GUEST_TOKEN_KEY;
export const guestSessionExpiredEventName = GUEST_SESSION_EXPIRED_EVENT;

const resolveBaseUrl = (): string => {
  const url = import.meta.env.VITE_API_URL;
  if (url) {
    return url;
  }
  // Dev server runs without VITE_API_URL configured -> default to the local
  // backend so the public flow works out of the box. Production builds keep
  // the relative fallback (the API must be configured at build time).
  if (import.meta.env.DEV) {
    return 'http://localhost:3000/api';
  }
  return '/api';
};

export const publicApi = axios.create({
  baseURL: resolveBaseUrl(),
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const getGuestToken = (): string | null =>
  localStorage.getItem(GUEST_TOKEN_KEY);

export const setGuestToken = (token: string): void => {
  localStorage.setItem(GUEST_TOKEN_KEY, token);
};

export const clearGuestToken = (): void => {
  localStorage.removeItem(GUEST_TOKEN_KEY);
};

publicApi.interceptors.request.use((config) => {
  const token = getGuestToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

publicApi.interceptors.response.use(
  (response) => response,
  (error) => {
    // A dead guest session only ends the guest flow — the public pages
    // listen for this event and route back to the OTP step.
    const code = error?.response?.data?.code;
    if (error?.response?.status === 401 && typeof code === 'string' && code.startsWith('GUEST_SESSION')) {
      clearGuestToken();
      window.dispatchEvent(new Event(GUEST_SESSION_EXPIRED_EVENT));
    }
    return Promise.reject(error);
  }
);

export interface PublicApiError {
  status?: number;
  code?: string;
  message: string;
}

export const getPublicApiError = (error: unknown): PublicApiError => {
  const extracted = getErrorData(error);
  return {
    status: extracted?.status,
    code: extracted?.code,
    message: extracted?.message || 'Something went wrong. Please try again.',
  };
};

/** Typed extraction of { status, code, message } from an unknown thrown error. */
export const getErrorData = (
  error: unknown
): { status?: number; code?: string; message?: string; attemptId?: string; offline?: boolean } | undefined => {
  if (axios.isAxiosError(error)) {
    // No response at all = the server was unreachable (backend not running,
    // wrong URL, or a network drop). Axios surfaces this as "Network Error";
    // give the guest an actionable message instead.
    if (!error.response) {
      return {
        code: 'SERVER_UNREACHABLE',
        offline: true,
        message:
          'Cannot reach the Eyeconic server. Please check that you are connected and try again.',
      };
    }
    const data = error.response.data as Record<string, unknown> | undefined;
    return {
      status: error.response.status,
      code: typeof data?.code === 'string' ? data.code : undefined,
      message: typeof data?.message === 'string' && data.message ? data.message : undefined,
      // QUIZ_ALREADY_ATTEMPTED responses carry the guest's existing attempt
      // so the UI can route straight to its result page.
      attemptId: typeof data?.attemptId === 'string' ? data.attemptId : undefined,
    };
  }
  return undefined;
};

// ---------- shared public-quiz API types ----------

export interface PublicQuizSummary {
  _id: string;
  title: string;
  subject: { _id: string; name: string } | null;
  duration: number;
  instructions: string[];
  totalMarks: number;
  questionCount: number;
  lockSectionsAfterSubmission: boolean;
  sections: { name: string; duration: number; questionCount: number }[];
}

export interface PublicQuestion {
  _id: string;
  questionText: string;
  subjectName: string;
  questionType: string;
  options: string[];
  questionImage?: string | null;
  optionImages?: (string | null)[] | null;
  assertion?: string | null;
  reason?: string | null;
  columnA?: string[] | null;
  columnB?: string[] | null;
  marks: number;
}

export interface GuestAnswer {
  questionIndex: number;
  questionId?: string;
  selectedAnswer: unknown;
  markedForReview: boolean;
  timeSpent: number;
}

export interface SectionDefinition {
  index: number;
  name?: string;
  duration?: number;
  questionIds: string[];
}

export interface SectionState {
  index: number;
  status: 'in_progress' | 'submitted' | 'auto_submitted';
  startedAt?: string | null;
  endsAt?: string | null;
  submittedAt?: string | null;
}

export interface StartAttemptResponse {
  success: boolean;
  message: string;
  attemptFinalized?: boolean;
  // Present on attemptFinalized responses: the finalized attempt's own id,
  // so the client routes to THIS guest's result without guessing.
  attemptId?: string;
  status?: string;
  lead?: { _id: string; name: string; email: string | null; phoneMasked: string };
  attempt: {
    _id: string;
    startTime: string;
    answers: GuestAnswer[];
    sectionLockEnabled?: boolean;
    sectionDefinitions?: SectionDefinition[];
    sectionStates?: SectionState[];
    serverNow?: string;
  };
  quiz: {
    _id: string;
    title: string;
    duration: number;
    questions: PublicQuestion[];
    totalMarks: number;
  };
}

export interface GuestLead {
  _id: string;
  name: string;
  email: string;
  phone: string;
  marketingConsent: boolean;
}

// ---------- attempt pointer (localStorage) ----------
// Kept so a refresh mid-quiz — or an attempt finalized while away — can
// still find the attemptId for the result page. The pointer is SCOPED to the
// verified guest that owns the attempt (`guestRef`): this browser's storage
// is shared by every student who uses it, and an unscoped pointer let the
// second student get routed to the first student's result. Pointers written
// before the guestRef existed (or by the anonymous legacy flow, which has no
// lead) carry none and stay readable — the entry page drops the pointer on
// every fresh verification, which is the real gate; this scoping is defense
// in depth on top of the server's lead-scoped routing.

const ATTEMPT_STORAGE_KEY = 'eyeconic_public_attempt';

export const rememberAttempt = (shareToken: string, attemptId: string, guestRef?: string | null): void => {
  try {
    localStorage.setItem(
      ATTEMPT_STORAGE_KEY,
      JSON.stringify({ shareToken, attemptId, guestRef: guestRef ?? null })
    );
  } catch {
    /* storage unavailable — resume still works via the server */
  }
};

export const recallAttemptId = (shareToken: string, guestRef?: string | null): string | null => {
  try {
    const raw = localStorage.getItem(ATTEMPT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { shareToken: string; attemptId: string; guestRef?: string | null };
    if (parsed.shareToken !== shareToken) return null;
    // A pointer owned by a DIFFERENT verified guest is not ours to use.
    if (guestRef && parsed.guestRef && parsed.guestRef !== guestRef) return null;
    return parsed.attemptId;
  } catch {
    return null;
  }
};

export const forgetAttempt = (): void => {
  try {
    localStorage.removeItem(ATTEMPT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
};
