/**
 * Unit tests for utils/proctoringTimelineAdminFormat.ts — the pure shaping
 * layer of the admin Proctoring Timeline section (redesign approved
 * 2026-10-21). Same harness/pattern as proctoringSummaryFormat.test.ts.
 */

import {
    ADMIN_INTEGRITY_LABELS,
    ADMIN_TIMELINE_LABELS,
    buildAdminEventRows,
    buildSummaryChips,
    buildViolationRows,
    eventClassFor,
    integrityTone,
    riskTone,
    timestampValid,
    validateAdjustedScore,
} from '../proctoringTimelineAdminFormat';

describe('proctoringTimelineAdminFormat — labels', () => {
    it('labels the core session, observation, integrity and system event types', () => {
        expect(ADMIN_TIMELINE_LABELS.SESSION_STARTED).toBe('Session started');
        expect(ADMIN_TIMELINE_LABELS.HEAD_POSE_TURNED).toBe('Turned head away (recorded)');
        expect(ADMIN_TIMELINE_LABELS.APP_BACKGROUND).toBe('Left the test app');
        expect(ADMIN_TIMELINE_LABELS.WARNING_DELIVERED).toBe('Warning shown');
        expect(ADMIN_TIMELINE_LABELS.AUTO_SUBMITTED).toBe('Submitted automatically (policy)');
    });

    it('leaves unknown types unmapped so the raw type is the honest fallback', () => {
        expect(ADMIN_TIMELINE_LABELS.SOMETHING_NEW).toBeUndefined();
    });

    it('labels all four §25.4 integrity statuses', () => {
        expect(ADMIN_INTEGRITY_LABELS.pending).toBe('Pending review');
        expect(ADMIN_INTEGRITY_LABELS.clean).toBe('Clean');
        expect(ADMIN_INTEGRITY_LABELS.reviewed_ok).toBe('Reviewed — OK');
        expect(ADMIN_INTEGRITY_LABELS.reviewed_concern).toBe('Reviewed — concern');
    });
});

describe('eventClassFor', () => {
    it('type wins for the two system actions regardless of category', () => {
        expect(eventClassFor('WARNING_DELIVERED', 'system_action')).toBe('warning');
        expect(eventClassFor('AUTO_SUBMITTED', 'system_action')).toBe('terminal');
        expect(eventClassFor('WARNING_DELIVERED', undefined)).toBe('warning');
    });

    it('maps registry categories to their visual classes', () => {
        expect(eventClassFor('APP_BACKGROUND', 'integrity')).toBe('integrity');
        expect(eventClassFor('EXIT_ATTEMPTED', 'integrity')).toBe('integrity');
        expect(eventClassFor('FACE_NOT_DETECTED', 'cv_observation')).toBe('observation');
        expect(eventClassFor('HEAD_POSE_TURNED', 'cv_observation')).toBe('observation');
        expect(eventClassFor('SESSION_CLOSED', 'technical')).toBe('technical');
        expect(eventClassFor('CAMERA_FEED_DARK', 'technical')).toBe('technical');
    });

    it('falls back to the calm technical class for unknown or missing categories', () => {
        expect(eventClassFor('POLICY_ACTION_SKIPPED', 'system_action')).toBe('technical');
        expect(eventClassFor('APP_BACKGROUND', undefined)).toBe('technical');
        expect(eventClassFor('WHATEVER', 'mystery')).toBe('technical');
    });
});

describe('riskTone / integrityTone', () => {
    it('mirrors the ProctoringOverview risk band colors', () => {
        expect(riskTone('normal')).toBe('success');
        expect(riskTone('low')).toBe('info');
        expect(riskTone('moderate')).toBe('warning');
        expect(riskTone('high')).toBe('danger');
        expect(riskTone('critical')).toBe('danger');
        expect(riskTone(undefined)).toBe('neutral');
        expect(riskTone('weird')).toBe('neutral');
    });

    it('keeps pending review calm and concerns red', () => {
        expect(integrityTone('clean')).toBe('success');
        expect(integrityTone('reviewed_ok')).toBe('success');
        expect(integrityTone('reviewed_concern')).toBe('danger');
        expect(integrityTone('pending')).toBe('neutral');
        expect(integrityTone(undefined)).toBe('neutral');
    });
});

describe('buildSummaryChips', () => {
    it('keeps violations, risk and review state as three distinct chips', () => {
        const chips = buildSummaryChips({ violationCount: 3, riskCategory: 'high' }, 'pending');
        expect(chips.map((chip) => chip.key)).toEqual(['violations', 'risk', 'integrity']);
        expect(chips[0]).toMatchObject({ label: '3 violations', tone: 'danger' });
        expect(chips[1]).toMatchObject({ label: 'Risk: High', tone: 'danger' });
        expect(chips[2]).toMatchObject({ label: 'Pending review', tone: 'neutral' });
    });

    it('pluralizes and calms down at zero violations', () => {
        expect(buildSummaryChips({ violationCount: 1, riskCategory: 'low' }, 'clean')[0])
            .toMatchObject({ label: '1 violation', tone: 'danger' });
        expect(buildSummaryChips({ violationCount: 0, riskCategory: 'normal' }, 'clean')[0])
            .toMatchObject({ label: '0 violations', tone: 'success' });
    });

    it('survives a missing summary with honest unknowns', () => {
        const chips = buildSummaryChips(null, 'reviewed_concern');
        expect(chips[1]).toMatchObject({ label: 'Risk: unknown', tone: 'neutral' });
        expect(chips[2]).toMatchObject({ label: 'Reviewed — concern', tone: 'danger' });
    });
});

describe('buildAdminEventRows', () => {
    const base = {
        _id: 'e1',
        type: 'SESSION_STARTED',
        category: 'technical',
        serverAt: '2026-10-21T14:02:11.000Z',
    };

    it('sorts by serverAt regardless of payload order', () => {
        const rows = buildAdminEventRows([
            { ...base, _id: 'late', serverAt: '2026-10-21T15:00:00.000Z' },
            { ...base, _id: 'early', serverAt: '2026-10-21T14:00:00.000Z' },
        ]);
        expect(rows.map((row) => row.id)).toEqual(['early', 'late']);
    });

    it('resolves labels, falls back to the raw type, and never drops rows', () => {
        const rows = buildAdminEventRows([
            base,
            { ...base, _id: 'e2', type: 'BRAND_NEW_TYPE', serverAt: '2026-10-21T14:05:00.000Z' },
        ]);
        expect(rows[0].label).toBe('Session started');
        expect(rows[1].label).toBe('BRAND_NEW_TYPE');
    });

    it('humanizes durations and omits meaningless ones', () => {
        const rows = buildAdminEventRows([
            { ...base, _id: 'a', durationMs: 45000 },
            { ...base, _id: 'b', durationMs: 125000 },
            { ...base, _id: 'c', durationMs: 500 },
            { ...base, _id: 'd' },
        ]);
        expect(rows.map((row) => row.duration)).toEqual(['45s', '2m 5s', null, null]);
    });

    it('promotes the final-warning and auto-submit-rule sub-labels from metadata', () => {
        // Same serverAt across rows — documents the _id tiebreak ('s1' < 'w1' < 'w2').
        const rows = buildAdminEventRows([
            {
                ...base, _id: 'w1', type: 'WARNING_DELIVERED', category: 'system_action',
                metadata: { code: 'warn.headTurn' },
            },
            {
                ...base, _id: 'w2', type: 'WARNING_DELIVERED', category: 'system_action',
                metadata: { code: 'warn.final' },
            },
            {
                ...base, _id: 's1', type: 'AUTO_SUBMITTED', category: 'system_action',
                metadata: { ruleId: 'focus.maxViolations' },
            },
        ]);
        expect(rows.map((row) => row.subLabel)).toEqual(['Rule: focus.maxViolations', null, 'Final warning']);
    });

    it('flags missing/unparseable timestamps instead of dropping the row', () => {
        // Same serverAt across rows — the _id tiebreak orders 'bad' < 'none' < 'ok'.
        const rows = buildAdminEventRows([
            { ...base, _id: 'ok', serverAt: '2026-10-21T14:02:11.000Z' },
            { ...base, _id: 'bad', serverAt: 'not-a-date' },
            { ...base, _id: 'none', serverAt: undefined as unknown as string },
        ]);
        expect(rows.map((row) => row.timeValid)).toEqual([false, false, true]);
    });

    it('filters malformed entries (no _id or no type)', () => {
        const rows = buildAdminEventRows([
            base,
            { ...base, _id: '' },
            { ...base, _id: 'noType', type: '' },
        ]);
        expect(rows).toHaveLength(1);
    });
});

describe('buildViolationRows', () => {
    it('shapes payload violations with every field optional-safe', () => {
        const rows = buildViolationRows([
            {
                _id: 'v1',
                ruleId: 'focus.maxViolations',
                reliability: 'deterministic',
                actionTaken: { action: 'WARN' },
                review: { status: 'confirmed' },
            },
            {},
        ]);
        expect(rows[0]).toEqual({
            id: 'v1',
            ruleId: 'focus.maxViolations',
            reliability: 'deterministic',
            action: 'WARN',
            reviewStatus: 'confirmed',
        });
        expect(rows[1]).toMatchObject({
            id: 'violation-1',
            ruleId: 'unknown rule',
            reliability: null,
            action: null,
            reviewStatus: null,
        });
    });
});

describe('timestampValid', () => {
    it('accepts ISO strings and rejects everything else', () => {
        expect(timestampValid('2026-10-21T14:02:11.000Z')).toBe(true);
        expect(timestampValid('')).toBe(false);
        expect(timestampValid(null)).toBe(false);
        expect(timestampValid(undefined)).toBe(false);
        expect(timestampValid('garbage')).toBe(false);
    });
});

describe('validateAdjustedScore (client mirror of the /review rules)', () => {
    it('treats empty as valid-and-absent (the score is optional)', () => {
        expect(validateAdjustedScore('', '')).toEqual({ valid: true, error: null, value: null });
        expect(validateAdjustedScore('  ', ' ')).toEqual({ valid: true, error: null, value: null });
    });

    it('requires the pair together', () => {
        expect(validateAdjustedScore('5', '').valid).toBe(false);
        expect(validateAdjustedScore('', '720').valid).toBe(false);
        expect(validateAdjustedScore('5', '').error).toBe('Enter both the adjusted score and the total marks.');
    });

    it('requires numbers, non-negative, and score ≤ total', () => {
        expect(validateAdjustedScore('abc', '10').error).toBe('The adjusted score and total must be numbers.');
        expect(validateAdjustedScore('5', 'ten').error).toBe('The adjusted score and total must be numbers.');
        expect(validateAdjustedScore('-1', '10').error).toBe('The adjusted score and total must be 0 or greater.');
        expect(validateAdjustedScore('15', '10').error).toBe('The adjusted score cannot exceed the total marks.');
    });

    it('returns the parsed pair for the POST body', () => {
        expect(validateAdjustedScore(' 8.5 ', '10')).toEqual({
            valid: true,
            error: null,
            value: { adjustedScore: 8.5, adjustedTotalMarks: 10 },
        });
        expect(validateAdjustedScore('0', '0').value).toEqual({ adjustedScore: 0, adjustedTotalMarks: 0 });
    });
});
