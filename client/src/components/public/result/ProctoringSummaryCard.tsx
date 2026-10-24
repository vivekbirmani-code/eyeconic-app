/**
 * Proctoring summary card — the external student's OWN monitoring summary
 * on the public result page (owner decision D-P4: lightweight, approved).
 *
 * Data: the guest-owner timeline endpoint (public-quiz proctoring Phase 2)
 * — the SAME assembly every timeline reader uses. Shows session status
 * (completed normally / interrupted), monitored duration, recorded
 * violations, and the review status label. Deliberately EXCLUDED: admin
 * notes, violation rule details, event timelines, adjusted scores — that
 * is the administrator's review surface, never the student's.
 *
 * Renders nothing for non-proctored attempts or missing sessions (the 400/
 * null-timeline contract) — no fabricated "clean" states.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldCheck } from 'lucide-react';
import { publicApi } from '../../../services/publicApi';

interface TimelineSummary {
  totalEvents?: number;
  eventCounts?: Record<string, number>;
  violationCount?: number;
  riskCategory?: string;
  monitoredMs?: number;
  integrityStatus?: string;
}

interface TimelinePayload {
  session: {
    status: string;
    integrityStatus?: string;
    review?: { status?: string };
  };
  attemptStatus?: string;
  summary?: TimelineSummary;
}

const REVIEW_LABELS: Record<string, string> = {
  pending: 'Awaiting review',
  clean: 'No issues flagged',
  reviewed_ok: 'Reviewed — no action',
  reviewed_concern: 'Reviewed — noted',
};

const formatMinutes = (ms?: number) => {
  if (!ms || ms <= 0) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
};

export default function ProctoringSummaryCard({
  shareToken,
  attemptId,
}: {
  shareToken: string;
  attemptId: string;
}) {
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'hidden'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await publicApi.get<{ success: boolean; timeline: TimelinePayload | null }>(
          `/public/quiz/${shareToken}/attempt/${attemptId}/proctoring/timeline`
        );
        if (cancelled) return;
        if (response.data?.timeline) {
          setTimeline(response.data.timeline);
          setState('ready');
        } else {
          setState('hidden'); // Non-proctored attempt — nothing to show.
        }
      } catch {
        if (!cancelled) setState('hidden'); // 400 = not proctored; render nothing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareToken, attemptId]);

  if (state === 'loading') {
    return (
      <div className="bg-white rounded-2xl p-5 shadow-sm flex items-center gap-3 text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading monitoring summary…</span>
      </div>
    );
  }
  if (state === 'hidden' || !timeline) return null;

  const interrupted = timeline.session.status === 'CLOSED_FAILED'
    || (timeline.summary?.violationCount ?? 0) > 0;
  const monitored = formatMinutes(timeline.summary?.monitoredMs);
  const reviewLabel = REVIEW_LABELS[timeline.session.review?.status ?? ''] ?? null;
  const integrity = timeline.session.integrityStatus ?? 'pending';
  const reviewText =
    reviewLabel ?? (integrity === 'clean' ? REVIEW_LABELS.clean : REVIEW_LABELS.pending);
  const violations = timeline.summary?.violationCount ?? 0;

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2.5 mb-3">
        <ShieldCheck className="w-5 h-5 text-[#01b4ae]" />
        <h3 className="text-sm font-bold text-gray-900">Monitoring summary</h3>
        <span
          className={`ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full ${
            interrupted ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {interrupted ? (
            <>
              <AlertTriangle className="w-3 h-3" /> Flagged for review
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3 h-3" /> Completed normally
            </>
          )}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-gray-50 rounded-xl py-2.5">
          <p className="text-sm font-bold text-gray-900">{violations}</p>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Recorded violations</p>
        </div>
        <div className="bg-gray-50 rounded-xl py-2.5">
          <p className="text-sm font-bold text-gray-900">{timeline.summary?.totalEvents ?? 0}</p>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Monitoring events</p>
        </div>
        <div className="bg-gray-50 rounded-xl py-2.5">
          <p className="text-sm font-bold text-gray-900 flex items-center justify-center gap-1">
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            {monitored ?? '—'}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Monitored</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
        {reviewText}. Monitoring events are observations recorded during your attempt (such as
        look-aways or camera issues); violations are only the ones this test's rules count.
        Proctoring records are kept with your test records and are visible only to authorized
        administrators. No photos or videos were recorded.
      </p>
    </div>
  );
}
