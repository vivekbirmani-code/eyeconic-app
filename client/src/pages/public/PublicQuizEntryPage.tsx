import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileText,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { publicQuizApi, usePublicQuiz } from '../../contexts/PublicQuizContext';
import { setGuestToken, getPublicApiError } from '../../services/publicApi';

const RESEND_COOLDOWN_SECONDS = 60;

const isValidIndianMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits);

// Mirrors the backend's email validation (utils/otpHelpers.js) — the server
// re-validates everything; this only enables/disables the submit button.
const EMAIL_MAX_LENGTH = 254;
const isValidEmail = (value: string) => {
  const email = value.trim().toLowerCase();
  return email.length <= EMAIL_MAX_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const formatDuration = (minutes: number) => {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
};

export default function PublicQuizEntryPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { lead, setLead, hasGuestSession, sessionExpired, quiz, quizError, quizLoading, refreshQuiz } =
    usePublicQuiz();

  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Track the absolute timestamp of the last OTP send so the cooldown
  // survives component re-renders and mobile browser focus/blur events.
  // Computing remainingResendSeconds at render time from Date.now() is more
  // reliable than decrementing a counter that resets whenever the step
  // effect re-fires (which happens on iOS Safari focus/blur transitions).
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const otpInputRef = useRef<HTMLInputElement>(null);

  // Tick every second while the OTP step is visible so the cooldown
  // countdown re-renders without decrementing a counter in state.
  useEffect(() => {
    if (step !== 'otp' || !otpSentAt) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [step, otpSentAt]);

  const remainingResendSeconds = otpSentAt
    ? Math.max(0, Math.ceil((otpSentAt + RESEND_COOLDOWN_SECONDS * 1000 - nowTick) / 1000))
    : 0;

  const invalidLink = searchParams.get('invalid') === '1';

  useEffect(() => {
    if (token && !invalidLink) {
      refreshQuiz(token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, invalidLink]);



  const phoneValid = useMemo(() => isValidIndianMobile(phoneDigits), [phoneDigits]);
  const emailValid = useMemo(() => isValidEmail(email), [email]);
  const nameValid = name.trim().length >= 2;
  const otpValid = /^\d{6}$/.test(otp);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameValid) {
      setError({ message: 'Please enter your full name (at least 2 characters).' });
      return;
    }
    if (!emailValid) {
      setError({ message: 'Please enter a valid email address.' });
      return;
    }
    if (!phoneValid) {
      setError({ message: 'Please enter a valid 10-digit Indian mobile number.' });
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await publicQuizApi.sendOtp(token, {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: `+91${phoneDigits}`,
        marketingConsent,
      });
      setOtpSentAt(Date.now());
      setNowTick(Date.now());
      setStep('otp');
      setOtp('');
      // Focus is deferred to after state settles so the OTP input is mounted.
      setTimeout(() => otpInputRef.current?.focus(), 50);
    } catch (err) {
      setError(getPublicApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpValid) {
      setError({ message: 'Please enter the 6-digit code sent to your email.' });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await publicQuizApi.verifyOtp(token, {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: `+91${phoneDigits}`,
        marketingConsent,
        otp,
      });
      setGuestToken(response.data.guestToken);
      setLead(response.data.guest);

      // One attempt per person: this lead already finished THIS quiz. With
      // a viewable attempt (same lead) go straight to its result; otherwise
      // (matched via shared email under another phone) explain inline —
      // verification itself still succeeded, which the guest may need to
      // re-view their result later.
      const attempted = response.data.alreadyAttempted;
      if (attempted) {
        if (attempted.attemptId) {
          navigate(`/public-quiz/${token}/result/${attempted.attemptId}`, {
            replace: true,
            state: { alreadyAttempted: true },
          });
        } else {
          setError({ code: attempted.code, message: attempted.message });
        }
        return;
      }

      navigate(`/public-quiz/${token}/take`, { replace: true });
    } catch (err) {
      setError(getPublicApiError(err));
      setOtp('');
      otpInputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (remainingResendSeconds > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await publicQuizApi.sendOtp(token, {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: `+91${phoneDigits}`,
        marketingConsent,
      });
      setInfo('A new code has been sent to your email.');
      setOtpSentAt(Date.now());
      setNowTick(Date.now());
      setOtp('');
    } catch (err) {
      setError(getPublicApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const errorCard = (message: string, hint?: string, onRetry?: () => void) => (
    <div className="w-full max-w-md">
      <div className="bg-white rounded-3xl p-8 shadow-2xl text-center">
        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">{onRetry ? 'Connection Problem' : 'Link Unavailable'}</h1>
        <p className="text-gray-600 text-sm mb-1">{message}</p>
        {hint && <p className="text-gray-400 text-xs">{hint}</p>}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 inline-flex items-center gap-2 bg-[#01b4ae] hover:bg-[#008f8a] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Try Again
          </button>
        )}
      </div>
    </div>
  );

  if (invalidLink) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] flex items-center justify-center p-4">
        {errorCard('This quiz link is invalid or has been revoked.', 'Please ask your teacher to share a new link.')}
      </div>
    );
  }

  if (quizLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] flex items-center justify-center p-4">
        <Loader2 className="w-10 h-10 text-white animate-spin" />
      </div>
    );
  }

  if (quizError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] flex items-center justify-center p-4">
        {errorCard(
          quizError.message,
          quizError.code === 'SERVER_UNREACHABLE'
            ? 'This is usually a temporary issue or the server is starting up.'
            : undefined,
          quizError.code === 'SERVER_UNREACHABLE' ? () => refreshQuiz(token) : undefined
        )}
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] flex items-center justify-center p-4">
        {errorCard('Unable to load this quiz. Please check the link and try again.')}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Brand header */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center border-4 border-white/30 shadow-xl mb-3 overflow-hidden">
            {/* Logo.png is a square (1:1) circular mark on an opaque white
                background that touches the canvas edges, so object-cover fills
                the circular container without distortion. */}
            <img src="/Logo.png" alt="Eyeconic logo" className="w-full h-full object-cover" decoding="async" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-widest drop-shadow-md">EYECONIC</h1>
          <p className="text-white/90 text-xs tracking-wide font-medium">Your path to medical excellence</p>
        </div>

        {/* Quiz summary card */}
        <div className="bg-white rounded-3xl p-6 shadow-2xl mb-4">
          <div className="flex items-start justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold text-gray-900 leading-snug flex-1">{quiz.title}</h2>
            <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-[#008f8a] bg-[#01b4ae]/10 px-2.5 py-1 rounded-full">
              <Users className="w-3 h-3" /> Guest
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-50 rounded-xl py-2.5">
              <FileText className="w-4 h-4 text-[#01b4ae] mx-auto mb-1" />
              <p className="text-sm font-bold text-gray-900">{quiz.questionCount}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Questions</p>
            </div>
            <div className="bg-gray-50 rounded-xl py-2.5">
              <Clock className="w-4 h-4 text-[#01b4ae] mx-auto mb-1" />
              <p className="text-sm font-bold text-gray-900">{formatDuration(quiz.duration)}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Duration</p>
            </div>
            <div className="bg-gray-50 rounded-xl py-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#01b4ae] mx-auto mb-1" />
              <p className="text-sm font-bold text-gray-900">{quiz.totalMarks}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Marks</p>
            </div>
          </div>

          {quiz.sections.length > 0 && (
            <div className="mt-4 bg-amber-50 border border-amber-100 rounded-xl p-3">
              <p className="text-xs font-semibold text-amber-800 mb-1.5">
                This test has {quiz.sections.length} timed sections
              </p>
              <ul className="space-y-0.5">
                {quiz.sections.map((section) => (
                  <li key={section.name} className="text-xs text-amber-700">
                    • {section.name} — {section.questionCount} questions, {formatDuration(section.duration)}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-600 mt-1.5">
                Sections lock after their time ends. You cannot revisit them.
              </p>
            </div>
          )}
        </div>

        {/* Returning verified guest */}
        {hasGuestSession && lead && step === 'form' && (
          <div className="bg-white rounded-3xl p-5 shadow-2xl mb-4">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-8 h-8 text-[#01b4ae] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">Welcome back, {lead.name}</p>
                <p className="text-xs text-gray-500 truncate">{lead.email || lead.phone} verified</p>
              </div>
              <button
                onClick={() => navigate(`/public-quiz/${token}/take`)}
                className="inline-flex items-center gap-1.5 bg-[#01b4ae] hover:bg-[#008f8a] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {sessionExpired && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 mb-4">
            <p className="text-xs text-amber-800">
              Your session expired. Verify your email again to continue — your progress is saved.
            </p>
          </div>
        )}

        {/* Lead form / OTP card */}
        <div className="bg-white rounded-3xl p-6 shadow-2xl">
          {step === 'form' ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <h3 className="text-base font-bold text-gray-900">Start your attempt</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Verify your email to begin. No account needed.
                </p>
              </div>

              <div>
                <label htmlFor="lead-name" className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Full Name
                </label>
                <input
                  id="lead-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your full name"
                  maxLength={100}
                  autoComplete="name"
                  className="w-full border-2 border-gray-200 rounded-xl p-3.5 text-base bg-gray-50 focus:bg-white focus:border-[#01b4ae] focus:ring-4 focus:ring-[#01b4ae]/20 transition-all outline-none"
                  required
                />
              </div>

              <div>
                <label htmlFor="lead-email" className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
                  <input
                    id="lead-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    maxLength={254}
                    autoComplete="email"
                    className="w-full border-2 border-gray-200 rounded-xl pl-11 p-3.5 text-base bg-gray-50 focus:bg-white focus:border-[#01b4ae] focus:ring-4 focus:ring-[#01b4ae]/20 transition-all outline-none"
                    required
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  We'll email a verification code to this address.
                </p>
              </div>

              <div>
                <label htmlFor="lead-phone" className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Mobile Number
                </label>
                <div className="flex">
                  <span className="inline-flex items-center px-3.5 border-2 border-r-0 border-gray-200 rounded-l-xl bg-gray-50 text-gray-600 text-base font-medium">
                    +91
                  </span>
                  <input
                    id="lead-phone"
                    type="tel"
                    inputMode="numeric"
                    value={phoneDigits}
                    onChange={(e) => setPhoneDigits(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="10-digit mobile number"
                    autoComplete="tel-national"
                    className="w-full border-2 border-gray-200 rounded-r-xl p-3.5 text-base bg-gray-50 focus:bg-white focus:border-[#01b4ae] focus:ring-4 focus:ring-[#01b4ae]/20 transition-all outline-none rounded-l-none"
                    required
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(e) => setMarketingConsent(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#01b4ae] shrink-0"
                />
                <span className="text-xs text-gray-500 leading-relaxed">
                  I agree to be contacted by Eyeconic Mentors about courses and offers.{' '}
                  <span className="text-gray-400">(Optional — unchecking will not affect your test.)</span>
                </span>
              </label>

              {error && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-700">{error.message}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={busy || !nameValid || !emailValid || !phoneValid}
                className="w-full inline-flex items-center justify-center gap-2 bg-[#01b4ae] hover:bg-[#008f8a] disabled:bg-gray-300 text-white font-semibold py-3.5 rounded-xl transition-colors"
              >
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mail className="w-5 h-5" />}
                {busy ? 'Emailing code…' : 'Send Verification Code'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <button
                type="button"
                onClick={() => setStep('form')}
                className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>

              <div>
                <h3 className="text-base font-bold text-gray-900">Verify your email</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Enter the 6-digit code sent to <span className="font-semibold break-all">{email.trim().toLowerCase()}</span>
                </p>
              </div>

              <input
                ref={otpInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                className="w-full border-2 border-gray-200 rounded-xl p-3.5 text-center text-2xl font-bold tracking-[0.6em] bg-gray-50 focus:bg-white focus:border-[#01b4ae] focus:ring-4 focus:ring-[#01b4ae]/20 transition-all outline-none"
                required
              />

              {error && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-700">{error.message}</p>
                </div>
              )}
              {info && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-emerald-700">{info}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={busy || !otpValid}
                className="w-full inline-flex items-center justify-center gap-2 bg-[#01b4ae] hover:bg-[#008f8a] disabled:bg-gray-300 text-white font-semibold py-3.5 rounded-xl transition-colors"
              >
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                {busy ? 'Verifying…' : 'Verify & Start Quiz'}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={remainingResendSeconds > 0 || busy}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#008f8a] disabled:text-gray-400"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {remainingResendSeconds > 0 ? `Resend code in ${remainingResendSeconds}s` : 'Resend code'}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-white/70 text-[11px] mt-4">
          Powered by Eyeconic Mentors
        </p>
      </div>
    </div>
  );
}
