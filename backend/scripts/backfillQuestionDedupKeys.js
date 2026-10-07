/**
 * One-time backfill for the QuestionBank dedupKey (`<subjectId>|<normalized
 * question text>`), the field the unique partial index `dedupKey_unique_active`
 * enforces. Adds the field to existing records — never modifies question text,
 * never deletes anything.
 *
 * The index itself builds automatically (mongoose autoIndex) and safely
 * BEFORE this script runs: its partial filter excludes docs without a string
 * key, so the backfill is what brings pre-existing rows under DB-level
 * duplicate protection.
 *
 * Usage:
 *   node scripts/backfillQuestionDedupKeys.js            # dry run (default): report + collision pre-scan
 *   node scripts/backfillQuestionDedupKeys.js --apply    # write the keys (idempotent)
 *
 * Dry run exits 0 when clean and 3 when ACTIVE collisions exist — those mean
 * the live bank already holds two active questions that normalize to the same
 * key, so applying would trip the unique index. STOP and get a human decision
 * (e.g. soft-delete one side via the admin API); this script never resolves
 * collisions by itself.
 *
 * NOTE: if the normalization in utils/questionValidation.js ever changes,
 * stored dedupKeys go stale — re-run this script (it recomputes and rewrites;
 * unchanged keys are skipped, so re-runs are cheap and idempotent).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const { getMongoUri } = require('../utils/mongoUri');
const { buildDedupKey } = require('../utils/questionDedup');

const CURSOR_BATCH = 2000;
const WRITE_BATCH = 500;

/**
 * Pure planner over already-fetched docs so it is unit-testable without a DB.
 * Keys are always recomputed from subject + question — stored keys are never
 * trusted (a normalizer change would make them stale).
 *
 * @param {Array<{_id: any, subject: any, question: string, isActive: boolean, dedupKey?: string}>} docs
 * @returns {{
 *   updates: Array<{_id: any, dedupKey: string}>,
 *   collisions: Array<{dedupKey: string, docs: Array<{_id: any, qid?: string, preview: string}>}>,
 *   missingText: number,
 *   alreadyBackfilled: number,
 *   total: number,
 *   activeTotal: number,
 * }}
 */
function computeBackfillPlan(docs) {
    const updates = [];
    const activeKeys = new Map(); // dedupKey -> [{_id, qid, preview}]
    let missingText = 0;
    let alreadyBackfilled = 0;
    let activeTotal = 0;

    for (const doc of docs) {
        const key = buildDedupKey(doc.subject, doc.question);
        if (!key) {
            // Required fields absent (legacy junk) — nothing to key on.
            missingText++;
            continue;
        }
        if (doc.isActive) {
            activeTotal++;
            const entry = {
                _id: doc._id,
                qid: doc.qid,
                preview: String(doc.question || '').slice(0, 120),
            };
            const bucket = activeKeys.get(key) || [];
            bucket.push(entry);
            activeKeys.set(key, bucket);
        }
        if (doc.dedupKey === key) {
            alreadyBackfilled++;
        } else {
            updates.push({ _id: doc._id, dedupKey: key });
        }
    }

    // Only ACTIVE docs are in the unique index, so only active-active sharing
    // collides. Inactive docs still get keys written (harmless, and correct
    // if they are ever re-activated).
    const collisions = [...activeKeys.entries()]
        .filter(([, entries]) => entries.length > 1)
        .map(([dedupKey, collisionDocs]) => ({ dedupKey, docs: collisionDocs }));

    return {
        updates,
        collisions,
        missingText,
        alreadyBackfilled,
        total: docs.length,
        activeTotal,
    };
}

const printPlan = (plan) => {
    console.log(`docs scanned:        ${plan.total}`);
    console.log(`active questions:    ${plan.activeTotal}`);
    console.log(`already backfilled:  ${plan.alreadyBackfilled}`);
    console.log(`keys to write:       ${plan.updates.length}`);
    console.log(`unkeyable (junk):    ${plan.missingText}`);
    console.log(`ACTIVE collisions:   ${plan.collisions.length}`);
    plan.collisions.forEach(({ dedupKey, docs }) => {
        console.log(`\n  COLLISION ${dedupKey}`);
        docs.forEach((d) => {
            console.log(`    _id=${d._id}${d.qid ? ` qid=${d.qid}` : ''} :: ${d.preview}`);
        });
    });
};

async function main() {
    const apply = process.argv.includes('--apply');
    await mongoose.connect(getMongoUri());
    const QuestionBank = require('../models/QuestionBank');

    // All docs, not just active — inactive ones get keys too (correct if a
    // restore path ever lands; they stay outside the unique index regardless).
    const docs = [];
    const cursor = QuestionBank.find({}).batchSize(CURSOR_BATCH).lean();
    for await (const doc of cursor) {
        docs.push(doc);
    }

    const plan = computeBackfillPlan(docs);
    printPlan(plan);

    if (plan.collisions.length > 0) {
        console.log('\nSTOP: resolve the active collisions above first (this script never deletes or overwrites questions).');
        await mongoose.disconnect();
        process.exit(3);
    }

    if (!apply) {
        console.log('\nDry run only — re-run with --apply to write the keys.');
        await mongoose.disconnect();
        return;
    }

    let written = 0;
    for (let i = 0; i < plan.updates.length; i += WRITE_BATCH) {
        const batch = plan.updates.slice(i, i + WRITE_BATCH).map(({ _id, dedupKey }) => ({
            updateOne: { filter: { _id }, update: { $set: { dedupKey } } },
        }));
        const result = await QuestionBank.bulkWrite(batch, { ordered: false });
        written += result.modifiedCount;
    }
    console.log(`\nApplied: ${written} dedupKey(s) written (0 = everything was already keyed).`);
    await mongoose.disconnect();
}

if (require.main === module) {
    main().catch((err) => {
        console.error('Backfill failed:', err.message);
        process.exit(1);
    });
}

module.exports = { computeBackfillPlan };
