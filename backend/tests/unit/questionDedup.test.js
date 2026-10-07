/**
 * Unit tests for the shared duplicate-prevention helpers. The duplicate RULE
 * itself (normalizeQuestionForDedup) is covered in questionValidation.test.js;
 * these cover key composition and the pure backfill planner.
 */
const {
    buildDedupKey,
    applyDedupKey,
} = require('../../utils/questionDedup');
const { computeBackfillPlan } = require('../../scripts/backfillQuestionDedupKeys');

describe('buildDedupKey', () => {
    it('composes subjectId and normalized question text', () => {
        expect(buildDedupKey('507f1f77bcf86cd799439011', 'What is photosynthesis?'))
            .toBe('507f1f77bcf86cd799439011|what is photosynthesis?');
    });

    it('folds case and whitespace differences into the same key', () => {
        const a = buildDedupKey('s1', 'What is photosynthesis?');
        expect(buildDedupKey('s1', '  WHAT IS PHOTOSYNTHESIS?  ')).toBe(a);
        expect(buildDedupKey('s1', 'What\tis\nphotosynthesis?')).toBe(a);
        expect(buildDedupKey('s1', 'What  is   photosynthesis?')).toBe(a);
        expect(buildDedupKey('s1', 'What is　photosynthesis?')).toBe(a);
    });

    it('scopes keys to the subject', () => {
        expect(buildDedupKey('s1', 'Same question?')).not.toBe(buildDedupKey('s2', 'Same question?'));
    });

    it('returns null for uncomputable inputs', () => {
        expect(buildDedupKey(null, 'text')).toBeNull();
        expect(buildDedupKey('s1', '')).toBeNull();
        expect(buildDedupKey('s1', '   ')).toBeNull();
        expect(buildDedupKey(null, null)).toBeNull();
    });
});

describe('applyDedupKey', () => {
    it('sets the key from the doc subject + question', () => {
        const doc = { subject: 's1', question: 'Text' };
        applyDedupKey(doc);
        expect(doc.dedupKey).toBe('s1|text');
    });

    it('never unsets an existing key when the new one is uncomputable', () => {
        const doc = { subject: null, question: 'Text', dedupKey: 'old' };
        applyDedupKey(doc);
        expect(doc.dedupKey).toBe('old');
    });
});

describe('computeBackfillPlan (backfillQuestionDedupKeys)', () => {
    const doc = (over = {}) => ({
        _id: over._id || 'id1',
        subject: over.subject || 's1',
        question: over.question || 'Question one?',
        isActive: over.isActive !== undefined ? over.isActive : true,
        dedupKey: over.dedupKey,
        qid: over.qid,
    });

    it('assigns keys to un-keyed docs', () => {
        const plan = computeBackfillPlan([doc({ _id: 'a' }), doc({ _id: 'b', question: 'Question two?' })]);
        expect(plan.updates).toHaveLength(2);
        expect(plan.updates[0]).toEqual({ _id: 'a', dedupKey: 's1|question one?' });
        expect(plan.alreadyBackfilled).toBe(0);
    });

    it('flags collisions between ACTIVE docs sharing a key', () => {
        const plan = computeBackfillPlan([
            doc({ _id: 'a', qid: 'Q1', question: 'Same question?' }),
            doc({ _id: 'b', qid: 'Q2', question: 'SAME  question?' }),
        ]);
        expect(plan.collisions).toHaveLength(1);
        expect(plan.collisions[0].dedupKey).toBe('s1|same question?');
        expect(plan.collisions[0].docs.map((d) => d._id).sort()).toEqual(['a', 'b']);
    });

    it('does not treat inactive docs as collisions (index excludes them)', () => {
        const plan = computeBackfillPlan([
            doc({ _id: 'a', question: 'Same question?' }),
            doc({ _id: 'b', question: 'Same question?', isActive: false }),
        ]);
        expect(plan.collisions).toHaveLength(0);
        expect(plan.updates).toHaveLength(2);
    });

    it('counts already-backfilled docs and emits no write for them', () => {
        const plan = computeBackfillPlan([
            doc({ _id: 'a', dedupKey: 's1|question one?' }),
        ]);
        expect(plan.updates).toHaveLength(0);
        expect(plan.alreadyBackfilled).toBe(1);
    });

    it('skips unkeyable docs and reports totals', () => {
        const plan = computeBackfillPlan([
            doc({ _id: 'a' }),
            { _id: 'junk', subject: null, question: '', isActive: true },
            doc({ _id: 'c', isActive: false }),
        ]);
        expect(plan.missingText).toBe(1);
        expect(plan.updates).toHaveLength(2);
        expect(plan.total).toBe(3);
        expect(plan.activeTotal).toBe(1); // doc a only — c is inactive, junk is unkeyable
    });

    it('rewrites stale keys when the stored key differs (normalizer drift)', () => {
        const plan = computeBackfillPlan([
            doc({ _id: 'a', dedupKey: 's1|question  one?' }), // double space — stale
        ]);
        expect(plan.updates).toEqual([{ _id: 'a', dedupKey: 's1|question one?' }]);
        expect(plan.alreadyBackfilled).toBe(0);
    });
});
