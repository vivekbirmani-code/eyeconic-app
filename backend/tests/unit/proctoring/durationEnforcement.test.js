// Unit tests for utils/proctoring/durationEnforcement.js (plan §7.5, D12).
// The pure timing core of the server-authoritative duration fix.

const {
  DURATION_GRACE_MS,
  computeFlatDurationDeadline,
  hasDurationDeadline,
  getDurationDeadline,
  getEffectiveDeadline,
  getSubmissionWindowEnd,
  isPastSubmissionWindow,
  isPastQuizWindow,
  buildAutoSubmitReason,
  resolveSubmissionStatus,
} = require('../../../utils/proctoring/durationEnforcement');

const MINUTE = 60 * 1000;

describe('computeFlatDurationDeadline', () => {
  const start = new Date('2026-09-15T10:00:00Z');

  it('computes startTime + duration for a flat quiz', () => {
    const deadline = computeFlatDurationDeadline({ durationMinutes: 30, sectionLockEnabled: false }, start);
    expect(deadline.getTime()).toBe(start.getTime() + 30 * MINUTE);
  });

  it('returns null for section-locked attempts (the endsAt cascade owns them)', () => {
    expect(computeFlatDurationDeadline({ durationMinutes: 30, sectionLockEnabled: true }, start)).toBeNull();
  });

  it('returns null without a positive duration', () => {
    expect(computeFlatDurationDeadline({ durationMinutes: 0, sectionLockEnabled: false }, start)).toBeNull();
    expect(computeFlatDurationDeadline({ durationMinutes: -5, sectionLockEnabled: false }, start)).toBeNull();
    expect(computeFlatDurationDeadline({ durationMinutes: NaN, sectionLockEnabled: false }, start)).toBeNull();
    expect(computeFlatDurationDeadline({ durationMinutes: undefined, sectionLockEnabled: false }, start)).toBeNull();
  });

  it('returns null for an invalid start time', () => {
    expect(computeFlatDurationDeadline({ durationMinutes: 30, sectionLockEnabled: false }, 'not-a-date')).toBeNull();
  });
});

describe('submission window (deadline + grace)', () => {
  it('uses a 30 s network grace', () => {
    expect(DURATION_GRACE_MS).toBe(30 * 1000);
  });

  const deadline = new Date('2026-09-15T10:30:00Z');
  const attempt = { status: 'in_progress', durationDeadline: deadline };

  it('exposes the window end as deadline + grace', () => {
    expect(getSubmissionWindowEnd(attempt).getTime()).toBe(deadline.getTime() + DURATION_GRACE_MS);
  });

  it('is not past the window before or exactly at the boundary', () => {
    expect(isPastSubmissionWindow(attempt, new Date(deadline.getTime() - 1))).toBe(false);
    expect(isPastSubmissionWindow(attempt, deadline)).toBe(false);
    expect(isPastSubmissionWindow(
      attempt,
      new Date(deadline.getTime() + DURATION_GRACE_MS)
    )).toBe(false); // boundary itself is still inside (strictly-greater test)
  });

  it('is past the window after deadline + grace', () => {
    expect(isPastSubmissionWindow(
      attempt,
      new Date(deadline.getTime() + DURATION_GRACE_MS + 1)
    )).toBe(true);
  });

  it('never reports past-window for attempts without a deadline', () => {
    expect(isPastSubmissionWindow({ status: 'in_progress' }, new Date())).toBe(false);
    expect(isPastSubmissionWindow({}, new Date())).toBe(false);
    expect(getSubmissionWindowEnd({})).toBeNull();
  });
});

describe('hasDurationDeadline', () => {
  it('is true for any attempt carrying a stored flat deadline (status gating is the callers\' job)', () => {
    expect(hasDurationDeadline({ status: 'in_progress', durationDeadline: new Date() })).toBe(true);
    expect(hasDurationDeadline({ status: 'in_progress' })).toBe(false);
    expect(hasDurationDeadline({ status: 'in_progress', durationDeadline: 'garbage' })).toBe(false);
    expect(hasDurationDeadline({})).toBe(false);
  });

  it('is false for section-locked attempts even if a deadline somehow exists (defensive)', () => {
    const sectionLocked = {
      status: 'in_progress',
      durationDeadline: new Date(),
      sectionLockEnabled: true,
      sectionDefinitions: [{ index: 0, name: 'A', duration: 10, questionIds: [] }],
    };
    expect(hasDurationDeadline(sectionLocked)).toBe(false);
    expect(resolveSubmissionStatus(sectionLocked, { isAutoSubmit: false }).status).toBe('completed');
    expect(resolveSubmissionStatus(sectionLocked, { isAutoSubmit: true }).status).toBe('auto_submitted');
  });
});

describe('resolveSubmissionStatus — the client flag is a hint, never the verdict', () => {
  const deadline = new Date('2026-09-15T10:30:00Z');
  const flatAttempt = { status: 'in_progress', durationDeadline: deadline };

  it('manual submit within the window completes', () => {
    const now = new Date(deadline.getTime() - MINUTE);
    const result = resolveSubmissionStatus(flatAttempt, { isAutoSubmit: false, now });
    expect(result).toEqual({ status: 'completed', autoSubmitReason: null });
  });

  it('client-timer auto-submit within the window stays auto_submitted (existing semantics)', () => {
    const now = new Date(deadline.getTime() - 5000);
    expect(resolveSubmissionStatus(flatAttempt, { isAutoSubmit: true, now }).status).toBe('auto_submitted');
  });

  it('a MANUAL submit past the window becomes auto_submitted with a duration reason', () => {
    // §7.5 normative case: late manual submit cannot buy 'completed'.
    const now = new Date(deadline.getTime() + DURATION_GRACE_MS + 1000);
    const result = resolveSubmissionStatus(flatAttempt, { isAutoSubmit: false, now });
    expect(result.status).toBe('auto_submitted');
    expect(result.autoSubmitReason).toMatchObject({ kind: 'duration' });
    expect(result.autoSubmitReason.deadline.getTime()).toBe(deadline.getTime());
    expect(result.autoSubmitReason.detectedAt.getTime()).toBe(now.getTime());
  });

  it('a client-timer submit past the window also carries the duration reason', () => {
    const now = new Date(deadline.getTime() + 10 * MINUTE);
    const result = resolveSubmissionStatus(flatAttempt, { isAutoSubmit: true, now });
    expect(result.status).toBe('auto_submitted');
    expect(result.autoSubmitReason.kind).toBe('duration');
  });

  it('is unchanged for attempts without a deadline (legacy / section-locked)', () => {
    expect(resolveSubmissionStatus({ status: 'in_progress' }, { isAutoSubmit: false }).status).toBe('completed');
    expect(resolveSubmissionStatus({ status: 'in_progress' }, { isAutoSubmit: true }).status).toBe('auto_submitted');
    expect(resolveSubmissionStatus({ status: 'in_progress' }, {}).status).toBe('completed');
  });
});

describe('server clock is the only clock (client timing manipulation resistance)', () => {
  it('derives everything from the stored deadline — no client timestamp participates', () => {
    const deadline = new Date(Date.now() + MINUTE); // still in the future
    const attempt = { status: 'in_progress', durationDeadline: deadline };
    // A client claiming its clock is ±30 minutes off changes nothing: the
    // decision inputs are (stored deadline, server now) only.
    const result = resolveSubmissionStatus(attempt, { isAutoSubmit: false, now: new Date() });
    expect(result.status).toBe('completed');
  });
});

describe('effective deadline — min(durationDeadline, participation window)', () => {
  const durationDeadline = new Date('2026-10-10T11:30:00Z'); // attempt: 30 min from 11:00

  it('getEffectiveDeadline picks the earlier of the two caps', () => {
    const earlierWindow = { expiryDate: new Date('2026-10-10T11:15:00Z') };
    const laterWindow = { expiryDate: new Date('2026-10-10T20:00:00Z') };
    const attempt = { status: 'in_progress', durationDeadline };

    expect(getEffectiveDeadline(attempt, earlierWindow).getTime())
      .toBe(new Date('2026-10-10T11:15:00Z').getTime());
    expect(getEffectiveDeadline(attempt, laterWindow).getTime())
      .toBe(durationDeadline.getTime());
  });

  it('getEffectiveDeadline uses publicExpiryDate only in publicMode (guests)', () => {
    const quiz = { expiryDate: new Date('2026-10-10T09:00:00Z'), publicExpiryDate: new Date('2026-10-10T19:00:00Z') };
    const attempt = { status: 'in_progress', durationDeadline };

    // Registered: the student window (09:00, already past) is irrelevant as
    // the min() still yields the earlier — here the 09:00 window.
    expect(getEffectiveDeadline(attempt, quiz).getTime())
      .toBe(new Date('2026-10-10T09:00:00Z').getTime());
    // Guest: ONLY the link expiry participates.
    expect(getEffectiveDeadline(attempt, quiz, { publicMode: true }).getTime())
      .toBe(durationDeadline.getTime());
  });

  it('getEffectiveDeadline tolerates missing caps (legacy attempts, window-less quizzes)', () => {
    const windowEnd = new Date(Date.now() + MINUTE);
    // Legacy attempt (no stored deadline) on a windowed quiz: the window is
    // still a cap — the window alone governs.
    expect(getEffectiveDeadline({ status: 'in_progress' }, { expiryDate: windowEnd }).getTime())
      .toBe(windowEnd.getTime());
    expect(getEffectiveDeadline({ status: 'in_progress', durationDeadline }, {}).getTime()).toBe(durationDeadline.getTime());
    expect(getEffectiveDeadline({ status: 'in_progress', durationDeadline }, null).getTime()).toBe(durationDeadline.getTime());
    expect(getEffectiveDeadline({ status: 'in_progress' }, { expiryDate: 'garbage' })).toBeNull();
    expect(getEffectiveDeadline({ status: 'in_progress' }, {})).toBeNull();
  });

  it('isPastSubmissionWindow honours the min() when a quiz is supplied', () => {
    const attempt = { status: 'in_progress', durationDeadline: new Date(Date.now() + 30 * MINUTE) };
    const closedWindow = { expiryDate: new Date(Date.now() - 10 * MINUTE) };
    const openWindow = { expiryDate: new Date(Date.now() + 30 * MINUTE) };

    // Individual deadline far away, window closed → past the EFFECTIVE deadline.
    expect(isPastSubmissionWindow(attempt, new Date(), closedWindow)).toBe(true);
    // Same attempt, window open → not past anything.
    expect(isPastSubmissionWindow(attempt, new Date(), openWindow)).toBe(false);
  });

  it('isPastQuizWindow applies the grace to the window end itself', () => {
    const justClosed = { expiryDate: new Date(Date.now() - 5 * 1000) };
    const closedPastGrace = { expiryDate: new Date(Date.now() - DURATION_GRACE_MS - 1000) };

    expect(isPastQuizWindow(justClosed)).toBe(false);   // in-transit tolerance
    expect(isPastQuizWindow(closedPastGrace)).toBe(true);
    expect(isPastQuizWindow({})).toBe(false);           // window-less quiz: no cap
    expect(isPastQuizWindow({ publicExpiryDate: closedPastGrace.expiryDate }, new Date(), { publicMode: true })).toBe(true);
  });

  it('buildAutoSubmitReason attributes the cap that actually fired', () => {
    const now = new Date();
    const windowFirst = buildAutoSubmitReason(
      { durationDeadline: new Date('2026-10-10T11:30:00Z') },
      { expiryDate: new Date('2026-10-10T11:00:00Z') },
      now
    );
    expect(windowFirst.kind).toBe('quiz_window');
    expect(windowFirst.deadline.getTime()).toBe(new Date('2026-10-10T11:00:00Z').getTime());
    expect(windowFirst.detectedAt.getTime()).toBe(now.getTime());

    const durationFirst = buildAutoSubmitReason(
      { durationDeadline: new Date('2026-10-10T10:45:00Z') },
      { expiryDate: new Date('2026-10-10T11:00:00Z') },
      now
    );
    expect(durationFirst.kind).toBe('duration');

    // Identical deadlines report exactly ONE reason (duration, deterministically).
    const same = new Date('2026-10-10T11:00:00Z');
    expect(buildAutoSubmitReason({ durationDeadline: same }, { expiryDate: same }, now).kind).toBe('duration');
  });

  it('resolveSubmissionStatus decides auto_submitted from whichever cap fired', () => {
    const attempt = { status: 'in_progress', durationDeadline: new Date(Date.now() + 30 * MINUTE) };
    const closedWindow = { expiryDate: new Date(Date.now() - 10 * MINUTE) };

    const decided = resolveSubmissionStatus(attempt, { isAutoSubmit: false, quiz: closedWindow });
    expect(decided.status).toBe('auto_submitted');
    expect(decided.autoSubmitReason.kind).toBe('quiz_window');

    // Without the quiz the same attempt is happily in-window (back-compat).
    expect(resolveSubmissionStatus(attempt, { isAutoSubmit: false }).status).toBe('completed');
  });
});
