// Unit tests for utils/proctoring/durationEnforcement.js (plan §7.5, D12).
// The pure timing core of the server-authoritative duration fix.

const {
  DURATION_GRACE_MS,
  computeFlatDurationDeadline,
  hasDurationDeadline,
  getDurationDeadline,
  getSubmissionWindowEnd,
  isPastSubmissionWindow,
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
