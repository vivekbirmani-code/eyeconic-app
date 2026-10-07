/**
 * Shared duplicate-prevention helpers for every Question Bank write path
 * (manual create/update, Excel/CSV bulk import, quiz import, seed scripts).
 *
 * The duplicate rule itself lives in questionValidation.normalizeQuestionForDedup
 * — this module composes it into persisted keys and batched DB loaders so all
 * paths compare questions identically:
 *   duplicate = same subject + same normalized question text, active questions only.
 *
 * The model requires buildDedupKey/applyDedupKey for its pre-save hook, so this
 * module must NOT require the model at the top level (import cycle). The two
 * loader functions require it lazily instead.
 */
const { normalizeQuestionForDedup } = require('./questionValidation');

/**
 * "<subjectId>|<normalized question text>" — the persisted dedup key, unique
 * among active questions via the partial index on the QuestionBank model.
 * Returns null when the key cannot be computed (missing subject/text); callers
 * treat null as "not deduplicatable" and skip the check.
 */
const buildDedupKey = (subjectId, text) => {
    const normalized = normalizeQuestionForDedup(text);
    if (!subjectId || !normalized) return null;
    return `${String(subjectId)}|${normalized}`;
};

/**
 * Set doc.dedupKey from its own subject + question. Used by the model's
 * pre('save') hook (and explicitly by bulk insertMany, which bypasses hooks).
 * Only assigns — never unsets — so an uncomputable key on an in-flight
 * document simply leaves whatever was there (required-field validation is
 * the pipeline's job, not dedup's).
 */
const applyDedupKey = (doc) => {
    const key = buildDedupKey(doc.subject, doc.question);
    if (key) doc.dedupKey = key;
    return doc;
};

/**
 * Bulk import prefetch: Set of dedup keys for the ACTIVE questions of the
 * given subjects. One indexed query; keys are RECOMPUTED from the stored
 * raw text (never read from the persisted dedupKey field) so detection is
 * correct even for docs not yet backfilled with a key. The same Set doubles
 * as the in-file duplicate tracker: the import loop adds each accepted row's
 * key, so a later row with the same key is caught without another query.
 */
const loadExistingDedupKeySet = async (subjectIds) => {
    const QuestionBank = require('../models/QuestionBank');
    const keys = new Set();
    if (!Array.isArray(subjectIds) || subjectIds.length === 0) return keys;
    const existing = await QuestionBank.find(
        { subject: { $in: subjectIds }, isActive: true },
        { subject: 1, question: 1 }
    );
    existing.forEach((q) => {
        const key = buildDedupKey(q.subject, q.question);
        if (key) keys.add(key);
    });
    return keys;
};

/**
 * Quiz import prefetch: Map<dedupKey, doc> of the ACTIVE questions of the
 * given subjects, replacing the old per-row findOne (N+1). Keys are
 * recomputed from raw text, same rationale as the Set loader.
 *
 * Only the fields the duplicate branches touch are selected — _id for quiz
 * wiring, question for previews, image fields + tags for the update-with-
 * images enrichment. mongoose save() $sets only modified paths, so unloaded
 * fields can never be clobbered when the enrichment branch saves the doc.
 */
const loadActiveQuestionDedupMap = async (subjectIds) => {
    const QuestionBank = require('../models/QuestionBank');
    const map = new Map();
    if (!Array.isArray(subjectIds) || subjectIds.length === 0) return map;
    const docs = await QuestionBank.find(
        { subject: { $in: subjectIds }, isActive: true },
        { subject: 1, question: 1, questionImage: 1, optionImages: 1, explanationImage: 1, tags: 1 }
    );
    docs.forEach((doc) => {
        const key = buildDedupKey(doc.subject, doc.question);
        if (key && !map.has(key)) map.set(key, doc); // first occurrence wins
    });
    return map;
};

module.exports = {
    buildDedupKey,
    applyDedupKey,
    loadExistingDedupKeySet,
    loadActiveQuestionDedupMap,
};
